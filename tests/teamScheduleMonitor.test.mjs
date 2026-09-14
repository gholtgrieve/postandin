import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fingerprintTeamSchedule, selectTeamGames } from '../scripts/check-nwahl-travel.mjs';

import {
  buildGroupReport,
  buildOwnerReport,
  classifyScheduleChanges,
  parseSportsEngineCalendar,
  parseTravelPageGames,
  validateState,
} from '../scripts/team-schedule-monitor.mjs';

const team = 'Seattle Jr. Mets 16AA';
const game = (overrides = {}) => ({
  id: 'game-1', date: '2026-09-25', time: '15:15:00',
  away: 'Team Wyoming', home: team, rink: 'Tacoma Twin Rinks', city: null,
  ...overrides,
});
const state = (overrides = {}) => ({
  version: 1,
  nwahlGames: [game()],
  nwahlTeamHash: 'same-hash',
  sportsEngineGames: [game({ home: '16U AA Jr Mets', rink: '2645 South 80th Street, Tacoma, WA' })],
  travelPageGames: [game({ id: 'tacoma:1', tripId: 'tacoma', tripStart: '2026-09-24', tripEnd: '2026-09-28' })],
  ...overrides,
});

async function runCli({ malformedState = false, emptySports = false } = {}) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'team-schedule-monitor-'));
  const payload = { entries: [{
    id: 1, team_name: team, opponent_team_name: 'Team Wyoming', weekend_date: '2026-09-25',
    status: 'committed', games_count: 1, rink_name: 'Tacoma Twin Rinks', rink_city: 'Tacoma',
    games: [{ id: 10, game_date: '2026-09-25', start_time: '15:15:00' }],
  }] };
  const calendar = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:game@sportsengine.com\nDTSTART;TZID=America/Los_Angeles:20260925T151500\nSUMMARY:Team Wyoming at 16U AA Jr Mets\nLOCATION:2645 South 80th Street\\, Tacoma\\, WA\nDESCRIPTION:type%3Dgame\nEND:VEVENT\nEND:VCALENDAR`;
  const page = `<article class="trip" id="tacoma"><p class="trip-dates">September 25–27, 2026</p><div class="game-day"><p class="day-label">Friday, September 25</p><div class="game"><time datetime="2026-09-25T15:15">3:15 PM</time><span class="matchup">Team Wyoming @ ${team}</span><span class="venue">Tacoma Twin Rinks</span></div></div></article>`;
  const currentState = {
    version: 1,
    nwahlGames: selectTeamGames(payload),
    nwahlTeamHash: fingerprintTeamSchedule(payload),
    sportsEngineGames: parseSportsEngineCalendar(calendar),
    travelPageGames: parseTravelPageGames(page),
  };
  const files = {
    state: path.join(tempDir, 'state.json'), payload: path.join(tempDir, 'nwahl.json'),
    calendar: path.join(tempDir, 'sports.ics'), page: path.join(tempDir, 'page.html'),
    output: path.join(tempDir, 'output.txt'), next: path.join(tempDir, 'next.json'),
    group: path.join(tempDir, 'group.txt'), owner: path.join(tempDir, 'owner.txt'), error: path.join(tempDir, 'error.txt'),
  };
  await Promise.all([
    fsp.writeFile(files.state, malformedState ? '{"version":1}' : JSON.stringify(currentState)),
    fsp.writeFile(files.payload, JSON.stringify(payload)),
    fsp.writeFile(files.calendar, emptySports ? 'BEGIN:VCALENDAR\nEND:VCALENDAR\n' : calendar),
    fsp.writeFile(files.page, page),
  ]);
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/team-schedule-monitor.mjs'], {
        cwd: process.cwd(),
        env: {
          ...process.env, GITHUB_OUTPUT: files.output,
          TEAM_MONITOR_STATE_PATH: files.state, TEAM_MONITOR_NEXT_STATE_PATH: files.next,
          TEAM_GROUP_REPORT_PATH: files.group, TEAM_OWNER_REPORT_PATH: files.owner, TEAM_ERROR_REPORT_PATH: files.error,
          NWAHL_SCHEDULE_FIXTURE_PATH: files.payload, SPORTSENGINE_ICAL_FIXTURE_PATH: files.calendar, TRAVEL_PAGE_PATH: files.page,
        },
      });
      child.once('error', reject);
      child.once('close', code => resolve({ code }));
    });
    return {
      ...result,
      output: await fsp.readFile(files.output, 'utf8'),
      nextExists: await fsp.access(files.next).then(() => true, () => false),
      error: await fsp.readFile(files.error, 'utf8').catch(() => ''),
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

test('SportsEngine parser keeps games only, preserves Away at Home, and treats placeholder times as TBD', () => {
  const calendar = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:practice@sportsengine.com\nDTSTART;TZID=America/Los_Angeles:20260924T170000\nSUMMARY:Practice\nDESCRIPTION:type%3Dpractice\nEND:VEVENT\nBEGIN:VEVENT\nUID:game@sportsengine.com\nDTSTART;TZID=America/Los_Angeles:20260925T151500\nSUMMARY:Team Wyoming at 16U AA Jr Mets\nLOCATION:2645 South 80th Street\\, Tacoma\\, WA\nDESCRIPTION:https://example.test/?type%3Dgame\nEND:VEVENT\nBEGIN:VEVENT\nUID:tbd@sportsengine.com\nDTSTART;TZID=America/Los_Angeles:20261024T010000\nSUMMARY:16U AA Jr Mets at Tacoma Rockets time is TBD\nDESCRIPTION:https://example.test/?type%3Dgame\nEND:VEVENT\nEND:VCALENDAR`;
  const games = parseSportsEngineCalendar(calendar);

  assert.equal(games.length, 2);
  assert.deepEqual(games[0], {
    id: 'game', date: '2026-09-25', time: '15:15:00',
    away: 'Team Wyoming', home: '16U AA Jr Mets', rink: '2645 South 80th Street, Tacoma, WA', city: null,
  });
  assert.equal(games[1].time, null);
});

