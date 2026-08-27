import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pagePaths = [
  'stick-and-puck/index.html',
  'drop-in-hockey/index.html',
  'public-skate/index.html',
];
const modulePaths = [
  'stick-and-puck/modules/main.js',
  'stick-and-puck/modules/schedule.js',
  'stick-and-puck/modules/groups-ui.js',
  'stick-and-puck/modules/rsvp.js',
  'stick-and-puck/modules/storage.js',
];

const pages = Object.fromEntries(pagePaths.map(path => [path, fs.readFileSync(path, 'utf8')]));
const modules = Object.fromEntries(modulePaths.map(path => [path, fs.readFileSync(path, 'utf8')]));
const moduleSource = Object.values(modules).join('\n');

function matches(source, pattern) {
  return [...source.matchAll(pattern)].map(match => match[1]);
}

function cacheVersion(source, assetPath) {
  const marker = `${assetPath}?v=`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing cache-busted asset reference: ${assetPath}`);
  const valueStart = start + marker.length;
  const relativeEnd = source.slice(valueStart).search(/["'\s]/);
  assert.notEqual(relativeEnd, -1, `unterminated cache version for: ${assetPath}`);
  return source.slice(valueStart, valueStart + relativeEnd);
}

test('all schedule shells contain the same DOM IDs', () => {
  const [stickPath, ...otherPaths] = pagePaths;
  const stickIds = matches(pages[stickPath], /\bid="([^"]+)"/g).sort();
  for (const path of otherPaths) {
    assert.deepEqual(matches(pages[path], /\bid="([^"]+)"/g).sort(), stickIds, path);
  }
});

test('every queried DOM ID exists in each page or shared generated markup', () => {
  const queriedIds = new Set(matches(moduleSource, /getElementById\(['"]([^'"]+)['"]\)/g));
  const generatedIds = new Set(matches(moduleSource, /\bid=["']([^"']+)["']/g));

  for (const [path, html] of Object.entries(pages)) {
    const pageIds = new Set(matches(html, /\bid="([^"]+)"/g));
    const missing = [...queriedIds].filter(id => !pageIds.has(id) && !generatedIds.has(id));
    assert.deepEqual(missing, [], `${path} is missing DOM IDs queried by the shared modules`);
  }
});

test('module-load selectors have targets in every static page shell', () => {
  for (const [path, html] of Object.entries(pages)) {
    assert.match(html, /class="[^"]*\bfilter-btn\b/,
      `${path} is missing the .filter-btn controls wired at module load`);
  }
});

test('each page declares its activity and offers normal-link navigation to all schedules', () => {
  assert.match(pages['stick-and-puck/index.html'], /<body data-activity="stick-and-puck">/);
  assert.match(pages['drop-in-hockey/index.html'], /<body data-activity="drop-in-hockey">/);
  assert.match(pages['public-skate/index.html'], /<body data-activity="public-skate">/);

  for (const html of Object.values(pages)) {
    assert.match(html, /href="\/stick-and-puck\/"/);
    assert.match(html, /href="\/drop-in-hockey\/"/);
    assert.match(html, /href="\/public-skate\/"/);
    assert.equal(matches(html, /\baria-current="(page)"/g).length, 1);
    assert.doesNotMatch(html, /Nudge your group|sheetShareBtn/);
    assert.doesNotMatch(html, /A Quick Note|sorryModalOverlay|sorryDismissBtn/);
  }
  assert.doesNotMatch(moduleSource, /postandin_sorry_v2|SorryModal|sorryModalOverlay|sorryDismissBtn/);
});

test('shared asset cache versions are exact and synchronized across page shells', () => {
  for (const [path, html] of Object.entries(pages)) {
    assert.equal(cacheVersion(html, '/stick-and-puck/schedule.css'), '20260826b',
      `${path} has an unexpected schedule.css cache version`);
    assert.equal(cacheVersion(html, '/stick-and-puck/modules/main.js'), '20260827',
      `${path} has an unexpected main.js cache version`);
  }
  assert.equal(cacheVersion(modules['stick-and-puck/modules/main.js'], '/stick-and-puck/modules/schedule.js'), '20260827');
  assert.equal(cacheVersion(modules['stick-and-puck/modules/main.js'], '/stick-and-puck/modules/groups-ui.js'), '20260827');
  assert.equal(cacheVersion(modules['stick-and-puck/modules/schedule.js'], '/stick-and-puck/modules/activity-config.js'), '20260826b');
  assert.equal(cacheVersion(modules['stick-and-puck/modules/groups-ui.js'], '/stick-and-puck/modules/schedule.js'), '20260827');

  const scheduleVersions = Object.values(modules)
    .flatMap(source => matches(source, /\/stick-and-puck\/modules\/schedule\.js\?v=([^'"\s]+)/g));
  assert.deepEqual([...new Set(scheduleVersions)], ['20260827'],
    'every schedule.js importer must use one URL so module side effects run once');

  const rsvpVersions = Object.values(modules)
    .flatMap(source => matches(source, /\/stick-and-puck\/modules\/rsvp\.js\?v=([^'"\s]+)/g));
  assert.deepEqual([...new Set(rsvpVersions)], ['20260827'],
    'every rsvp.js importer must use one URL so shared RSVP state stays unified');

  const utilsVersions = Object.values(modules)
    .flatMap(source => matches(source, /\/stick-and-puck\/modules\/utils\.js\?v=([^'"\s]+)/g));
  assert.deepEqual([...new Set(utilsVersions)], ['20260827'],
    'every utils.js importer must use the current female-filter helper');

  const storageVersions = Object.values(modules)
    .flatMap(source => matches(source, /\/stick-and-puck\/modules\/storage\.js\?v=([^'"\s]+)/g));
  assert.deepEqual([...new Set(storageVersions)], ['20260827'],
    'every storage.js importer must use one URL so Groups state stays unified');
});

test('Female/Non-Binary filtering uses normalized audience data with legacy cache fallback', () => {
  const schedule = modules['stick-and-puck/modules/schedule.js'];
  const utils = fs.readFileSync('stick-and-puck/modules/utils.js', 'utf8');
  assert.match(schedule, /activeFilter === "female"\) return isFemaleOrNonBinarySession\(s\)/);
  assert.match(utils, /session\.eligibility\?\.audience/);
  assert.match(utils, /session\.subtitle, session\.title, session\.sourceLabel/);
});

test('no schedule displays price, reservations, availability, or sold-out cues', () => {
  const schedule = modules['stick-and-puck/modules/schedule.js'];
  const css = fs.readFileSync('stick-and-puck/schedule.css', 'utf8');
  for (const html of Object.values(pages)) assert.doesNotMatch(html, /data-filter="available"/);
  assert.doesNotMatch(schedule, /\.price|\.spots|\.soldOut|activeFilter === ["']available["']|Sold out|sold-out|badge-price|badge-spots|badge-sold-out/);
  assert.doesNotMatch(css, /sold-out|badge-price|badge-spots|badge-sold-out/);
  assert.match(schedule, /const total = all\.length;/);
  assert.match(schedule, /`<strong>\$\{total\}<\/strong> session\$\{total !== 1 \? 's' : ''\}/);
  assert.match(schedule, /const linkAttrs = s\.bookUrl\s*\? `href=/);
});

test('all activity pages render session location independently of hockey details', () => {
  const schedule = modules['stick-and-puck/modules/schedule.js'];
  const groupsUi = modules['stick-and-puck/modules/groups-ui.js'];
  assert.match(schedule, /const locationLabel = sessionLocationLabel\(s\);/);
  assert.match(schedule, /locationLabel \? `<div class="row-city">/);
  assert.doesNotMatch(
    schedule,
    /activityConfig\.showSessionSubtitles\s*&&\s*locationLabel|locationLabel\s*&&\s*activityConfig\.showSessionSubtitles/,
  );
  assert.equal((groupsUi.match(/sessionLocationLabel\(s\)/g) ?? []).length, 2);
});

