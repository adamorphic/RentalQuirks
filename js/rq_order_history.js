// rq_order_history.js
// Polls the RentalWorks order audit trail (History tab) for all active orders
// in the Preps schedule and POSTs new changes to a webhook (Google Apps Script).
//
// Config (localStorage):
//   rq-dashboard-preps-sheet-url  — Google Sheet URL (shared with dashboard)
//   rq-order-history-webhook      — Apps Script /exec URL to receive change POSTs
//
// To trigger manually: RentalQuirks.pollOrderHistory()

(function(RQ) {
  'use strict';

  const PREPS_SHEET_KEY  = 'rq-dashboard-preps-sheet-url';
  const WEBHOOK_KEY      = 'rq-order-history-webhook';
  const HWM_PREFIX       = 'rq-history-hwm-';    // high-water mark (ChangeDateTime) per order
  const ID_CACHE_PREFIX  = 'rq-history-id-';     // order number → numeric OrderId cache
  const SEEN_KEY         = 'rq-order-history-seen'; // { orderNo: lastSeenMs }, drives retention
  const POLL_INTERVAL_MS = 3 * 60 * 1000;        // 3 minutes
  const DAYS_BACK    = 7;
  const DAYS_FORWARD = 13;
  const REQUEST_SPACING_MS = 500; // pause between orders so background polling doesn't starve the user's page loads
  const RETENTION_MS     = 30 * 24 * 60 * 60 * 1000; // forget an order 30 days after it last appeared in the prep window
  const PRUNE_PREFIXES   = [HWM_PREFIX, ID_CACHE_PREFIX]; // per-order keys pruneOrderState() is allowed to delete

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Only one browser tab should poll at a time. Web Locks auto-release when the tab
  // closes, so the lock naturally migrates to another open tab. ifAvailable:true means
  // a tab that doesn't get the lock skips this cycle instead of queuing behind it.
  async function runIfLeader(lockName, work) {
    if (!navigator.locks?.request) { await work(); return; } // old browser: no leader election
    await navigator.locks.request(lockName, { ifAvailable: true }, async lock => {
      if (!lock) { console.log('[RQ History] Another tab is polling; skipping this cycle'); return; }
      await work();
    });
  }

  // ── Sheet reading ──────────────────────────────────────────────────

  function getSheetId() {
    const url = localStorage.getItem(PREPS_SHEET_KEY) || '';
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function fmtDate(d) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  // Returns deduplicated job objects: { order, tech, production, company, prepDate }
  async function fetchPrepsJobs() {
    const sheetId = getSheetId();
    if (!sheetId) return [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dates = Array.from({ length: DAYS_BACK + DAYS_FORWARD + 1 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + (i - DAYS_BACK));
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
              order:      (r['Order No.']          || '').trim(),
              tech:       (r['Prep Tech']           || '').trim(),
              production: (r['Job Name']            || '').trim(),
              company:    (r['Production Company']  || '').trim(),
              prepDate:   dateStr,
            }));
        })
        .catch(() => []);
    }));

    // Deduplicate by order number — earliest prepDate wins
    const seen = new Set();
    return results.flat().filter(j => j.order && !seen.has(j.order) && seen.add(j.order));
  }

  // ── Order ID resolution ────────────────────────────────────────────

  async function resolveOrderId(orderNo) {
    const cacheKey = ID_CACHE_PREFIX + orderNo;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
    const id = await RQ.api.get_id_from_code('Order', orderNo).catch(() => null);
    if (id) localStorage.setItem(cacheKey, String(id));
    return id ? String(id) : null;
  }

  // ── History API ────────────────────────────────────────────────────

  async function fetchHistoryPage(orderId, pageno) {
    const token = sessionStorage.apiToken;
    if (!token) return null;
    try {
      const r = await fetch(`${RW_URL.replace(/\/$/, '')}/api/v1/orderchange/browse`, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${token}`,
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          module:               'OrderChangeGrid',
          activeview:           '',
          boundids:             {},
          fields:               [],
          filterfields:         {},
          miscfields:           { OrderId: { datafield: 'OrderId', value: orderId } },
          options:              {},
          orderby:              '',
          orderbydirection:     '',
          pageno,
          pagesize:             500,
          searchcondition:      [],
          searchconjunctions:   [],
          searchfieldoperators: [],
          searchfields:         [],
          searchfieldtypes:     [],
          searchfieldvalues:    [],
          searchgroupings:      [],
          searchseparators:     [],
          timezoneOffset:       new Date().getTimezoneOffset() / -60,
          top:                  0,
          totalfields:          [],
          uniqueids:            { OrderId: orderId, IsSummary: 'false', FilterBy: 'Weekly', ExcludeZeroVariance: false },
        }),
      });
      if (!r.ok) {
        console.warn('[RQ History] API error', r.status, await r.text());
        return null;
      }
      return await r.json();
    } catch { return null; }
  }

  // Rows are ASC (oldest first), so new rows are on the last pages.
  // We paginate through all pages and collect rows newer than hwm.
  async function fetchNewRows(orderId, hwm) {
    const allNew = [];
    let pageno = 1;
    const MAX_PAGES = 10; // cap at 5000 rows per order per poll
    while (pageno <= MAX_PAGES) {
      const response = await fetchHistoryPage(orderId, pageno);
      if (!response) break;
      const rows = parseRows(response);
      if (!rows.length) break;
      if (hwm) allNew.push(...rows.filter(r => r.changeDateTime > hwm));
      else allNew.push(...rows);
      if (rows.length < 500) break; // last page
      pageno++;
    }
    return allNew;
  }

  function parseRows(response) {
    const ci = response?.ColumnIndex;
    const rows = response?.Rows;
    if (!ci || !rows?.length) return [];
    return rows.map(row => ({
      changeDateTime: row[ci.ChangeDateTime]       ?? '',
      auditType:      row[ci.AuditTypeDescription] ?? '',
      icode:          row[ci.ICode]                ?? '',
      description:    row[ci.Description]          ?? '',
      oldQty:         row[ci.OldQuantityOrdered]   ?? null,
      newQty:         row[ci.NewQuantityOrdered]   ?? null,
      modifiedBy:     row[ci.ModifiedByUser]       ?? '',
    }));
  }

  // ── High-water mark ────────────────────────────────────────────────

  function loadHwm(orderNo) {
    return localStorage.getItem(HWM_PREFIX + orderNo) || null;
  }

  function saveHwm(orderNo, datetime) {
    if (datetime) localStorage.setItem(HWM_PREFIX + orderNo, datetime);
  }

  // ── Retention ──────────────────────────────────────────────────────
  // Every order ever polled used to leave a high-water mark and an id-cache entry
  // behind for good, so localStorage grew without bound and would eventually hit
  // its ~5MB quota, breaking writes across all of RentalQuirks.
  //
  // Retention is keyed on when an order was last seen in the prep window, not on
  // whether it appears in the current cycle: fetchPrepsJobs() swallows per-date
  // errors and returns [], so a partially failed sheet read must not be allowed to
  // discard state for orders that are still live.

  function loadSeen() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); }
    catch { return {}; }
  }

  // Marks `orders` as seen now, then deletes per-order keys for every order whose
  // last sighting is older than RETENTION_MS (and any key predating this registry).
  // Dropping a high-water mark is cheap: the order re-baselines to now on its next
  // poll, and it was outside the window — so unwatched — for the whole gap anyway.
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
    catch (e) { console.warn('[RQ History] Failed to save seen-order registry', e); }

    if (dropped) console.log(`[RQ History] Pruned ${dropped} stale order key(s)`);
  }

  // ── Webhook ────────────────────────────────────────────────────────
  // Apps Script /exec redirects POST→GET, losing the body.
  // Encode payload as base64 query param so it survives the redirect.

  async function postToWebhook(payload) {
    const url = localStorage.getItem(WEBHOOK_KEY);
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain' },
      });
      console.log('[RQ History] Posted', (payload.changes ?? []).length, 'change(s) for', payload.orderNumber);
    } catch (e) {
      console.warn('[RQ History] Webhook fetch failed:', e);
    }
  }

  // ── Poll ───────────────────────────────────────────────────────────

  async function poll() {
    if (typeof RQ.api?.get_id_from_code !== 'function') {
      console.warn('[RQ History] API not ready, retrying in 15s');
      setTimeout(poll, 15_000);
      return;
    }
    if (!localStorage.getItem(WEBHOOK_KEY)) return;

    await runIfLeader('rq-order-history-poll', async () => {
      const jobs = await fetchPrepsJobs();
      if (!jobs.length) return;

      // Reclaim space before writing this cycle's high-water marks, not after.
      pruneOrderState(jobs.map(j => j.order));

      console.log(`[RQ History] Polling ${jobs.length} order(s)…`);

      for (const job of jobs) {
        try {
          const orderId = await resolveOrderId(job.order);
          if (!orderId) continue;

          const hwm = loadHwm(job.order);

          if (!hwm) {
            // First encounter — baseline to now so we only report future changes
            const now = new Date().toISOString();
            saveHwm(job.order, now);
            console.log(`[RQ History] Baseline for ${job.order} at ${now}`);
            continue;
          }

          const newRows = await fetchNewRows(orderId, hwm);
          if (!newRows.length) continue;

          const maxDt = newRows.reduce((best, r) => r.changeDateTime > best ? r.changeDateTime : best, '');
          await postToWebhook({
            type:        'order_history',
            orderNumber: job.order,
            production:  job.production,
            company:     job.company,
            tech:        job.tech,
            prepDate:    job.prepDate,
            changes:     newRows.map(r => ({
              dt:     r.changeDateTime,
              by:     r.modifiedBy,
              type:   r.auditType,
              icode:  r.icode,
              desc:   r.description,
              oldQty: r.oldQty,
              newQty: r.newQty,
            })),
            timestamp: new Date().toISOString(),
          });
          saveHwm(job.order, maxDt);
        } catch (e) {
          console.warn(`[RQ History] Error on ${job.order}:`, e);
        }
        await sleep(REQUEST_SPACING_MS); // yield connections to the user's page loads between orders
      }

      console.log('[RQ History] Poll complete');
    });
  }

  // ── Startup ────────────────────────────────────────────────────────

  RQ.pollOrderHistory = poll;

  setTimeout(() => {
    poll();
    setInterval(poll, POLL_INTERVAL_MS);
  }, 8_000);

  console.log('[RQ History] Started — first poll in 8s');

})(window.RentalQuirks);