test('travel-page parser associates each TBD game with its own day heading', () => {
  const html = `<article id="example" class="featured trip"><p class="trip-dates">January 9–10, 2027</p><div class="game-day"><p class="day-label">Saturday, January 9</p><div class="featured game past"><span class="game-time-tbd">TBD</span><span class="matchup">${team} @ Portland Jr. Winterhawks</span><span class="venue">Time and rink TBD</span></div></div><div class="game-day"><p class="day-label">Sunday, January 10</p><div class="game"><span class="game-time-tbd">TBD</span><span class="matchup">${team} @ Portland Jr. Winterhawks</span><span class="venue">Time and rink TBD</span></div></div></article>`;
  const games = parseTravelPageGames(html);

  assert.deepEqual(games.map(item => item.date), ['2027-01-09', '2027-01-10']);
});

test('NWAHL-only change that creates a SportsEngine discrepancy alerts the group', () => {
  const previous = state();
  const current = state({ nwahlGames: [game({ time: '16:15:00' })], nwahlTeamHash: 'new-hash' });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'group');
  assert.match(buildGroupReport(previous, current, result), /time changed from 3:15 PM to 4:15 PM/);
});

test('SportsEngine-only change never alerts the group and names a travel-page mismatch for Gordon', () => {
  const previous = state();
  const current = state({ sportsEngineGames: [game({ home: '16U AA Jr Mets', time: '16:15:00' })] });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'owner');
  assert.deepEqual(result.pageSources, ['SportsEngine']);
  assert.match(buildOwnerReport(previous, current, result), /SportsEngine now disagrees with the travel page/);
});

