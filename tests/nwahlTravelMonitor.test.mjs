import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildChangeReport, fingerprintTeamSchedule, selectTeamGames } from '../scripts/check-nwahl-travel.mjs';

async function runMonitor({ payload, baseline, hash, invalidFixture = false }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nwahl-monitor-'));
  const baselinePath = path.join(tempDir, 'baseline.json');
  const hashPath = path.join(tempDir, 'baseline.sha256');
  const fixturePath = path.join(tempDir, 'schedule.json');
  const outputPath = path.join(tempDir, 'github-output.txt');
  const reportPath = path.join(tempDir, 'change-report.txt');
  const errorPath = path.join(tempDir, 'error-report.txt');
  await Promise.all([
    fs.writeFile(baselinePath, JSON.stringify(baseline), 'utf8'),
    fs.writeFile(hashPath, `${hash}\n`, 'utf8'),
    fs.writeFile(fixturePath, invalidFixture ? '{' : JSON.stringify(payload), 'utf8'),
  ]);

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['scripts/check-nwahl-travel.mjs'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputPath,
          NWAHL_BASELINE_PATH: baselinePath,
          NWAHL_TEAM_HASH_PATH: hashPath,
          NWAHL_REPORT_PATH: reportPath,
          NWAHL_ERROR_REPORT_PATH: errorPath,
          NWAHL_SCHEDULE_FIXTURE_PATH: fixturePath,
        },
      });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', code => resolve({ code, stderr }));
    });
    const output = await fs.readFile(outputPath, 'utf8');
    const [reportExists, errorExists] = await Promise.all([
      fs.access(reportPath).then(() => true, () => false),
      fs.access(errorPath).then(() => true, () => false),
    ]);
    const report = await fs.readFile(reportExists ? reportPath : errorPath, 'utf8').catch(() => '');
    return { ...result, output, report, reportExists, errorExists };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

const monitorPayload = {
  entries: [{
    id: 1,
    team_name: 'Seattle Jr. Mets 16AA',
    opponent_team_name: 'Example Team',
    weekend_date: '2026-11-22',
    status: 'committed',
    games_count: 1,
    rink_name: 'Example Rink',
    rink_city: 'Seattle',
    games: [{ id: 10, game_date: '2026-11-22', start_time: '13:45:00' }],
  }],
};
const monitorBaseline = selectTeamGames(monitorPayload);
const monitorHash = fingerprintTeamSchedule(monitorPayload);

test('selectTeamGames includes travel weekends and home series', () => {
  const base = { team_name: 'Seattle Jr. Mets 16AA', opponent_team_name: 'Example Team', rink_name: 'Entry Rink', rink_city: 'Entry City' };
  const payload = { entries: [
    { ...base, weekend_date: '2026-09-25', super_weekend_id: 21, games: [{ id: 2, game_date: '2026-09-25', start_time: '13:30:00' }] },
    { ...base, weekend_date: '2026-11-07', super_weekend_id: null, games: [{ id: 3, game_date: '2026-11-07' }] },
    { ...base, weekend_date: '2027-01-09', super_weekend_id: null, games: [{ id: 1, game_date: '2027-01-09', rink_name: 'Game Rink', rink_city: 'Game City' }] },
  ] };

  assert.deepEqual(selectTeamGames(payload), [
    { id: '2', date: '2026-09-25', time: '13:30:00', home: 'Seattle Jr. Mets 16AA', away: 'Example Team', rink: 'Entry Rink', city: 'Entry City' },
    { id: '3', date: '2026-11-07', time: null, home: 'Seattle Jr. Mets 16AA', away: 'Example Team', rink: 'Entry Rink', city: 'Entry City' },
    { id: '1', date: '2027-01-09', time: null, home: 'Seattle Jr. Mets 16AA', away: 'Example Team', rink: 'Game Rink', city: 'Game City' },
  ]);
});

test('selectTeamGames preserves the feed home and away sides and excludes other teams', () => {
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

  assert.deepEqual(selectTeamGames(payload), [
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

test('change report explains schedule differences in plain language', () => {
  const original = { id: '1', date: '2026-10-30', time: '18:45:00', home: 'Spokane Jr Chiefs', away: 'Seattle Jr. Mets 16AA', rink: 'EWU', city: 'Cheney' };
  const changed = { ...original, time: '13:45:00' };
  const added = { id: '2', date: '2027-02-20', time: null, home: 'Boise', away: 'Seattle Jr. Mets 16AA', rink: null, city: null };
  const report = buildChangeReport([original], [changed, added]);

  assert.match(report, /time changed from 6:45 PM to 1:45 PM/);
  assert.match(report, /New game added: Sat, Feb 20, 2027, time TBD/);
  assert.match(report, /You can check the official schedule for the latest information/);
  assert.doesNotMatch(report, /travel page will be updated/i);
  assert.doesNotMatch(report, /fingerprint|baseline|workflow|JSON/i);
});

test('monitor reports a matching schedule as a successful match', async () => {
  const result = await runMonitor({ payload: monitorPayload, baseline: monitorBaseline, hash: monitorHash });

  assert.equal(result.code, 0);
  assert.match(result.output, /^kind=match$/m);
  assert.equal(result.report, '');
  assert.equal(result.reportExists, false);
  assert.equal(result.errorExists, false);
});

test('monitor reports a confirmed change without failing the process', async () => {
  const staleBaseline = monitorBaseline.map(game => ({ ...game, time: '16:45:00' }));
  const result = await runMonitor({ payload: monitorPayload, baseline: staleBaseline, hash: monitorHash });

  assert.equal(result.code, 0);
  assert.match(result.output, /^kind=change$/m);
  assert.match(result.report, /time changed from 4:45 PM to 1:45 PM/);
  assert.equal(result.reportExists, true);
  assert.equal(result.errorExists, false);
});

test('monitor reports an upstream error and fails the process', async () => {
  const result = await runMonitor({
    payload: { error: 'unavailable' },
    baseline: monitorBaseline,
    hash: monitorHash,
    invalidFixture: true,
  });

  assert.equal(result.code, 1);
  assert.match(result.output, /^kind=error$/m);
  assert.match(result.report, /could not check the official NWAHL schedule today/i);
  assert.equal(result.reportExists, false);
  assert.equal(result.errorExists, true);
});
