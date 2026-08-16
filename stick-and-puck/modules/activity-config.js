export const ACTIVITY_STICK_AND_PUCK = 'stick-and-puck';
export const ACTIVITY_DROP_IN_HOCKEY = 'drop-in-hockey';
export const ACTIVITY_PUBLIC_SKATE = 'public-skate';

const ACTIVITY_CONFIGS = Object.freeze({
  [ACTIVITY_STICK_AND_PUCK]: Object.freeze({
    id: ACTIVITY_STICK_AND_PUCK,
    scheduleUrl: '/api/schedule',
    groupsEnabled: true,
    showSessionDetails: true,
  }),
  [ACTIVITY_DROP_IN_HOCKEY]: Object.freeze({
    id: ACTIVITY_DROP_IN_HOCKEY,
    scheduleUrl: '/api/schedule?activity=drop-in-hockey',
    groupsEnabled: true,
    showSessionDetails: true,
  }),
  [ACTIVITY_PUBLIC_SKATE]: Object.freeze({
    id: ACTIVITY_PUBLIC_SKATE,
    scheduleUrl: '/api/schedule?activity=public-skate',
    groupsEnabled: false,
    showSessionDetails: false,
  }),
});

export function getActivityConfig(activityId) {
  const resolvedId = activityId || ACTIVITY_STICK_AND_PUCK;
  const config = ACTIVITY_CONFIGS[resolvedId];
  if (!config) throw new Error(`Unsupported schedule activity: ${resolvedId}`);
  return config;
}