test('SportsEngine-only change outside the travel page produces no email', () => {
  const previous = state();
  const addedHomeGame = game({ id: 'home-2', date: '2026-10-17', away: 'Sno-King Jr Thunderbirds', home: '16U AA Jr Mets' });
  const current = state({ sportsEngineGames: [...previous.sportsEngineGames, addedHomeGame] });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('simultaneous source changes that still disagree are routed only to Gordon', () => {
  const previous = state();
  const current = state({
    nwahlGames: [game({ time: '16:15:00' })], nwahlTeamHash: 'new-hash',
    sportsEngineGames: [game({ home: '16U AA Jr Mets', time: '17:15:00' })],
  });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'owner');
  assert.equal(result.ambiguous, true);
  assert.match(buildOwnerReport(previous, current, result), /cannot reliably identify which source/);
});

test('matching NWAHL and SportsEngine changes notify Gordon when the travel page becomes stale', () => {
  const previous = state();
  const changedNwahl = game({ time: '16:15:00' });
  const changedSports = game({ home: '16U AA Jr Mets', time: '16:15:00' });
  const current = state({ nwahlGames: [changedNwahl], nwahlTeamHash: 'new-hash', sportsEngineGames: [changedSports] });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'owner');
  assert.deepEqual(result.pageSources, ['NWAHL', 'SportsEngine']);
});

test('an unchanged reviewed state produces no alert', () => {
  const previous = state();
  assert.equal(classifyScheduleChanges(previous, structuredClone(previous)).kind, 'match');
});

test('neutral-site home and away labels do not create a false group alert', () => {
  const previous = state({
    nwahlGames: [game({ away: team, home: 'Montana Wolves 16U' })],
    sportsEngineGames: [game({ away: 'Montana Wolves 16U', home: '16U AA Jr Mets' })],
    travelPageGames: [],
  });
  const afterSports = state({
    ...previous,
    sportsEngineGames: [game({ away: 'Montana Wolves 16U', home: '16U AA Jr Mets', time: '16:15:00' })],
  });
  const afterNwahl = state({
    ...afterSports,
    nwahlGames: [game({ away: team, home: 'Montana Wolves 16U', time: '16:15:00' })],
    nwahlTeamHash: 'new-hash',
  });

  assert.notEqual(classifyScheduleChanges(afterSports, afterNwahl).kind, 'group');
});

test('unknown rink name and address formats do not create a false group alert', () => {
  const previous = state({
    nwahlGames: [game({ time: null, rink: null })],
    sportsEngineGames: [game({ time: null, rink: '999 Example Avenue, Renton, WA' })],
    travelPageGames: [],
  });
  const current = state({
    ...previous,
    nwahlGames: [game({ time: null, rink: 'Example Ice Arena' })],
    nwahlTeamHash: 'new-hash',
  });

  assert.notEqual(classifyScheduleChanges(previous, current).kind, 'group');
});

test('editing an already-discrepant NWAHL game does not create a new group alert', () => {
  const previous = state({
    nwahlGames: [game({ time: '11:30:00' })],
    sportsEngineGames: [game({ home: '16U AA Jr Mets', time: '09:45:00' })],
    travelPageGames: [],
  });
  const current = state({
    ...previous,
    nwahlGames: [game({ time: '11:45:00' })],
    nwahlTeamHash: 'new-hash',
  });

  assert.notEqual(classifyScheduleChanges(previous, current).kind, 'group');
});

