// ==UserScript==
// @name         RentalQuirks (LOCAL DEV)
// @namespace    https://www.github.com/acropup/RentalQuirks/
// @version      2.26-local
// @description  Local development version of RentalQuirks. Loads scripts from disk instead of GitHub.
// @homepageURL  https://www.github.com/acropup/RentalQuirks
// @author       Shane Burgess
// @match        *://*.rentalworksweb.com/*
// @match        *://*.rentalworks.cloud/*
// @grant        none
// @noframes
// @require      file:///C:/Users/aagostino/RentalQuirks/js/script_execution_mgr.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_p_login.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_common.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_sheets.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_all_pages.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_server_api.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_quiknav.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_quiknav_custom.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_p_rentalinventory.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_reports.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/lib/ZebraBrowserPrint/BrowserPrint-3.0.216.min.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/lib/ZebraBrowserPrint/BrowserPrint-Zebra-1.0.216.min.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_barcode.js
// @require      file:///C:/Users/aagostino/RentalQuirks/js/rq_dashboard.js
// ==/UserScript==

// Local dev version. To use:
//   1. In Chrome: chrome://extensions → Tampermonkey → Details → enable "Allow access to file URLs"
//   2. Install this script in Tampermonkey (drag this file onto the TM dashboard, or use "Install from file")
//   3. Disable the upstream RentalQuirks script so both don't run at once.
//   4. Edit files in js/ directly — Tampermonkey re-reads @require file:/// on every page load.
//      (No manual "update" step needed, unlike GitHub raw URL caching.)

(function() {
  'use strict';
  console.log('--- RentalWorks - Quirks mode activated (LOCAL DEV) ---');
})();
