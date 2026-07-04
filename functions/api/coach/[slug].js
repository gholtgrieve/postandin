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

export async function onRequest(context) {
  const { env, params } = context;
  const slug   = params.slug;
  const apiKey = env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;

  if (!apiKey || !baseId) {
    return new Response(JSON.stringify({ error: 'Missing Airtable credentials' }), {
      status: 500, headers: HEADERS,
    });
  }

  try {
    const formula = `AND({slug} = "${slug.replace(/"/g, '')}", {status} = "Live")`;
    const params_qs = new URLSearchParams({ filterByFormula: formula, maxRecords: '1' });
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/Coaches?${params_qs}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`Airtable HTTP ${res.status}`);

    const data = await res.json();
    if (!data.records?.length) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404, headers: HEADERS,
      });
    }

    return new Response(JSON.stringify(mapRecord(data.records[0])), { headers: HEADERS });
  } catch (e) {
    console.error(e.message, e.stack);
    return new Response(JSON.stringify({ error: 'Unable to load this coach profile right now.' }), {
      status: 502, headers: HEADERS,
    });
  }
}
