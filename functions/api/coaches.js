const FIELDS = [
  'name','slug','cert','specialty','age_groups','levels','rinks',
  'private_lessons','lessons_detail','bio','teaser','teams_coached',
  'contact_email','contact_phone','contact_text','contact_preference',
  'headshot_url','photo_urls','elite_prospects_url','initials',
];

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300',
  'Access-Control-Allow-Origin': '*',
};

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
    contact_email:      f.contact_email ?? '',
    contact_phone:      f.contact_phone ?? '',
    contact_text:       f.contact_text ?? '',
    contact_preference: f.contact_preference ?? [],
    headshot_url:       f.headshot_url ?? '',
    photo_urls:         f.photo_urls ?? '',
    elite_prospects_url:f.elite_prospects_url ?? '',
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

    const coaches = await fetchLiveCoaches(apiKey, baseId);
    return new Response(JSON.stringify(coaches), { headers: HEADERS });
  } catch (e) {
    console.error(e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Unable to load coaches right now. Please try again shortly.' }), {
      status: 502, headers: HEADERS,
    });
  }
}
