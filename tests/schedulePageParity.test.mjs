import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pagePaths = [
  'stick-and-puck/index.html',
  'drop-in-hockey/index.html',
];
const modulePaths = [
  'stick-and-puck/modules/main.js',
  'stick-and-puck/modules/schedule.js',
  'stick-and-puck/modules/groups-ui.js',
  'stick-and-puck/modules/rsvp.js',
];

const pages = Object.fromEntries(pagePaths.map(path => [path, fs.readFileSync(path, 'utf8')]));
const modules = Object.fromEntries(modulePaths.map(path => [path, fs.readFileSync(path, 'utf8')]));
const moduleSource = Object.values(modules).join('\n');

function matches(source, pattern) {
  return [...source.matchAll(pattern)].map(match => match[1]);
}

test('both schedule shells contain the same DOM IDs', () => {
  const [stickPath, dropInPath] = pagePaths;
  const stickIds = matches(pages[stickPath], /\bid="([^"]+)"/g).sort();
  const dropInIds = matches(pages[dropInPath], /\bid="([^"]+)"/g).sort();
  assert.deepEqual(dropInIds, stickIds);
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

test('module-load selectors have targets in both static page shells', () => {
  for (const [path, html] of Object.entries(pages)) {
    assert.match(html, /class="[^"]*\bfilter-btn\b/,
      `${path} is missing the .filter-btn controls wired at module load`);
  }
});

test('each page declares its activity and offers normal-link navigation to both schedules', () => {
  assert.match(pages['stick-and-puck/index.html'], /<body data-activity="stick-and-puck">/);
  assert.match(pages['drop-in-hockey/index.html'], /<body data-activity="drop-in-hockey">/);

  for (const html of Object.values(pages)) {
    assert.match(html, /href="\/stick-and-puck\/"/);
    assert.match(html, /href="\/drop-in-hockey\/"/);
    assert.equal(matches(html, /\baria-current="(page)"/g).length, 1);
    assert.doesNotMatch(html, /Nudge your group|sheetShareBtn/);
  }
});

test('shared CSS and module cache versions stay synchronized', () => {
  for (const html of Object.values(pages)) {
    assert.match(html, /schedule\.css\?v=20260814/);
    assert.match(html, /main\.js\?v=20260814/);
  }
  assert.match(modules['stick-and-puck/modules/main.js'], /schedule\.js\?v=20260814/);
  assert.match(modules['stick-and-puck/modules/main.js'], /groups-ui\.js\?v=20260814/);
  assert.match(modules['stick-and-puck/modules/schedule.js'], /activity-config\.js\?v=20260814/);
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
