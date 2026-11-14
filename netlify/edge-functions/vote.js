// Netlify Edge Function (YRR app site): /api/vote
// Thumbs up/down from the app pass through here on the way to the
// "YRR Listener Votes" sheet, so each vote row can carry the listener's
// approximate location (city, state/province, country) from Netlify's
// connection lookup. The listener's IP address is never sent or stored.

const SHEET_ENDPOINT = "https://script.google.com/macros/s/AKfycbzjSRhTlDhUPcEvnHFQWntK5jd5pGPiI4WI-ULOelVTt0-PjcpOdaat3FbSux4dCS2Vgg/exec";
const KEYS = ["track", "artist", "category", "vote", "source", "lid", "ver"];

export default async (request, context) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const u = new URL(request.url);
  const vote = (u.searchParams.get("vote") || "").toLowerCase();
  if (vote !== "up" && vote !== "down") return new Response('{"ok":false}', { status: 400, headers });

  const params = new URLSearchParams();
  for (const k of KEYS) params.set(k, String(u.searchParams.get(k) || "").slice(0, 200));
  const g = context.geo || {};
  params.set("geo", [g.city, g.subdivision?.code, g.country?.code].filter(Boolean).join(", "));

  try {
    const r = await fetch(`${SHEET_ENDPOINT}?${params}`, { redirect: "follow" });
    return new Response(await r.text(), { headers });
  } catch (_) {
    return new Response('{"ok":false}', { status: 502, headers });
  }
};

export const config = { path: "/api/vote" };
