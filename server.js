#!/usr/bin/env node
/**
 * Stick & Puck — proxy server
 *
 * Handles sources that are CORS-blocked in the browser:
 *   • Kent Valley Ice Centre  (WooCommerce product page)
 *   • Tacoma Twin Rinks       (LeagueApps / WP calendar)
 *
 * Also exposes /api/discover to find FareHarbor item PKs.
 *
 * Install:  npm install express node-html-parser
 * Run:      node server.js
 * Dev:      node --watch server.js
 */

import express from "express";
import { parse as parseHtml } from "node-html-parser";

const app  = express();
const PORT = process.env.PORT ?? 3000;
const TTL  = 10 * 60 * 1000; // 10-minute cache

// ─── Simple in-memory cache ───────────────────────────────────────────────────

const _cache = new Map();
function cached(key) {
  const e = _cache.get(key);
  return e && Date.now() - e.ts < TTL ? e.data : null;
}
function cache(key, data) { _cache.set(key, { data, ts: Date.now() }); return data; }

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.static("."));
app.use((_, res, next) => { res.setHeader("Access-Control-Allow-Origin", "*"); next(); });

// ─── Shared fetch headers ─────────────────────────────────────────────────────

const UA = { "User-Agent": "Mozilla/5.0 (compatible; stick-puck-aggregator/1.0)" };

// ─── Kent Valley ──────────────────────────────────────────────────────────────

const KV_URL = "https://kentvalleyicecentre.net/stick-and-pucks/";

async function scrapeKentValley() {
  const hit = cached("kv");
  if (hit) return hit;

  const res = await fetch(KV_URL, { headers: UA });
  if (!res.ok) throw new Error(`Kent Valley HTTP ${res.status}`);
  const root = parseHtml(await res.text());
  const now  = new Date();
  const sessions = [];

  root.querySelectorAll("li.product").forEach((card, idx) => {
    const titleEl = card.querySelector(".woocommerce-loop-product__title, h2");
    const linkEl  = card.querySelector("a.woocommerce-loop-product__link, a.wc-forward, a");
    const outEl   = card.querySelector(".stock.out-of-stock") ??
                    (card.classList.value.includes("outofstock") ? card : null);
    if (!titleEl) return;

    const title   = titleEl.text.trim();
    const bookUrl = linkEl?.getAttribute("href") ?? KV_URL;
    const soldOut = !!outEl;
    const amounts = card.querySelectorAll(".price .amount");
    const priceRaw = amounts[amounts.length - 1]?.text?.replace(/[^\d.]/g, "");
    const price = priceRaw ? `$${parseFloat(priceRaw).toFixed(2)}` : null;

    const parsed = parseTitleDate(title);
    if (!parsed?.start || parsed.start <= now) return;

    sessions.push({
      id: `kv-${idx}`, start: parsed.start.toISOString(),
      end: parsed.end?.toISOString() ?? null,
      title, spots: null, price, soldOut, bookUrl,
    });
  });

  sessions.sort((a, b) => new Date(a.start) - new Date(b.start));
  return cache("kv", sessions);
}

// ─── Tacoma Twin Rinks ────────────────────────────────────────────────────────
//
// psicesports.com uses a WordPress FullCalendar widget.
// Stick N' Puck LeagueApps programId = 17615
// Direct booking: https://tacomatwinrinks.leagueapps.com/bookings?filters={"programId":"17615"}
//
// We probe known WP calendar REST endpoints until one returns JSON events.

const TACOMA_BOOKING_URL =
  "https://tacomatwinrinks.leagueapps.com/bookings?filters=%7B%22programId%22%3A%2217615%22%7D";

