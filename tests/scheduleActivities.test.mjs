// Run with: node --test tests/scheduleActivities.test.mjs   (Node >= 18)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
  ACTIVITY_STICK_AND_PUCK,
  DAYSMART_DROP_IN_LABELS,
  DAYSMART_EXCLUDED_DROP_IN_LABELS,
  EVERETT_DROP_IN_LABELS,
  EVERETT_PUBLIC_SKATE_LABELS,
  RECTIMES_DROP_IN_LABELS,
  RECTIMES_PUBLIC_SKATE_LABELS,
  activitySet,
  classifyDaySmartActivity,
  classifyEverettActivity,
  classifyRecTimesActivity,
} from '../lib/activities.js';
import {
  includedTeamMap,
  normalizeDaySmartEvents,
  scrapeDaySmart,
} from '../lib/scrapers/daysmart.js';
import { normalizeRecTimesBookings } from '../lib/scrapers/rectimes.js';
import { normalizeEverettData } from '../lib/scrapers/everett.js';
import {
  ICAL_URLS,
  parseIcal,
  scrapeKentValley,
} from '../lib/scrapers/kentvalley.js';
import {
  isFemaleOrNonBinarySession,
  mkSessionKey,
  sessionLocationLabel,
} from '../stick-and-puck/modules/utils.js';

const ALL_ACTIVITIES = [
  ACTIVITY_STICK_AND_PUCK,
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
];

