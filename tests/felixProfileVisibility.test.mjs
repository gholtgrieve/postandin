import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import { categoryLabels, clips } from '../felix-holtgrieve/clips.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const page = read('felix-holtgrieve/index.html');
const profileScript = read('felix-holtgrieve/profile.js');
const clipManifest = read('felix-holtgrieve/clips.js');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');
const headers = read('_headers');

const route = '/felix-holtgrieve/';
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function readClipWatchPage(clip) {
  assert.match(clip.pageSrc, /^\/felix-holtgrieve\/video\/[a-z0-9-]+\/$/, `invalid watch page path for ${clip.id}`);
  return read(`${clip.pageSrc.slice(1)}index.html`);
}

function videoMetadataFrom(watchPage, clipId) {
  const match = watchPage.match(/<script type="application\/ld\+json" id="video-metadata">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, `video metadata must be present for ${clipId}`);
  return JSON.parse(match[1]);
}

function displayDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));
}

function displayShortDate(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${value}T12:00:00`));
}

function matchingHeaderBlocks(path) {
  const blocks = headers.split(/\n(?=\S)/);
  return blocks.filter((block) => {
    const [pattern] = block.split('\n');
    if (!pattern || pattern.startsWith('#')) return false;
    const expression = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replaceAll('*', '.*');
    return new RegExp(`^${expression}$`).test(path);
  });
}

test('Felix profile is indexable with canonical and Person metadata', () => {
  assert.doesNotMatch(page, /noindex/i);
  assert.match(page, /<link rel="canonical" href="https:\/\/postandin\.com\/felix-holtgrieve\/">/);
  assert.match(page, /"@type": "Person"/);
  assert.match(page, /"name": "Felix Holtgrieve"/);
  assert.match(page, /"image": "https:\/\/postandin\.com\/felix-holtgrieve\/images\/felix-headshot\.webp"/);
  assert.match(page, /<meta property="og:image" content="https:\/\/postandin\.com\/felix-holtgrieve\/images\/felix-headshot\.webp">/);
  const disallowedPaths = [...robots.matchAll(/^Disallow:\s*(\S+)/gmi)].map((match) => match[1]);
  assert.ok(disallowedPaths.every((path) => !route.startsWith(path)), `blocked by robots.txt: ${disallowedPaths}`);
  assert.ok(
    matchingHeaderBlocks(route).every((block) => !/X-Robots-Tag:\s*[^\n]*noindex/i.test(block)),
    'blocked by an X-Robots-Tag header',
  );
  assert.match(sitemap, /<loc>https:\/\/postandin\.com\/felix-holtgrieve\/<\/loc>/);
});

test('Felix profile is absent from established public navigation surfaces', () => {
  const navigationSurfaces = [
    'index.html',
    '404.html',
    'stick-and-puck/index.html',
    'drop-in-hockey/index.html',
    'public-skate/index.html',
    'coaches/index.html',
    'functions/coaches/[slug].js',
    'gear/index.html',
  ];

  for (const path of navigationSurfaces) {
    assert.doesNotMatch(read(path), /href=["'][^"']*felix-holtgrieve(?:["'/?#])/i, path);
  }
});

test('Felix profile scaffold includes verified facts and a clip fallback state', () => {
  assert.match(page, /Seattle Junior Mets/);
  assert.match(
    page,
    /<img class="headshot" src="\/felix-holtgrieve\/images\/felix-headshot\.webp" alt="Felix Holtgrieve wearing a Seattle Junior Mets polo" width="700" height="875" decoding="async" fetchpriority="high">/,
  );
  assert.ok(fs.statSync('felix-holtgrieve/images/felix-headshot.webp').size > 0, 'headshot asset must exist');
  assert.doesNotMatch(page, /headshot placeholder|>FH<\/div>/i);
  assert.match(page, /<dt>Position<\/dt>\s*<dd>Defense<\/dd>/);
  assert.match(page, /<dt>Height<\/dt>\s*<dd>6′0″<\/dd>/);
  assert.match(page, /<dt>Weight<\/dt>\s*<dd>173 lbs<\/dd>/);
  assert.match(page, /<dt>Shoots<\/dt>\s*<dd>Right<\/dd>/);
  assert.match(page, /<dt>Birth year<\/dt>\s*<dd>2011<\/dd>/);
  assert.doesNotMatch(page, /Defenseman profile and video highlights/);
  assert.match(page, /2026–27 Highlights/);
  assert.match(page, new RegExp(`<p class="season-label">${clips.length} clip${clips.length === 1 ? '' : 's'}<\\/p>`));
});

test('playing history lists Seattle Junior teams and invite-only development recognition', () => {
  const teams = [
    ['2026–27', '16U AA', 'Kyle Moore', 'coachkyle2244@gmail.com'],
    ['2025–26', '14U AA', 'Zach Wegener', 'zachwegener7@gmail.com'],
    ['2024–25', '14U B', 'David Bailey', 'DBailey618@live.com'],
  ];

  assert.match(page, /id="playing-history-title">Rep Hockey Teams<\/h2>/);
  assert.match(page, /<table class="team-history-table" role="table">/);
  assert.match(page, /<th scope="col" role="columnheader">Head coach<\/th>/);
  assert.doesNotMatch(page, /\.team-history-table thead\s*\{\s*display:\s*none/);
  assert.match(page, /content: 'Head coach: ' \/ '';/);
  for (const [season, level, headCoach, email] of teams) {
    assert.match(
      page,
      new RegExp(`<td class="history-season" role="cell">${season}<\\/td><td class="history-team" role="cell">Seattle Junior Mets <strong>${level}<\\/strong><\\/td><td class="history-coach" role="cell"><a href="mailto:${email.replace('.', '\\.')}">${headCoach}<\\/a><\\/td>`),
    );
  }
  const teamSeasonPositions = teams.map(([season]) => page.indexOf(`>${season}</td>`));
  assert.deepEqual(
    teamSeasonPositions,
    [...teamSeasonPositions].sort((a, b) => a - b),
    'rep teams should be listed with the most recent season first',
  );
  assert.doesNotMatch(page, /2027–27/);
  assert.match(page, /id="camp-highlight-title">PNAHA State Development Camp<\/h3>/);
  assert.match(page, /Invite-only attendee for two consecutive years\./);
});

test('clip library scaffolds categories, efficient previews, and full playback', () => {
  assert.match(page, /src="\/felix-holtgrieve\/profile\.js\?v=8"/);
  assert.match(profileScript, /from '\.\/clips\.js\?v=8'/);
  for (const category of ['defensive', 'offensive', 'puck-movement', 'special-teams']) {
    assert.match(page, new RegExp(`data-category="${category}"`));
  }
  assert.match(page, /id="clipDialog"/);
  assert.match(profileScript, /IntersectionObserver/);
  assert.match(profileScript, /rootMargin: '400px 0px'/);
  assert.match(profileScript, /preview\.muted = true/);
  assert.match(profileScript, /preview\.loop = true/);
  assert.match(profileScript, /preview\.preload = 'none'/);
  assert.match(profileScript, /matchMedia\('\(hover: hover\)'\)/);
  assert.match(profileScript, /!supportsHover\.matches/);
  assert.match(profileScript, /video\.preload = 'auto'/);
  assert.match(profileScript, /pointerenter/);
  assert.match(profileScript, /event\.pointerType === 'mouse'/);
  assert.doesNotMatch(profileScript, /setTimeout\(\(\) => stopPreview/);
  assert.match(profileScript, /prefers-reduced-motion: reduce/);
  assert.match(profileScript, /clipDialog\.showModal\(\)/);
  assert.match(profileScript, /clipGrid\.replaceChildren/);
  assert.match(profileScript, /event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey \|\| event\.shiftKey \|\| event\.altKey/);
  assert.match(profileScript, /clip\.categories\.includes\(activeCategory\)/);
  assert.match(profileScript, /clip\.categories\.map/);
  assert.match(profileScript, /description\.textContent = clip\.description/);
  assert.match(page, /\.filter-button\[aria-pressed='true'\] \{ background: var\(--mustard2\); color: var\(--paper\); \}/);
  assert.match(page, /id="clipStatus" role="status" aria-live="polite"/);
  assert.match(page, /\.watch-button:focus-visible \{ outline-color: var\(--ink\); \}/);
  assert.doesNotMatch(page, /id="clipGrid"[^>]*aria-live/);
  assert.match(clipManifest, /export const clips = \[/);
  assert.match(page, /data-clip-id="2026-09-27-utah-d-zone-breakout-sog"/);
  assert.match(page, /<section class="empty-library" id="emptyLibrary" aria-labelledby="empty-title" hidden>/);
});

test('every clip has search-readable profile HTML and a dedicated watch page', () => {
  assert.doesNotMatch(page, /"@type": "VideoObject"/);

  for (const clip of clips) {
    const watchPage = readClipWatchPage(clip);
    const videoMetadata = videoMetadataFrom(watchPage, clip.id);
    const categories = clip.categories.map((category) => categoryLabels[category]).join(' · ');

    assert.match(page, new RegExp(`data-clip-id="${escapeRegExp(clip.id)}"`));
    assert.match(page, new RegExp(`<p class="clip-category">${escapeRegExp(categories)}<\\/p>`));
    assert.match(page, new RegExp(`<h3 class="clip-title">${escapeRegExp(clip.title)}<\\/h3>`));
    assert.match(page, new RegExp(`<p class="clip-meta">${escapeRegExp(clip.opponent)} · ${escapeRegExp(displayShortDate(clip.date))}<\\/p>`));
    assert.match(page, new RegExp(escapeRegExp(clip.description)));
    assert.match(page, new RegExp(`<img class="clip-preview" src="${escapeRegExp(clip.posterSrc)}"`));
    assert.match(page, new RegExp(`<a class="watch-button" href="${escapeRegExp(clip.pageSrc)}">Watch full clip<\\/a>`));

    assert.doesNotMatch(watchPage, /noindex/i);
    const disallowedPaths = [...robots.matchAll(/^Disallow:\s*(\S+)/gmi)].map((match) => match[1]);
    assert.ok(disallowedPaths.every((path) => !clip.pageSrc.startsWith(path)), `watch page blocked by robots.txt: ${clip.id}`);
    assert.ok(
      matchingHeaderBlocks(clip.pageSrc).every((block) => !/X-Robots-Tag:\s*[^\n]*noindex/i.test(block)),
      `watch page blocked by an X-Robots-Tag header: ${clip.id}`,
    );
    assert.match(watchPage, new RegExp(`<link rel="canonical" href="https://postandin\\.com${escapeRegExp(clip.pageSrc)}">`));
    assert.match(watchPage, new RegExp(`<h1>${escapeRegExp(clip.title)}<\\/h1>`));
    assert.match(watchPage, new RegExp(escapeRegExp(clip.opponent)));
    assert.match(watchPage, new RegExp(escapeRegExp(displayDate(clip.date))));
    assert.match(watchPage, new RegExp(`<meta property="og:image" content="${escapeRegExp(clip.posterSrc)}">`));
    assert.match(watchPage, new RegExp(`<meta property="og:video" content="${escapeRegExp(clip.fullSrc)}">`));
    assert.match(watchPage, new RegExp(`<video[^>]+poster="${escapeRegExp(clip.posterSrc)}"[^>]+src="${escapeRegExp(clip.fullSrc)}"`));
    assert.match(watchPage, /\.logo:focus-visible, footer a:focus-visible \{ outline-color: #D6BC58; \}/);
    assert.equal(videoMetadata['@type'], 'VideoObject');
    assert.equal(videoMetadata.name, `Felix Holtgrieve — ${clip.title}`);
    assert.equal(videoMetadata.description, clip.description);
    assert.equal(videoMetadata.thumbnailUrl, clip.posterSrc);
    assert.equal(videoMetadata.uploadDate, clip.uploadDate);
    assert.equal(videoMetadata.duration, `PT${clip.durationSeconds}S`);
    assert.equal(videoMetadata.contentUrl, clip.fullSrc);
    assert.match(sitemap, new RegExp(`<loc>https://postandin\\.com${escapeRegExp(clip.pageSrc)}<\\/loc>`));
  }
});

