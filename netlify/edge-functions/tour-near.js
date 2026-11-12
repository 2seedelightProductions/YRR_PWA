// Netlify Edge Function (YRR app site): /api/tour-near
// The tour data is built weekly in the private prep hub; this function reads it
// server-side, so listeners only ever talk to the app's own site.
// Answers "is this artist touring, and is there a show near this listener?"
// for the YRR app crawl. Uses Netlify's approximate visitor location
// (context.geo); nothing about the listener is stored or logged.
//
//   GET /api/tour-near?artist=Christopher%20Cross   → one artist (crawl)
//   GET /api/tour-near?list=1                        → all touring artists, nearest first
//   Optional &lat=..&lon=..&country=US to override the location (listener-chosen home city)

const NEAR_MILES = 150;
const TOUR_DATA = "https://prep.yachtrockinradio.com/tour-status.json";
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
  const data = await r.json();
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

function answer(name, t, where) {
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
  if (nearest && nearest.miles <= NEAR_MILES) {
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
    };
    const { data, index } = await load(u.origin);

    if (u.searchParams.get("list")) {
      const out = Object.entries(data.touring || {})
        .map(([name, t]) => answer(name, t, where))
        .filter((a) => a.status !== "none")
        .sort((a, b) => (a.nearest?.miles ?? 1e9) - (b.nearest?.miles ?? 1e9));
      return new Response(JSON.stringify({ generated: data.generated, where: { country: where.country, city: g.city || null }, shows: out }), { headers });
    }

    const raw = u.searchParams.get("artist") || "";
    const name = index[norm(raw)] || index[norm(baseArtist(raw))];
    if (!name) return new Response(JSON.stringify({ artist: raw, status: "none" }), { headers });
    return new Response(JSON.stringify(answer(name, data.touring[name], where)), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ status: "error", error: String(e) }), { status: 200, headers });
  }
};

export const config = { path: "/api/tour-near" };
