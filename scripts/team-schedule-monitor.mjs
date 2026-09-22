import fs from 'node:fs/promises';

import { fingerprintTeamSchedule, selectTeamGames } from './check-nwahl-travel.mjs';

// The October Tri-Cities games are friendlies managed in SportsEngine, not NWAHL fixtures.
export const NON_NWAHL_TRIPS = new Set(['tri-cities-october']);

const SPORTSENGINE_URL = 'https://ical.sportngin.com/v3/calendar/ical?team_ids=11f14b0a-1f31-fa76-9f63-42f5b12328f2';
const NWAHL_URL = 'https://nwahl-portal.onrender.com/api/nwahl/public/schedule';
const TEAM_NAMES = new Set(['seattlejrmets', 'jrmets']);

function text(value = '') {
  return String(value).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();
}

function normalizedName(value) {
  return text(value).toLowerCase()
    .replace(/junior/g, 'jr')
    .replace(/\b16u\s*aa\b|\b16aa\b|\b16u\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isTeam(value) {
  return TEAM_NAMES.has(normalizedName(value));
}

function normalizedOpponent(value) {
  return normalizedName(value).replace(/^the/, '');
}

function normalizedVenue(rink, city) {
  const value = `${rink ?? ''} ${city ?? ''}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = [
    ['tacomatwinrinks', ['tacomatwin', '2645south80th']],
    ['sprinker', ['sprinker', '521militaryroadsouth']],
    ['olympicview', ['olympicview', '2220270th']],
    ['snoqualmie', ['snoqualmie', '35323southeastdouglas']],
    ['kirkland', ['kirkland', '14326124th']],
    ['renton', ['snokingrenton', '24009snokingway']],
    ['ewu', ['ewu', 'easternwashington', '5265thstreet']],
    ['toyotaarena', ['toyotaarena', '7000westgrandridge']],
    ['outpost', ['outpost', '9530tramway']],
    ['rrrink', ['rrrink', '1349center']],
    ['portlandcoliseum', ['veteransmemorialcoliseum', 'vmc', '1northcentercourt']],
  ];
  for (const [name, aliases] of known) if (aliases.some(alias => value.includes(alias))) return name;
  return null;
}

function normalizedCity(rink, city) {
  const explicit = text(city ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (explicit) return explicit;
  const addressCity = text(rink).match(/,\s*([^,]+),\s*[A-Z]{2}(?:\s|,|$)/)?.[1];
  return addressCity?.toLowerCase().replace(/[^a-z0-9]/g, '') || null;
}

function comparable(game) {
  const homeIsTeam = isTeam(game.home);
  const awayIsTeam = isTeam(game.away);
  return {
    date: game.date ?? null,
    time: game.time ?? null,
    opponent: normalizedOpponent(homeIsTeam ? game.away : game.home),
    venue: normalizedVenue(game.rink, game.city),
    city: normalizedCity(game.rink, game.city),
  };
}

function equivalent(a, b) {
  const left = comparable(a);
  const right = comparable(b);
  return left.date === right.date
    && left.time === right.time
    && left.opponent === right.opponent
    && (!left.venue || !right.venue || left.venue === right.venue)
    && (left.venue && right.venue || !left.city || !right.city || left.city === right.city);
}

function stableGames(games) {
  return [...games].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function changed(previous, current) {
  return JSON.stringify(stableGames(previous)) !== JSON.stringify(stableGames(current));
}

function related(a, b) {
  if (!a || !b) return false;
  const left = comparable(a);
  const right = comparable(b);
  return left.opponent === right.opponent && dateDistance(left.date, right.date) <= 3;
}

function gameChanges(previous, current) {
  const before = new Map(previous.map(game => [game.id, game]));
  const after = new Map(current.map(game => [game.id, game]));
  const changes = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const oldGame = before.get(id) ?? null;
    const newGame = after.get(id) ?? null;
    if (JSON.stringify(oldGame) !== JSON.stringify(newGame)) changes.push({ id, before: oldGame, after: newGame });
  }
  const removed = changes.filter(change => change.before && !change.after);
  const added = changes.filter(change => !change.before && change.after);
  const reconciled = new Set();
  for (const oldChange of removed) {
    const replacement = added.find(newChange => !reconciled.has(newChange) && equivalent(oldChange.before, newChange.after));
    if (replacement) {
      reconciled.add(oldChange);
      reconciled.add(replacement);
    }
  }
  return changes.filter(change => !reconciled.has(change));
}

function unmatchedCount(left, right) {
  const matchedLeftByRight = Array(right.length).fill(-1);
  function augment(leftIndex, visitedRight) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      if (visitedRight.has(rightIndex) || !equivalent(left[leftIndex], right[rightIndex])) continue;
      visitedRight.add(rightIndex);
      if (matchedLeftByRight[rightIndex] < 0
        || augment(matchedLeftByRight[rightIndex], visitedRight)) {
        matchedLeftByRight[rightIndex] = leftIndex;
        return true;
      }
    }
    return false;
  }
  let matches = 0;
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    if (augment(leftIndex, new Set())) matches += 1;
  }
  return left.length + right.length - (2 * matches);
}

function equivalentCount(game, games) {
  return games.filter(candidate => equivalent(game, candidate)).length;
}

function transitionCreatesMismatch(change, beforeOwn, afterOwn, beforeOther, afterOther, relevant = () => true) {
  const focus = [change.before, change.after].filter(Boolean);
  if (!focus.some(relevant)) return false;
  const inCohort = game => focus.some(candidate => related(game, candidate));

  if (!change.before) {
    return equivalentCount(change.after, afterOwn) > equivalentCount(change.after, afterOther);
  }

  if (!change.after) {
    const wasRepresented = equivalentCount(change.before, beforeOther) > 0;
    const relatedMismatchRemains = unmatchedCount(
      afterOwn.filter(inCohort),
      afterOther.filter(inCohort),
    ) > 0;
    return wasRepresented && relatedMismatchRemains;
  }

  const wasRepresented = equivalentCount(change.before, beforeOther) > 0;
  const surplusAfter = equivalentCount(change.after, afterOwn)
    - equivalentCount(change.after, afterOther);
  const surplusBefore = equivalentCount(change.after, beforeOwn)
    - equivalentCount(change.after, beforeOther);
  return wasRepresented && surplusAfter > Math.max(0, surplusBefore);
}

function dateInTimeZone(isoDateTime, timeZone = 'America/Los_Angeles') {
  if (!isoDateTime) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(isoDateTime));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function sourceCreatesPageMismatch(beforeSource, afterSource, beforePage, afterPage, asOfDate, pageRelevantToSource = () => true) {
  const relevantBeforePage = beforePage.filter(pageRelevantToSource);
  const relevantAfterPage = afterPage.filter(pageRelevantToSource);
  const sourceCreated = gameChanges(beforeSource, afterSource).some(change =>
    transitionCreatesMismatch(
      change, beforeSource, afterSource, relevantBeforePage, relevantAfterPage,
      game => pageRelevant(game, afterPage.length ? afterPage : beforePage),
    ));
  const pageCreated = gameChanges(relevantBeforePage, relevantAfterPage).some(change => {
    if (!change.after && asOfDate && change.before?.date < asOfDate) return false;
    return transitionCreatesMismatch(change, relevantBeforePage, relevantAfterPage, beforeSource, afterSource);
  });
  return sourceCreated || pageCreated;
}

function dateDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return Math.abs(new Date(`${a}T12:00:00Z`) - new Date(`${b}T12:00:00Z`)) / 86_400_000;
}

function pageRelevant(sourceGame, pageGames) {
  return pageGames.some(pageGame => pageGame.tripStart && pageGame.tripEnd
    && sourceGame.date >= pageGame.tripStart && sourceGame.date <= pageGame.tripEnd);
}

function unfoldIcal(value) {
  return value.replace(/\r?\n[ \t]/g, '');
}

function icalValue(event, name) {
  return event.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, 'm'))?.[1]?.replace(/\r$/, '') ?? '';
}

function unescapeIcal(value) {
  return value.replace(/\\([nN,;\\])/g, (_, escaped) => escaped.toLowerCase() === 'n' ? ' ' : escaped).trim();
}

function localPartsFromUtc(value) {
  const date = new Date(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
  if (Number.isNaN(date.valueOf())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:00` };
}

export function parseSportsEngineCalendar(source) {
  const calendar = unfoldIcal(source);
  const events = [...calendar.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)].map(match => match[1]);
  const games = [];
  for (const event of events) {
    const description = icalValue(event, 'DESCRIPTION');
    if (!/type(?:%3D|=)game(?:&|%26|$)/i.test(description)) continue;
    const rawSummary = unescapeIcal(icalValue(event, 'SUMMARY'));
    const tbd = /\s+time is TBD$/i.test(rawSummary);
    const summary = rawSummary.replace(/\s+time is TBD$/i, '');
    const atParts = summary.split(/\s+at\s+/i);
    const versusParts = summary.split(/\s+vs\.?\s+/i);
    const parts = atParts.length === 2 ? atParts : versusParts;
    if (parts.length !== 2) throw new Error(`SportsEngine game ${icalValue(event, 'UID') || '(unknown)'} has an unrecognized title`);
    const [away, home] = atParts.length === 2 ? parts : [parts[1], parts[0]];
    const start = icalValue(event, 'DTSTART');
    const stamp = start.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
    if (!stamp) throw new Error(`SportsEngine game ${icalValue(event, 'UID') || '(unknown)'} has an unrecognized start time`);
    const converted = start.endsWith('Z') ? localPartsFromUtc(start) : null;
    const date = converted?.date ?? `${stamp[1]}-${stamp[2]}-${stamp[3]}`;
    const time = tbd || !stamp[4] ? null : converted?.time ?? `${stamp[4]}:${stamp[5]}:00`;
    games.push({
      id: icalValue(event, 'UID').replace(/@sportsengine\.com$/, ''),
      date,
      time,
      away, home,
      rink: unescapeIcal(icalValue(event, 'LOCATION')) || null,
      city: null,
    });
  }
  return games.sort((a, b) => [a.date, a.time ?? '', a.id].join('|').localeCompare([b.date, b.time ?? '', b.id].join('|')));
}

