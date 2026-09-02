/* rq_common.js stores functions that are common across all the other modules.
   These functions are defined in the global context of this file, which equates
   to the global context of all files included with Tampermonkey @require tags.
   It is not, however, global to the context of the webpage it is running on, so
   it is not polluting the page's window namespace.
*/
/** Boolean value for any features that should only be run on the test/training domain */
const IS_TEST_SITE = location.pathname == "/training/";
/** The current RentalWorks URL up until (but excluding) the pound sign (#) */
const RW_URL = window.applicationConfig?.apiurl ?? location.origin + location.pathname;

/**
 * Fires a change event on an element so that the website's other scripts
 * know to act on the data as they would have if a user entered it.
 * @param {HTMLElement} elem The Element whose value has changed.
 */
function doChangeEvent(elem) {
    elem.dispatchEvent(new Event('change', { "bubbles": true }));
}

/**
 * Converts a string to Title Case, taking into account common exceptions in capitalization
 * for units, acronyms, etc. Also enforces single spacing.
 * @param {String} inputText The text to convert to Title Case
 * @returns The inputText converted to Title Case, taking into account certain exceptions.
 */
function toTitleCase(inputText) {
    let exceptions = ['m', 'in', 'ft', 'KIT', 'RGB', 'RGBW', 'RGBA', 'UV', 'LED', 'CRI', 'APA', 
    'SCS', 'SDS', 'SHO', 'CCS', 'CS', 'DS', 'OBD', 'DIP', 'BWL', 
    'x', 'mAh', 'W', 'kHz', 'AC', 'DC', 'IP', 'PHX', 'XLR', 'DMX', 'QC', 'NEMA', 'UL'];
    let exlow = exceptions.map(x => x.toLowerCase());
    // Match all words (sequences of letters) and replace with properly cased words
    let result = inputText.replace(/[a-z]+/gi, match => {
        let mlow = match.toLowerCase();
        let i = exlow.indexOf(mlow);
        return i == -1 ? mlow[0].toUpperCase() + mlow.substring(1) : exceptions[i];
    });
    //Remove extra spaces
    result = result.replace(/\s\s+/g, " ");
    return result;
}

/**Performs a case-insensitive string match where the test text may be split and matched against multiple words.
 * Every subset of test must begin a match on a capital letter. A space character implies a word break, indicating
 * that the following character should match an uppercase letter. If phrase has no matches within the first 32 characters,
 * the match fails even if there would have been a match further on. This is a technical constraint that could be 
 * worked around if it mattered enough.
 * 
 * @param {String} phrase The multi-word string to test against
 * @param {String} test The string that might match phrase
 * @returns 0 if match failed, or a 32-bit bitmask with 1's in every position that there was a match.
 *          No info is returned for matches beyond the 32nd character of an especially long phrase.
 */
function multiword_match(phrase, test) {
    //@CORRECTNESS: This needs backtracking, or maybe to prioritize matching the capital letters. But for our use, it might not be a problem.
    //ex. phrase="Total Obsession", test="tobs" should match (Total OBSession), but the naive solution might fail (TOtal oBSession).
    let ti = 0; 
    let pi = 0;
    let match_bitfield = 0; //Track the indices of phrase that matched, so that we can do things like bolden the matched letters for the user to see.
    while (pi < phrase.length && ti < test.length) {
        if (test[ti].toLowerCase() == phrase[pi].toLowerCase()) {
            if (pi < 32) { // Javascript bit shifts are limited to 32-bit integers
                match_bitfield |= 1 << pi;
            }
            ti++;
            pi++;
        }
        else {
            // Spaces in the test text indicate a word break, in which case the next character needs to match a capital letter.
            while (test[ti] == ' ') { ti++; }
            // Find the index of the next capital letter, then try to continue matching from there.
            while (++pi < phrase.length) {
                let letter = phrase[pi];
                if (letter != letter.toLowerCase()) break;
            }
        }
    }
    // We have a full match if we made it through test. If match failed, return 0.
    return (ti == test.length) ? match_bitfield : 0;
}

/**Returns the module tab (not the tabpage) with the given name, or undefined if none exists.
 * If there are multiple tabs with the same name, the leftmost tab is returned.
 */
function find_tab_by_name (tab_name, activate_tab) {
    let found_tab = Array.from(document.querySelectorAll('#moduletabs > .tabs > .tabcontainer > .tab > .caption')).find(tab_caption => tab_caption.innerText === tab_name)?.parentElement;
    if (found_tab && activate_tab) {
        found_tab.click();
    }
    return found_tab;
};

