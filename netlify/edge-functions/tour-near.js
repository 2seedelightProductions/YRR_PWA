// Netlify Edge Function (YRR app site): /api/tour-near
// The tour data is built weekly in the private prep hub; this function reads it
// server-side, so listeners only ever talk to the app's own site.
// Answers "is this artist touring, and is there a show near this listener?"
// for the YRR app crawl. Uses Netlify's approximate visitor location
// (context.geo); nothing about the listener is stored or logged.
//
//   GET /api/tour-near?artist=Christopher%20Cross   → one artist (crawl)
//   GET /api/tour-near?list=1                        → all touring artists, nearest first
//   Optional &lat=..&lon=..&country=US to override the location (listener's device location)
//   Optional &zip=48226 (US) or &zip=M5V 3L9 (Canada) to look up a home ZIP/postal code
//   Optional &radius=50|100|200 — miles that count as "near you" (default 150)

const NEAR_MILES = 150;
const ZIP_API = "https://api.zippopotam.us";
const zipCache = new Map();

// ZIP / postal code → { lat, lon, country, city }. US = 5 digits, Canada = first 3 chars (FSA).
async function lookupZip(raw) {
  const z = String(raw || "").toUpperCase().replace(/\s+/g, "");
  let path;
  if (/^\d{5}$/.test(z.slice(0, 5)) && /^\d{5}(-?\d{4})?$/.test(z)) path = "us/" + z.slice(0, 5);
  else if (/^[A-Z]\d[A-Z](\d[A-Z]\d)?$/.test(z)) path = "ca/" + z.slice(0, 3);
  else return null;
  if (zipCache.has(path)) return zipCache.get(path);
  const r = await fetch(`${ZIP_API}/${path}`);
  if (!r.ok) { zipCache.set(path, null); return null; }
  const d = await r.json();
  const p = (d.places || [])[0];
  if (!p) return null;
  const out = { lat: +p.latitude, lon: +p.longitude, country: path.slice(0, 2).toUpperCase(),
    city: `${p["place name"]}, ${p["state abbreviation"] || p.state || ""}`.replace(/,\s*$/, "") };
  zipCache.set(path, out);
  return out;
}
// The prep hub's own Netlify address: prep.yachtrockinradio.com answers server-side
// requests with an HTML page instead of the JSON, which broke every lookup.
const TOUR_DATA = "https://yrrprep.netlify.app/tour-status.json";
let cache = { at: 0, data: null, index: null };

function norm(s) {
  s = (s || "").toLowerCase().replace(/^the\s+/, "").replace(/&/g, "and");
  return s.replace(/[^a-z0-9]/g, "");
}
function baseArtist(a) {
  a = (a || "").split(/\s+(?:f\.?|ft\.?|feat\.?|featuring|w\/|w|with)\s+/i)[0];
  return a.replace(/\s*\(.*?\)\s*/g, " ").trim();
}
function miles(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180, R = 3958.8;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const COUNTRY = { US: "US", CA: "Canadian", GB: "UK" };
function fmtDate(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function monthName(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

async function load(origin) {
  if (cache.data && Date.now() - cache.at < 3600e3) return cache;
  const r = await fetch(TOUR_DATA);
  if (!r.ok) throw new Error("tour data " + r.status);
  const text = await r.text();
  if (!text.trimStart().startsWith("{")) throw new Error("tour data is not JSON (" + (r.headers.get("content-type") || "?") + ") from " + r.url);
  const data = JSON.parse(text);
  const index = {};
  for (const [name, t] of Object.entries(data.touring || {})) {
    index[norm(name)] = name;
    if (t.tm_name) index[norm(t.tm_name)] = name;
  }
  cache = { at: Date.now(), data, index };
  return cache;
}

function upcoming(t) {
  const today = new Date().toISOString().slice(0, 10);
  return (t.events || []).filter((e) => e.date >= today);
}

function answer(name, t, where, radius = NEAR_MILES) {
  const ev = upcoming(t);
  if (!ev.length) return { artist: name, status: "none" };
  let nearest = null;
  if (where.lat != null) {
    for (const e of ev) {
      if (e.lat == null) continue;
      const d = miles(where.lat, where.lon, e.lat, e.lon);
      if (!nearest || d < nearest.miles) nearest = { ...e, miles: Math.round(d) };
    }
  }
  if (nearest && nearest.miles <= radius) {
    return { artist: name, status: "near", show: nearest, url: nearest.url,
      line: `On tour near you · ${nearest.venue}, ${nearest.city} · ${fmtDate(nearest.date)} · Tickets` };
  }
  const home = ev.filter((e) => e.country === where.country);
  if (home.length) {
    const last = home[home.length - 1];
    const n = home.length;
    return { artist: name, status: "country", url: home[0].url, nearest,
      line: `Still touring · ${n} ${COUNTRY[where.country] || ""} date${n > 1 ? "s" : ""} through ${monthName(last.date)}`.replace("  ", " ") };
  }
  const n = ev.length;
  return { artist: name, status: "touring", url: ev[0].url, nearest,
    line: `Still out on the road · ${n} date${n > 1 ? "s" : ""} through ${monthName(ev[n - 1].date)}` };
}

export default async (request, context) => {
  const headers = { "Content-Type": "application/json",
    "Cache-Control": "private, max-age=600" };
  if (request.method === "OPTIONS") return new Response("", { headers });
  try {
    const u = new URL(request.url);
    const g = context.geo || {};
    const where = {
      lat: u.searchParams.get("lat") != null ? +u.searchParams.get("lat") : g.latitude ?? null,
      lon: u.searchParams.get("lon") != null ? +u.searchParams.get("lon") : g.longitude ?? null,
      country: (u.searchParams.get("country") || g.country?.code || "").toUpperCase(),
      city: g.city || null,
    };
    if (u.searchParams.get("lat") != null) where.city = null;   // device location: no city label
    const zip = u.searchParams.get("zip");
    if (zip) {
      const z = await lookupZip(zip);
      if (!z) return new Response(JSON.stringify({ status: "badzip", zip }), { headers });
      Object.assign(where, z);
    }
    const rq = +u.searchParams.get("radius");
    const radius = rq > 0 ? Math.min(500, Math.max(10, Math.round(rq))) : NEAR_MILES;
    const { data, index } = await load(u.origin);

    if (u.searchParams.get("list")) {
      const out = Object.entries(data.touring || {})
        .map(([name, t]) => answer(name, t, where, radius))
        .filter((a) => a.status !== "none")
        .sort((a, b) => ((a.show || a.nearest)?.miles ?? 1e9) - ((b.show || b.nearest)?.miles ?? 1e9));
      return new Response(JSON.stringify({ generated: data.generated, where: { country: where.country, city: where.city, radius }, shows: out }), { headers });
    }

    const raw = u.searchParams.get("artist") || "";
    const name = index[norm(raw)] || index[norm(baseArtist(raw))];
    if (!name) return new Response(JSON.stringify({ artist: raw, status: "none" }), { headers });
    return new Response(JSON.stringify(answer(name, data.touring[name], where, radius)), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ status: "error", error: String(e) }), { status: 200, headers });
  }
};

export const config = { path: "/api/tour-near" };
