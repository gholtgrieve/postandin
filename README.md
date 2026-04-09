# Seattle Stick & Puck

Aggregates open stick & puck ice times across Seattle-area rinks.

## Status

| Rink | System | Config | Live data |
|------|--------|--------|-----------|
| Kraken Community Iceplex | DaySmart JSON | `company=kraken` | ✅ |
| Sno-King Ice Arena | DaySmart JSON | `company=snoking` | ✅ |
| Olympic View Arena | FareHarbor | `company=olympicviewarena, itemPk=313860` | ✅ |
| Lynnwood Ice Center | FareHarbor | `company=lynnwoodicecenter, itemPk=245312`* | ⚠️ |
| Kent Valley Ice Centre | WooCommerce scrape | server proxy required | ✅ (with server) |
| Tacoma Twin Rinks | LeagueApps | programId=17615 | ⚠️ |

\* Item 245312 = public sessions. Run `/api/discover` (see below) to find the S&P-specific PK.

---

## Quick start

### Static only (4 rinks live, 2 as booking links)
```bash
open index.html
# or: npx serve .
```
Kraken, Sno-King, OVA, and Lynnwood (public sessions) fetch live.
Kent Valley and Tacoma show as direct booking links.

### Full server (all 6 rinks)
```bash
npm install
npm start
open http://localhost:3000
```

---

## Finding the Lynnwood S&P item PK

Run the server, then visit:
```
http://localhost:3000/api/discover
```

This hits `fareharbor.com/api/v1/companies/lynnwoodicecenter/items/` and prints all items.
Look for one with "stick" or "puck" in the name. Then update in `index.html`:

```js
lynnwood: { config: { company: "lynnwoodicecenter", itemPk: <NEW_PK> } }
```

Or from the command line without the server:
```bash
node discover-pks.js
```

Or from the browser console on the page:
```js
await window.discoverLynnwoodPKs()
// Then once you have the PK:
window.setLynnwoodPK(123456)
loadData()
```

---

## Tacoma Twin Rinks

Tacoma uses **LeagueApps**, which requires user login — no public API.

- Direct S&P booking: https://tacomatwinrinks.leagueapps.com/bookings?filters={"programId":"17615"}
- The server (`server.js`) probes several WordPress REST endpoints on `psicesports.com`
  in case a public calendar feed exists. If any endpoint returns data, Tacoma will
  show inline sessions automatically. Otherwise it shows as a "book directly" link.

---

## Architecture

```
Browser
  ├─ DaySmart API (Kraken, Sno-King)      direct fetch, no CORS issue
  ├─ FareHarbor API (OVA, Lynnwood)       direct fetch, no CORS issue
  ├─ /api/sessions/kentvalley  ─────┐
  └─ /api/sessions/tacoma      ─────┤
                                    └── server.js (Express proxy, 10-min cache)
                                            ├── Kent Valley HTML scrape
                                            └── Tacoma WP REST probe
```

## Deployment

Simplest path: deploy `server.js` to [Railway](https://railway.app) or [Render](https://render.com) (both free tier), then set `API_BASE` in `index.html` to point to the deployed URL.

Or just open `index.html` locally — Kraken, Sno-King, OVA, and Lynnwood work without a server.
