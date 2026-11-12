/**
 * YRR Listener Votes — Apps Script web app (bound to the "YRR Listener Votes" sheet)
 * Receives GET votes from the PWA and appends a row to the "Votes" tab.
 *
 * v1.5.3c (11/11/26): category comes straight from NextKast's masterLibrary.txt
 *   via its Dropbox link — the library stays current on its own as tracks are added.
 *   refreshLibrary() rebuilds a hidden "LibIndex" tab and fills any blank Category
 *   cells. Run it once by hand, then setupHourlyRefresh() once to automate it.
 *
 * DEPLOY: Deploy → Manage deployments → pencil on the EXISTING deployment
 *         → Version: "New version" → Deploy. (Keeps the same /exec URL.)
 */
const SHEET_NAME = 'Votes';
const INDEX_SHEET = 'LibIndex';
// Dropbox share link to D:\Dropbox\nextKast\masterLibrary.txt — must end in dl=1
const LIBRARY_URL = 'PASTE_DROPBOX_LINK_HERE';

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

// Non-music categories never used as a vote category
const NONMUSIC = /sweep|brb|legalid|beds?$|promo|stager|element|finalmessage|delete|mixtrack|^mix\d|unwarped|liverecording|^vt|ycl_net|listenerline|adbreak|norms|temp|podcast|4550_samantha|4550_beds|copy of|bzw/i;
// When a track lives in several categories, the earliest in this list wins
const PRIORITY = ['YachtRock','Yachtiest','DeepDive','SmoothFM','YarAndB','AM Gold','Retro','Summer','SummerJams',
  'Shallows','FFF','Christmas','Halloween','Thanksgiving','Irish','BirthdayBeat','Specialty','YCSN','4550_T40s','Y4550',
  'Commercials','TV'];
const HOLDING = ['repick','1repick','undecided','fff_played'];

// ── Vote endpoint ─────────────────────────────────────────────────
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.type === 'swag') return swagEntry_(p);
  const vote = String(p.vote || '').toLowerCase();
  if (vote !== 'up' && vote !== 'down') return out_({ ok: false, error: 'bad vote' });

  let category = '';
  try { category = lookupCategory_(getIndex_(), p.track, p.artist); } catch (_) {}
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

// ── Swag giveaway entries (sent by the app site's /api/swag check) ──
// One entry per email or listener ID per window. Columns are created on first use.
const SWAG_SHEET = 'Swag';
const SWAG_COLS = ['Time (UTC)', 'Window', 'Name', 'Email', 'State', 'Listener ID', 'Song on air', 'Artist', 'Approx. location'];
function swagEntry_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SWAG_SHEET) || ss.insertSheet(SWAG_SHEET);
    if (sh.getLastRow() === 0) sh.appendRow(SWAG_COLS);
    const win = String(p.window || ''), email = String(p.email || '').toLowerCase(), lid = String(p.lid || '');
    if (sh.getLastRow() > 1) {
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
      if (rows.some(r => r[1] === win && (String(r[3]).toLowerCase() === email || (lid && r[5] === lid))))
        return out_({ ok: false, error: 'duplicate' });
    }
    sh.appendRow([new Date().toISOString(), win, p.name, email, p.state, lid, p.track, p.artist, p.geo]
      .map(v => String(v || '').slice(0, 200)));
    return out_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// ── Library refresh (run by hand once, then hourly via trigger) ───
function refreshLibrary() {
  if (LIBRARY_URL.indexOf('dropbox') === -1) throw new Error('Set LIBRARY_URL to the Dropbox link first');
  const url = LIBRARY_URL.replace(/([?&])dl=0/, '$1dl=1') + (/[?&]dl=1/.test(LIBRARY_URL) ? '' : (LIBRARY_URL.indexOf('?') > -1 ? '&dl=1' : '?dl=1'));
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('Dropbox fetch ' + res.getResponseCode());

  const index = buildIndex_(res.getBlob().getDataAsString('ISO-8859-1'));
  const keys = Object.keys(index.k);
  if (keys.length < 1000) throw new Error('Library looks wrong — only ' + keys.length + ' tracks parsed; index NOT replaced');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(INDEX_SHEET) || ss.insertSheet(INDEX_SHEET);
  sh.clearContents();
  const rows = [['key', 'category']]
    .concat(keys.map(k => [k, index.k[k]]))
    .concat(Object.keys(index.t).map(t => ['t:' + t, index.t[t]]));
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  if (!sh.isSheetHidden()) sh.hideSheet();
  CacheService.getScriptCache().remove('libIndexStamp');
  PropertiesService.getScriptProperties().setProperty('libIndexStamp', String(Date.now()));

  const filled = backfill_(index);
  Logger.log('Library refreshed: ' + keys.length + ' tracks. Filled ' + filled + ' blank vote categories.');
}