test('clip manifest entries are valid and media remains externally hosted', () => {
  const ids = new Set();
  const validCategories = new Set(Object.keys(categoryLabels));

  for (const clip of clips) {
    assert.equal(typeof clip.id, 'string');
    assert.ok(clip.id.trim(), 'clip id must not be empty');
    assert.ok(!ids.has(clip.id), `duplicate clip id: ${clip.id}`);
    ids.add(clip.id);
    assert.ok(Array.isArray(clip.categories) && clip.categories.length, `missing categories for ${clip.id}`);
    assert.equal(new Set(clip.categories).size, clip.categories.length, `duplicate categories for ${clip.id}`);
    for (const category of clip.categories) {
      assert.ok(validCategories.has(category), `invalid category for ${clip.id}: ${category}`);
    }
    assert.match(clip.date, /^\d{4}-\d{2}-\d{2}$/, `invalid date format for ${clip.id}`);
    assert.equal(
      new Date(`${clip.date}T00:00:00Z`).toISOString().slice(0, 10),
      clip.date,
      `invalid calendar date for ${clip.id}`,
    );
    assert.ok(clip.title?.trim(), `missing title for ${clip.id}`);
    assert.ok(clip.description?.trim(), `missing description for ${clip.id}`);
    assert.ok(clip.opponent?.trim(), `missing opponent for ${clip.id}`);
    assert.match(clip.uploadDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/, `upload date must include a timezone for ${clip.id}`);
    assert.ok(Number.isFinite(Date.parse(clip.uploadDate)), `invalid upload date for ${clip.id}`);
    assert.ok(Number.isFinite(clip.durationSeconds) && clip.durationSeconds > 0, `invalid duration for ${clip.id}`);
    assert.match(clip.pageSrc, /^\/felix-holtgrieve\/video\/[a-z0-9-]+\/$/, `invalid watch page for ${clip.id}`);
    assert.match(clip.posterSrc, /^https:\/\/media\.postandin\.com\//, `poster must use the Post & In media domain for ${clip.id}`);
    assert.match(clip.previewSrc, /^https:\/\//, `preview must use external HTTPS hosting for ${clip.id}`);
    assert.match(clip.fullSrc, /^https:\/\//, `full clip must use external HTTPS hosting for ${clip.id}`);
    assert.match(clip.previewSrc, /^https:\/\/media\.postandin\.com\//, `preview must use the Post & In media domain for ${clip.id}`);
    assert.match(clip.fullSrc, /^https:\/\/media\.postandin\.com\//, `full clip must use the Post & In media domain for ${clip.id}`);
    for (const source of [clip.posterSrc, clip.previewSrc, clip.fullSrc]) {
      assert.match(
        source,
        new RegExp(`^https://media\\.postandin\\.com/felix/\\d{4}-\\d{2}/${clip.id}/v[1-9]\\d*/`),
        `media URL must use a versioned key for ${clip.id}`,
      );
    }
  }

  const trackedProfileFiles = execFileSync('git', ['ls-files', 'felix-holtgrieve'], { encoding: 'utf8' });
  assert.doesNotMatch(trackedProfileFiles, /\.(?:mov|mp4|webm)$/im, 'video files must not be committed');
});

test('academic section lists approved Semester 1 coursework without grades', () => {
  const currentYearSection = page.slice(
    page.indexOf('id="academic-year-2026"'),
    page.indexOf('id="academic-year-2025"'),
  );
  assert.match(page, /id="academics-title">High School Coursework<\/h2>/);
  assert.match(page, /id="academic-year-2026">2026–27<\/h3>/);
  assert.match(page, />Grade 10<\/p>/);
  assert.match(page, /<h4 class="semester-title">Semester 1<\/h4>/);
  for (const course of [
    'French 2A',
    'Algebra 2A',
    'World Literature &amp; Composition 10A',
    'Beginning Graphic Design',
    'Biology A',
    'AP World History 1',
  ]) {
    assert.match(currentYearSection, new RegExp(`<li>${course}<\\/li>`));
  }
  assert.doesNotMatch(currentYearSection, /course-status/);
  assert.doesNotMatch(page, /Student ID|State ID|Portal Username|Absences|Tardies|Teacher|Room|Advisory|Program Support/i);
  assert.doesNotMatch(currentYearSection, /<th[^>]*>Grade<\/th>/i);
});

test('academic section includes only approved Grade 9 history from prior years', () => {
  assert.match(page, /id="academic-year-2025">2025–26<\/h3>/);
  assert.match(page, />Grade 9<\/p>/);
  assert.match(page, /id="grade-9-semester-1">Semester 1<\/h4>/);
  assert.match(page, /id="grade-9-semester-2">Semester 2<\/h4>/);

  const approvedGradeNine = [
    ['Health Education', 'C\\+'],
    ['Introduction to Literature &amp; Composition 9A', 'B-'],
    ['Geometry A', 'B\\+'],
    ['Personal Fitness', 'A'],
    ['Physics A', 'B\\+'],
    ['French 1A', 'B\\+'],
    ['Exploring Computer Science', 'B\\+'],
    ['Introduction to Literature &amp; Composition 9B', 'B-'],
    ['Geometry B', 'B\\+'],
    ['Chemistry A', 'B\\+'],
    ['World History 1', 'C\\+'],
    ['French 1B', 'A-'],
  ];

  for (const [course, grade] of approvedGradeNine) {
    assert.match(page, new RegExp(`<td class="course-name">${course}<\\/td><td class="course-grade">${grade}<\\/td>`));
  }

  assert.equal((page.match(/<td class="course-grade">/g) || []).length, 12);
  assert.doesNotMatch(page, /Grade [678]|Madison MS|Course #|Credit Earned|Credit Attempted|Advisory/i);
});
