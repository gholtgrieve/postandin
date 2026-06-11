# Seattle Stick & Puck — Post & In

Aggregates open stick & puck ice times across Seattle-area rinks into a single live page.

Live at **[postandin.com/stick-and-puck](https://postandin.com/stick-and-puck/)**

---

## Rinks

| Rink | City | System | Notes |
|------|------|--------|-------|
| Kraken Community Iceplex | Seattle | DaySmart | Direct API, no proxy needed |
| Sno-King Ice Arena | Renton | DaySmart | Resources 11, 12 (Large + Small Ice) |
| Sno-King Ice Arena | Kirkland | DaySmart | Resource 1 |
| Sno-King Ice Arena | Snoqualmie | DaySmart | Resources 13, 14 (Rink A + B) |
| Olympic View Arena | Mountlake Terrace | FareHarbor | itemPk 313860, proxied via `/api/fareharbor` |
| Lynnwood Ice Center | Lynnwood | FareHarbor | itemPk 245296, proxied via `/api/fareharbor` |
| Everett Community Ice Rink | Everett | Custom (Angel of the Winds) | Proxied via `/api/everett` |
| Kent Valley Ice Centre | Kent | Google Calendar iCal | Proxied via `/api/kentvalley` |

---

## Architecture

All session data is fetched client-side from `stick-and-puck/index.html`. Sources that require a CORS proxy are routed through serverless functions.

```
Browser (stick-and-puck/index.html)
  ├─ DaySmart API (Kraken, Sno-King ×3)   direct fetch — no CORS issue
  ├─ FareHarbor API (OVA, Lynnwood)        direct fetch — no CORS issue
  ├─ /api/fareharbor  ────────────────┐
  ├─ /api/everett     ────────────────┤
  └─ /api/kentvalley  ────────────────┴── serverless functions (see below)
```

### Serverless functions

Cloudflare Pages Functions in `functions/api/`:

- **`fareharbor.js`** — proxies FareHarbor calendar API to avoid CORS
- **`everett.js`** — proxies Angel of the Winds schedule API
- **`kentvalley.js`** — fetches and parses Kent Valley's public Google Calendar iCal feed; caches last good response in the Workers Cache API so transient Google Calendar failures serve stale data instead of an error

---

## Local development

### Static only (DaySmart + FareHarbor rinks)
```bash
open stick-and-puck/index.html
```
Kraken, Sno-King, OVA, and Lynnwood fetch live. Everett and Kent Valley will error without their proxy functions running.

### With Cloudflare Pages (all rinks)
```bash
npx wrangler pages dev . --compatibility-flag=nodejs_compat
```

---

## Finding a FareHarbor item PK

From the browser console on the page:
```js
await window.discoverLynnwoodPKs()
// Returns a table of all Lynnwood FareHarbor items
// Once you have the PK:
window.setLynnwoodPK(123456)
loadData()
```

Then update `itemPk` in the `RINKS` config in `stick-and-puck/index.html`.

---

## Kent Valley iCal notes

Kent Valley's Google Calendar (`kentvalleyicecentre.com@gmail.com`) is fetched as iCal server-side to avoid CORS. Google Calendar pre-expands recurring events into individual VEVENT blocks, so no RRULE handling is needed. Events are filtered to those with `stick` in the summary and a DTSTART that includes a time component (all-day events are skipped). The last good response is cached in the Workers Cache API so transient Google Calendar failures serve stale data instead of an error.
