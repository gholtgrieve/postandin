export async function onRequest(context) {
  const url = new URL(context.request.url);
  const company = url.searchParams.get('company');
  const itemPk  = url.searchParams.get('itemPk');
  const year    = url.searchParams.get('year');
  const month   = url.searchParams.get('month');
  if (!company || !itemPk || !year || !month)
    return new Response(JSON.stringify({error:'Missing params'}), {status:400});
  const upstream = `https://fareharbor.com/api/v1/companies/${company}/items/${itemPk}/calendar/${year}/${month}/`;
  try {
    const res = await fetch(upstream, {headers:{'User-Agent':'Mozilla/5.0'}});
    const body = await res.text();
    return new Response(body, {status:res.status, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=300'}});
  } catch(e) {
    console.error(e.message, e.stack);
    return new Response(JSON.stringify({error:'FareHarbor schedule temporarily unavailable.'}), {status:502});
  }
}