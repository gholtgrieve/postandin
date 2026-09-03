import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const TEAM = 'Seattle Jr. Mets 16AA';
const TRAVEL_SUPER_WEEKENDS = new Set([12, 20, 21, 43]);
const ADDITIONAL_TRAVEL_DATES = new Set(['2027-01-09', '2027-01-30']);
const DEFAULT_API = 'https://nwahl-portal.onrender.com/api/nwahl/public/schedule';

export function selectTravelGames(payload) {
  const games = [];
  for (const entry of payload.entries ?? []) {
    const includesTeam = entry.team_name === TEAM || entry.opponent_team_name === TEAM;
    const weekendDate = String(entry.weekend_date ?? '').slice(0, 10);
    const isTravel = TRAVEL_SUPER_WEEKENDS.has(entry.super_weekend_id) || ADDITIONAL_TRAVEL_DATES.has(weekendDate);
    if (!includesTeam || !isTravel) continue;
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
  const current = selectTravelGames(payload);
  const currentTeamHash = fingerprintTeamSchedule(payload);
  if (JSON.stringify(current) !== JSON.stringify(baseline) || currentTeamHash !== baselineTeamHash) {
    console.error('The NWAHL travel schedule differs from the reviewed baseline.');
    console.error('\nReviewed baseline:\n', JSON.stringify(baseline, null, 2));
    console.error('\nCurrent NWAHL schedule:\n', JSON.stringify(current, null, 2));
    console.error('\nReviewed full-team fingerprint:', baselineTeamHash);
    console.error('Current full-team fingerprint:', currentTeamHash);
    console.error('\nCurrent full-team schedule:\n', JSON.stringify(selectTeamEntries(payload), null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`NWAHL travel schedule matches the reviewed baseline (${current.length} games).`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
