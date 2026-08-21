import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCalendarEvent, downloadCalendarEvent, hasExactCalendarTimes
} from '../stick-and-puck/modules/calendar.js';

const session = {
  rinkKey: 'test-rink',
  rink: { name: 'Test, Ice; Centre', city: 'Seattle' },
  start: new Date('2026-08-22T19:30:00-07:00'),
  end: new Date('2026-08-22T21:00:00-07:00'),
  bookUrl: 'https://example.com/session?id=123',
};

test('calendar export includes exact UTC times, activity, location, and source', () => {
  const result = buildCalendarEvent(session, 'stick-and-puck', new Date('2026-08-21T12:00:00Z'));

  assert.match(result, /\r\nDTSTART:20260823T023000Z\r\n/);
  assert.match(result, /\r\nDTEND:20260823T040000Z\r\n/);
  assert.match(result, /\r\nSUMMARY:Stick & Puck\r\n/);
  assert.match(result, /\r\nLOCATION:Test\\, Ice\\; Centre\\, Seattle\r\n/);
  assert.match(result, /\r\nDESCRIPTION:Original source: https:\/\/example\.com\/session\?id=123\r\n/);
  assert.match(result, /\r\nURL:https:\/\/example\.com\/session\?id=123\r\n/);
  assert.match(result, /\r\nEND:VCALENDAR\r\n$/);
});

test('calendar export includes the activity-specific sheet location', () => {
  const result = buildCalendarEvent({ ...session, calendarLocation: 'Everett · Main Rink' }, 'public-skate');
  assert.match(result, /\r\nSUMMARY:Public Skate\r\n/);
  assert.match(result, /\r\nLOCATION:Test\\, Ice\\; Centre\\, Everett · Main Rink\r\n/);
});

test('calendar export omits a missing source URL', () => {
  const result = buildCalendarEvent({ ...session, bookUrl: null }, 'drop-in-hockey');
  assert.doesNotMatch(result, /\r\n(?:DESCRIPTION|URL):/);
});

test('calendar export rejects sessions without an exact end time', () => {
  assert.throws(
    () => buildCalendarEvent({ ...session, end: null }, 'stick-and-puck'),
    /valid start and end times/,
  );
});

test('calendar UID distinguishes simultaneous sessions on different sheets', () => {
  const first = buildCalendarEvent({ ...session, sheetKey: 'community-rink' }, 'public-skate');
  const second = buildCalendarEvent({ ...session, sheetKey: 'main-rink' }, 'public-skate');
  const uid = value => value.match(/\r\nUID:([^\r\n]+)/)?.[1];

  assert.notEqual(uid(first), uid(second));
});

test('calendar UID falls back to the source sheet label when sheetKey is absent', () => {
  const community = buildCalendarEvent({
    ...session,
    sheetKey: null,
    sheet: 'Community Rink',
  }, 'public-skate');
  const main = buildCalendarEvent({
    ...session,
    sheetKey: null,
    sheet: 'Main Rink',
  }, 'public-skate');
  const uid = value => value.match(/\r\nUID:([^\r\n]+)/)?.[1];

  assert.notEqual(uid(community), uid(main));
});

test('calendar eligibility requires valid exact start and end times', () => {
  assert.equal(hasExactCalendarTimes(session), true);
  assert.equal(hasExactCalendarTimes({ ...session, end: null }), false);
  assert.equal(hasExactCalendarTimes({ ...session, end: new Date('invalid') }), false);
  assert.equal(hasExactCalendarTimes({ ...session, start: new Date('invalid') }), false);
});

test('calendar export folds long content lines without splitting UTF-8 characters', () => {
  const longUrl = `https://example.com/${'registration/'.repeat(8)}session?id=123`;
  const result = buildCalendarEvent({
    ...session,
    calendarLocation: `Everett · ${'Main Rink '.repeat(8)}`,
    bookUrl: longUrl,
  }, 'public-skate');

  for (const line of result.split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line exceeds 75 octets: ${line}`);
  }
  const unfolded = result.replace(/\r\n /g, '');
  assert.match(unfolded, new RegExp(`URL:${longUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(unfolded, /Everett · Main Rink/);
});

test('download action creates and clicks a local .ics file link', async () => {
  const originalDocument = globalThis.document;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let clicked = false;
  let createdBlob;
  const link = { click: () => { clicked = true; } };

  globalThis.document = { createElement: () => link };
  URL.createObjectURL = blob => {
    createdBlob = blob;
    return 'blob:test-calendar';
  };
  URL.revokeObjectURL = () => {};

  try {
    downloadCalendarEvent(session, 'stick-and-puck');
    assert.equal(clicked, true);
    assert.equal(link.href, 'blob:test-calendar');
    assert.match(link.download, /^stick-and-puck-\d{4}-\d{2}-\d{2}\.ics$/);
    assert.equal(createdBlob.type, 'text/calendar;charset=utf-8');
    assert.match(await createdBlob.text(), /BEGIN:VCALENDAR/);
  } finally {
    globalThis.document = originalDocument;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  }
});
