// DaySmart scraper — server-side port of the client-side fetchDaySmart().
// Returns normalized Stick & Puck sessions by default. Callers may opt into
// Drop-in Hockey by passing it in `activities`.
// where start/end are ISO strings (parsed to Date objects by the client).

import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_STICK_AND_PUCK,
  activitySet,
  classifyDaySmartActivity,
  daySmartDropInDetails,
  eligibility,
} from '../activities.js';

export async function scrapeDaySmart(
  { company, sportId, resourceIds },
  { activities } = {},
) {
  const today = new Date().toISOString().slice(0, 10);
  const [data, rdata] = await Promise.all([
    dsGet(`https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events?filter[homeTeam.sport_id__in]=${sportId}&company=${company}&filter[start__gte]=${today}&page[size]=200`),
    dsGet(`https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/resources?company=${company}`),
  ]);

  const resourceMap = {};
  (rdata?.data ?? []).forEach(r => { resourceMap[r.id] = r.attributes?.name?.trim(); });

  const leagueIds = [...new Set((data?.data ?? []).map(ev => ev.attributes?.league_id).filter(Boolean))];
  const leagueMap = {};
  await Promise.all(leagueIds.map(async id => {
    try {
      const ld = await dsGet(`https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/leagues/${id}?company=${company}`);
      leagueMap[id] = ld?.data?.attributes?.name ?? null;
    } catch { leagueMap[id] = null; }
  }));

  return normalizeDaySmartEvents({
    events: data?.data ?? [],
    leagueMap,
    resourceMap,
    company,
    resourceIds,
    activities,
  });
}

export function normalizeDaySmartEvents({
  events,
  leagueMap,
  resourceMap = {},
  company,
  resourceIds,
  activities,
}) {
  const requested = activitySet(activities);
  const sessions = events
    .filter(ev => {
      if (ev.attributes?.event_type_id === 'L') return false;
      if (resourceIds?.length) {
        const rid = Number(ev.attributes?.resource_id);
        if (!resourceIds.includes(rid)) return false;
      }
      const a = ev.attributes ?? {};
      const leagueName = leagueMap[a.league_id] ?? null;
      const activity = classifyDaySmartActivity({
        company,
        leagueName,
        eventText: eventText(a),
      });
      return activity && requested.has(activity);
    })
    .map(ev => {
      const a = ev.attributes ?? {};
      const start = a.start ?? a.startTime ?? a.start_time;
      const end   = a.end   ?? a.endTime   ?? a.end_time;
      const resourceName = resourceMap[String(a.resource_id)];
      const leagueName = leagueMap[a.league_id] ?? null;
      const activity = classifyDaySmartActivity({
        company,
        leagueName,
        eventText: eventText(a),
      });
      const location = resourceName && /ice|rink|sheet|olympic|cascade|rainier/i.test(resourceName)
        ? resourceName
        : null;
      const _leagueStripped = leagueName
        ? leagueName.replace(/^(LTP\s+Family\s+)?Stick\s*[&n]\s*(Puck\s*)?/i, '').replace(/^\(|\)$/g, '').trim()
        : '';
      const stickSubtitle = _leagueStripped && /under|over|\d+[u+]|female|non-binary|women|adult|family/i.test(_leagueStripped)
        ? _leagueStripped
        : null;
      const details = activity === ACTIVITY_DROP_IN_HOCKEY
        ? daySmartDropInDetails(company, leagueName)
        : { subtitle: stickSubtitle, eligibility: eligibility() };
      const startDate = start ? new Date(start).toISOString().slice(0, 10) : null;
      const role = registrationRole(a.desc);
      const sourceLabel = leagueName ?? firstLabel(a) ?? (
        activity === ACTIVITY_STICK_AND_PUCK ? 'Stick & Puck' : 'Drop-in Hockey'
      );
      return {
        id:      ev.id,
        start:   start ?? null,
        end:     end ?? null,
        title:   activity === ACTIVITY_STICK_AND_PUCK
          ? (location ? `Stick & Puck — ${location}` : 'Stick & Puck')
          : sourceLabel,
        subtitle: details.subtitle,
        spots:   null,
        price:   null,
        soldOut: false,
        bookUrl: startDate ? `https://apps.daysmartrecreation.com/dash/x/#/online/${company}/event-registration?date=${startDate}` : null,
        activity,
        sourceLabel,
        eligibility: details.eligibility,
        registration: {
          required: null,
          method: 'online',
          capacity: role ? null : numberOrNull(a.register_capacity),
          spots: null,
          goalieSpots: null,
          roles: role
            ? { [role]: { capacity: numberOrNull(a.register_capacity) } }
            : {},
        },
        cancelled: false,
        _daySmart: {
          company,
          leagueId: a.league_id ?? null,
          resourceId: a.resource_id ?? null,
          role,
          roleBase: roleBase(a.desc),
        },
      };
    })
    .filter(s => !!s.start);

  return combineDaySmartRoleSessions(sessions)
    .map(stripInternalFields)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function combineDaySmartRoleSessions(sessions) {
  const grouped = new Map();
  const passthrough = [];

  for (const session of sessions) {
    const meta = session._daySmart;
    if (
      session.activity !== ACTIVITY_DROP_IN_HOCKEY ||
      !meta?.leagueId ||
      !meta.role ||
      !meta.roleBase
    ) {
      passthrough.push(session);
      continue;
    }
    const key = [
      meta.company,
      meta.leagueId,
      meta.resourceId,
      session.start,
      session.end ?? '',
      meta.roleBase,
    ].join('|');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }

  for (const matches of grouped.values()) {
    const roles = new Set(matches.map(s => s._daySmart.role));
    if (!(roles.has('skater') && roles.has('goalie'))) {
      passthrough.push(...matches);
      continue;
    }

    const primary = matches.find(s => s._daySmart.role === 'skater') ?? matches[0];
    const meta = primary._daySmart;
    const registrationRoles = {};
    for (const match of matches) {
      const role = match._daySmart.role;
      registrationRoles[role] = match.registration.roles[role];
    }
    passthrough.push({
      ...primary,
      id: `daysmart-${meta.company}-${meta.leagueId}-${meta.resourceId}-${primary.start}`,
      registration: {
        ...primary.registration,
        capacity: null,
        roles: registrationRoles,
      },
      sourceIds: matches.map(s => String(s.id)).sort(),
    });
  }

  return passthrough;
}

async function dsGet(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`DaySmart HTTP ${res.status}`);
  return res.json();
}

function eventText(a) {
  return [
    a.best_description,
    a.desc,
    a.name,
    a.title,
  ].filter(Boolean).join(' ');
}

function firstLabel(a) {
  return [a.desc, a.name, a.title]
    .map(value => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .find(Boolean) ?? null;
}

function registrationRole(desc) {
  const match = String(desc ?? '').match(/^\s*(Skater|Goalie)\s*-\s*/i);
  return match ? match[1].toLowerCase() : null;
}

function roleBase(desc) {
  const role = registrationRole(desc);
  if (!role) return null;
  return String(desc).replace(/^\s*(Skater|Goalie)\s*-\s*/i, '').trim().toLowerCase();
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stripInternalFields(session) {
  const { _daySmart, ...publicSession } = session;
  return publicSession;
}
