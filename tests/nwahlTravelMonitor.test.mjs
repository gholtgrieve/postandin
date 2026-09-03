import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintTeamSchedule, selectTravelGames } from '../scripts/check-nwahl-travel.mjs';

test('selectTravelGames includes travel weekends and excludes home series', () => {
  const base = { team_name: 'Seattle Jr. Mets 16AA', opponent_team_name: 'Example Team', rink_name: 'Entry Rink', rink_city: 'Entry City' };
  const payload = { entries: [
    { ...base, weekend_date: '2026-09-25', super_weekend_id: 21, games: [{ id: 2, game_date: '2026-09-25', start_time: '13:30:00' }] },
    { ...base, weekend_date: '2026-11-07', super_weekend_id: null, games: [{ id: 3, game_date: '2026-11-07' }] },
    { ...base, weekend_date: '2027-01-09', super_weekend_id: null, games: [{ id: 1, game_date: '2027-01-09', rink_name: 'Game Rink', rink_city: 'Game City' }] },
  ] };

  assert.deepEqual(selectTravelGames(payload), [
    { id: '2', date: '2026-09-25', time: '13:30:00', home: 'Seattle Jr. Mets 16AA', away: 'Example Team', rink: 'Entry Rink', city: 'Entry City' },
    { id: '1', date: '2027-01-09', time: null, home: 'Seattle Jr. Mets 16AA', away: 'Example Team', rink: 'Game Rink', city: 'Game City' },
  ]);
});

test('selectTravelGames preserves the feed home and away sides and excludes other teams', () => {
  const team = 'Seattle Jr. Mets 16AA';
  const payload = { entries: [
    {
      team_name: 'Cascade Selects', opponent_team_name: team, weekend_date: '2027-01-30',
      super_weekend_id: null, rink_name: 'The RRRink', rink_city: 'Medford',
      games: [{ id: 10, game_date: '2027-01-30' }, { id: 11, game_date: '2027-01-30' }],
    },
    {
      team_name: 'Other Home', opponent_team_name: 'Other Away', weekend_date: '2026-09-25',
      super_weekend_id: 21, games: [{ id: 12, game_date: '2026-09-25' }],
    },
  ] };

  assert.deepEqual(selectTravelGames(payload), [
    { id: '10', date: '2027-01-30', time: null, home: 'Cascade Selects', away: team, rink: 'The RRRink', city: 'Medford' },
    { id: '11', date: '2027-01-30', time: null, home: 'Cascade Selects', away: team, rink: 'The RRRink', city: 'Medford' },
  ]);
});

test('full-team fingerprint detects new weekends, status changes, and rink moves', () => {
  const entry = {
    id: 1, team_name: 'Seattle Jr. Mets 16AA', opponent_team_name: 'Example Team',
    weekend_date: '2027-02-20', super_weekend_id: 99, status: 'committed', games_count: 1,
    rink_name: 'Example Rink', rink_city: 'Seattle', games: [{ id: 2, game_date: '2027-02-20' }],
  };
  const original = fingerprintTeamSchedule({ entries: [entry] });

  assert.notEqual(fingerprintTeamSchedule({ entries: [entry, { ...entry, id: 3 }] }), original);
  assert.notEqual(fingerprintTeamSchedule({ entries: [{ ...entry, status: 'cancelled' }] }), original);
  assert.notEqual(fingerprintTeamSchedule({ entries: [{ ...entry, rink_city: 'Portland' }] }), original);
});

test('full-team fingerprint is stable when entries and games are reordered', () => {
  const team = 'Seattle Jr. Mets 16AA';
  const first = {
    id: 2, team_name: team, opponent_team_name: 'First Opponent', weekend_date: '2027-02-20',
    status: 'committed', games: [{ id: 22, game_date: '2027-02-21' }, { id: 21, game_date: '2027-02-20' }],
  };
  const second = {
    id: 1, team_name: 'Second Opponent', opponent_team_name: team, weekend_date: '2027-02-13',
    status: 'committed', games: [{ id: 12, game_date: '2027-02-14' }, { id: 11, game_date: '2027-02-13' }],
  };

  const ordered = fingerprintTeamSchedule({ entries: [first, second] });
  const reordered = fingerprintTeamSchedule({
    entries: [
      { ...second, games: [...second.games].reverse() },
      { ...first, games: [...first.games].reverse() },
    ],
  });

  assert.equal(reordered, ordered);
});
