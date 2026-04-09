// netlify/functions/fareharbor.js
// Proxies FareHarbor calendar API calls server-side to avoid CORS blocks.
// Browser calls: /api/fareharbor?company=olympicviewarena&itemPk=313860&year=2026&month=04

export async function handler(event) {
  const { company, itemPk, year, month } = event.queryStringParameters ?? {};

  if (!company || !itemPk || !year || !month) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required params: company, itemPk, year, month" }) };
  }

  const url = `https://fareharbor.com/api/v1/companies/${company}/items/${itemPk}/calendar/${year}/${month}/`;

  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; stick-puck-aggregator/1.0)",
        "Accept": "application/json",
      },
    });

    if (!r.ok) {
      return { statusCode: r.status, body: JSON.stringify({ error: `FareHarbor returned ${r.status}` }) };
    }

    const data = await r.json();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300", // cache 5 min at CDN edge
      },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
}