test('session rows render calendar controls only when exact times are exportable', () => {
  const schedule = modules['stick-and-puck/modules/schedule.js'];
  assert.match(schedule, /const calendarBtn = hasExactCalendarTimes\(s\)\s*\? `[\s\S]*?calendar-btn[\s\S]*?`\s*:\s*'';/);
});

test('all Groups-enabled session rows present RSVP as a labeled action beside calendar', () => {
  const schedule = modules['stick-and-puck/modules/schedule.js'];
  const rsvp = modules['stick-and-puck/modules/rsvp.js'];
  assert.match(schedule, /class="going-btn"[\s\S]*?<span class="going-label">RSVP<\/span>/);
  assert.match(schedule, /<div class="row-actions">\$\{goingBtn\}\$\{calendarBtn\}<\/div>/);
  assert.match(schedule, /aria-label="RSVP and see who’s going"/);
  assert.doesNotMatch(schedule, /class="going-btn"[^>]*\btitle=/);
  assert.match(rsvp, /document\.querySelector\('\.going-btn'\)/);
  assert.match(rsvp, /Tap RSVP to see who’s going and add yourself/);
  assert.match(rsvp, /`RSVP and see who’s going, \$\{count\} going`/);
  assert.match(rsvp, /count \? `<span class="going-count">\$\{count\}<\/span>` : ''/);
});