function parseTripRange(value) {
  const label = text(value).replace(/^Tournament:\s*/i, '');
  const crossMonth = label.match(/^([A-Z][a-z]+) (\d{1,2})[–-]([A-Z][a-z]+) (\d{1,2}), (20\d{2})$/);
  const sameMonth = label.match(/^([A-Z][a-z]+) (\d{1,2})[–-](\d{1,2}), (20\d{2})$/);
  const single = label.match(/^([A-Z][a-z]+) (\d{1,2}), (20\d{2})$/);
  let start;
  let end;
  if (crossMonth) {
    start = new Date(`${crossMonth[1]} ${crossMonth[2]}, ${crossMonth[5]} 12:00:00 UTC`);
    end = new Date(`${crossMonth[3]} ${crossMonth[4]}, ${crossMonth[5]} 12:00:00 UTC`);
  } else if (sameMonth) {
    start = new Date(`${sameMonth[1]} ${sameMonth[2]}, ${sameMonth[4]} 12:00:00 UTC`);
    end = new Date(`${sameMonth[1]} ${sameMonth[3]}, ${sameMonth[4]} 12:00:00 UTC`);
  } else if (single) {
    start = new Date(`${single[1]} ${single[2]}, ${single[3]} 12:00:00 UTC`);
    end = new Date(start);
  }
  if (!start || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function parseTravelPageGames(source) {
  const games = [];
  for (const articleMatch of source.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/g)) {
    const [, attributes, article] = articleMatch;
    if (!/\bclass="(?:[^"]*\s)?trip(?:\s[^"]*)?"/.test(attributes)) continue;
    const tripId = attributes.match(/\bid="([^"]+)"/)?.[1];
    if (!tripId) throw new Error('A travel-page trip is missing its id');
    const tripDates = article.match(/<p\b[^>]*class="(?:[^"]*\s)?trip-dates(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    const range = parseTripRange(tripDates ?? '');
    const year = text(tripDates).match(/(20\d{2})/)?.[1];
    let index = 0;
    const occurrences = new Map();
    let dayLabel = '';
    const entries = /<p\b[^>]*class="(?:[^"]*\s)?day-label(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/p>|<div\b[^>]*class="(?:[^"]*\s)?game(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/div>/g;
    for (const entry of article.matchAll(entries)) {
      if (entry[1] !== undefined) {
        dayLabel = text(entry[1]);
        continue;
      }
      const body = entry[2];
        const datetime = body.match(/<time\b[^>]*datetime="([^"]+)"[^>]*>/)?.[1] ?? null;
        const matchup = text(body.match(/<span\b[^>]*class="(?:[^"]*\s)?matchup(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
        const venueText = text(body.match(/<span\b[^>]*class="(?:[^"]*\s)?venue(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/span>/)?.[1]);
        const parts = matchup.split(/\s+@\s+/);
        if (parts.length !== 2) throw new Error(`Travel-page game ${tripId}:${index + 1} has an unrecognized matchup`);
        let date = datetime?.slice(0, 10) ?? dayLabel.replace(/^[A-Z][a-z]+,\s*/, '');
        if (date && !/^\d{4}-/.test(date) && year) {
          const parsed = new Date(`${date}, ${year} 12:00:00 UTC`);
          if (!Number.isNaN(parsed.valueOf())) date = parsed.toISOString().slice(0, 10);
        }
        const opponent = isTeam(parts[0]) ? parts[1] : parts[0];
        const identity = `${date || 'date-tbd'}:${normalizedOpponent(opponent)}`;
        const occurrence = (occurrences.get(identity) ?? 0) + 1;
        occurrences.set(identity, occurrence);
        games.push({
          id: `${tripId}:${identity}:${occurrence}`,
          tripId,
          tripStart: range?.start ?? null,
          tripEnd: range?.end ?? null,
          date: date || null,
          time: datetime ? `${datetime.slice(11, 16)}:00` : null,
          away: parts[0], home: parts[1],
          rink: /TBD/i.test(venueText) ? null : venueText,
          city: null,
        });
        index += 1;
    }
    const matchupCount = [...article.matchAll(/<span\b[^>]*class="(?:[^"]*\s)?matchup(?:\s[^"]*)?"/g)].length;
    if (matchupCount !== index) throw new Error(`Travel-page trip ${tripId} contains ${matchupCount} matchups but ${index} parsed games`);
    if (matchupCount && !range) throw new Error(`Travel-page trip ${tripId} has an unrecognized date range`);
  }
  return games;
}

