// rq_dashboard.js
// Slide-in dashboard panel accessible from any page via Alt+Q

(function(RQ) {
  'use strict';

  const CUSTOM_SECTIONS_KEY = 'rq-dashboard-custom-sections';
  const SECTION_ORDER_KEY   = 'rq-dashboard-section-order'; // MIGRATION ONLY
  const TAG_DEFS_KEY        = 'rq-dashboard-tag-defs';
  const ARCHIVE_KEY         = 'rq-dashboard-archive';
  const TABS_KEY            = 'rq-dashboard-tabs';
  const ACTIVE_TAB_KEY      = 'rq-dashboard-active-tab';
  const BUILTIN_IDS         = ['quicklinks', 'bookmarks', 'recents', 'archive', 'myorders', 'myquotes', 'mypos', 'subrentals', 'preps'];
  const MY_ORDERS_AGENT_KEY = 'rq-dashboard-my-orders-agent';
  const MY_QUOTES_AGENT_KEY   = 'rq-dashboard-my-quotes-agent';
  const MY_QUOTES_DUE_KEY     = 'rq-dashboard-my-quotes-due-field'; // 'start' | 'stop'
  const MY_POS_AGENT_KEY    = 'rq-dashboard-my-pos-agent';
  const ITEM_META_KEY        = 'rq-dashboard-item-meta';

  // ── Helpers ────────────────────────────────────────────────────────
  function el(tag, css, html) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (html) e.innerHTML = html;
    return e;
  }

  // Shared cfg-bar styling for text inputs and their Apply buttons.
  const CFG_INPUT_CSS = `
    width: 100%; min-width: 0; background: #141414; color: #ccc; border: 1px solid #333;
    border-radius: 3px; padding: 5px 9px; font-size: 13px; font-family: inherit; outline: none;`;
  const CFG_APPLY_BTN_CSS = `
    background: #1a3a1a; border: 1px solid #2a5a2a; color: #8ac; border-radius: 3px;
    padding: 5px 10px; font-size: 13px; cursor: pointer; flex-shrink: 0; white-space: nowrap;`;

  // Build a Material-icons icon button with the card header's standard hover behaviour.
  // opts: { color = '#444', hoverColor = '#8ac', title, onClick, css }. onClick is wrapped to
  // stopPropagation (these live inside draggable cards). Returns the <i> element.
  function makeIconButton(icon, opts = {}) {
    const { color = '#444', hoverColor = '#8ac', title, onClick, css = '' } = opts;
    const btn = el('i', `font-size: 15px; color: ${color}; cursor: pointer; flex-shrink: 0; transition: color 0.15s; ${css}`);
    btn.className = 'material-icons';
    btn.textContent = icon;
    if (title) btn.title = title;
    btn.addEventListener('mouseenter', () => btn.style.color = hoverColor);
    btn.addEventListener('mouseleave', () => btn.style.color = color);
    if (onClick) btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
    return btn;
  }

  // Standard italic placeholder/empty markup used inside card bodies.
  const placeholderHTML = (text) =>
    `<div style="padding:8px 14px;color:#555;font-style:italic;font-size:12px;">${text}</div>`;

  // Dismiss `element` on the next outside mousedown, then detach the listener.
  // Deferred a tick so the opening click doesn't immediately close it.
  function closeOnOutsideClick(element, onClose) {
    const handler = (e) => {
      if (!element.contains(e.target)) {
        document.removeEventListener('mousedown', handler, true);
        (onClose || (() => element.remove()))();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler, true), 0);
  }

  function loadCustomSections() {
    try { return JSON.parse(localStorage.getItem(CUSTOM_SECTIONS_KEY) || '[]'); }
    catch { return []; }
  }

  function saveCustomSections(sections) {
    localStorage.setItem(CUSTOM_SECTIONS_KEY, JSON.stringify(sections));
  }

  function loadTagDefs() {
    try { return JSON.parse(localStorage.getItem(TAG_DEFS_KEY) || '[]'); }
    catch { return []; }
  }

  function saveTagDefs(defs) {
    localStorage.setItem(TAG_DEFS_KEY, JSON.stringify(defs));
  }

  function loadItemMeta() { try { return JSON.parse(localStorage.getItem(ITEM_META_KEY) || '{}'); } catch { return {}; } }
  function saveItemMeta(m) { localStorage.setItem(ITEM_META_KEY, JSON.stringify(m)); }
  function getItemMetaEntry(module, rn) { return loadItemMeta()[`${module}:${rn}`] ?? { tags: [] }; }
  function saveItemMetaEntry(module, rn, entry) { const m = loadItemMeta(); m[`${module}:${rn}`] = entry; saveItemMeta(m); }

  function getSectionOrder(customSections) {
    const allIds = [...BUILTIN_IDS, ...customSections.map(s => s.id)];
    try {
      const saved = JSON.parse(localStorage.getItem(SECTION_ORDER_KEY) || '[]');
      const ordered = saved.filter(id => allIds.includes(id));
      allIds.forEach(id => { if (!ordered.includes(id)) ordered.push(id); });
      return ordered;
    } catch {
      return allIds;
    }
  }

  // ── Tab storage ────────────────────────────────────────────────────
  function loadTabs() {
    try {
      const raw = JSON.parse(localStorage.getItem(TABS_KEY) || 'null');
      if (Array.isArray(raw) && raw.length) return raw;
    } catch {}
    return null; // null = not yet migrated
  }

  function saveTabs(tabs) {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  }

  function getActiveTabId() {
    return localStorage.getItem(ACTIVE_TAB_KEY) || null;
  }

  function setActiveTabId(id) {
    localStorage.setItem(ACTIVE_TAB_KEY, id);
  }

  function getActiveTab(tabs) {
    const id = getActiveTabId();
    return tabs.find(t => t.id === id) ?? tabs[0];
  }

  function migrateToTabs() {
    const customSections = loadCustomSections();
    const existingOrder = getSectionOrder(customSections);
    const mainTab = { id: genId(), name: 'Main', sections: existingOrder };
    const tabs = [mainTab];
    saveTabs(tabs);
    setActiveTabId(mainTab.id);
    return tabs;
  }

  function genId() {
    return 'cs-' + Math.random().toString(36).slice(2, 9);
  }

  // ── Archive storage ────────────────────────────────────────────────
  function loadArchive() {
    try { return JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'); } catch { return []; }
  }
  function saveArchive(items) { localStorage.setItem(ARCHIVE_KEY, JSON.stringify(items)); }

  function archiveItem(item, sourceSectionId) {
    const archive = loadArchive();
    if (archive.some(a => a.module === item.module && a.recordNumber === item.recordNumber)) return;
    archive.unshift({ icon: item.icon, primary: item.primary, secondary: item.secondary, module: item.module, recordNumber: item.recordNumber, tags: item.tags || [], sourceSectionId, archivedAt: Date.now() });
    saveArchive(archive);
  }

  function removeFromArchive(module, recordNumber) {
    saveArchive(loadArchive().filter(a => !(a.module === module && a.recordNumber === recordNumber)));
  }

  function restoreFromArchive(module, recordNumber) {
    const archive = loadArchive();
    const entry = archive.find(a => a.module === module && a.recordNumber === recordNumber);
    if (!entry) return null;
    removeFromArchive(module, recordNumber);

    const sections = loadCustomSections();
    const target = sections.find(s => s.id === entry.sourceSectionId) ?? sections[0];
    if (!target) return null; // no custom sections — just unarchive

    const itemData = { icon: entry.icon, primary: entry.primary, secondary: entry.secondary, module: entry.module, recordNumber: entry.recordNumber, tags: entry.tags || [], sourceSectionId: null };
    dropRecordOnSection(target.id, itemData);
    return target.id;
  }

  // ── Record detail fetch & render ───────────────────────────────────
  // key -> { data: {module, record, items, avail}, fetchedAt }. Entries pre-populated
  // from a list response use fetchedAt: 0 - same shape, but falsy, so they read as
  // stale (a real fetch still happens) and callers can tell a list stub from a full
  // record with a truthiness check instead of probing two different shapes.
  const detailCache = new Map();
  const DETAIL_TTL  = 3 * 60 * 1000; // 3 minutes
  // Cache for agent-filtered sections: key → { items: [], fetchedAt: timestamp }
  const agentSectionCache = new Map();
  const AGENT_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

  const PREPS_SHEET_KEY   = 'rq-dashboard-preps-sheet-url';
  const PREPS_VIEW_KEY    = 'rq-dashboard-preps-view'; // 'list' | 'floor'
  const PREPS_CACHE_TTL   = 8 * 60 * 1000; // 8 minutes
  let prepsCache = null; // { groups: [{date, str, rows}], fetchedAt }

  // ── Persistent section cache (survives page reloads within same session) ──
  const SECTION_SS_PREFIX = 'rq-cache-section-';
  const PREPS_SS_KEY = 'rq-cache-preps';

  function getCachedSection(key) {
    if (agentSectionCache.has(key)) return agentSectionCache.get(key);
    try {
      const raw = sessionStorage.getItem(SECTION_SS_PREFIX + key);
      if (raw) { const p = JSON.parse(raw); agentSectionCache.set(key, p); return p; }
    } catch {}
    return null;
  }

  function setCachedSection(key, data) {
    agentSectionCache.set(key, data);
    try { sessionStorage.setItem(SECTION_SS_PREFIX + key, JSON.stringify(data)); } catch {}
  }

  function clearCachedSection(key) {
    agentSectionCache.delete(key);
    try { sessionStorage.removeItem(SECTION_SS_PREFIX + key); } catch {}
  }

  function getCachedPreps() {
    if (prepsCache) return prepsCache;
    try {
      const raw = sessionStorage.getItem(PREPS_SS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        p.rwData = new Map(p.rwData);
        p.groups = p.groups.map(g => ({ ...g, date: new Date(g.date) }));
        prepsCache = p;
        return prepsCache;
      }
    } catch {}
    return null;
  }

  function setCachedPreps(data) {
    prepsCache = data;
    try {
      sessionStorage.setItem(PREPS_SS_KEY, JSON.stringify({ ...data, rwData: [...data.rwData.entries()] }));
    } catch {}
  }

  function clearPrepsCache() {
    prepsCache = null;
    try { sessionStorage.removeItem(PREPS_SS_KEY); } catch {}
  }

  // Floor plan: each cell's label → grid position (1-based row/col in a 3×3 grid)
  // Col 1 (rooms) is handled separately as a single spanning wrapper — see renderPrepsFloorPlan.
  const PREP_ROOM_CELLS  = ['Rm 2', 'Rm 1']; // top-to-bottom order in col 1
  const PREP_FLOOR_CELLS = [
    { label: 'C', row: 1, col: 2 },
    { label: 'F', row: 1, col: 3 },
    { label: 'B', row: 2, col: 2 },
    { label: 'E', row: 2, col: 3 },
    { label: 'A', row: 3, col: 2 },
    { label: 'D', row: 3, col: 3 },
  ];

  function normalizeLocation(loc) {
    if (!loc) return '';
    const l = loc.trim().toLowerCase().replace(/\s+/g, ' ');
    if (l === 'rm 1' || l === 'room 1' || l === 'rm1' || l === 'room1') return 'Rm 1';
    if (l === 'rm 2' || l === 'room 2' || l === 'rm2' || l === 'room2') return 'Rm 2';
    return loc.trim().toUpperCase();
  }

  // In-flight requests, so several row features asking for the same record share one
  // fetch instead of racing. Rows ask more than once (the due badge and the date
  // range both need the record), and a card can hold 50 rows.
  const detailInFlight = new Map(); // key -> Promise

  function fetchRecordDetail(module, recordNumber, knownId = null) {
    const key = module + ':' + recordNumber;
    const cached = detailCache.get(key);
    if (cached && (Date.now() - cached.fetchedAt) < DETAIL_TTL) return Promise.resolve(cached.data);

    const pending = detailInFlight.get(key);
    if (pending) return pending;

    const fetchOpts = {
      headers: {
        'authorization': 'Bearer ' + sessionStorage.apiToken,
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      },
      credentials: 'include'
    };

    const idPromise = knownId ? Promise.resolve(knownId) : RQ.api.get_id_from_code(module, recordNumber);
    const result = idPromise.then(id => {
      if (!id) return null;
      const controller = window[module + 'Controller'];
      if (!controller?.apiurl) return null;

      const recordFetch = fetch(RW_URL + controller.apiurl + '/' + id, fetchOpts)
        .then(r => r.json()).catch(() => null);

      const idField = module + 'Id';
      const itemController = window[module + 'ItemController'];
      const itemsFetch = itemController?.apiurl
        ? fetch(RW_URL + itemController.apiurl + '?' + encodeURI(`filter={"Field":"${idField}","Op":"=","Value":"${id}"}&pagesize=500`), fetchOpts)
            .then(r => r.json()).then(r => r?.Items ?? []).catch(() => [])
        : Promise.resolve([]);

      // For RentalInventory, also fetch warehouse availability
      const warehouseId = JSON.parse(sessionStorage.getItem('userid') || '{}')?.warehouseid;
      const availFetch = (module === 'RentalInventory' && warehouseId)
        ? fetch(RW_URL + 'api/v1/inventorywarehouse?' + encodeURI(`filter={"Field":"InventoryId","Op":"=","Value":"${id}"}&pagesize=50`), fetchOpts)
            .then(r => r.json()).then(r => r?.Items ?? []).catch(() => [])
        : Promise.resolve([]);

      return Promise.all([recordFetch, itemsFetch, availFetch]).then(([record, items, warehouseRows]) => {
        // Find active warehouse row, fall back to first row
        const avail = warehouseRows.find(w => w.WarehouseId === warehouseId) ?? warehouseRows[0] ?? null;
        const detail = { module, record, items, avail };
        detailCache.set(key, { data: detail, fetchedAt: Date.now() });
        return detail;
      });
    });

    detailInFlight.set(key, result);
    return result.finally(() => detailInFlight.delete(key));
  }

  // ── Code 128B barcode generator ───────────────────────────────────
  // Patterns: 6-char strings of bar/space widths (alternating, starting with bar)
  // Symbols 0-105 map to Code 128B values; checksum and STOP appended automatically.
  const _C128_WIDTHS = '212222222122222221121223121322131222122213122312132212221213221312231212112232122132122231113222123122123221223211221132221231213212223112312131311222321122321221312212322112322211212123212321232121111323131123131321112313132113132311211313231113231311112133112331132131113123113321133121313121211331231131213113213311213131311123311321331121312113312311332111314111221411431111111224111422121124121421141122141221112214112412122114122411142112142211241211221114413111241112134111111242121142121241114212124112124211411212421112421211212141214121412121111143111341131141114113114311411113411311113141114131311141411131211412211214211232'.match(/.{6}/g);
  const _C128_STOP = [2,3,3,1,1,1,2];

  function generateBarcode128SVG(text, scale = 2, barHeight = 48) {
    const START_B = 104;
    let check = START_B;
    const codes = [START_B];
    for (let i = 0; i < text.length; i++) {
      const v = text.charCodeAt(i) - 32;
      if (v < 0 || v > 95) return null; // character not supported in Code 128B
      codes.push(v);
      check += v * (i + 1);
    }
    codes.push(check % 103);

    const bars = [];
    for (const c of codes) {
      _C128_WIDTHS[c].split('').forEach((w, i) => bars.push({ w: +w, isBar: i % 2 === 0 }));
    }
    _C128_STOP.forEach((w, i) => bars.push({ w, isBar: i % 2 === 0 }));

    const margin = 10;
    const totalW = bars.reduce((s, b) => s + b.w, 0);
    const svgW = totalW * scale + margin * 2;
    const svgH = barHeight + 16;

    let rects = '';
    let x = margin;
    for (const { w, isBar } of bars) {
      if (isBar) rects += `<rect x="${x}" y="0" width="${w * scale}" height="${barHeight}"/>`;
      x += w * scale;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" style="max-width:100%;display:block">
      <rect width="${svgW}" height="${svgH}" fill="white"/>
      <g fill="#000">${rects}</g>
      <text x="${svgW / 2}" y="${svgH - 3}" text-anchor="middle" font-family="monospace" font-size="11" fill="#000">${text}</text>
    </svg>`;
  }

  function addBarcodeSection(container, code) {
    if (!code) return;
    const wrap = el('div', 'padding:4px 14px 10px;border-top:1px solid #222;');
    const btn = el('div', 'cursor:pointer;color:#4a7a4a;font-size:11px;user-select:none;', '⊟ show barcode');
    let barcodeDiv = null;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!barcodeDiv) {
        barcodeDiv = el('div', 'margin-top:6px;background:white;padding:6px 8px;border-radius:3px;text-align:center;');
        const svg = generateBarcode128SVG(code);
        if (svg) barcodeDiv.innerHTML = svg;
        wrap.appendChild(barcodeDiv);
        btn.textContent = '⊟ hide barcode';
      } else if (barcodeDiv.style.display === 'none') {
        barcodeDiv.style.display = '';
        btn.textContent = '⊟ hide barcode';
      } else {
        barcodeDiv.style.display = 'none';
        btn.textContent = '⊟ show barcode';
      }
    });
    wrap.appendChild(btn);
    container.appendChild(wrap);
  }

  function attachDetailLinks(container) {
    container.querySelectorAll('[data-rq-module][data-rq-id]').forEach(span => {
      span.style.cssText += 'cursor:pointer;text-decoration:underline;color:#7aafdf;';
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        closePanel();
        RQ.api.open_form_tab(span.dataset.rqModule, span.dataset.rqId);
      });
    });
  }

  function addNotesSection(container, sectionId, module, recordNumber) {
    const wrap = el('div', 'padding:4px 14px 10px;border-top:1px solid #222;');
    const label = el('div', 'color:#555;font-size:10px;margin-bottom:4px;letter-spacing:0.05em;', 'NOTES');
    const textarea = document.createElement('textarea');
    textarea.style.cssText = `
      width:100%;box-sizing:border-box;background:#141414;color:#ccc;
      border:1px solid #333;border-radius:3px;padding:5px 7px;
      font-size:11px;font-family:inherit;resize:vertical;min-height:52px;outline:none;
    `;
    textarea.placeholder = 'Add a note...';

    const updateRowPreviews = (text) => {
      document.querySelectorAll(`[data-rq-notes-key="${module}:${recordNumber}"]`).forEach(row => {
        const p = row.querySelector('.rq-note-preview');
        if (p) { p.textContent = text; p.style.display = text ? '' : 'none'; }
      });
    };

    if (sectionId) {
      const sections = loadCustomSections();
      const item = sections.find(s => s.id === sectionId)?.items.find(i => i.module === module && i.recordNumber === recordNumber);
      if (item) textarea.value = item.notes || '';
      textarea.addEventListener('input', () => {
        const secs = loadCustomSections();
        const it = secs.find(s => s.id === sectionId)?.items.find(i => i.module === module && i.recordNumber === recordNumber);
        if (it) { it.notes = textarea.value; saveCustomSections(secs); }
        updateRowPreviews(textarea.value);
      });
    } else {
      const entry = getItemMetaEntry(module, recordNumber);
      textarea.value = entry.notes || '';
      textarea.addEventListener('input', () => {
        const e = getItemMetaEntry(module, recordNumber);
        e.notes = textarea.value;
        saveItemMetaEntry(module, recordNumber, e);
        updateRowPreviews(textarea.value);
      });
    }

    textarea.addEventListener('click', e => e.stopPropagation());
    textarea.addEventListener('dragstart', e => e.stopPropagation());
    wrap.append(label, textarea);
    container.appendChild(wrap);
  }

  function addEmailLinksSection(container, sectionId, module, recordNumber) {
    if (!sectionId) return;
    const wrap = el('div', 'padding:4px 14px 10px;border-top:1px solid #222;');
    const header = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;');
    const label = el('div', 'color:#555;font-size:10px;letter-spacing:0.05em;', 'EMAIL LINKS');
    header.appendChild(label);
    wrap.appendChild(header);

    const listEl = el('div', 'margin-bottom:6px;');

    const getItem = () => {
      const secs = loadCustomSections();
      return secs.find(s => s.id === sectionId)?.items.find(i => i.module === module && i.recordNumber === recordNumber);
    };

    const renderLinks = () => {
      listEl.innerHTML = '';
      const item = getItem();
      const links = item?.emailLinks || [];
      links.forEach((link, idx) => {
        const row = el('div', 'display:flex;align-items:center;gap:6px;padding:3px 0;');
        const icon = el('i', 'font-size:13px;color:#5a8fbf;flex-shrink:0;');
        icon.className = 'material-icons';
        icon.textContent = 'mail_outline';
        const linkEl = el('a', `
          flex:1;font-size:11px;color:#7aafdf;overflow:hidden;text-overflow:ellipsis;
          white-space:nowrap;cursor:pointer;text-decoration:none;min-width:0;
        `, link.label || link.url);
        linkEl.title = link.url;
        linkEl.href = link.url;
        linkEl.target = '_blank';
        linkEl.addEventListener('click', e => e.stopPropagation());
        const removeBtn = el('button', `
          background:none;border:none;color:#444;cursor:pointer;padding:0 2px;
          font-size:13px;line-height:1;flex-shrink:0;
        `, '×');
        removeBtn.title = 'Remove link';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const secs = loadCustomSections();
          const it = secs.find(s => s.id === sectionId)?.items.find(i => i.module === module && i.recordNumber === recordNumber);
          if (it) { it.emailLinks = (it.emailLinks || []).filter((_, i) => i !== idx); saveCustomSections(secs); }
          renderLinks();
        });
        row.append(icon, linkEl, removeBtn);
        listEl.appendChild(row);
      });
    };

    renderLinks();
    wrap.appendChild(listEl);

    // Add input row
    const addRow = el('div', 'display:flex;gap:5px;align-items:center;');
    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'Paste Outlook email URL…';
    urlInput.style.cssText = `
      flex:1;background:#141414;color:#ccc;border:1px solid #333;border-radius:3px;
      padding:4px 7px;font-size:11px;font-family:inherit;outline:none;min-width:0;
    `;
    urlInput.addEventListener('click', e => e.stopPropagation());
    urlInput.addEventListener('dragstart', e => e.stopPropagation());
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); e.stopPropagation(); });

    const addBtn = el('button', `
      background:#1a3a1a;border:1px solid #2a5a2a;color:#8ac;border-radius:3px;
      padding:3px 8px;font-size:11px;cursor:pointer;flex-shrink:0;white-space:nowrap;
    `, 'Add');
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = urlInput.value.trim();
      if (!url.startsWith('https://outlook.')) {
        urlInput.style.borderColor = '#a44';
        setTimeout(() => { urlInput.style.borderColor = '#333'; }, 1500);
        return;
      }
      const secs = loadCustomSections();
      const it = secs.find(s => s.id === sectionId)?.items.find(i => i.module === module && i.recordNumber === recordNumber);
      if (it) {
        if (!it.emailLinks) it.emailLinks = [];
        it.emailLinks.push({ url, label: '' });
        saveCustomSections(secs);
        urlInput.value = '';
        renderLinks();
      }
    });

    addRow.append(urlInput, addBtn);
    wrap.appendChild(addRow);
    container.appendChild(wrap);
  }

  function addAvailabilityCheck(container, inventoryId) {
    if (!inventoryId) return;
    const warehouseId = JSON.parse(sessionStorage.getItem('userid') || '{}')?.warehouseid;
    if (!warehouseId) return;

    const wrap = el('div', 'padding:4px 14px 10px;border-top:1px solid #222;');
    const label = el('div', 'color:#555;font-size:10px;margin-bottom:6px;letter-spacing:0.05em;', 'AVAILABILITY CHECK');

    const today = new Date().toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);

    const mkDateInput = (val) => {
      const inp = document.createElement('input');
      inp.type = 'date';
      inp.value = val;
      inp.style.cssText = 'background:#1e1e1e;border:1px solid #333;color:#ccc;padding:3px 5px;font-size:11px;border-radius:3px;flex:1;min-width:0;outline:none;';
      inp.addEventListener('click', e => e.stopPropagation());
      return inp;
    };
    const fromInput = mkDateInput(today);
    const toInput   = mkDateInput(nextWeek);

    const checkBtn = el('button', `
      background:#2a2a2a;border:1px solid #444;color:#aaa;
      padding:3px 10px;font-size:11px;border-radius:3px;cursor:pointer;flex-shrink:0;
    `, 'Check');
    checkBtn.addEventListener('mouseenter', () => checkBtn.style.color = '#fff');
    checkBtn.addEventListener('mouseleave', () => checkBtn.style.color = '#aaa');
    checkBtn.addEventListener('click', e => { e.stopPropagation(); runCheck(); });

    const inputRow = el('div', 'display:flex;gap:6px;align-items:center;');
    inputRow.append(fromInput, el('span', 'color:#444;font-size:11px;flex-shrink:0;', '→'), toInput, checkBtn);

    const resultsDiv = el('div', 'margin-top:8px;');

    function runCheck() {
      const fromDate = fromInput.value;
      const toDate   = toInput.value;
      if (!fromDate || !toDate || fromDate > toDate) return;
      resultsDiv.innerHTML = '<div style="color:#555;font-style:italic;font-size:11px;">Loading...</div>';

      fetch(RW_URL + 'api/v1/inventoryavailability/calendarandscheduledata', {
        method: 'POST',
        headers: {
          'authorization': 'Bearer ' + sessionStorage.apiToken,
          'content-type': 'application/json',
          'x-requested-with': 'XMLHttpRequest'
        },
        credentials: 'include',
        body: JSON.stringify({
          InventoryId: inventoryId, WarehouseId: [warehouseId], RegionId: '',
          FromDate: fromDate, ToDate: toDate,
          IncludeHours: false, ExcludeConsigned: false, ConsignedOnly: false
        })
      }).then(r => r.json()).then(data => {
        const dates  = data.Dates ?? [];
        const events = (data.InventoryAvailabilityScheduleEvents ?? [])
          .filter(e => !e.isWarehouseTotal && !e.isGrandTotal);
        const total  = data.InventoryData?.Total?.Owned ?? 0;

        resultsDiv.innerHTML = '';
        if (!dates.length) {
          resultsDiv.innerHTML = '<div style="color:#555;font-size:11px;">No data for this range.</div>';
          return;
        }

        const minAvail = Math.min(...dates.map(d => d.Available ?? 0));
        const color = minAvail === 0 ? '#e05555' : minAvail <= Math.max(1, total * 0.2) ? '#e09820' : '#4a9a4a';

        const summary = el('div', 'display:flex;align-items:baseline;gap:6px;margin-bottom:8px;');
        summary.innerHTML =
          `<span style="color:#555;font-size:11px;">Min available:</span>` +
          `<span style="color:${color};font-weight:700;font-size:15px;">${minAvail}</span>` +
          `<span style="color:#444;font-size:11px;">/ ${total}</span>`;
        resultsDiv.appendChild(summary);

        if (events.length) {
          const bookingLabel = el('div', 'color:#555;font-size:10px;letter-spacing:0.05em;margin-bottom:4px;', 'BOOKINGS');
          resultsDiv.appendChild(bookingLabel);
          events.forEach(ev => {
            const row = el('div', 'display:flex;gap:8px;margin-bottom:5px;font-size:11px;line-height:1.4;');
            const qty = el('span', `color:${ev.late ? '#e07820' : '#6a9a6a'};flex-shrink:0;font-weight:600;`, `×${ev.total}`);
            const info = el('div', 'flex:1;overflow:hidden;');
            if (ev.orderNumber) {
              const link = el('span', 'color:#7aafdf;cursor:pointer;', ev.orderNumber);
              link.addEventListener('click', e => {
                e.stopPropagation();
                if (ev.orderId) { closePanel(); RQ.api.open_form_tab('Order', ev.orderId); }
              });
              const desc = ev.orderDescription ? el('span', 'color:#666;', ` · ${ev.orderDescription}`) : null;
              info.append(link);
              if (desc) info.append(desc);
            }
            const dates = el('div', 'color:#444;font-size:10px;',
              `${ev.start?.slice(0,10)} → ${ev.late ? 'LATE' : ev.end?.slice(0,10)}`);
            info.appendChild(dates);
            row.append(qty, info);
            resultsDiv.appendChild(row);
          });
        } else {
          resultsDiv.appendChild(el('div', 'color:#555;font-size:11px;', 'No bookings in this range.'));
        }
      }).catch(() => {
        resultsDiv.innerHTML = '<div style="color:#e05555;font-size:11px;">Failed to load availability.</div>';
      });
    }

    wrap.append(label, inputRow, resultsDiv);
    container.appendChild(wrap);
  }

  function buildDetailHTML(data) {
    if (!data?.record) return '<div style="padding:6px 14px 8px;color:#555;font-style:italic;font-size:11px;">No details available</div>';
    const r = data.record;
    const items = data.items ?? [];
    const avail = data.avail;

    const fmtDate = v => v ? new Date(v).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
    const fmtMoney = v => v != null ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;

    const fields = [
      // Orders / Quotes
      ['Customer',   r.Customer    || r.CustomerName],
      ['Vendor',     r.Vendor],
      ['Deal',       r.Deal        || r.DealName],
      ['Status',     r.Status      || r.OrderStatus],
      ['Est. Start', fmtDate(r.EstimatedStartDate)],
      ['Est. Stop',  fmtDate(r.EstimatedStopDate)],
      ['PO',         r.PoNo        || r.PurchaseOrderNo],
      ['Amount',     fmtMoney(r.GrandTotal ?? r.Total ?? r.OrderTotal)],
      ['Discount',   (() => {
        if (!r.DiscountTotal) return null;
        const gross = (r.SubTotal ?? 0) + r.DiscountTotal;
        const pct = gross > 0 ? ` (${(r.DiscountTotal / gross * 100).toFixed(1)}%)` : '';
        return fmtMoney(r.DiscountTotal) + pct;
      })()],
      ['Agent',      r.Agent       || r.AgentName],
      ['Items',      items.length ? `${items.length}${items[0]?.Description ? ' · ' + items[0].Description : ''}` : null],
      // RentalInventory
      ['Category',   r.CategoryName],
      ['Daily Rate', avail ? fmtMoney(avail.DailyRate) : null],
      ['Weekly Rate',avail ? fmtMoney(avail.WeeklyRate) : null],
      // Customer
      ['Email',      r.Email       || r.EmailAddress],
      ['Phone',      r.Phone       || r.PhoneNo       || r.PhoneNumber],
      ['Address',    r.Address     || r.Address1],
      ['City',       r.City],
      ['State',      r.State],
      // Asset
      ['ICode',      r.ICode?.replace(/-+$/, '')],
      ['Serial No.', r.SerialNo],
      ['Purchased',  fmtDate(r.PurchaseDate)],
      ['Cost',       fmtMoney(r.PurchaseCost)],
      ['Status',     r.AssetStatus],
    ].filter(([, v]) => v != null && v !== '');

    const DETAIL_LINKS = {
      'Customer': { module: 'Customer', idField: 'CustomerId' },
      'Deal':     { module: 'Deal',     idField: 'DealId'     },
    };
    const rows = fields.map(([label, value]) => {
      const link = DETAIL_LINKS[label];
      const id = link ? r[link.idField] : null;
      const linkAttrs = id ? ` data-rq-module="${link.module}" data-rq-id="${id}"` : '';
      return `<span style="color:#555;white-space:nowrap;">${label}</span>` +
             `<span style="color:#ddd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${value}"${linkAttrs}>${value}</span>`;
    }).join('');

    // Availability block for RentalInventory
    let availHTML = '';
    if (avail) {
      const whLabel = avail.WarehouseCode ? `<span style="color:#555;font-size:10px;"> (${avail.WarehouseCode})</span>` : '';
      const dot = (color, val, label) => val > 0
        ? `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px;">
            <span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <span style="color:#ccc;">${val} ${label}</span>
           </span>`
        : '';
      const availNum = (avail.Qty ?? 0) - (avail.QtyOut ?? 0) - (avail.QtyStaged ?? 0);
      availHTML = `
        <div style="grid-column:1/-1;margin-top:4px;padding-top:4px;border-top:1px solid #2a2a2a;">
          <div style="color:#666;margin-bottom:3px;">Availability${whLabel}</div>
          <div style="display:flex;flex-wrap:wrap;gap:2px 0;font-size:11px;line-height:1.8;">
            ${dot('#4a9a4a', availNum > 0 ? availNum : 0, 'Avail')}
            ${dot('#e07820', avail.QtyOut, 'Out')}
            ${dot('#c87ae0', avail.QtyStaged, 'Staged')}
            ${dot('#e04040', avail.QtyInRepair, 'Repair')}
            ${dot('#888', avail.QtyQcRequired, 'QC Req')}
            <span style="color:#555;margin-left:auto;">Total: ${avail.Qty ?? 0}</span>
          </div>
        </div>`;
    }

    return `<div style="padding:6px 14px 10px;background:#181818;border-top:1px solid #2e2e2e;">
      <div style="display:grid;grid-template-columns:75px 1fr;gap:3px 8px;font-size:11px;line-height:1.6;">
        ${rows}${availHTML}
      </div>
    </div>`;
  }

  const SNOOZE_KEY = 'rq-dashboard-snooze';

  function loadSnooze() {
    try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; }
  }
  function saveSnooze(data) { localStorage.setItem(SNOOZE_KEY, JSON.stringify(data)); }

  function isSnoozed(module, recordNumber) {
    const key = module + ':' + recordNumber;
    const until = loadSnooze()[key];
    if (!until) return false;
    if (until === 'forever') return true;
    return Date.now() < until;
  }

  function snooze(module, recordNumber, days) {
    const key = module + ':' + recordNumber;
    const data = loadSnooze();
    data[key] = days === null ? 'forever' : Date.now() + days * 864e5;
    saveSnooze(data);
  }

  function unsnooze(module, recordNumber) {
    const key = module + ':' + recordNumber;
    const data = loadSnooze();
    delete data[key];
    saveSnooze(data);
  }

  function openSnoozeMenu(anchor, module, recordNumber, onUpdate) {
    document.getElementById('rq-snooze-menu')?.remove();
    const menu = el('div', `
      position:fixed;z-index:100001;background:#252525;border:1px solid #444;
      border-radius:5px;padding:4px 0;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,0.5);
      min-width:120px;
    `);
    menu.id = 'rq-snooze-menu';

    const snoozed = isSnoozed(module, recordNumber);
    const options = snoozed
      ? [['Unsnooze', () => { unsnooze(module, recordNumber); onUpdate(); }]]
      : [
          ['Snooze 1 day',  () => { snooze(module, recordNumber, 1);    onUpdate(); }],
          ['Snooze 3 days', () => { snooze(module, recordNumber, 3);    onUpdate(); }],
          ['Snooze 1 week', () => { snooze(module, recordNumber, 7);    onUpdate(); }],
          ['Hide forever',  () => { snooze(module, recordNumber, null); onUpdate(); }],
        ];

    for (const [label, action] of options) {
      const item = el('div', 'padding:5px 14px;cursor:pointer;color:#ccc;white-space:nowrap;', label);
      item.addEventListener('mouseenter', () => item.style.background = '#333');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); action(); });
      menu.appendChild(item);
    }

    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
    menu.style.top  = (r.bottom + 4) + 'px';

    const panelEl = document.getElementById('rq-dashboard');
    menu.addEventListener('mouseenter', () => panelEl?._cancelClose?.());
    menu.addEventListener('mouseleave', (e) => {
      if (!e.relatedTarget?.closest?.('#rq-dashboard, #rq-snooze-menu')) panelEl?._scheduleClose?.();
    });

    closeOnOutsideClick(menu);
  }

  // ── Personal status badge ──────────────────────────────────────────────────
  const STATUS_STORAGE_KEY   = 'rq-record-status';
  const WORKFLOW_STORAGE_KEY = 'rq-status-workflows';
  const STATUS_PALETTE = ['#e05555','#e07820','#d4b44a','#4a9a4a','#3a9a8a','#4a7aaa','#8a5aaa','#c05580'];
  const DEFAULT_WORKFLOW = {
    id: 'default', name: 'Default',
    statuses: [
      { label: 'Quoted',           color: '#4a7aaa' },
      { label: 'Confirmed',        color: '#3a9a8a' },
      { label: 'Ready for Pickup', color: '#e07820' },
      { label: 'Out',              color: '#4a9a4a' },
      { label: 'Returned',         color: '#777' },
    ]
  };

  function loadWorkflows() {
    try { return JSON.parse(localStorage.getItem(WORKFLOW_STORAGE_KEY) || 'null') ?? [DEFAULT_WORKFLOW]; }
    catch { return [DEFAULT_WORKFLOW]; }
  }
  function saveWorkflows(wf) { localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(wf)); }
  function loadRecordStatuses() {
    try { return JSON.parse(localStorage.getItem(STATUS_STORAGE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveRecordStatuses(d) { localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(d)); }
  function getRecordStatus(module, rn) { return loadRecordStatuses()[`${module}:${rn}`] ?? null; }
  function setRecordStatus(module, rn, val) {
    const d = loadRecordStatuses();
    if (val == null) delete d[`${module}:${rn}`];
    else d[`${module}:${rn}`] = val;
    saveRecordStatuses(d);
  }
  function genWorkflowId() { return Math.random().toString(36).slice(2, 9); }

  function showWorkflowPicker(anchorEl, module, rn, onPicked) {
    document.getElementById('rq-wf-picker')?.remove();
    const workflows = loadWorkflows();
    const menu = el('div', `
      position:fixed;z-index:200000;background:#242424;border:1px solid #444;
      border-radius:6px;padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,.6);
      min-width:150px;font-size:12px;
    `);
    menu.id = 'rq-wf-picker';
    workflows.forEach(wf => {
      const item = el('div', 'padding:6px 14px;cursor:pointer;color:#e0e0e0;');
      item.textContent = wf.name;
      item.addEventListener('mouseenter', () => item.style.background = '#333');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const firstStatus = wf.statuses[0]?.label ?? null;
        setRecordStatus(module, rn, firstStatus ? { workflowId: wf.id, status: firstStatus } : null);
        menu.remove();
        onPicked();
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const panelEl = document.getElementById('rq-dashboard');
    menu.addEventListener('mouseenter', () => panelEl?._cancelClose?.());
    menu.addEventListener('mouseleave', (ev) => {
      if (!ev.relatedTarget?.closest?.('#rq-dashboard, #rq-wf-picker, #rq-status-ctx')) panelEl?._scheduleClose?.();
    });
    const r = anchorEl.getBoundingClientRect();
    menu.style.left = Math.min(r.left, window.innerWidth - 170) + 'px';
    menu.style.top  = Math.min(r.bottom + 4, window.innerHeight - 150) + 'px';
    closeOnOutsideClick(menu);
  }

  function showWorkflowEditor() {
    document.getElementById('rq-wf-editor')?.remove();

    const overlay = el('div', `
      position:fixed;inset:0;z-index:300000;background:rgba(0,0,0,.55);
      display:flex;align-items:center;justify-content:center;
    `);
    overlay.id = 'rq-wf-editor';

    const panel = el('div', `
      background:#242424;border:1px solid #444;border-radius:10px;
      box-shadow:0 8px 32px rgba(0,0,0,.7);width:540px;max-height:80vh;
      display:flex;flex-direction:column;overflow:hidden;color:#e0e0e0;font-size:13px;
    `);

    // Header
    const hdr = el('div', `
      padding:14px 18px 10px;border-bottom:1px solid #333;
      display:flex;align-items:center;justify-content:space-between;flex-shrink:0;
    `);
    const hdrTitle = el('div', 'font-size:14px;font-weight:600;', 'Status Workflows');
    const closeBtn = el('div', 'cursor:pointer;color:#888;font-size:18px;line-height:1;', '✕');
    closeBtn.addEventListener('click', () => overlay.remove());
    hdr.append(hdrTitle, closeBtn);

    // Body: two columns
    const body = el('div', 'display:flex;flex:1;overflow:hidden;');

    // Left: workflow list
    const leftCol = el('div', `
      width:170px;flex-shrink:0;border-right:1px solid #333;
      display:flex;flex-direction:column;overflow:hidden;
    `);
    const leftList = el('div', 'flex:1;overflow-y:auto;padding:8px 0;');
    const addWfBtn = el('div', `
      padding:8px 14px;cursor:pointer;color:#4a7aaa;font-size:12px;
      border-top:1px solid #333;flex-shrink:0;
    `);
    addWfBtn.textContent = '+ Add workflow';
    addWfBtn.addEventListener('mouseenter', () => addWfBtn.style.background = '#2e2e2e');
    addWfBtn.addEventListener('mouseleave', () => addWfBtn.style.background = '');
    leftCol.append(leftList, addWfBtn);

    // Right: status list for selected workflow
    const rightCol = el('div', 'flex:1;display:flex;flex-direction:column;overflow:hidden;');
    const rightHdr = el('div', 'padding:10px 14px 6px;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.08em;flex-shrink:0;', 'Select a workflow');
    const rightList = el('div', 'flex:1;overflow-y:auto;padding:4px 0;');
    const addStBtn = el('div', `
      padding:8px 14px;cursor:pointer;color:#4a7aaa;font-size:12px;
      border-top:1px solid #333;flex-shrink:0;display:none;
    `);
    addStBtn.textContent = '+ Add status';
    addStBtn.addEventListener('mouseenter', () => addStBtn.style.background = '#2e2e2e');
    addStBtn.addEventListener('mouseleave', () => addStBtn.style.background = '');
    rightCol.append(rightHdr, rightList, addStBtn);
    body.append(leftCol, rightCol);

    let selectedWfId = null;

    function renderLeftList() {
      leftList.innerHTML = '';
      const workflows = loadWorkflows();
      workflows.forEach(wf => {
        const row = el('div', `
          padding:6px 10px 6px 14px;cursor:pointer;display:flex;align-items:center;gap:6px;
          ${wf.id === selectedWfId ? 'background:#2e2e2e;' : ''}
        `);
        const nameInput = el('input', `
          flex:1;background:transparent;border:none;outline:none;color:#e0e0e0;
          font-size:12px;cursor:pointer;padding:0;
        `);
        nameInput.value = wf.name;
        nameInput.addEventListener('focus', () => { nameInput.style.background = '#1a1a1a'; nameInput.style.borderRadius = '3px'; nameInput.style.padding = '1px 4px'; });
        nameInput.addEventListener('blur', () => {
          nameInput.style.background = ''; nameInput.style.padding = '0';
          const wfs = loadWorkflows();
          const w = wfs.find(x => x.id === wf.id);
          if (w && nameInput.value.trim()) { w.name = nameInput.value.trim(); saveWorkflows(wfs); }
        });
        nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
        nameInput.addEventListener('mousedown', (e) => e.stopPropagation());

        const delBtn = el('div', 'color:#666;cursor:pointer;font-size:11px;flex-shrink:0;padding:2px;', '✕');
        delBtn.title = 'Delete workflow';
        delBtn.addEventListener('mouseenter', () => delBtn.style.color = '#e05555');
        delBtn.addEventListener('mouseleave', () => delBtn.style.color = '#666');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wfs = loadWorkflows();
          if (wfs.length <= 1) return; // keep at least one
          saveWorkflows(wfs.filter(x => x.id !== wf.id));
          if (selectedWfId === wf.id) { selectedWfId = null; renderRightList(); }
          renderLeftList();
        });

        row.append(nameInput, delBtn);
        row.addEventListener('mouseenter', () => { if (wf.id !== selectedWfId) row.style.background = '#2a2a2a'; });
        row.addEventListener('mouseleave', () => { if (wf.id !== selectedWfId) row.style.background = ''; });
        row.addEventListener('click', () => {
          selectedWfId = wf.id;
          renderLeftList();
          renderRightList();
        });
        leftList.appendChild(row);
      });
    }

    function renderRightList() {
      rightList.innerHTML = '';
      const workflows = loadWorkflows();
      const wf = workflows.find(x => x.id === selectedWfId);
      if (!wf) {
        rightHdr.textContent = 'Select a workflow';
        addStBtn.style.display = 'none';
        return;
      }
      rightHdr.textContent = wf.name;
      addStBtn.style.display = '';

      let dragSrc = null;

      wf.statuses.forEach((st, idx) => {
        const row = el('div', `
          padding:5px 10px 5px 14px;display:flex;align-items:center;gap:8px;
          cursor:grab;
        `);
        row.draggable = true;

        // Drag handle indicator
        const handle = el('div', 'color:#444;font-size:12px;flex-shrink:0;user-select:none;', '⠿');

        // Color swatch — click cycles through palette
        const swatch = el('div', `
          width:14px;height:14px;border-radius:50%;flex-shrink:0;cursor:pointer;
          background:${st.color};border:2px solid #555;box-sizing:border-box;
        `);
        swatch.title = 'Click to change color';
        swatch.addEventListener('click', (e) => {
          e.stopPropagation();
          const curIdx = STATUS_PALETTE.indexOf(st.color);
          st.color = STATUS_PALETTE[(curIdx + 1) % STATUS_PALETTE.length];
          swatch.style.background = st.color;
          const wfs = loadWorkflows();
          const w = wfs.find(x => x.id === selectedWfId);
          if (w) { w.statuses[idx].color = st.color; saveWorkflows(wfs); }
        });

        const labelInput = el('input', `
          flex:1;background:#1a1a1a;border:1px solid #383838;border-radius:3px;
          color:#e0e0e0;font-size:12px;padding:3px 6px;outline:none;
        `);
        labelInput.value = st.label;
        labelInput.addEventListener('blur', () => {
          const wfs = loadWorkflows();
          const w = wfs.find(x => x.id === selectedWfId);
          if (w && labelInput.value.trim()) { w.statuses[idx].label = labelInput.value.trim(); saveWorkflows(wfs); }
        });
        labelInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') labelInput.blur(); });
        labelInput.addEventListener('mousedown', (e) => e.stopPropagation());

        const delBtn = el('div', 'color:#666;cursor:pointer;font-size:11px;flex-shrink:0;padding:2px;', '✕');
        delBtn.addEventListener('mouseenter', () => delBtn.style.color = '#e05555');
        delBtn.addEventListener('mouseleave', () => delBtn.style.color = '#666');
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wfs = loadWorkflows();
          const w = wfs.find(x => x.id === selectedWfId);
          if (w && w.statuses.length > 1) { w.statuses.splice(idx, 1); saveWorkflows(wfs); renderRightList(); }
        });

        row.addEventListener('dragstart', (e) => { dragSrc = idx; e.dataTransfer.effectAllowed = 'move'; row.style.opacity = '.4'; });
        row.addEventListener('dragend', () => { row.style.opacity = ''; dragSrc = null; });
        row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragSrc === null || dragSrc === idx) return;
          const wfs = loadWorkflows();
          const w = wfs.find(x => x.id === selectedWfId);
          if (!w) return;
          const [moved] = w.statuses.splice(dragSrc, 1);
          w.statuses.splice(idx, 0, moved);
          saveWorkflows(wfs);
          renderRightList();
        });

        row.addEventListener('mouseenter', () => row.style.background = '#2a2a2a');
        row.addEventListener('mouseleave', () => row.style.background = '');
        row.append(handle, swatch, labelInput, delBtn);
        rightList.appendChild(row);
      });
    }

    addWfBtn.addEventListener('click', () => {
      const wfs = loadWorkflows();
      const newWf = { id: genWorkflowId(), name: 'New Workflow', statuses: [{ label: 'Step 1', color: STATUS_PALETTE[0] }] };
      wfs.push(newWf);
      saveWorkflows(wfs);
      selectedWfId = newWf.id;
      renderLeftList();
      renderRightList();
      // Focus the new workflow's name input
      setTimeout(() => leftList.lastElementChild?.querySelector('input')?.focus(), 0);
    });

    addStBtn.addEventListener('click', () => {
      const wfs = loadWorkflows();
      const w = wfs.find(x => x.id === selectedWfId);
      if (!w) return;
      w.statuses.push({ label: 'New Status', color: STATUS_PALETTE[w.statuses.length % STATUS_PALETTE.length] });
      saveWorkflows(wfs);
      renderRightList();
      setTimeout(() => rightList.lastElementChild?.querySelector('input')?.focus(), 0);
    });

    // Select first workflow by default
    const firstWf = loadWorkflows()[0];
    if (firstWf) { selectedWfId = firstWf.id; }

    renderLeftList();
    renderRightList();

    panel.append(hdr, body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  // ── RentalWorks status badge ───────────────────────────────────────────────
  const RW_STATUS_COLORS = {
    'OPEN':      '#2a5a7a',
    'QUOTE':     '#5a4a8a',
    'RESERVED':  '#7a5a10',
    'CONFIRMED': '#1a6a2a',
    'PICKED':    '#1a6a5a',
    'OUT':       '#7a3a10',
    'RETURNED':  '#1a5a6a',
    'ORDERED':   '#4a2a7a',
    'RECEIVED':  '#1a6a2a',
    'EXPIRED':   '#6a1a1a',
    'CONVERTED': '#1a6a2a',
  };

  function rwStatusColor(status) {
    if (RW_STATUS_COLORS[status]) return RW_STATUS_COLORS[status];
    let h = 0;
    for (const c of status) h = (h * 31 + c.charCodeAt(0)) & 0xffffff;
    return `hsl(${h % 360}, 35%, 32%)`;
  }

  function attachRWStatusBadge(row, module, rn) {
    if (!['Order', 'Quote', 'PurchaseOrder'].includes(module) || !rn) return;

    const badge = el('div', `
      font-size:10px;font-weight:700;letter-spacing:.04em;
      padding:1px 7px;border-radius:9px;
      user-select:none;flex-shrink:0;white-space:nowrap;display:none;
    `);

    function render(status) {
      if (!status) return;
      const color = rwStatusColor(status);
      badge.textContent = status;
      badge.title = 'RentalWorks status: ' + status;
      badge.style.background = color;
      badge.style.color = '#fff';
      badge.style.border = `1px solid ${color}`;
      badge.style.display = 'inline-block';
    }

    const cached = detailCache.get(module + ':' + rn);
    const record = cached?.data?.record;
    if (record) {
      render(record.Status ?? record.OrderStatus);
    } else {
      fetchRecordDetail(module, rn).then(data => render(data?.record?.Status ?? data?.record?.OrderStatus));
    }

    row.appendChild(badge);
  }
  // ── End RentalWorks status badge ───────────────────────────────────────────

  function attachDueBadge(row, module, recordNumber, insertBeforeEl = null, cardId = null) {
    // Only relevant for modules with Est. Stop
    const HAS_STOP = ['Order', 'Quote', 'Contract', 'Deal', 'Invoice', 'PurchaseOrder'];
    if (!HAS_STOP.includes(module)) return;

    const badge = el('div', `
      font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;
      flex-shrink:0;margin-top:2px;display:none;cursor:pointer;
    `);
    badge.className = 'rq-due-badge';
    badge.title = 'Click to snooze';

    function isSectionHiding() {
      const id = cardId || row.closest('[id^="rq-card-"]')?.id.replace('rq-card-', '');
      return id ? !!loadBadgeHide()[id] : false;
    }

    function applyBadge(stopDateStr) {
      if (!stopDateStr) return;
      if (isSnoozed(module, recordNumber)) {
        badge.textContent = '·';
        badge.style.background = 'transparent';
        badge.style.color = '#444';
        badge.dataset.rqDueVisible = '1';
        badge.style.display = isSectionHiding() ? 'none' : 'inline-block';
        badge.title = 'Snoozed — click to unsnooze';
        return;
      }
      badge.title = 'Click to snooze';
      const stopDate = stopDateStr.slice(0, 10); // 'YYYY-MM-DD'
      const todayDate = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD' in local time
      const stop = new Date(stopDate + 'T00:00:00');
      const today = new Date(todayDate + 'T00:00:00');
      const days = Math.round((stop - today) / 864e5);
      if (days > 30) return;
      if (days < 0) {
        badge.textContent = `${Math.abs(days)}d overdue`;
        badge.style.background = '#4a1a1a';
        badge.style.color = '#e05555';
      } else if (days === 0) {
        badge.textContent = 'due today';
        badge.style.background = '#4a3a1a';
        badge.style.color = '#e09820';
      } else {
        badge.textContent = `${days}d left`;
        badge.style.background = days <= 3 ? '#4a2a1a' : '#1e2e1e';
        badge.style.color = days <= 3 ? '#e07820' : '#6a9a6a';
      }
      badge.dataset.rqDueVisible = '1';
      badge.style.display = isSectionHiding() ? 'none' : 'inline-block';
    }

    const effectiveId = cardId || row.closest('[id^="rq-card-"]')?.id.replace('rq-card-', '');
    const dateField = (effectiveId === 'myquotes' && localStorage.getItem(MY_QUOTES_DUE_KEY) === 'start')
      ? 'EstimatedStartDate' : 'EstimatedStopDate';

    let stopDateStr = null;
    const key = module + ':' + recordNumber;
    const cached = detailCache.get(key);
    const cachedRecord = cached?.data?.record;
    if (cached?.fetchedAt || cachedRecord?.[dateField] !== undefined) {
      // A full record (trusted even if the field is absent), or a list stub that
      // happens to carry the date already.
      stopDateStr = cachedRecord?.[dateField];
      applyBadge(stopDateStr);
    } else {
      // No cache or pre-populated list item lacks the date field — fetch full detail
      fetchRecordDetail(module, recordNumber).then(data => {
        stopDateStr = data?.record?.[dateField];
        applyBadge(stopDateStr);
      });
    }

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      openSnoozeMenu(badge, module, recordNumber, () => applyBadge(stopDateStr));
    });

    if (insertBeforeEl) row.insertBefore(badge, insertBeforeEl);
    else row.appendChild(badge);
  }

  function attachExpandButton(row, module, recordNumber, primaryEl, sectionId = null, knownId = null) {
    let expanded = false;
    let detailDiv = null;

    const btn = { click: toggle };
    function toggle() {
      expanded = !expanded;

      if (primaryEl) {
        primaryEl.style.whiteSpace = expanded ? 'normal' : 'nowrap';
        primaryEl.style.overflow  = expanded ? 'visible' : 'hidden';
      }

      if (expanded) {
        const key = module + ':' + recordNumber;
        const renderDetail = data => {
          if (!detailDiv || !data) return;
          detailDiv.innerHTML = buildDetailHTML(data);
          attachDetailLinks(detailDiv);
          addBarcodeSection(detailDiv, recordNumber);
          addNotesSection(detailDiv, sectionId, module, recordNumber);
          addEmailLinksSection(detailDiv, sectionId, module, recordNumber);
          if (module === 'RentalInventory') addAvailabilityCheck(detailDiv, data?.record?.InventoryId);
        };
        if (!detailDiv) {
          detailDiv = el('div', '');
          detailDiv.innerHTML = '<div style="padding:6px 14px 8px;color:#555;font-style:italic;font-size:11px;">Loading...</div>';
          row.after(detailDiv);
          fetchRecordDetail(module, recordNumber, knownId).then(renderDetail);
        } else {
          detailDiv.style.display = '';
          // Silently refresh if cache has expired
          const cached = detailCache.get(key);
          if (!cached || (Date.now() - cached.fetchedAt) >= DETAIL_TTL) {
            detailCache.delete(key);
            fetchRecordDetail(module, recordNumber, knownId).then(renderDetail);
          }
        }
      } else if (detailDiv) {
        detailDiv.style.display = 'none';
      }
    }

    return btn;
  }

  // ── Panel shell ────────────────────────────────────────────────────
  function buildPanel() {
    if (!document.getElementById('rq-toast-style')) {
      const style = document.createElement('style');
      style.id = 'rq-toast-style';
      style.textContent = [
        '@keyframes rq-fadein { from { opacity:0; transform:translateX(-50%) translateY(6px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }',
        '.rq-cfg-bar { display:flex !important; align-items:center; gap:8px; padding:6px 14px 8px; border-bottom:1px solid #222; }',
        '.rq-cfg-bar.rq-cfg-hidden { display:none !important; }',
        '.rq-cfg-bar .rq-cfg-input-wrap { flex:1 !important; min-width:0; overflow:hidden; }',
        '.rq-cfg-bar .rq-cfg-input-wrap input { width:100%; box-sizing:border-box; min-width:0; }',
      ].join('\n');
      document.head.appendChild(style);
    }

    const overlay = el('div', `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.3);
      z-index: 99998;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    `);
    overlay.id = 'rq-dashboard-overlay';

    const panel = el('div', `
      position: fixed; top: 0; right: 0;
      width: 575px; height: 100vh;
      background: #141414;
      border-left: 1px solid #3a3a3a;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.25s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #e8e8e8;
    `);
    panel.id = 'rq-dashboard';

    // Header
    const header = el('div', `
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #2e2e2e;
      flex-shrink: 0;
    `);
    const title = el('div', 'font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: #fff;', 'DASHBOARD');
    const closeBtn = el('div', `
      cursor: pointer; color: #888; font-size: 18px; line-height: 1;
      padding: 4px 8px; border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    `, '✕');
    closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; closeBtn.style.background = '#333'; });
    closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#888'; closeBtn.style.background = ''; });
    closeBtn.addEventListener('click', closePanel);
    header.append(title, closeBtn);

    // Search bar
    const searchWrap = el('div', `
      padding: 12px 20px;
      border-bottom: 1px solid #333;
      flex-shrink: 0;
    `);
    const searchRow = el('div', 'position: relative;');
    const searchInput = el('input', `
      width: 100%; box-sizing: border-box;
      background: #1e1e1e; border: 1px solid #444;
      border-radius: 6px; color: #f0f0f0;
      padding: 8px 52px 8px 12px; font-size: 13px;
      outline: none;
    `);
    searchInput.placeholder = 'Search orders, quotes, inventory...';
    searchInput.id = 'rq-dashboard-search';

    const historyBtn = el('i', `
      position: absolute; right: 30px; top: 50%; transform: translateY(-50%);
      font-size: 15px; color: #555; cursor: pointer; line-height: 1;
      transition: color 0.15s;
    `);
    historyBtn.className = 'material-icons';
    historyBtn.textContent = 'history';
    historyBtn.title = 'Search history';
    historyBtn.addEventListener('mouseenter', () => historyBtn.style.color = '#aaa');
    historyBtn.addEventListener('mouseleave', () => historyBtn.style.color = searchResults._showingHistory ? '#e0e0e0' : '#555');
    historyBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (searchResults._showingHistory) {
        searchResults._showingHistory = false;
        historyBtn.style.color = '#555';
        if (searchInput.value.trim()) {
          appendRecordResults(searchInput.value.trim(), searchResults);
        } else {
          searchResults.style.display = 'none';
        }
      } else {
        searchResults._showingHistory = true;
        historyBtn.style.color = '#e0e0e0';
        clearTimeout(searchTimeout);
        showSearchHistory();
      }
    });

    const clearBtn = el('div', `
      position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
      color: #555; cursor: pointer; font-size: 14px; line-height: 1;
      padding: 2px 4px; border-radius: 3px;
      display: none;
      transition: color 0.15s;
    `, '✕');
    clearBtn.addEventListener('mouseenter', () => clearBtn.style.color = '#aaa');
    clearBtn.addEventListener('mouseleave', () => clearBtn.style.color = '#555');
    clearBtn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't blur the input
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      clearBtn.style.display = 'none';
    });

    searchInput.addEventListener('input', () => {
      clearBtn.style.display = searchInput.value ? 'block' : 'none';
      searchResults._showingHistory = false;
      historyBtn.style.color = '#555';
    });

    searchRow.append(searchInput, historyBtn, clearBtn);
    searchWrap.appendChild(searchRow);

    // Wrap header + search so searchResults can be absolutely positioned below them
    const topSection = el('div', 'position: relative; flex-shrink: 0;');
    topSection.append(header, searchWrap);

    const searchResults = el('div', `
      position: absolute;
      left: 0; right: 0;
      top: 100%;
      z-index: 10;
      background: #141414;
      border-bottom: 1px solid #333;
      padding: 4px 8px 8px;
      max-height: 55vh;
      overflow-y: auto;
      display: none;
    `);
    searchResults.id = 'rq-dashboard-search-results';
    // Prevent input blur when clicking anything inside the results dropdown
    searchResults.addEventListener('mousedown', (e) => e.preventDefault());
    topSection.appendChild(searchResults);

    const SEARCH_HISTORY_KEY = 'rq-dashboard-search-history';
    const loadSearchHistory = () => { try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); } catch { return []; } };
    const saveSearchHistory = (h) => localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h));
    const pushSearchHistory = (q) => {
      const h = loadSearchHistory().filter(x => x !== q);
      h.unshift(q);
      saveSearchHistory(h.slice(0, 15));
    };

    function showSearchHistory() {
      const history = loadSearchHistory();
      if (!history.length) { searchResults.style.display = 'none'; return; }
      searchResults.innerHTML = '';
      searchResults.style.display = 'block';
      const hLabel = el('div', 'padding:4px 8px 2px;font-size:10px;color:#555;font-weight:bold;text-transform:uppercase;letter-spacing:0.08em;', 'Recent');
      searchResults.appendChild(hLabel);
      history.forEach(q => {
        const row = el('div', 'display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;cursor:pointer;transition:background 0.1s;');
        row.addEventListener('mouseenter', () => row.style.background = '#333');
        row.addEventListener('mouseleave', () => row.style.background = '');
        const icon = el('i', 'font-size:13px;color:#555;flex-shrink:0;');
        icon.className = 'material-icons';
        icon.textContent = 'history';
        const text = el('span', 'flex:1;font-size:12px;color:#aaa;', q);
        const removeBtn = el('i', 'font-size:13px;color:#444;cursor:pointer;flex-shrink:0;transition:color 0.15s;');
        removeBtn.className = 'material-icons';
        removeBtn.textContent = 'close';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('mouseenter', () => removeBtn.style.color = '#888');
        removeBtn.addEventListener('mouseleave', () => removeBtn.style.color = '#444');
        removeBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const h = loadSearchHistory().filter(x => x !== q);
          saveSearchHistory(h);
          showSearchHistory();
        });
        row.addEventListener('mousedown', (e) => {
          if (removeBtn.contains(e.target)) return;
          e.preventDefault();
          searchInput.value = q;
          clearBtn.style.display = 'block';
          searchResults._showingHistory = false;
          historyBtn.style.color = '#555';
          clearTimeout(searchTimeout);
          searchResults.style.display = 'none';
          appendRecordResults(q, searchResults);
        });
        row.append(icon, text, removeBtn);
        searchResults.appendChild(row);
      });
    }

    searchInput.addEventListener('blur', () => {
      setTimeout(() => {
        if (searchResults._dragging) return;
        searchResults.style.display = 'none';
        searchResults._showingHistory = false;
        historyBtn.style.color = '#555';
      }, 150);
    });

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      const isInventorySearch = val.includes(',');
      if (!val) { searchResults.style.display = 'none'; searchResults._showingHistory = false; historyBtn.style.color = '#555'; return; }
      if (!isInventorySearch && val.length < 2) { searchResults.style.display = 'none'; return; }
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        appendRecordResults(val, searchResults);
      }, isInventorySearch ? 500 : 350);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = searchInput.value.trim();
        if (val) pushSearchHistory(val);
      }
    });

    // Scrollable cards area
    const body = el('div', `
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    `);
    body.id = 'rq-dashboard-body';

    // Fallback drop zone: accepts records dropped anywhere on the panel body
    // (cardBody handlers take priority via stopPropagation)
    body.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-record')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      body.style.outline = '2px dashed #4a7a4a';
    });
    body.addEventListener('dragleave', (e) => {
      if (body.contains(e.relatedTarget)) return;
      body.style.outline = '';
    });
    body.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-record')) return;
      e.preventDefault();
      body.style.outline = '';
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/rq-record'));
        const tabs = loadTabs();
        const activeTab = tabs ? getActiveTab(tabs) : null;
        const customSections = loadCustomSections();
        const tabCustomIds = activeTab
          ? activeTab.sections.filter(id => !BUILTIN_IDS.includes(id))
          : customSections.map(s => s.id);
        if (!tabCustomIds.length) return;
        dropRecordOnSection(tabCustomIds[tabCustomIds.length - 1], data);
      } catch {}
    });

    panel.append(topSection, buildTabBar(), body);
    document.body.append(overlay, panel);

    overlay.addEventListener('click', closePanel);

    // ── Keyboard navigation ──────────────────────────────────────────
    // Listener on document so it fires regardless of which element has focus.
    // Capture phase so we see the event before RW's own arrow-key handlers consume it
    document.addEventListener('keydown', (e) => {
      // Only when panel is open
      if (panel.style.transform !== 'translateX(0)') return;
      // Don't hijack typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter' && e.key !== 'Escape') return;

      const current = panel.querySelector('.rq-row-focused');

      if (e.key === 'Escape') {
        if (current) { current.classList.remove('rq-row-focused'); current.style.background = ''; }
        return;
      }

      if (e.key === 'Enter') {
        if (current) { e.preventDefault(); current.click(); }
        return;
      }

      // ArrowDown/Up — build focusable list, determine next row
      const focusable = [...panel.querySelectorAll('.rq-card-row')]
        .filter(r => r.offsetParent !== null);
      if (!focusable.length) return;

      e.preventDefault();
      e.stopPropagation();

      const idx = current ? focusable.indexOf(current) : -1;
      const next = e.key === 'ArrowDown'
        ? focusable[Math.min(Math.max(idx + 1, 0), focusable.length - 1)]
        : focusable[Math.max(idx - 1, 0)];

      if (current) { current.classList.remove('rq-row-focused'); current.style.background = ''; }
      next.classList.add('rq-row-focused');
      next.style.background = '#272727';
      next.scrollIntoView({ block: 'nearest' });
    }, true);


    return { panel, overlay, body };
  }

  // ── Open / Close ───────────────────────────────────────────────────
  let panelBuilt = false;

  function openPanel() {
    if (!panelBuilt) {
      buildPanel();
      panelBuilt = true;
      let tabs = loadTabs();
      if (!tabs) tabs = migrateToTabs();
      renderTabBar(tabs, getActiveTab(tabs).id);
      renderCards();
    }
    const panel = document.getElementById('rq-dashboard');
    const overlay = document.getElementById('rq-dashboard-overlay');
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    panel.style.transform = 'translateX(0)';
    const searchInput = document.getElementById('rq-dashboard-search');
    searchInput?.focus();
    // Restore search results if there was an active query
    const searchResults = document.getElementById('rq-dashboard-search-results');
    if (searchInput?.value && searchResults?.children.length) searchResults.style.display = 'block';
    refreshCards();
  }

  function closePanel() {
    const panel = document.getElementById('rq-dashboard');
    const overlay = document.getElementById('rq-dashboard-overlay');
    if (!panel) return;
    overlay.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    panel.style.transform = 'translateX(100%)';
  }

  function togglePanel() {
    const panel = document.getElementById('rq-dashboard');
    if (!panel || panel.style.transform === 'translateX(100%)' || panel.style.transform === '') {
      openPanel();
    } else {
      closePanel();
    }
  }

  // ── Section reorder drag/drop ──────────────────────────────────────
  function makeCardReorderable(card, handle) {
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', () => {
      card.draggable = true;
      const reset = () => { card.draggable = false; document.removeEventListener('mouseup', reset, true); };
      document.addEventListener('mouseup', reset, true);
    });
    card.addEventListener('dragend', () => {
      card.draggable = false;
      card.style.opacity = '';
      clearSectionDropIndicators();
    });

    card.addEventListener('dragstart', (e) => {
      if (!card.draggable) return; // don't cancel — a child row may be the drag source
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/rq-section', card.id);
      setTimeout(() => card.style.opacity = '0.4', 0);
    });

    card.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-section')) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      clearSectionDropIndicators();
      card.style.boxShadow = before
        ? '0 -2px 0 0 #5a9a5a'
        : '0 2px 0 0 #5a9a5a';
    });

    card.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-section')) return;
      card.style.boxShadow = '';
    });

    card.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-section')) return;
      e.preventDefault();
      e.stopPropagation();
      clearSectionDropIndicators();

      const draggedId = e.dataTransfer.getData('application/rq-section');
      const draggedCard = document.getElementById(draggedId);
      if (!draggedCard || draggedCard === card) return;

      const rect = card.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) card.before(draggedCard);
      else card.after(draggedCard);

      persistSectionOrder();
    });
  }

  function clearSectionDropIndicators() {
    document.querySelectorAll('#rq-dashboard-body > [id^="rq-card-"]').forEach(c => {
      c.style.boxShadow = '';
    });
  }

  // ── Tab bar ────────────────────────────────────────────────────────
  function buildTabBar() {
    const bar = el('div', `
      display: flex; align-items: stretch; flex-shrink: 0;
      border-bottom: 1px solid #2a2a2a; background: #141414;
    `);
    bar.id = 'rq-tab-bar';

    // Scrollable tab strip
    const strip = el('div', `
      display: flex; align-items: stretch; flex: 1; min-width: 0;
      overflow-x: auto; scrollbar-width: thin; scrollbar-color: #333 transparent;
    `);
    strip.id = 'rq-tab-strip';
    bar.appendChild(strip);

    // Sticky + button outside the scroll area
    const addBtn = el('div', `
      display: flex; align-items: center; justify-content: center;
      padding: 0 12px; cursor: pointer; color: #444;
      font-size: 18px; flex-shrink: 0; transition: color 0.15s;
      border-left: 1px solid #2a2a2a;
    `, '+');
    addBtn.id = 'rq-tab-add-btn';
    addBtn.title = 'New tab';
    addBtn.addEventListener('mouseenter', () => addBtn.style.color = '#aaa');
    addBtn.addEventListener('mouseleave', () => addBtn.style.color = '#444');
    addBtn.addEventListener('click', addTab);
    bar.appendChild(addBtn);
    return bar;
  }

  function renderTabBar(tabs, activeTabId) {
    const bar = document.getElementById('rq-tab-bar');
    if (!bar) return;
    const strip = document.getElementById('rq-tab-strip') ?? bar;
    strip.querySelectorAll('.rq-tab').forEach(t => t.remove());
    const canDelete = tabs.length > 1;
    tabs.forEach(tab => strip.appendChild(buildTabElement(tab, tab.id === activeTabId, canDelete)));

    // Scroll active tab into view
    const activeEl = strip.querySelector(`.rq-tab[data-tab-id="${activeTabId}"]`);
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function buildTabElement(tab, isActive, canDelete) {
    const tabEl = el('div', `
      display: flex; align-items: center; gap: 5px;
      padding: 8px 12px 6px; cursor: pointer; flex-shrink: 0;
      border-bottom: 2px solid ${isActive ? '#5a9a5a' : 'transparent'};
      color: ${isActive ? '#e0e0e0' : '#555'};
      white-space: nowrap; user-select: none; font-size: 12px;
      transition: color 0.15s, border-color 0.15s;
    `);
    tabEl.className = 'rq-tab';
    tabEl.dataset.tabId = tab.id;

    const nameSpan = el('span', 'pointer-events: none;', tab.name);
    nameSpan.className = 'rq-tab-name';

    tabEl.append(nameSpan);

    let clickTimer = null;
    tabEl.addEventListener('click', () => {
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => switchTab(tab.id), 220);
    });
    tabEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      clearTimeout(clickTimer);
      startRenameTab(tab.id, nameSpan);
    });
    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(clickTimer);
      showTabContextMenu(e, tab.id, nameSpan, canDelete);
    });
    tabEl.addEventListener('mouseenter', () => { if (tab.id !== getActiveTabId()) tabEl.style.color = '#aaa'; });
    tabEl.addEventListener('mouseleave', () => { if (tab.id !== getActiveTabId()) tabEl.style.color = '#555'; });

    makeTabReorderable(tabEl, tab.id);
    makeTabDropTarget(tabEl, tab.id);
    return tabEl;
  }

  function startRenameTab(tabId, nameSpan) {
    const input = el('input', `
      background: transparent; border: none; border-bottom: 1px solid #5a9a5a;
      color: #e0e0e0; font-size: 12px; padding: 0; width: 80px; outline: none;
    `);
    input.value = nameSpan.textContent;
    nameSpan.replaceWith(input);
    input.focus(); input.select();

    function commit() {
      const newName = input.value.trim() || 'Untitled';
      const tabs = loadTabs();
      const t = tabs?.find(t => t.id === tabId);
      if (t) { t.name = newName; saveTabs(tabs); }
      nameSpan.textContent = newName;
      input.replaceWith(nameSpan);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { input.replaceWith(nameSpan); }
      e.stopPropagation();
    });
    input.addEventListener('click', e => e.stopPropagation());
  }

  function showTabContextMenu(e, tabId, nameSpan, canDelete) {
    document.getElementById('rq-tab-ctx-menu')?.remove();

    const menu = el('div', `
      position: fixed; z-index: 100002;
      background: #242424; border: 1px solid #444; border-radius: 6px;
      padding: 4px 0; min-width: 140px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.65);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
    `);
    menu.id = 'rq-tab-ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    const mkItem = (label, color, onClick) => {
      const item = el('div', `
        padding: 6px 14px; cursor: pointer; color: ${color};
        transition: background 0.1s;
      `, label);
      item.addEventListener('mouseenter', () => item.style.background = '#333');
      item.addEventListener('mouseleave', () => item.style.background = '');
      item.addEventListener('mousedown', (ev) => { ev.stopPropagation(); menu.remove(); onClick(); });
      return item;
    };

    menu.appendChild(mkItem('Rename', '#ccc', () => startRenameTab(tabId, nameSpan)));
    if (canDelete) {
      const sep = el('div', 'border-top: 1px solid #333; margin: 3px 0;');
      menu.appendChild(sep);
      menu.appendChild(mkItem('Delete tab', '#e05555', () => deleteTab(tabId)));
    }

    document.body.appendChild(menu);

    // Position-clamp so menu doesn't go off screen
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right  > window.innerWidth  - 8) menu.style.left = (window.innerWidth  - r.width  - 8) + 'px';
      if (r.bottom > window.innerHeight - 8) menu.style.top  = (window.innerHeight - r.height - 8) + 'px';
    });

    const close = (ev) => {
      if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close, true); }
    };
    document.addEventListener('mousedown', close, true);
  }

  function makeTabReorderable(tabEl, tabId) {
    tabEl.draggable = true;
    tabEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/rq-dashboard-tab', tabId);
      setTimeout(() => tabEl.style.opacity = '0.4', 0);
    });
    tabEl.addEventListener('dragend', () => { tabEl.style.opacity = ''; clearTabDropIndicators(); });
    tabEl.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-dashboard-tab')) return;
      e.preventDefault(); e.stopPropagation();
      clearTabDropIndicators();
      const rect = tabEl.getBoundingClientRect();
      tabEl.style.boxShadow = e.clientX < rect.left + rect.width / 2
        ? '-2px 0 0 0 #5a9a5a' : '2px 0 0 0 #5a9a5a';
    });
    tabEl.addEventListener('dragleave', () => clearTabDropIndicators());
    tabEl.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-dashboard-tab')) return;
      e.preventDefault(); e.stopPropagation();
      clearTabDropIndicators();
      const draggedId = e.dataTransfer.getData('application/rq-dashboard-tab');
      if (draggedId === tabId) return;
      const tabs = loadTabs();
      const fromIdx = tabs.findIndex(t => t.id === draggedId);
      const toIdx   = tabs.findIndex(t => t.id === tabId);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = tabs.splice(fromIdx, 1);
      const rect = tabEl.getBoundingClientRect();
      const newToIdx = tabs.findIndex(t => t.id === tabId);
      tabs.splice(e.clientX < rect.left + rect.width / 2 ? newToIdx : newToIdx + 1, 0, moved);
      saveTabs(tabs);
      renderTabBar(tabs, getActiveTabId());
    });
  }

  function makeTabDropTarget(tabEl, targetTabId) {
    const accepts = (e) =>
      e.dataTransfer.types.includes('application/rq-section') ||
      e.dataTransfer.types.includes('application/rq-record');

    tabEl.addEventListener('dragover', (e) => {
      if (!accepts(e)) return;
      e.preventDefault(); e.stopPropagation();
      tabEl.style.background = '#1a2a1a';
    });
    tabEl.addEventListener('dragleave', (e) => {
      if (accepts(e)) tabEl.style.background = '';
    });
    tabEl.addEventListener('drop', (e) => {
      tabEl.style.background = '';

      if (e.dataTransfer.types.includes('application/rq-section')) {
        e.preventDefault(); e.stopPropagation();
        const sectionCardId = e.dataTransfer.getData('application/rq-section');
        const sectionId = sectionCardId.replace('rq-card-custom-', '').replace('rq-card-', '');
        moveSectionToTab(sectionId, targetTabId);
        return;
      }

      if (e.dataTransfer.types.includes('application/rq-record')) {
        e.preventDefault(); e.stopPropagation();
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/rq-record'));
          const tabs = loadTabs();
          if (!tabs) return;
          const targetTab = tabs.find(t => t.id === targetTabId);
          if (!targetTab) return;
          const customSections = loadCustomSections();
          const firstSectionId = targetTab.sections.find(
            id => !BUILTIN_IDS.includes(id) && customSections.some(s => s.id === id)
          );
          if (!firstSectionId) {
            showDashToast('No sections in that tab — add one first');
            return;
          }
          dropRecordOnSection(firstSectionId, data);
          switchTab(targetTabId);
        } catch {}
      }
    });
  }

  function clearTabDropIndicators() {
    document.querySelectorAll('.rq-tab').forEach(t => t.style.boxShadow = '');
  }

  function showDashToast(message, duration = 3000) {
    document.getElementById('rq-dash-info-toast')?.remove();
    const toast = el('div', `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #2a2a2a; border: 1px solid #444; border-radius: 6px;
      padding: 9px 16px; color: #ccc; font-size: 13px;
      z-index: 999999; pointer-events: none; white-space: nowrap;
    `);
    toast.id = 'rq-dash-info-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function switchTab(tabId) {
    setActiveTabId(tabId);
    const tabs = loadTabs();
    renderTabBar(tabs, tabId);
    renderCards();
    refreshCards();
  }

  function addTab() {
    let tabs = loadTabs();
    if (!tabs) tabs = migrateToTabs();
    const newTab = { id: genId(), name: 'New Tab', sections: [] };
    tabs.push(newTab);
    saveTabs(tabs);
    setActiveTabId(newTab.id);
    renderTabBar(tabs, newTab.id);
    renderCards();
    const nameSpan = document.querySelector(`.rq-tab[data-tab-id="${newTab.id}"] .rq-tab-name`);
    if (nameSpan) startRenameTab(newTab.id, nameSpan);
  }

  function deleteTab(tabId) {
    const tabs = loadTabs();
    if (!tabs || tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    // Snapshot for undo
    const snapshot = JSON.parse(JSON.stringify(tabs));
    const wasActive = getActiveTabId() === tabId;
    const previousActiveId = getActiveTabId();

    const recipientIdx = idx > 0 ? idx - 1 : 1;
    const recipient = tabs[recipientIdx];
    recipient.sections = [...recipient.sections, ...tabs[idx].sections];
    tabs.splice(idx, 1);
    saveTabs(tabs);
    if (wasActive) setActiveTabId(recipient.id);
    renderTabBar(tabs, getActiveTabId());
    renderCards();
    refreshCards();

    // Undo toast
    document.getElementById('rq-tab-undo-toast')?.remove();
    const toast = el('div', `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #2a2a2a; border: 1px solid #444; border-radius: 6px;
      padding: 9px 16px; display: flex; align-items: center; gap: 12px;
      font-size: 12px; color: #ccc; z-index: 200001;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      animation: rq-fadein 0.15s ease;
    `);
    toast.id = 'rq-tab-undo-toast';
    const msg = el('span', '', 'Tab deleted');
    const undoBtn = el('span', 'color: #5a9a5a; cursor: pointer; font-weight: 600; transition: color 0.15s;', 'Undo');
    undoBtn.addEventListener('mouseenter', () => undoBtn.style.color = '#7aca7a');
    undoBtn.addEventListener('mouseleave', () => undoBtn.style.color = '#5a9a5a');
    undoBtn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toast.remove();
      saveTabs(snapshot);
      setActiveTabId(previousActiveId);
      renderTabBar(snapshot, previousActiveId);
      renderCards();
      refreshCards();
    });
    toast.append(msg, undoBtn);
    document.body.appendChild(toast);

    const toastTimer = setTimeout(() => toast.remove(), 4000);
  }

  function moveSectionToTab(sectionId, targetTabId) {
    const tabs = loadTabs();
    if (!tabs) return;
    tabs.forEach(t => { t.sections = t.sections.filter(id => id !== sectionId); });
    const target = tabs.find(t => t.id === targetTabId);
    if (!target) return;
    target.sections.push(sectionId);
    saveTabs(tabs);
    setActiveTabId(targetTabId);
    renderTabBar(tabs, targetTabId);
    renderCards();
  }

  function persistSectionOrder() {
    const activeTabId = getActiveTabId();
    const body = document.getElementById('rq-dashboard-body');
    if (!body) return;
    const order = [...body.querySelectorAll(':scope > [id^="rq-card-"]')]
      .filter(c => c.style.display !== 'none')
      .map(c => c.id.replace('rq-card-custom-', '').replace('rq-card-', ''));
    const tabs = loadTabs();
    if (!tabs) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;
    tab.sections = order;
    saveTabs(tabs);
  }

  // ── Section collapse ──────────────────────────────────────────────
  const COLLAPSED_KEY = 'rq-dashboard-collapsed';
  function loadCollapsed() { try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '{}'); } catch { return {}; } }
  function saveCollapsed(d) { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(d)); }

  function makeCollapseToggle(cardId, cardBody, cardHeader) {
    const btn = el('i', `
      font-size: 14px; color: #3a3a3a; flex-shrink: 0; cursor: pointer;
      transition: color 0.15s, transform 0.2s;
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 3px;
    `);
    btn.className = 'material-icons';
    btn.textContent = 'expand_more';
    btn.title = 'Collapse section';

    function apply(collapsed) {
      cardBody.style.display = collapsed ? 'none' : '';
      cardHeader.style.borderBottom = collapsed ? 'none' : '';
      btn.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
      btn.title = collapsed ? 'Expand section' : 'Collapse section';
    }

    apply(!!loadCollapsed()[cardId]);

    btn.addEventListener('mouseenter', () => btn.style.color = '#888');
    btn.addEventListener('mouseleave', () => btn.style.color = '#3a3a3a');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = loadCollapsed();
      d[cardId] = !d[cardId];
      saveCollapsed(d);
      apply(d[cardId]);
    });
    return btn;
  }

  // ── Badge toggle (shared) ──────────────────────────────────────────
  const BADGE_HIDE_KEY = 'rq-dashboard-hide-badges';
  function loadBadgeHide() { try { return JSON.parse(localStorage.getItem(BADGE_HIDE_KEY) || '{}'); } catch { return {}; } }
  function saveBadgeHide(d) { localStorage.setItem(BADGE_HIDE_KEY, JSON.stringify(d)); }

  function makeBadgeToggleBtn(cardId, initialHide) {
    const btn = el('i', 'font-size:14px;cursor:pointer;flex-shrink:0;margin-left:auto;transition:color 0.15s;');
    btn.className = 'material-icons';
    btn.textContent = 'notifications_off';

    function apply(hide) {
      btn.style.color = hide ? '#e09820' : '#444';
      btn.title = hide ? 'Show due date badges' : 'Hide due date badges';
      btn._cardBody?.querySelectorAll('.rq-due-badge').forEach(b => {
        b.style.display = (hide || b.dataset.rqDueVisible !== '1') ? 'none' : 'inline-block';
      });
    }

    apply(initialHide);
    btn.addEventListener('mouseenter', () => { if (!loadBadgeHide()[cardId]) btn.style.color = '#888'; });
    btn.addEventListener('mouseleave', () => { apply(!!loadBadgeHide()[cardId]); });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const d = loadBadgeHide();
      d[cardId] = !d[cardId];
      saveBadgeHide(d);
      apply(d[cardId]);
    });
    return btn;
  }

  // ── Card builder (built-in) ────────────────────────────────────────
  // ── Per-section filter ────────────────────────────────────────────
  // Appends a search icon to cardHeader and returns a filterRow element
  // to be inserted between the header and body in the card.
  function addSectionFilter(cardHeader, cardBody) {
    const filterBtn = el('i', `
      font-size: 14px; color: #444; flex-shrink: 0; cursor: pointer;
      width: 18px; height: 18px; border-radius: 3px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: color 0.15s;
    `);
    filterBtn.className = 'material-icons';
    filterBtn.textContent = 'search';
    filterBtn.title = 'Filter section';
    cardHeader.appendChild(filterBtn);

    const filterRow = el('div', `
      display: none; padding: 5px 10px;
      background: #1a1a1a; border-bottom: 1px solid #2a2a2a;
    `);
    const filterInput = document.createElement('input');
    filterInput.placeholder = 'Filter...';
    filterInput.style.cssText = `
      width: 100%; box-sizing: border-box;
      background: #252525; border: 1px solid #3a3a3a; border-radius: 4px;
      color: #e0e0e0; padding: 4px 8px; font-size: 11px; outline: none;
    `;
    filterRow.appendChild(filterInput);

    let filterOpen = false;

    function applyFilter() {
      const q = filterInput.value.trim().toLowerCase();
      cardBody.querySelectorAll('.rq-card-row').forEach(row => {
        row.style.display = (!q || row.textContent.toLowerCase().includes(q)) ? 'flex' : 'none';
      });
    }

    // Re-apply whenever the card body is repopulated (e.g. after refresh)
    new MutationObserver(applyFilter).observe(cardBody, { childList: true });

    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      filterOpen = !filterOpen;
      filterRow.style.display = filterOpen ? '' : 'none';
      filterBtn.style.color = filterOpen ? '#7aafdf' : '#444';
      if (filterOpen) {
        filterInput.focus();
      } else {
        filterInput.value = '';
        applyFilter();
      }
    });

    filterInput.addEventListener('click', e => e.stopPropagation());
    filterInput.addEventListener('dragstart', e => e.stopPropagation());
    filterInput.addEventListener('input', applyFilter);
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        filterOpen = false;
        filterRow.style.display = 'none';
        filterBtn.style.color = '#444';
        filterInput.value = '';
        applyFilter();
      }
    });

    return filterRow;
  }

  function buildCard(title, icon, id) {
    const card = el('div', `
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 6px;
      overflow: hidden;
      flex-shrink: 0;
    `);
    card.id = 'rq-card-' + id;

    const cardHeader = el('div', `
      display: flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border-bottom: 1px solid #2a2a2a;
      background: #1a1a1a;
      font-size: 10px; font-weight: 700;
      color: #666; letter-spacing: 0.12em; text-transform: uppercase;
    `);

    const dragHandle = el('i', 'font-size: 14px; color: #3a3a3a; flex-shrink: 0;');
    dragHandle.className = 'material-icons';
    dragHandle.textContent = 'drag_indicator';

    const cardIcon = el('i', 'font-size: 13px; color: #555;');
    cardIcon.className = 'material-icons';
    cardIcon.textContent = icon;

    // Title fills remaining space, pushing action buttons to the right
    const titleSpan = el('span', 'flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;');
    titleSpan.textContent = title;

    const badgeToggleBtn = makeBadgeToggleBtn(id, !!loadBadgeHide()[id]);
    const cardBody = el('div', 'padding: 8px 0;');
    cardBody.id = 'rq-card-body-' + id;
    cardBody.innerHTML = '<div style="padding: 8px 14px; color: #555; font-style: italic;">Loading...</div>';
    badgeToggleBtn._cardBody = cardBody;
    badgeToggleBtn.style.marginLeft = ''; // clear auto-margin (badge lives in cfg bar now)

    const collapseBtn = makeCollapseToggle(id, cardBody, cardHeader);

    // Remove button lives in the cfg bar, not the header
    const removeBtn = el('i', `
      font-size: 14px; color: #555; cursor: pointer; flex-shrink: 0;
      margin-left: auto; transition: color 0.15s;
    `);
    removeBtn.className = 'material-icons';
    removeBtn.textContent = 'close';
    removeBtn.title = 'Remove from tab';
    removeBtn.addEventListener('mouseenter', () => removeBtn.style.color = '#e05555');
    removeBtn.addEventListener('mouseleave', () => removeBtn.style.color = '#555');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabs = loadTabs();
      if (!tabs) return;
      const activeTab = getActiveTab(tabs);
      activeTab.sections = activeTab.sections.filter(s => s !== id);
      saveTabs(tabs);
      card.remove();
      persistSectionOrder();
    });

    // Cfg bar: badge toggle on left, remove × on right (via margin-left:auto)
    // Builders may prepend additional controls (agent input, etc.)
    const cfgBar = el('div', '');
    cfgBar.className = 'rq-cfg-bar';
    cfgBar.append(badgeToggleBtn, removeBtn);

    // Cfg toggle button wired to the cfg bar
    const CFG_HIDDEN_KEY = 'rq-cfg-hidden-' + id;
    const cfgHidden = localStorage.getItem(CFG_HIDDEN_KEY) === '1';
    if (cfgHidden) cfgBar.classList.add('rq-cfg-hidden');

    const cfgToggleBtn = el('i', `
      font-size: 14px; color: ${cfgHidden ? '#2a2a2a' : '#4a7a4a'}; cursor: pointer; flex-shrink: 0;
      transition: color 0.15s;
    `);
    cfgToggleBtn.className = 'material-icons';
    cfgToggleBtn.textContent = 'tune';
    cfgToggleBtn.title = cfgHidden ? 'Show config' : 'Hide config';
    cfgToggleBtn.addEventListener('mouseenter', () => cfgToggleBtn.style.color = '#8ac');
    cfgToggleBtn.addEventListener('mouseleave', () => cfgToggleBtn.style.color = cfgBar.classList.contains('rq-cfg-hidden') ? '#2a2a2a' : '#4a7a4a');
    cfgToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowHiding = !cfgBar.classList.contains('rq-cfg-hidden');
      cfgBar.classList.toggle('rq-cfg-hidden', nowHiding);
      localStorage.setItem(CFG_HIDDEN_KEY, nowHiding ? '1' : '0');
      cfgToggleBtn.style.color = nowHiding ? '#2a2a2a' : '#4a7a4a';
      cfgToggleBtn.title = nowHiding ? 'Show config' : 'Hide config';
    });

    // Exposed so card builders can augment the cfg bar and insert header buttons
    card._cardHeader = cardHeader;
    card._badgeToggleBtn = badgeToggleBtn;
    card._cfgBar = cfgBar;
    card._cfgToggleBtn = cfgToggleBtn;
    card._collapseBtn = collapseBtn;
    card._removeBtn = removeBtn;

    // Header order: drag, icon, title[flex:1], [filterBtn from addSectionFilter], cfgToggleBtn, collapseBtn
    // Builders insert sort before cfgToggleBtn and refresh before collapseBtn.
    cardHeader.append(dragHandle, cardIcon, titleSpan);
    const filterRow = id !== 'quicklinks' ? addSectionFilter(cardHeader, cardBody) : null;
    cardHeader.append(cfgToggleBtn, collapseBtn);

    card.append(cardHeader, ...(filterRow ? [filterRow] : []), cfgBar, cardBody);
    makeCardReorderable(card, dragHandle);
    return card;
  }

  // ── Archive card ───────────────────────────────────────────────────
  function buildArchiveCard() {
    const collapsed = loadCollapsed();
    if (!('archive' in collapsed)) { collapsed['archive'] = true; saveCollapsed(collapsed); }
    return buildCard('Archive', 'archive', 'archive');
  }

  // ── Custom section card ────────────────────────────────────────────
  function buildCustomCard(section) {
    const card = el('div', `
      background: #1e1e1e;
      border: 1px solid #333;
      border-radius: 6px;
      overflow: hidden;
      flex-shrink: 0;
    `);
    card.id = 'rq-card-custom-' + section.id;

    const cardHeader = el('div', `
      display: flex; align-items: center; gap: 8px;
      padding: 9px 14px;
      border-bottom: 1px solid #2a2a2a;
      background: #1a1a1a;
      font-size: 10px; font-weight: 700;
      color: #666; letter-spacing: 0.12em; text-transform: uppercase;
    `);

    const dragHandle = el('i', 'font-size: 14px; color: #3a3a3a; flex-shrink: 0;');
    dragHandle.className = 'material-icons';
    dragHandle.textContent = 'drag_indicator';

    const titleSpan = el('span', 'flex: 1; cursor: text; color: #666;', section.title);
    titleSpan.title = 'Click to rename';
    titleSpan.addEventListener('click', () => startRenameSection(section.id, titleSpan));

    const deleteBtn = el('i', `
      font-size: 14px; color: #444; cursor: pointer; flex-shrink: 0;
      margin-left: auto;
      transition: color 0.15s;
    `);
    deleteBtn.className = 'material-icons';
    deleteBtn.textContent = 'delete_outline';
    deleteBtn.title = 'Delete section';
    deleteBtn.addEventListener('mouseenter', () => deleteBtn.style.color = '#e05555');
    deleteBtn.addEventListener('mouseleave', () => deleteBtn.style.color = '#444');
    deleteBtn.addEventListener('click', () => deleteCustomSection(section.id));

    const sortBtn = el('i', `
      font-size: 14px; cursor: pointer; flex-shrink: 0;
      color: ${section.sort ? '#5a9a5a' : '#444'};
      transition: color 0.15s;
    `);
    sortBtn.className = 'material-icons';
    sortBtn.textContent = 'swap_vert';
    sortBtn.title = 'Sort section';
    sortBtn.addEventListener('mouseenter', () => sortBtn.style.color = section.sort ? '#7aca7a' : '#888');
    sortBtn.addEventListener('mouseleave', () => sortBtn.style.color = section.sort ? '#5a9a5a' : '#444');
    sortBtn.addEventListener('click', (e) => { e.stopPropagation(); openSortMenu(sortBtn, section); });

    const snoozeToggleBtn = makeBadgeToggleBtn('custom-' + section.id, !!loadBadgeHide()['custom-' + section.id]);
    snoozeToggleBtn.style.marginLeft = ''; // badge lives in cfg bar, not header

    const cardBody = el('div', 'padding: 8px 0; min-height: 36px;');
    cardBody.id = 'rq-card-body-custom-' + section.id;
    snoozeToggleBtn._cardBody = cardBody;
    const collapseBtn = makeCollapseToggle('custom-' + section.id, cardBody, cardHeader);

    // Delete button lives in cfg bar with margin-left:auto to right-justify it
    deleteBtn.style.marginLeft = 'auto';

    // Cfg bar: badge toggle on left, delete on right
    const customCfgBar = el('div', '');
    customCfgBar.className = 'rq-cfg-bar';
    customCfgBar.append(snoozeToggleBtn, deleteBtn);

    // Cfg toggle button
    const CFG_KEY = 'rq-cfg-hidden-custom-' + section.id;
    const cfgHidden = localStorage.getItem(CFG_KEY) === '1';
    if (cfgHidden) customCfgBar.classList.add('rq-cfg-hidden');

    const cfgToggleBtn = el('i', `
      font-size: 14px; color: ${cfgHidden ? '#2a2a2a' : '#4a7a4a'}; cursor: pointer; flex-shrink: 0;
      transition: color 0.15s;
    `);
    cfgToggleBtn.className = 'material-icons';
    cfgToggleBtn.textContent = 'tune';
    cfgToggleBtn.title = cfgHidden ? 'Show config' : 'Hide config';
    cfgToggleBtn.addEventListener('mouseenter', () => cfgToggleBtn.style.color = '#8ac');
    cfgToggleBtn.addEventListener('mouseleave', () => cfgToggleBtn.style.color = customCfgBar.classList.contains('rq-cfg-hidden') ? '#2a2a2a' : '#4a7a4a');
    cfgToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowHiding = !customCfgBar.classList.contains('rq-cfg-hidden');
      customCfgBar.classList.toggle('rq-cfg-hidden', nowHiding);
      localStorage.setItem(CFG_KEY, nowHiding ? '1' : '0');
      cfgToggleBtn.style.color = nowHiding ? '#2a2a2a' : '#4a7a4a';
      cfgToggleBtn.title = nowHiding ? 'Show config' : 'Hide config';
    });

    // Header: drag, title[flex], filterBtn, sortBtn, cfgToggleBtn, collapseBtn
    cardHeader.append(dragHandle, titleSpan);
    const filterRow = addSectionFilter(cardHeader, cardBody);
    cardHeader.append(sortBtn, cfgToggleBtn, collapseBtn);

    // Drop zone for records
    let dropInsertIndex = null;
    const clearRowIndicators = () => {
      cardBody.querySelectorAll('[data-row-index]').forEach(r => {
        r.style.borderTop = '';
        r.style.borderBottom = '';
      });
      cardBody.style.outline = '';
    };

    cardBody.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-record')) return;
      e.preventDefault();
      e.stopPropagation();
      clearRowIndicators();
      const rows = [...cardBody.querySelectorAll('[data-row-index]')];
      if (!rows.length) {
        cardBody.style.outline = '1px dashed #4a7a4a';
        dropInsertIndex = 0;
        return;
      }
      let insertBefore = null;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) { insertBefore = row; break; }
      }
      if (insertBefore) {
        insertBefore.style.borderTop = '2px solid #5a9a5a';
        dropInsertIndex = parseInt(insertBefore.dataset.rowIndex);
      } else {
        rows[rows.length - 1].style.borderBottom = '2px solid #5a9a5a';
        dropInsertIndex = rows.length;
      }
    });
    cardBody.addEventListener('dragleave', (e) => {
      if (!cardBody.contains(e.relatedTarget)) {
        clearRowIndicators();
        dropInsertIndex = null;
      }
    });
    cardBody.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-record')) return;
      e.preventDefault();
      e.stopPropagation();
      clearRowIndicators();
      const idx = dropInsertIndex;
      dropInsertIndex = null;
      try {
        const data = JSON.parse(e.dataTransfer.getData('application/rq-record'));
        dropRecordOnSection(section.id, data, idx);
      } catch {}
    });

    card.append(cardHeader, filterRow, customCfgBar, cardBody);
    makeCardReorderable(card, dragHandle);
    return card;
  }

  function startRenameSection(sectionId, titleSpan) {
    const input = el('input', `
      background: #1a1a1a; border: 1px solid #555; border-radius: 3px;
      color: #e0e0e0; font-size: 11px; font-weight: 600;
      letter-spacing: 0.08em; text-transform: uppercase;
      padding: 0 4px; width: 140px; outline: none;
    `);
    input.value = titleSpan.textContent;
    titleSpan.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
      const newTitle = input.value.trim() || 'Untitled';
      const sections = loadCustomSections();
      const s = sections.find(s => s.id === sectionId);
      if (s) { s.title = newTitle; saveCustomSections(sections); }
      titleSpan.textContent = newTitle;
      input.replaceWith(titleSpan);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { input.replaceWith(titleSpan); }
    });
  }

  function deleteCustomSection(sectionId) {
    // Snapshot for undo
    const sectionsSnapshot = JSON.parse(JSON.stringify(loadCustomSections()));
    const tabsSnapshot     = JSON.parse(JSON.stringify(loadTabs() ?? []));
    const deletedSection   = sectionsSnapshot.find(s => s.id === sectionId);

    const sections = loadCustomSections().filter(s => s.id !== sectionId);
    saveCustomSections(sections);
    document.getElementById('rq-card-custom-' + sectionId)?.remove();
    const tabs = loadTabs();
    if (tabs) {
      tabs.forEach(t => { t.sections = t.sections.filter(id => id !== sectionId); });
      saveTabs(tabs);
    }
    persistSectionOrder();

    // Undo toast
    document.getElementById('rq-tab-undo-toast')?.remove();
    const toast = el('div', `
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #2a2a2a; border: 1px solid #444; border-radius: 6px;
      padding: 9px 16px; display: flex; align-items: center; gap: 12px;
      font-size: 12px; color: #ccc; z-index: 200001;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      animation: rq-fadein 0.15s ease;
    `);
    toast.id = 'rq-tab-undo-toast';
    const name = deletedSection?.title || 'Section';
    toast.appendChild(el('span', '', `"${name}" deleted`));
    const undoBtn = el('span', 'color:#5a9a5a;cursor:pointer;font-weight:600;transition:color 0.15s;', 'Undo');
    undoBtn.addEventListener('mouseenter', () => undoBtn.style.color = '#7aca7a');
    undoBtn.addEventListener('mouseleave', () => undoBtn.style.color = '#5a9a5a');
    undoBtn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toast.remove();
      saveCustomSections(sectionsSnapshot);
      if (tabsSnapshot.length) saveTabs(tabsSnapshot);
      renderCards();
      refreshCards();
    });
    toast.appendChild(undoBtn);
    document.body.appendChild(toast);
    const toastTimer = setTimeout(() => toast.remove(), 4000);
  }

  function sortItemsInPlace(items, field, dir) {
    items.sort((a, b) => {
      const getVal = (item) => {
        if (field === 'primary')   return (item.primary   || '').toLowerCase();
        if (field === 'secondary') return (item.secondary || '').toLowerCase();
        const detail = detailCache.get(item.module + ':' + item.recordNumber);
        const r = detail?.data?.record;
        if (field === 'estStart') return r?.EstimatedStartDate ? new Date(r.EstimatedStartDate) : null;
        if (field === 'estStop')  return r?.EstimatedStopDate  ? new Date(r.EstimatedStopDate)  : null;
        if (field === 'amount')   return r?.GrandTotal ?? r?.Total ?? r?.OrderTotal ?? null;
        return null;
      };
      const av = getVal(a), bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'asc' ? cmp : -cmp;
    });
  }

  function dropRecordOnSection(sectionId, data, insertIndex = null) {
    const sections = loadCustomSections();
    const target = sections.find(s => s.id === sectionId);
    if (!target) return;

    const newItem = { icon: data.icon, primary: data.primary, secondary: data.secondary, module: data.module, recordNumber: data.recordNumber, tags: data.tags || [] };

    if (data.sourceSectionId === sectionId) {
      // Same-section reorder
      const currentIndex = target.items.findIndex(i => i.module === data.module && i.recordNumber === data.recordNumber);
      if (currentIndex === -1) return;
      target.items.splice(currentIndex, 1);
      let targetIdx = insertIndex ?? target.items.length;
      if (insertIndex !== null && currentIndex < insertIndex) targetIdx--;
      target.items.splice(targetIdx, 0, newItem);
    } else {
      // Cross-section move or new item from search/bookmarks/recents
      const alreadyExists = target.items.some(i => i.module === data.module && i.recordNumber === data.recordNumber);
      if (!alreadyExists) {
        const idx = insertIndex ?? target.items.length;
        target.items.splice(idx, 0, newItem);

        const needsDetailForSort = target.sort &&
          ['estStart', 'estStop', 'amount'].includes(target.sort.field) &&
          !detailCache.has(data.module + ':' + data.recordNumber);

        if (needsDetailForSort) {
          // Fetch detail first so sort value is available, then re-sort and render
          saveCustomSections(sections);
          loadCustomSectionItems(target);
          fetchRecordDetail(data.module, data.recordNumber).then(() => {
            const secs = loadCustomSections();
            const t = secs.find(s => s.id === sectionId);
            if (t?.sort) {
              sortItemsInPlace(t.items, t.sort.field, t.sort.dir);
              saveCustomSections(secs);
              loadCustomSectionItems(t);
            }
          });
          if (data.sourceSectionId) {
            const source = sections.find(s => s.id === data.sourceSectionId);
            if (source) {
              source.items = source.items.filter(i => !(i.module === data.module && i.recordNumber === data.recordNumber));
              loadCustomSectionItems(source);
            }
          }
          return;
        }

        if (target.sort) {
          sortItemsInPlace(target.items, target.sort.field, target.sort.dir);
        }
      }
      if (data.sourceSectionId) {
        const source = sections.find(s => s.id === data.sourceSectionId);
        if (source) {
          source.items = source.items.filter(i => !(i.module === data.module && i.recordNumber === data.recordNumber));
          loadCustomSectionItems(source);
        }
      }
    }

    saveCustomSections(sections);
    loadCustomSectionItems(target);
  }

  function loadCustomSectionItems(section) {
    const body = document.getElementById('rq-card-body-custom-' + section.id);
    if (!body) return;
    body.innerHTML = '';
    if (section.items.length === 0) {
      body.innerHTML = '<div style="padding: 8px 14px; color: #444; font-style: italic; font-size: 12px;">Drop records here</div>';
      return;
    }
    section.items.forEach((item, idx) => {
      const secondary = (item.secondary || item.recordNumber).replace(/-+$/, '');
      const primary = normalizeItemPrimary(item.primary, item.recordNumber);
      const row = draggableCardRow(
        item.icon, primary, secondary,
        () => smartOpenRecord(item.module, item.recordNumber, section.id),
        { icon: item.icon, primary, secondary, module: item.module, recordNumber: item.recordNumber, sourceSectionId: section.id, tags: item.tags, cardId: 'custom-' + section.id },
        () => { archiveItem({ icon: item.icon, primary, secondary, module: item.module, recordNumber: item.recordNumber, tags: item.tags || [] }, section.id); removeItemFromSection(section.id, idx); loadArchiveItems(); }
      );
      row.dataset.rowIndex = idx;
      body.appendChild(row);
    });
  }

  function removeItemFromSection(sectionId, index) {
    const sections = loadCustomSections();
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;
    section.items.splice(index, 1);
    saveCustomSections(sections);
    loadCustomSectionItems(section);
  }

  const MODULE_LABELS = {
    Order:           { label: 'Order',     color: '#3a6a9a' },
    Quote:           { label: 'Quote',     color: '#7a5a9a' },
    Contract:        { label: 'Contract',  color: '#4a7a6a' },
    Invoice:         { label: 'Invoice',   color: '#7a6a3a' },
    Deal:            { label: 'Deal',      color: '#3a7a5a' },
    Customer:        { label: 'Customer',  color: '#6a4a7a' },
    RentalInventory: { label: 'Inventory', color: '#3a6a5a' },
    Asset:           { label: 'Asset',     color: '#5a5a7a' },
    PurchaseOrder:   { label: 'PO',        color: '#7a5a3a' },
  };

  function makeModuleLabel(module) {
    const def = MODULE_LABELS[module];
    if (!def) return null;
    const chip = el('span', `
      font-size: 10px; font-weight: 400; letter-spacing: 0.02em;
      margin-left: 5px; color: ${def.color}bb; flex-shrink: 0;
    `, def.label);
    return chip;
  }

  // Strip record number prefix from a primary label if present (e.g. "LA51643 — LULULEMON" → "LULULEMON")
  function normalizeItemPrimary(primary, recordNumber) {
    if (!primary || !recordNumber) return primary;
    if (primary === recordNumber) return primary; // code-only, nothing to strip
    const prefix = recordNumber + ' — ';
    if (primary.startsWith(prefix)) return primary.slice(prefix.length);
    // Also handle without em-dash separator (tab caption format)
    if (primary.startsWith(recordNumber + ' ')) return primary.slice(recordNumber.length + 1).replace(/^[-–—]\s*/, '');
    return primary;
  }

  // ── Combined tags+status button ────────────────────────────────────
  function makeMetaBtn(module, rn, sectionId, renderTagChipsFn) {
    const btn = el('div', '');
    let pillMode = false;

    function applyIconMode() {
      btn.style.cssText = `
        font-size: 13px; color: #555; flex-shrink: 0; cursor: pointer;
        border-radius: 3px; opacity: 0; margin-top: 1px;
        width: 18px; height: 18px;
        display: inline-flex; align-items: center; justify-content: center;
        transition: opacity 0.1s, color 0.1s;
      `;
      btn.className = 'material-icons';
      btn.textContent = 'label';
      btn.title = 'Tags & status';
      pillMode = false;
    }

    function refresh() {
      const assignment = (module && rn) ? getRecordStatus(module, rn) : null;
      if (assignment) {
        const wf    = loadWorkflows().find(w => w.id === assignment.workflowId);
        const st    = wf?.statuses.find(s => s.label === assignment.status);
        const color = st?.color ?? '#555';
        btn.style.cssText = `
          font-size: 10px; font-weight: 700; letter-spacing: .04em;
          padding: 1px 7px; border-radius: 9px; cursor: pointer;
          user-select: none; flex-shrink: 0; white-space: nowrap;
          background: ${color}; color: #fff; border: 1px solid ${color};
        `;
        btn.className = '';
        btn.textContent = assignment.status;
        btn.title = assignment.status + ' — click to edit tags & status';
        pillMode = true;
      } else {
        applyIconMode();
      }
    }

    refresh();

    btn.addEventListener('mouseenter', () => { if (!pillMode) { btn.style.color = '#fff'; btn.style.background = '#555'; } });
    btn.addEventListener('mouseleave', () => { if (!pillMode) { btn.style.color = '#555'; btn.style.background = ''; } });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (module && rn) openMetaDropdown(btn, module, rn, sectionId, renderTagChipsFn, refresh);
    });

    btn._refresh = refresh;
    btn._inPillMode = () => pillMode;
    return btn;
  }

  // ── Row builders ───────────────────────────────────────────────────
  function cardRow(icon, primary, secondary, onClick, meta) {
    const row = el('div', `
      display: flex; align-items: center; gap: 10px;
      padding: 7px 14px; cursor: pointer;
      transition: background 0.1s;
    `);
    row.className = 'rq-card-row';
    row.addEventListener('mouseenter', () => { row.classList.remove('rq-row-focused'); row.style.background = '#272727'; });
    row.addEventListener('mouseleave', () => row.style.background = '');

    if (meta) {
      row.draggable = true;
      row.style.cursor = 'grab';
      row.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/rq-record', JSON.stringify(meta));
      });
    }

    const rowIcon = el('i', 'font-size: 14px; color: #555; flex-shrink: 0;');
    rowIcon.className = 'material-icons';
    rowIcon.textContent = icon;

    const text = el('div', 'flex: 1; overflow: hidden;');
    const pWrap = el('div', 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;');
    const p = el('span', 'color: #f0f0f0; cursor: pointer;', primary);
    p.addEventListener('mouseenter', () => p.style.textDecoration = 'underline');
    p.addEventListener('mouseleave', () => p.style.textDecoration = '');
    p.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); onClick(); });
    pWrap.appendChild(p);
    text.appendChild(pWrap);
    if (secondary) {
      const sWrap = el('div', 'margin-top: 1px; display: flex; align-items: center;');
      const s = el('span', 'font-size: 11px; color: #777; cursor: pointer;', secondary);
      s.title = 'Click to copy';
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(secondary).then(() => {
          const orig = s.textContent;
          s.textContent = '✓ Copied';
          s.style.color = '#4a9a4a';
          setTimeout(() => { s.textContent = orig; s.style.color = ''; }, 1200);
        });
      });
      sWrap.appendChild(s);
      const modLabel = meta?.module ? makeModuleLabel(meta.module) : null;
      if (modLabel) sWrap.appendChild(modLabel);
      text.appendChild(sWrap);
    }

    row.append(rowIcon, text);
    let expandBtn = null;
    if (meta?.module && meta?.recordNumber) {
      attachDueBadge(row, meta.module, meta.recordNumber, null, meta.cardId ?? null);
      attachRWStatusBadge(row, meta.module, meta.recordNumber);
      const metaBtn = makeMetaBtn(meta.module, meta.recordNumber, meta.sourceSectionId ?? null, null);
      row.appendChild(metaBtn);
      expandBtn = attachExpandButton(row, meta.module, meta.recordNumber, p);
    }
    row.addEventListener('click', (e) => {
      if (p.contains(e.target)) return;
      if (expandBtn) expandBtn.click();
      else { closePanel(); onClick(); }
    });
    return row;
  }

  // ── Est. start/stop date range on the row face ─────────────────────
  // Shows the record's estimated start and stop dates inline, so the schedule is
  // readable without expanding each row. Resolution mirrors attachDueBadge: a full
  // cached record, else a pre-populated list item if it happens to carry the fields,
  // else a fetch. The list endpoint for these cards does not return the dates, so
  // the fetch normally does happen - but the due badge already triggers it for the
  // same record, and fetchRecordDetail now shares in-flight requests, so this adds
  // no extra network traffic.
  const HAS_EST_DATES = ['Order', 'Quote', 'Contract', 'Deal', 'Invoice', 'PurchaseOrder'];

  // "Sep 3 - Sep 10", with the year shown only when a date falls outside this year.
  function formatDateRange(startStr, stopStr) {
    const thisYear = new Date().getFullYear();
    const fmt = (str) => {
      if (!str) return null;
      const d = new Date(String(str).slice(0, 10) + 'T00:00:00');
      if (isNaN(d)) return null;
      const opts = { month: 'short', day: 'numeric' };
      if (d.getFullYear() !== thisYear) opts.year = 'numeric';
      return d.toLocaleDateString('en-US', opts);
    };
    const a = fmt(startStr), b = fmt(stopStr);
    if (a && b) return a === b ? a : a + ' – ' + b;
    return a || b || null;
  }

  function attachDateRange(container, module, recordNumber) {
    if (!HAS_EST_DATES.includes(module) || !recordNumber) return;

    const span = el('span', `
      font-size: 10px; color: #6a8a9a; margin-left: 6px; white-space: nowrap;
      flex-shrink: 0; display: none;
    `);
    span.className = 'rq-date-range';

    const apply = (record) => {
      const text = formatDateRange(record?.EstimatedStartDate, record?.EstimatedStopDate);
      if (!text) return;
      span.textContent = text;
      span.title = 'Estimated start – stop';
      span.style.display = 'inline-block';
    };

    const cached = detailCache.get(module + ':' + recordNumber);
    const cachedRecord = cached?.data?.record;
    if (cached?.fetchedAt || cachedRecord?.EstimatedStopDate !== undefined
                          || cachedRecord?.EstimatedStartDate !== undefined) apply(cachedRecord);
    else fetchRecordDetail(module, recordNumber).then(d => apply(d?.record)).catch(() => {});

    container.appendChild(span);
  }

  function draggableCardRow(icon, primary, secondary, onClick, meta, onArchive) {
    const tags = meta?.tags || [];

    const row = el('div', `
      display: flex; align-items: flex-start; gap: 10px;
      padding: 7px 14px; cursor: pointer;
      transition: background 0.1s;
      position: relative;
      border-left: 3px solid transparent;
    `);
    row.className = 'rq-card-row';
    if (meta?.module && meta?.recordNumber) row.dataset.rqNotesKey = `${meta.module}:${meta.recordNumber}`;

    const archiveBtn = onArchive ? el('i', `
      font-size: 13px; color: #555; flex-shrink: 0; cursor: pointer;
      width: 18px; height: 18px; border-radius: 3px; opacity: 0; margin-top: 1px;
      display: inline-flex; align-items: center; justify-content: center;
      transition: opacity 0.1s, color 0.1s;
    `) : null;
    if (archiveBtn) {
      archiveBtn.className = 'material-icons';
      archiveBtn.textContent = 'archive';
      archiveBtn.title = 'Archive';
    }

    let expandBtn = null;

    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/rq-record', JSON.stringify(meta));
    });

    const rowIcon = el('i', 'font-size: 14px; color: #555; flex-shrink: 0; margin-top: 1px;');
    rowIcon.className = 'material-icons';
    rowIcon.textContent = icon;

    const text = el('div', 'flex: 1; overflow: hidden; min-width: 0;');
    const pWrap = el('div', 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;');
    const p = el('span', 'color: #f0f0f0; cursor: pointer;', primary);
    p.addEventListener('mouseenter', () => p.style.textDecoration = 'underline');
    p.addEventListener('mouseleave', () => p.style.textDecoration = '');
    p.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); onClick(); });
    pWrap.appendChild(p);
    text.appendChild(pWrap);
    if (secondary) {
      const sWrap = el('div', 'margin-top: 1px; display: flex; align-items: center;');
      const s = el('span', 'font-size: 11px; color: #777; cursor: pointer;', secondary);
      s.title = 'Click to copy';
      s.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(secondary).then(() => {
          const orig = s.textContent;
          s.textContent = '✓ Copied';
          s.style.color = '#4a9a4a';
          setTimeout(() => { s.textContent = orig; s.style.color = ''; }, 1200);
        });
      });
      sWrap.appendChild(s);
      const agentCardIds = new Set(['myorders', 'myquotes', 'mypos', 'preps']);
      const modLabel = (meta?.module && !agentCardIds.has(meta.cardId)) ? makeModuleLabel(meta.module) : null;
      if (modLabel) sWrap.appendChild(modLabel);
      const subLabel = meta?.vendor || meta?.customer || null;
      if (subLabel) {
        const subEl = el('span', `
          font-size: 10px; color: #666; margin-left: 5px;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1;
        `, subLabel);
        subEl.title = subLabel;
        sWrap.appendChild(subEl);
      }
      if (meta?.module && meta?.recordNumber) attachDateRange(sWrap, meta.module, meta.recordNumber);
      text.appendChild(sWrap);
      if (meta?.subinfo) {
        const subinfoEl = el('div', `
          font-size: 10px; color: #666; margin-top: 1px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        `, meta.subinfo);
        subinfoEl.title = meta.subinfo;
        text.appendChild(subinfoEl);
      }
    }

    const tagsEl = el('div', 'display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px;');
    const renderTagChips = (currentTags) => {
      const defs = loadTagDefs();
      tagsEl.innerHTML = '';
      currentTags.forEach(tag => {
        const c = defs.find(d => d.name === tag)?.color || '#555';
        const chip = el('span', `
          font-size: 10px; padding: 1px 6px; border-radius: 3px;
          background: ${c}22; color: #ccc; border: 1px solid ${c};
        `, tag);
        tagsEl.appendChild(chip);
      });
      tagsEl.style.display = currentTags.length ? 'flex' : 'none';
      // Drive left border from first tag's color
      const firstColor = currentTags.length ? (defs.find(d => d.name === currentTags[0])?.color || null) : null;
      row.style.borderLeftColor = firstColor || 'transparent';
    };
    renderTagChips(tags);
    text.appendChild(tagsEl);

    const initialNote = meta?.notes || '';
    const notePreviewEl = el('div', `
      font-size: 10px; color: #666; font-style: italic; margin-top: 3px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      display: ${initialNote ? '' : 'none'};
    `, initialNote);
    notePreviewEl.className = 'rq-note-preview';
    text.appendChild(notePreviewEl);

    const metaBtn = makeMetaBtn(meta?.module, meta?.recordNumber, meta?.sourceSectionId ?? null, renderTagChips);

    row.addEventListener('mouseenter', () => {
      row.classList.remove('rq-row-focused');
      row.style.background = '#272727';
      if (!metaBtn._inPillMode()) metaBtn.style.opacity = '1';
      if (archiveBtn) archiveBtn.style.opacity = '1';
    });
    row.addEventListener('mouseleave', () => {
      row.style.background = '';
      if (!metaBtn._inPillMode()) metaBtn.style.opacity = '0';
      if (archiveBtn) archiveBtn.style.opacity = '0';
    });
    row.addEventListener('click', (e) => {
      if (metaBtn.contains(e.target) || archiveBtn?.contains(e.target) || p.contains(e.target)) return;
      if (expandBtn) expandBtn.click();
    });

    if (archiveBtn) {
      archiveBtn.addEventListener('mouseenter', () => { archiveBtn.style.color = '#7aafdf'; archiveBtn.style.background = '#1a3a5a'; });
      archiveBtn.addEventListener('mouseleave', () => { archiveBtn.style.color = '#555'; archiveBtn.style.background = ''; });
      archiveBtn.addEventListener('click', (e) => { e.stopPropagation(); onArchive(); });
    }

    row.append(rowIcon, text);
    if (meta?.module && meta?.recordNumber) {
      attachDueBadge(row, meta.module, meta.recordNumber, null, meta.cardId ?? null);
      attachRWStatusBadge(row, meta.module, meta.recordNumber);
    }
    row.append(metaBtn, ...(archiveBtn ? [archiveBtn] : []));
    if (meta?.module && meta?.recordNumber) {
      expandBtn = attachExpandButton(row, meta.module, meta.recordNumber, p, meta.sourceSectionId ?? null);
    }
    return row;
  }

  function openMetaDropdown(anchorEl, module, rn, sectionId, renderTagChipsFn, refreshBtnFn) {
    document.getElementById('rq-item-editor')?.remove();
    document.getElementById('rq-wf-picker')?.remove();

    const PALETTE = ['#e05555', '#e07820', '#d4b44a', '#4a9a4a', '#3a9a8a', '#4a7aaa', '#8a5aaa', '#c05580'];
    let pendingColor = PALETTE[0];

    // Resolve tag storage (custom section vs. item meta store)
    let tags, saveTags;
    if (sectionId) {
      const sections = loadCustomSections();
      const section  = sections.find(s => s.id === sectionId);
      const item = section?.items.find(i => i.module === module && i.recordNumber === rn);
      if (item) {
        item.tags = item.tags || [];
        tags = item.tags;
        saveTags = (newTags) => { item.tags = newTags; saveCustomSections(sections); renderTagChipsFn?.(newTags); };
      } else {
        tags = []; saveTags = () => {};
      }
    } else {
      const entry = getItemMetaEntry(module, rn);
      entry.tags = entry.tags || [];
      tags = entry.tags;
      saveTags = (newTags) => { entry.tags = newTags; saveItemMetaEntry(module, rn, entry); renderTagChipsFn?.(newTags); };
    }

    const panel = el('div', `
      position: fixed; z-index: 100001;
      background: #242424; border: 1px solid #444; border-radius: 8px;
      padding: 12px; width: 220px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.65);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `);
    panel.id = 'rq-item-editor';

    // ── My Status ────────────────────────────────────────────────────
    const statusLabel = el('div', 'color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;', 'My Status');
    const statusRow   = el('div', 'display:flex;align-items:center;gap:6px;margin-bottom:6px;min-height:24px;');

    function refreshStatusSection() {
      statusRow.innerHTML = '';
      const assignment = getRecordStatus(module, rn);
      if (assignment) {
        const wf    = loadWorkflows().find(w => w.id === assignment.workflowId);
        const st    = wf?.statuses.find(s => s.label === assignment.status);
        const color = st?.color ?? '#555';

        const pill = el('div', `
          font-size:10px;font-weight:700;letter-spacing:.04em;
          padding:1px 7px;border-radius:9px;user-select:none;white-space:nowrap;flex-shrink:0;
          background:${color};color:#fff;border:1px solid ${color};cursor:pointer;
        `, assignment.status);
        pill.title = 'Click to advance to next status';
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx  = wf?.statuses.findIndex(s => s.label === assignment.status) ?? -1;
          const next = wf?.statuses[idx + 1];
          setRecordStatus(module, rn, next ? { workflowId: wf.id, status: next.label } : null);
          refreshStatusSection();
          refreshBtnFn?.();
        });

        const switchBtn = el('span', 'font-size:12px;color:#666;cursor:pointer;flex-shrink:0;transition:color .1s;', '⇄');
        switchBtn.title = 'Switch workflow';
        switchBtn.addEventListener('mouseenter', () => switchBtn.style.color = '#aaa');
        switchBtn.addEventListener('mouseleave', () => switchBtn.style.color = '#666');
        switchBtn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          showWorkflowPicker(switchBtn, module, rn, () => { refreshStatusSection(); refreshBtnFn?.(); });
        });

        const clearBtn = el('span', 'font-size:15px;color:#555;cursor:pointer;flex-shrink:0;margin-left:auto;transition:color .1s;line-height:1;', '×');
        clearBtn.title = 'Clear status';
        clearBtn.addEventListener('mouseenter', () => clearBtn.style.color = '#e05555');
        clearBtn.addEventListener('mouseleave', () => clearBtn.style.color = '#555');
        clearBtn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          setRecordStatus(module, rn, null);
          refreshStatusSection();
          refreshBtnFn?.();
        });

        statusRow.append(pill, switchBtn, clearBtn);
      } else {
        const setBtn = el('div', `
          font-size:11px;color:#666;cursor:pointer;padding:2px 8px;
          border:1px solid #3a3a3a;border-radius:4px;
          transition:color .1s,border-color .1s;display:inline-block;
        `, 'Set status…');
        setBtn.addEventListener('mouseenter', () => { setBtn.style.color = '#aaa'; setBtn.style.borderColor = '#555'; });
        setBtn.addEventListener('mouseleave', () => { setBtn.style.color = '#666'; setBtn.style.borderColor = '#3a3a3a'; });
        setBtn.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          showWorkflowPicker(setBtn, module, rn, () => { refreshStatusSection(); refreshBtnFn?.(); });
        });
        statusRow.appendChild(setBtn);
      }
    }
    refreshStatusSection();

    const editWfLink = el('span', 'font-size:11px;color:#555;cursor:pointer;transition:color .1s;', 'Edit workflows…');
    editWfLink.addEventListener('mouseenter', () => editWfLink.style.color = '#aaa');
    editWfLink.addEventListener('mouseleave', () => editWfLink.style.color = '#555');
    editWfLink.addEventListener('mousedown', (e) => { e.stopPropagation(); showWorkflowEditor(); });
    const editWfRow = el('div', 'margin-bottom:10px;');
    editWfRow.appendChild(editWfLink);

    const divider = el('div', 'border-top:1px solid #333;margin:2px -12px 10px;');

    // ── Tags ─────────────────────────────────────────────────────────
    const tagsLabel = el('div', 'color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;', 'Tags');
    const tagGrid   = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;min-height:8px;');

    const refreshTagGrid = () => {
      tagGrid.innerHTML = '';
      const defs = loadTagDefs();
      if (!defs.length) {
        tagGrid.innerHTML = '<span style="font-size:11px;color:#555;font-style:italic;">No tags defined yet</span>';
        return;
      }
      defs.forEach(def => {
        const applied = tags.includes(def.name);
        const chip = el('div', `
          display:inline-flex;align-items:center;gap:4px;
          font-size:11px;padding:3px 7px;border-radius:4px;cursor:pointer;
          background:${applied ? def.color + '33' : 'transparent'};
          border:1px solid ${applied ? def.color : '#3a3a3a'};
          color:${applied ? '#ddd' : '#555'};
          transition:all 0.1s;white-space:nowrap;user-select:none;
        `, def.name);
        const del = el('span', 'cursor:pointer;color:#444;font-size:12px;margin-left:1px;line-height:1;', '×');
        del.title = 'Delete tag';
        del.addEventListener('mouseenter', () => del.style.color = '#e05555');
        del.addEventListener('mouseleave', () => del.style.color = '#444');
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          const allSections = loadCustomSections();
          allSections.forEach(s => s.items.forEach(i => { i.tags = (i.tags || []).filter(t => t !== def.name); }));
          saveCustomSections(allSections);
          const allMeta = loadItemMeta();
          Object.values(allMeta).forEach(m => { m.tags = (m.tags || []).filter(t => t !== def.name); });
          saveItemMeta(allMeta);
          saveTagDefs(loadTagDefs().filter(d => d.name !== def.name));
          saveTags(tags.filter(t => t !== def.name));
          refreshTagGrid();
        });
        chip.appendChild(del);
        chip.addEventListener('click', () => {
          const newTags = applied ? tags.filter(t => t !== def.name) : [...tags, def.name];
          tags.length = 0; tags.push(...newTags);
          saveTags(newTags);
          refreshTagGrid();
        });
        tagGrid.appendChild(chip);
      });
    };
    refreshTagGrid();

    const newTagLabel = el('div', 'color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px;', 'New Tag');
    const swatchRow   = el('div', 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:7px;');
    let activeSwEl    = null;
    PALETTE.forEach((c, i) => {
      const sw = el('div', `
        width:16px;height:16px;border-radius:3px;cursor:pointer;flex-shrink:0;
        background:${c};border:2px solid ${i === 0 ? '#fff' : '#555'};
        transition:border-color 0.1s;
      `);
      sw.addEventListener('click', () => {
        pendingColor = c;
        if (activeSwEl) activeSwEl.style.borderColor = '#555';
        sw.style.borderColor = '#fff';
        activeSwEl = sw;
        tagInput.style.borderColor = c;
      });
      if (i === 0) activeSwEl = sw;
      swatchRow.appendChild(sw);
    });

    const tagInput = el('input', `
      width:100%;box-sizing:border-box;
      background:#1e1e1e;border:1px solid ${PALETTE[0]};border-radius:4px;
      color:#e0e0e0;padding:5px 8px;font-size:11px;outline:none;
    `);
    tagInput.placeholder = 'Tag name, press Enter to create';
    tagInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const val = tagInput.value.trim();
      if (!val) return;
      const defs = loadTagDefs();
      if (!defs.some(d => d.name === val)) { defs.push({ name: val, color: pendingColor }); saveTagDefs(defs); }
      if (!tags.includes(val)) {
        const newTags = [...tags, val];
        tags.length = 0; tags.push(...newTags);
        saveTags(newTags);
      }
      tagInput.value = '';
      refreshTagGrid();
    });

    panel.append(statusLabel, statusRow, editWfRow, divider, tagsLabel, tagGrid, newTagLabel, swatchRow, tagInput);
    document.body.appendChild(panel);

    const panelEl = document.getElementById('rq-dashboard');
    panel.addEventListener('mouseenter', () => panelEl?._cancelClose?.());
    panel.addEventListener('mouseleave', (e) => {
      if (!e.relatedTarget?.closest?.('#rq-dashboard, #rq-item-editor, #rq-snooze-menu, #rq-wf-picker')) panelEl?._scheduleClose?.();
    });

    const anchorRect = anchorEl.getBoundingClientRect();
    panel.style.right = (window.innerWidth - anchorRect.left + 6) + 'px';
    panel.style.top = anchorRect.top + 'px';

    requestAnimationFrame(() => {
      const r = panel.getBoundingClientRect();
      if (r.top + r.height > window.innerHeight - 8)
        panel.style.top = (window.innerHeight - r.height - 8) + 'px';
    });

    tagInput.focus();

    const close = (ev) => {
      if (!panel.contains(ev.target) && ev.target !== anchorEl) {
        panel.remove();
        document.removeEventListener('mousedown', close, true);
      }
    };
    document.addEventListener('mousedown', close, true);
  }

  function getBuiltinSort(cardId) { try { return JSON.parse(localStorage.getItem('rq-dashboard-sort-' + cardId) || 'null'); } catch { return null; } }
  function setBuiltinSort(cardId, sort) { if (sort) localStorage.setItem('rq-dashboard-sort-' + cardId, JSON.stringify(sort)); else localStorage.removeItem('rq-dashboard-sort-' + cardId); }

  const SORT_OPTIONS = [
    { label: 'Name',       field: 'primary',   async: false },
    { label: 'Code',       field: 'secondary',  async: false },
    { label: 'Est. Start', field: 'estStart',   async: true  },
    { label: 'Est. Stop',  field: 'estStop',    async: true  },
    { label: 'Amount',     field: 'amount',     async: true  },
  ];

  function openSortMenu(anchorEl, section) {
    document.getElementById('rq-sort-menu')?.remove();

    const menu = el('div', `
      position: fixed; z-index: 100001;
      background: #242424; border: 1px solid #444; border-radius: 8px;
      padding: 6px 0; width: 190px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.65);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
    `);
    menu.id = 'rq-sort-menu';

    const rect = anchorEl.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    SORT_OPTIONS.forEach(opt => {
      const active = section.sort?.field === opt.field;
      const row = el('div', `
        display: flex; align-items: center; gap: 8px;
        padding: 6px 12px; cursor: pointer;
        background: ${active ? '#2e3a2e' : 'transparent'};
        transition: background 0.1s;
      `);
      row.addEventListener('mouseenter', () => row.style.background = active ? '#354035' : '#333');
      row.addEventListener('mouseleave', () => row.style.background = active ? '#2e3a2e' : 'transparent');

      const labelEl = el('span', `flex: 1; color: ${active ? '#8aca8a' : '#aaa'};`, opt.label);
      if (opt.async) {
        const fetch_indicator = el('span', 'font-size:9px;color:#555;', '⬇data');
        row.append(labelEl, fetch_indicator);
      } else {
        row.appendChild(labelEl);
      }

      // Dir toggles: ↑ ↓
      ['asc', 'desc'].forEach(dir => {
        const isActive = active && section.sort?.dir === dir;
        const arrow = el('span', `
          font-size: 13px; cursor: pointer; padding: 0 2px;
          color: ${isActive ? '#5a9a5a' : '#555'};
          transition: color 0.1s;
        `, dir === 'asc' ? '↑' : '↓');
        arrow.addEventListener('mouseenter', () => arrow.style.color = '#8aca8a');
        arrow.addEventListener('mouseleave', () => arrow.style.color = isActive ? '#5a9a5a' : '#555');
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.remove();
          applySectionSort(section, opt.field, dir, anchorEl);
        });
        row.appendChild(arrow);
      });

      row.addEventListener('click', () => {
        const newDir = (active && section.sort?.dir === 'asc') ? 'desc' : 'asc';
        menu.remove();
        applySectionSort(section, opt.field, newDir, anchorEl);
      });
      menu.appendChild(row);
    });

    // Clear sort
    if (section.sort) {
      const sep = el('div', 'border-top: 1px solid #333; margin: 4px 0;');
      const clearRow = el('div', 'padding: 6px 12px; cursor: pointer; color: #666; transition: background 0.1s;', 'Clear sort');
      clearRow.addEventListener('mouseenter', () => clearRow.style.background = '#333');
      clearRow.addEventListener('mouseleave', () => clearRow.style.background = '');
      clearRow.addEventListener('click', () => {
        menu.remove();
        applySectionSort(section, null, null, anchorEl);
      });
      menu.append(sep, clearRow);
    }

    document.body.appendChild(menu);

    const panelEl = document.getElementById('rq-dashboard');
    menu.addEventListener('mouseenter', () => panelEl?._cancelClose?.());
    menu.addEventListener('mouseleave', (e) => {
      if (!e.relatedTarget?.closest?.('#rq-dashboard, #rq-sort-menu, #rq-snooze-menu')) panelEl?._scheduleClose?.();
    });

    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.top + r.height > window.innerHeight - 8)
        menu.style.top = (window.innerHeight - r.height - 8) + 'px';
    });

    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorEl) {
        menu.remove();
        document.removeEventListener('mousedown', close, true);
      }
    };
    document.addEventListener('mousedown', close, true);
  }

  async function applySectionSort(section, field, dir, sortBtnEl) {
    const sections = loadCustomSections();
    const s = sections.find(s => s.id === section.id);
    if (!s) return;

    if (!field) {
      s.sort = null;
      section.sort = null;
    } else {
      const opt = SORT_OPTIONS.find(o => o.field === field);
      const cardBody = document.getElementById('rq-card-body-custom-' + section.id);

      if (opt?.async) {
        if (cardBody) cardBody.innerHTML = placeholderHTML('Sorting…');
        await Promise.all(s.items.map(item => fetchRecordDetail(item.module, item.recordNumber).catch(() => null)));
      }

      sortItemsInPlace(s.items, field, dir);

      s.sort = { field, dir };
      section.sort = { field, dir };
    }

    saveCustomSections(sections);
    loadCustomSectionItems(s);

    // Update sort button color
    if (sortBtnEl) {
      sortBtnEl.style.color = s.sort ? '#5a9a5a' : '#444';
    }
  }

  // Sort menu for built-in sections (My Orders / My Quotes). Stores sort pref in localStorage.
  function openBuiltinSortMenu(anchorEl, cardId, reloadFn) {
    document.getElementById('rq-sort-menu')?.remove();

    const currentSort = getBuiltinSort(cardId);

    const menu = el('div', `
      position: fixed; z-index: 100001;
      background: #242424; border: 1px solid #444; border-radius: 8px;
      padding: 6px 0; width: 190px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.65);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 12px;
    `);
    menu.id = 'rq-sort-menu';

    const rect = anchorEl.getBoundingClientRect();
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.right = (window.innerWidth - rect.right) + 'px';

    SORT_OPTIONS.forEach(opt => {
      const active = currentSort?.field === opt.field;
      const row = el('div', `
        display: flex; align-items: center; gap: 8px;
        padding: 6px 12px; cursor: pointer;
        background: ${active ? '#2e3a2e' : 'transparent'};
        transition: background 0.1s;
      `);
      row.addEventListener('mouseenter', () => row.style.background = active ? '#354035' : '#333');
      row.addEventListener('mouseleave', () => row.style.background = active ? '#2e3a2e' : 'transparent');

      const labelEl = el('span', `flex: 1; color: ${active ? '#8aca8a' : '#aaa'};`, opt.label);
      row.appendChild(labelEl);

      ['asc', 'desc'].forEach(dir => {
        const isActive = active && currentSort?.dir === dir;
        const arrow = el('span', `
          font-size: 13px; cursor: pointer; padding: 0 2px;
          color: ${isActive ? '#5a9a5a' : '#555'};
          transition: color 0.1s;
        `, dir === 'asc' ? '↑' : '↓');
        arrow.addEventListener('mouseenter', () => arrow.style.color = '#8aca8a');
        arrow.addEventListener('mouseleave', () => arrow.style.color = isActive ? '#5a9a5a' : '#555');
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          menu.remove();
          setBuiltinSort(cardId, { field: opt.field, dir });
          anchorEl.style.color = '#5a9a5a';
          reloadFn(true);
        });
        row.appendChild(arrow);
      });

      row.addEventListener('click', () => {
        const newDir = (active && currentSort?.dir === 'asc') ? 'desc' : 'asc';
        menu.remove();
        setBuiltinSort(cardId, { field: opt.field, dir: newDir });
        anchorEl.style.color = '#5a9a5a';
        reloadFn(true);
      });
      menu.appendChild(row);
    });

    if (currentSort) {
      const sep = el('div', 'border-top: 1px solid #333; margin: 4px 0;');
      const clearRow = el('div', 'padding: 6px 12px; cursor: pointer; color: #666; transition: background 0.1s;', 'Clear sort');
      clearRow.addEventListener('mouseenter', () => clearRow.style.background = '#333');
      clearRow.addEventListener('mouseleave', () => clearRow.style.background = '');
      clearRow.addEventListener('click', () => {
        menu.remove();
        setBuiltinSort(cardId, null);
        anchorEl.style.color = '#444';
        reloadFn(true);
      });
      menu.append(sep, clearRow);
    }

    document.body.appendChild(menu);

    const panelEl = document.getElementById('rq-dashboard');
    menu.addEventListener('mouseenter', () => panelEl?._cancelClose?.());
    menu.addEventListener('mouseleave', (e) => {
      if (!e.relatedTarget?.closest?.('#rq-dashboard, #rq-sort-menu')) panelEl?._scheduleClose?.();
    });

    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.top + r.height > window.innerHeight - 8)
        menu.style.top = (window.innerHeight - r.height - 8) + 'px';
    });

    const close = (e) => {
      if (!menu.contains(e.target) && e.target !== anchorEl) {
        menu.remove();
        document.removeEventListener('mousedown', close, true);
      }
    };
    document.addEventListener('mousedown', close, true);
  }

  function setCardContent(id, rows) {
    const body = document.getElementById('rq-card-body-' + id);
    if (!body) return;
    body.innerHTML = '';
    if (rows.length === 0) {
      body.innerHTML = '<div style="padding: 8px 14px; color: #555; font-style: italic;">Nothing here</div>';
      return;
    }
    rows.forEach(r => body.appendChild(r));
  }

  // ── Cards ──────────────────────────────────────────────────────────
  const BUILTIN_BUILDERS = {
    quicklinks: () => buildCard('Quick Links',        'apps',       'quicklinks'),
    bookmarks:  () => buildCard('Bookmarks',          'star',       'bookmarks'),
    recents:    () => buildCard('Recent Records',     'history',    'recents'),
    archive:    () => buildArchiveCard(),
    myorders:   () => buildAgentCard('myorders'),
    myquotes:   () => buildAgentCard('myquotes'),
    mypos:      () => buildAgentCard('mypos'),
    subrentals: () => buildSubRentalsCard(),
    preps:      () => buildPrepsCard(),
  };

  function renderCards() {
    const body = document.getElementById('rq-dashboard-body');
    if (!body) return;

    const tabs = loadTabs();
    if (!tabs) {
      body.innerHTML = '';
      body.appendChild(buildAddSectionButton());
      return;
    }
    const activeTab = getActiveTab(tabs);
    const sectionIds = activeTab.sections;

    const customSections = loadCustomSections();
    const customMap = Object.fromEntries(customSections.map(s => [s.id, s]));

    // Stable card element ID for a given section ID
    const cardElemId = id => BUILTIN_BUILDERS[id] ? 'rq-card-' + id : 'rq-card-custom-' + id;
    const neededElemIds = new Set(sectionIds.map(cardElemId));

    // Hide cards not in this tab (keep in DOM so content survives tab switches)
    Array.from(body.children).forEach(child => {
      if (child.id !== 'rq-add-section-btn') child.style.display = neededElemIds.has(child.id) ? '' : 'none';
    });

    // Ensure add-section button exists at end
    let addBtn = document.getElementById('rq-add-section-btn');
    if (!addBtn) { addBtn = buildAddSectionButton(); body.appendChild(addBtn); }

    // Build missing cards and reorder all visible ones before the add button
    sectionIds.forEach(id => {
      const elemId = cardElemId(id);
      let card = document.getElementById(elemId);
      if (!card) {
        if (BUILTIN_BUILDERS[id]) card = BUILTIN_BUILDERS[id]();
        else if (customMap[id]) card = buildCustomCard(customMap[id]);
        if (!card) return;
      }
      card.style.display = '';
      body.insertBefore(card, addBtn);
    });
  }

  function buildAddSectionButton() {
    const btn = el('div', `
      display: flex; align-items: center; justify-content: center; gap: 6px;
      padding: 9px 14px; cursor: pointer;
      border: 1px dashed #333; border-radius: 8px;
      color: #555; font-size: 12px;
      flex-shrink: 0;
      transition: border-color 0.15s, color 0.15s;
    `);
    btn.id = 'rq-add-section-btn';
    const icon = el('i', 'font-size: 14px;');
    icon.className = 'material-icons';
    icon.textContent = 'add';
    btn.append(icon, document.createTextNode('Add Section'));
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#555'; btn.style.color = '#aaa'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#333'; btn.style.color = '#555'; });
    btn.addEventListener('click', (e) => { e.stopPropagation(); openAddSectionMenu(btn); });
    return btn;
  }

  const BUILTIN_SECTION_DEFS = [
    { id: 'quicklinks', label: 'Quick Links',   icon: 'apps'       },
    { id: 'bookmarks',  label: 'Bookmarks',     icon: 'star'       },
    { id: 'recents',    label: 'Recent Records', icon: 'history'   },
    { id: 'archive',    label: 'Archive',        icon: 'archive'   },
    { id: 'myorders',   label: 'My Orders',      icon: 'assignment'    },
    { id: 'myquotes',   label: 'My Quotes',      icon: 'request_quote' },
    { id: 'mypos',      label: 'My POs',         icon: 'shopping_cart' },
    { id: 'subrentals', label: 'Sub Rentals',    icon: 'inventory_2'   },
    { id: 'preps',      label: 'Preps',          icon: 'event_note'    },
  ];

  function openAddSectionMenu(anchor) {
    document.getElementById('rq-add-section-menu')?.remove();

    const tabs = loadTabs();
    const activeTab = tabs ? getActiveTab(tabs) : null;
    const currentIds = new Set(activeTab?.sections ?? []);

    const menu = el('div', `
      position: fixed; z-index: 99999;
      background: #1e1e1e; border: 1px solid #333; border-radius: 6px;
      padding: 4px 0; min-width: 180px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      font-size: 12px;
    `);
    menu.id = 'rq-add-section-menu';

    const addRow = (label, icon, onClick) => {
      const row = el('div', `
        display: flex; align-items: center; gap: 8px;
        padding: 7px 14px; cursor: pointer; color: #ccc;
        transition: background 0.1s;
      `);
      const ic = el('i', 'font-size: 14px; color: #555; flex-shrink: 0;');
      ic.className = 'material-icons';
      ic.textContent = icon;
      row.append(ic, document.createTextNode(label));
      row.addEventListener('mouseenter', () => row.style.background = '#2a2a2a');
      row.addEventListener('mouseleave', () => row.style.background = '');
      row.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); onClick(); });
      menu.appendChild(row);
    };

    // Available built-ins not already in this tab
    BUILTIN_SECTION_DEFS.forEach(def => {
      if (currentIds.has(def.id)) return;
      addRow(def.label, def.icon, () => addBuiltinSection(def.id));
    });

    // Divider if there were any built-ins
    const availableBuiltins = BUILTIN_SECTION_DEFS.filter(d => !currentIds.has(d.id));
    if (availableBuiltins.length > 0) {
      menu.appendChild(el('div', 'border-top: 1px solid #333; margin: 4px 0;'));
    }

    addRow('Custom Section', 'edit_note', addCustomSection);

    const rect = anchor.getBoundingClientRect();
    menu.style.left = rect.left + 'px';
    menu.style.top  = (rect.top - 4) + 'px';
    menu.style.transform = 'translateY(-100%)';
    document.body.appendChild(menu);

    const dismiss = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('click', dismiss, true); } };
    setTimeout(() => document.addEventListener('click', dismiss, true), 0);

    const panelEl = document.getElementById('rq-dashboard');
    menu.addEventListener('mouseenter', () => panelEl?._cancelClose?.());
    menu.addEventListener('mouseleave', (e) => { if (!e.relatedTarget?.closest?.('#rq-dashboard, #rq-add-section-menu')) panelEl?._scheduleClose?.(); });
  }

  function addBuiltinSection(id) {
    const tabs = loadTabs();
    if (!tabs) return;
    const activeTab = getActiveTab(tabs);
    if (activeTab.sections.includes(id)) return;
    activeTab.sections.push(id);
    saveTabs(tabs);
    renderCards();
    refreshCards();
  }

  function addCustomSection() {
    const section = { id: genId(), title: 'New Section', items: [] };
    const sections = loadCustomSections();
    sections.push(section);
    saveCustomSections(sections);

    // Register in active tab immediately
    const tabs = loadTabs();
    if (tabs) {
      const activeTab = getActiveTab(tabs);
      activeTab.sections.push(section.id);
      saveTabs(tabs);
    }

    const addBtn = document.getElementById('rq-add-section-btn');
    const card = buildCustomCard(section);
    addBtn.before(card);
    loadCustomSectionItems(section);
    persistSectionOrder();

    const titleSpan = card.querySelector('span');
    if (titleSpan) startRenameSection(section.id, titleSpan);
  }

  function refreshCards() {
    const tabs = loadTabs();
    if (!tabs) return;
    const activeTab = getActiveTab(tabs);
    const visibleIds = new Set(activeTab.sections);
    if (visibleIds.has('quicklinks')) loadQuickLinks();
    if (visibleIds.has('bookmarks'))  loadBookmarks();
    if (visibleIds.has('recents'))    loadRecents();
    if (visibleIds.has('archive'))    loadArchiveItems();
    if (visibleIds.has('myorders'))   loadMyOrders();
    if (visibleIds.has('myquotes'))   loadMyQuotes();
    if (visibleIds.has('mypos'))      loadMyPOs();
    if (visibleIds.has('subrentals')) loadSubRentals();
    if (visibleIds.has('preps'))      loadPreps();
    loadCustomSections()
      .filter(s => visibleIds.has(s.id))
      .forEach(section => loadCustomSectionItems(section));
  }

  // ── Built-in card loaders ──────────────────────────────────────────
  const MODULE_ICONS = {
    Order: 'assignment', Quote: 'request_quote', Deal: 'handshake',
    Customer: 'person', RentalInventory: 'videocam', Asset: 'qr_code',
    PurchaseOrder: 'shopping_cart'
  };

  const QUICK_LINKS_KEY = 'rq-dashboard-quicklinks-order';
  const QLICONS = [
    'assignment','request_quote','receipt','description','article','feed',
    'category','label','tag','folder','folder_open','work','business','store','build',
    'local_shipping','directions_car','person','group','people','person_add',
    'attach_money','payments','account_balance','credit_card','discount','percent','calculate',
    'email','phone','message','chat','forum','send',
    'check_circle','cancel','error','warning','flag','info','help','report',
    'calendar_today','schedule','access_time','event','timer','alarm',
    'search','filter_list','sort','refresh','sync','history',
    'edit','delete','add','remove','save','print','share',
    'upload','download','open_in_new','launch','link','attach_file','content_copy',
    'home','dashboard','apps','widgets','settings','tune',
    'bookmark','push_pin','star','favorite','visibility','notifications',
    'grid_view','view_list','format_list_bulleted','layers','map','place','location_on',
    'qr_code','videocam','camera','computer','storage','cloud','security','lock','lock_open',
    'login','logout','shopping_cart',
  ];
  // Full pool of available quick links (user picks which to show)
  const QUICK_LINKS_ALL = [
    { caption: 'Order',            nav: 'module/order',           icon: 'assignment'     },
    { caption: 'Quote',            nav: 'module/quote',           icon: 'request_quote'  },
    { caption: 'Purchase Order',   nav: 'module/purchaseorder',   icon: 'shopping_cart'  },
    { caption: 'Contract',         nav: 'module/contract',        icon: 'description'    },
    { caption: 'Invoice',          nav: 'module/invoice',         icon: 'receipt'        },
    { caption: 'Rental Inventory', nav: 'module/rentalinventory', icon: 'videocam'       },
    { caption: 'Check-In',         nav: 'module/checkin',         icon: 'login'          },
    { caption: 'Check-Out',        nav: 'module/checkout',        icon: 'logout'         },
    { caption: 'Asset',            nav: 'module/item',            icon: 'qr_code'        },
    { caption: 'Customer',         nav: 'module/customer',        icon: 'person'         },
    { caption: 'Deal',             nav: 'module/deal',            icon: 'business_center'},
    { caption: 'QuikSearch',       nav: 'module/quiksearch',      icon: 'search'         },
  ];
  // Default visible set (nav strings)
  const QUICK_LINKS_DEFAULT_NAVS = [
    'module/order', 'module/quote', 'module/rentalinventory',
    'module/checkin', 'module/checkout', 'module/item', 'module/customer', 'module/deal',
    'module/quiksearch',
  ];

  // ── My Orders card ─────────────────────────────────────────────────

  // Shared builder for the agent-driven section cards (My Orders / My POs / My Quotes).
  // Per-card differences come from AGENT_SECTIONS; an optional cfg.buildExtras(card, frag, load)
  // hook adds extra cfg-bar controls (e.g. the My Quotes due-date toggle).
  function buildAgentCard(cardId) {
    const cfg = AGENT_SECTIONS[cardId];
    const card = buildCard(cfg.title, cfg.icon, cardId);
    const load = (force) => loadAgentSection(cardId, force);

    const agentInput = document.createElement('input');
    agentInput.type = 'text';
    agentInput.placeholder = 'Agent name…';
    agentInput.value = localStorage.getItem(cfg.agentKey) || '';
    agentInput.style.cssText = CFG_INPUT_CSS;
    agentInput.addEventListener('click', e => e.stopPropagation());
    agentInput.addEventListener('dragstart', e => e.stopPropagation());

    const applyBtn = el('button', CFG_APPLY_BTN_CSS, 'Apply');
    applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = agentInput.value.trim();
      if (name) localStorage.setItem(cfg.agentKey, name);
      else localStorage.removeItem(cfg.agentKey);
      clearCachedSection(cardId);
      load();
    });
    agentInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyBtn.click(); e.stopPropagation(); });

    // Sort button colour reflects whether a sort is active, so it can't use makeIconButton.
    const sortColor = () => getBuiltinSort(cardId) ? '#5a9a5a' : '#444';
    const sortBtn = el('i', `font-size: 15px; cursor: pointer; flex-shrink: 0; color: ${sortColor()}; transition: color 0.15s;`);
    sortBtn.className = 'material-icons';
    sortBtn.textContent = 'swap_vert';
    sortBtn.title = 'Sort';
    sortBtn.addEventListener('mouseenter', () => sortBtn.style.color = getBuiltinSort(cardId) ? '#7aca7a' : '#888');
    sortBtn.addEventListener('mouseleave', () => sortBtn.style.color = sortColor());
    sortBtn.addEventListener('click', (e) => { e.stopPropagation(); openBuiltinSortMenu(sortBtn, cardId, load); });

    const refreshBtn = makeIconButton('refresh', {
      title: 'Refresh',
      onClick: () => { clearCachedSection(cardId); load(true); },
    });

    // Prepend agent input + apply to the cfg bar (badge toggle and remove × already there)
    const inputWrap = el('div', '');
    inputWrap.className = 'rq-cfg-input-wrap';
    inputWrap.appendChild(agentInput);
    const frag = document.createDocumentFragment();
    frag.append(inputWrap, applyBtn);
    cfg.buildExtras?.(card, frag, load);
    card._cfgBar.insertBefore(frag, card._cfgBar.firstChild);

    // Header: sort before cfg toggle, refresh before collapse
    card._cfgToggleBtn.insertAdjacentElement('beforebegin', sortBtn);
    card._collapseBtn.insertAdjacentElement('beforebegin', refreshBtn);
    return card;
  }

  // My Quotes only: a cfg-bar toggle for whether the due-date badge uses the quote's
  // start date or end date. Appended after the Apply button.
  function addQuotesDueToggle(card, frag, load) {
    const dueDateBtn = el('button', `
      background: #1a1a2a; border: 1px solid #2a2a4a; color: #8ab; border-radius: 3px;
      padding: 5px 8px; font-size: 11px; cursor: pointer; flex-shrink: 0; white-space: nowrap;
      transition: color 0.15s, border-color 0.15s;
    `);
    const applyDueDateBtn = () => {
      const useStart = localStorage.getItem(MY_QUOTES_DUE_KEY) === 'start';
      dueDateBtn.textContent = useStart ? 'due: start' : 'due: end';
      dueDateBtn.title = useStart ? 'Showing start date — click to use end date' : 'Showing end date — click to use start date';
      dueDateBtn.style.borderColor = useStart ? '#4a6a8a' : '#2a2a4a';
      dueDateBtn.style.color = useStart ? '#acd' : '#8ab';
    };
    applyDueDateBtn();
    dueDateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowStart = localStorage.getItem(MY_QUOTES_DUE_KEY) !== 'start';
      localStorage.setItem(MY_QUOTES_DUE_KEY, nowStart ? 'start' : 'stop');
      applyDueDateBtn();
      const body = document.getElementById('rq-card-body-myquotes');
      body?.querySelectorAll('.rq-card-row').forEach(row => {
        row.querySelectorAll('.rq-due-badge').forEach(b => b.remove());
        const rn = row.dataset.recordNumber;
        if (rn) attachDueBadge(row, 'Quote', rn, null, 'myquotes');
      });
    });
    frag.append(dueDateBtn);
  }

  // ── Agent-driven sections (My Orders / My POs / My Quotes) ─────────
  // These three share identical fetch/cache/render plumbing, differing only in
  // the fields below. They use stale-while-revalidate: cached data renders
  // immediately (no spinner) and a background refetch runs only when the cache
  // is older than AGENT_CACHE_TTL (or forceRefresh is set). The spinner shows
  // only on a cold cache; a failed background refresh leaves stale data in place.
  const AGENT_SECTIONS = {
    myorders: { title: 'My Orders', agentKey: MY_ORDERS_AGENT_KEY, controller: 'OrderController',
                module: 'Order',         icon: 'assignment',    numberField: 'OrderNumber',
                hidden: ['CANCELLED', 'CLOSED'],            unavailable: 'Order module not available',          failed: 'Failed to load orders' },
    mypos:    { title: 'My POs', agentKey: MY_POS_AGENT_KEY,    controller: 'PurchaseOrderController',
                module: 'PurchaseOrder', icon: 'shopping_cart', numberField: 'PurchaseOrderNumber',
                listItems: fetchPurchaseOrderItems, rowFilter: hasAnyScheduleDate,
                hidden: ['CLOSED', 'VOID'],                 unavailable: 'Purchase Order module not available', failed: 'Failed to load POs' },
    myquotes: { title: 'My Quotes', agentKey: MY_QUOTES_AGENT_KEY, controller: 'QuoteController',
                module: 'Quote',         icon: 'request_quote', numberField: 'QuoteNumber',
                hidden: ['CANCELLED', 'CLOSED', 'ORDERED'], unavailable: 'Quote module not available',          failed: 'Failed to load quotes',
                buildExtras: addQuotesDueToggle },
  };

  // Hides records with neither an estimated start nor stop date. A PO with just
  // one of the two is still scheduled, so it stays - only the entirely undated
  // ones are noise on a card about what is coming up.
  //
  // The list response may not carry these fields at all; the Est. Start/Stop sort
  // options fetch per-record detail for exactly that reason. When the fields are
  // absent rather than empty this keeps every row and says so once, because
  // hiding everything would be far worse than hiding nothing.
  let warnedNoScheduleDates = false;
  function hasAnyScheduleDate(r) {
    if (!('EstimatedStartDate' in r) && !('EstimatedStopDate' in r)) {
      if (!warnedNoScheduleDates) {
        warnedNoScheduleDates = true;
        console.warn('[RQ] List rows carry no EstimatedStartDate/EstimatedStopDate, ' +
                     'so undated records cannot be hidden without a fetch per row. Showing all.');
      }
      return true;
    }
    return !!String(r.EstimatedStartDate || '').trim() ||
           !!String(r.EstimatedStopDate  || '').trim();
  }

  // Pre-populate detailCache from list items so sort-by-date/amount works
  // immediately and an open detail row picks up the latest Status without a refetch.
  function prePopulateDetailCache(cfg, items) {
    items.forEach(item => {
      const key = cfg.module + ':' + item[cfg.numberField];
      const _ex = detailCache.get(key);
      if (_ex?.data?.record) _ex.data.record.Status = item.Status ?? _ex.data.record.Status;
      else detailCache.set(key, { data: { module: cfg.module, record: item, items: [], avail: null }, fetchedAt: 0 });
    });
  }

  function loadAgentSection(cardId, forceRefresh = false) {
    const cfg = AGENT_SECTIONS[cardId];
    const body = document.getElementById('rq-card-body-' + cardId);
    if (!body) return;

    const agent = localStorage.getItem(cfg.agentKey);
    if (!agent) {
      body.innerHTML = placeholderHTML('Set your agent name above');
      return;
    }

    const cached = getCachedSection(cardId);
    const fresh  = cached && (Date.now() - cached.fetchedAt) < AGENT_CACHE_TTL;

    // Render cached data immediately, but skip the re-render if rows are already
    // on screen (e.g. reopening the panel) to avoid needless flicker.
    if (cached && !body.querySelector('.rq-card-row')) {
      prePopulateDetailCache(cfg, cached.items);
      renderBuiltinRows(cardId, cached.items, cfg.module, cfg.icon);
    }

    // Hit the network only when forced or when the cache is stale/cold.
    if (!forceRefresh && fresh) return;
    if (!cached) body.innerHTML = placeholderHTML('Loading…');

    const controller = window[cfg.controller];
    if (!controller?.apiurl) {
      if (!cached) body.innerHTML = placeholderHTML(cfg.unavailable);
      return;
    }

    const fetchOpts = {
      headers: {
        'authorization': 'Bearer ' + sessionStorage.apiToken,
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      }
    };
    const filter = encodeURIComponent(JSON.stringify({ Field: 'Agent', Op: '=', Value: agent.toUpperCase() }));
    fetch(RW_URL + controller.apiurl + '?pagesize=50&filter=' + filter, fetchOpts)
      .then(r => r.json())
      .then(r => {
        const hidden = new Set(cfg.hidden);
        const keep = cfg.rowFilter ?? (() => true);
        const items = (r?.Items ?? []).filter(i => !hidden.has(i.Status) && keep(i));
        prePopulateDetailCache(cfg, items);
        setCachedSection(cardId, { items, fetchedAt: Date.now() });
        renderBuiltinRows(cardId, items, cfg.module, cfg.icon);
      })
      .catch(() => {
        // Leave stale data visible on a background-refresh failure; only a cold cache shows the error.
        if (!cached) body.innerHTML = placeholderHTML(cfg.failed);
      });
  }

  function loadMyPOs(forceRefresh = false) { loadAgentSection('mypos', forceRefresh); }

  // Shared renderer for My Orders / My Quotes. `apiItems` are raw API response objects.
  // `numberField` is the record-number field name on the API item (e.g. 'OrderNumber').
  function renderBuiltinRows(cardId, apiItems, module, icon) {
    const body = document.getElementById('rq-card-body-' + cardId);
    if (!body) return;
    body.innerHTML = '';

    if (!apiItems || apiItems.length === 0) {
      body.innerHTML = placeholderHTML('No records found');
      return;
    }

    const numberField = module === 'Order' ? 'OrderNumber' : module === 'Quote' ? 'QuoteNumber' : module + 'Number';
    const idField = RQ.api.module_identifier_names(module)?.id;

    // Build lightweight item descriptors for sorting
    const sortable = apiItems.map(item => ({
      primary:      item.Description || item[numberField],
      secondary:    item[numberField],
      module,
      recordNumber: item[numberField],
      _raw:         item,
    }));

    const itemFetcher = AGENT_SECTIONS[cardId]?.listItems ?? null;
    const itemTargets = [];

    const sort = getBuiltinSort(cardId);
    if (sort) sortItemsInPlace(sortable, sort.field, sort.dir);

    sortable.forEach((desc, idx) => {
      const { primary, secondary, recordNumber, _raw } = desc;
      const metaEntry = getItemMetaEntry(module, recordNumber);
      const tags = metaEntry.tags || [];
      const notes = metaEntry.notes || '';

      const row = draggableCardRow(
        icon, primary, secondary,
        () => { if (idField && _raw[idField]) RQ.api.open_form_tab(module, _raw[idField]); },
        { icon, primary, secondary, module, recordNumber, cardId, tags, notes, vendor: _raw.Vendor || null, customer: _raw.Customer || _raw.CustomerName || null },
        null // no archive for agent-driven sections
      );
      row.dataset.rowIndex = idx;
      body.appendChild(row);

      if (itemFetcher && idField && _raw[idField]) {
        // Sibling of the row, not a child: the row itself is a single flex line.
        const holder = el('div', 'padding: 0 14px 5px 40px;');
        holder.className = 'rq-row-items';
        body.appendChild(holder);
        itemTargets.push({ id: _raw[idField], holder });
      }
    });

    if (itemTargets.length) fillRowItems(itemTargets, itemFetcher);
  }

  function loadMyOrders(forceRefresh = false) { loadAgentSection('myorders', forceRefresh); }

  function loadMyQuotes(forceRefresh = false) { loadAgentSection('myquotes', forceRefresh); }

  // ── Line items under agent-card rows ──────────────────────────────
  // Shows a record's lines beneath its row, a few at a time with an expander.
  const ROW_ITEMS_PREVIEW = 4;
  const ROW_ITEMS_TTL     = 10 * 60 * 1000;
  const rowItemsCache = new Map(); // recordId -> { items, fetchedAt }

  // Every RW grid /browse wants the same envelope; only the module, the scoping
  // fields and the sort differ. Kept in one place so a third grid doesn't become
  // a third copy of twenty boilerplate keys.
  function buildGridBrowsePayload({ module, miscfields, uniqueids, orderby, pagesize = 500 }) {
    return {
      activeview: '', boundids: {}, clientVersion: window.applicationConfig?.clientVersion ?? '',
      fields: [], filterfields: {}, miscfields, module, options: {},
      orderby, orderbydirection: '', pageno: 1, pagesize,
      requestid: (crypto?.randomUUID?.() ?? String(Date.now()) + Math.random()),
      searchcondition: [], searchconjunctions: [], searchfieldoperators: [], searchfields: [],
      searchfieldtypes: [], searchfieldvalues: [], searchgroupings: [], searchseparators: [],
      timezoneOffset: -new Date().getTimezoneOffset() / 60,
      top: 0, totalfields: [], uniqueids,
    };
  }

  function postGridBrowse(path, payload) {
    return fetch(RW_URL + path, { method: 'POST', headers: rwHeaders(), body: JSON.stringify(payload) })
      .then(r => (r.ok ? r.json() : null))
      .then(decodeGridRows)
      .catch(() => []);
  }

  // Purchase order lines. RW serves these from the *order* item grid: module
  // OrderItemGrid, scoped by miscfields.PurchaseOrderId, with the PO's id passed
  // in uniqueids under the key OrderId. Subs and NoAvailabilityCheck mirror what
  // the PO screen itself sends.
  function fetchPurchaseOrderItems(poId) {
    return postGridBrowse('api/v1/orderitem/browse', buildGridBrowsePayload({
      module: 'OrderItemGrid',
      miscfields: { PurchaseOrderId: { datafield: 'PurchaseOrderId', value: poId } },
      uniqueids: { OrderId: poId, RecType: 'R', Subs: true, NoAvailabilityCheck: true },
      orderby: 'ItemOrder asc,PrimaryOrderItemId asc,SubPurchaseOrderItemId asc,' +
               'OrderItemId asc,PoSubOrderNumber asc',
    }));
  }

  // Column names differ between grids, so take the first candidate that is present
  // rather than assuming one spelling.
  function pickField(row, names) {
    for (const n of names) {
      const v = row?.[n];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  }

  const ITEM_CODE_FIELDS = ['ICode', 'ItemCode', 'Code'];
  const ITEM_DESC_FIELDS = ['Description', 'ItemDescription'];
  const ITEM_QTY_FIELDS  = ['QuantityOrdered', 'Quantity', 'OrderQuantityOrdered', 'SubQuantity', 'Qty'];

  function buildRowItemLine(it) {
    const line = el('div', `
      display: flex; gap: 8px; align-items: baseline;
      margin-top: 2px; font-size: 11px; color: #888;`);
    const code = pickField(it, ITEM_CODE_FIELDS);
    const desc = pickField(it, ITEM_DESC_FIELDS);
    line.appendChild(el('span', 'color: #7a9aba; flex-shrink: 0; min-width: 62px;', code ?? ''));
    line.appendChild(el('span', `
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto;`, desc ?? ''));
    const qty = Number(pickField(it, ITEM_QTY_FIELDS));
    if (Number.isFinite(qty) && qty) {
      line.appendChild(el('span', 'color: #666; flex-shrink: 0;',
                          '×' + (qty % 1 ? qty : qty.toFixed(0))));
    }
    return line;
  }

  // Renders a preview of `items` with a "+N more" toggle. Collapsing again is
  // useful when a record has fifty lines and you only opened it to glance.
  // buildLine is overridable so callers can annotate their own line shape.
  function renderRowItems(holder, items, buildLine = buildRowItemLine) {
    holder.innerHTML = '';
    if (!items || !items.length) return;

    let expanded = false;
    const list = el('div', '');
    const toggle = el('div', `
      margin-top: 2px; font-size: 10px; color: #5a7a8a; cursor: pointer; user-select: none;`);

    const draw = () => {
      list.innerHTML = '';
      const shown = expanded ? items : items.slice(0, ROW_ITEMS_PREVIEW);
      shown.forEach(it => list.appendChild(buildLine(it)));
      const hidden = items.length - shown.length;
      if (hidden > 0)      { toggle.textContent = `+${hidden} more`; toggle.style.display = ''; }
      else if (expanded && items.length > ROW_ITEMS_PREVIEW) { toggle.textContent = 'show less'; toggle.style.display = ''; }
      else                 { toggle.style.display = 'none'; }
    };

    toggle.addEventListener('click', (e) => { e.stopPropagation(); expanded = !expanded; draw(); });
    toggle.addEventListener('mouseenter', () => { toggle.style.color = '#8ac'; });
    toggle.addEventListener('mouseleave', () => { toggle.style.color = '#5a7a8a'; });

    holder.append(list, toggle);
    draw();
  }

  // Fills each row's item holder, a few requests at a time so a card of 50 rows
  // doesn't fire 50 parallel fetches. Cached results render immediately.
  async function fillRowItems(targets, fetcher) {
    const pending = [];
    for (const t of targets) {
      const hit = rowItemsCache.get(t.id);
      if (hit && (Date.now() - hit.fetchedAt) < ROW_ITEMS_TTL) renderRowItems(t.holder, hit.items);
      else pending.push(t);
    }
    if (!pending.length) return;

    await mapWithLimit(pending, SUBRENTAL_CONCURRENCY, async (t) => {
      const items = await fetcher(t.id);
      rowItemsCache.set(t.id, { items, fetchedAt: Date.now() });
      if (t.holder.isConnected) renderRowItems(t.holder, items);
    });
  }

  // ── Sub Rentals card ──────────────────────────────────────────────
  // Sub-rental lines still waiting to be sourced, across orders picking soon,
  // so they can be chased before the pick date arrives.
  //
  // Two round trips are unavoidable. A sub-item row carries its order's number,
  // agent, customer and estimated dates - but not PickDate - so the orders in the
  // window must be found first, then each one's sub-items fetched. RW's
  // ordersubitem endpoint is a grid /browse: it rejects GET, wants the order in
  // miscfields/uniqueids, and answers columnar (ColumnIndex + Rows-of-arrays)
  // rather than the { Items: [...] } shape the rest of this file expects.
  const SUBRENTAL_DAYS_KEY    = 'rq-dashboard-subrental-days';
  const SUBRENTAL_TTL         = 10 * 60 * 1000;
  const SUBRENTAL_CONCURRENCY = 5;  // ~24 orders in a 3-week window; keep the UI responsive
  const SUBRENTAL_SKIP_STATUS = new Set(['CANCELLED', 'CLOSED', 'VOID']);

  function subRentalDays() {
    const n = parseInt(localStorage.getItem(SUBRENTAL_DAYS_KEY), 10);
    return Number.isFinite(n) && n > 0 ? n : 21;
  }

  function rwHeaders() {
    return { authorization: 'Bearer ' + sessionStorage.apiToken,
             'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
  }

  // RW grid endpoints answer with ColumnIndex (field -> position) and Rows of
  // positional arrays. Turn that back into plain objects.
  function decodeGridRows(json) {
    const idx = json?.ColumnIndex;
    if (!idx || !Array.isArray(json.Rows)) return [];
    const names = Object.keys(idx);
    return json.Rows.map(row => {
      const o = {};
      for (const n of names) o[n] = row[idx[n]];
      return o;
    });
  }

  function fetchOrderSubItems(orderId) {
    return postGridBrowse('api/v1/ordersubitem/browse', buildGridBrowsePayload({
      module: 'OrderSubItemGrid',
      miscfields: { OrderId: { datafield: 'OrderId', value: orderId } },
      uniqueids: { OrderId: orderId, RecType: 'R' },
      orderby: 'ItemOrder asc',
    }));
  }

  // Sourcing attaches both a vendor and a sub-PO, so a line missing either is not
  // finished. Treating "either missing" as outstanding also surfaces half-done
  // lines - a vendor picked but no PO raised - which are exactly worth chasing.
  function subItemNeedsSourcing(r) {
    return !String(r.Vendor || '').trim() || !String(r.PurchaseOrderNumber || '').trim();
  }

  // Runs fn over items with at most `limit` in flight, preserving order.
  async function mapWithLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }));
    return out;
  }

  async function loadSubRentals(forceRefresh = false) {
    const body = document.getElementById('rq-card-body-subrentals');
    if (!body) return;

    const cached = getCachedSection('subrentals');
    const fresh  = cached && (Date.now() - cached.fetchedAt) < SUBRENTAL_TTL;
    if (cached && !body.querySelector('.rq-subrental-order')) renderSubRentals(cached.groups);
    if (!forceRefresh && fresh) return;
    if (!cached) body.innerHTML = placeholderHTML('Loading…');

    const controller = window.OrderController;
    if (!controller?.apiurl) {
      if (!cached) body.innerHTML = placeholderHTML('Order module not available');
      return;
    }

    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + subRentalDays());
    const ymd = d => d.toLocaleDateString('en-CA'); // local YYYY-MM-DD, not UTC
    const filter = encodeURIComponent(JSON.stringify([
      { Field: 'PickDate', Op: '>=', Value: ymd(from) },
      { Field: 'PickDate', Op: '<=', Value: ymd(to)   },
    ]));

    try {
      const res = await fetch(RW_URL + controller.apiurl + '?pagesize=200&filter=' + filter,
                              { headers: rwHeaders() });
      if (!res.ok) throw new Error('orders ' + res.status);
      const orders = ((await res.json()).Items ?? [])
        .filter(o => !SUBRENTAL_SKIP_STATUS.has(String(o.Status || '').toUpperCase()));

      const perOrder = await mapWithLimit(orders, SUBRENTAL_CONCURRENCY, async (o) => ({
        order: o,
        items: (await fetchOrderSubItems(o.OrderId)).filter(subItemNeedsSourcing),
      }));

      const groups = groupSubRentalsByPickDate(perOrder.filter(g => g.items.length));
      setCachedSection('subrentals', { groups, fetchedAt: Date.now() });
      renderSubRentals(groups);
    } catch {
      // Leave stale data visible on a background refresh; only a cold card shows the error.
      if (!cached) body.innerHTML = placeholderHTML('Failed to load sub rentals');
    }
  }

  function groupSubRentalsByPickDate(entries) {
    const byDate = new Map();
    for (const e of entries) {
      const key = String(e.order.PickDate || '').slice(0, 10) || 'nodate';
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(e);
    }
    return [...byDate.entries()]
      .sort((a, b) => (a[0] === 'nodate') - (b[0] === 'nodate') || a[0].localeCompare(b[0]))
      .map(([dateStr, list]) => ({
        dateStr,
        entries: list.sort((a, b) => String(a.order.OrderNumber).localeCompare(String(b.order.OrderNumber))),
      }));
  }

  function renderSubRentals(groups) {
    const body = document.getElementById('rq-card-body-subrentals');
    if (!body) return;
    body.innerHTML = '';

    if (!groups || !groups.length) {
      body.innerHTML = placeholderHTML('Nothing waiting to be sourced');
      return;
    }

    const todayStr = new Date().toLocaleDateString('en-CA');
    groups.forEach((g, gi) => {
      const isToday = g.dateStr === todayStr;
      const overdue = g.dateStr !== 'nodate' && g.dateStr < todayStr;
      const label = g.dateStr === 'nodate' ? 'No pick date'
        : isToday ? 'Today'
        : new Date(g.dateStr + 'T00:00:00').toLocaleDateString('en-US',
            { weekday: 'long', month: 'long', day: 'numeric' });

      body.appendChild(el('div', `
        padding: 5px 14px 3px;
        font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
        color: ${overdue ? '#e05555' : isToday ? '#5a9a5a' : '#666'};
        ${gi > 0 ? 'border-top: 1px solid #222;' : ''}
      `, label));

      g.entries.forEach(({ order, items }) => body.appendChild(buildSubRentalOrderBlock(order, items)));
    });
  }

  function buildSubRentalOrderBlock(order, items) {
    const wrap = el('div', 'padding: 3px 14px 7px;');
    wrap.className = 'rq-subrental-order';

    const head = el('div', 'display: flex; align-items: baseline; gap: 7px; cursor: pointer;');
    head.appendChild(el('span', 'font-size: 12px; font-weight: 600; color: #ccc; flex-shrink: 0;',
                        order.OrderNumber || ''));
    head.appendChild(el('span', `
      font-size: 12px; color: #999; overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap; flex: 1 1 auto;`, order.Description || ''));
    if (order.Agent) {
      head.appendChild(el('span', 'font-size: 10px; color: #6a8a9a; flex-shrink: 0;', order.Agent));
    }
    head.addEventListener('mouseenter', () => { head.style.opacity = '0.8'; });
    head.addEventListener('mouseleave', () => { head.style.opacity = ''; });
    head.addEventListener('click', () => {
      if (order.OrderId) RQ.api.open_form_tab('Order', order.OrderId);
      else if (order.OrderNumber) RQ.api.open_record_by_number('Order', order.OrderNumber);
    });
    wrap.appendChild(head);

    const holder = el('div', 'padding-left: 12px;');
    renderRowItems(holder, items, buildSubRentalItemLine);
    wrap.appendChild(holder);

    return wrap;
  }

  // Same shape as a PO line, plus a note when a vendor is set but no PO has been
  // raised - that line is half-sourced rather than untouched.
  function buildSubRentalItemLine(it) {
    const line = buildRowItemLine(it);
    if (String(it.Vendor || '').trim()) {
      line.appendChild(el('span', 'color: #7a6a4a; flex-shrink: 0;',
                          it.Vendor + ' · no PO'));
    }
    return line;
  }

  function buildSubRentalsCard() {
    const card = buildCard('Sub Rentals', 'inventory_2', 'subrentals');

    const daysInput = document.createElement('input');
    daysInput.type = 'text';
    daysInput.placeholder = 'Days ahead…';
    daysInput.value = String(subRentalDays());
    daysInput.style.cssText = CFG_INPUT_CSS;
    daysInput.addEventListener('click', e => e.stopPropagation());
    daysInput.addEventListener('dragstart', e => e.stopPropagation());

    const applyBtn = el('button', CFG_APPLY_BTN_CSS, 'Apply');
    applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const n = parseInt(daysInput.value.trim(), 10);
      if (Number.isFinite(n) && n > 0) localStorage.setItem(SUBRENTAL_DAYS_KEY, String(n));
      else localStorage.removeItem(SUBRENTAL_DAYS_KEY);
      daysInput.value = String(subRentalDays());
      clearCachedSection('subrentals');
      loadSubRentals(true);
    });
    daysInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyBtn.click();
      e.stopPropagation();
    });

    const refreshBtn = makeIconButton('refresh', {
      title: 'Refresh',
      onClick: () => { clearCachedSection('subrentals'); loadSubRentals(true); },
    });

    card._badgeToggleBtn?.remove(); // no per-row due badges on this card

    const inputWrap = el('div', '');
    inputWrap.className = 'rq-cfg-input-wrap';
    inputWrap.appendChild(daysInput);
    const frag = document.createDocumentFragment();
    frag.append(inputWrap, applyBtn);
    card._cfgBar.insertBefore(frag, card._cfgBar.firstChild);

    card._collapseBtn.insertAdjacentElement('beforebegin', refreshBtn);
    return card;
  }

  // ── Preps card (Google Sheets daily prep schedule) ─────────────────

  function buildPrepsCard() {
    const card = buildCard('Preps', 'event_note', 'preps');

    const urlInput = document.createElement('input');
    urlInput.type = 'text';
    urlInput.placeholder = 'Google Sheet URL…';
    urlInput.value = localStorage.getItem(PREPS_SHEET_KEY) || '';
    urlInput.style.cssText = CFG_INPUT_CSS;
    urlInput.addEventListener('click', e => e.stopPropagation());
    urlInput.addEventListener('dragstart', e => e.stopPropagation());

    const applyBtn = el('button', CFG_APPLY_BTN_CSS, 'Apply');
    applyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = urlInput.value.trim();
      if (url) localStorage.setItem(PREPS_SHEET_KEY, url);
      else localStorage.removeItem(PREPS_SHEET_KEY);
      clearPrepsCache();
      loadPreps();
    });
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyBtn.click(); e.stopPropagation(); });

    const refreshBtn = makeIconButton('refresh', {
      title: 'Refresh',
      onClick: () => { clearPrepsCache(); loadPreps(); },
    });

    const currentView = localStorage.getItem(PREPS_VIEW_KEY) || 'list';
    const viewBtn = makeIconButton(currentView === 'floor' ? 'list' : 'grid_view', {
      title: currentView === 'floor' ? 'Switch to list view' : 'Switch to floor plan view',
      onClick: () => {
        const next = (localStorage.getItem(PREPS_VIEW_KEY) || 'list') === 'floor' ? 'list' : 'floor';
        localStorage.setItem(PREPS_VIEW_KEY, next);
        viewBtn.textContent = next === 'floor' ? 'list' : 'grid_view';
        viewBtn.title = next === 'floor' ? 'Switch to list view' : 'Switch to floor plan view';
        const _pc = getCachedPreps(); if (_pc) renderPreps(_pc.groups, _pc.rwData);
      },
    });

    // Preps don't have due-date badges — remove badge toggle from cfg bar
    card._badgeToggleBtn?.remove();

    const inputWrap = el('div', '');
    inputWrap.className = 'rq-cfg-input-wrap';
    inputWrap.appendChild(urlInput);
    const frag = document.createDocumentFragment();
    frag.append(inputWrap, applyBtn);
    card._cfgBar.insertBefore(frag, card._cfgBar.firstChild);
    // cfgBar: [inputWrap][applyBtn][removeBtn×]

    // viewBtn in the "sort" slot, refresh before collapse
    card._cfgToggleBtn.insertAdjacentElement('beforebegin', viewBtn);
    card._collapseBtn.insertAdjacentElement('beforebegin', refreshBtn);
    return card;
  }

  function fetchOrdersByNumbers(orderNumbers) {
    // Returns a Map<orderNumber, apiItem> with Description, Customer, etc. from RW.
    const controller = window.OrderController;
    if (!controller?.apiurl || !orderNumbers.length) return Promise.resolve(new Map());
    const fetchOpts = {
      headers: {
        'authorization': 'Bearer ' + sessionStorage.apiToken,
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      }
    };
    return Promise.all(
      orderNumbers.map(no =>
        fetch(RW_URL + controller.apiurl + '?pagesize=1&filter=' + encodeURIComponent(JSON.stringify({ Field: 'OrderNumber', Op: '=', Value: no })), fetchOpts)
          .then(r => r.json())
          .then(r => r?.Items?.[0] ?? null)
          .catch(() => null)
      )
    ).then(results => {
      const map = new Map();
      results.forEach((item, i) => { if (item) map.set(orderNumbers[i], item); });
      return map;
    });
  }

  // rq_sheets.js is a separate @require. The installed Tampermonkey script is a
  // copy of RentalQuirks.local.user.js kept in Tampermonkey's own storage, so
  // editing the file in this repo does NOT update what actually loads — a module
  // added here has to be added there by hand. Without this check the omission
  // surfaces as "Cannot read properties of undefined (reading 'getSheetIdFromUrl')"
  // from deep inside the Preps card, which says nothing about the real cause.
  function sheetsReady(body) {
    if (RQ.sheets) return true;
    console.error("[RQ] rq_sheets.js is not loaded. Add its @require line to your " +
                  "Tampermonkey script, before rq_dashboard.js. The Preps card is disabled.");
    if (body) body.innerHTML = placeholderHTML('rq_sheets.js not loaded — see console');
    return false;
  }

  async function loadPreps(forceRefresh = false) {
    const body = document.getElementById('rq-card-body-preps');
    if (!body) return;
    if (!sheetsReady(body)) return;

    const sheetUrl = localStorage.getItem(PREPS_SHEET_KEY);
    if (!sheetUrl) {
      body.innerHTML = placeholderHTML('Paste your Google Sheet URL above');
      return;
    }
    const sheetId = RQ.sheets.getSheetIdFromUrl(sheetUrl);
    if (!sheetId) {
      body.innerHTML = placeholderHTML('Invalid sheet URL');
      return;
    }

    const cachedPreps = getCachedPreps();
    const prepsFresh  = cachedPreps && (Date.now() - cachedPreps.fetchedAt) < PREPS_CACHE_TTL;

    // Render the cached schedule immediately, but skip the re-render if rows are
    // already on screen to avoid needless flicker when reopening the panel.
    if (cachedPreps && !body.querySelector('.rq-card-row')) {
      renderPreps(cachedPreps.groups, cachedPreps.rwData);
    }

    // Refetch only when forced or when the cache is stale/cold.
    if (!forceRefresh && prepsFresh) return;
    if (!cachedPreps) body.innerHTML = placeholderHTML('Loading…');

    // Fetch 7 days back + today + next 13 days in parallel
    const dates = RQ.sheets.windowDates(7, 13);

    try {
      const groups = await RQ.sheets.fetchPrepGroups(sheetId, dates);

      // Batch-fetch RW order data for all unique order numbers
      const allOrderNos = [...new Set(groups.flatMap(g => g.rows.map(r => (r['Order No.'] || '').trim()).filter(Boolean)))];
      const rwData = await fetchOrdersByNumbers(allOrderNos);

      setCachedPreps({ groups, rwData, fetchedAt: Date.now() });
      renderPreps(groups, rwData);
    } catch {
      // Leave stale data visible on a background-refresh failure; only a cold cache shows the error.
      if (!cachedPreps) body.innerHTML = placeholderHTML('Failed to load preps');
    }
  }

  // Build a single draggable prep row, preferring RW API data over sheet data.
  function buildPrepRow(sheetRow, rwData, rowIndex) {
    const orderNo   = (sheetRow['Order No.'] || '').trim();
    const prepTech  = (sheetRow['Prep Tech']      || '').trim();
    const area      = (sheetRow['Prep Location'] || '').trim();
    const rwItem    = rwData?.get(orderNo);
    const idField   = RQ.api.module_identifier_names('Order')?.id;
    const primary   = rwItem?.Description || orderNo;
    const customer  = rwItem?.Customer || rwItem?.CustomerName || null;
    const subinfo   = [prepTech, area].filter(Boolean).join(' · ') || null;
    const metaEntry = getItemMetaEntry('Order', orderNo);
    const rowEl = draggableCardRow(
      'assignment', primary, orderNo,
      () => {
        if (rwItem && idField && rwItem[idField]) {
          closePanel(); RQ.api.open_form_tab('Order', rwItem[idField]);
        } else {
          RQ.api.get_id_from_code('Order', orderNo)
            .then(id => { if (id) { closePanel(); RQ.api.open_form_tab('Order', id); } });
        }
      },
      {
        icon: 'assignment', primary, secondary: orderNo,
        module: 'Order', recordNumber: orderNo,
        cardId: 'preps',
        tags: metaEntry.tags || [],
        notes: metaEntry.notes || '',
        customer,
        subinfo,
      },
      null
    );
    if (rowIndex !== undefined) rowEl.dataset.rowIndex = rowIndex;
    return rowEl;
  }

  function buildFloorPlanPrepItem(sheetRow, rwData, detailArea) {
    const orderNo  = (sheetRow['Order No.'] || '').trim();
    const prepTech = (sheetRow['Prep Tech']  || '').trim();
    const rwItem   = rwData?.get(orderNo);
    const idField  = RQ.api.module_identifier_names('Order')?.id;
    const primary  = rwItem?.Description || orderNo;
    const customer = rwItem?.Customer || rwItem?.CustomerName || null;

    const item = el('div', `
      padding: 3px 8px 5px; border-top: 1px solid #1e2e1e;
      cursor: pointer; transition: background 0.1s;
    `);

    const nameEl = el('div', `
      font-size: 11px; color: #ddd; line-height: 1.35;
      word-break: break-word; overflow-wrap: break-word;
    `, primary);
    nameEl.addEventListener('mouseenter', () => nameEl.style.textDecoration = 'underline');
    nameEl.addEventListener('mouseleave', () => nameEl.style.textDecoration = '');
    nameEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = idField && rwItem?.[idField];
      if (id) { closePanel(); RQ.api.open_form_tab('Order', id); }
      else RQ.api.get_id_from_code('Order', orderNo).then(rid => { if (rid) { closePanel(); RQ.api.open_form_tab('Order', rid); } });
    });
    item.appendChild(nameEl);

    const metaParts = [orderNo, prepTech, customer].filter(Boolean);
    if (metaParts.length) {
      item.appendChild(el('div', `
        font-size: 10px; color: #666; margin-top: 2px; line-height: 1.3;
        word-break: break-word; overflow-wrap: break-word;
      `, metaParts.join(' · ')));
    }

    item.addEventListener('click', (e) => {
      if (nameEl.contains(e.target)) return;
      // Toggle closed if this item is already expanded
      if (detailArea.dataset.current === orderNo && detailArea.style.display !== 'none') {
        detailArea.style.display = 'none';
        detailArea.dataset.current = '';
        item.style.background = '';
        return;
      }
      // Deactivate previously highlighted item
      detailArea.dataset.activeItem && document.querySelector(`[data-rq-floor-order="${detailArea.dataset.activeItem}"]`)
        ?.style.setProperty('background', '');
      detailArea.dataset.activeItem = orderNo;
      item.style.background = '#1e3a1e';

      detailArea.dataset.current = orderNo;
      detailArea.style.display = '';
      detailArea.innerHTML = '<div style="padding:6px 14px 8px;color:#555;font-style:italic;font-size:11px;">Loading…</div>';

      const knownId = (idField && rwItem?.[idField]) ? rwItem[idField] : null;
      fetchRecordDetail('Order', orderNo, knownId).then(data => {
        if (detailArea.dataset.current !== orderNo) return; // superseded
        detailArea.innerHTML = buildDetailHTML(data);
        attachDetailLinks(detailArea);
        addBarcodeSection(detailArea, orderNo);
        addNotesSection(detailArea, null, 'Order', orderNo);
      });
    });

    item.dataset.rqFloorOrder = orderNo;
    item.addEventListener('mouseenter', () => { if (detailArea.dataset.activeItem !== orderNo) item.style.background = '#1e3a1e'; });
    item.addEventListener('mouseleave', () => { if (detailArea.dataset.activeItem !== orderNo) item.style.background = ''; });

    return item;
  }

  function renderPrepsFloorPlan(container, rows, rwData) {
    container.innerHTML = '';

    // Build a map: normalizedLabel → array of sheet rows
    const byLocation = new Map();
    PREP_ROOM_CELLS.forEach(label => byLocation.set(label, []));
    PREP_FLOOR_CELLS.forEach(cell => byLocation.set(cell.label, []));
    rows.forEach(row => {
      const norm = normalizeLocation(row['Prep Location'] || '');
      if (byLocation.has(norm)) byLocation.get(norm).push(row);
    });

    const grid = el('div', `
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, auto);
      gap: 6px;
      padding: 10px 14px 14px;
    `);

    // Shared detail area — appears below the grid when a cell item is clicked
    const detailArea = el('div', 'display:none; border-top:1px solid #2a2a2a;');
    detailArea.dataset.current = '';
    detailArea.dataset.activeItem = '';

    // Col 1: rooms stacked in a single wrapper that spans all 3 rows
    const roomWrapper = el('div', `
      grid-row: 1 / 4; grid-column: 1;
      display: flex; flex-direction: column; gap: 6px;
    `);
    PREP_ROOM_CELLS.forEach(label => {
      const preps = byLocation.get(label) || [];
      const occupied = preps.length > 0;
      const cell = el('div', `
        flex: 1;
        background: ${occupied ? '#1a2a1a' : '#141414'};
        border: 1px solid ${occupied ? '#2a4a2a' : '#222'};
        border-radius: 4px;
        overflow: hidden;
      `);
      cell.appendChild(el('div', `
        font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
        text-transform: uppercase; color: ${occupied ? '#5a9a5a' : '#444'};
        padding: 5px 10px 3px;
      `, label));
      preps.forEach(prepRow => cell.appendChild(buildFloorPlanPrepItem(prepRow, rwData, detailArea)));
      roomWrapper.appendChild(cell);
    });
    grid.appendChild(roomWrapper);

    // Cols 2–3: regular cells
    PREP_FLOOR_CELLS.forEach(({ label, row, col }) => {
      const preps = byLocation.get(label) || [];
      const occupied = preps.length > 0;

      const cell = el('div', `
        grid-row: ${row}; grid-column: ${col};
        background: ${occupied ? '#1a2a1a' : '#141414'};
        border: 1px solid ${occupied ? '#2a4a2a' : '#222'};
        border-radius: 4px;
        overflow: hidden;
        min-height: 56px;
      `);

      cell.appendChild(el('div', `
        font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
        text-transform: uppercase; color: ${occupied ? '#5a9a5a' : '#444'};
        padding: 5px 10px 3px;
      `, label));

      preps.forEach(prepRow => cell.appendChild(buildFloorPlanPrepItem(prepRow, rwData, detailArea)));

      grid.appendChild(cell);
    });

    // Unplaced preps (location not recognized or blank)
    const unplaced = rows.filter(row => {
      const norm = normalizeLocation(row['Prep Location'] || '');
      return !byLocation.has(norm);
    });

    container.appendChild(grid);
    container.appendChild(detailArea);

    if (unplaced.length) {
      const unplacedHeader = el('div', `
        padding: 4px 14px 2px; font-size: 10px; font-weight: 700;
        letter-spacing: 0.1em; text-transform: uppercase; color: #555;
        border-top: 1px solid #222;
      `, 'Other');
      container.appendChild(unplacedHeader);
      unplaced.forEach((row, idx) => container.appendChild(buildPrepRow(row, rwData, idx)));
    }
  }

  function renderPreps(groups, rwData) {
    if (!sheetsReady(document.getElementById('rq-card-body-preps'))) return;
    const body = document.getElementById('rq-card-body-preps');
    if (!body) return;
    body.innerHTML = '';

    if (!groups.length) {
      body.innerHTML = placeholderHTML('No upcoming preps found');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = RQ.sheets.fmtDate(today);

    // Floor plan view: grid with prev/next day navigation
    const viewMode = localStorage.getItem(PREPS_VIEW_KEY) || 'list';
    if (viewMode === 'floor') {
      // Always start at today. If the sheet has no preps for today, inject an
      // empty synthetic entry so the nav always opens on "Today" after a reload.
      const hasTodayGroup = groups.some(g => g.str === todayStr);
      const navGroups = hasTodayGroup
        ? groups
        : [{ date: today, str: todayStr, rows: [] }, ...groups];
      let idx = navGroups.findIndex(g => g.str === todayStr); // always 0 or found

      const navBar = el('div', `
        display: flex; align-items: center; justify-content: space-between;
        padding: 4px 10px; border-bottom: 1px solid #222;
      `);
      const btnStyle = `
        background: none; border: none; color: #555; cursor: pointer;
        font-size: 16px; padding: 2px 6px; border-radius: 3px;
        transition: color 0.1s;
      `;
      const prevBtn = el('button', btnStyle, '◀');
      const nextBtn = el('button', btnStyle, '▶');
      prevBtn.type = 'button';
      nextBtn.type = 'button';
      const dateLabel = el('span', 'font-size: 11px; color: #aaa; font-weight: 600;');

      const gridContainer = el('div', '');

      const setNavState = () => {
        const atStart = idx === 0;
        const atEnd = idx === navGroups.length - 1;
        prevBtn.style.color = atStart ? '#3a3a3a' : '#aaa';
        prevBtn.style.cursor = atStart ? 'default' : 'pointer';
        prevBtn.style.pointerEvents = atStart ? 'none' : '';
        nextBtn.style.color = atEnd ? '#3a3a3a' : '#aaa';
        nextBtn.style.cursor = atEnd ? 'default' : 'pointer';
        nextBtn.style.pointerEvents = atEnd ? 'none' : '';
      };

      const renderDay = (i) => {
        idx = i;
        const g = navGroups[idx];
        dateLabel.textContent = g.str === todayStr
          ? 'Today'
          : g.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        setNavState();
        if (g.rows.length === 0) {
          gridContainer.innerHTML = '<div style="padding:16px 14px;color:#555;font-style:italic;font-size:12px;">No preps scheduled for today</div>';
        } else {
          renderPrepsFloorPlan(gridContainer, g.rows, rwData);
        }
      };

      prevBtn.addEventListener('mouseenter', () => { if (idx > 0) prevBtn.style.color = '#fff'; });
      prevBtn.addEventListener('mouseleave', () => { prevBtn.style.color = idx === 0 ? '#3a3a3a' : '#aaa'; });
      prevBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx > 0) renderDay(idx - 1); });

      nextBtn.addEventListener('mouseenter', () => { if (idx < navGroups.length - 1) nextBtn.style.color = '#fff'; });
      nextBtn.addEventListener('mouseleave', () => { nextBtn.style.color = idx === navGroups.length - 1 ? '#3a3a3a' : '#aaa'; });
      nextBtn.addEventListener('click', (e) => { e.stopPropagation(); if (idx < navGroups.length - 1) renderDay(idx + 1); });

      navBar.append(prevBtn, dateLabel, nextBtn);
      body.appendChild(navBar);
      body.appendChild(gridContainer);
      renderDay(idx);
      return;
    }

    groups.forEach(({ date, str, rows }, groupIdx) => {
      const isToday = str === todayStr;
      const dateLabel = isToday
        ? 'Today'
        : date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

      const groupHeader = el('div', `
        padding: 5px 14px 3px;
        font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
        color: ${isToday ? '#5a9a5a' : '#666'};
        ${groupIdx > 0 ? 'border-top: 1px solid #222;' : ''}
      `, dateLabel);
      body.appendChild(groupHeader);

      rows.forEach((row, idx) => {
        if (!(row['Order No.'] || '').trim()) return;
        body.appendChild(buildPrepRow(row, rwData, idx));
      });
    });
  }

  function loadQuickLinks() {
    const body = document.getElementById('rq-card-body-quicklinks');
    if (!body) return;
    body.innerHTML = '';

    // Storage: array of {caption, nav, icon} objects.
    // Migrates old string-array format automatically.
    const saveLinks = (links) => localStorage.setItem(QUICK_LINKS_KEY, JSON.stringify(links));
    const loadLinks = () => {
      try {
        const raw = JSON.parse(localStorage.getItem(QUICK_LINKS_KEY) || 'null');
        if (!raw) return null;
        return raw.map(item => typeof item === 'string'
          ? (QUICK_LINKS_ALL.find(m => m.nav === item) || { caption: item, nav: item, icon: 'open_in_new' })
          : item);
      } catch { return null; }
    };

    const render = () => {
      body.innerHTML = '';
      const links = loadLinks() ?? QUICK_LINKS_DEFAULT_NAVS.map(nav => QUICK_LINKS_ALL.find(m => m.nav === nav)).filter(Boolean);
      const currentNavs = new Set(links.map(l => l.nav));
      const hidden = QUICK_LINKS_ALL.filter(m => !currentNavs.has(m.nav));

      const grid = el('div', `
        display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 8px;
      `);

      let dragSrc = null;

      links.forEach(mod => {
        const btn = el('div', `
          display: flex; align-items: center; gap: 6px;
          padding: 7px 10px; cursor: pointer; position: relative;
          border-radius: 5px; background: #2a2a2a;
          transition: background 0.1s, box-shadow 0.1s;
          user-select: none;
        `);
        btn.dataset.nav = mod.nav;
        btn.draggable = true;

        // Remove (×) and edit (pencil) buttons, shown on hover
        const removeBtn = el('span', `
          position: absolute; top: 3px; right: 4px;
          font-size: 10px; color: #444; cursor: pointer;
          opacity: 0; transition: opacity 0.1s, color 0.1s;
          line-height: 1;
        `, '×');
        removeBtn.addEventListener('mouseenter', () => removeBtn.style.color = '#e05555');
        removeBtn.addEventListener('mouseleave', () => removeBtn.style.color = '#444');
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const links = loadLinks() ?? QUICK_LINKS_DEFAULT_NAVS.map(nav => QUICK_LINKS_ALL.find(m => m.nav === nav)).filter(Boolean);
          saveLinks(links.filter(l => l.nav !== mod.nav));
          render();
        });

        const editBtn = el('i', `
          position: absolute; bottom: 3px; right: 5px;
          font-size: 11px; color: #444; cursor: pointer;
          opacity: 0; transition: opacity 0.1s, color 0.1s;
        `);
        editBtn.className = 'material-icons';
        editBtn.textContent = 'edit';
        editBtn.addEventListener('mouseenter', () => editBtn.style.color = '#7aafdf');
        editBtn.addEventListener('mouseleave', () => editBtn.style.color = '#444');
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          document.getElementById('rq-ql-picker')?.remove();

          const popup = el('div', `
            position: fixed; z-index: 100002;
            background: #242424; border: 1px solid #444; border-radius: 6px;
            padding: 10px 12px; min-width: 240px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.65);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          `);
          popup.id = 'rq-ql-picker';
          const rect = btn.getBoundingClientRect();
          popup.style.top  = (rect.bottom + 4) + 'px';
          popup.style.left = rect.left + 'px';

          const formLabel = el('div', 'color:#555;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;', 'Edit Link');

          const mkInput = (placeholder, value) => {
            const inp = el('input', `
              width:100%;box-sizing:border-box;background:#1a1a1a;color:#ccc;
              border:1px solid #333;border-radius:3px;padding:4px 7px;
              font-size:11px;font-family:inherit;outline:none;margin-bottom:6px;
            `);
            inp.placeholder = placeholder;
            inp.value = value || '';
            inp.addEventListener('click', e => e.stopPropagation());
            inp.addEventListener('mousedown', e => e.stopPropagation());
            return inp;
          };

          const captionInput = mkInput('Label', mod.caption);
          const navInput     = mkInput('Nav path', mod.nav);

          // Icon picker: search + scrollable grid
          let selectedIcon = mod.icon || 'open_in_new';
          const iconPickerWrap = el('div', 'margin-bottom:8px;');
          const iconSearch = mkInput('Search icons…', '');
          iconSearch.style.marginBottom = '4px';
          const iconGrid = el('div', `
            display:flex;flex-wrap:wrap;gap:2px;
            max-height:120px;overflow-y:auto;
            background:#1a1a1a;border:1px solid #333;border-radius:3px;padding:4px;
          `);
          const renderIconGrid = (filter) => {
            iconGrid.innerHTML = '';
            const q = filter.toLowerCase();
            QLICONS.filter(n => !q || n.includes(q)).forEach(name => {
              const cell = el('div', `
                display:flex;align-items:center;justify-content:center;
                width:28px;height:28px;border-radius:3px;cursor:pointer;flex-shrink:0;
                background:${name === selectedIcon ? '#1a3a1a' : 'transparent'};
                transition:background 0.1s;
              `);
              const ic = el('i', 'font-size:15px;color:#888;pointer-events:none;');
              ic.className = 'material-icons';
              ic.textContent = name;
              ic.title = name;
              cell.appendChild(ic);
              cell.title = name;
              cell.addEventListener('mouseenter', () => { if (name !== selectedIcon) cell.style.background = '#2a2a2a'; });
              cell.addEventListener('mouseleave', () => { cell.style.background = name === selectedIcon ? '#1a3a1a' : 'transparent'; });
              cell.addEventListener('mousedown', (ev) => {
                ev.stopPropagation();
                selectedIcon = name;
                renderIconGrid(iconSearch.value.trim());
              });
              iconGrid.appendChild(cell);
            });
          };
          iconSearch.addEventListener('input', () => renderIconGrid(iconSearch.value.trim()));
          renderIconGrid('');
          iconPickerWrap.append(iconSearch, iconGrid);

          const saveBtn = el('button', `
            width:100%;padding:5px;background:#1a3a1a;border:1px solid #2a5a2a;
            color:#8aca8a;border-radius:3px;font-size:11px;font-family:inherit;cursor:pointer;
          `, 'Save');
          saveBtn.addEventListener('mousedown', (ev) => {
            ev.stopPropagation();
            const caption = captionInput.value.trim();
            const nav     = navInput.value.trim();
            if (!caption || !nav) return;
            popup.remove();
            const links = loadLinks() ?? QUICK_LINKS_DEFAULT_NAVS.map(n => QUICK_LINKS_ALL.find(m => m.nav === n)).filter(Boolean);
            saveLinks(links.map(l => l.nav === mod.nav ? { caption, nav, icon: selectedIcon } : l));
            render();
          });

          navInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); saveBtn.dispatchEvent(new MouseEvent('mousedown')); } });

          popup.append(formLabel, captionInput, iconPickerWrap, navInput, saveBtn);
          document.body.appendChild(popup);

          requestAnimationFrame(() => {
            const r = popup.getBoundingClientRect();
            if (r.right  > window.innerWidth  - 8) popup.style.left = (window.innerWidth  - r.width  - 8) + 'px';
            if (r.bottom > window.innerHeight - 8) popup.style.top  = (window.innerHeight - r.height - 8) + 'px';
          });

          captionInput.focus();
          const close = (ev) => {
            if (!popup.contains(ev.target)) { popup.remove(); document.removeEventListener('mousedown', close, true); }
          };
          setTimeout(() => document.addEventListener('mousedown', close, true), 0);
        });

        btn.addEventListener('mouseenter', () => { if (dragSrc !== btn) { btn.style.background = '#333'; removeBtn.style.opacity = '1'; editBtn.style.opacity = '1'; } });
        btn.addEventListener('mouseleave', () => { if (dragSrc !== btn) { btn.style.background = '#2a2a2a'; removeBtn.style.opacity = '0'; editBtn.style.opacity = '0'; } });
        btn.addEventListener('click', () => { closePanel(); RQ.load_module_as_tab(mod.nav); });

        btn.addEventListener('dragstart', (e) => {
          e.stopPropagation();
          dragSrc = btn;
          btn.style.opacity = '0.4';
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', mod.nav);
        });
        btn.addEventListener('dragend', () => {
          dragSrc = null;
          btn.style.opacity = '';
          grid.querySelectorAll('[data-nav]').forEach(b => b.style.boxShadow = '');
        });
        btn.addEventListener('dragover', (e) => {
          e.stopPropagation();
          if (dragSrc === btn) return;
          e.preventDefault();
          grid.querySelectorAll('[data-nav]').forEach(b => b.style.boxShadow = '');
          btn.style.boxShadow = 'inset 0 0 0 1px #5a9a5a';
        });
        btn.addEventListener('dragleave', () => btn.style.boxShadow = '');
        btn.addEventListener('drop', (e) => {
          e.stopPropagation();
          e.preventDefault();
          btn.style.boxShadow = '';
          if (!dragSrc || dragSrc === btn) return;
          const btns = [...grid.querySelectorAll('[data-nav]')];
          const srcIdx = btns.indexOf(dragSrc);
          const tgtIdx = btns.indexOf(btn);
          if (srcIdx < tgtIdx) btn.after(dragSrc);
          else btn.before(dragSrc);
          // Persist reordered list as full objects
          const allLinks = loadLinks() ?? QUICK_LINKS_DEFAULT_NAVS.map(nav => QUICK_LINKS_ALL.find(m => m.nav === nav)).filter(Boolean);
          const reordered = [...grid.querySelectorAll('[data-nav]')].map(b => allLinks.find(l => l.nav === b.dataset.nav)).filter(Boolean);
          saveLinks(reordered);
        });

        const icon = el('i', 'font-size: 14px; color: #555; flex-shrink: 0;');
        icon.className = 'material-icons';
        icon.textContent = mod.icon;

        const label = el('span', 'font-size: 12px; color: #ccc;', mod.caption);
        btn.append(icon, label, removeBtn, editBtn);
        grid.appendChild(btn);
      });

      // Small "+" button below the grid
      {
        const addTile = el('div', `
          display: flex; align-items: center; justify-content: center;
          padding: 2px 0 6px; cursor: pointer; color: #333;
          transition: color 0.1s; user-select: none;
        `);
        const plusIcon = el('i', 'font-size: 16px;');
        plusIcon.className = 'material-icons';
        plusIcon.textContent = 'add';
        addTile.append(plusIcon);
        addTile.addEventListener('mouseenter', () => { addTile.style.color = '#777'; });
        addTile.addEventListener('mouseleave', () => { addTile.style.color = '#333'; });
        addTile.addEventListener('click', (e) => {
          e.stopPropagation();
          document.getElementById('rq-ql-picker')?.remove();

          const picker = el('div', `
            position: fixed; z-index: 100002;
            background: #242424; border: 1px solid #444; border-radius: 6px;
            padding: 4px 0; min-width: 160px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.65);
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          `);
          picker.id = 'rq-ql-picker';
          const rect = addTile.getBoundingClientRect();
          picker.style.top  = (rect.bottom + 4) + 'px';
          picker.style.left = rect.left + 'px';

          hidden.forEach(mod => {
            const item = el('div', `
              display: flex; align-items: center; gap: 8px;
              padding: 6px 12px; cursor: pointer; color: #aaa;
              transition: background 0.1s;
            `);
            const ic = el('i', 'font-size: 13px; color: #555; flex-shrink: 0;');
            ic.className = 'material-icons';
            ic.textContent = mod.icon;
            item.append(ic, document.createTextNode(mod.caption));
            item.addEventListener('mouseenter', () => item.style.background = '#333');
            item.addEventListener('mouseleave', () => item.style.background = '');
            item.addEventListener('mousedown', (ev) => {
              ev.stopPropagation();
              picker.remove();
              const links = loadLinks() ?? QUICK_LINKS_DEFAULT_NAVS.map(nav => QUICK_LINKS_ALL.find(m => m.nav === nav)).filter(Boolean);
              saveLinks([...links, mod]);
              render();
            });
            picker.appendChild(item);
          });

          // Separator + Custom entry
          const sep = el('div', 'border-top: 1px solid #333; margin: 3px 0;');
          picker.appendChild(sep);

          const customItem = el('div', `
            display: flex; align-items: center; gap: 8px;
            padding: 6px 12px; cursor: pointer; color: #666;
            transition: background 0.1s;
          `);
          const customIc = el('i', 'font-size: 13px; color: #444; flex-shrink: 0;');
          customIc.className = 'material-icons';
          customIc.textContent = 'edit';
          customItem.append(customIc, document.createTextNode('Custom…'));
          customItem.addEventListener('mouseenter', () => customItem.style.background = '#333');
          customItem.addEventListener('mouseleave', () => customItem.style.background = '');
          customItem.addEventListener('mousedown', (ev) => {
            ev.stopPropagation();
            // Replace picker contents with an inline form
            picker.innerHTML = '';
            picker.style.padding = '10px 12px';
            picker.style.minWidth = '200px';

            const formLabel = el('div', 'color:#555;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;', 'Custom Link');

            const mkInput = (placeholder) => {
              const inp = el('input', `
                width:100%;box-sizing:border-box;background:#1a1a1a;color:#ccc;
                border:1px solid #333;border-radius:3px;padding:4px 7px;
                font-size:11px;font-family:inherit;outline:none;margin-bottom:6px;
              `);
              inp.placeholder = placeholder;
              inp.addEventListener('click', e => e.stopPropagation());
              inp.addEventListener('mousedown', e => e.stopPropagation());
              return inp;
            };

            const captionInput = mkInput('Label (e.g. Work Order)');
            const navInput    = mkInput('Nav path (e.g. module/workorder)');

            const addBtn = el('button', `
              width:100%;padding:5px;background:#1a3a1a;border:1px solid #2a5a2a;
              color:#8aca8a;border-radius:3px;font-size:11px;font-family:inherit;cursor:pointer;
            `, 'Add');
            addBtn.addEventListener('mousedown', (ev) => {
              ev.stopPropagation();
              const caption = captionInput.value.trim();
              const nav     = navInput.value.trim();
              if (!caption || !nav) return;
              picker.remove();
              const links = loadLinks() ?? QUICK_LINKS_DEFAULT_NAVS.map(n => QUICK_LINKS_ALL.find(m => m.nav === n)).filter(Boolean);
              saveLinks([...links, { caption, nav, icon: 'open_in_new' }]);
              render();
            });

            navInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); addBtn.dispatchEvent(new MouseEvent('mousedown')); } });

            picker.append(formLabel, captionInput, navInput, addBtn);
            captionInput.focus();
          });
          picker.appendChild(customItem);

          document.body.appendChild(picker);
          requestAnimationFrame(() => {
            const r = picker.getBoundingClientRect();
            if (r.right  > window.innerWidth  - 8) picker.style.left = (window.innerWidth  - r.width  - 8) + 'px';
            if (r.bottom > window.innerHeight - 8) picker.style.top  = (window.innerHeight - r.height - 8) + 'px';
          });

          const close = (ev) => {
            if (!picker.contains(ev.target)) { picker.remove(); document.removeEventListener('mousedown', close, true); }
          };
          document.addEventListener('mousedown', close, true);
        });

        body.appendChild(grid);
        body.appendChild(addTile);
      }
    };

    render();
  }


  function loadBookmarks() {
    const bookmarks = window.RQ_bookmarks?.loadBookmarks() ?? [];
    const rows = bookmarks.map(b => cardRow(
      MODULE_ICONS[b.module] ?? 'star',
      b.description || b.caption,
      b.recordNumber,
      () => window._rqOpenRecord(b),
      { icon: MODULE_ICONS[b.module] ?? 'star', primary: b.description || b.caption, secondary: b.recordNumber, module: b.module, recordNumber: b.recordNumber, cardId: 'bookmarks' }
    ));
    setCardContent('bookmarks', rows);
  }

  function loadRecents() {
    try {
      const raw = JSON.parse(localStorage.getItem('rq-recent-records') || '[]');
      // Deduplicate by module+recordNumber, keeping the most recent occurrence
      const seen = new Set();
      const recents = raw.filter(r => {
        const key = `${r.module}:${r.recordNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const rows = recents.slice(0, 8).map(r => {
        const description = r.caption?.includes(' — ') ? r.caption.split(' — ').slice(1).join(' — ') : (r.description || r.caption);
        return cardRow(
          MODULE_ICONS[r.module] ?? 'open_in_new',
          description,
          r.recordNumber,
          () => {
            RQ.api.open_record_by_number(r.module, r.recordNumber);
          },
          { icon: MODULE_ICONS[r.module] ?? 'open_in_new', primary: description, secondary: r.recordNumber, module: r.module, recordNumber: r.recordNumber, cardId: 'recents' }
        );
      });
      setCardContent('recents', rows);
    } catch {
      setCardContent('recents', []);
    }
  }

  function relativeTime(ts) {
    const d = Math.floor((Date.now() - ts) / 864e5);
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  }

  function loadArchiveItems() {
    const body = document.getElementById('rq-card-body-archive');
    if (!body) return;
    body.innerHTML = '';
    const archive = loadArchive();
    if (!archive.length) {
      body.innerHTML = '<div style="padding:8px 14px;color:#444;font-style:italic;font-size:12px;">Archive is empty</div>';
      return;
    }
    archive.forEach(entry => {
      const row = el('div', `
        display: flex; align-items: flex-start; gap: 10px;
        padding: 7px 14px;
        transition: background 0.1s;
      `);
      row.className = 'rq-card-row';

      const rowIcon = el('i', 'font-size: 14px; color: #555; flex-shrink: 0; margin-top: 1px;');
      rowIcon.className = 'material-icons';
      rowIcon.textContent = entry.icon || MODULE_ICONS[entry.module] || 'open_in_new';

      const text = el('div', 'flex: 1; overflow: hidden; min-width: 0;');
      const pWrap = el('div', 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;');
      const p = el('span', 'color: #c0c0c0; cursor: pointer;', normalizeItemPrimary(entry.primary, entry.recordNumber) || entry.recordNumber);
      p.addEventListener('mouseenter', () => p.style.textDecoration = 'underline');
      p.addEventListener('mouseleave', () => p.style.textDecoration = '');
      p.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); smartOpenRecord(entry.module, entry.recordNumber, null); });
      pWrap.appendChild(p);
      text.appendChild(pWrap);

      const meta = el('div', 'display: flex; align-items: center; gap: 6px; margin-top: 2px;');
      if (entry.recordNumber) {
        const s = el('span', 'font-size: 11px; color: #555;', entry.recordNumber);
        meta.appendChild(s);
      }
      const modLabel = makeModuleLabel(entry.module);
      if (modLabel) meta.appendChild(modLabel);
      if (entry.archivedAt) {
        const ts = el('span', 'font-size: 10px; color: #3a3a3a; margin-left: auto;', relativeTime(entry.archivedAt));
        meta.appendChild(ts);
      }
      text.appendChild(meta);

      const restoreBtn = el('i', `
        font-size: 14px; color: #555; flex-shrink: 0; cursor: pointer;
        width: 20px; height: 20px; border-radius: 3px; opacity: 0; margin-top: 1px;
        display: inline-flex; align-items: center; justify-content: center;
        transition: opacity 0.1s, color 0.1s, background 0.1s;
      `);
      restoreBtn.className = 'material-icons';
      restoreBtn.textContent = 'undo';
      restoreBtn.title = 'Restore to section';

      const deleteBtn = el('i', `
        font-size: 14px; color: #555; flex-shrink: 0; cursor: pointer;
        width: 20px; height: 20px; border-radius: 3px; opacity: 0; margin-top: 1px;
        display: inline-flex; align-items: center; justify-content: center;
        transition: opacity 0.1s, color 0.1s, background 0.1s;
      `);
      deleteBtn.className = 'material-icons';
      deleteBtn.textContent = 'delete_forever';
      deleteBtn.title = 'Delete permanently';

      row.addEventListener('mouseenter', () => { row.style.background = '#272727'; restoreBtn.style.opacity = '1'; deleteBtn.style.opacity = '1'; });
      row.addEventListener('mouseleave', () => { row.style.background = ''; restoreBtn.style.opacity = '0'; deleteBtn.style.opacity = '0'; });

      restoreBtn.addEventListener('mouseenter', () => { restoreBtn.style.color = '#4a9a4a'; restoreBtn.style.background = '#1a3a1a'; });
      restoreBtn.addEventListener('mouseleave', () => { restoreBtn.style.color = '#555'; restoreBtn.style.background = ''; });
      restoreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = restoreFromArchive(entry.module, entry.recordNumber);
        loadArchiveItems();
        if (targetId) {
          const section = loadCustomSections().find(s => s.id === targetId);
          if (section) loadCustomSectionItems(section);
        }
      });

      deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.color = '#e05555'; deleteBtn.style.background = '#3a1a1a'; });
      deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.color = '#555'; deleteBtn.style.background = ''; });
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeFromArchive(entry.module, entry.recordNumber);
        loadArchiveItems();
      });

      row.append(rowIcon, text, restoreBtn, deleteBtn);
      body.appendChild(row);
    });
  }

  // ── Live search ────────────────────────────────────────────────────
  const SEARCH_MODULES = [
    { name: 'Order',           field: 'Description',  numberField: 'OrderNumber',    icon: 'assignment',    display: ['Description',  'OrderNumber'   ] },
    { name: 'Quote',           field: 'Description',  numberField: 'QuoteNumber',    icon: 'request_quote', display: ['Description',  'QuoteNumber'   ] },
    { name: 'RentalInventory', field: 'Description',  numberField: 'ICode',          icon: 'videocam',      display: ['Description',  'ICode'         ] },
    { name: 'Customer',        field: 'Customer',     numberField: 'CustomerNumber', icon: 'person',        display: ['Customer',     'CustomerNumber'] },
    { name: 'Asset',           field: 'BarCode',      numberField: 'BarCode',        icon: 'qr_code',       display: ['Description',  'BarCode'       ] },
    { name: 'PurchaseOrder',   field: 'Description',  numberField: 'PurchaseOrderNumber', icon: 'shopping_cart', display: ['Description',  'Vendor'], extraField: 'Vendor' },
  ];

  function appendRecordResults(query, resultsEl) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="padding: 6px 8px; color: #555; font-style: italic; font-size: 12px;">Searching...</div>';

    const isInventorySearch = query.includes(',');
    const terms = isInventorySearch ? query.split(',').map(t => t.trim().toUpperCase()).filter(Boolean) : null;

    const fetchOpts = {
      headers: {
        'authorization': 'Bearer ' + sessionStorage.apiToken,
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      },
      credentials: 'include'
    };

    Promise.all(SEARCH_MODULES.map(mod => {
      const controller = window[mod.name + 'Controller'];
      if (!controller?.apiurl) return Promise.resolve({ mod, items: [] });

      const idField = RQ.api.module_identifier_names(mod.name)?.id;

      // Comma mode: only search RentalInventory
      // Strategy: fetch each term from the API (Description only) with TotalItems,
      // pick the smallest result set as the base, then client-side filter for all terms.
      // This handles common terms (e.g. "6X6" matching 1000+ items) without pagination limits.
      if (isInventorySearch) {
        if (mod.name !== 'RentalInventory') return Promise.resolve({ mod, items: [] });
        return Promise.all(terms.map(term =>
          fetch(RW_URL + controller.apiurl + '?' + encodeURI(`filter={"Field":"${mod.field}","Op":"contains","Value":"${term}"}&pagesize=500`), fetchOpts)
            .then(r => r.json())
            .then(r => ({ term, items: r?.Items ?? [], total: r?.TotalItems ?? 0 }))
            .catch(() => ({ term, items: [], total: 0 }))
        )).then(termResults => {
          if (!termResults.length) return { mod, items: [] };
          // Use the term with fewest total matches as the base (most specific term)
          termResults.sort((a, b) => a.total - b.total);
          const base = termResults[0].items;
          // Client-side filter: every term must appear in Description or ICode
          const filtered = base.filter(item =>
            terms.every(term =>
              (item[mod.field] ?? '').includes(term) ||
              (item[mod.numberField] ?? '').includes(term) ||
              (item[mod.extraField] ?? '').includes(term)
            )
          );
          return { mod, items: filtered.slice(0, 15) };
        });
      }

      const pagesize = mod.extraField ? 20 : 8;
      const queryUpper = query.toUpperCase();
      const fetchField = (field, op = 'contains', value = queryUpper) => fetch(
        RW_URL + controller.apiurl + '?' + encodeURI(`filter={"Field":"${field}","Op":"${op}","Value":"${value}"}&pagesize=${pagesize}`),
        fetchOpts
      ).then(r => r.json()).then(r => r?.Items ?? []).catch(() => []);

      // For code-like queries (no spaces), also fetch an exact match on numberField
      // so e.g. barcode "1546" surfaces before "contains 1546" results
      const isCodeQuery = /^\S+$/.test(query);
      const exactFetch = (isCodeQuery && mod.numberField)
        ? fetchField(mod.numberField, '=')
        : Promise.resolve([]);

      // For Order/Quote: treat "LA" + 5-digit and bare 5-digit as equivalent.
      // Lets you type "51925" to find "LA51925", or "LA51925" if contains fails on OrderNumber.
      const laAlt = (['Order', 'Quote'].includes(mod.name))
        ? (/^LA(\d{5})$/i.exec(queryUpper)?.[1] ?? (/^\d{5}$/.test(queryUpper) ? 'LA' + queryUpper : null))
        : null;
      const altExactFetch = (laAlt && mod.numberField)
        ? fetchField(mod.numberField, '=', laAlt)
        : Promise.resolve([]);

      const descFetch = (mod.field !== mod.numberField) ? fetchField(mod.field) : Promise.resolve([]);
      const numFetch = fetchField(mod.numberField);
      const extraFetch = mod.extraField ? fetchField(mod.extraField) : Promise.resolve([]);

      return Promise.all([exactFetch, altExactFetch, descFetch, numFetch, extraFetch]).then(([byExact, byAltExact, byDesc, byNum, byExtra]) => {
        const seen = new Set();
        const items = [...byExact, ...byAltExact, ...byDesc, ...byNum, ...byExtra].filter(item => {
          const id = idField ? item[idField] : null;
          if (id && seen.has(id)) return false;
          if (id) seen.add(id);
          return true;
        }).slice(0, mod.extraField ? 15 : 8);
        return { mod, items };
      });
    })).then(results => {
      resultsEl.innerHTML = '';
      let any = false;

      // In comma mode, sort RentalInventory to the top
      if (isInventorySearch) {
        results.sort((a, b) => (b.mod.name === 'RentalInventory') - (a.mod.name === 'RentalInventory'));
      }

      results.forEach(({ mod, items }) => {
        if (items.length === 0) return;
        any = true;

        const label = el('div', 'padding: 4px 8px 2px; font-size: 10px; color: #555; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em;', mod.name);
        resultsEl.appendChild(label);

        items.forEach(item => {
          const primary = item[mod.display[0]] ?? '';
          const secondary = (item[mod.display[1]] ?? '').replace(/-+$/, '');
          const row = el('div', `
            display: flex; align-items: center; gap: 8px;
            padding: 6px 8px; cursor: pointer; border-radius: 4px;
            transition: background 0.1s;
          `);

          const icon = el('i', 'font-size: 13px; color: #555; flex-shrink: 0;');
          icon.className = 'material-icons';
          icon.textContent = mod.icon;

          const recordNumber = (item[mod.numberField] ?? '').replace(/-+$/, '');
          const idField = RQ.api.module_identifier_names(mod.name)?.id;
          const openRecord = () => {
            const sq = document.getElementById('rq-dashboard-search');
            if (sq?.value?.trim()) {
              const h = (() => { try { return JSON.parse(localStorage.getItem('rq-dashboard-search-history') || '[]'); } catch { return []; } })();
              const q = sq.value.trim();
              const updated = [q, ...h.filter(x => x !== q)].slice(0, 15);
              localStorage.setItem('rq-dashboard-search-history', JSON.stringify(updated));
            }
            closePanel();
            if (idField && item[idField]) RQ.api.open_form_tab(mod.name, item[idField]);
          };

          const text = el('div', 'flex: 1; overflow: hidden;');

          const pWrap = el('div', 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;');
          const p = el('span', 'font-size: 12px; color: #e0e0e0; font-weight: 600; cursor: pointer;', primary);
          p.addEventListener('mouseenter', () => p.style.textDecoration = 'underline');
          p.addEventListener('mouseleave', () => p.style.textDecoration = '');
          p.addEventListener('click', (e) => { e.stopPropagation(); openRecord(); });
          pWrap.appendChild(p);
          text.appendChild(pWrap);

          if (secondary && secondary !== primary) {
            const sWrap = el('div', 'margin-top: 1px;');
            const s = el('span', 'font-size: 11px; color: #777; cursor: pointer;', secondary);
            s.title = 'Click to copy';
            s.addEventListener('click', (e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(secondary).then(() => {
                const orig = s.textContent;
                s.textContent = '✓ Copied';
                s.style.color = '#4a9a4a';
                setTimeout(() => { s.textContent = orig; s.style.color = ''; }, 1200);
              });
            });
            sWrap.appendChild(s);
            text.appendChild(sWrap);
          }

          const gripIcon = el('i', `
            font-size: 14px; color: #3a3a3a; flex-shrink: 0; cursor: grab;
            opacity: 0; transition: opacity 0.1s; flex-shrink: 0;
          `);
          gripIcon.className = 'material-icons';
          gripIcon.textContent = 'drag_indicator';

          row.addEventListener('mouseenter', () => { row.style.background = '#333'; gripIcon.style.opacity = '1'; });
          row.addEventListener('mouseleave', () => { row.style.background = ''; gripIcon.style.opacity = '0'; });

          row.append(gripIcon, icon, text);
          attachExpandButton(row, mod.name, recordNumber, p, null, idField && item[idField] ? item[idField] : null);
          row.addEventListener('click', (e) => {
            if (p.contains(e.target) || gripIcon.contains(e.target)) return;
            openRecord();
          });

          // Custom mouse-event drag (avoids HTML5 DnD overlay issues)
          gripIcon.addEventListener('mousedown', (e) => {
            e.preventDefault();
            resultsEl._dragging = true;
            const startX = e.clientX, startY = e.clientY;
            const THRESHOLD = 5;
            let dragging = false;
            let ghost = null;

            const onMove = (ev) => {
              if (!dragging) {
                if (Math.abs(ev.clientX - startX) < THRESHOLD && Math.abs(ev.clientY - startY) < THRESHOLD) return;
                dragging = true;
                resultsEl.style.display = 'none';
                ghost = el('div', `
                  position:fixed;z-index:999999;pointer-events:none;
                  background:#2a2a2a;border:1px solid #4a7a4a;border-radius:4px;
                  padding:5px 10px;font-size:12px;color:#e0e0e0;
                  white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;
                `, primary || recordNumber);
                document.body.appendChild(ghost);
              }
              if (ghost) { ghost.style.left = (ev.clientX + 14) + 'px'; ghost.style.top = (ev.clientY - 10) + 'px'; }
              // Highlight custom section cards under cursor
              document.querySelectorAll('#rq-dashboard-body [id^="rq-card-custom-"]').forEach(card => {
                const r = card.getBoundingClientRect();
                card.style.outline = (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom)
                  ? '1px dashed #4a7a4a' : '';
              });
            };

            const onUp = (ev) => {
              document.removeEventListener('mousemove', onMove);
              document.removeEventListener('mouseup', onUp);
              if (ghost) { ghost.remove(); ghost = null; }
              document.querySelectorAll('#rq-dashboard-body [id^="rq-card-custom-"]').forEach(c => c.style.outline = '');
              resultsEl._dragging = false;
              if (!dragging) return;

              const target = document.elementFromPoint(ev.clientX, ev.clientY);
              const card = target?.closest?.('[id^="rq-card-custom-"]');
              const tabs = loadTabs();
              const activeTab = tabs ? getActiveTab(tabs) : null;
              const customSections = loadCustomSections();
              const tabCustomIds = activeTab
                ? activeTab.sections.filter(id => !BUILTIN_IDS.includes(id))
                : customSections.map(s => s.id);
              if (!tabCustomIds.length) return;
              const sectionId = card ? card.id.replace('rq-card-custom-', '') : tabCustomIds[tabCustomIds.length - 1];
              dropRecordOnSection(sectionId, { icon: mod.icon, primary, secondary, module: mod.name, recordNumber, sourceSectionId: null });
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
          });
          resultsEl.appendChild(row);
        });
      });

      if (!any) {
        resultsEl.innerHTML = '<div style="padding: 6px 8px; color: #555; font-style: italic; font-size: 12px;">No results</div>';
      }
    });
  }

  // ── Tab drag source ───────────────────────────────────────────────
  function extractTabDragData(tab) {
    const tabpageId = tab.dataset?.tabpageid;
    if (!tabpageId) return null;

    const tabpage = document.getElementById(tabpageId);
    const form = tabpage?.querySelector('[data-controller]');
    if (!form) return null; // browse/root tabs have no form

    const moduleName = form.dataset.controller.replace(/Controller$/, '');
    const fieldNames = RQ.api.module_identifier_names?.(moduleName);
    if (!fieldNames) return null; // unknown module

    // RW fields: value may be in an <input> or a display div
    const codeEl = form.querySelector(`[data-datafield="${fieldNames.code}"]`);
    const recordNumber = codeEl?.querySelector('input')?.value?.trim()
      || codeEl?.textContent?.trim()
      || '';
    if (!recordNumber) return null; // new/unsaved or still loading

    const primary = normalizeItemPrimary(tab.querySelector('.caption')?.textContent?.trim() || recordNumber, recordNumber);
    return {
      icon: MODULE_ICONS[moduleName] ?? 'open_in_new',
      primary,
      secondary: recordNumber,
      module: moduleName,
      recordNumber,
    };
  }

  function dropTabOnQuickLinks(tab) {
    const tabpageId = tab.dataset?.tabpageid;
    if (!tabpageId) return;
    const tabpage = document.getElementById(tabpageId);
    if (!tabpage) return;

    // Try form controller (record tabs), then caption text match (browse tabs)
    let newLink = null;
    const form = tabpage.querySelector('[data-controller]');
    if (form) {
      const moduleName = form.dataset.controller.replace(/Controller$/, '');
      newLink = QUICK_LINKS_ALL.find(m =>
        m.nav === 'module/' + moduleName.toLowerCase() ||
        m.caption.toLowerCase() === moduleName.toLowerCase()
      ) ?? {
        caption: moduleName,
        nav: 'module/' + moduleName.toLowerCase(),
        icon: MODULE_ICONS[moduleName] ?? 'open_in_new',
      };
    } else {
      // Browse/list tab — match caption against QUICK_LINKS_ALL (singular or plural)
      const caption = (tab.querySelector('.caption')?.textContent?.trim() || '').replace(/s$/i, '').toLowerCase();
      newLink = QUICK_LINKS_ALL.find(m =>
        m.caption.toLowerCase() === caption ||
        m.nav.replace('module/', '') === caption
      );
    }
    if (!newLink) return;

    let links;
    try {
      const raw = JSON.parse(localStorage.getItem(QUICK_LINKS_KEY) || 'null');
      links = raw
        ? raw.map(item => typeof item === 'string'
            ? (QUICK_LINKS_ALL.find(m => m.nav === item) || { caption: item, nav: item, icon: 'open_in_new' })
            : item)
        : QUICK_LINKS_DEFAULT_NAVS.map(nav => QUICK_LINKS_ALL.find(m => m.nav === nav)).filter(Boolean);
    } catch { links = []; }

    if (links.some(l => l.nav === newLink.nav)) return; // already present
    localStorage.setItem(QUICK_LINKS_KEY, JSON.stringify([...links, newLink]));
    loadQuickLinks();
  }

  function initTabDragSource() {
    // RW tab reordering uses custom mouse drag (not HTML5 DnD), so we intercept
    // mousedown/mouseup to detect tab drags released over the dashboard panel.
    let draggedTab = null;
    let startX, startY;
    const THRESHOLD = 5;

    document.addEventListener('mousedown', (e) => {
      const tab = e.target.closest('#moduletabs .tab[data-tabpageid]');
      draggedTab = tab || null;
      if (tab) { startX = e.clientX; startY = e.clientY; }
    }, true);

    document.addEventListener('mousemove', (e) => {
      if (!draggedTab) return;
      if (Math.abs(e.clientX - startX) < THRESHOLD && Math.abs(e.clientY - startY) < THRESHOLD) return;
      const panel = document.getElementById('rq-dashboard');
      const body  = document.getElementById('rq-dashboard-body');
      if (!panel || !body) return;
      const rect = panel.getBoundingClientRect();
      const over = e.clientX >= rect.left && e.clientX <= rect.right &&
                   e.clientY >= rect.top  && e.clientY <= rect.bottom;
      body.style.outline = over ? '2px dashed #4a7a4a' : '';
      // Lift the floating tab above the panel when dragging over it
      const floatingTab = document.querySelector('#moduletabs .tab[style*="position: fixed"]');
      if (floatingTab) floatingTab.style.zIndex = over ? '100000' : '9999';
    });

    // Capture phase fires before RW's bubble-phase mouseup that resets drag state.
    // The floating tab has pointer-events:none, so elementFromPoint sees through it.
    document.addEventListener('mouseup', (e) => {
      const tab = draggedTab;
      draggedTab = null;
      const body = document.getElementById('rq-dashboard-body');
      if (body) body.style.outline = '';
      const floatingTab = document.querySelector('#moduletabs .tab[style*="position: fixed"]');
      if (floatingTab) floatingTab.style.zIndex = '9999';

      if (!tab) return;
      if (Math.abs(e.clientX - startX) < THRESHOLD && Math.abs(e.clientY - startY) < THRESHOLD) return;

      const panel = document.getElementById('rq-dashboard');
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) return;

      // Check drop target first
      const target = document.elementFromPoint(e.clientX, e.clientY);

      // Quick Links drop: add the tab's module as a quick link
      if (target?.closest?.('#rq-card-quicklinks')) {
        dropTabOnQuickLinks(tab);
        return;
      }

      const data = extractTabDragData(tab);
      if (!data) return;

      // Identify which section card is under the cursor
      const card = target?.closest?.('[id^="rq-card-custom-"]');
      const tabs = loadTabs();
      const activeTab = tabs ? getActiveTab(tabs) : null;
      const customSections = loadCustomSections();
      const tabCustomIds = activeTab
        ? activeTab.sections.filter(id => !BUILTIN_IDS.includes(id))
        : customSections.map(s => s.id);
      if (!tabCustomIds.length) return;
      const sectionId = card ? card.id.replace('rq-card-custom-', '') : tabCustomIds[tabCustomIds.length - 1];
      dropRecordOnSection(sectionId, data);
    }, true);
  }

  // Modules that can be "promoted" to a higher-priority module with the same record number
  const MODULE_UPGRADES = {
    Quote: ['Order', 'Contract'],
    Order: ['Contract'],
  };

  /**
   * Opens the most-current form of a record, following any module upgrade path.
   * e.g. if a Quote has been converted to an Order, opens the Order instead.
   * Also updates the stored item's module if an upgrade is found.
   */
  function smartOpenRecord(module, recordNumber, sectionId = null) {
    const upgrades = MODULE_UPGRADES[module];
    if (!upgrades) {
      // No upgrade path — open directly
      RQ.api.open_record_by_number(module, recordNumber);
      return;
    }

    // Check upgrade targets in order, take the first one that exists
    Promise.all(upgrades.map(m =>
      RQ.api.get_id_from_code(m, recordNumber).then(id => ({ module: m, id })).catch(() => null)
    )).then(results => {
      const found = results.find(r => r?.id);
      const targetModule = found?.module ?? module;
      const targetId = found?.id;

      if (!targetId) {
        // Upgraded module not found, fall back to original
        RQ.api.open_record_by_number(module, recordNumber);
        return;
      }

      RQ.api.open_form_tab(targetModule, targetId);

      // Persist the upgrade so the stored item reflects the new module
      if (sectionId && targetModule !== module) {
        const sections = loadCustomSections();
        const section = sections.find(s => s.id === sectionId);
        const item = section?.items.find(i => i.recordNumber === recordNumber && i.module === module);
        if (item) {
          // Migrate personal status from old module to new module
          const existingStatus = getRecordStatus(module, recordNumber);
          if (existingStatus && !getRecordStatus(targetModule, recordNumber)) {
            setRecordStatus(targetModule, recordNumber, existingStatus);
          }
          detailCache.delete(module + ':' + recordNumber);
          item.module = targetModule;
          item.icon = MODULE_ICONS[targetModule] ?? 'open_in_new';
          saveCustomSections(sections);
          loadCustomSectionItems(section);
        }
      }
    });
  }

  // ── Module change detection (e.g. Quote → Order) ──────────────────
  function watchForModuleChanges() {
    RQ.onFormLoadComplete((form) => {
      const module = form.dataset.controller.replace(/Controller$/, '');
      const fieldNames = RQ.api.module_identifier_names?.(module);
      if (!fieldNames) return;
      const recordNumber = form.querySelector(`[data-datafield="${fieldNames.code}"] input`)?.value?.trim();
      if (!recordNumber) return;

      const sections = loadCustomSections();
      let changed = false;
      sections.forEach(section => {
        section.items.forEach(item => {
          if (item.recordNumber === recordNumber && item.module !== module) {
            // Migrate personal status from old module to new module
            const existingStatus = getRecordStatus(item.module, recordNumber);
            if (existingStatus && !getRecordStatus(module, recordNumber)) {
              setRecordStatus(module, recordNumber, existingStatus);
            }
            detailCache.delete(item.module + ':' + recordNumber);
            item.module = module;
            item.icon = MODULE_ICONS[module] ?? 'open_in_new';
            changed = true;
          }
        });
      });
      if (!changed) return;
      saveCustomSections(sections);
      sections.forEach(section => {
        if (section.items.some(i => i.recordNumber === recordNumber)) {
          loadCustomSectionItems(section);
        }
      });
    });
  }

  // ── Keyboard shortcut + edge hover ────────────────────────────────
  function initDashboard() {
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'q') {
        e.preventDefault();
        togglePanel();
      }
      if (e.key === 'Escape') closePanel();
    });

    const edgeZone = document.createElement('div');
    edgeZone.id = 'rq-dashboard-edge';
    edgeZone.style.cssText = `
      position: fixed; top: 0; right: 0; bottom: 0;
      width: 6px;
      z-index: 99997;
    `;
    document.body.appendChild(edgeZone);

    let edgeTimeout;
    edgeZone.addEventListener('mouseenter', () => {
      edgeTimeout = setTimeout(openPanel, 300);
    });
    edgeZone.addEventListener('mouseleave', () => {
      clearTimeout(edgeTimeout);
    });

    let edgeDragTimeout;
    edgeZone.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-record')) return;
      clearTimeout(edgeDragTimeout);
      edgeDragTimeout = setTimeout(openPanel, 300);
    });
    edgeZone.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer.types.includes('application/rq-record')) return;
      clearTimeout(edgeDragTimeout);
    });

    initTabDragSource();
    watchForModuleChanges();
    console.log('[RQ] Dashboard initialized — Alt+Q to open');
  }

  RQ.runOnAppLoad ||= [];
  RQ.runOnAppLoad.push(initDashboard);

})(window.RentalQuirks);
