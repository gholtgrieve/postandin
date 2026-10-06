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
  assert.match(page, /<dt>Position<\/dt>\s*<dd>Defense<\/dd>/);
  assert.match(page, /<dt>Height<\/dt>\s*<dd>6′0″<\/dd>/);
  assert.match(page, /<dt>Weight<\/dt>\s*<dd>170 lbs<\/dd>/);
  assert.match(page, /<dt>Shoots<\/dt>\s*<dd>Right<\/dd>/);
  assert.match(page, /<dt>Birth year<\/dt>\s*<dd>2011<\/dd>/);
  assert.doesNotMatch(page, /Defenseman profile and video highlights/);
  assert.match(page, /2026–27 Highlights/);
  assert.match(page, /Clips coming soon/);
});

test('playing history lists Seattle Junior teams and invite-only development recognition', () => {
  const teams = [
    ['2024–25', '14U B'],
    ['2025–26', '14U AA'],
    ['2026–27', '16U AA'],
  ];

  assert.match(page, /id="playing-history-title">Seattle Junior Teams<\/h2>/);
  for (const [season, level] of teams) {
    assert.match(
      page,
      new RegExp(`<td class="history-season">${season}<\\/td><td class="history-team">Seattle Junior Mets <strong>${level}<\\/strong><\\/td>`),
    );
  }
  assert.doesNotMatch(page, /2027–27/);
  assert.match(page, /id="camp-highlight-title">PNAHA State Development Camp<\/h3>/);
  assert.match(page, /Invite-only attendee for two consecutive years\./);
});

test('clip library scaffolds categories, efficient previews, and full playback', () => {
  assert.match(page, /src="\/felix-holtgrieve\/profile\.js\?v=3"/);
  assert.match(profileScript, /from '\.\/clips\.js\?v=3'/);
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
  assert.match(profileScript, /clip\.categories\.includes\(activeCategory\)/);
  assert.match(profileScript, /clip\.categories\.map/);
  assert.match(page, /\.filter-button\[aria-pressed='true'\] \{ background: var\(--mustard2\); color: var\(--paper\); \}/);
  assert.match(page, /id="clipStatus" role="status" aria-live="polite"/);
  assert.doesNotMatch(page, /id="clipGrid"[^>]*aria-live/);
  assert.match(clipManifest, /export const clips = \[/);
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
    assert.ok(clip.opponent?.trim(), `missing opponent for ${clip.id}`);
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