function displayDate(value) {
  return value ? new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'date TBD';
}

function displayTime(value) {
  if (!value) return 'time TBD';
  const [hour, minute] = value.split(':').map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function summary(game) {
  return `${displayDate(game.date)}, ${displayTime(game.time)} — ${game.away} at ${game.home}${game.rink ? ` at ${game.rink}` : ''}`;
}

export function describeChanges(previous, current) {
  const before = new Map(previous.map(game => [game.id, game]));
  const after = new Map(current.map(game => [game.id, game]));
  const lines = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldGame = before.get(id);
    const newGame = after.get(id);
    if (!oldGame) lines.push(`New game added: ${summary(newGame)}.`);
    else if (!newGame) lines.push(`Game removed: ${summary(oldGame)}.`);
    else if (JSON.stringify(oldGame) !== JSON.stringify(newGame)) {
      const details = [];
      if (oldGame.date !== newGame.date) details.push(`date changed from ${displayDate(oldGame.date)} to ${displayDate(newGame.date)}`);
      if (oldGame.time !== newGame.time) details.push(`time changed from ${displayTime(oldGame.time)} to ${displayTime(newGame.time)}`);
      if (oldGame.home !== newGame.home || oldGame.away !== newGame.away) details.push(`matchup changed from ${oldGame.away} at ${oldGame.home} to ${newGame.away} at ${newGame.home}`);
      if (oldGame.rink !== newGame.rink || oldGame.city !== newGame.city) details.push(`location changed from ${oldGame.rink ?? 'TBD'} to ${newGame.rink ?? 'TBD'}`);
      if (details.length) lines.push(`${displayDate(newGame.date)} — ${newGame.away} at ${newGame.home}: ${details.join('; ')}.`);
    }
  }
  return lines;
}

