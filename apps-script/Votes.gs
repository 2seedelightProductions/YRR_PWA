/**
 * YRR Listener Votes — Apps Script web app (bound to the "YRR Listener Votes" sheet)
 * Receives GET votes from the PWA and appends a row to the "Votes" tab.
 *
 * v1.5.3 (11/11/26): adds Category, ListenerID, AppVersion.
 * Writes by header name, and adds any missing header columns automatically,
 * so column order in the sheet doesn't matter.
 *
 * DEPLOY: Deploy → Manage deployments → pencil (edit) on the EXISTING deployment
 *         → Version: "New version" → Deploy.  (Keeps the same /exec URL the app uses.
 *         Do NOT create a new deployment — that makes a new URL.)
 */
const SHEET_NAME = 'Votes';
const FIELDS = [
  // [header,      param]
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

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    let headers = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0]
                    .map(h => String(h).trim());

    // Add any missing headers to the right
    FIELDS.forEach(([h]) => {
      if (headers.indexOf(h) === -1) {
        const col = headers.filter(String).length + 1;
        sh.getRange(1, col).setValue(h);
        headers[col - 1] = h;
      }
    });

    const row = new Array(headers.length).fill('');
    FIELDS.forEach(([h, key]) => {
      const i = headers.indexOf(h);
      if (i === -1) return;
      row[i] = key === null ? new Date().toISOString()
             : key === 'vote' ? vote
             : String(p[key] || '').slice(0, 200);
    });
    sh.appendRow(row);
    return out_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
                       .setMimeType(ContentService.MimeType.JSON);
}
