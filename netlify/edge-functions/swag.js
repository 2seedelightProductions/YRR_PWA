// Netlify Edge Function (YRR app site): /api/swag
// Swag giveaway: three short entry windows a day at unannounced times.
//   GET  /api/swag   → { open, window, closes }   (the app polls this)
//   POST /api/swag   → enter (JSON: name, email, state, age18, rules, lid, track, artist, playing)
// Windows are computed on the server from the Eastern date and a secret seed
// (SWAG_SEED env var), so they can't be predicted from the app's code. Every
// entry is checked here (window open, US state, 18+, rules accepted, stream
// playing) and logged to the station's Google Sheet with the time, listener ID
// and the song on air, so a drawing can be verified later.

const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjSRhTlDhUPcEvnHFQWntK5jd5pGPiI4WI-ULOelVTt0-PjcpOdaat3FbSux4dCS2Vgg/exec";
const WINDOW_MIN = 15;
// [from, to) hour ranges (Eastern) — one window lands somewhere in each
const SLOTS = [[8, 12], [12, 17], [17, 22]];
const US_STATES = new Set(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ " +
  "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));

function eastern(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}

async function hashInt(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return new DataView(buf).getUint32(0);
}

async function windowsFor(date, seed) {
  const out = [];
  for (let i = 0; i < SLOTS.length; i++) {
    const [a, b] = SLOTS[i];
    const span = (b - a) * 60 - WINDOW_MIN;
    const start = a * 60 + ((await hashInt(`${seed}|${date}|${i}`)) % span);
    out.push({ id: `${date}-${i + 1}`, start, end: start + WINDOW_MIN });
  }
  return out;
}

async function openWindow(seed) {
  const { date, minutes } = eastern();
  const ws = await windowsFor(date, seed);
  return ws.find((w) => minutes >= w.start && minutes < w.end) || null;
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (request, context) => {
  // No secret seed set = giveaway off (the app code is public, so a default seed would be guessable)
  const seed = globalThis.Netlify?.env?.get?.("SWAG_SEED");
  const w = seed ? await openWindow(seed) : null;

  if (request.method === "GET") {
    return json(w ? { open: true, window: w.id, closesInMin: w.end - eastern().minutes } : { open: false });
  }
  if (request.method !== "POST") return json({ ok: false }, 405);

  let b = {};
  try { b = await request.json(); } catch (_) { return json({ ok: false, error: "Bad entry." }, 400); }
  if (!w) return json({ ok: false, error: "Sorry, this entry window just closed. Keep listening for the next one!" });

  const name = String(b.name || "").trim().slice(0, 80);
  const email = String(b.email || "").trim().slice(0, 120);
  const state = String(b.state || "").trim().toUpperCase();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: "Please enter your name and a valid email." });
  if (!US_STATES.has(state)) return json({ ok: false, error: "This giveaway is open to US residents only." });
  if (b.age18 !== true || b.rules !== true) return json({ ok: false, error: "Please confirm you're 18+ and agree to the rules." });
  if (b.playing !== true) return json({ ok: false, error: "Press play first. You have to be listening to enter!" });

  const g = context.geo || {};
  const params = new URLSearchParams({
    type: "swag", window: w.id, name, email, state,
    lid: String(b.lid || "").slice(0, 64),
    track: String(b.track || "").slice(0, 120), artist: String(b.artist || "").slice(0, 120),
    geo: [g.city, g.subdivision?.code, g.country?.code].filter(Boolean).join(", "),
  });
  try {
    const r = await fetch(`${SHEET_ENDPOINT}?${params}`, { redirect: "follow" });
    const t = await r.text();
    if (/duplicate/i.test(t)) return json({ ok: false, error: "You're already entered for this window. Good luck!" });
    if (!/"ok"\s*:\s*true/.test(t)) return json({ ok: false, error: "Couldn't save your entry. Please try again." });
  } catch (_) {
    return json({ ok: false, error: "Couldn't save your entry. Please try again." });
  }
  return json({ ok: true });
};

export const config = { path: "/api/swag" };