export function classifyScheduleChanges(previous, current) {
  const nwahlGameChanges = gameChanges(previous.nwahlGames, current.nwahlGames);
  const sportsGameChanges = gameChanges(previous.sportsEngineGames, current.sportsEngineGames);
  const nwahlChanged = nwahlGameChanges.length > 0 || previous.nwahlTeamHash !== current.nwahlTeamHash;
  const sportsChanged = sportsGameChanges.length > 0;
  const pageChanged = changed(previous.travelPageGames, current.travelPageGames);
  const nwahlCreated = nwahlGameChanges.filter(change =>
    transitionCreatesMismatch(
      change,
      previous.nwahlGames,
      current.nwahlGames,
      previous.sportsEngineGames,
      current.sportsEngineGames,
    ));
  const relatedSportsIds = new Set(sportsGameChanges.filter(sportsChange =>
    nwahlCreated.some(nwahlChange => related(sportsChange.before ?? sportsChange.after, nwahlChange.before ?? nwahlChange.after)))
    .map(change => change.id));
  const groupChanges = nwahlCreated.filter(nwahlChange => !sportsGameChanges.some(sportsChange =>
    related(sportsChange.before ?? sportsChange.after, nwahlChange.before ?? nwahlChange.after)));
  const ambiguous = nwahlCreated.length > groupChanges.length;
  const asOfDate = dateInTimeZone(current.checkedAt);
  const nwahlPageNew = sourceCreatesPageMismatch(
    previous.nwahlGames, current.nwahlGames, previous.travelPageGames, current.travelPageGames,
    asOfDate, game => !NON_NWAHL_TRIPS.has(game.tripId));
  const sportsPageNew = sourceCreatesPageMismatch(
    previous.sportsEngineGames, current.sportsEngineGames, previous.travelPageGames, current.travelPageGames, asOfDate);
  const group = groupChanges.length > 0;
  const pageSources = [];
  if (nwahlPageNew) pageSources.push('NWAHL');
  if (sportsPageNew) pageSources.push('SportsEngine');
  const opaqueNwahl = nwahlChanged && !changed(previous.nwahlGames, current.nwahlGames);
  const ownerNeeded = ambiguous || opaqueNwahl || pageSources.includes('SportsEngine') || (!group && pageSources.length > 0);
  return {
    kind: group ? 'group' : ownerNeeded ? 'owner' : 'match',
    ownerNeeded,
    nwahlChanged, sportsChanged, pageChanged, pageSources, ambiguous, opaqueNwahl,
    nwahlPageNew, sportsPageNew,
    groupNwahlIds: groupChanges.map(change => change.id),
    relatedSportsIds: [...relatedSportsIds],
  };
}

