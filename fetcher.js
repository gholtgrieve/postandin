/**
 * Stick & Puck Session Fetcher
 * Aggregates data from all Seattle-area rinks.
 *
 * Sources:
 *   - DaySmart JSON API:  Kraken Community Iceplex, Sno-King Ice Arena
 *   - FareHarbor API:     Olympic View Arena, Lynnwood Ice Center (TBD PK)
 *   - WooCommerce/HTML:   Kent Valley Ice Centre
 *   - LeagueApps:         Tacoma Twin Rinks (PS Ice Sports)
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const RINKS = {
  kraken: {
    name: "Kraken Community Iceplex",
    city: "Seattle",
    address: "305 Harrison St, Seattle, WA 98109",
    url: "https://www.krakencommunityiceplex.com/",
    system: "daysmart",
    config: { company: "kraken", sportId: 20 },
    color: "#00B4D8",
  },
  snoking: {
    name: "Sno-King Ice Arena",
    city: "Renton",
    address: "1326 NE 10th St, Renton, WA 98057",
    url: "https://sno-king.com/",
    system: "daysmart",
    config: { company: "snoking", sportId: 20 },
    color: "#48CAE4",
  },
  olympicview: {
    name: "Olympic View Arena",
    city: "Mountlake Terrace",
    address: "22502 54th Ave W, Mountlake Terrace, WA 98043",
    url: "https://www.olympicviewarena.com/",
    system: "fareharbor",
    config: { company: "olympicviewarena", itemPk: 313860 },
    color: "#0077B6",
  },
  lynnwood: {
    name: "Lynnwood Ice Center",
    city: "Lynnwood",
    address: "19803 68th Ave W, Lynnwood, WA 98036",
    url: "https://www.lynnwoodicecenter.com/",
    system: "fareharbor",
    config: { company: "lynnwoodicecenter", itemPk: 245296 }, // "Stick and Puck LIC Drop In" ✅
    color: "#0096C7",
  },
  kentvalley: {
    name: "Kent Valley Ice Centre",
    city: "Kent",
    address: "6015 S 240th St, Kent, WA 98032",
    url: "https://kentvalleyicecentre.net/stick-and-pucks/",
    system: "woocommerce",
    config: { scrapeUrl: "https://kentvalleyicecentre.net/stick-and-pucks/" },
    color: "#023E8A",
  },
  tacoma: {
    name: "Tacoma Twin Rinks (PS Ice Sports)",
    city: "Tacoma",
    address: "2730 N 30th St, Tacoma, WA 98407",
    url: "https://psicesports.com/events/",
    system: "leagueapps",
    config: { site: "tacomatwinrinks" },
    color: "#3A0CA3",
  },
};

// ─── DAYSMART FETCHER ─────────────────────────────────────────────────────────

async function fetchDaySmart(config) {
  const url = `https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events?filter[homeTeam.sport_id__in]=${config.sportId}&company=${config.company}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DaySmart HTTP ${res.status}`);
  const data = await res.json();

  const sessions = [];
  for (const event of data?.data ?? []) {
    const attr = event.attributes ?? {};
    const name = (attr.name ?? attr.title ?? "").toLowerCase();
    // Filter for stick & puck events only
    if (!name.includes("stick") && !name.includes("s&p") && !name.includes("s & p")) continue;

    const start = attr.startTime ?? attr.start_time ?? attr.start;
    const end = attr.endTime ?? attr.end_time ?? attr.end;
    const spots = attr.spotsAvailable ?? attr.spots_available ?? attr.capacity;
    const price = attr.price ?? attr.cost;

    if (start) {
      sessions.push({
        id: event.id,
        start: new Date(start),
        end: end ? new Date(end) : null,
        title: attr.name ?? attr.title ?? "Stick & Puck",
        spotsAvailable: spots,
        price: price ? formatPrice(price) : null,
        soldOut: spots === 0,
        bookingUrl: attr.bookingUrl ?? null,
      });
    }
  }
  return sessions.sort((a, b) => a.start - b.start);
}

// ─── FAREHARBOR FETCHER ───────────────────────────────────────────────────────

async function fetchFareHarbor(config, year, month) {
  if (!config.itemPk) {
    console.warn(`FareHarbor: missing itemPk for ${config.company}`);
    return [];
  }
  const mm = String(month).padStart(2, "0");
  const url = `https://fareharbor.com/api/v1/companies/${config.company}/items/${config.itemPk}/calendar/${year}/${mm}/`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FareHarbor HTTP ${res.status}`);
  const data = await res.json();

  const sessions = [];
  for (const day of data?.dates ?? []) {
    for (const avail of day?.availabilities ?? []) {
      sessions.push({
        id: `fh-${avail.pk}`,
        start: new Date(avail.start_at),
        end: new Date(avail.end_at),
        title: "Stick & Puck",
        spotsAvailable: avail.customer_type_rates?.[0]?.availability?.capacity_remaining ?? null,
        price: avail.customer_type_rates?.[0]?.total_including_tax != null
          ? formatPrice(avail.customer_type_rates[0].total_including_tax / 100)
          : null,
        soldOut: !avail.is_bookable || avail.bookable_with_code === false,
        bookingUrl: `https://fareharbor.com/embeds/book/${config.company}/items/${config.itemPk}/availability/${avail.pk}/book/`,
      });
    }
  }
  return sessions.sort((a, b) => a.start - b.start);
}

// Fetch FareHarbor for current + next month
async function fetchFareHarborMultiMonth(config) {
  const now = new Date();
  const months = [
    [now.getFullYear(), now.getMonth() + 1],
    [now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(),
     now.getMonth() === 11 ? 1 : now.getMonth() + 2],
  ];
  const results = await Promise.all(months.map(([y, m]) => fetchFareHarbor(config, y, m)));
  return results.flat();
}

// ─── KENT VALLEY (WooCommerce HTML scrape) ────────────────────────────────────
// Kent Valley lists S&P sessions as WooCommerce products.
// The page at /stick-and-pucks/ has product cards with date/time in the title.

async function fetchKentValley(config) {
  const res = await fetch(config.scrapeUrl);
  if (!res.ok) throw new Error(`Kent Valley HTTP ${res.status}`);
  const html = await res.text();

  const sessions = [];
  // Each product has a link with the session title and a "sold out" badge if full.
  // Pattern: <h2 class="woocommerce-loop-product__title">DATE – TIME</h2>
  const titleRe = /<h2[^>]*woocommerce-loop-product__title[^>]*>([\s\S]*?)<\/h2>/gi;
  const linkRe = /<a[^>]*href="(https:\/\/kentvalleyicecentre\.net\/product\/[^"]+)"[^>]*>/gi;
  const soldRe = /<span[^>]*out-of-stock[^>]*>|class="[^"]*out-of-stock[^"]*"/gi;
  const priceRe = /\$\s*([\d,.]+)/g;

  const titles = [...html.matchAll(titleRe)].map(m => m[1].replace(/<[^>]+>/g, "").trim());
  const links = [...html.matchAll(linkRe)].map(m => m[1]);
  const rawPrices = [...html.matchAll(priceRe)].map(m => parseFloat(m[1].replace(",", "")));
  const isSoldOut = soldRe.test(html); // crude global check; improve per-product if needed

  titles.forEach((title, i) => {
    // Try to parse date from title like "April 12, 2026 – 5:00 PM – 6:30 PM"
    const parsed = parseDateFromTitle(title);
    sessions.push({
      id: `kv-${i}`,
      start: parsed?.start ?? null,
      end: parsed?.end ?? null,
      title: title,
      spotsAvailable: null,
      price: rawPrices[i] ? `$${rawPrices[i]}` : null,
      soldOut: isSoldOut,
      bookingUrl: links[i] ?? config.scrapeUrl,
    });
  });

  return sessions.filter(s => s.start).sort((a, b) => a.start - b.start);
}

// ─── TACOMA (LeagueApps — calendar scrape) ───────────────────────────────────
// PS Ice Sports hosts a FullCalendar widget at psicesports.com/events/
// The underlying feed is at LeagueApps. We fetch the ical/JSON feed if available,
// otherwise fall back to HTML scrape of the visible calendar events.
// NOTE: This may require browser rendering. For now, return a "visit site" placeholder
//       with a link, and provide a hook to swap in real data when the feed URL is found.

async function fetchTacoma(_config) {
  // TODO: Inspect psicesports.com/events/ in browser DevTools → Network → XHR/Fetch
  //       to find the FullCalendar JSON feed URL. It will look like:
  //       /wp-json/mec/... or /events/json?start=...&end=...
  //       Capture that URL and implement a real fetch here.
  console.warn("Tacoma Twin Rinks: no API discovered yet — returning empty");
  return [];
}

// ─── AGGREGATOR ───────────────────────────────────────────────────────────────

export async function fetchAllSessions() {
  const results = {};

  const fetches = [
    ["kraken",      () => fetchDaySmart(RINKS.kraken.config)],
    ["snoking",     () => fetchDaySmart(RINKS.snoking.config)],
    ["olympicview", () => fetchFareHarborMultiMonth(RINKS.olympicview.config)],
    ["lynnwood",    () => fetchFareHarborMultiMonth(RINKS.lynnwood.config)],
    ["kentvalley",  () => fetchKentValley(RINKS.kentvalley.config)],
    ["tacoma",      () => fetchTacoma(RINKS.tacoma.config)],
  ];

  await Promise.allSettled(fetches.map(async ([key, fn]) => {
    try {
      results[key] = { status: "ok", sessions: await fn(), rink: RINKS[key] };
    } catch (err) {
      console.error(`${key} fetch failed:`, err.message);
      results[key] = { status: "error", error: err.message, sessions: [], rink: RINKS[key] };
    }
  }));

  return results;
}

export { RINKS };

// ─── UTILS ────────────────────────────────────────────────────────────────────

function formatPrice(val) {
  if (val == null) return null;
  const n = typeof val === "string" ? parseFloat(val) : val;
  return isNaN(n) ? null : `$${n.toFixed(2)}`;
}

function parseDateFromTitle(title) {
  // Handle patterns like:
  //   "April 12, 2026 5:00 PM – 6:30 PM"
  //   "04/12/2026 5pm-6:30pm"
  //   "Sat Apr 12 | 5:00–6:30pm"
  const dateRe = /(\w+ \d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/;
  const timeRe = /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*[-–—to]+\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i;

  const dateMatch = title.match(dateRe);
  const timeMatch = title.match(timeRe);
  if (!dateMatch) return null;

  const dateStr = dateMatch[1];
  const startTime = timeMatch?.[1] ?? "12:00 AM";
  const endTime = timeMatch?.[2] ?? null;

  try {
    const start = new Date(`${dateStr} ${startTime}`);
    const end = endTime ? new Date(`${dateStr} ${endTime}`) : null;
    if (isNaN(start)) return null;
    return { start, end };
  } catch {
    return null;
  }
}
