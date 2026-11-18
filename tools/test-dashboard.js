// tools/test-dashboard.js
// Smoke tests for the pure logic behind the dashboard. No dependencies, no test
// runner: it loads the real source files and exercises them, so it verifies what
// ships rather than a retyped copy.
//
//   node tools/test-dashboard.js
//
// There is no node on PATH on the dev machine; a copy lives at
//   C:\Users\aagostino\Downloads\nodejs\node-v24.14.1-win-x64\node.exe
//
// Scope: rq_common.js and rq_sheets.js run in a sandbox that mimics the real load
// order. rq_dashboard.js is a ~5000-line IIFE needing far too much DOM to load, so
// its pure helpers are extracted by name and its cache invariants are checked
// structurally. Nothing here touches RentalWorks or Google.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

process.chdir(path.join(__dirname, '..'));

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}\n        expected ${e}\n        actual   ${a}`); failures++; }
}

function storageProxy(initial = {}) {
  const store = { ...initial };
  return new Proxy(store, {
    get(t, p) {
      if (p === 'getItem')    return k => (k in t ? t[k] : null);
      if (p === 'setItem')    return (k, v) => { t[k] = String(v); };
      if (p === 'removeItem') return k => { delete t[k]; };
      if (p === '_dump')      return () => ({ ...t });
      return t[p];
    },
  });
}

// script_execution_mgr.js loads first in the real userscript and supplies these.
// `window` is aliased to the global so bare `RentalQuirks` and `window.RentalQuirks`
// are one object, exactly as in a browser.
function loadSandbox({ localStorage, fetchImpl, now }) {
  const sandbox = {
    RentalQuirks: {},
    on_class_added: () => {},
    location: { pathname: '/', origin: 'https://example.rentalworks.cloud' },
    localStorage,
    navigator: {},
    document: { documentElement: {}, body: {}, createElement: () => ({ style: {} }) },
    fetch: fetchImpl,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    Promise, Set, Map, JSON, Object, Array, Error, String, Number, RegExp,
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  const RealDate = Date;
  const clock = { t: now };
  sandbox.__clock = clock;
  sandbox.Date = now === undefined ? Date : class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [clock.t])); }
    static now() { return clock.t; }
  };
  vm.createContext(sandbox);
  for (const f of ['js/rq_common.js', 'js/rq_sheets.js']) {
    vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
  }
  return sandbox;
}

// Lifts a named function out of a source file by walking braces, so the test runs
// the shipped implementation rather than a copy that can drift from it.
function extractFn(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  let start = src.indexOf(`  function ${name}(`);
  if (start === -1) start = src.indexOf(`  async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in ${file}`);
  // Walk the parameter list first: destructured params contain braces of their own,
  // so scanning for the first '{' after the name finds the wrong one.
  let i = src.indexOf('(', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  i = src.indexOf('{', i);
  for (depth = 0; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unterminated ${name}`);
}

function gviz(rows, cols) {
  return `/*O_o*/\ngoogle.visualization.Query.setResponse({"status":"ok","table":{"cols":${
    JSON.stringify(cols.map(l => ({ label: l })))},"rows":${
    JSON.stringify(rows.map(r => ({ c: r.map(v => (v === null ? null : { v })) })))}}});`;
}

const COLS = ['Order No.', 'Prep Tech', 'Prep Location'];
const NOW = new Date(2026, 2, 5, 13, 30).getTime(); // crosses a month boundary going back

// -- Module surface --------------------------------------------------------
{
  const sb = loadSandbox({ localStorage: storageProxy(), fetchImpl: () => {} });
  const common = fs.readFileSync('js/rq_common.js', 'utf8');
  // Declarations are checked against source text: top-level let/const do not become
  // properties of a vm context, so `typeof sb.x` cannot prove one is absent.
  const declares = (src, n) =>
    new RegExp(`(function|const|let|var)\\s+${n}\\b|\\b${n}\\s*=\\s*(function|\\()`).test(src);

  console.log('module surface:');
  check('RQ.sheets exposes exactly what the Preps card uses',
        Object.keys(sb.window.RentalQuirks.sheets).sort(),
        ['clearCache', 'fetchPrepGroups', 'fetchPrepRows', 'fmtDate', 'getSheetIdFromUrl', 'windowDates']);
  check('poller-era helpers stay removed',
        ['makeStatePruner', 'runIfLeader', 'sleep'].filter(n => declares(common, n)), []);
  check('rq_common keeps its long-standing helpers',
        ['toTitleCase', 'multiword_match', 'doChangeEvent', 'find_tab_by_name', 'WindowDragger', 'RW_URL']
          .filter(n => !declares(common, n)), []);
  check('onFormLoadComplete is shared from rq_common',
        typeof sb.window.RentalQuirks.onFormLoadComplete, 'function');
  check('toTitleCase still behaves', sb.toTitleCase('4ft rgb led  panel'), '4ft RGB LED Panel');
}

// -- Date windows ----------------------------------------------------------
{
  const S = loadSandbox({ localStorage: storageProxy(), fetchImpl: () => {}, now: NOW }).window.RentalQuirks.sheets;
  console.log('date windows:');
  check('fmtDate has no leading zeros', S.fmtDate(new Date(2026, 3, 10)), '2026-4-10');
  const w = S.windowDates(7, 13).map(d => d.str);
  check('Preps window is -7..+13 (21 tabs), across a month boundary',
        [w.length, w[0], w[7], w[20]], [21, '2026-2-26', '2026-3-5', '2026-3-18']);
  check('windowDates yields Date objects too', S.windowDates(7, 13)[0].date instanceof Date, true);
}