async function fetchTacomaFeed() {
  const hit = cached("tacoma");
  if (hit) return hit;

  const now   = new Date();
  const end60 = new Date(now); end60.setDate(end60.getDate() + 60);
  const s     = now.toISOString().slice(0, 10);
  const e     = end60.toISOString().slice(0, 10);

  const candidates = [
    `https://psicesports.com/wp-json/mec/v1/events?start=${s}&end=${e}`,
    `https://psicesports.com/wp-json/tribe/events/v1/events?start_date=${s}&end_date=${e}&per_page=50`,
    `https://psicesports.com/?action=mec_load_events&mec_start_date=${s}&mec_end_date=${e}`,
    `https://psicesports.com/wp-json/wp/v2/mec-events?per_page=50&orderby=date&order=asc`,
  ];

  const SNP_RE = /stick|puck|s\s*[&n]\s*p/i;

  for (const url of candidates) {
    try {
      const r = await fetch(url, {
        headers: { ...UA, Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      if (!(r.headers.get("content-type") ?? "").includes("json")) continue;

      const raw    = await r.json();
      const events = raw?.events ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
      if (!events.length) continue;

      const sessions = events
        .filter(ev => SNP_RE.test(
          (ev.title?.rendered ?? ev.title ?? ev.name ?? "") + " " +
          (ev.description?.rendered ?? ev.description ?? "")
        ))
        .map((ev, i) => ({
          id:      `tacoma-${ev.id ?? i}`,
          start:   ev.start_date ?? ev.utc_start_modified ?? ev.start ?? null,
          end:     ev.end_date   ?? ev.utc_end_modified   ?? ev.end   ?? null,
          title:   (ev.title?.rendered ?? ev.title ?? "Stick & Puck").replace(/<[^>]+>/g, ""),
          spots:   null, price: null, soldOut: false,
          bookUrl: ev.url ?? ev.link ?? TACOMA_BOOKING_URL,
        }))
        .filter(s => s.start && new Date(s.start) > now)
        .sort((a, b) => new Date(a.start) - new Date(b.start));

      if (sessions.length) {
        console.log(`✅ Tacoma: ${sessions.length} sessions via ${url}`);
        return cache("tacoma", sessions);
      }
    } catch (err) {
      console.warn(`  Tacoma [${url.slice(0, 55)}...]: ${err.message}`);
    }
  }

  throw new Error("Tacoma calendar feed not found — book at psicesports.com/events/");
}

// ─── FareHarbor PK discovery ──────────────────────────────────────────────────

async function discoverFHPKs() {
  const SNP_RE   = /stick|puck|hockey|s\s*[&n]\s*p/i;
  const companies = [
    { key: "olympicview", slug: "olympicviewarena",  label: "Olympic View Arena" },
    { key: "lynnwood",    slug: "lynnwoodicecenter", label: "Lynnwood Ice Center" },
  ];
  const results = {};
  for (const { key, slug, label } of companies) {
    try {
      const r = await fetch(`https://fareharbor.com/api/v1/companies/${slug}/items/`,
        { headers: UA, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { items = [] } = await r.json();
      results[key] = {
        label, slug,
        allItems: items.map(i => ({ pk: i.pk, name: i.name })),
        snpItems: items
          .filter(i => SNP_RE.test(i.name + " " + (i.description ?? "")))
          .map(i => ({ pk: i.pk, name: i.name })),
      };
    } catch (e) {
      results[key] = { label, slug, error: e.message };
    }
  }
  return results;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/api/sessions/kentvalley", async (_, res) => {
  try { res.json({ ok: true, sessions: await scrapeKentValley() }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message, sessions: [] }); }
});

app.get("/api/sessions/tacoma", async (_, res) => {
  try { res.json({ ok: true, sessions: await fetchTacomaFeed() }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message, sessions: [] }); }
});

app.get("/api/sessions/all", async (_, res) => {
  const [kv, tac] = await Promise.allSettled([scrapeKentValley(), fetchTacomaFeed()]);
  res.json({
    kentvalley: kv.status  === "fulfilled" ? { ok: true, sessions: kv.value  } : { ok: false, error: kv.reason?.message,  sessions: [] },
    tacoma:     tac.status === "fulfilled" ? { ok: true, sessions: tac.value } : { ok: false, error: tac.reason?.message, sessions: [] },
  });
});

app.get("/api/discover", async (_, res) => {
  try { res.json({ ok: true, results: await discoverFHPKs() }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post("/api/cache/clear", (_, res) => {
  _cache.clear();
  res.json({ ok: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🏒  Stick & Puck  →  http://localhost:${PORT}`);
  console.log(`\n   GET  /api/sessions/all       proxied Kent Valley + Tacoma`);
  console.log(`   GET  /api/sessions/kentvalley`);
  console.log(`   GET  /api/sessions/tacoma`);
  console.log(`   GET  /api/discover            find FareHarbor item PKs`);
  console.log(`   POST /api/cache/clear\n`);
  console.log(`   💡  First run: visit http://localhost:${PORT}/api/discover`);
  console.log(`       to find the Lynnwood stick & puck item PK.\n`);
});

// ─── Date parser ─────────────────────────────────────────────────────────────

function parseTitleDate(title) {
  const DATE_RE  = /(\w{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/;
  const RANGE_RE = /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i;
  const TIME_RE  = /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i;

  const dm = title.match(DATE_RE);
  if (!dm) return null;

  const dateStr  = dm[1].replace(",", "");
  const range    = title.match(RANGE_RE);
  const startRaw = range?.[1] ?? title.match(TIME_RE)?.[1];
  const endRaw   = range?.[2] ?? null;

  if (!startRaw) {
    const d = new Date(dateStr);
    return isNaN(d) ? null : { start: d, end: null };
  }

  const pm = (t, ref) => /[ap]m/i.test(t) ? t : `${t} ${ref?.match(/[ap]m/i)?.[0] ?? "PM"}`;
  try {
    const start = new Date(`${dateStr} ${pm(startRaw, endRaw ?? startRaw)}`);
    const end   = endRaw ? new Date(`${dateStr} ${pm(endRaw, endRaw)}`) : null;
    if (isNaN(start)) return null;
    if (end && end < start) end.setDate(end.getDate() + 1);
    return { start, end };
  } catch { return null; }
}
