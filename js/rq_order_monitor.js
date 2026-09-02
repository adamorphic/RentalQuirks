// rq_order_monitor.js
// Polls RentalWorks order details for all orders in the Preps schedule and
// reports changes (items added/removed, quantities, dates, status) to an
// Apps Script webhook, which logs to a sheet and emails the prep tech.

(function(RQ) {
  'use strict';

  const SNAPSHOT_PREFIX  = 'rq-order-snapshot-';
  const LAST_POLL_KEY    = 'rq-order-monitor-last-poll';
  const WEBHOOK_KEY      = 'rq-order-monitor-webhook';
  const PREPS_SHEET_KEY  = 'rq-dashboard-preps-sheet-url';
  const SEEN_KEY         = 'rq-order-monitor-seen'; // { orderNo: lastSeenMs }, drives retention
  const POLL_INTERVAL_MS = 2.5 * 60 * 1000; // 2.5 minutes
  const REQUEST_SPACING_MS = 500; // pause between orders so background polling doesn't starve the connection pool the user's page navigation needs
  const RETENTION_MS     = 30 * 24 * 60 * 60 * 1000; // forget an order 30 days after it last appeared in the prep window
  const PRUNE_PREFIXES   = [SNAPSHOT_PREFIX]; // per-order keys pruneOrderState() is allowed to delete

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let warnedNoWebhook = false; // only warn once per session that the webhook URL is missing

  // Only one browser tab should poll at a time. Web Locks auto-release when the tab
  // closes, so the lock naturally migrates to another open tab. ifAvailable:true means
  // a tab that doesn't get the lock skips this cycle instead of queuing behind it.
  async function runIfLeader(lockName, work) {
    if (!navigator.locks?.request) { await work(); return; } // old browser: no leader election
    await navigator.locks.request(lockName, { ifAvailable: true }, async lock => {
      if (!lock) { console.log('[RQ Monitor] Another tab is polling; skipping this cycle'); return; }
      await work();
    });
  }

  // ── Sheet reading ─────────────────────────────────────────────────

  function getSheetId() {
    const url = localStorage.getItem(PREPS_SHEET_KEY) || '';
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function fmtDate(d) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  async function fetchPrepsOrders() {
    const sheetId = getSheetId();
    if (!sheetId) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      return fmtDate(d);
    });

    const results = await Promise.all(dates.map(dateStr => {
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(dateStr)}&range=B2:L500&headers=1`;
      return fetch(url)
        .then(r => r.text())
        .then(text => {
          const m = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
          if (!m) return [];
          const json = JSON.parse(m[1]);
          if (json.status !== 'ok' || !json.table?.rows?.length) return [];
          const cols = json.table.cols.map(c => c.label);
          return json.table.rows
            .map(row => {
              const obj = {};
              row.c.forEach((cell, i) => { obj[cols[i]] = cell?.f ?? (typeof cell?.v === 'string' ? cell.v : null); });
              return obj;
            })
            .filter(r => r['Order No.'])
            .map(r => ({
              order:      (r['Order No.']         || '').trim(),
              tech:       (r['Prep Tech']          || '').trim(),
              production: (r['Job Name']           || '').trim(),
              company:    (r['Production Company'] || '').trim(),
              prepDate:   dateStr,
            }));
        })
        .catch(() => []);
    }));

    // Flatten and deduplicate by order number (earliest date wins)
    const seen = new Set();
    return results.flat().filter(j => {
      if (!j.order || seen.has(j.order)) return false;
      seen.add(j.order);
      return true;
    });
  }

  // ── Snapshot storage ──────────────────────────────────────────────

  function loadSnapshot(orderNumber) {
    try {
      const raw = localStorage.getItem(SNAPSHOT_PREFIX + orderNumber);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveSnapshot(orderNumber, detail) {
    const snap = {
      status:    detail.record?.Status ?? detail.record?.OrderStatus ?? null,
      startDate: detail.record?.EstimatedStartDate ?? null,
      stopDate:  detail.record?.EstimatedStopDate  ?? null,
      total:     detail.record?.GrandTotal ?? detail.record?.Total ?? detail.record?.OrderTotal ?? null,
      items: (detail.items ?? []).map(i => ({
        key:      i.OrderInventoryId || i.ICode || i.Description || '',
        desc:     i.Description || '',
        icode:    i.ICode || '',
        quantity: i.Quantity ?? i.Qty ?? null,
      })),
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(SNAPSHOT_PREFIX + orderNumber, JSON.stringify(snap));
    } catch (e) {
      console.warn('[RQ Monitor] Failed to save snapshot for', orderNumber, e);
    }
  }

  // ── Retention ─────────────────────────────────────────────────────
  // Every order ever prepped used to leave a snapshot behind for good. Snapshots
  // carry a full item list, so localStorage eventually hits its ~5MB quota — and
  // because saveSnapshot() only warns on failure, change detection would degrade
  // into silence rather than fail loudly.
  //
  // Retention is keyed on when an order was last seen in the prep window, not on
  // whether it appears in the current cycle: fetchPrepsOrders() swallows per-date
  // errors and returns [], so a partially failed sheet read must not be allowed to
  // discard state for orders that are still live.

  function loadSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); }
    catch { return {}; }
  }

  // Marks `orders` as seen now, then deletes per-order keys for every order whose
  // last sighting is older than RETENTION_MS (and any key predating this registry).
  // Dropping state is cheap: a returning order simply re-baselines on its next poll.
  function pruneOrderState(orders) {
    const now  = Date.now();
    const seen = loadSeen();
    orders.forEach(o => { seen[o] = now; });

    const live = new Set();
    for (const [orderNo, lastSeen] of Object.entries(seen)) {
      if (now - lastSeen < RETENTION_MS) live.add(orderNo);
      else delete seen[orderNo]; // keeps the registry itself bounded
    }

    let dropped = 0;
    for (const key of Object.keys(localStorage)) { // snapshots the key list, so removeItem below is safe
      const prefix = PRUNE_PREFIXES.find(p => key.startsWith(p));
      if (!prefix || live.has(key.slice(prefix.length))) continue;
      localStorage.removeItem(key);
      dropped++;
    }

    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); }
    catch (e) { console.warn('[RQ Monitor] Failed to save seen-order registry', e); }

    if (dropped) console.log(`[RQ Monitor] Pruned ${dropped} stale order snapshot(s)`);
  }

  // ── Diff ──────────────────────────────────────────────────────────

  function diffOrder(snap, detail) {
    const changes = [];
    const r = detail.record ?? {};

    const cur = {
      status:    r.Status ?? r.OrderStatus ?? null,
      startDate: r.EstimatedStartDate ?? null,
      stopDate:  r.EstimatedStopDate  ?? null,
      total:     r.GrandTotal ?? r.Total ?? r.OrderTotal ?? null,
    };

    if (snap.status    !== cur.status)
      changes.push({ type: 'MODIFIED', field: 'Status',    description: 'Order Status',         oldValue: snap.status,    newValue: cur.status    });
    if (snap.startDate !== cur.startDate)
      changes.push({ type: 'MODIFIED', field: 'Est. Start', description: 'Estimated Start Date', oldValue: snap.startDate, newValue: cur.startDate });
    if (snap.stopDate  !== cur.stopDate)
      changes.push({ type: 'MODIFIED', field: 'Est. Stop',  description: 'Estimated Stop Date',  oldValue: snap.stopDate,  newValue: cur.stopDate  });
    if (cur.total !== null && snap.total !== cur.total)
      changes.push({ type: 'MODIFIED', field: 'Total', description: 'Order Total', oldValue: snap.total, newValue: cur.total });

    const oldMap = new Map((snap.items ?? []).map(i => [i.key, i]));
    const newMap = new Map((detail.items ?? []).map(i => {
      const key = i.OrderInventoryId || i.ICode || i.Description || '';
      return [key, { key, desc: i.Description || '', icode: i.ICode || '', quantity: i.Quantity ?? i.Qty ?? null }];
    }));

    for (const [key, item] of newMap) {
      if (!oldMap.has(key)) {
        changes.push({ type: 'ADDED', description: item.desc || item.icode || key });
      } else {
        const old = oldMap.get(key);
        if (old.quantity !== item.quantity && item.quantity !== null)
          changes.push({ type: 'MODIFIED', field: 'Quantity', description: item.desc || key, oldValue: old.quantity, newValue: item.quantity });
      }
    }

    for (const [key, item] of oldMap) {
      if (!newMap.has(key))
        changes.push({ type: 'REMOVED', description: item.desc || item.icode || key });
    }

    return changes;
  }

  // ── Notify ────────────────────────────────────────────────────────

  // Apps Script /exec redirects POST→GET, losing the body.
  // Encode payload as a base64 query param so it survives the redirect.
  async function sendToWebhook(webhookUrl, payload) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain' },
      });
      console.log('[RQ Monitor] Sent to webhook');
    } catch (e) {
      console.warn('[RQ Monitor] Webhook fetch failed:', e);
    }
  }

  async function postChanges(payload) {
    const url = localStorage.getItem(WEBHOOK_KEY);
    if (!url) return;
    console.log('[RQ Monitor] Posting changes for', payload.order, '—', payload.changes?.length, 'change(s)');
    await sendToWebhook(url, payload);
  }

  // ── Order items fetch ─────────────────────────────────────────────
  // fetchRecordDetail uses window.OrderItemController which doesn't exist;
  // OrderItemGridController does. Fetch items directly with the right controller.

  async function fetchOrderItems(numericOrderId) {
    const controller = window.OrderItemGridController ?? window.OrderItemController;
    if (!controller?.apiurl) return [];
    const headers = {
      'authorization': 'Bearer ' + sessionStorage.apiToken,
      'content-type': 'application/json',
      'x-requested-with': 'XMLHttpRequest',
    };
    // Try POST first (some RW list endpoints reject GET)
    try {
      const r = await fetch(RW_URL + controller.apiurl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ filter: { Field: 'OrderId', Op: '=', Value: String(numericOrderId) }, pagesize: 500 }),
      });
      if (r.ok) {
        const json = await r.json();
        return json?.Items ?? [];
      }
    } catch { /* fall through */ }
    // Fallback: GET with filter in query string
    try {
      const filter = encodeURI(`filter={"Field":"OrderId","Op":"=","Value":"${numericOrderId}"}&pagesize=500`);
      const r = await fetch(RW_URL + controller.apiurl + '?' + filter, { headers });
      if (r.ok) {
        const json = await r.json();
        return json?.Items ?? [];
      }
    } catch { /* give up */ }
    return [];
  }

  // ── Poll ──────────────────────────────────────────────────────────

  async function pollOrders() {
    if (typeof RQ.api?.get_id_from_code !== 'function') {
      console.warn('[RQ Monitor] API not ready yet, retrying in 15s');
      setTimeout(pollOrders, 15_000);
      return;
    }
    if (!localStorage.getItem(WEBHOOK_KEY)) {
      if (!warnedNoWebhook) {
        console.warn('[RQ Monitor] No webhook URL — paste your Apps Script URL into the Preps card settings');
        warnedNoWebhook = true;
      }
      return;
    }
    warnedNoWebhook = false; // webhook present again; allow a fresh warning if it's later removed

    await runIfLeader('rq-order-monitor-poll', async () => {
      const jobs = await fetchPrepsOrders();
      if (!jobs.length) return;

      // Reclaim space before writing this cycle's snapshots, not after.
      pruneOrderState(jobs.map(j => j.order));

      console.log(`[RQ Monitor] Polling ${jobs.length} order(s)…`);

      for (const job of jobs) {
        try {
          const numericId = await RQ.api.get_id_from_code('Order', job.order);
          const detail = await RQ.fetchOrderDetail(job.order);
          if (!detail) continue;

          // fetchOrderDetail always returns items:[] because OrderItemController
          // doesn't exist. Fetch items directly via OrderItemGridController using
          // the numeric internal ID (not the order code string).
          detail.items = await fetchOrderItems(numericId);
          if (detail.items.length)
            console.log(`[RQ Monitor] Fetched ${detail.items.length} item(s) for ${job.order}`);

          const snap = loadSnapshot(job.order);
          if (snap) {
            const changes = diffOrder(snap, detail);
            if (changes.length > 0) {
              console.log(`[RQ Monitor] ${changes.length} change(s) in ${job.order}:`, changes);
              await postChanges({ ...job, changes, timestamp: new Date().toISOString() });
            }
          }

          saveSnapshot(job.order, detail);
        } catch (e) {
          console.warn(`[RQ Monitor] Error on ${job.order}:`, e);
        }
        await sleep(REQUEST_SPACING_MS); // yield connections to the user's page loads between orders
      }

      localStorage.setItem(LAST_POLL_KEY, String(Date.now()));
      console.log('[RQ Monitor] Poll complete');
    });
  }

  // ── Startup ───────────────────────────────────────────────────────

  function startMonitor() {
    const lastPoll = parseInt(localStorage.getItem(LAST_POLL_KEY) || '0', 10);
    const overdue  = Date.now() - lastPoll > POLL_INTERVAL_MS;

    if (overdue) {
      setTimeout(pollOrders, 30_000); // 30s after page load to let RW app initialize
    }
    setInterval(pollOrders, POLL_INTERVAL_MS);

    console.log('[RQ Monitor] Started' + (overdue ? ' — first poll in 30s' : ' — next poll in 10 min'));
  }

  RQ.pollOrderChanges = pollOrders; // exposed for manual trigger

  // ── Order Change Report page intercept ────────────────────────────
  // The report page stores its data in a local variable and logs it.
  // We intercept console.log before index.js fires to capture it.

  async function handleReportData(report) {
    const allItems   = report.Items || [];
    const detailRows = allItems.filter(i => i.RowType === 'detail');
    console.log('[RQ Monitor] Captured report data for', report.OrderNumber, '—', detailRows.length, 'change(s)');

    const webhookUrl = localStorage.getItem(WEBHOOK_KEY);
    if (!webhookUrl) {
      console.warn('[RQ Monitor] No webhook URL configured');
      return;
    }

    const jobs = await fetchPrepsOrders().catch(() => []);
    const job  = jobs.find(j => j.order === report.OrderNumber) || {};

    const payload = {
      type:        'change_report',
      orderNumber: report.OrderNumber,
      production:  report.Description  || '',
      customer:    report.customer      || '',
      orderstatus: report.orderstatus   || '',
      ordertotal:  report.ordertotal    || null,
      fromDate:    report.FromDate      || '',
      toDate:      report.ToDate        || '',
      tech:        job.tech             || '',
      company:     job.company          || report.Company || '',
      prepDate:    job.prepDate         || '',
      totalItems:  detailRows.length,
      items:       detailRows.slice(0, 20).map(i => ({
        a: (i.AuditTypeDescription    || ''),
        i: (i.ICode                   || ''),
        d: (i.Description             || '').slice(0, 35),
        u: (i.ModifiedByUser          || ''),
        c: (i.ChangeDateTime          || ''),
        o: (i.OldQuantityOrdered      || ''),
        n: (i.NewQuantityOrdered      || ''),
        v: (i.QuantityOrderedVariance || ''),
      })),
      timestamp:   new Date().toISOString(),
    };

    await sendToWebhook(webhookUrl, payload);
    console.log('[RQ Monitor] Change report posted for', report.OrderNumber);
  }

  if (location.pathname.includes('OrderChangeReport')) {
    const _origLog = console.log;
    console.log = function(...args) {
      if (typeof args[0] === 'string' && args[0].startsWith('Report Data') && args[1]?.OrderNumber) {
        handleReportData(args[1]);
      }
      return _origLog.apply(this, args);
    };
    console.log('[RQ Monitor] Watching for report data on OrderChangeReport page');
  } else {
    startMonitor();
  }

})(window.RentalQuirks);