const fixture = name => JSON.parse(readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
));

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

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
  assert.equal(classifyRecTimesActivity(1146, 'Public Skate'), ACTIVITY_PUBLIC_SKATE);
  assert.equal(classifyRecTimesActivity(1145, 'Adult Skate'), null);
  assert.equal(classifyRecTimesActivity(1145, 'Friday Night Skates'), null);
  assert.equal(classifyRecTimesActivity(1145, '3sneaks Womens Clinic'), null);
  assert.equal(classifyEverettActivity('Drop in - Pay At Desk'), ACTIVITY_DROP_IN_HOCKEY);
  assert.equal(classifyEverettActivity('Private Drop in - Pay At Desk'), null);
  assert.equal(classifyEverettActivity('Public Session'), ACTIVITY_PUBLIC_SKATE);
  assert.equal(classifyEverettActivity('👪 Public Skate Session'), ACTIVITY_PUBLIC_SKATE);
  assert.equal(classifyEverettActivity('Public Skate Session'), null);

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
  for (const [venueId, labels] of Object.entries(RECTIMES_PUBLIC_SKATE_LABELS)) {
    for (const groupName of labels) {
      assert.equal(
        classifyRecTimesActivity(Number(venueId), groupName),
        ACTIVITY_PUBLIC_SKATE,
      );
    }
  }
  for (const title of EVERETT_PUBLIC_SKATE_LABELS) {
    assert.equal(classifyEverettActivity(title), ACTIVITY_PUBLIC_SKATE);
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

test('DaySmart normalizes authoritative Public Skate feeds without title matching', () => {
  const base = {
    company: 'snoking',
    resourceIds: [1],
    resourceMap: { 1: 'Kirkland Ice Arena' },
    leagueMap: { 999: 'Family Public Skate' },
    activities: [ACTIVITY_PUBLIC_SKATE],
    sourceActivity: ACTIVITY_PUBLIC_SKATE,
  };
  const sessions = normalizeDaySmartEvents({
    ...base,
    events: [{
      id: 'public-1',
      attributes: {
        event_type_id: '12',
        resource_id: 1,
        league_id: 999,
        desc: 'Special Holiday Session',
        start: '2026-08-15T13:00:00',
        end: '2026-08-15T14:30:00',
        register_capacity: 350,
      },
    }],
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].activity, ACTIVITY_PUBLIC_SKATE);
  assert.equal(sessions[0].title, 'Public Skate');
  assert.equal(sessions[0].sourceLabel, 'Family Public Skate');
  assert.equal(sessions[0].subtitle, null);
  assert.equal(sessions[0].registration.capacity, 350);
});

test('DaySmart requests Kraken and Sno-King Public Skate using source-specific filters', async () => {
  for (const [company, expectedFilter] of [
    ['kraken', 'filter[homeTeam.sport_id__in]=30'],
    ['snoking', 'filter[event_type_id]=12'],
  ]) {
    const urls = [];
    const result = await scrapeDaySmart(
      { company, sportId: 20 },
      {
        activities: [ACTIVITY_PUBLIC_SKATE],
        fetchImpl: async url => {
          urls.push(url);
          return jsonResponse(url.includes('/events?') ? { data: [] } : { data: [] });
        },
      },
    );

    assert.deepEqual(result, {
      sessions: [],
      attempted: [ACTIVITY_PUBLIC_SKATE],
      failures: [],
    });
    assert.ok(urls.some(url => url.includes(expectedFilter)), `${company} should use ${expectedFilter}`);
    assert.ok(!urls.some(url => url.includes('sport_id__in]=20')));
  }
});

test('DaySmart preserves fresh hockey data when its Public Skate feed fails', async () => {
  const result = await scrapeDaySmart(
    { company: 'kraken', sportId: 20 },
    {
      activities: ALL_ACTIVITIES,
      fetchImpl: async url => {
        if (url.includes('sport_id__in]=30')) return jsonResponse({}, 503);
        if (url.includes('/resources?')) {
          return jsonResponse({ data: [{ id: '2', attributes: { name: 'Smartsheet Rink 2' } }] });
        }
        if (url.includes('/events?')) {
          return jsonResponse({
            data: [{
              id: 'stick-live',
              attributes: {
                event_type_id: 'k',
                resource_id: 2,
                league_id: null,
                desc: 'Stick & Puck',
                start: '2026-08-15T10:00:00',
                end: '2026-08-15T11:00:00',
              },
            }],
          });
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    },
  );

  assert.deepEqual(result.attempted, ALL_ACTIVITIES);
  assert.deepEqual(result.failures, [ACTIVITY_PUBLIC_SKATE]);
  assert.deepEqual(result.sessions.map(session => session.activity), [ACTIVITY_STICK_AND_PUCK]);
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
  assert.equal(women.eligibility.ageMin, 18);
  assert.match(women.id, /^daysmart-snoking-3254-13-/);
});

test('DaySmart uses published team names to combine roleless Kraken registrations', () => {
  assert.deepEqual(includedTeamMap(null), {});
  const teamMap = includedTeamMap([
    { type: 'teams', id: '13096', attributes: { name: 'Drop-In Skater' } },
    { type: 'teams', id: '13095', attributes: { name: 'Drop-in Goalie' } },
    { type: 'resources', id: '2', attributes: { name: 'Smartsheet Rink 2' } },
  ]);
  const sessions = normalizeDaySmartEvents({
    company: 'kraken',
    resourceIds: [2],
    resourceMap: { 2: 'Smartsheet Rink 2' },
    leagueMap: { 3012: 'Drop-In' },
    teamMap,
    activities: ALL_ACTIVITIES,
    events: [
      {
        id: 'kraken-skater',
        attributes: {
          event_type_id: 'k',
          resource_id: 2,
          league_id: 3012,
          hteam_id: 13096,
          desc: '',
          best_description: 'Drop-in Hockey at KCI!',
          start: '2026-08-14T12:00:00',
          end: '2026-08-14T13:15:00',
          register_capacity: 20,
        },
      },
      {
        id: 'kraken-goalie',
        attributes: {
          event_type_id: 'k',
          resource_id: 2,
          league_id: 3012,
          hteam_id: 13095,
          desc: '',
          best_description: 'Drop-in Hockey at KCI!',
          start: '2026-08-14T12:00:00',
          end: '2026-08-14T13:15:00',
          register_capacity: 2,
        },
      },
    ],
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].subtitle, 'Adult 18+');
  assert.deepEqual(sessions[0].eligibility, {
    ageMin: 18,
    ageMax: null,
    audience: 'adult',
    skill: null,
    notes: null,
  });
  assert.deepEqual(sessions[0].registration.roles, {
    skater: { capacity: 20 },
    goalie: { capacity: 2 },
  });
  assert.deepEqual(sessions[0].sourceIds, ['kraken-goalie', 'kraken-skater']);
});

test('DaySmart never applies a Drop-in team role to Stick & Puck', () => {
  const sessions = normalizeDaySmartEvents({
    company: 'kraken',
    resourceIds: [2],
    resourceMap: { 2: 'Smartsheet Rink 2' },
    leagueMap: {},
    teamMap: { 13096: 'Drop-In Skater' },
    events: [{
      id: 'stick-with-colliding-team-id',
      attributes: {
        event_type_id: 'k',
        resource_id: 2,
        league_id: null,
        hteam_id: 13096,
        desc: 'Stick & Puck',
        start: '2026-08-14T14:00:00',
        end: '2026-08-14T15:15:00',
        register_capacity: 24,
      },
    }],
  });

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].activity, ACTIVITY_STICK_AND_PUCK);
  assert.equal(sessions[0].registration.capacity, 24);
  assert.deepEqual(sessions[0].registration.roles, {});
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

test('RecTimes normalizes the reviewed Female Stick & Puck label at either venue', () => {
  const booking = {
    id: 8347379,
    groupName: 'Female Stick & Puck',
    startTimeLocal: '2026-08-28T18:45:00',
    endTimeLocal: '2026-08-28T19:50:00',
  };

  for (const venueId of [1145, 1146]) {
    const [session] = normalizeRecTimesBookings([booking], {
      venueId,
      pacificNow: '2026-01-01T00:00:00',
    });
    assert.equal(session.subtitle, 'Female only');
    assert.equal(session.eligibility.audience, 'female');
    assert.equal(isFemaleOrNonBinarySession(session), true);
  }
});

test('Female/Non-Binary filtering supports structured and legacy cached sessions', () => {
  assert.equal(isFemaleOrNonBinarySession({
    eligibility: { audience: 'women' },
    title: 'Drop-In Hockey',
  }), true);
  assert.equal(isFemaleOrNonBinarySession({
    eligibility: { audience: null },
    title: 'Female Stick & Puck',
    sourceLabel: 'Female Stick & Puck',
    subtitle: null,
  }), true);
  assert.equal(isFemaleOrNonBinarySession({
    eligibility: { audience: null },
    title: 'Stick & Puck',
    sourceLabel: 'Stick & Puck',
    subtitle: null,
  }), false);
});

test('RecTimes includes only Lynnwood general Public Skate sessions', () => {
  const bookings = [
    {
      id: 3001,
      groupName: 'Public Skate',
      startTimeLocal: '2026-08-01T10:00:00',
      endTimeLocal: '2026-08-01T11:30:00',
    },
    {
      id: 3002,
      groupName: 'Adult Skate',
      startTimeLocal: '2026-08-01T12:00:00',
      endTimeLocal: '2026-08-01T13:00:00',
    },
    {
      id: 3003,
      groupName: 'Friday Night Skates',
      startTimeLocal: '2026-08-01T19:00:00',
      endTimeLocal: '2026-08-01T21:00:00',
    },
  ];

  const lynnwood = normalizeRecTimesBookings(bookings, {
    venueId: 1146,
    activities: [ACTIVITY_PUBLIC_SKATE],
    pacificNow: '2026-01-01T00:00:00',
  });
  assert.equal(lynnwood.length, 1);
  assert.equal(lynnwood[0].title, 'Public Skate');
  assert.equal(lynnwood[0].subtitle, null);
  assert.equal(lynnwood[0].activity, ACTIVITY_PUBLIC_SKATE);
  assert.equal(
    lynnwood[0].bookUrl,
    'https://fareharbor.com/embeds/book/lynnwoodicecenter/items/245312/',
  );

  assert.deepEqual(normalizeRecTimesBookings(bookings, {
    venueId: 1145,
    activities: [ACTIVITY_PUBLIC_SKATE],
    pacificNow: '2026-01-01T00:00:00',
  }), []);
});

test('Everett includes reviewed activities from both ice sheets and preserves sheet identity', () => {
  const data = fixture('everett-activities.json');
  assert.deepEqual(
    normalizeEverettData(data).map(s => s.sourceLabel),
    ['Stick & Puck (LR 1 & 3)', 'Stick & Puck (LR 1 & 3)'],
  );

  const all = normalizeEverettData(data, { activities: ALL_ACTIVITIES });
  assert.deepEqual(
    all.map(s => s.sourceLabel),
    [
      'Stick & Puck (LR 1 & 3)',
      'Stick & Puck (LR 1 & 3)',
      'Drop in - Pay At Desk (LR 1 & 3)',
      'Drop in - Pay At Desk',
      'Drop in - Pay At Desk (LR 2 & 4)',
      'Public Session',
      'Public Skating',
      '👪 Public Skate Session',
      '👪 Public Skate Session',
    ],
  );
  const dropIn = all.find(session => session.id === 'everett-2002');
  assert.equal(dropIn.registration.method, 'pay-at-desk');
  assert.match(dropIn.subtitle, /Eligibility details not published/);
  const publicSkate = all.filter(session => session.activity === ACTIVITY_PUBLIC_SKATE);
  assert.equal(publicSkate.length, 4);
  assert.ok(publicSkate.every(session => session.title === 'Public Skate'));
  assert.ok(publicSkate.every(session => session.subtitle === null));
  assert.ok(publicSkate.every(session => session.bookUrl.includes('schedule.bondsports.co')));
  const confirmedPublicSkate = all.filter(session =>
    session.sourceLabel === '👪 Public Skate Session'
  );
  assert.equal(confirmedPublicSkate.length, 2);
  assert.deepEqual(
    confirmedPublicSkate.map(session => session.sheet).sort(),
    ['Community Rink', 'Main Rink'],
  );
  assert.ok(confirmedPublicSkate.every(session => session.activity === ACTIVITY_PUBLIC_SKATE));
  assert.ok(!all.some(session =>
    session.sourceLabel === '👪 Public Skate Session' &&
    session.activity === ACTIVITY_DROP_IN_HOCKEY
  ));
  assert.ok(!all.some(session => session.id === 'everett-2008'));
  assert.ok(!all.some(session => session.id === 'everett-2010'));

  const simultaneousStick = all.filter(session =>
    session.activity === ACTIVITY_STICK_AND_PUCK && session.start === '2026-08-01T10:00:00'
  );
  assert.equal(simultaneousStick.length, 2);
  assert.deepEqual(
    simultaneousStick.map(session => session.sheet).sort(),
    ['Community Rink', 'Main Rink'],
  );
  assert.deepEqual(
    Object.fromEntries(simultaneousStick.map(session => [session.sheet, session.sheetKey])),
    { 'Community Rink': null, 'Main Rink': 'main-rink' },
  );
  assert.equal(new Set(simultaneousStick.map(session => session.id)).size, 2);

  const mainDropIn = all.find(session => session.id === 'everett-2004');
  assert.equal(mainDropIn.activity, ACTIVITY_DROP_IN_HOCKEY);
  assert.equal(mainDropIn.sheet, 'Main Rink');
});

test('Kent Valley defaults to Stick & Puck and emits an explicit activity', () => {
  const ical = readFileSync(
    new URL('./fixtures/kentvalley-stick-and-puck.ics', import.meta.url),
    'utf8',
  );
  const result = parseIcal(ical, { now: new Date('2026-07-30T12:00:00Z') });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, 'kent-stick-1@example.com');
  assert.equal(result.sessions[0].activity, ACTIVITY_STICK_AND_PUCK);
});

test('Kent Valley parses Public Skate from its separate calendar', () => {
  const ical = readFileSync(
    new URL('./fixtures/kentvalley-public-skate.ics', import.meta.url),
    'utf8',
  );
  const result = parseIcal(ical, {
    activity: ACTIVITY_PUBLIC_SKATE,
    now: new Date('2026-08-01T12:00:00Z'),
  });

  assert.deepEqual(result.sessions.map(session => ({
    id: session.id,
    start: session.start,
    end: session.end,
    activity: session.activity,
    title: session.title,
    subtitle: session.subtitle,
  })), [
    {
      id: 'kent-public-recurring@example.com:2026-08-03T10:00:00',
      start: '2026-08-03T10:00:00',
      end: '2026-08-03T12:00:00',
      activity: ACTIVITY_PUBLIC_SKATE,
      title: 'Public Skate',
      subtitle: null,
    },
    {
      id: 'kent-public-blacklight@example.com',
      start: '2026-08-08T16:30:00',
      end: '2026-08-08T17:45:00',
      activity: ACTIVITY_PUBLIC_SKATE,
      title: 'Public Skate',
      subtitle: null,
    },
    {
      id: 'kent-public-recurring@example.com:2026-08-10T10:00:00',
      start: '2026-08-10T10:45:00',
      end: '2026-08-10T12:00:00',
      activity: ACTIVITY_PUBLIC_SKATE,
      title: 'Public Skate',
      subtitle: null,
    },
    {
      id: 'kent-public-recurring@example.com:2026-08-17T10:00:00',
      start: '2026-08-17T10:00:00',
      end: '2026-08-17T12:00:00',
      activity: ACTIVITY_PUBLIC_SKATE,
      title: 'Public Skate',
      subtitle: null,
    },
  ]);
  assert.equal(result.rawEventCount, 5);
  assert.ok(result.sessions.every(session => session.price === null));
  assert.ok(result.sessions.every(session => session.registration.method === null));
});

test('Kent Valley rejects an unsupported calendar activity', () => {
  assert.throws(
    () => parseIcal('BEGIN:VCALENDAR\nEND:VCALENDAR', { activity: 'private-skate' }),
    /Unsupported Kent Valley activity/,
  );
});

test('Kent Valley fetches only the requested activity calendars', async () => {
  const stickIcal = readFileSync(
    new URL('./fixtures/kentvalley-stick-and-puck.ics', import.meta.url),
    'utf8',
  );
  const publicIcal = readFileSync(
    new URL('./fixtures/kentvalley-public-skate.ics', import.meta.url),
    'utf8',
  );
  const originalFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async url => {
    fetched.push(url);
    return new Response(
      url === ICAL_URLS[ACTIVITY_PUBLIC_SKATE] ? publicIcal : stickIcal,
    );
  };

  try {
    const publicOnly = await scrapeKentValley({
      activities: [ACTIVITY_PUBLIC_SKATE],
    });
    assert.deepEqual(fetched, [ICAL_URLS[ACTIVITY_PUBLIC_SKATE]]);
    assert.ok(publicOnly.sessions.every(
      session => session.activity === ACTIVITY_PUBLIC_SKATE,
    ));

    fetched.length = 0;
    await scrapeKentValley();
    assert.deepEqual(fetched, [ICAL_URLS[ACTIVITY_STICK_AND_PUCK]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Kent Valley preserves successful activity data when another calendar fails', async () => {
  const stickIcal = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:partial-success-stick@example.com
DTSTART:20260820T180000Z
DTEND:20260820T191500Z
RRULE:FREQ=WEEKLY
SUMMARY:Stick & Puck
END:VEVENT
END:VCALENDAR`;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = async url => {
    if (url === ICAL_URLS[ACTIVITY_PUBLIC_SKATE]) {
      throw new Error('Public Skate unavailable');
    }
    return new Response(stickIcal);
  };
  console.error = () => {};

  try {
    const result = await scrapeKentValley({ activities: ALL_ACTIVITIES });
    assert.deepEqual(result.attempted, [
      ACTIVITY_STICK_AND_PUCK,
      ACTIVITY_PUBLIC_SKATE,
    ]);
    assert.deepEqual(result.failures, [ACTIVITY_PUBLIC_SKATE]);
    assert.ok(result.sessions.length > 0);
    assert.ok(result.sessions.every(
      session => session.activity === ACTIVITY_STICK_AND_PUCK,
    ));
    assert.ok(result.sessions.every(
      session => /^partial-success-stick@example\.com:/.test(session.id),
    ));
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test('Kent Valley cancelled overrides suppress their recurring occurrence', () => {
  const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20260803T100000
DTEND;TZID=America/Los_Angeles:20260803T120000
RRULE:FREQ=WEEKLY;COUNT=3
UID:cancelled-series@example.com
SUMMARY:Public Skating
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20260810T100000
DTEND;TZID=America/Los_Angeles:20260810T120000
RECURRENCE-ID;TZID=America/Los_Angeles:20260810T100000
UID:cancelled-series@example.com
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;
  const result = parseIcal(ical, {
    activity: ACTIVITY_PUBLIC_SKATE,
    now: new Date('2026-08-01T12:00:00Z'),
  });

  assert.deepEqual(result.sessions.map(session => session.start), [
    '2026-08-03T10:00:00',
    '2026-08-17T10:00:00',
  ]);
});

test('Kent Valley preserves wall time across DST and applies EXDATE', () => {
  const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20261025T100000
DTEND;TZID=America/Los_Angeles:20261025T120000
RRULE:FREQ=WEEKLY;COUNT=3
EXDATE;TZID=America/Los_Angeles:20261101T100000
UID:dst-series@example.com
SUMMARY:Public Skating
END:VEVENT
END:VCALENDAR`;
  const result = parseIcal(ical, {
    activity: ACTIVITY_PUBLIC_SKATE,
    now: new Date('2026-10-20T12:00:00Z'),
  });

  assert.deepEqual(result.sessions.map(session => session.start), [
    '2026-10-25T10:00:00',
    '2026-11-08T10:00:00',
  ]);
});

test('Kent Valley orphan override IDs remain stable as the horizon advances', () => {
  const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20260907T100000
DTEND;TZID=America/Los_Angeles:20260907T120000
RRULE:FREQ=WEEKLY;COUNT=2
UID:moved-series@example.com
SUMMARY:Public Skating
END:VEVENT
BEGIN:VEVENT
DTSTART;TZID=America/Los_Angeles:20260828T100000
DTEND;TZID=America/Los_Angeles:20260828T120000
RECURRENCE-ID;TZID=America/Los_Angeles:20260907T100000
UID:moved-series@example.com
SUMMARY:Public Skating
END:VEVENT
END:VCALENDAR`;
  const parseAt = now => parseIcal(ical, {
    activity: ACTIVITY_PUBLIC_SKATE,
    now: new Date(now),
  }).sessions.find(session => session.start === '2026-08-28T10:00:00');

  const initiallyOrphaned = parseAt('2026-08-01T12:00:00Z');
  const laterMatched = parseAt('2026-08-15T12:00:00Z');
  assert.ok(initiallyOrphaned);
  assert.ok(laterMatched);
  assert.equal(initiallyOrphaned.id, 'moved-series@example.com:2026-09-07T10:00:00');
  assert.equal(laterMatched.id, initiallyOrphaned.id);
});

test('RSVP keys remain legacy-compatible for Stick & Puck and qualify other activities', () => {
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
  const publicSkate = mkSessionKey({
    rinkKey: 'kci',
    start,
    activity: ACTIVITY_PUBLIC_SKATE,
  });

  assert.equal(explicitStick, base);
  assert.equal(dropIn, `${base}|drop-in-hockey`);
  assert.equal(publicSkate, `${base}|public-skate`);
  assert.notEqual(publicSkate, dropIn);
});

test('RSVP keys distinguish a second ice sheet without changing legacy sheet keys', () => {
  const start = new Date(2026, 7, 1, 19, 30);
  const community = mkSessionKey({ rinkKey: 'everett', start, sheetKey: null });
  const main = mkSessionKey({ rinkKey: 'everett', start, sheetKey: 'main-rink' });
  const mainDropIn = mkSessionKey({
    rinkKey: 'everett',
    start,
    sheetKey: 'main-rink',
    activity: ACTIVITY_DROP_IN_HOCKEY,
  });

  assert.equal(community, 'everett|2026-08-01|19:30');
  assert.equal(main, `${community}|main-rink`);
  assert.equal(mainDropIn, `${community}|main-rink|drop-in-hockey`);
});

test('Everett display labels identify the city and source sheet', () => {
  const rink = { name: 'Angel Of The Winds Arena', city: 'Everett' };
  assert.equal(
    sessionLocationLabel({ rink, sheet: 'Community Rink', sheetKey: null }),
    'Everett · Community Rink',
  );
  assert.equal(
    sessionLocationLabel({ rink, sheet: 'Main Rink', sheetKey: 'main-rink' }),
    'Everett · Main Rink',
  );
  assert.equal(sessionLocationLabel({ rink: { city: 'Seattle' } }), 'Seattle');
});