/**Returns the tabpage of a form for a particular ID, if it is open. Will also activate the form if activate_tab == true.
 * @param {*} id_name is the name of the unique ID for this module (ex. 'ItemId' for AssetController, or 'InventoryId' for RentalInventoryController)
 * @param {*} id_value is the unique ID value being searched for
 * @param {*} activate_tab is true if the found tab should be made active
 * @returns the (first from left) FORM tab for id_value
 */
function find_form_tab_by_id (id_name, id_value, activate_tab) {
    // search for already-open tabs of matching InventoryId, and switch to the first one that matches.
    let id_info = { datafield: id_name, value: id_value };
    let form_query = {};
    form_query[id_name] = id_info;
    let found_form = FwModule.getFormByUniqueIds(form_query);

    let found_tabpage = false;
    if (typeof found_form != "undefined" && found_form.length > 0) {
        found_tabpage = found_form.closest("div.tabpage");
        if (activate_tab) {
            jQuery("#" + found_tabpage.attr("data-tabid")).click();
        }
    }
    return found_tabpage;
};

/**
 * Call this on any containing Element to allow descendants of class 'rq-draggable' to be moved 
 * by the mouse when an Element of class 'rq-draghandle' within them is clicked and dragged.
 * @param {Element} container the context in which mouse events are monitored for dragging elements. Defaults to document.body.
 */
let WindowDragger = function (container) {
  if (!container) {
    container = document.body;
  }
  container.addEventListener("mousedown", on_drag_start, false);
  container.addEventListener("mouseup", on_drag_end, false);
  container.addEventListener("mousemove", on_drag, false);

  let drag_item = null;
  let currentX, currentY;
  let initialX, initialY;
  let offsetX = 0, offsetY = 0;

  function on_drag_start(e) {
    initialX = e.clientX - offsetX;
    initialY = e.clientY - offsetY;
    if (e.target.classList.contains('rq-draghandle')) {
      drag_item = e.target.closest('.rq-draggable');
    }
  }
  function on_drag(e) {
    if (drag_item) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      offsetX = currentX;
      offsetY = currentY;
      //https://www.kirupa.com/html5/drag.htm
      drag_item.style.transform = "translate3d(" + currentX + "px, " + currentY + "px, 0)";
    }
  }
  function on_drag_end(e) {
    //TODO: https://stackoverflow.com/questions/442404/retrieve-the-position-x-y-of-an-html-element
    //      If dragged out of bounds, snap to an edge.
    initialX = currentX;
    initialY = currentY;
    drag_item = null;
  }
};

/**
 * Shared watcher for RentalWorks record forms finishing their load (the
 * 'form_load_complete' class being added to a .fwform element). Detecting this
 * requires a subtree-wide class-attribute observer on document.body, which has a
 * per-mutation cost across the whole app — so all features share this single
 * lazily-created observer rather than each creating their own.
 * @param {Function} callback receives the form Element each time a form load completes.
 */
RentalQuirks.onFormLoadComplete = (function () {
    const callbacks = [];
    let started = false;
    return function (callback) {
        callbacks.push(callback);
        if (started) return;
        started = true;
        on_class_added('form_load_complete', document.body, (form) => {
            if (!form.matches('.fwform[data-controller]')) return;
            callbacks.forEach(cb => {
                try { cb(form); }
                catch (e) { console.error('[RQ] onFormLoadComplete callback failed', e); }
            });
        });
    };
})();

/**
 * Fetches one date-tab of the Preps Google Sheet via the gviz API and returns the
 * parsed rows as objects keyed by column label (rows without an 'Order No.' dropped).
 * The dashboard Preps card and both order pollers all read the same sheet on
 * overlapping schedules, so responses are cached briefly and concurrent requests
 * for the same tab share one fetch.
 * @param {String} sheetId the Google Sheet document id
 * @param {String} dateStr the sheet tab name, e.g. "2026-7-2" (no leading zeros)
 * @returns {Promise<Object[]>} resolves to [] on any failure.
 */
RentalQuirks.fetchPrepsSheetRows = (function () {
    const CACHE_TTL = 2 * 60 * 1000;
    const cache = new Map(); // `${sheetId}|${dateStr}` → { promise, fetchedAt }
    return function (sheetId, dateStr) {
        const key = sheetId + '|' + dateStr;
        const hit = cache.get(key);
        if (hit && (Date.now() - hit.fetchedAt) < CACHE_TTL) return hit.promise;
        // Range starts at row 2 (row 1 is the date header, row 2 is column names)
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(dateStr)}&range=B2:L500&headers=1`;
        const promise = fetch(url)
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
                    .filter(r => r['Order No.']);
            })
            .catch(() => []);
        cache.set(key, { promise, fetchedAt: Date.now() });
        return promise;
    };
})();

const LOG = console.log.bind(console);