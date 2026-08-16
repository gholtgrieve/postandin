// GET /api/schedule
// Serves the pre-scraped schedule from KV (written by the scheduler Worker every 30 min).
// Falls back to a live scrape on first deploy before the scheduler has run.

import { scrapeAll } from '../../lib/scrapeAll.js';
import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
  ACTIVITY_STICK_AND_PUCK,
  SUPPORTED_ACTIVITIES,
} from '../../lib/activities.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=120',
};

const SCHEDULE_CACHE_KEYS = Object.freeze({
  [ACTIVITY_STICK_AND_PUCK]: 'schedule:cache',
  [ACTIVITY_DROP_IN_HOCKEY]: 'schedule:cache:drop-in-hockey',
  [ACTIVITY_PUBLIC_SKATE]: 'schedule:cache:public-skate',
});

export async function onRequest(context) {
  return handleScheduleRequest(context);
}

export async function handleScheduleRequest(context, { scrape = scrapeAll } = {}) {
  const activity = new URL(context.request.url).searchParams.get('activity')
    ?? ACTIVITY_STICK_AND_PUCK;

  if (!SUPPORTED_ACTIVITIES.includes(activity)) {
    return errorResponse(400, 'Unsupported activity.');
  }

  try {
    const { GROUPS } = context.env;
    if (GROUPS) {
      const cached = await GROUPS.get(SCHEDULE_CACHE_KEYS[activity], { type: 'json' });
      if (cached?.data) {
        return new Response(JSON.stringify(cached.data), {
          headers: { ...HEADERS, 'X-Cache': 'HIT', 'X-Fetched-At': cached.fetchedAt ?? '' },
        });
      }
    }

    // Cold-start fallback: live scrape (runs only until the first cron fires).
    const data = await scrape({ activities: [activity] });
    return new Response(JSON.stringify(data), {
      headers: { ...HEADERS, 'X-Cache': 'MISS' },
    });
  } catch (error) {
    console.error('schedule request failed:', error?.message, error?.stack);
    return errorResponse(502, 'Schedule temporarily unavailable.');
  }
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...HEADERS, 'Cache-Control': 'no-store' },
  });
}
