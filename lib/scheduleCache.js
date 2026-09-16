// Scheduler-owned snapshots. Retention and serving age are deliberately separate.
export const SCHEDULE_CACHE_KEYS = Object.freeze({
  'stick-and-puck': 'schedule:cache',
  'drop-in-hockey': 'schedule:cache:drop-in-hockey',
  'public-skate': 'schedule:cache:public-skate',
});
export const SCHEDULE_RETENTION_SECONDS = 48 * 60 * 60;
export const SCHEDULE_FRESH_MS = 45 * 60 * 1000;
export const SCHEDULE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SCHEDULE_CLOCK_SKEW_MS = 60 * 1000;
