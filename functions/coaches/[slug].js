function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function parseTeams(text) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split(' · ');
    return { team: parts[0]?.trim() || '', role: parts[1]?.trim() || '', years: parts[2]?.trim() || '' };
  });
}

function parsePhotos(text) {
  return (text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3);
}

function fmtBio(text) {
  if (!text) return '';
  return text.split(/\n\n+/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('');
}

function tag(label, specialty = false) {
  const cls = specialty ? 'tag tag-specialty' : 'tag';
  return `<span class="${cls}">${esc(label)}</span>`;
}

async function fetchCoach(slug, env) {
  const apiKey = env.AIRTABLE_API_KEY;
  const baseId = env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) return null;

  const formula = `AND({slug} = "${slug.replace(/"/g, '')}", {status} = "Live")`;
  const qs = new URLSearchParams({ filterByFormula: formula, maxRecords: '1' });
  const res = await fetch(`https://api.airtable.com/v0/${baseId}/Coaches?${qs}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.records?.length) return null;

  const f = data.records[0].fields ?? {};
  return {
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

function renderHtml(coach) {
  const teams  = parseTeams(coach.teams_coached);
  const photos = parsePhotos(coach.photo_urls);
  const prefs  = new Set(coach.contact_preference);

  const avatarLg = coach.headshot_url
    ? `<img src="${esc(coach.headshot_url)}" alt="${esc(coach.name)}" class="profile-photo-img">`
    : `<div class="profile-initials">${esc(coach.initials || coach.name.slice(0,2).toUpperCase())}</div>`;

  const allTags = [
    ...(coach.specialty || []).map(s => tag(s, true)),
    ...(coach.age_groups || []).map(a => tag(a)),
    ...(coach.levels || []).map(l => tag(l)),
  ].join('');

  const teamsHtml = teams.length ? `
    <section class="profile-section">
      <h2 class="section-heading">Teams Coached</h2>
      <div class="teams-list">
        ${teams.map(t => `
          <div class="team-row">
            <span class="team-name">${esc(t.team)}</span>
            <span class="team-meta">${t.role ? `${esc(t.role)}${t.years ? ` · ${esc(t.years)}` : ''}` : esc(t.years)}</span>
          </div>`).join('')}
      </div>
    </section>` : '';

  const photosHtml = photos.length ? `
    <section class="profile-section">
      <h2 class="section-heading">Photos</h2>
      <div class="photos-row">
        ${photos.map(url => `<img src="${esc(url)}" alt="" class="photo-thumb" loading="lazy">`).join('')}
      </div>
    </section>` : '';

  const lessonsHtml = coach.private_lessons ? `
    <div class="sidebar-block lessons-block">
      <div class="lessons-heading">Private Lessons Available</div>
      ${coach.lessons_detail ? `<div class="lessons-detail">${esc(coach.lessons_detail)}</div>` : ''}
    </div>` : '';

  const contactItems = [];
  if (prefs.has('Email') && coach.contact_email)
    contactItems.push(`<a href="mailto:${esc(coach.contact_email)}" class="contact-link">
      <span class="contact-method">Email</span>
      <span class="contact-value">${esc(coach.contact_email)}</span>
    </a>`);
  if (prefs.has('Phone') && coach.contact_phone)
    contactItems.push(`<a href="tel:${esc(coach.contact_phone)}" class="contact-link">
      <span class="contact-method">Phone</span>
      <span class="contact-value">${esc(coach.contact_phone)}</span>
    </a>`);
  if (prefs.has('Text') && coach.contact_text)
    contactItems.push(`<a href="sms:${esc(coach.contact_text)}" class="contact-link">
      <span class="contact-method">Text</span>
      <span class="contact-value">${esc(coach.contact_text)}</span>
    </a>`);

  const contactHtml = contactItems.length ? `
    <div class="sidebar-block">
      <div class="sidebar-label">Contact</div>
      <div class="contact-list">${contactItems.join('')}</div>
    </div>` : '';

  const rinksHtml = coach.rinks?.length ? `
    <div class="sidebar-block">
      <div class="sidebar-label">Rinks</div>
      <div class="rinks-list">
        ${coach.rinks.map(r => `<span class="rink-pill">${esc(r)}</span>`).join('')}
      </div>
    </div>` : '';

  const epHtml = coach.elite_prospects_url ? `
    <div class="sidebar-block">
      <a href="${esc(coach.elite_prospects_url)}" target="_blank" rel="noopener" class="ep-link">
        Elite Prospects &#x2197;
      </a>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${esc(coach.name)} — Post &amp; In Coaches</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --paper:    #E8E3D8;
  --panel:    #EFEBE2;
  --card:     #DED9CD;
  --rule:     #B8B2A4;
  --ink:      #2E2A26;
  --ink2:     #3D3A34;
  --ink3:     #6E6A61;
  --mustard:  #9A7B00;
  --mustard2: #7C6300;
}

html { scroll-behavior: smooth; }
body { font-family: 'IBM Plex Mono', monospace; background: var(--paper); color: var(--ink); min-height: 100vh; }

/* ── Site header ── */
.site-header { background: var(--ink); border-bottom: 1px solid rgba(184,178,164,0.12); position: sticky; top: 0; z-index: 100; }
.header-inner { max-width: 1100px; margin: 0 auto; padding: 0 clamp(1rem,4vw,2rem); height: 52px; display: flex; align-items: center; }
.logo { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 0.08em; color: var(--paper); display: flex; align-items: center; gap: 10px; }
.logo a { color: inherit; text-decoration: none; }
.logo .slash { color: rgba(184,178,164,0.35); font-size: 18px; }
.logo .section { color: var(--mustard); }

/* ── Breadcrumb ── */
.breadcrumb-bar { background: var(--panel); border-bottom: 1px solid var(--rule); padding: 10px clamp(1rem,4vw,2rem); }
.breadcrumb-inner { max-width: 1100px; margin: 0 auto; }
.breadcrumb {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--mustard);
}
.breadcrumb a { color: var(--mustard); text-decoration: none; }
.breadcrumb a:hover { color: var(--mustard2); }
.breadcrumb .sep { color: var(--rule); margin: 0 6px; }

