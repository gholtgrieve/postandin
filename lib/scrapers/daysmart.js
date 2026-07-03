// DaySmart scraper — server-side port of the client-side fetchDaySmart().
// Returns sessions as { id, start, end, title, subtitle, spots, price, soldOut, bookUrl }
// where start/end are ISO strings (parsed to Date objects by the client).

export async function scrapeDaySmart({ company, sportId, resourceIds }) {
  const today = new Date().toISOString().slice(0, 10);
  const [data, rdata] = await Promise.all([
    dsGet(`https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events?filter[homeTeam.sport_id__in]=${sportId}&company=${company}&filter[start__gte]=${today}&page[size]=200`),
    dsGet(`https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/resources?company=${company}`),
  ]);

  const now = new Date();
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

  const iceNames = /ice|rink|sheet|olympic|cascade|rainier/i;

  return (data?.data ?? [])
    .filter(ev => {
      if (ev.attributes?.event_type_id === 'L') return false;
      if (resourceIds?.length) {
        const rid = Number(ev.attributes?.resource_id);
        if (!resourceIds.includes(rid)) return false;
      }
      const text = [
        ev.attributes?.best_description,
        ev.attributes?.desc,
        ev.attributes?.name,
        ev.attributes?.title,
      ].filter(Boolean).join(" ").toLowerCase().replace(/<[^>]+>/g, "");
      if (text.includes("learn to play")) return false;
      return text.includes("stick") || text.includes("s&p") || text.includes("s & p") || text.includes("full hockey gear");
    })
    .map(ev => {
      const a = ev.attributes ?? {};
      const start = a.start ?? a.startTime ?? a.start_time;
      const end   = a.end   ?? a.endTime   ?? a.end_time;
      const resourceName = resourceMap[String(a.resource_id)];
      const location = resourceName && iceNames.test(resourceName) ? resourceName : null;
      const leagueName = leagueMap[a.league_id] ?? null;
      const _leagueStripped = leagueName
        ? leagueName.replace(/^(LTP\s+Family\s+)?Stick\s*[&n]\s*(Puck\s*)?/i, '').replace(/^\(|\)$/g, '').trim()
        : '';
      const subtitle = _leagueStripped && /under|over|\d+[u+]|female|non-binary|women|adult|family/i.test(_leagueStripped)
        ? _leagueStripped
        : null;
      const startDate = start ? new Date(start).toISOString().slice(0, 10) : null;
      return {
        id:      ev.id,
        start:   start ?? null,
        end:     end ?? null,
        title:   location ? `Stick & Puck — ${location}` : "Stick & Puck",
        subtitle,
        spots:   null,
        price:   null,
        soldOut: false,
        bookUrl: startDate ? `https://apps.daysmartrecreation.com/dash/x/#/online/${company}/event-registration?date=${startDate}` : null,
      };
    })
    .filter(s => !!s.start)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

async function dsGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DaySmart HTTP ${res.status}`);
  return res.json();
}
