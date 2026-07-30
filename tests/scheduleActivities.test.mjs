// Run with: node --test tests/scheduleActivities.test.mjs   (Node >= 18)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_STICK_AND_PUCK,
  DAYSMART_DROP_IN_LABELS,
  DAYSMART_EXCLUDED_DROP_IN_LABELS,
  EVERETT_DROP_IN_LABELS,
  RECTIMES_DROP_IN_LABELS,
  activitySet,
  classifyDaySmartActivity,
  classifyEverettActivity,
  classifyRecTimesActivity,
} from '../lib/activities.js';
import { normalizeDaySmartEvents } from '../lib/scrapers/daysmart.js';
import { normalizeRecTimesBookings } from '../lib/scrapers/rectimes.js';
import { normalizeEverettData } from '../lib/scrapers/everett.js';
import { parseIcal } from '../lib/scrapers/kentvalley.js';
import { mkSessionKey } from '../stick-and-puck/modules/utils.js';

const ALL_ACTIVITIES = [
  ACTIVITY_STICK_AND_PUCK,
  ACTIVITY_DROP_IN_HOCKEY,
];

const fixture = name => JSON.parse(readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
));

test('source classifiers use reviewed exact Drop-in Hockey labels', () => {
  assert.equal(classifyDaySmartActivity({
    company: 'kraken',
    leagueName: 'Drop-In',
    eventText: 'Drop-in Hockey at KCI!',
  }), ACTIVITY_DROP_IN_HOCKEY);
  assert.equal(classifyDaySmartActivity({
    company: 'snoking',
    leagueName: 'Adult Learn to Play 3v3 Drop-In',
    eventText: 'Learn to play',
  }), ACTIVITY_DROP_IN_HOCKEY);
  assert.equal(classifyDaySmartActivity({
    company: 'snoking',
    leagueName: "Rocco's Drop-In (Invite Only)",
    eventText: "Rocco's private drop-in",
  }), null);
  assert.equal(classifyDaySmartActivity({
    company: 'snoking',
    leagueName: 'Figure Skating Drop-In',
    eventText: 'Figure Skating Drop-In',
  }), null);
  assert.equal(classifyDaySmartActivity({
    company: 'snoking',
    leagueName: null,
    eventText: 'Stick N Puck',
  }), ACTIVITY_STICK_AND_PUCK);

  assert.equal(classifyRecTimesActivity(1145, 'OVA Lunch Hockey'), ACTIVITY_DROP_IN_HOCKEY);
  assert.equal(classifyRecTimesActivity(1145, 'Figure Skating Session (OVA Drop in)'), null);
  assert.equal(classifyEverettActivity('Drop in - Pay At Desk'), ACTIVITY_DROP_IN_HOCKEY);
  assert.equal(classifyEverettActivity('Private Drop in - Pay At Desk'), null);

  for (const [company, labels] of Object.entries(DAYSMART_DROP_IN_LABELS)) {
    for (const leagueName of labels) {
      assert.equal(
        classifyDaySmartActivity({ company, leagueName, eventText: leagueName }),
        ACTIVITY_DROP_IN_HOCKEY,
        `${company}:${leagueName} should be included`,
      );
    }
  }
  for (const [company, labels] of Object.entries(DAYSMART_EXCLUDED_DROP_IN_LABELS)) {
    for (const leagueName of labels) {
      assert.equal(
        classifyDaySmartActivity({
          company,
          leagueName,
          eventText: `${leagueName} hockey`,
        }),
        null,
        `${company}:${leagueName} should be excluded`,
      );
    }
  }
  for (const [venueId, labels] of Object.entries(RECTIMES_DROP_IN_LABELS)) {
    for (const groupName of labels) {
      assert.equal(
        classifyRecTimesActivity(Number(venueId), groupName),
        ACTIVITY_DROP_IN_HOCKEY,
      );
    }
  }
  for (const title of EVERETT_DROP_IN_LABELS) {
    assert.equal(classifyEverettActivity(title), ACTIVITY_DROP_IN_HOCKEY);
  }
});

test('an explicit empty activity selection opts out of every activity', () => {
  assert.equal(activitySet([]).size, 0);
});

test('DaySmart defaults to Stick & Puck and preserves its existing core fields', () => {
  const data = fixture('daysmart-activities.json');
  const sessions = normalizeDaySmartEvents(data);

  assert.equal(sessions.length, 1);
  assert.deepEqual({
    id: sessions[0].id,
    start: sessions[0].start,
    end: sessions[0].end,
    title: sessions[0].title,
    subtitle: sessions[0].subtitle,
    spots: sessions[0].spots,
    price: sessions[0].price,
    soldOut: sessions[0].soldOut,
    bookUrl: sessions[0].bookUrl,
  }, {
    id: 'stick-1',
    start: '2026-08-01T10:00:00',
    end: '2026-08-01T11:00:00',
    title: 'Stick & Puck — Renton Rink',
    subtitle: null,
    spots: null,
    price: null,
    soldOut: false,
    bookUrl: 'https://apps.daysmartrecreation.com/dash/x/#/online/snoking/event-registration?date=2026-08-01',
  });
  assert.equal(sessions[0].activity, ACTIVITY_STICK_AND_PUCK);
});