/* ── Profile header ── */
.profile-header {
  background: var(--paper);
  border-bottom: 2px solid var(--mustard);
  padding: clamp(2rem,4vw,3rem) clamp(1rem,4vw,2rem);
}
.profile-header-inner { max-width: 1100px; margin: 0 auto; }
.profile-header-grid { display: grid; grid-template-columns: 108px 1fr; gap: 24px; align-items: start; }

.profile-photo {
  width: 108px;
  height: 108px;
  background: var(--card);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.profile-photo-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.profile-initials { font-family: 'Bebas Neue', sans-serif; font-size: 38px; letter-spacing: 0.04em; color: var(--mustard); }

.profile-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: var(--mustard); margin-bottom: 6px; }
.profile-name { font-family: 'Bebas Neue', sans-serif; font-size: clamp(36px,6vw,48px); letter-spacing: 0.04em; line-height: 1; color: var(--ink); margin-bottom: 6px; }
.profile-cert { font-size: 13px; letter-spacing: 0.1em; color: var(--ink3); text-transform: uppercase; margin-bottom: 10px; }
.profile-tags { display: flex; flex-wrap: wrap; gap: 4px; }

.tag { font-family: 'IBM Plex Mono', monospace; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 8px; border: 1px solid var(--rule); color: var(--ink3); }
.tag-specialty { border-color: var(--mustard); color: var(--mustard); }

/* ── Two-column layout ── */
.profile-body { max-width: 1100px; margin: 0 auto; padding: clamp(1.5rem,3vw,2.5rem) clamp(1rem,4vw,2rem); display: grid; grid-template-columns: 1fr 320px; gap: 40px; align-items: start; }

/* ── Sections ── */
.profile-section { margin-bottom: 40px; }
.section-heading {
  font-family: 'Bebas Neue', sans-serif;
  font-size: 22px;
  letter-spacing: 0.08em;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  padding-bottom: 8px;
  margin-bottom: 16px;
}

.bio-text p {
  font-size: 15px;
  letter-spacing: 0.02em;
  line-height: 1.9;
  color: var(--ink2);
  margin-bottom: 14px;
}
.bio-text p:last-child { margin-bottom: 0; }

/* ── Teams ── */
.teams-list { display: flex; flex-direction: column; }
.team-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--rule);
  font-size: 14px;
  letter-spacing: 0.03em;
}
.team-row:last-child { border-bottom: none; }
.team-name { font-weight: 700; color: var(--ink); }
.team-meta { color: var(--ink3); text-align: right; flex-shrink: 0; }

/* ── Photos ── */
.photos-row { display: flex; gap: 8px; }
.photo-thumb { width: 80px; height: 80px; object-fit: cover; display: block; }

/* ── Sidebar ── */
.profile-sidebar { display: flex; flex-direction: column; gap: 0; }
.sidebar-block {
  background: var(--panel);
  border: 1px solid var(--rule);
  border-top: none;
  padding: 16px 18px;
}
.sidebar-block:first-child { border-top: 1px solid var(--rule); }

.sidebar-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--ink3);
  margin-bottom: 10px;
}

/* Private lessons block — dark panel */
.lessons-block { background: var(--ink); border-color: var(--ink); }
.lessons-heading { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 0.08em; color: var(--mustard); margin-bottom: 6px; }
.lessons-detail { font-size: 13px; letter-spacing: 0.06em; color: var(--paper); line-height: 1.6; }

/* Contact */
.contact-list { display: flex; flex-direction: column; gap: 8px; }
.contact-link { display: flex; flex-direction: column; gap: 1px; text-decoration: none; }
.contact-method { font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink3); }
.contact-value { font-size: 14px; letter-spacing: 0.04em; color: var(--mustard); transition: color 0.1s; }
.contact-link:hover .contact-value { color: var(--mustard2); }

/* Rinks */
.rinks-list { display: flex; flex-wrap: wrap; gap: 5px; }
.rink-pill { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; padding: 3px 9px; border: 1px solid var(--rule); color: var(--ink3); }

