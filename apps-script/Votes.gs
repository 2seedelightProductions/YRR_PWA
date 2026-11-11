/**
 * YRR Listener Votes — Apps Script web app (bound to the "YRR Listener Votes" sheet)
 * Receives GET votes from the PWA and appends a row to the "Votes" tab.
 *
 * v1.5.3b (11/11/26):
 *  - Category is now looked up HERE from the full NextKast library
 *    (vote-categories.json in the YRR_PWA repo, built from masterLibrary.txt),
 *    so every vote gets a category — even from older app versions.
 *  - backfillCategories(): run ONCE from the editor to fill Category on old rows.
 *
 * DEPLOY: Deploy → Manage deployments → pencil on the EXISTING deployment
 *         → Version: "New version" → Deploy. (Keeps the same /exec URL.)
 * Refreshing the library = re-export vote-categories.json to the repo. No script change.
 */
const SHEET_NAME = 'Votes';
const LIB_URL = 'https://raw.githubusercontent.com/2seedelightProductions/YRR_PWA/main/vote-categories.json';
const FIELDS = [
  ['Timestamp',   null],
  ['Track',       'track'],
  ['Artist',      'artist'],
  ['Category',    'category'],
  ['Vote',        'vote'],
  ['Source',      'source'],
  ['ListenerID',  'lid'],
  ['AppVersion',  'ver'],
];

function doGet(e) {
  const p = (e && e.parameter) || {};
  const vote = String(p.vote || '').toLowerCase();
  if (vote !== 'up' && vote !== 'down') return out_({ ok: false, error: 'bad vote' });

  // Station library wins; fall back to whatever the app sent
  let category = '';
  try { category = lookupCategory_(loadLib_(), p.track, p.artist); } catch (_) {}
  if (!category) category = String(p.category || '');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const headers = ensureHeaders_(sh);
    const row = new Array(headers.length).fill('');
    FIELDS.forEach(([h, key]) => {
      const i = headers.indexOf(h);
      if (i === -1) return;
      row[i] = key === null       ? new Date().toISOString()
             : key === 'vote'     ? vote
             : key === 'category' ? category
             : String(p[key] || '').slice(0, 200);
    });
    sh.appendRow(row);
    return out_({ ok: true, category });
  } finally {
    lock.releaseLock();
  }
}

/** Run once from the editor (select it in the toolbar → Run). Fills blank Category cells. */
function backfillCategories() {
  const lib = loadLib_();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const headers = ensureHeaders_(sh);
  const iT = headers.indexOf('Track'), iA = headers.indexOf('Artist'), iC = headers.indexOf('Category');
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const data = sh.getRange(2, 1, n, headers.length).getValues();
  let filled = 0, missed = [];
  const cats = data.map(r => {
    if (r[iC]) return [r[iC]];
    const c = lookupCategory_(lib, r[iT], r[iA]);
    if (c) filled++; else missed.push(r[iA] + ' - ' + r[iT]);
    return [c];
  });
  sh.getRange(2, iC + 1, n, 1).setValues(cats);
  Logger.log('Filled ' + filled + ' rows. Not found (' + missed.length + '): ' + missed.join(' | '));
}

// ── helpers ───────────────────────────────────────────────────────
function loadLib_() {
  const res = UrlFetchApp.fetch(LIB_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('library fetch ' + res.getResponseCode());
  return JSON.parse(res.getContentText());
}

function n_(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }
function strip_(s) { return String(s || '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ''); }

function lookupCategory_(lib, title, artist) {
  const a = n_(artist);
  for (const t of [title, strip_(title)]) { const c = lib.k[a + '|' + n_(t)]; if (c) return c; }
  for (const t of [title, strip_(title)]) { const c = lib.t[n_(t)]; if (c) return c; }  // title unique to one artist
  return '';
}

function ensureHeaders_(sh) {
  const headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
                    .map(h => String(h).trim());
  FIELDS.forEach(([h]) => {
    if (headers.indexOf(h) === -1) {
      const col = headers.filter(String).length + 1;
      sh.getRange(1, col).setValue(h);
      headers[col - 1] = h;
    }
  });
  return headers;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}