test('DaySmart combines only a genuine same-league skater/goalie pair', () => {
  const data = fixture('daysmart-activities.json');
  const sessions = normalizeDaySmartEvents({ ...data, activities: ALL_ACTIVITIES });
  const women = sessions.find(s => s.sourceLabel === "Women's Drop-In");

  assert.ok(women);
  assert.deepEqual(women.sourceIds, ['women-goalie', 'women-skater']);
  assert.deepEqual(women.registration.roles, {
    skater: { capacity: 18 },
    goalie: { capacity: 2 },
  });
  assert.match(women.id, /^daysmart-snoking-3254-13-/);
});

test('DaySmart does not merge unrelated leagues sharing a resource and start', () => {
  const data = fixture('daysmart-activities.json');
  const sessions = normalizeDaySmartEvents({ ...data, activities: ALL_ACTIVITIES });
  const collision = sessions.filter(s => s.start === '2026-08-02T09:20:00');

  assert.equal(collision.length, 2);
  assert.deepEqual(
    collision.map(s => s.sourceLabel).sort(),
    ['Adult Weekend Drop-In', 'SKAHL Beginner Drop-In'],
  );
  assert.ok(collision.every(s => !s.sourceIds));
});

test('DaySmart fails safe when skater and goalie base descriptions drift', () => {
  const data = fixture('daysmart-activities.json');
  const goalie = data.events.find(event => event.id === 'women-goalie');
  goalie.attributes.desc = "Goalie - Women's Drop-In (special)";

  const sessions = normalizeDaySmartEvents({ ...data, activities: ALL_ACTIVITIES });
  const women = sessions.filter(s => s.sourceLabel === "Women's Drop-In");

  assert.equal(women.length, 2);
  assert.ok(women.every(s => !s.sourceIds));
});

test('DaySmart includes approved beginner/LTP sessions and excludes private and figure sessions', () => {
  const data = fixture('daysmart-activities.json');
  const sessions = normalizeDaySmartEvents({ ...data, activities: ALL_ACTIVITIES });
  const labels = sessions.map(s => s.sourceLabel);

  assert.ok(labels.includes('Adult Learn to Play 3v3 Drop-In'));
  assert.ok(!labels.includes("Rocco's Drop-In (Invite Only)"));
  assert.ok(!labels.includes('Figure Skating Drop-In'));
});

test('RecTimes defaults to Stick & Puck and supports exact Drop-in Hockey opt-in', () => {
  const bookings = fixture('rectimes-activities.json');
  const defaults = normalizeRecTimesBookings(bookings, {
    venueId: 1145,
    pacificNow: '2026-01-01T00:00:00',
  });
  assert.deepEqual(defaults.map(s => s.sourceLabel), ['Stick & Puck']);

  const all = normalizeRecTimesBookings(bookings, {
    venueId: 1145,
    activities: ALL_ACTIVITIES,
    pacificNow: '2026-01-01T00:00:00',
  });
  assert.deepEqual(
    all.map(s => s.sourceLabel),
    ['Stick & Puck', 'OVA Lunch Hockey', 'OVA Lunch Hockey'],
  );
  assert.equal(
    all[2].id,
    'rectimes|1145|2026-08-02T12:00:00|2026-08-02T13:15:00|OVA Lunch Hockey',
  );
  assert.ok(!all.some(s => s.sourceLabel.includes('Figure Skating')));
});

test('Everett defaults to Stick & Puck and includes only reviewed Community Rink drop-in labels', () => {
  const data = fixture('everett-activities.json');
  assert.deepEqual(
    normalizeEverettData(data).map(s => s.sourceLabel),
    ['Stick & Puck (LR 1 & 3)'],
  );

  const all = normalizeEverettData(data, { activities: ALL_ACTIVITIES });
  assert.deepEqual(
    all.map(s => s.sourceLabel),
    ['Stick & Puck (LR 1 & 3)', 'Drop in - Pay At Desk (LR 1 & 3)'],
  );
  const dropIn = all[1];
  assert.equal(dropIn.registration.method, 'pay-at-desk');
  assert.match(dropIn.subtitle, /Eligibility details not published/);
});

test('Kent Valley remains Stick & Puck-only but emits an explicit activity', () => {
  const ical = readFileSync(
    new URL('./fixtures/kentvalley-stick-and-puck.ics', import.meta.url),
    'utf8',
  );
  const result = parseIcal(ical, { now: new Date('2026-07-30T12:00:00Z') });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, 'kent-stick-1@example.com');
  assert.equal(result.sessions[0].activity, ACTIVITY_STICK_AND_PUCK);
});

test('RSVP keys remain legacy-compatible for Stick & Puck and qualify Drop-in Hockey', () => {
  const start = new Date(2026, 7, 1, 19, 30);
  const base = mkSessionKey({ rinkKey: 'kci', start });
  const explicitStick = mkSessionKey({
    rinkKey: 'kci',
    start,
    activity: ACTIVITY_STICK_AND_PUCK,
  });
  const dropIn = mkSessionKey({
    rinkKey: 'kci',
    start,
    activity: ACTIVITY_DROP_IN_HOCKEY,
  });

  assert.equal(explicitStick, base);
  assert.equal(dropIn, `${base}|drop-in-hockey`);
});
