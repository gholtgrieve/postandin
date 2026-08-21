const ACTIVITY_NAMES = Object.freeze({
  'stick-and-puck': 'Stick & Puck',
  'drop-in-hockey': 'Drop-in Hockey',
  'public-skate': 'Public Skate',
});

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function formatIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const folded = [];
  let chunk = '';
  let limit = 75;

  for (const character of line) {
    if (encoder.encode(chunk + character).length > limit) {
      folded.push(chunk);
      chunk = ` ${character}`;
      limit = 75;
    } else {
      chunk += character;
    }
  }
  folded.push(chunk);
  return folded.join('\r\n');
}

function eventUid(session, activityId) {
  const identity = [
    activityId,
    session.rinkKey,
    session.sheetKey ?? session.sheet ?? '',
    session.start.toISOString(),
    session.end.toISOString(),
  ].join('|');
  let hash = 2166136261;
  for (let i = 0; i < identity.length; i += 1) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}@postandin.com`;
}

export function hasExactCalendarTimes(session) {
  return session.start instanceof Date && !Number.isNaN(session.start.valueOf()) &&
    session.end instanceof Date && !Number.isNaN(session.end.valueOf());
}

export function buildCalendarEvent(session, activityId, createdAt = new Date()) {
  if (!hasExactCalendarTimes(session)) {
    throw new TypeError('Calendar events require valid start and end times.');
  }

  const activityName = ACTIVITY_NAMES[activityId] ?? activityId;
  const location = [session.rink?.name, session.calendarLocation ?? session.rink?.city]
    .filter(Boolean).join(', ');
  const sourceUrl = /^https?:\/\//i.test(session.bookUrl ?? '') ? session.bookUrl : '';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Post & In//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${eventUid(session, activityId)}`,
    `DTSTAMP:${formatIcsDate(createdAt)}`,
    `DTSTART:${formatIcsDate(session.start)}`,
    `DTEND:${formatIcsDate(session.end)}`,
    `SUMMARY:${escapeIcsText(activityName)}`,
    `LOCATION:${escapeIcsText(location)}`,
  ];

  if (sourceUrl) {
    lines.push(`DESCRIPTION:${escapeIcsText(`Original source: ${sourceUrl}`)}`);
    lines.push(`URL:${sourceUrl}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR', '');
  return lines.map(foldIcsLine).join('\r\n');
}

export function downloadCalendarEvent(session, activityId) {
  const contents = buildCalendarEvent(session, activityId);
  const blobUrl = URL.createObjectURL(new Blob([contents], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  const date = session.start.toLocaleDateString('en-CA');
  link.href = blobUrl;
  link.download = `${activityId}-${date}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

export const CALENDAR_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="1"/><path d="M8 3v4M16 3v4M3 10h18M12 13v5M9.5 15.5h5"/></svg>`;
