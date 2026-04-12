// netlify/functions/kentvalley.js
// Fetches Kent Valley Ice Centre stick & puck sessions server-side (bypasses CORS).
// Parses session date/time from WooCommerce product URL slugs.
// e.g. /product/2026-04-13-mon-1230pm-145pm-stick-and-puck/

export async function handler() {
  const KV_URL = "https://kentvalleyicecentre.net/stick-and-pucks/";

  try {
    const res = await fetch(KV_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; postandin-bot/1.0)" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();

    // Extract all unique product slugs from href attributes
    const seen = new Set();
    const sessions = [];
    const now = new Date();

    // Match all product links — use a simple string scan to avoid regex global issues
    const marker = 'kentvalleyicecentre.net/product/';
    let pos = 0;
    while ((pos = html.indexOf(marker, pos)) !== -1) {
      const slugStart = pos + marker.length;
      const slugEnd = html.indexOf('/', slugStart);
      if (slugEnd === -1) { pos++; continue; }
      const slug = html.slice(slugStart, slugEnd);
      pos = slugEnd + 1;

      if (!slug.includes('stick-and-puck')) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);

      // Parse slug: 2026-04-13-mon-1230pm-145pm-stick-and-puck
      const dateMatch = slug.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) continue;
      const [, year, month, day] = dateMatch;

      // Extract times: e.g. 1230pm-145pm or 430pm-545pm
      const timeMatch = slug.match(/(\d{1,4})(am|pm)-(\d{1,4})(am|pm)/);
      if (!timeMatch) continue;

      const parseTime = (t, ampm) => {
        // t could be "1230" (12h30m) or "145" (1h45m) or "930" (9h30m)
        let h, min;
        if (t.length === 4) {
          h = parseInt(t.slice(0, 2), 10);
          min = parseInt(t.slice(2), 10);
        } else if (t.length === 3) {
          h = parseInt(t.slice(0, 1), 10);
          min = parseInt(t.slice(1), 10);
        } else {
          h = parseInt(t, 10);
          min = 0;
        }
        if (ampm === "pm" && h !== 12) h += 12;
        if (ampm === "am" && h === 12) h = 0;
        return { h, min };
      };

      const st = parseTime(timeMatch[1], timeMatch[2]);
      const et = parseTime(timeMatch[3], timeMatch[4]);

      // Build ISO strings in Pacific time (America/Los_Angeles)
      // Use a fixed UTC offset approach: PST=-8, PDT=-7
      // Netlify runs in UTC — emit as a local datetime string without Z
      // so the browser interprets it in the user's local timezone
      const pad = n => String(n).padStart(2, "0");
      const startStr = `${year}-${month}-${day}T${pad(st.h)}:${pad(st.min)}:00`;
      const endStr   = `${year}-${month}-${day}T${pad(et.h)}:${pad(et.min)}:00`;

      // Check if session is in the past (compare date string only for now filter)
      const sessionDate = new Date(`${year}-${month}-${day}T23:59:00`);
      if (sessionDate < now) continue;

      const bookUrl = "https://kentvalleyicecentre.net/product/" + slug + "/";

      sessions.push({ id: slug, start: startStr, end: endStr, title: "Stick & Puck", spots: null, price: null, soldOut: false, bookUrl });
    }

    sessions.sort((a, b) => a.start.localeCompare(b.start));

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
      body: JSON.stringify({ ok: true, sessions }),
    };
  } catch (e) {
    return {
      statusCode: 502,
      body: JSON.stringify({ ok: false, error: e.message, sessions: [] }),
    };
  }
}
