import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
  ACTIVITY_STICK_AND_PUCK,
  getActivityConfig,
} from '../stick-and-puck/modules/activity-config.js';

test('Stick & Puck remains the default schedule activity', () => {
  assert.deepEqual(getActivityConfig(), {
    id: ACTIVITY_STICK_AND_PUCK,
    scheduleUrl: '/api/schedule',
    groupsEnabled: true,
    showSessionDetails: true,
  });
});

test('Drop-in Hockey selects the activity-specific schedule API', () => {
  assert.deepEqual(getActivityConfig(ACTIVITY_DROP_IN_HOCKEY), {
    id: ACTIVITY_DROP_IN_HOCKEY,
    scheduleUrl: '/api/schedule?activity=drop-in-hockey',
    groupsEnabled: true,
    showSessionDetails: true,
  });
});

test('Public Skate selects its schedule without Groups or session detail badges', () => {
  assert.deepEqual(getActivityConfig(ACTIVITY_PUBLIC_SKATE), {
    id: ACTIVITY_PUBLIC_SKATE,
    scheduleUrl: '/api/schedule?activity=public-skate',
    groupsEnabled: false,
    showSessionDetails: false,
  });
});

test('an unknown page activity fails instead of silently loading the wrong schedule', () => {
  assert.throws(
    () => getActivityConfig('figure-skating'),
    /Unsupported schedule activity: figure-skating/,
  );
});
