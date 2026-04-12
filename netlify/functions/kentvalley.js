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

    // Extract product links — date/time is encoded in the slug
    const linkRe = /href="(https:\/\/kentvalleyicecentre\.net\/product\/([^"]+))\/"/g;
    const outOfStockRe = /"([^"]*stick[^"]*)"[^]*?class="[^"]*outofstock/gi;
    const soldOutSlugs = new Set();
    let m;
    while ((m = outOfStockRe.exec(html)) !== null) soldOutSlugs.add(m[1]);

    const now = new Date();
    const sessions = [];

    while ((m = linkRe.exec(html)) !== null) {
      const url = m[1];
      const slug = m[2];

      // Parse slug: 2026-04-13-mon-1230pm-145pm-stick-and-puck
      const dateMatch = slug.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) continue;

      const [, year, month, day] = dateMatch;

      // Extract start time: e.g. 1230pm, 430pm, 930am
      const timeMatch = slug.match(/(\d{1,4})(am|pm)-(\d{1,4})(am|pm)/);
      if (!timeMatch) continue;

      const parseTime = (t, ampm) => {
        const padded = t.padStart(4, "0");
        let h = parseInt(padded.slice(0, -2), 10);
        const min = parseInt(padded.slice(-2), 10);
        if (ampm === "pm" && h !== 12) h += 12;
        if (ampm === "am" && h === 12) h = 0;
        return { h, min };
      };

      const st = parseTime(timeMatch[1], timeMatch[2]);
      const et = parseTime(timeMatch[3], timeMatch[4]);

      const start = new Date(year, month - 1, day, st.h, st.min);
      const end   = new Date(year, month - 1, day, et.h, et.min);
      if (start <= now) continue;

      sessions.push({
        id: slug,
        start: start.toISOString(),
        end:   end.toISOString(),
        title: "Stick & Puck",
        spots: null,
        price: null,
        soldOut: false,
        bookUrl: url,
      });
    }

    sessions.sort((a, b) => new Date(a.start) - new Date(b.start));

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
