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
    showDuration: true,
    showSessionSubtitles: true,
  });
});

test('Drop-in Hockey selects the activity-specific schedule API', () => {
  assert.deepEqual(getActivityConfig(ACTIVITY_DROP_IN_HOCKEY), {
    id: ACTIVITY_DROP_IN_HOCKEY,
    scheduleUrl: '/api/schedule?activity=drop-in-hockey',
    groupsEnabled: true,
    showDuration: true,
    showSessionSubtitles: true,
  });
});

test('Public Skate enables Groups and duration without hockey program subtitles', () => {
  assert.deepEqual(getActivityConfig(ACTIVITY_PUBLIC_SKATE), {
    id: ACTIVITY_PUBLIC_SKATE,
    scheduleUrl: '/api/schedule?activity=public-skate',
    groupsEnabled: true,
    showDuration: true,
    showSessionSubtitles: false,
  });
});

test('an unknown page activity fails instead of silently loading the wrong schedule', () => {
  assert.throws(
    () => getActivityConfig('figure-skating'),
    /Unsupported schedule activity: figure-skating/,
  );
});