function bulletList(lines, fallback) {
  return lines.length ? lines.map(line => `• ${line}`).join('\n') : `• ${fallback}`;
}

export function buildGroupReport(previous, current, result) {
  const ids = new Set(result.groupNwahlIds);
  const lines = describeChanges(
    previous.nwahlGames.filter(game => ids.has(game.id)),
    current.nwahlGames.filter(game => ids.has(game.id)),
  );
  const pageNote = result.pageSources.includes('NWAHL')
    ? '\n\nThe travel page also needs to be reviewed because it no longer matches NWAHL.'
    : '';
  return `Hello,\n\nThe official NWAHL schedule changed and now differs from the team’s SportsEngine calendar.\n\nWhat NWAHL changed:\n${bulletList(lines, 'NWAHL changed a schedule detail that SportsEngine does not currently match.')}\n\nYou can check the official schedule for the latest information:\nhttps://www.nwahl.net/game-schedule.html.${pageNote}\n`;
}

export function buildOwnerReport(previous, current, result) {
  const reasons = [];
  if (result.pageSources.length) reasons.push(`${result.pageSources.join(' and ')} now ${result.pageSources.length === 1 ? 'disagrees' : 'disagree'} with the travel page.`);
  if (result.ambiguous) reasons.push('NWAHL and SportsEngine both changed since the last successful check and still disagree, so the checker cannot reliably identify which source created the discrepancy.');
  if (result.opaqueNwahl) reasons.push('NWAHL changed a weekend-level schedule detail that is not represented as an individual game in SportsEngine or on the travel page.');
  const nwahlLines = result.nwahlChanged ? describeChanges(previous.nwahlGames, current.nwahlGames) : [];
  const sportsLines = result.sportsChanged ? describeChanges(previous.sportsEngineGames, current.sportsEngineGames) : [];
  const pageLines = result.pageChanged ? describeChanges(previous.travelPageGames, current.travelPageGames) : [];
  const sections = [
    nwahlLines.length ? `\n\nNWAHL changes:\n${bulletList(nwahlLines, '')}` : '',
    sportsLines.length ? `\n\nSportsEngine changes:\n${bulletList(sportsLines, '')}` : '',
    pageLines.length ? `\n\nTravel page changes:\n${bulletList(pageLines, '')}` : '',
  ].join('');
  return `Hello Gordon,\n\nThe team schedule needs your review.\n\n${reasons.join('\n')}${sections}\n\nNWAHL: https://www.nwahl.net/game-schedule.html\nSportsEngine calendar: webcal://ical.sportngin.com/v3/calendar/ical?team_ids=11f14b0a-1f31-fa76-9f63-42f5b12328f2\nTravel page: https://postandin.com/mets-16aa-travel/\n`;
}

