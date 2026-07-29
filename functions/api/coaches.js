import { readThrough } from '../../lib/kvCache.js';

const FRESH_MS   = 5 * 60 * 1000;
const STALE_TTL_S = 24 * 60 * 60;

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
};

function safeUrl(u) {
  try {
    const parsed = new URL(u, 'https://placeholder.invalid');
    return ['http:', 'https:'].includes(parsed.protocol) ? u : '#';
  } catch {
    return '#';
  }
}

function mapRecord(r) {
  const f = r.fields ?? {};
  return {
    id: r.id,
    name:               f.name ?? '',
    slug:               f.slug ?? '',
    cert:               f.cert ?? '',
    specialty:          f.specialty ?? [],
    age_groups:         f.age_groups ?? [],
    levels:             f.levels ?? [],
    rinks:              f.rinks ?? [],
    private_lessons:    f.private_lessons ?? false,
    lessons_detail:     f.lessons_detail ?? '',
    bio:                f.bio ?? '',
    teaser:             f.teaser ?? '',
    teams_coached:      f.teams_coached ?? '',
    headshot_url:       f.headshot_url ?? '',
    photo_urls:         f.photo_urls ?? '',
    personal_url:       safeUrl(f.personal_url ?? ''),
    initials:           f.initials ?? '',
  };
}

async function fetchLiveCoaches(apiKey, baseId) {
  const coaches = [];
  let offset = null;
  do {
    const params = new URLSearchParams({ filterByFormula: '{status} = "Live"' });
    if (offset) params.set('offset', offset);
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Coaches?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Airtable HTTP ${res.status}`);
    const data = await res.json();
    coaches.push(...(data.records ?? []).map(mapRecord));
    offset = data.offset ?? null;
  } while (offset);
  return coaches;
}

export async function onRequest(context) {
  try {
    const { env } = context;
    const apiKey  = env.AIRTABLE_API_KEY;
    const baseId  = env.AIRTABLE_BASE_ID;

    if (!apiKey || !baseId) {
      return new Response(JSON.stringify({ error: 'Missing Airtable credentials' }), {
        status: 500, headers: HEADERS,
      });
    }

    const coaches = await readThrough(
      env.GROUPS,
      // v3: the cached value is the mapped response, so bump when the response
      // schema changes. v3 removes contact fields that the directory does not
      // use, keeping them out of the crawlable list response.
      'coaches:list:v3',
      FRESH_MS,
      STALE_TTL_S,
      () => fetchLiveCoaches(apiKey, baseId),
      context.waitUntil.bind(context),
    );
    return new Response(JSON.stringify(coaches), { headers: HEADERS });
  } catch (e) {
    console.error(e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Unable to load coaches right now. Please try again shortly.' }), {
      status: 502, headers: HEADERS,
    });
  }
}