// -- Sheet reading, request cache, formatting, cache invariants -------------
(async () => {
  const responses = {
    '2026-3-5': gviz([['LA1001', 'Dana', 'Rm 1'], [null, 'Ghost', 'Rm 2'], ['LA1002', 'Reese', 'Rm 2']], COLS),
    '2026-3-6': gviz([['LA1003', 'Sam', 'Rm 1']], COLS),
    '2026-3-7': 'not a gviz response at all',
    '2026-3-8': '__NETWORK_ERROR__',
  };
  const fetchImpl = (url) => {
    const tab = decodeURIComponent(new RegExp('[?&]sheet=([^&]*)').exec(url)[1]);
    const body = responses[tab];
    if (body === '__NETWORK_ERROR__') return Promise.reject(new Error('offline'));
    if (body === undefined) return Promise.resolve({ text: () => Promise.resolve(gviz([], COLS)) });
    return Promise.resolve({ text: () => Promise.resolve(body) });
  };
  const S = loadSandbox({ localStorage: storageProxy(), fetchImpl, now: NOW }).window.RentalQuirks.sheets;

  console.log('sheet reading:');
  check('getSheetIdFromUrl extracts the id',
        S.getSheetIdFromUrl('https://docs.google.com/spreadsheets/d/SHEET_ID_123/edit#gid=0'), 'SHEET_ID_123');
  check('getSheetIdFromUrl rejects junk', S.getSheetIdFromUrl('not-a-sheet'), null);
  check('getSheetIdFromUrl tolerates null', S.getSheetIdFromUrl(null), null);

  const rows = await S.fetchPrepRows('SHEET', '2026-3-5');
  check('rows without an order number are dropped', rows.length, 2);
  check('raw columns preserved for the dashboard', rows[0]['Prep Location'], 'Rm 1');
  check('malformed body yields []', (await S.fetchPrepRows('SHEET', '2026-3-7')).length, 0);
  check('network error yields [] rather than rejecting', (await S.fetchPrepRows('SHEET', '2026-3-8')).length, 0);

  const groups = await S.fetchPrepGroups('SHEET', S.windowDates(0, 3));
  check('empty days omitted from groups', groups.map(g => g.str), ['2026-3-5', '2026-3-6']);
  check('group keeps its Date', groups[0].date instanceof Date, true);
  check('group rows keep every column', Object.keys(groups[0].rows[0]).sort(), [...COLS].sort());

  console.log('request cache:');
  let calls = 0;
  const sbC = loadSandbox({ localStorage: storageProxy(),
                           fetchImpl: (u) => { calls++; return fetchImpl(u); }, now: NOW });
  const SC = sbC.window.RentalQuirks.sheets;
  await SC.fetchPrepRows('SHEET', '2026-3-5');
  check('first call hits the network', calls, 1);
  await SC.fetchPrepRows('SHEET', '2026-3-5');
  check('second call within TTL served from cache', calls, 1);
  await SC.fetchPrepRows('SHEET', '2026-3-6');
  check('a different tab is fetched separately', calls, 2);
  calls = 0;
  const [r1, r2] = await Promise.all([SC.fetchPrepRows('SHEET', '2026-3-9'), SC.fetchPrepRows('SHEET', '2026-3-9')]);
  check('concurrent calls for one tab share a single fetch', calls, 1);
  check('both concurrent callers get the same array', r1 === r2, true);
  sbC.__clock.t = NOW + 3 * 60 * 1000; // past the 2-minute TTL
  calls = 0;
  await SC.fetchPrepRows('SHEET', '2026-3-5');
  check('cache expires after TTL', calls, 1);

  // -- formatDateRange, lifted from rq_dashboard.js -------------------------
  console.log('date range formatting:');
  const formatDateRange = new Function(extractFn('js/rq_dashboard.js', 'formatDateRange') + '; return formatDateRange;')();
  const Y = new Date().getFullYear();
  check('range within this year drops the year', formatDateRange(`${Y}-09-03`, `${Y}-09-10`), 'Sep 3 \u2013 Sep 10');
  check('same start and stop collapses to one date', formatDateRange(`${Y}-09-03`, `${Y}-09-03`), 'Sep 3');
  check('start only', formatDateRange(`${Y}-09-03`, null), 'Sep 3');
  check('stop only', formatDateRange(null, `${Y}-09-10`), 'Sep 10');
  check('neither yields null', formatDateRange(null, null), null);
  check('malformed dates yield null', formatDateRange('garbage', 'also garbage'), null);
  check('other-year dates carry the year',
        formatDateRange(`${Y + 1}-01-05`, `${Y + 1}-01-09`), `Jan 5, ${Y + 1} \u2013 Jan 9, ${Y + 1}`);
  check('year boundary annotates only the far side',
        formatDateRange(`${Y}-12-30`, `${Y + 1}-01-02`), `Dec 30 \u2013 Jan 2, ${Y + 1}`);

  // -- detailCache shape invariant ------------------------------------------
  // Two writers once used different shapes ({data, fetchedAt} vs {record}), forcing
  // every reader to probe both. These guard the single-shape invariant.
  console.log('detailCache invariant:');
  const dash = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  const writes = dash.match(/detailCache\.set\([^;]*\);/g) || [];
  check('every writer emits { data, fetchedAt }',
        writes.filter(w => !(/data:/.test(w) && /fetchedAt:/.test(w))), []);
  check('both known writers are present', writes.length >= 2, true);
  check('no reader probes the old bare-record shape',
        (dash.match(/\?\?\s*(cached|detail)\?\.record\b/g) || []), []);
  // Scoped to the set() calls rather than the whole file: a mention of this in a
  // comment must not be enough to satisfy the check.
  check('list stubs are stored stale so a real fetch still happens',
        writes.some(w => /fetchedAt:\s*0\b/.test(w)), true);

  // -- Sub Rentals card logic, lifted from rq_dashboard.js -----------------
  console.log('sub rentals:');
  const SR = new Function(
    extractFn('js/rq_dashboard.js', 'decodeGridRows') +
    extractFn('js/rq_dashboard.js', 'subItemNeedsSourcing') +
    extractFn('js/rq_dashboard.js', 'groupSubRentalsByPickDate') +
    extractFn('js/rq_dashboard.js', 'mapWithLimit') +
    '; return { decodeGridRows, subItemNeedsSourcing, groupSubRentalsByPickDate, mapWithLimit };')();

  // RW grid endpoints answer columnar: ColumnIndex maps field -> position.
  check('decodes columnar grid rows',
        SR.decodeGridRows({ ColumnIndex: { OrderNumber: 0, ICode: 1, Vendor: 2 },
                            Rows: [['LA1', 'FX3', 'MEDIA BOX'], ['LA1', 'LENS', '']] }),
        [{ OrderNumber: 'LA1', ICode: 'FX3', Vendor: 'MEDIA BOX' },
         { OrderNumber: 'LA1', ICode: 'LENS', Vendor: '' }]);
  check('null response decodes to []', SR.decodeGridRows(null), []);
  check('response without Rows decodes to []', SR.decodeGridRows({ ColumnIndex: { A: 0 } }), []);

  // Sourcing attaches a vendor AND a sub-PO; anything short of both still needs chasing.
  check('vendor + PO counts as sourced',
        SR.subItemNeedsSourcing({ Vendor: 'MEDIA BOX', PurchaseOrderNumber: 'LA19992' }), false);
  check('neither vendor nor PO needs sourcing',
        SR.subItemNeedsSourcing({ Vendor: '', PurchaseOrderNumber: '' }), true);
  check('vendor but no PO still needs sourcing',
        SR.subItemNeedsSourcing({ Vendor: 'MEDIA BOX', PurchaseOrderNumber: '' }), true);
  check('whitespace counts as empty',
        SR.subItemNeedsSourcing({ Vendor: '  ', PurchaseOrderNumber: '  ' }), true);
  check('absent fields need sourcing', SR.subItemNeedsSourcing({}), true);

  const grouped = SR.groupSubRentalsByPickDate([
    { order: { OrderNumber: 'B', PickDate: '2026-09-10' }, items: [1] },
    { order: { OrderNumber: 'A', PickDate: '2026-09-04' }, items: [1] },
    { order: { OrderNumber: 'C', PickDate: '2026-09-04' }, items: [1] },
    { order: { OrderNumber: 'D', PickDate: '' },           items: [1] },
  ]);
  check('groups sort by pick date, undated last',
        grouped.map(g => g.dateStr), ['2026-09-04', '2026-09-10', 'nodate']);
  check('orders within a day sort by number',
        grouped[0].entries.map(e => e.order.OrderNumber), ['A', 'C']);
  check('a datetime pick date is trimmed to the day',
        SR.groupSubRentalsByPickDate([{ order: { OrderNumber: 'A', PickDate: '2026-09-04T00:00:00Z' }, items: [1] }])[0].dateStr,
        '2026-09-04');

  let inflight = 0, peak = 0;
  const mapped = await SR.mapWithLimit([1,2,3,4,5,6,7,8,9,10], 3, async n => {
    inflight++; peak = Math.max(peak, inflight);
    await new Promise(r => setTimeout(r, 5));
    inflight--; return n * 2;
  });
  check('mapWithLimit preserves input order', mapped, [2,4,6,8,10,12,14,16,18,20]);
  check('mapWithLimit never exceeds the cap', peak <= 3, true);
  check('mapWithLimit handles an empty list', await SR.mapWithLimit([], 3, async x => x), []);


  // -- Built-in card registries must agree -----------------------------------
  // A card has to be listed in three places: BUILTIN_IDS, BUILTIN_BUILDERS (what
  // constructs it) and BUILTIN_SECTION_DEFS (the "Add Section" menu). Sub Rentals
  // shipped registered in the first two but not the third, so it existed and
  // simply could not be added to a dashboard. These keep the three in step.
  console.log('card registries:');
  const dashSrc = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  const listOf = (re, inner) => [...dashSrc.match(re)[1].matchAll(inner)].map(m => m[1]).sort();
  const ids      = listOf(/const BUILTIN_IDS\s*=\s*\[(.*?)\]/s, /'([^']+)'/g);
  const defs     = listOf(/const BUILTIN_SECTION_DEFS = \[(.*?)\];/s, /id: '([^']+)'/g);
  const builders = listOf(/const BUILTIN_BUILDERS = \{(.*?)\n  \};/s, /^\s*(\w+):/gm);

  check('every built-in id has a builder', ids.filter(i => !builders.includes(i)), []);
  check('every built-in id is offered in the Add Section menu', ids.filter(i => !defs.includes(i)), []);
  check('nothing is offered that is not a built-in id', defs.filter(d => !ids.includes(d)), []);
  check('nothing has a builder that is not a built-in id', builders.filter(b => !ids.includes(b)), []);
  check('the new card is registered everywhere',
        [ids, defs, builders].map(l => l.includes('subrentals')), [true, true, true]);


  // -- Grid browse payload + PO line items -----------------------------------
  // The PO screen's own request was captured from the network tab; these pin the
  // quirks of it, because none of them are guessable: PO lines come from the
  // *order* item grid, and the PO's id travels in uniqueids under the key OrderId.
  console.log('grid browse / PO items:');
  const GB = new Function('window', 'crypto',
    extractFn('js/rq_dashboard.js', 'buildGridBrowsePayload') +
    extractFn('js/rq_dashboard.js', 'pickField') +
    '; return { buildGridBrowsePayload, pickField };')(
    { applicationConfig: { clientVersion: '2026.1.008' } }, { randomUUID: () => 'uuid-1' });

  const poPayload = GB.buildGridBrowsePayload({
    module: 'OrderItemGrid',
    miscfields: { PurchaseOrderId: { datafield: 'PurchaseOrderId', value: 'A01YDY2D' } },
    uniqueids: { OrderId: 'A01YDY2D', RecType: 'R', Subs: true, NoAvailabilityCheck: true },
    orderby: 'ItemOrder asc' });

  check('PO lines use the order item grid module', poPayload.module, 'OrderItemGrid');
  check('scoped by miscfields.PurchaseOrderId', poPayload.miscfields,
        { PurchaseOrderId: { datafield: 'PurchaseOrderId', value: 'A01YDY2D' } });
  check('uniqueids carry the PO id under the OrderId key', poPayload.uniqueids,
        { OrderId: 'A01YDY2D', RecType: 'R', Subs: true, NoAvailabilityCheck: true });
  check('paging defaults', [poPayload.pageno, poPayload.pagesize], [1, 500]);
  check('clientVersion is read from RW, not hardcoded', poPayload.clientVersion, '2026.1.008');
  check('envelope carries every key RW expects',
        ['activeview','boundids','clientVersion','fields','filterfields','miscfields','module',
         'options','orderby','orderbydirection','pageno','pagesize','requestid','searchcondition',
         'searchconjunctions','searchfieldoperators','searchfields','searchfieldtypes',
         'searchfieldvalues','searchgroupings','searchseparators','timezoneOffset','top',
         'totalfields','uniqueids'].filter(k => !(k in poPayload)), []);

  // Column names differ between grids, so the renderer tries several spellings.
  const CODE = ['ICode', 'ItemCode', 'Code'];
  const QTY  = ['QuantityOrdered', 'Quantity', 'OrderQuantityOrdered', 'SubQuantity', 'Qty'];
  check('picks the first present code field', GB.pickField({ ICode: 'FX3' }, CODE), 'FX3');
  check('falls back to a later spelling', GB.pickField({ ItemCode: 'LENS' }, CODE), 'LENS');
  check('treats empty string as absent', GB.pickField({ ICode: '', Code: 'X' }, CODE), 'X');
  check('null when no candidate matches', GB.pickField({ Nope: 1 }, CODE), null);
  check('quantity from QuantityOrdered', GB.pickField({ QuantityOrdered: 3 }, QTY), 3);
  check('quantity falls back to SubQuantity', GB.pickField({ SubQuantity: 2 }, QTY), 2);
  check('an absent row is safe', GB.pickField(undefined, CODE), null);

  // extractFn itself: it must survive destructured parameter lists.
  check('extractFn handles destructured params',
        extractFn('js/rq_dashboard.js', 'buildGridBrowsePayload').trim().endsWith('}'), true);


  // -- The "+N more" expander -------------------------------------------------
  // Driven through a minimal fake DOM so the real renderRowItems is exercised,
  // including the collapse path, which is easy to get wrong (a list of exactly
  // PREVIEW items must show no toggle at all).
  console.log('item expander:');
  const fakeEl = (tag, css, html) => {
    const node = {
      tag, style: {}, children: [], textContent: html ?? '', handlers: {},
      appendChild(c) { node.children.push(c); return c; },
      append(...cs) { node.children.push(...cs); },
      addEventListener(t, fn) { (node.handlers[t] ||= []).push(fn); },
      click() { (node.handlers.click || []).forEach(fn => fn({ stopPropagation() {} })); },
      set innerHTML(v) { if (v === '') node.children.length = 0; },
      get innerHTML() { return ''; },
    };
    return node;
  };

  const RRI = new Function('el', 'ROW_ITEMS_PREVIEW', 'buildRowItemLine',
    extractFn('js/rq_dashboard.js', 'renderRowItems') + '; return renderRowItems;')(
    fakeEl, 4, (it) => ({ line: it.ICode }));

  const mk = n => Array.from({ length: n }, (_, i) => ({ ICode: 'I' + i }));
  const drive = (n) => {
    const holder = fakeEl('div');
    RRI(holder, mk(n));
    const [list, toggle] = holder.children;
    return { holder, list, toggle };
  };

  let v = drive(10);
  check('shows only the preview count at first', v.list.children.length, 4);
  check('toggle reports the remainder', v.toggle.textContent, '+6 more');
  check('toggle is visible when there is a remainder', v.toggle.style.display, '');

  v.toggle.click();
  check('expands to every item', v.list.children.length, 10);
  check('toggle offers to collapse', v.toggle.textContent, 'show less');

  v.toggle.click();
  check('collapses back to the preview', v.list.children.length, 4);
  check('toggle reports the remainder again', v.toggle.textContent, '+6 more');

  v = drive(3);
  check('short list shows everything', v.list.children.length, 3);
  check('short list hides the toggle', v.toggle.style.display, 'none');

  v = drive(4);
  check('exactly the preview count shows all', v.list.children.length, 4);
  check('exactly the preview count hides the toggle', v.toggle.style.display, 'none');

  const empty = fakeEl('div');
  RRI(empty, []);
  check('no items renders nothing', empty.children.length, 0);

  // Sub Rentals must go through the same expander rather than its own loop.
  const dashSrc2 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  // The order block takes its line builder as a parameter (Shortages passes its
  // own); Sub Rentals relies on the default, so pin both halves.
  check('sub-rental blocks use the shared expander',
        /function buildSubRentalOrderBlock\(order, items, buildLine = buildSubRentalItemLine\)[\s\S]{0,2000}?renderRowItems\(holder, items, buildLine\)/.test(dashSrc2), true);
  check('sub-rental quantities survive the shared line builder',
        /ITEM_QTY_FIELDS\s*=\s*\[[^\]]*'SubQuantity'/.test(dashSrc2), true);


  // -- Hiding undated records -------------------------------------------------
  // "Missing both" is the rule: one date is enough to keep a record. The absent-
  // field case matters most - if the list response omits these columns entirely,
  // filtering must be skipped rather than dropping every row.
  console.log('undated filter:');
  let warned = null;
  // Rebuilt per case so the once-only warning flag starts fresh each time.
  const mkFilter = () => {
    warned = null;
    const fn = new Function('console', 'let warnedNoScheduleDates = false;' +
      extractFn('js/rq_dashboard.js', 'hasAnyScheduleDate') +
      '; return hasAnyScheduleDate;')({ warn: (m) => { warned = m; } });
    return fn;
  };

  let keep = mkFilter();
  check('both dates present -> kept',
        keep({ EstimatedStartDate: '2026-09-04', EstimatedStopDate: '2026-09-18' }), true);
  check('start only -> kept',
        keep({ EstimatedStartDate: '2026-09-04', EstimatedStopDate: '' }), true);
  check('stop only -> kept',
        keep({ EstimatedStartDate: '', EstimatedStopDate: '2026-09-18' }), true);
  check('both empty -> hidden',
        keep({ EstimatedStartDate: '', EstimatedStopDate: '' }), false);
  check('both whitespace -> hidden',
        keep({ EstimatedStartDate: '  ', EstimatedStopDate: '  ' }), false);
  check('both null -> hidden',
        keep({ EstimatedStartDate: null, EstimatedStopDate: null }), false);
  check('no warning while the fields exist', warned, null);

  keep = mkFilter();
  check('fields absent entirely -> kept, not dropped', keep({ PurchaseOrderNumber: 'LA1' }), true);
  check('and it says so', /cannot be hidden without a fetch per row/.test(warned || ''), true);

  keep = mkFilter();
  keep({ A: 1 }); const first = warned; warned = null; keep({ B: 2 });
  check('the warning fires only once', [first !== null, warned], [true, null]);

  // My POs must actually be wired to it.
  const dashSrc3 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  // My POs composes this with the consignment filter, so assert the date check is
  // reached rather than pinning the exact rowFilter name.
  check('My POs row filter reaches the date check',
        /function keepPurchaseOrderRow[\s\S]{0,300}?hasAnyScheduleDate\(r\)/.test(dashSrc3), true);
  check('My POs is wired to a rowFilter at all',
        /mypos:[\s\S]{0,700}?rowFilter: \w+/.test(dashSrc3), true);
  check('the filter is applied alongside the status filter',
        /!hidden\.has\(i\.Status\) && keep\(i\)/.test(dashSrc3), true);


  // -- Hiding consignment POs -------------------------------------------------
  console.log('consignment filter:');
  const mkConsign = () => {
    warned = null;
    return new Function('console', 'pickField',
      'let warnedNoPoClass = false;' +
      "const PO_CLASS_FIELDS = ['Classification', 'PurchaseOrderClassification', 'POClassification', 'ClassificationName', 'Type'];" +
      extractFn('js/rq_dashboard.js', 'isConsignment') +
      '; return isConsignment;')({ warn: (m) => { warned = m; } }, GB.pickField);
  };

  let isCon = mkConsign();
  check('Consignment is hidden',            isCon({ Classification: 'Consignment' }), true);
  check('uppercase CONSIGNMENT is hidden',  isCon({ Classification: 'CONSIGNMENT' }), true);
  check('a suffixed value still matches',   isCon({ Classification: 'CONSIGNMENT - LA' }), true);
  check('Rental Inventory is kept',         isCon({ Classification: 'RENTAL INVENTORY' }), false);
  check('an empty classification is kept',  isCon({ Classification: '' }), false);
  check('the sub-item grid spelling works', isCon({ PurchaseOrderClassification: 'CONSIGNMENT' }), true);
  check('no warning while a field exists',  warned, null);

  isCon = mkConsign();
  check('no classification field -> kept, not hidden', isCon({ PurchaseOrderNumber: 'LA1' }), false);
  check('and it says which names it looked for', /looked for Classification/.test(warned || ''), true);

  // The two PO filters must compose: scheduled AND not consignment.
  const keepPO = new Function('hasAnyScheduleDate', 'isConsignment',
    extractFn('js/rq_dashboard.js', 'keepPurchaseOrderRow') + '; return keepPurchaseOrderRow;');
  const dated = r => !!(r.start), consign = r => !!(r.consign);
  const fn = keepPO(dated, consign);
  check('scheduled, not consignment -> kept', fn({ start: 1, consign: 0 }), true);
  check('scheduled consignment -> hidden',    fn({ start: 1, consign: 1 }), false);
  check('undated, not consignment -> hidden', fn({ start: 0, consign: 0 }), false);
  check('undated consignment -> hidden',      fn({ start: 0, consign: 1 }), false);

  const dashSrc4 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('My POs uses the combined filter',
        /mypos:[\s\S]{0,700}?rowFilter: keepPurchaseOrderRow/.test(dashSrc4), true);


  // -- Row labelling ----------------------------------------------------------
  // Orders and quotes lead with the job description; a PO leads with the vendor,
  // and whichever label loses the top line must reappear on the second, never be
  // dropped.
  console.log('row labels:');
  const RL = new Function(
    extractFn('js/rq_dashboard.js', 'defaultRowLabels') +
    extractFn('js/rq_dashboard.js', 'purchaseOrderRowLabels') +
    '; return { defaultRowLabels, purchaseOrderRowLabels };')();

  const po = { Description: 'BURGER KING', Vendor: 'MEDIA BOX INC', PurchaseOrderNumber: 'LA19992' };
  check('default leads with the description',
        RL.defaultRowLabels(po, 'PurchaseOrderNumber').primary, 'BURGER KING');
  check('default puts the vendor underneath',
        RL.defaultRowLabels(po, 'PurchaseOrderNumber').sub, 'MEDIA BOX INC');
  check('My POs leads with the vendor',
        RL.purchaseOrderRowLabels(po, 'PurchaseOrderNumber').primary, 'MEDIA BOX INC');
  check('My POs puts the description underneath',
        RL.purchaseOrderRowLabels(po, 'PurchaseOrderNumber').sub, 'BURGER KING');

  const noVendor = { Description: 'BURGER KING', PurchaseOrderNumber: 'LA19992' };
  check('no vendor falls back to the description on top',
        RL.purchaseOrderRowLabels(noVendor, 'PurchaseOrderNumber').primary, 'BURGER KING');
  const bare = { PurchaseOrderNumber: 'LA19992' };
  check('nothing but a number still labels the row',
        RL.purchaseOrderRowLabels(bare, 'PurchaseOrderNumber').primary, 'LA19992');
  check('and leaves the second line empty',
        RL.purchaseOrderRowLabels(bare, 'PurchaseOrderNumber').sub, null);
  check('default falls back to the customer when there is no vendor',
        RL.defaultRowLabels({ Description: 'D', Customer: 'ACME' }, 'X').sub, 'ACME');

  const dashSrc5 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('My POs is wired to the vendor-first labels',
        /mypos:[\s\S]{0,800}?rowLabels: purchaseOrderRowLabels/.test(dashSrc5), true);
  check('the sub label reaches the row meta',
        /vendor: sub, customer: null/.test(dashSrc5), true);


  // -- Expanded (full-screen) layout ------------------------------------------
  // Driven through a fake DOM so the real applyDashboardLayout runs. The property
  // that matters is that the two modes fully undo each other: a leftover
  // gridTemplateColumns or flexDirection makes the other layout misbehave.
  console.log('expanded layout:');
  const layoutStore = storageProxy();
  const nodes = {
    'rq-dashboard':      { style: {} },
    'rq-dashboard-body': { style: {} },
    'rq-dashboard-expand': { style: {}, textContent: '', title: '' },
  };
  // Masonry start/stop are spied here and exercised for real further down.
  const masonryCalls = [];
  const LY = new Function('localStorage', 'document', 'startMasonry', 'stopMasonry',
    "const DASH_EXPANDED_KEY='rq-dashboard-expanded';const DASH_PANEL_WIDTH='575px';const DASH_MIN_COLUMN=340;const MASONRY_ROW=4;const MASONRY_GAP=16;" +
    extractFn('js/rq_dashboard.js', 'isDashExpanded') +
    extractFn('js/rq_dashboard.js', 'applyDashboardLayout') +
    extractFn('js/rq_dashboard.js', 'toggleDashboardExpanded') +
    '; return { isDashExpanded, applyDashboardLayout, toggleDashboardExpanded };')(
    layoutStore, { getElementById: (id) => nodes[id] ?? null },
    () => masonryCalls.push('start'), () => masonryCalls.push('stop'));

  const panelNode = nodes['rq-dashboard'], bodyNode = nodes['rq-dashboard-body'], btnNode = nodes['rq-dashboard-expand'];

  LY.applyDashboardLayout();
  check('defaults to the narrow panel', panelNode.style.width, '575px');
  check('defaults to a single column', bodyNode.style.display, 'flex');
  check('button offers to expand', btnNode.textContent, 'open_in_full');

  LY.toggleDashboardExpanded();
  check('expands to the viewport', panelNode.style.width, '100vw');
  check('cards flow into a grid', bodyNode.style.display, 'grid');
  check('columns are responsive with a readable floor',
        bodyNode.style.gridTemplateColumns, 'repeat(auto-fill, minmax(340px, 1fr))');
  check('cards keep their own height', bodyNode.style.alignItems, 'start');
  check('flexDirection is cleared so it cannot fight the grid', bodyNode.style.flexDirection, '');
  // Masonry: fine rows that each card spans, with spacing built into the span.
  check('rows are the fine masonry unit', bodyNode.style.gridAutoRows, '4px');
  check('the grid adds no row gap of its own', bodyNode.style.rowGap, '0');
  check('cards keep a gap across', bodyNode.style.columnGap, '16px');
  check('rows pack to the top', bodyNode.style.alignContent, 'start');
  check('expanding starts masonry', masonryCalls.at(-1), 'start');
  check('button offers to shrink', btnNode.textContent, 'close_fullscreen');
  check('the choice is persisted', layoutStore.getItem('rq-dashboard-expanded'), '1');

  LY.toggleDashboardExpanded();
  check('shrinks back to the panel', panelNode.style.width, '575px');
  check('returns to a single column', bodyNode.style.display, 'flex');
  check('gridTemplateColumns is cleared', bodyNode.style.gridTemplateColumns, '');
  check('alignItems is cleared', bodyNode.style.alignItems, '');
  check('gridAutoRows is cleared', bodyNode.style.gridAutoRows, '');
  check('alignContent is cleared', bodyNode.style.alignContent, '');
  check('rowGap and columnGap are cleared', [bodyNode.style.rowGap, bodyNode.style.columnGap], ['', '']);
  check('the panel gap is restored', bodyNode.style.gap, '16px');
  check('shrinking stops masonry', masonryCalls.at(-1), 'stop');
  check('flexDirection is restored', bodyNode.style.flexDirection, 'column');

  // A saved preference must survive a fresh panel.
  layoutStore.setItem('rq-dashboard-expanded', '1');
  LY.applyDashboardLayout();
  check('a saved expanded state is restored on open', bodyNode.style.display, 'grid');

  // Missing nodes must not throw - the panel is built lazily.
  const LY2 = new Function('localStorage', 'document', 'startMasonry', 'stopMasonry',
    "const DASH_EXPANDED_KEY='rq-dashboard-expanded';const DASH_PANEL_WIDTH='575px';const DASH_MIN_COLUMN=340;const MASONRY_ROW=4;const MASONRY_GAP=16;" +
    extractFn('js/rq_dashboard.js', 'isDashExpanded') +
    extractFn('js/rq_dashboard.js', 'applyDashboardLayout') +
    '; return applyDashboardLayout;')(layoutStore, { getElementById: () => null }, () => {}, () => {});
  let threw = false;
  try { LY2(); } catch { threw = true; }
  check('no panel yet is a no-op, not a throw', threw, false);

  // -- Masonry packing, run for real against fake observers --------------------
  console.log('masonry:');
  const observers = { resize: null, mutate: null };
  class FakeRO { constructor(cb) { this.cb = cb; this.seen = []; observers.resize = this; }
    observe(n) { this.seen.push(n); } disconnect() { this.off = true; } }
  class FakeMO { constructor(cb) { this.cb = cb; observers.mutate = this; }
    observe() {} disconnect() { this.off = true; } }
  const M = new Function('ResizeObserver', 'MutationObserver',
    'const MASONRY_ROW=4;const MASONRY_GAP=16;let masonryResize=null;let masonryMutate=null;' +
    extractFn('js/rq_dashboard.js', 'masonrySpan') +
    extractFn('js/rq_dashboard.js', 'sizeMasonryItem') +
    extractFn('js/rq_dashboard.js', 'startMasonry') +
    extractFn('js/rq_dashboard.js', 'stopMasonry') +
    '; return { masonrySpan, sizeMasonryItem, startMasonry, stopMasonry };')(FakeRO, FakeMO);

  check('span covers the card plus the gap', M.masonrySpan(100), 29);   // (100+16)/4
  check('span rounds up rather than clipping', M.masonrySpan(101), 30);
  check('a zero-height card still spans a row', M.masonrySpan(0) >= 1, true);
  check('a long card spans proportionally more', M.masonrySpan(2000) > M.masonrySpan(200) * 9, true);

  const card = (h, hidden = false) => ({ nodeType: 1, style: {}, offsetParent: hidden ? null : {},
    getBoundingClientRect: () => ({ height: h }) });
  const tall = card(800), short = card(120), hiddenCard = card(300, true);
  const mBody = { children: [tall, short, hiddenCard] };
  M.startMasonry(mBody);
  check('each card spans rows for its own height',
        [tall.style.gridRowEnd, short.style.gridRowEnd], ['span 204', 'span 34']);
  // Cleared by the reset at the top of startMasonry, never given a span of its own.
  check('a card on another tab gets no span', hiddenCard.style.gridRowEnd || '', '');
  check('every card is watched for resizes', observers.resize.seen.length, 3);

  // A card grows after layout - items loaded, "+N more" clicked.
  short.getBoundingClientRect = () => ({ height: 400 });
  observers.resize.cb([{ target: short }]);
  check('a resized card is re-spanned', short.style.gridRowEnd, 'span 104');

  // A card added later (tab switch, Add Section) is picked up.
  const added = card(60);
  observers.mutate.cb([{ addedNodes: [added] }]);
  check('a newly added card is spanned', added.style.gridRowEnd, 'span 19');
  check('and watched', observers.resize.seen.includes(added), true);

  const ro = observers.resize, mo = observers.mutate;
  M.stopMasonry(mBody);
  check('stopping disconnects both observers', [ro.off, mo.off], [true, true]);
  check('stopping clears every span',
        mBody.children.map(c => c.style.gridRowEnd), ['', '', '']);

  const dashSrc6 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('card reordering follows the layout axis',
        /isDashExpanded\(\)\s*\?\s*e\.clientX/.test(dashSrc6), true);
  check('both reorder handlers were updated',
        (dashSrc6.match(/isDashExpanded\(\)\s*\n?\s*\?\s*e\.clientX/g) || []).length, 2);
  check('the layout is applied when the panel opens',
        /applyDashboardLayout\(\); \/\/ restore the saved/.test(dashSrc6), true);


  // -- Due-today row highlight ------------------------------------------------
  // Runs the real applyBadge against a fake row and a fixed clock. The marker is
  // an inset shadow rather than a background because rows assign background
  // inline on hover; the class must also be cleared on every pass, or a record
  // stays highlighted after being snoozed or rescheduled.
  console.log('due-today highlight:');
  const TODAY = new Date(2026, 8, 3).getTime(); // 2026-09-03, local
  const mkRow = () => {
    const c = new Set();
    return { classList: { add: x => c.add(x), remove: x => c.delete(x), contains: x => c.has(x) } };
  };
  const mkBadge = () => ({ style: {}, dataset: {}, textContent: '', title: '' });

  const mkApplyBadge = ({ snoozed = false } = {}) => {
    const row = mkRow(), badge = mkBadge();
    const RealDate = Date;
    const ClockDate = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [TODAY])); }
    };
    const fn = new Function('row', 'badge', 'isSnoozed', 'isSectionHiding', 'module', 'recordNumber', 'Date',
      extractFn('js/rq_dashboard.js', 'applyBadge') + '; return applyBadge;')(
      row, badge, () => snoozed, () => false, 'Order', 'LA1', ClockDate);
    return { fn, row, badge };
  };

  let t = mkApplyBadge();
  t.fn('2026-09-03');
  check('due today is highlighted', t.row.classList.contains('rq-due-today'), true);
  check('and the badge says so', t.badge.textContent, 'due today');

  t = mkApplyBadge();
  t.fn('2026-09-04');
  check('due tomorrow is not highlighted', t.row.classList.contains('rq-due-today'), false);

  t = mkApplyBadge();
  t.fn('2026-09-01');
  check('overdue is not highlighted', t.row.classList.contains('rq-due-today'), false);
  check('but still badged as overdue', /overdue/.test(t.badge.textContent), true);

  t = mkApplyBadge();
  t.fn('2027-01-01');
  check('far future is not highlighted', t.row.classList.contains('rq-due-today'), false);

  t = mkApplyBadge();
  t.fn(null);
  check('no date is not highlighted', t.row.classList.contains('rq-due-today'), false);

  t = mkApplyBadge({ snoozed: true });
  t.fn('2026-09-03');
  check('a snoozed record due today is not highlighted', t.row.classList.contains('rq-due-today'), false);

  // The clearing path: highlighted, then re-applied with a date that is not today.
  t = mkApplyBadge();
  t.fn('2026-09-03');
  const wasSet = t.row.classList.contains('rq-due-today');
  t.fn('2026-09-10');
  check('rescheduling clears a previous highlight',
        [wasSet, t.row.classList.contains('rq-due-today')], [true, false]);
  t.fn('2026-09-03');
  t.fn(null);
  check('losing the date clears the highlight too', t.row.classList.contains('rq-due-today'), false);

  const dashSrc7 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('the marker survives hover by not using background',
        /\.rq-due-today \{ box-shadow: inset/.test(dashSrc7), true);


  // -- Agent query cap --------------------------------------------------------
  // The cards ask for a single page with no ordering, so exceeding the cap loses
  // records silently. These pin the cap, that it reaches the query, and that the
  // notice appears only when the server says there is more.
  console.log('agent query cap:');
  const dashSrc8 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  const capMatch = dashSrc8.match(/const AGENT_PAGE_SIZE = (\d+);/);
  check('the cap is a named constant', !!capMatch, true);
  check('and is well above the old 50', Number(capMatch[1]) >= 200, true);
  check('the query uses the constant, not a literal',
        /pagesize=' \+ AGENT_PAGE_SIZE \+ '/.test(dashSrc8), true);
  check('no hardcoded pagesize=50 remains on the agent query',
        /apiurl \+ '\?pagesize=50/.test(dashSrc8), false);
  // The truncation notice was removed by request, so nothing should be left
  // threading a server total through the render path.
  check('no truncation notice remains', /totalAvailable/.test(dashSrc8), false);
  check('and its plumbing is gone with it',
        /setCachedSection\(cardId, \{ items, total,/.test(dashSrc8), false);


  // -- Refreshing ---------------------------------------------------------------
  console.log('refreshing:');
  const R = new Function(
    extractFn('js/rq_dashboard.js', 'sameData') +
    extractFn('js/rq_dashboard.js', 'formatAge') +
    '; return { sameData, formatAge };')();

  // Change detection is what keeps background refreshes from collapsing rows.
  check('identical data counts as unchanged', R.sameData([{ a: 1 }], [{ a: 1 }]), true);
  check('a changed field counts as changed', R.sameData([{ a: 1 }], [{ a: 2 }]), false);
  check('an added row counts as changed', R.sameData([1], [1, 2]), false);
  check('reordered rows count as changed', R.sameData([1, 2], [2, 1]), false);
  const cyc = {}; cyc.self = cyc;
  check('unserialisable data counts as changed, never throws', R.sameData(cyc, cyc), false);

  check('age under a minute', R.formatAge(30 * 1000), 'just now');
  check('age in minutes', R.formatAge(4 * 60 * 1000 + 5000), '4m ago');
  check('age in hours', R.formatAge(2 * 3600 * 1000 + 60000), '2h ago');

  // refreshNetworkCards touches only visible network cards, passing the mode on.
  const loaded = [];
  const RN = new Function('NETWORK_CARD_LOADERS', 'loadTabs', 'getActiveTab',
    extractFn('js/rq_dashboard.js', 'refreshNetworkCards') + '; return refreshNetworkCards;')(
    Object.fromEntries(['myorders', 'myquotes', 'mypos', 'subrentals', 'preps']
      .map(id => [id, (mode) => loaded.push([id, mode])])),
    () => [{}], () => ({ sections: ['bookmarks', 'myorders', 'preps', 'custom-1'] }));
  RN('background');
  check('only visible network cards are refreshed',
        loaded.map(l => l[0]), ['myorders', 'preps']);
  check('and they receive the mode', loaded.map(l => l[1]), ['background', 'background']);

  // autoRefresh does nothing unless the panel is open and the tab is visible.
  const runAuto = (open, visibility) => {
    const calls = [];
    const fn = new Function('isPanelOpen', 'document', 'refreshNetworkCards',
      'let lastAutoRefresh = 0;' + extractFn('js/rq_dashboard.js', 'autoRefresh') + '; return autoRefresh;')(
      () => open, { visibilityState: visibility }, (m) => calls.push(m));
    fn();
    return calls;
  };
  check('auto-refresh runs in background mode when open and visible', runAuto(true, 'visible'), ['background']);
  check('auto-refresh skips while the panel is closed', runAuto(false, 'visible'), []);
  check('auto-refresh skips while the browser tab is hidden', runAuto(true, 'hidden'), []);

  // Timers start once however often the panel opens, and stop cleanly.
  const timers = [];
  const TM = new Function('setInterval', 'clearInterval', 'autoRefresh', 'updateCardAges',
    'const AUTO_REFRESH_MS=1;const AGE_TICK_MS=1;let autoRefreshTimer=null;let ageTimer=null;let lastAutoRefresh=0;' +
    extractFn('js/rq_dashboard.js', 'startAutoRefresh') +
    extractFn('js/rq_dashboard.js', 'stopAutoRefresh') +
    '; return { startAutoRefresh, stopAutoRefresh };')(
    (fn) => { timers.push('set'); return timers.length; }, () => timers.push('clear'), () => {}, () => {});
  TM.startAutoRefresh(); TM.startAutoRefresh();
  check('opening twice does not stack timers', timers.filter(t => t === 'set').length, 2);
  TM.stopAutoRefresh();
  check('closing clears both timers', timers.filter(t => t === 'clear').length, 2);
  TM.startAutoRefresh();
  check('reopening after close starts them again', timers.filter(t => t === 'set').length, 4);

  // Age labels: shown for network cards, amber once older than the card's TTL,
  // hidden for cards that never fetch.
  const mkLabel = (id) => ({ dataset: { cardId: id }, style: {}, textContent: '', title: '' });
  const ordersLbl = mkLabel('myorders'), staleLbl = mkLabel('subrentals'), localLbl = mkLabel('bookmarks');
  const NOW_MS = Date.now();
  const UA = new Function('document', 'cardFetchedAt', 'cardTtl', 'formatAge',
    extractFn('js/rq_dashboard.js', 'updateCardAges') + '; return updateCardAges;')(
    { querySelectorAll: () => [ordersLbl, staleLbl, localLbl] },
    (id) => ({ myorders: NOW_MS - 2 * 60000, subrentals: NOW_MS - 30 * 60000 })[id] ?? null,
    (id) => ({ myorders: 15 * 60000, subrentals: 10 * 60000 })[id] ?? null,
    R.formatAge);
  UA();
  check('a network card shows its age', ordersLbl.textContent, '2m ago');
  check('a fresh card is shown in grey', ordersLbl.style.color, '#4a4a4a');
  check('a card past its TTL turns amber', staleLbl.style.color, '#a0782a');
  check('a local-only card shows no age', localLbl.style.display, 'none');
  check('the tooltip gives the exact time', /^Updated /.test(ordersLbl.title), true);

  // Structural: each network loader redraws only on change, and only background
  // mode may skip - an explicit refresh (true) must always redraw.
  const dashSrc9 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('agent cards skip the redraw when unchanged',
        /forceRefresh !== true && cached && sameData\(items, cached\.items\)/.test(dashSrc9), true);
  check('sub rentals skip the redraw when unchanged',
        /forceRefresh !== true && cached && sameData\(groups, cached\.groups\)/.test(dashSrc9), true);
  check('preps skip the redraw when unchanged',
        /forceRefresh !== true && cachedPreps &&\s*\n?\s*sameData\(/.test(dashSrc9), true);
  check('preps detects its own rendered state', /body\.dataset\.rqRendered = '1'/.test(dashSrc9), true);
  check('all three loaders actually gate their redraw on it',
        (dashSrc9.match(/if \(!unchanged\) render(BuiltinRows|SubRentals|Preps)\(/g) || []).length, 3);
  // Anchored to the call sites: a bare /startAutoRefresh\(\);/ also matches a
  // commented-out call, which is exactly the regression this should catch.
  check('timers start when the panel opens',
        /applyDashboardLayout\(\); \/\/ restore[^\n]*\r?\n[ \t]*startAutoRefresh\(\);/.test(dashSrc9), true);
  check('timers stop when the panel closes',
        /translateX\(100%\)';\r?\n[ \t]*stopAutoRefresh\(\);/.test(dashSrc9), true);


  // -- Preps: jobs spanning several floor-plan cells ---------------------------
  // The sheet writes a job across bays however its author likes; each form must
  // land in every cell it names, and only genuinely unknown locations go to Other.
  console.log('prep locations:');
  const PL = new Function(
    extractFn('js/rq_dashboard.js', 'normalizeLocation') +
    extractFn('js/rq_dashboard.js', 'prepLocationCells') +
    extractFn('js/rq_dashboard.js', 'prepCellAtStart') +
    '; return prepLocationCells;')();
  const KNOWN = new Set(['Rm 2', 'Rm 1', 'C', 'F', 'B', 'E', 'A', 'D']);
  const loc = (s) => PL(s, KNOWN);

  check('a single cell', loc('D'), ['D']);
  check('lowercase is fine', loc('d'), ['D']);
  check('a room by name', loc('Rm 1'), ['Rm 1']);
  check('D&E', loc('D&E'), ['D', 'E']);
  check('D & E', loc('D & E'), ['D', 'E']);
  check('D/E', loc('D/E'), ['D', 'E']);
  check('D + E', loc('D + E'), ['D', 'E']);
  check('D, E', loc('D, E'), ['D', 'E']);
  check('D and E', loc('D and E'), ['D', 'E']);
  check('D-E', loc('D-E'), ['D', 'E']);
  check('run-together DE', loc('DE'), ['D', 'E']);
  check('order is kept as written', loc('E&D'), ['E', 'D']);
  check('three bays', loc('A/B/C'), ['A', 'B', 'C']);
  check('both rooms', loc('Rm 1 & Rm 2'), ['Rm 1', 'Rm 2']);
  check('room spellings mix', loc('room1/rm2'), ['Rm 1', 'Rm 2']);
  check('a room and a bay', loc('Rm 1 & A'), ['Rm 1', 'A']);
  check('repeats collapse', loc('D&D'), ['D']);
  check('a partly-known location keeps what it can', loc('D & Z'), ['D']);
  // Every spelling found across the sheet's daily tabs, Jan-Nov 2026.
  const SEEN = {
    'D': ['D'], 'Rm 2': ['Rm 2'], 'A': ['A'], 'Rm 1': ['Rm 1'], 'F': ['F'], 'C': ['C'],
    'E': ['E'], 'B': ['B'], 'RM 2': ['Rm 2'], 'Rm 1 + A': ['Rm 1', 'A'], 'A, B': ['A', 'B'],
    'Rm1': ['Rm 1'], 'A, B, C': ['A', 'B', 'C'], 'Rm2': ['Rm 2'], 'A-C': ['A', 'B', 'C'],
    'Rm 2 + C': ['Rm 2', 'C'], 'E, F': ['E', 'F'], 'D-F': ['D', 'E', 'F'], 'A,B': ['A', 'B'],
    'D,E,F': ['D', 'E', 'F'], 'RM 1': ['Rm 1'], 'Rm 1 Front': ['Rm 1'], 'Rm 1 Back': ['Rm 1'],
    'D, E': ['D', 'E'], 'A+B': ['A', 'B'], 'C+B': ['C', 'B'], 'D + E': ['D', 'E'],
    'B + C ': ['B', 'C'], 'A & B': ['A', 'B'], 'D, E, F': ['D', 'E', 'F'],
    'D - Right': ['D'], 'D - Left': ['D'], 'E/F': ['E', 'F'], 'E & F': ['E', 'F'],
    'Rm 2 ': ['Rm 2'], 'B, C': ['B', 'C'], 'D&E': ['D', 'E'],
  };
  const misread = Object.entries(SEEN).filter(([w, want]) => JSON.stringify(loc(w)) !== JSON.stringify(want));
  check('every spelling used on the real sheet lands where it should', misread.map(([w]) => w), []);
  check('a hyphen between bays is a range', loc('A-C'), ['A', 'B', 'C']);
  check('a spaced range works too', loc('D - F'), ['D', 'E', 'F']);
  check('a reversed range still covers the bays', loc('C-A'), ['C', 'B', 'A']);
  check('a hyphen before a note is not a range', loc('D - Right'), ['D']);
  check('a lone note word is not a cell', loc('Right'), []);
  check('unknown goes to Other', loc('Z'), []);
  check('blank goes to Other', loc(''), []);
  check('missing goes to Other', loc(undefined), []);
  check('a word is not read as bays unless every letter is one', loc('DOCK'), []);
  check('a bare "and" is nothing', loc('and'), []);

  const dashSrc10 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('both cell kinds place through the multi-cell path',
        (dashSrc10.match(/cell\.appendChild\(placeItem\(prepRow\)\)/g) || []).length, 2);
  check('Other uses the same parse, so nothing is placed twice or lost',
        /const unplaced = rows\.filter\(row => !\(cellsFor\.get\(row\)/.test(dashSrc10), true);


  // -- "What changed" markers --------------------------------------------------
  console.log('change markers:');
  const dashSrc11 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  const constBlock = dashSrc11.slice(dashSrc11.indexOf('  const CHANGE_GROUPS = ['),
                                     dashSrc11.indexOf('  let seenCache = null;'));
  const CH = new Function(constBlock +
    extractFn('js/rq_dashboard.js', 'normChangeValue') +
    extractFn('js/rq_dashboard.js', 'changeSnapshot') +
    extractFn('js/rq_dashboard.js', 'diffSnapshots') +
    extractFn('js/rq_dashboard.js', 'summarizeChanges') +
    extractFn('js/rq_dashboard.js', 'describeChanges') +
    '; return { normChangeValue, changeSnapshot, diffSnapshots, summarizeChanges, describeChanges };')();

  const snap = CH.changeSnapshot(
    { Status: 'CONFIRMED', Description: ' BURGER KING ', GrandTotal: 1320, Unrelated: 'x' },
    { EstimatedStartDate: '2026-09-04T00:00:00', EstimatedStopDate: '2026-09-18' });
  check('snapshot keeps only tracked fields',
        Object.keys(snap).sort(), ['Description', 'EstimatedStartDate', 'EstimatedStopDate', 'GrandTotal', 'Status']);
  check('dates compare by day', snap.EstimatedStartDate, '2026-09-04');
  check('money compares to the cent', snap.GrandTotal, '1320.00');
  check('text is trimmed', snap.Description, 'BURGER KING');
  check('detail fills in what the list row lacks',
        CH.changeSnapshot({ Status: 'A' }, { PickDate: '2026-09-04' }).PickDate, '2026-09-04');

  const base = { Status: 'QUOTE', EstimatedStopDate: '2026-09-18', Description: 'X', DateStamp: 't1' };
  check('nothing changed -> no marker', CH.diffSnapshots(base, { ...base }), []);
  const moved = CH.diffSnapshots(base, { ...base, EstimatedStopDate: '2026-09-20' });
  check('a moved date is reported', moved.map(c => [c.group, c.from, c.to]), [['dates', '2026-09-18', '2026-09-20']]);
  check('a status change is reported',
        CH.diffSnapshots(base, { ...base, Status: 'CONFIRMED' }).map(c => c.group), ['status']);
  check('a field only one side has is not a change',
        CH.diffSnapshots({ Status: 'A' }, { Status: 'A', PickDate: '2026-09-04' }), []);
  check('an edit stamp alone reads as "edited"',
        CH.diffSnapshots(base, { ...base, DateStamp: 't2' }).map(c => c.group), ['edited']);
  check('a real change outranks the bare edit stamp',
        CH.diffSnapshots(base, { ...base, DateStamp: 't2', Status: 'X' }).map(c => c.group), ['status']);

  check('status names the new status', CH.summarizeChanges([{ group: 'status', to: 'CONFIRMED' }]), '→ CONFIRMED');
  check('dates read as moved', CH.summarizeChanges([{ group: 'dates' }, { group: 'dates' }]), 'dates moved');
  check('several changes are listed once each',
        CH.summarizeChanges([{ group: 'dates' }, { group: 'status', to: 'CLOSED' }, { group: 'dates' }]),
        'dates moved, → CLOSED');
  check('the tooltip shows old and new',
        CH.describeChanges([{ group: 'dates', field: 'EstimatedStopDate', from: '2026-09-18', to: '2026-09-20' }]),
        'EstimatedStopDate: 2026-09-18 → 2026-09-20');

  // The whole lifecycle, run for real against a fake row and storage.
  const seenStore = storageProxy();
  const detail = new Map();
  const mkFakeRow = () => {
    const r = { children: [{}, {}], isConnected: true, captured: [],
      insertBefore(n) { r.children.splice(2, 0, n); n.remove = () => { const i = r.children.indexOf(n); if (i >= 0) r.children.splice(i, 1); }; },
      addEventListener(t, fn, cap) { if (t === 'click' && cap) r.captured.push(fn); },
      click() { r.captured.forEach(fn => fn()); } };
    return r;
  };
  const fakeElSimple = (tag, css, text) => ({ tag, textContent: text ?? '', title: '', className: '' });
  const mkAttach = () => new Function('localStorage', 'el', 'detailCache', 'fetchRecordDetail',
    "const SEEN_KEY='rq-dashboard-seen-v1';const SEEN_PRUNE_MS=1e12;const SEEN_TOUCH_MS=864e5;" +
    constBlock + 'let seenCache = null;' +
    ['loadSeen', 'saveSeen', 'normChangeValue', 'changeSnapshot', 'diffSnapshots', 'summarizeChanges',
     'describeChanges', 'attachChangeMarker'].map(n => extractFn('js/rq_dashboard.js', n)).join('') +
    '; return attachChangeMarker;')(seenStore, fakeElSimple, detail, () => new Promise(() => {}));
  const badgeOf = (r) => r.children.find(c => c.className === 'rq-change-badge');

  let rowA = mkFakeRow();
  mkAttach()(rowA, 'Order', 'LA1', { Status: 'QUOTE', Description: 'JOB' });
  check('first sighting shows no marker', badgeOf(rowA), undefined);
  check('but records a baseline', !!JSON.parse(seenStore.getItem('rq-dashboard-seen-v1'))['Order:LA1'], true);

  rowA = mkFakeRow();
  mkAttach()(rowA, 'Order', 'LA1', { Status: 'CONFIRMED', Description: 'JOB' });
  check('a later change shows a marker', badgeOf(rowA)?.textContent, '● → CONFIRMED');

  rowA.click();
  check('opening the record clears the marker', badgeOf(rowA), undefined);
  rowA = mkFakeRow();
  mkAttach()(rowA, 'Order', 'LA1', { Status: 'CONFIRMED', Description: 'JOB' });
  check('and it stays cleared on the next render', badgeOf(rowA), undefined);

  detail.set('Order:LA1', { data: { record: { EstimatedStopDate: '2026-09-18' } }, fetchedAt: 1 });
  rowA = mkFakeRow();
  mkAttach()(rowA, 'Order', 'LA1', { Status: 'CONFIRMED', Description: 'JOB' });
  check('a newly visible field joins the baseline unflagged', badgeOf(rowA), undefined);
  detail.set('Order:LA1', { data: { record: { EstimatedStopDate: '2026-09-25' } }, fetchedAt: 2 });
  rowA = mkFakeRow();
  mkAttach()(rowA, 'Order', 'LA1', { Status: 'CONFIRMED', Description: 'JOB' });
  check('and a later change to it is flagged', badgeOf(rowA)?.textContent, '● dates moved');

  check('markers are attached to agent rows',
        /attachChangeMarker\(row, module, recordNumber, _raw\);/.test(dashSrc11), true);
  check('a changed list row drops its stale detail',
        /prev !== JSON\.stringify\(i\)\) detailCache\.delete/.test(dashSrc11), true);

  // -- Today card and the shared fetchers -----------------------------------------
  console.log('today card:');
  const sent = [];
  const FW = new Function('window', 'fetch', 'RW_URL', 'rwHeaders', 'SUBRENTAL_SKIP_STATUS',
    extractFn('js/rq_dashboard.js', 'fetchOrdersWhere') + '; return fetchOrdersWhere;')(
    { OrderController: { apiurl: 'api/v1/order' } },
    (url) => { sent.push(decodeURIComponent(url.split('filter=')[1])); return Promise.resolve({ ok: true,
      json: () => Promise.resolve({ Items: [{ OrderNumber: 'A', Status: 'CONFIRMED' }, { OrderNumber: 'B', Status: 'CANCELLED' }] }) }); },
    '', () => ({}), new Set(['CANCELLED', 'CLOSED', 'VOID']));
  const fwOut = await FW([{ Field: 'EstimatedStartDate', Op: '=', Value: '2026-11-18' }]);
  check('one condition is sent as a plain object', sent[0].startsWith('{'), true);
  await FW([{ Field: 'PickDate', Op: '>=', Value: 'a' }, { Field: 'PickDate', Op: '<=', Value: 'b' }]);
  check('several conditions are sent as an array', sent[1].startsWith('['), true);
  check('cancelled and closed orders are dropped', fwOut.map(o => o.OrderNumber), ['A']);

  const asked = [];
  const FU = new Function('fetchOrdersWhere', 'fetchOrderSubItems', 'mapWithLimit', 'subItemNeedsSourcing',
    'SUBRENTAL_CONCURRENCY', 'ymdLocal', 'isPersonalGear',
    extractFn('js/rq_dashboard.js', 'fetchUnsourcedSubRentals') + '; return fetchUnsourcedSubRentals;')(
    async (f) => { asked.push(f); return [{ OrderId: 1 }, { OrderId: 2 }, { OrderId: 3 }]; },
    async (id) => id === 1 ? [{ ICode: 'LENS', Vendor: '', PurchaseOrderNumber: '' }]
               : id === 3 ? [{ ICode: 'PGMONITOR', Vendor: '', PurchaseOrderNumber: '' }]
               : [{ ICode: 'CAM', Vendor: 'V', PurchaseOrderNumber: 'P' }],
    async (items, n, fn) => Promise.all(items.map(fn)),
    (r) => !r.Vendor || !r.PurchaseOrderNumber, 5, (d) => d.toLocaleDateString('en-CA'),
    (l) => /pg/i.test(String(l?.ICode || '')));
  const fuOut = await FU(new Date(2026, 10, 18), new Date(2026, 10, 20));
  check('the pick-date window is sent as a range',
        asked[0].map(f => f.Op + f.Value), ['>=2026-11-18', '<=2026-11-20']);
  check('orders with nothing to source are dropped', fuOut.map(g => g.order.OrderId), [1]);
  check('an order whose only unsourced line is personal gear is dropped too',
        fuOut.some(g => g.order.OrderId === 3), false);

  const SL = new Function(extractFn('js/rq_dashboard.js', 'slimOrder') + '; return slimOrder;')();
  check('the cached order shape is small',
        Object.keys(SL({ OrderId: 1, OrderNumber: 'A', Description: 'D', Agent: 'X', CustomerName: 'C', PickDate: 'p', Huge: 'y' })).sort(),
        ['Agent', 'Customer', 'Description', 'OrderId', 'OrderNumber', 'PickDate']);

  check("yesterday's Today cache is never treated as fresh",
        /const sameDay = !!cached && cached\.day === day;/.test(dashSrc11), true);
  check('one failing source does not blank the rest',
        /const settle = \(p\) => p\.then\(v => v, \(\) => undefined\);/.test(dashSrc11), true);
  check('Today is auto-refreshed', /today:\s+\(mode\) => loadToday\(mode\)/.test(dashSrc11), true);
  check('Sub Rentals now uses the shared pipeline',
        /groupSubRentalsByPickDate\(await fetchUnsourcedSubRentals\(from, to\)\)/.test(dashSrc11), true);


  // -- Shortages ----------------------------------------------------------------
  // Readings pinned to the real order these rules were derived from (LA52953):
  // AvailableQuantity is what is left once the order is covered.
  console.log('shortages:');
  const SH = new Function(
    extractFn('js/rq_dashboard.js', 'classifyAvailability') +
    extractFn('js/rq_dashboard.js', 'shortageNote') +
    '; return { classifyAvailability, shortageNote };')();
  const line = (o) => ({ QuantityOrdered: 1, AvailableQuantity: 5, AvailabilityState: 'enough', ConflictDate: '', ...o });

  check('spare left over is fine', SH.classifyAvailability(line({})), null);
  check('covered with nothing spare is fully booked',
        SH.classifyAvailability(line({ QuantityOrdered: 2, AvailableQuantity: 0, AvailabilityState: 'zero' })), 'tight');
  check('the real "0 here, 2 elsewhere, enough" line is fully booked, not short',
        SH.classifyAvailability(line({ QuantityOrdered: 3, AvailableQuantity: 0, AvailabilityState: 'zero',
                                       AvailableQuantityAllWarehouses: 2 })), 'tight');
  check('a negative remainder is short', SH.classifyAvailability(line({ AvailableQuantity: -2, AvailabilityState: 'zero' })), 'short');
  check('a conflict date is short', SH.classifyAvailability(line({ ConflictDate: '2026-11-20' })), 'short');
  check('a state that says negative is short', SH.classifyAvailability(line({ AvailabilityState: 'Negative' })), 'short');
  check('a line ordering nothing is ignored', SH.classifyAvailability(line({ QuantityOrdered: 0, AvailableQuantity: -3 })), null);

  check('a short line says by how much',
        SH.shortageNote({ kind: 'short', AvailableQuantity: -2, AvailableQuantityAllWarehouses: -2 }), '2 short');
  check('and where spares are, if anywhere',
        SH.shortageNote({ kind: 'short', AvailableQuantity: -2, AvailableQuantityAllWarehouses: 1 }),
        '2 short · 3 at other warehouses');
  check('and what is already subbed',
        SH.shortageNote({ kind: 'short', AvailableQuantity: -1, AvailableQuantityAllWarehouses: -1, SubQuantity: 1 }),
        '1 short · 1 subbed');
  check('a fully booked line says so', SH.shortageNote({ kind: 'tight', AvailableQuantity: 0 }), 'fully booked');

  const dashSrc12 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('background refreshes wait out the Shortages TTL',
        /if \(forceRefresh !== true && fresh\) return;/.test(dashSrc12), true);
  check('fully booked lines are filtered at render, so the toggle needs no refetch',
        /e\.items\.filter\(i => i\.kind === 'short' \|\| tight\)/.test(dashSrc12), true);
  check('Shortages is auto-refreshed', /shortages:\s+\(mode\) => loadShortages\(mode\)/.test(dashSrc12), true);


  // -- Personal gear ------------------------------------------------------------
  console.log('personal gear:');
  const PG = new Function(extractFn('js/rq_dashboard.js', 'isPersonalGear') + '; return isPersonalGear;')();
  check('a PG I-Code is personal gear', PG({ ICode: 'PGMONITOR' }), true);
  check('lowercase pg too', PG({ ICode: 'camerapg' }), true);
  check('PG anywhere in the code counts', PG({ ICode: 'ALEXPG35' }), true);
  check('ordinary kit is not', PG({ ICode: 'ALEXA35X' }), false);
  check('a missing I-Code is not', PG({}), false);
  const dashSrc13 = fs.readFileSync('js/rq_dashboard.js', 'utf8');
  check('Sub Rentals and Today drop personal gear',
        /\.filter\(i => subItemNeedsSourcing\(i\) && !isPersonalGear\(i\)\)/.test(dashSrc13), true);
  check('Shortages drops personal gear',
        /if \(isPersonalGear\(l\)\) continue;/.test(dashSrc13), true);


  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();