class SourceError extends Error {
  constructor(sources, options) {
    super(`Schedule source failure: ${sources.join(', ')}`, options);
    this.sources = sources;
  }
}

function validNullableString(value, max = 500) {
  return value === null || (typeof value === 'string' && value.length <= max);
}

function validateGames(value, label) {
  if (!Array.isArray(value) || value.length > 500) throw new Error(`Invalid ${label} state`);
  for (const game of value) {
    if (!game || typeof game !== 'object'
      || typeof game.id !== 'string' || game.id.length > 200
      || !validNullableString(game.date, 10) || !validNullableString(game.time, 8)
      || !validNullableString(game.home) || !validNullableString(game.away)
      || !validNullableString(game.rink) || !validNullableString(game.city)) {
      throw new Error(`Invalid ${label} game state`);
    }
  }
}

export function validateState(value) {
  if (!value || value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.nwahlTeamHash ?? '')) {
    throw new Error('Invalid team schedule state');
  }
  validateGames(value.nwahlGames, 'NWAHL');
  validateGames(value.sportsEngineGames, 'SportsEngine');
  validateGames(value.travelPageGames, 'travel page');
  return value;
}

async function readJson(path, { maxBytes = Number.POSITIVE_INFINITY } = {}) {
  const raw = await fs.readFile(path, 'utf8');
  if (Buffer.byteLength(raw) > maxBytes) throw new Error('Team schedule state is too large');
  return JSON.parse(raw);
}

async function exists(path) {
  return fs.access(path).then(() => true, () => false);
}

