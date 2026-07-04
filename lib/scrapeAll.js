// Scrapes all rinks defined in RINKS and returns { [rinkKey]: { ok, sessions, error? } }.
// Used by both functions/api/schedule.js (fallback) and the scheduler Worker (cron).

import { RINKS } from './rinks.js';
import { scrapeDaySmart } from './scrapers/daysmart.js';
import { scrapeRecTimes } from './scrapers/rectimes.js';
import { scrapeKentValley } from './scrapers/kentvalley.js';
import { scrapeEverett } from './scrapers/everett.js';

export async function scrapeAll({ jitterRecTimes = false } = {}) {
  const entries = await Promise.all(
    Object.entries(RINKS).map(async ([key, rink]) => {
      try {
        let sessions;
        switch (rink.system) {
          case 'daysmart': sessions = await scrapeDaySmart(rink.config); break;
          case 'rectimes': sessions = await scrapeRecTimes(rink.config, { jitter: jitterRecTimes }); break;
          case 'ical':     sessions = (await scrapeKentValley()).sessions; break;
          case 'everett':  sessions = await scrapeEverett(); break;
          default: return [key, { ok: false, sessions: [], error: `Unknown system: ${rink.system}` }];
        }
        return [key, { ok: true, sessions }];
      } catch (e) {
        console.error(`scrapeAll: ${key} failed:`, e.message, e.stack);
        return [key, { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' }];
      }
    })
  );
  return Object.fromEntries(entries);
}
