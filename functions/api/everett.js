export async function onRequest(context) {
  const url = new URL(context.request.url);
  const startDate = url.searchParams.get('startDate');
  const endDate   = url.searchParams.get('endDate');
  if (!startDate || !endDate)
    return new Response(JSON.stringify({error:'Missing params'}), {status:400});
  const upstream = `https://us-central1-aotw-arena.cloudfunctions.net/api/calendar/417/443?startDate=${startDate}&endDate=${endDate}`;
  try {
    const res  = await fetch(upstream, {headers:{'User-Agent':'Mozilla/5.0'}});
    const body = await res.text();
    return new Response(body, {status:res.status, headers:{
      'Content-Type':'application/json',
      'Access-Control-Allow-Origin':'*',
      'Cache-Control':'public, max-age=300'
    }});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:502});
  }
}