async function fetchWithRetry(url, accept, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function loadPreviousState() {
  if (process.env.TEAM_MONITOR_STATE_LOAD_FAILED === 'true') throw new Error('Saved workflow state could not be loaded');
  const statePath = process.env.TEAM_MONITOR_STATE_PATH;
  if (statePath && await exists(statePath)) return validateState(await readJson(statePath, { maxBytes: 100_000 }));
  const [nwahlGames, nwahlTeamHash, sportsEngineGames, travelPageGames] = await Promise.all([
    readJson(process.env.NWAHL_BASELINE_PATH ?? new URL('../data/nwahl-mets-16aa-travel.json', import.meta.url)),
    fs.readFile(process.env.NWAHL_TEAM_HASH_PATH ?? new URL('../data/nwahl-mets-16aa-team.sha256', import.meta.url), 'utf8').then(value => value.trim()),
    readJson(process.env.SPORTSENGINE_BASELINE_PATH ?? new URL('../data/sportsengine-mets-16aa-games.json', import.meta.url)),
    readJson(process.env.TRAVEL_PAGE_BASELINE_PATH ?? new URL('../data/mets-16aa-travel-page-games.json', import.meta.url)),
  ]);
  return validateState({ version: 1, nwahlGames, nwahlTeamHash, sportsEngineGames, travelPageGames });
}

async function loadCurrentState() {
  const nwahlPromise = process.env.NWAHL_SCHEDULE_FIXTURE_PATH
    ? readJson(process.env.NWAHL_SCHEDULE_FIXTURE_PATH)
    : fetchWithRetry(process.env.NWAHL_SCHEDULE_API ?? NWAHL_URL, 'application/json').then(response => response.json());
  const sportsPromise = process.env.SPORTSENGINE_ICAL_FIXTURE_PATH
    ? fs.readFile(process.env.SPORTSENGINE_ICAL_FIXTURE_PATH, 'utf8')
    : fetchWithRetry(process.env.SPORTSENGINE_ICAL_URL ?? SPORTSENGINE_URL, 'text/calendar').then(response => response.text());
  const pagePromise = fs.readFile(process.env.TRAVEL_PAGE_PATH ?? new URL('../mets-16aa-travel/index.html', import.meta.url), 'utf8');
  const settled = await Promise.allSettled([nwahlPromise, sportsPromise, pagePromise]);
  const labels = ['NWAHL', 'SportsEngine', 'travel page'];
  const failures = settled.flatMap((item, index) => item.status === 'rejected' ? [labels[index]] : []);
  if (failures.length) throw new SourceError(failures);
  const [payload, calendar, page] = settled.map(item => item.value);
  const current = { version: 1, checkedAt: new Date().toISOString() };
  try {
    current.nwahlGames = selectTeamGames(payload);
    current.nwahlTeamHash = fingerprintTeamSchedule(payload);
  } catch (error) {
    throw new SourceError(['NWAHL'], { cause: error });
  }
  try {
    current.sportsEngineGames = parseSportsEngineCalendar(calendar);
  } catch (error) {
    throw new SourceError(['SportsEngine'], { cause: error });
  }
  try {
    current.travelPageGames = parseTravelPageGames(page);
  } catch (error) {
    throw new SourceError(['travel page'], { cause: error });
  }
  const emptySources = [
    current.nwahlGames.length ? null : 'NWAHL',
    current.sportsEngineGames.length ? null : 'SportsEngine',
    current.travelPageGames.length ? null : 'travel page',
  ].filter(Boolean);
  if (emptySources.length) throw new SourceError(emptySources);
  return current;
}

async function write(path, value) {
  if (path) await fs.writeFile(path, value, 'utf8');
}

async function output(name, value) {
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

async function main() {
  const previous = await loadPreviousState();
  const current = await loadCurrentState();
  const result = classifyScheduleChanges(previous, current);
  await write(process.env.TEAM_MONITOR_NEXT_STATE_PATH, `${JSON.stringify(current)}\n`);
  await output('kind', result.kind);
  await output('owner_needed', result.ownerNeeded ? 'true' : 'false');
  if (result.kind === 'group') await write(process.env.TEAM_GROUP_REPORT_PATH ?? process.env.NWAHL_REPORT_PATH, buildGroupReport(previous, current, result));
  if (result.ownerNeeded) await write(process.env.TEAM_OWNER_REPORT_PATH, buildOwnerReport(previous, current, result));
  console.log(result.kind === 'match' ? 'No new schedule discrepancies were found.' : `Team schedule monitor result: ${result.kind}.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await main();
  } catch (error) {
    const detail = error instanceof SourceError
      ? ` because it could not read ${error.sources.join(' and ')}`
      : '';
    await write(process.env.TEAM_ERROR_REPORT_PATH ?? process.env.NWAHL_ERROR_REPORT_PATH, `Hello Gordon,\n\nThe automatic team schedule checker could not complete${detail}. No schedule change has been confirmed.\n\nThe checker will try again tomorrow.\n`);
    await output('kind', 'error');
    console.error(error);
    console.error('The team schedule checker could not complete after three attempts.');
    process.exitCode = 1;
  }
}
