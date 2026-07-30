// Scrapes all rinks defined in RINKS and returns { [rinkKey]: { ok, sessions, error? } }.
// Used by both functions/api/schedule.js (fallback) and the scheduler Worker (cron).

import { RINKS } from './rinks.js';
import { activitySet } from './activities.js';
import { scrapeDaySmart } from './scrapers/daysmart.js';
import { scrapeRecTimes } from './scrapers/rectimes.js';
import { scrapeKentValley } from './scrapers/kentvalley.js';
import { scrapeEverett } from './scrapers/everett.js';

export async function scrapeAll({ jitterRecTimes = false, activities } = {}) {
  const requested = activitySet(activities);
  const entries = await Promise.all(
    Object.entries(RINKS).map(async ([key, rink]) => {
      try {
        let sessions;
        switch (rink.system) {
          case 'daysmart': sessions = await scrapeDaySmart(rink.config, { activities }); break;
          case 'rectimes': sessions = await scrapeRecTimes(rink.config, { jitter: jitterRecTimes, activities }); break;
          case 'ical':     sessions = (await scrapeKentValley()).sessions; break;
          case 'everett':  sessions = await scrapeEverett({ activities }); break;
          default: return [key, { ok: false, sessions: [], error: `Unknown system: ${rink.system}` }];
        }
        sessions = sessions.filter(session => requested.has(session.activity));
        return [key, { ok: true, sessions }];
      } catch (e) {
        console.error(`scrapeAll: ${key} failed:`, e.message, e.stack);
        return [key, { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' }];
      }
    })
  );
  return Object.fromEntries(entries);
}
