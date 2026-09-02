// rq_sheets.js
// Shared reader for the Google Sheets prep schedule behind the dashboard's Preps
// card and both background order pollers, which previously carried three copies of
// this fetch-and-parse.
//
// Sheet layout: one tab per day, named "YYYY-M-D" with no leading zeros
// (e.g. "2026-4-10"). Row 1 is a date header and row 2 holds the column names, so
// every read starts at B2 with headers=1. Columns consumed by callers today:
//   Order No.  Prep Tech  Prep Location  Job Name  Production Company
//
// Reads go through the gviz endpoint, which needs no API key but wraps its JSON in
// a JS callback that has to be unwrapped. A failure on any single date yields []
// rather than rejecting, so one missing or renamed tab can't sink the whole window.
// Callers must therefore treat a short result as "possibly incomplete", never as
// "this is every order that exists" — see makeStatePruner() in rq_common.js.

(function (RQ) {
  'use strict';

  const PREPS_SHEET_KEY  = 'rq-dashboard-preps-sheet-url';
  const GVIZ_RESPONSE_RE = /google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/;

  RQ.sheets = {};

  RQ.sheets.getSheetIdFromUrl = function (url) {
    const m = (url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  };

  /** The sheet id configured in the dashboard's Preps card, or null if unset/malformed. */
  RQ.sheets.getSheetId = function () {
    return RQ.sheets.getSheetIdFromUrl(localStorage.getItem(PREPS_SHEET_KEY) || '');
  };

  /** Formats a Date as a sheet tab name: "2026-4-10", no leading zeros. */
  RQ.sheets.fmtDate = function (d) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };

  /**
   * The tab names spanning [today - daysBack, today + daysForward], inclusive.
   * @returns {{date: Date, str: String}[]} in chronological order.
   */
  RQ.sheets.windowDates = function (daysBack, daysForward) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: daysBack + daysForward + 1 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + (i - daysBack));
      return { date: d, str: RQ.sheets.fmtDate(d) };
    });
  };

  /**
   * One day's rows as objects keyed by column name. Rows with no order number are
   * dropped. Resolves to [] on any failure rather than rejecting.
   */
  RQ.sheets.fetchPrepRows = function (sheetId, dateStr) {
    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(dateStr)}&range=B2:L500&headers=1`;
    return fetch(url)
      .then(r => r.text())
      .then(text => {
        const m = text.match(GVIZ_RESPONSE_RE);
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
  };

  /**
   * Raw rows grouped per day, for callers that render the schedule by date.
   * Days with no rows are omitted.
   * @param {{date: Date, str: String}[]} dates typically from windowDates().
   */
  RQ.sheets.fetchPrepGroups = function (sheetId, dates) {
    return Promise.all(dates.map(({ date, str }) =>
      RQ.sheets.fetchPrepRows(sheetId, str).then(rows => ({ date, str, rows }))
    )).then(groups => groups.filter(g => g.rows.length > 0));
  };

  /**
   * The pollers' view: one entry per order across the whole window rather than per
   * day, with the earliest prep date winning when an order is scheduled twice.
   * Resolves to [] when no sheet is configured.
   * @returns {{order, tech, production, company, prepDate}[]}
   */
  RQ.sheets.fetchPrepJobs = function (daysBack, daysForward) {
    const sheetId = RQ.sheets.getSheetId();
    if (!sheetId) return Promise.resolve([]);

    const dates = RQ.sheets.windowDates(daysBack, daysForward);
    return Promise.all(dates.map(({ str }) =>
      RQ.sheets.fetchPrepRows(sheetId, str).then(rows => rows.map(r => ({
        order:      (r['Order No.']         || '').trim(),
        tech:       (r['Prep Tech']         || '').trim(),
        production: (r['Job Name']          || '').trim(),
        company:    (r['Production Company']|| '').trim(),
        prepDate:   str,
      })))
    )).then(results => {
      const seen = new Set();
      return results.flat().filter(j => {
        if (!j.order || seen.has(j.order)) return false;
        seen.add(j.order);
        return true;
      });
    });
  };

})(window.RentalQuirks ||= {});