/** Run once: refreshLibrary() every hour, automatically. */
function setupHourlyRefresh() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'refreshLibrary')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshLibrary').timeBased().everyHours(1).create();
  Logger.log('Hourly library refresh is on.');
}

// masterLibrary.txt: 4-byte LE record count, then records = 2-byte LE length + '^^' fields
// (field 0 = "Artist - Title", field 1 = category). Read as ISO-8859-1 so 1 char = 1 byte.
function buildIndex_(s) {
  const cats = {}, tcats = {};
  let p = 4;
  while (p + 2 <= s.length) {
    const len = s.charCodeAt(p) | (s.charCodeAt(p + 1) << 8);
    const rec = s.substr(p + 2, len);
    p += 2 + len;
    const f = rec.split('^^');
    if (f.length < 3 || f[0].indexOf(' - ') === -1) continue;
    const cat = f[1].trim();
    if (!cat || NONMUSIC.test(cat)) continue;
    const cut = f[0].indexOf(' - ');
    const a = n_(f[0].slice(0, cut)), title = f[0].slice(cut + 3);
    [title, strip_(title)].forEach(t => {
      const key = a + '|' + n_(t);
      (cats[key] = cats[key] || {})[cat] = 1;
      const tk = n_(t);
      (tcats[tk] = tcats[tk] || {});
      tcats[tk][a + '\u0001' + cat] = 1;
    });
  }
  const k = {}, t = {};
  Object.keys(cats).forEach(key => k[key] = best_(Object.keys(cats[key])));
  Object.keys(tcats).forEach(tk => {
    const pairs = Object.keys(tcats[tk]).map(x => x.split('\u0001'));
    const artists = {}; pairs.forEach(x => artists[x[0]] = 1);
    if (Object.keys(artists).length === 1) t[tk] = best_(pairs.map(x => x[1]));
  });
  return { k, t };
}

function best_(list) {
  const rank = c => { const i = PRIORITY.indexOf(c); return i > -1 ? i : (HOLDING.indexOf(c.toLowerCase()) > -1 ? 90 : 50); };
  return list.sort((x, y) => rank(x) - rank(y))[0];
}

function getIndex_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INDEX_SHEET);
  if (!sh) return { k: {}, t: {} };
  const k = {}, t = {};
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues().forEach(r => {
    if (!r[0]) return;
    const key = String(r[0]);
    if (key.indexOf('t:') === 0) t[key.slice(2)] = r[1]; else k[key] = r[1];
  });
  return { k, t };
}

function backfill_(index) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const headers = ensureHeaders_(sh);
  const iT = headers.indexOf('Track'), iA = headers.indexOf('Artist'), iC = headers.indexOf('Category');
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const data = sh.getRange(2, 1, n, headers.length).getValues();
  let filled = 0;
  const col = data.map(r => {
    if (r[iC]) return [r[iC]];
    const c = lookupCategory_(index, r[iT], r[iA]);
    if (c) filled++;
    return [c];
  });
  if (filled) sh.getRange(2, iC + 1, n, 1).setValues(col);
  return filled;
}

// ── helpers ───────────────────────────────────────────────────────
// Normalize: lowercase, & → and, drop everything but a–z/0–9 (also drops accented
// letters, so "Blue Öyster" and the mis-encoded "Blue yster" match the same key)
function n_(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }
function strip_(s) { return String(s || '').replace(/\s*[\(\[][^\)\]]*[\)\]]/g, ''); }

function lookupCategory_(idx, title, artist) {
  const a = n_(artist);
  for (const t of [title, strip_(title)]) { const c = idx.k[a + '|' + n_(t)]; if (c) return c; }
  for (const t of [title, strip_(title)]) { const c = idx.t[n_(t)]; if (c) return c; }
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
