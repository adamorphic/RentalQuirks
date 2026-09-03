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
        ['fetchPrepGroups', 'fetchPrepRows', 'fmtDate', 'getSheetIdFromUrl', 'windowDates']);
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
  check('sub-rental blocks use the shared expander',
        /buildSubRentalOrderBlock[\s\S]{0,2000}?renderRowItems\(holder, items, buildSubRentalItemLine\)/.test(dashSrc2), true);
  check('sub-rental quantities survive the shared line builder',
        /ITEM_QTY_FIELDS\s*=\s*\[[^\]]*'SubQuantity'/.test(dashSrc2), true);


  console.log(failures ? `\n${failures} FAILURE(S)` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();