test('Public Skate launch metadata, Groups row, limited filters, and crawl surfaces are complete', () => {
  const publicSkate = pages['public-skate/index.html'];
  const homepage = fs.readFileSync('index.html', 'utf8');
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  const robots = fs.readFileSync('robots.txt', 'utf8');
  const notFound = fs.readFileSync('404.html', 'utf8');
  const technicalSpec = fs.readFileSync('instructions/postandin-technical-spec.md', 'utf8');

  assert.match(publicSkate, /<title>Public Skate Seattle \| Post &amp; In<\/title>/);
  assert.match(publicSkate, /<link rel="canonical" href="https:\/\/postandin\.com\/public-skate\/">/);
  assert.match(publicSkate, /<meta property="og:url" content="https:\/\/postandin\.com\/public-skate\/">/);
  assert.doesNotMatch(publicSkate, /data-filter="available"|data-filter="female"/);
  assert.match(publicSkate, /<div class="controls-row groups-row" id="groupsRow"><\/div>/);
  assert.doesNotMatch(publicSkate, /noindex/);
  assert.match(homepage, /Stick &amp; Puck, Drop-In Hockey, and Public Skate sessions/);
  assert.match(sitemap, /<loc>https:\/\/postandin\.com\/public-skate\/<\/loc>/);
  assert.doesNotMatch(robots, /Disallow:\s*\/public-skate\//);
  assert.match(notFound, /href="\/public-skate\/"/);
  assert.match(technicalSpec, /\| Groups feature \| Live on all three schedules \|/);
  assert.doesNotMatch(technicalSpec, /Public Skate deliberately has no Groups|Live on Stick & Puck and Drop-in Hockey only/);
});

test('Public Skate renders duration while activity subtitles remain separately configurable', () => {
  const schedule = modules['stick-and-puck/modules/schedule.js'];
  assert.match(schedule, /const dur = activityConfig\.showDuration \? fmtDuration\(s\.start, s\.end\) : '';/);
  assert.match(schedule, /const subtitleBadge = activityConfig\.showSessionSubtitles && s\.subtitle/);
});

test('Drop-in Hockey launch metadata and crawl surfaces are complete', () => {
  const dropIn = pages['drop-in-hockey/index.html'];
  const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
  const robots = fs.readFileSync('robots.txt', 'utf8');
  const notFound = fs.readFileSync('404.html', 'utf8');

  assert.match(dropIn, /<title>Drop-in Hockey \| Post &amp; In<\/title>/);
  assert.match(dropIn, /<meta name="description" content="Find drop-in hockey sessions around Seattle\.">/);
  assert.match(dropIn, /<link rel="canonical" href="https:\/\/postandin\.com\/drop-in-hockey\/">/);
  assert.match(dropIn, /<meta property="og:url" content="https:\/\/postandin\.com\/drop-in-hockey\/">/);
  assert.doesNotMatch(dropIn, /noindex/);
  assert.match(sitemap, /<loc>https:\/\/postandin\.com\/drop-in-hockey\/<\/loc>/);
  assert.doesNotMatch(robots, /Disallow:\s*\/drop-in-hockey\//);
  assert.match(notFound, /href="\/drop-in-hockey\/"/);
});
