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
        let activityAttempts = [];
        let activityFailures = [];
        switch (rink.system) {
          case 'daysmart': {
            const result = await scrapeDaySmart(rink.config, { activities });
            sessions = result.sessions;
            activityAttempts = result.attempted;
            activityFailures = result.failures;
            break;
          }
          case 'rectimes': sessions = await scrapeRecTimes(rink.config, { jitter: jitterRecTimes, activities }); break;
          case 'ical': {
            const result = await scrapeKentValley({ activities });
            sessions = result.sessions;
            activityAttempts = result.attempted;
            activityFailures = result.failures;
            break;
          }
          case 'everett':  sessions = await scrapeEverett({ activities }); break;
          default: return [key, { ok: false, sessions: [], error: `Unknown system: ${rink.system}` }];
        }
        sessions = sessions.filter(session => requested.has(session.activity));
        if (
          activityAttempts.length > 0 &&
          activityFailures.length === activityAttempts.length
        ) {
          return [key, {
            ok: false,
            sessions: [],
            error: 'Schedule temporarily unavailable for this rink.',
          }];
        }
        return [key, {
          ok: true,
          sessions,
          ...(activityFailures.length ? { activityFailures } : {}),
        }];
      } catch (e) {
        console.error(`scrapeAll: ${key} failed:`, e.message, e.stack);
        return [key, { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' }];
      }
    })
  );
  return Object.fromEntries(entries);
}
