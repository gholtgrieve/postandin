import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const TEAM = 'Seattle Jr. Mets 16AA';
const DEFAULT_API = 'https://nwahl-portal.onrender.com/api/nwahl/public/schedule';
const REPORT_PATH = process.env.NWAHL_REPORT_PATH;
const ERROR_REPORT_PATH = process.env.NWAHL_ERROR_REPORT_PATH;

export function selectTeamGames(payload) {
  const games = [];
  for (const entry of payload.entries ?? []) {
    const includesTeam = entry.team_name === TEAM || entry.opponent_team_name === TEAM;
    if (!includesTeam) continue;
    for (const game of entry.games ?? []) {
      games.push({
        id: String(game.id), date: game.game_date ?? null, time: game.start_time ?? null,
        home: entry.team_name ?? null, away: entry.opponent_team_name ?? null,
        rink: game.rink_name ?? entry.rink_name ?? null, city: game.rink_city ?? entry.rink_city ?? null,
      });
    }
  }
  return games.sort((a, b) => [a.date ?? '', a.time ?? '', a.id].join('|').localeCompare([b.date ?? '', b.time ?? '', b.id].join('|')));
}

export function selectTeamEntries(payload) {
  return (payload.entries ?? [])
    .filter(entry => entry.team_name === TEAM || entry.opponent_team_name === TEAM)
    .map(entry => ({
      id: String(entry.id),
      weekendDate: String(entry.weekend_date ?? '').slice(0, 10) || null,
      superWeekendId: entry.super_weekend_id ?? null,
      status: entry.status ?? null,
      home: entry.team_name ?? null,
      away: entry.opponent_team_name ?? null,
      gamesCount: entry.games_count ?? null,
      rink: entry.rink_name ?? null,
      city: entry.rink_city ?? null,
      games: (entry.games ?? []).map(game => ({
        id: String(game.id),
        date: game.game_date ?? null,
        time: game.start_time ?? null,
        rink: game.rink_name ?? null,
        city: game.rink_city ?? null,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function fingerprintTeamSchedule(payload) {
  return createHash('sha256').update(JSON.stringify(selectTeamEntries(payload))).digest('hex');
}

function displayDate(value) {
  if (!value) return 'date TBD';
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function displayTime(value) {
  if (!value) return 'time TBD';
  const [hours, minutes] = value.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function gameSummary(game) {
  const rink = game.rink ? ` at ${game.rink}${game.city ? ` in ${game.city}` : ''}` : ' (rink TBD)';
  return `${displayDate(game.date)}, ${displayTime(game.time)} — ${game.away} at ${game.home}${rink}`;
}

export function buildChangeReport(baseline, current) {
  const before = new Map(baseline.map(game => [game.id, game]));
  const after = new Map(current.map(game => [game.id, game]));
  const changes = [];

  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const oldGame = before.get(id);
    const newGame = after.get(id);
    if (!oldGame) {
      changes.push(`New game added: ${gameSummary(newGame)}.`);
      continue;
    }
    if (!newGame) {
      changes.push(`Game removed: ${gameSummary(oldGame)}.`);
      continue;
    }

    const details = [];
    if (oldGame.date !== newGame.date) details.push(`date changed from ${displayDate(oldGame.date)} to ${displayDate(newGame.date)}`);
    if (oldGame.time !== newGame.time) details.push(`time changed from ${displayTime(oldGame.time)} to ${displayTime(newGame.time)}`);
    if (oldGame.away !== newGame.away || oldGame.home !== newGame.home) details.push(`matchup changed from ${oldGame.away} at ${oldGame.home} to ${newGame.away} at ${newGame.home}`);
    if (oldGame.rink !== newGame.rink || oldGame.city !== newGame.city) {
      const oldRink = oldGame.rink ? `${oldGame.rink}${oldGame.city ? ` in ${oldGame.city}` : ''}` : 'TBD';
      const newRink = newGame.rink ? `${newGame.rink}${newGame.city ? ` in ${newGame.city}` : ''}` : 'TBD';
      details.push(`rink changed from ${oldRink} to ${newRink}`);
    }
    if (details.length) changes.push(`${displayDate(newGame.date)} — ${newGame.away} at ${newGame.home}: ${details.join('; ')}.`);
  }

  const list = changes.length
    ? changes.map(change => `• ${change}`).join('\n')
    : '• NWAHL changed a weekend-level schedule detail. No individual game date, time, opponent, or rink changed.';

  return `Hello,\n\nThe official NWAHL schedule for Seattle Junior Mets 16U AA has changed.\n\nWhat changed:\n${list}\n\nYou can check the official schedule for the latest information:\nhttps://www.nwahl.net/game-schedule.html.\n`;
}

async function writeReport(path, text) {
  if (path) await fs.writeFile(path, text, 'utf8');
}

async function setWorkflowResult(kind) {
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `kind=${kind}\n`, 'utf8');
}

async function fetchSchedule(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`NWAHL schedule request failed with status ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function main() {
  const baseline = JSON.parse(await fs.readFile(new URL('../data/nwahl-mets-16aa-travel.json', import.meta.url), 'utf8'));
  const baselineTeamHash = (await fs.readFile(new URL('../data/nwahl-mets-16aa-team.sha256', import.meta.url), 'utf8')).trim();
  const payload = await fetchSchedule(process.env.NWAHL_SCHEDULE_API ?? DEFAULT_API);
  const current = selectTeamGames(payload);
  const currentTeamHash = fingerprintTeamSchedule(payload);
  if (JSON.stringify(current) !== JSON.stringify(baseline) || currentTeamHash !== baselineTeamHash) {
    await writeReport(REPORT_PATH, buildChangeReport(baseline, current));
    await setWorkflowResult('change');
    console.error('The NWAHL team schedule differs from the reviewed baseline.');
    console.error('\nReviewed baseline:\n', JSON.stringify(baseline, null, 2));
    console.error('\nCurrent NWAHL schedule:\n', JSON.stringify(current, null, 2));
    console.error('\nReviewed full-team fingerprint:', baselineTeamHash);
    console.error('Current full-team fingerprint:', currentTeamHash);
    console.error('\nCurrent full-team schedule:\n', JSON.stringify(selectTeamEntries(payload), null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`NWAHL team schedule matches the reviewed baseline (${current.length} games).`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await main();
  } catch {
    await writeReport(ERROR_REPORT_PATH, `Hello,\n\nWe could not check the official NWAHL schedule today, so no schedule change has been confirmed.\n\nThe automatic check will try again tomorrow. You can review the official schedule here in the meantime:\nhttps://www.nwahl.net/game-schedule.html.\n`);
    await setWorkflowResult('error');
    console.error('The NWAHL schedule check could not complete after three attempts.');
    process.exitCode = 1;
  }
}
