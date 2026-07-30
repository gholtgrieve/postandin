function unavailableResponse() {
  return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Coach Intake Temporarily Unavailable | Post &amp; In</title>
<meta name="robots" content="noindex, nofollow">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: #E8E3D8;
    color: #2E2A26;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  main { max-width: 620px; text-align: center; }
  .eyebrow {
    color: #7C6300;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  h1 { margin: 14px 0; font-size: clamp(32px, 7vw, 52px); line-height: 1; }
  p { color: #3D3A34; font-size: 14px; line-height: 1.8; }
  a { color: #3D3A34; font-weight: 700; text-underline-offset: 3px; }
  .actions { display: flex; justify-content: center; flex-wrap: wrap; gap: 12px 20px; margin-top: 24px; }
</style>
</head>
<body>
<main>
  <div class="eyebrow">Post &amp; In · Coaches</div>
  <h1>The form is temporarily unavailable.</h1>
  <p>You can still ask a question or submit your coaching information directly by email.</p>
  <div class="actions">
    <a href="mailto:gholtgrieve@gmail.com">Email Gordon</a>
    <a href="/coaches/">Return to Coaches</a>
  </div>
</main>
</body>
</html>`, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequestGet(context) {
  const formUrl = context.env.COACH_INTAKE_FORM_URL;

  if (!formUrl) {
    console.error('Coach intake form URL is not configured');
    return unavailableResponse();
  }

  try {
    const parsed = new URL(formUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'airtable.com') {
      throw new Error('Invalid coach intake form URL');
    }

    return Response.redirect(parsed.toString(), 302);
  } catch (error) {
    console.error('Invalid coach intake form URL configuration', error);
    return unavailableResponse();
  }
}
