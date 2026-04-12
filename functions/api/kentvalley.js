export async function onRequest() {
  const KV_URL = "https://kentvalleyicecentre.net/stick-and-pucks/";
  try {
    const res = await fetch(KV_URL, { headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://kentvalleyicecentre.net/',
      'Cache-Control': 'no-cache',
    }});
    if (!res.ok) throw new Error("HTTP " + res.status);
    const html = await res.text();
    const seen = new Set();
    const sessions = [];
    const now = new Date();
    const marker = 'kentvalleyicecentre.net/product/';
    let pos = 0;
    while ((pos = html.indexOf(marker, pos)) !== -1) {
      const slugStart = pos + marker.length;
      const slugEnd = html.indexOf('/', slugStart);
      if (slugEnd === -1) { pos++; continue; }
      const slug = html.slice(slugStart, slugEnd);
      pos = slugEnd + 1;
      if (!slug.includes('stick-and-puck') || seen.has(slug)) continue;
      seen.add(slug);
      const dateMatch = slug.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!dateMatch) continue;
      const [, year, month, day] = dateMatch;
      const timeMatch = slug.match(/(\d{1,4})(am|pm)-(\d{1,4})(am|pm)/);
      if (!timeMatch) continue;
      const parseTime = (t, ap) => {
        let h, min;
        if (t.length === 4) { h = parseInt(t.slice(0,2)); min = parseInt(t.slice(2)); }
        else if (t.length === 3) { h = parseInt(t.slice(0,1)); min = parseInt(t.slice(1)); }
        else { h = parseInt(t); min = 0; }
        if (ap === 'pm' && h !== 12) h += 12;
        if (ap === 'am' && h === 12) h = 0;
        return { h, min };
      };
      const st = parseTime(timeMatch[1], timeMatch[2]);
      const et = parseTime(timeMatch[3], timeMatch[4]);
      const pad = n => String(n).padStart(2,'0');
      const start = `${year}-${month}-${day}T${pad(st.h)}:${pad(st.min)}:00`;
      const end   = `${year}-${month}-${day}T${pad(et.h)}:${pad(et.min)}:00`;
      if (new Date(`${year}-${month}-${day}T23:59:00`) < now) continue;
      sessions.push({ id: slug, start, end, title: "Stick & Puck", spots: null, price: null, soldOut: false,
        bookUrl: "https://kentvalleyicecentre.net/product/" + slug + "/" });
    }
    sessions.sort((a,b) => a.start.localeCompare(b.start));
    return new Response(JSON.stringify({ ok: true, sessions }), { headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300',
    }});
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, sessions: [] }), { status: 502 });
  }
}