test('SportsEngine resolving the accepted November 1 discrepancy sends no notification', () => {
  const november = game({ date: '2026-11-01', time: '11:30:00', away: team, home: 'Spokane Jr Chiefs' });
  const previous = state({
    nwahlGames: [november],
    sportsEngineGames: [game({ ...november, home: 'Spokane Jr Chiefs', away: '16U AA Jr Mets', time: '09:45:00' })],
    travelPageGames: [game({ ...november, id: 'spokane:4', tripId: 'spokane', tripStart: '2026-10-28', tripEnd: '2026-11-02' })],
  });
  const current = state({
    ...previous,
    sportsEngineGames: [game({ ...november, home: 'Spokane Jr Chiefs', away: '16U AA Jr Mets' })],
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('correcting the travel page to match existing sources sends no notification', () => {
  const previous = state({ travelPageGames: [game({ id: 'tacoma:1', time: '14:15:00', tripStart: '2026-09-24', tripEnd: '2026-09-28' })] });
  const current = state();

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('a travel-page edit that creates a new mismatch alerts Gordon and names both sources', () => {
  const previous = state();
  const current = state({ travelPageGames: [game({ id: 'tacoma:1', time: '14:15:00', tripStart: '2026-09-24', tripEnd: '2026-09-28' })] });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'owner');
  assert.deepEqual(result.pageSources, ['NWAHL', 'SportsEngine']);
});

test('a new opponent inside a trip date range is recognized as travel-page relevant', () => {
  const previous = state();
  const added = game({ id: 'new', date: '2026-09-24', away: 'New Opponent', home: team });
  const current = state({
    nwahlGames: [...previous.nwahlGames, added],
    nwahlTeamHash: 'new-hash',
    sportsEngineGames: [...previous.sportsEngineGames, game({ ...added, home: '16U AA Jr Mets' })],
  });

  assert.deepEqual(classifyScheduleChanges(previous, current).pageSources, ['NWAHL', 'SportsEngine']);
});

test('an unrelated SportsEngine edit does not suppress a legitimate NWAHL group alert', () => {
  const previous = state({
    sportsEngineGames: [state().sportsEngineGames[0], game({ id: 'other', date: '2027-02-21', away: 'Alaska Wolves', home: '16U AA Jr Mets', rink: '22202 70th Avenue W' })],
    travelPageGames: [],
  });
  const current = state({
    nwahlGames: [game({ time: '16:15:00' })], nwahlTeamHash: 'new-hash',
    sportsEngineGames: [state().sportsEngineGames[0], game({ id: 'other', date: '2027-02-21', away: 'Alaska Wolves', home: '16U AA Jr Mets', rink: '22202 70th Avenue West' })],
    travelPageGames: [],
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'group');
});

test('state validation rejects malformed or oversized game state', () => {
  assert.throws(() => validateState({ version: 1 }), /Invalid team schedule state/);
  assert.throws(() => validateState(state({ nwahlTeamHash: 'not-a-hash' })), /Invalid team schedule state/);
  assert.throws(() => validateState(state({ nwahlTeamHash: 'a'.repeat(64), nwahlGames: [{ id: 'x' }] })), /Invalid NWAHL game state/);
});

test('SportsEngine UTC starts are converted to Pacific time', () => {
  const calendar = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:utc@sportsengine.com\nDTSTART:20260925T221500Z\nSUMMARY:Team Wyoming at 16U AA Jr Mets\nDESCRIPTION:type%3Dgame\nEND:VEVENT\nEND:VCALENDAR`;
  assert.equal(parseSportsEngineCalendar(calendar)[0].time, '15:15:00');
});

test('the real travel page parses every matchup and matches the reviewed baseline', () => {
  const actual = parseTravelPageGames(fs.readFileSync('mets-16aa-travel/index.html', 'utf8'));
  const baseline = JSON.parse(fs.readFileSync('data/mets-16aa-travel-page-games.json', 'utf8'));
  assert.deepEqual(actual, baseline);
});

test('CLI writes match output and the next successful state', async () => {
  const result = await runCli();
  assert.equal(result.code, 0);
  assert.match(result.output, /^kind=match$/m);
  assert.match(result.output, /^owner_needed=false$/m);
  assert.equal(result.nextExists, true);
  assert.equal(result.error, '');
});

test('CLI rejects malformed saved state without comparing or advancing it', async () => {
  const result = await runCli({ malformedState: true });
  assert.equal(result.code, 1);
  assert.match(result.output, /^kind=error$/m);
  assert.equal(result.nextExists, false);
  assert.match(result.error, /could not complete/i);
  assert.doesNotMatch(result.error, /Invalid|JSON|state/i);
});

test('CLI treats an unexpectedly empty SportsEngine feed as a source failure', async () => {
  const result = await runCli({ emptySports: true });
  assert.equal(result.code, 1);
  assert.match(result.output, /^kind=error$/m);
  assert.equal(result.nextExists, false);
  assert.match(result.error, /SportsEngine/);
});

test('workflow accepts only bot-authored state and serializes monitor runs', () => {
  const workflow = fs.readFileSync('.github/workflows/check-nwahl-travel.yml', 'utf8');
  assert.equal((workflow.match(/item\.user\?\.login === 'github-actions\[bot\]'/g) ?? []).length, 3);
  assert.match(workflow, /group: team-schedule-monitor/);
  assert.match(workflow, /steps\.schedule\.outcome == 'failure'/);
  assert.match(workflow, /encoded\.length > 60000/);
  assert.match(workflow, /State issue.*exists but does not contain a valid state marker/);
  assert.match(workflow, /steps\.schedule\.outputs\.owner_needed == 'true'/);
});

test('moving a game outside its trip window makes both sources stale against the page', () => {
  const previous = state();
  const current = state({
    checkedAt: '2026-09-14T12:00:00.000Z',
    nwahlGames: [game({ date: '2026-10-10' })], nwahlTeamHash: 'new-hash',
    sportsEngineGames: [game({ home: '16U AA Jr Mets', date: '2026-10-10' })],
  });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'owner');
  assert.deepEqual(result.pageSources, ['NWAHL', 'SportsEngine']);
});

test('an NWAHL-only move outside a trip window keeps the travel-page warning in the group report', () => {
  const previous = state();
  const current = state({
    checkedAt: '2026-09-14T12:00:00.000Z',
    nwahlGames: [game({ date: '2026-10-10' })], nwahlTeamHash: 'new-hash',
  });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'group');
  assert.deepEqual(result.pageSources, ['NWAHL']);
  assert.match(buildGroupReport(previous, current, result), /travel page.*no longer matches NWAHL/is);
});

test('content-based page ids stay stable when an earlier game is inserted', () => {
  const original = `<article class="trip" id="spokane"><p class="trip-dates">October 29–November 1, 2026</p><div class="game-day"><p class="day-label">Friday, October 30</p><div class="game"><time datetime="2026-10-30T13:45">1:45 PM</time><span class="matchup">${team} @ Spokane Jr Chiefs</span><span class="venue">EWU Rink</span></div></div><div class="game-day"><p class="day-label">Sunday, November 1</p><div class="game"><time datetime="2026-11-01T11:30">11:30 AM</time><span class="matchup">Spokane Jr Chiefs @ ${team}</span><span class="venue">EWU Rink</span></div></div></article>`;
  const inserted = original.replace('<div class="game-day">', `<div class="game-day"><p class="day-label">Thursday, October 29</p><div class="game"><time datetime="2026-10-29T17:00">5:00 PM</time><span class="matchup">Utah Jr Grizzlies @ ${team}</span><span class="venue">EWU Rink</span></div></div><div class="game-day">`);
  const beforeIds = new Set(parseTravelPageGames(original).map(item => item.id));
  const afterIds = new Set(parseTravelPageGames(inserted).map(item => item.id));

  assert.equal([...beforeIds].every(id => afterIds.has(id)), true);
});

test('a group run independently requests a Gordon-only report for an ambiguous related change', () => {
  const secondNwahl = game({ id: 'game-2', date: '2026-12-04', time: '13:15:00', away: team, home: 'Utah Jr Grizzlies' });
  const secondSports = game({ ...secondNwahl, id: 'sports-2', away: '16U AA Jr Mets' });
  const secondPage = game({ ...secondNwahl, id: 'new-mexico:game', tripId: 'new-mexico', tripStart: '2026-12-02', tripEnd: '2026-12-07' });
  const previous = state({
    nwahlGames: [game(), secondNwahl],
    sportsEngineGames: [state().sportsEngineGames[0], secondSports],
    travelPageGames: [state().travelPageGames[0], secondPage],
  });
  const current = state({
    nwahlGames: [game({ time: '16:15:00' }), { ...secondNwahl, time: '14:15:00' }], nwahlTeamHash: 'new-hash',
    sportsEngineGames: [state().sportsEngineGames[0], { ...secondSports, time: '15:15:00' }],
    travelPageGames: previous.travelPageGames,
  });
  const result = classifyScheduleChanges(previous, current);

  assert.equal(result.kind, 'group');
  assert.equal(result.ownerNeeded, true);
  assert.equal(result.ambiguous, true);
  assert.match(buildOwnerReport(previous, current, result), /cannot reliably identify/);
});

test('removing a past game from the travel page does not notify Gordon', () => {
  const previous = state();
  const current = state({ checkedAt: '2026-10-01T12:00:00.000Z', travelPageGames: [] });
  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('adding an identical duplicate NWAHL game still creates a group discrepancy', () => {
  const previous = state({ travelPageGames: [] });
  const current = state({
    nwahlGames: [...previous.nwahlGames, game({ id: 'game-duplicate' })],
    nwahlTeamHash: 'new-hash',
    travelPageGames: [],
  });
  assert.equal(classifyScheduleChanges(previous, current).kind, 'group');
});

test('publishing one of two same-day NWAHL games is not masked by a standing weekend discrepancy', () => {
  const nwahlFirst = game({ id: 'nwahl-243', date: '2026-10-24', time: null, away: team, home: 'Tacoma Rockets' });
  const nwahlSecond = game({ id: 'nwahl-244', date: '2026-10-24', time: null, away: team, home: 'Tacoma Rockets' });
  const sportsFirst = game({ id: 'sports-24', date: '2026-10-24', time: null, away: '16U AA Jr Mets', home: 'Tacoma Rockets' });
  const sportsSecond = game({ id: 'sports-25', date: '2026-10-25', time: null, away: '16U AA Jr Mets', home: 'Tacoma Rockets' });
  const previous = state({
    nwahlGames: [nwahlFirst, nwahlSecond],
    sportsEngineGames: [sportsFirst, sportsSecond],
    travelPageGames: [],
  });
  const current = state({
    ...previous,
    nwahlGames: [{ ...nwahlFirst, time: '15:15:00' }, nwahlSecond],
    nwahlTeamHash: 'new-hash',
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'group');
});

test('adding a matching venue to one of two duplicate NWAHL games does not create a group discrepancy', () => {
  const first = game({ id: 'nwahl-377', date: '2027-01-09', time: null, away: team, home: 'Portland Jr Winterhawks', rink: null, city: null });
  const second = game({ ...first, id: 'nwahl-378' });
  const sportsFirst = game({ ...first, id: 'sports-9', away: '16U AA Jr Mets', rink: '1 North Center Court, Portland, OR' });
  const sportsSecond = game({ ...sportsFirst, id: 'sports-10', date: '2027-01-10' });
  const previous = state({ nwahlGames: [first, second], sportsEngineGames: [sportsFirst, sportsSecond], travelPageGames: [] });
  const current = state({
    ...previous,
    nwahlGames: [{ ...first, rink: 'Veterans Memorial Coliseum' }, second],
    nwahlTeamHash: 'new-hash',
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('adding a matching venue to both duplicate NWAHL games does not create a group discrepancy', () => {
  const first = game({ id: 'nwahl-377', date: '2027-01-09', time: null, away: team, home: 'Portland Jr Winterhawks', rink: null, city: null });
  const second = game({ ...first, id: 'nwahl-378' });
  const sportsFirst = game({ ...first, id: 'sports-9', away: '16U AA Jr Mets', rink: '1 North Center Court, Portland, OR' });
  const sportsSecond = game({ ...sportsFirst, id: 'sports-10', date: '2027-01-10' });
  const previous = state({ nwahlGames: [first, second], sportsEngineGames: [sportsFirst, sportsSecond], travelPageGames: [] });
  const current = state({
    ...previous,
    nwahlGames: [
      { ...first, rink: 'Veterans Memorial Coliseum' },
      { ...second, rink: 'Veterans Memorial Coliseum' },
    ],
    nwahlTeamHash: 'new-hash',
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('city and punctuation cleanup on duplicate NWAHL games does not create a group discrepancy', () => {
  const first = game({ id: 'nwahl-377', date: '2027-01-09', time: null, away: team, home: 'Portland Jr Winterhawks', rink: null, city: null });
  const second = game({ ...first, id: 'nwahl-378' });
  const sportsFirst = game({ ...first, id: 'sports-9', away: '16U AA Jr Mets', city: 'Portland' });
  const sportsSecond = game({ ...sportsFirst, id: 'sports-10', date: '2027-01-10' });
  const previous = state({ nwahlGames: [first, second], sportsEngineGames: [sportsFirst, sportsSecond], travelPageGames: [] });
  const current = state({
    ...previous,
    nwahlGames: [
      { ...first, home: 'Portland Jr. Winterhawks' },
      { ...second, city: 'Portland' },
    ],
    nwahlTeamHash: 'new-hash',
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('adding harmless venue detail to a duplicate travel-page game does not alert Gordon', () => {
  const sourceFirst = game({ id: 'source-1', date: '2027-01-09', time: null, away: team, home: 'Portland Jr Winterhawks', rink: 'Veterans Memorial Coliseum' });
  const sourceSecond = game({ ...sourceFirst, id: 'source-2', date: '2027-01-10' });
  const pageFirst = game({ ...sourceFirst, id: 'portland:1', rink: null, tripId: 'portland', tripStart: '2027-01-08', tripEnd: '2027-01-11' });
  const pageDuplicate = game({ ...pageFirst, id: 'portland:2' });
  const previous = state({ nwahlGames: [sourceFirst, sourceSecond], sportsEngineGames: [sourceFirst, sourceSecond], travelPageGames: [pageFirst, pageDuplicate] });
  const current = state({ ...previous, travelPageGames: [{ ...pageFirst, rink: 'Veterans Memorial Coliseum' }, pageDuplicate] });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('maximum matching prevents wildcard venue order from creating a removal alert', () => {
  const exact = game({ id: 'page-exact', rink: 'Tacoma Twin Rinks', tripId: 'tacoma', tripStart: '2026-09-24', tripEnd: '2026-09-28' });
  const wildcard = game({ ...exact, id: 'page-wildcard', rink: null });
  const removed = game({ ...wildcard, id: 'page-removed' });
  const otherExact = game({ ...exact, id: 'source-exact' });
  const otherDifferent = game({ ...exact, id: 'source-other', rink: 'Sprinker Recreation Center' });
  const previous = state({ nwahlGames: [otherExact, otherDifferent], sportsEngineGames: [otherExact, otherDifferent], travelPageGames: [wildcard, exact, removed] });
  const current = state({ ...previous, travelPageGames: [wildcard, exact] });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'match');
});

test('moving one of two same-day NWAHL games is not masked by a standing weekend discrepancy', () => {
  const nwahlFirst = game({ id: 'nwahl-243', date: '2026-10-24', time: null, away: team, home: 'Tacoma Rockets' });
  const nwahlSecond = game({ id: 'nwahl-244', date: '2026-10-24', time: null, away: team, home: 'Tacoma Rockets' });
  const sportsFirst = game({ id: 'sports-24', date: '2026-10-24', time: null, away: '16U AA Jr Mets', home: 'Tacoma Rockets' });
  const sportsSecond = game({ id: 'sports-25', date: '2026-10-25', time: null, away: '16U AA Jr Mets', home: 'Tacoma Rockets' });
  const previous = state({ nwahlGames: [nwahlFirst, nwahlSecond], sportsEngineGames: [sportsFirst, sportsSecond], travelPageGames: [] });
  const current = state({
    ...previous,
    nwahlGames: [{ ...nwahlFirst, date: '2026-10-31' }, nwahlSecond],
    nwahlTeamHash: 'new-hash',
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'group');
});

test('removing one of two same-day NWAHL games is not masked by a standing weekend discrepancy', () => {
  const nwahlFirst = game({ id: 'nwahl-243', date: '2026-10-24', time: null, away: team, home: 'Tacoma Rockets' });
  const nwahlSecond = game({ id: 'nwahl-244', date: '2026-10-24', time: null, away: team, home: 'Tacoma Rockets' });
  const sportsFirst = game({ id: 'sports-24', date: '2026-10-24', time: null, away: '16U AA Jr Mets', home: 'Tacoma Rockets' });
  const sportsSecond = game({ id: 'sports-25', date: '2026-10-25', time: null, away: '16U AA Jr Mets', home: 'Tacoma Rockets' });
  const previous = state({ nwahlGames: [nwahlFirst, nwahlSecond], sportsEngineGames: [sportsFirst, sportsSecond], travelPageGames: [] });
  const current = state({ ...previous, nwahlGames: [nwahlSecond], nwahlTeamHash: 'new-hash' });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'group');
});

test('resolving one discrepancy does not mask a different NWAHL change in the same run', () => {
  const first = game({ id: 'nwahl-first', date: '2026-10-30', time: '13:45:00', away: team, home: 'Spokane Jr Chiefs' });
  const second = game({ id: 'nwahl-second', date: '2026-11-01', time: '11:30:00', away: team, home: 'Spokane Jr Chiefs' });
  const sportsFirst = game({ ...first, id: 'sports-first', away: '16U AA Jr Mets' });
  const sportsSecond = game({ ...second, id: 'sports-second', away: '16U AA Jr Mets', time: '09:45:00' });
  const previous = state({ nwahlGames: [first, second], sportsEngineGames: [sportsFirst, sportsSecond], travelPageGames: [] });
  const current = state({
    ...previous,
    nwahlGames: [{ ...first, time: '14:45:00' }, { ...second, time: '09:45:00' }],
    nwahlTeamHash: 'new-hash',
  });

  const result = classifyScheduleChanges(previous, current);
  assert.equal(result.kind, 'group');
  assert.deepEqual(result.groupNwahlIds, ['nwahl-first']);
});

test('the past-game cutoff uses the Pacific calendar date', () => {
  const nwahl = game({ date: '2026-09-27' });
  const sports = game({ date: '2026-09-27', home: '16U AA Jr Mets' });
  const previous = state({
    nwahlGames: [nwahl], sportsEngineGames: [sports],
    travelPageGames: [game({ id: 'page-future', date: '2026-09-27', tripStart: '2026-09-26', tripEnd: '2026-09-28' })],
  });
  const current = state({
    ...previous,
    checkedAt: '2026-09-27T01:00:00.000Z',
    travelPageGames: [],
  });

  assert.equal(classifyScheduleChanges(previous, current).kind, 'owner');
});

test('SportsEngine ignores gameday events and accepts versus game titles', () => {
  const calendar = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:not-game@sportsengine.com\nDTSTART;TZID=America/Los_Angeles:20260924T170000\nSUMMARY:Practice\nDESCRIPTION:type%3Dgameday%26team_id%3Dx\nEND:VEVENT\nBEGIN:VEVENT\nUID:versus@sportsengine.com\nDTSTART;TZID=America/Los_Angeles:20260925T151500\nSUMMARY:16U AA Jr Mets vs. Team Wyoming\nDESCRIPTION:type%3Dgame%26team_id%3Dx\nEND:VEVENT\nEND:VCALENDAR`;
  const games = parseSportsEngineCalendar(calendar);
  assert.equal(games.length, 1);
  assert.equal(games[0].away, 'Team Wyoming');
  assert.equal(games[0].home, '16U AA Jr Mets');
});