/* Elite Prospects */
.ep-link { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; color: var(--mustard); text-decoration: none; transition: color 0.1s; }
.ep-link:hover { color: var(--mustard2); }

/* ── Back link / footer area ── */
.back-link-bar { max-width: 1100px; margin: 0 auto; padding: 0 clamp(1rem,4vw,2rem) clamp(2rem,3vw,3rem); }
.back-link {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--mustard);
  text-decoration: none;
  transition: color 0.1s;
}
.back-link:hover { color: var(--mustard2); }

footer { background: var(--ink); border-top: 2px solid var(--mustard); color: var(--ink3); font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-align: center; padding: 16px; }
footer a { color: var(--rule); text-decoration: none; }
footer a:hover { color: var(--mustard); }

/* ── Responsive ── */
@media (max-width: 900px) {
  .profile-body { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .profile-header-grid { grid-template-columns: 80px 1fr; gap: 16px; }
  .profile-photo { width: 80px; height: 80px; }
  .profile-initials { font-size: 28px; }
  .team-row { flex-direction: column; gap: 2px; }
  .team-meta { text-align: left; }
}
</style>
</head>
<body>

<header class="site-header">
  <div class="header-inner">
    <div class="logo">
      <a href="/">Post &amp; In</a>
      <span class="slash">/</span>
      <span class="section">Coaches</span>
    </div>
  </div>
</header>

<div class="breadcrumb-bar">
  <div class="breadcrumb-inner">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="/coaches/">Coaches</a>
      <span class="sep">›</span>
      <span>${esc(coach.name)}</span>
    </nav>
  </div>
</div>

<div class="profile-header">
  <div class="profile-header-inner">
    <div class="profile-header-grid">
      <div class="profile-photo">${avatarLg}</div>
      <div class="profile-identity">
        <div class="profile-eyebrow">Seattle Hockey Coach</div>
        <h1 class="profile-name">${esc(coach.name)}</h1>
        ${coach.cert ? `<div class="profile-cert">${esc(coach.cert)}</div>` : ''}
        <div class="profile-tags">${allTags}</div>
      </div>
    </div>
  </div>
</div>

<div class="profile-body">
  <main class="profile-main">
    ${coach.bio ? `
    <section class="profile-section">
      <h2 class="section-heading">About</h2>
      <div class="bio-text">${fmtBio(coach.bio)}</div>
    </section>` : ''}
    ${teamsHtml}
    ${photosHtml}
  </main>

  <aside class="profile-sidebar">
    ${lessonsHtml}
    ${contactHtml}
    ${rinksHtml}
    ${epHtml}
  </aside>
</div>

<div class="back-link-bar">
  <a href="/coaches/" class="back-link">&#x2190; Back to coaches</a>
</div>

<footer>
  postandin.com &nbsp;·&nbsp; <a href="/">Home</a> &nbsp;·&nbsp; <a href="/stick-and-puck/">Stick &amp; Puck</a>
</footer>

</body>
</html>`;
}

function render404(slug) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Coach Not Found — Post &amp; In</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root { --paper:#E8E3D8; --panel:#EFEBE2; --rule:#B8B2A4; --ink:#141210; --ink3:#6E6A61; --mustard:#9A7B00; }
body { font-family: 'IBM Plex Mono', monospace; background: var(--paper); color: var(--ink); min-height: 100vh; display: flex; flex-direction: column; }
.site-header { background: var(--ink); border-bottom: 1px solid rgba(184,178,164,0.12); }
.header-inner { max-width: 1100px; margin: 0 auto; padding: 0 2rem; height: 52px; display: flex; align-items: center; }
.logo { font-family: 'Bebas Neue', sans-serif; font-size: 24px; letter-spacing: 0.08em; color: var(--paper); }
.logo a { color: inherit; text-decoration: none; }
main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 4rem 2rem; text-align: center; }
.not-found h1 { font-family: 'Bebas Neue', sans-serif; font-size: 48px; letter-spacing: 0.08em; color: var(--ink); margin-bottom: 12px; }
.not-found p { font-size: 12px; letter-spacing: 0.06em; color: var(--ink3); margin-bottom: 24px; }
.back { font-size: 10px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--mustard); text-decoration: none; }
footer { background: var(--ink); border-top: 2px solid var(--mustard); color: var(--ink3); font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-align: center; padding: 16px; }
</style>
</head>
<body>
<header class="site-header"><div class="header-inner"><div class="logo"><a href="/">Post &amp; In</a></div></div></header>
<main><div class="not-found">
  <h1>Coach Not Found</h1>
  <p>This profile isn't available or hasn't been published yet.</p>
  <a href="/coaches/" class="back">&#x2190; Back to coaches</a>
</div></main>
<footer>postandin.com</footer>
</body>
</html>`;
}

export async function onRequest(context) {
  const slug = context.params.slug;

  let coach;
  try {
    coach = await fetchCoach(slug, context.env);
  } catch {
    coach = null;
  }

  if (!coach) {
    return new Response(render404(slug), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response(renderHtml(coach), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
