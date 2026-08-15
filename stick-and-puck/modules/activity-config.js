export const ACTIVITY_STICK_AND_PUCK = 'stick-and-puck';
export const ACTIVITY_DROP_IN_HOCKEY = 'drop-in-hockey';

const ACTIVITY_CONFIGS = Object.freeze({
  [ACTIVITY_STICK_AND_PUCK]: Object.freeze({
    id: ACTIVITY_STICK_AND_PUCK,
    scheduleUrl: '/api/schedule',
  }),
  [ACTIVITY_DROP_IN_HOCKEY]: Object.freeze({
    id: ACTIVITY_DROP_IN_HOCKEY,
    scheduleUrl: '/api/schedule?activity=drop-in-hockey',
  }),
});

export function getActivityConfig(activityId) {
  const resolvedId = activityId || ACTIVITY_STICK_AND_PUCK;
  const config = ACTIVITY_CONFIGS[resolvedId];
  if (!config) throw new Error(`Unsupported schedule activity: ${resolvedId}`);
  return config;
}
