import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const goalPage = fs.readFileSync('mets-16aa-goals/index.html', 'utf8');
const statsPage = fs.readFileSync('mets-16aa-stats/index.html', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');
const headers = fs.readFileSync('_headers', 'utf8');
const publicPagePaths = [
  'index.html',
  '404.html',
  'stick-and-puck/index.html',
  'drop-in-hockey/index.html',
  'public-skate/index.html',
  'coaches/index.html',
];

test('goal video library remains direct-link and non-indexed', () => {
  assert.match(goalPage, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(goalPage, /<link rel="canonical" href="https:\/\/postandin\.com\/mets-16aa-goals\/">/);
  assert.doesNotMatch(sitemap, /mets-16aa-goals/);
  assert.doesNotMatch(robots, /Disallow:\s*\/mets-16aa-goals\//);

  const goalHeaders = headers.match(/^\/mets-16aa-goals\/\*(?:\n[ \t]+[^\n]+)*/m)?.[0] ?? '';
  assert.match(goalHeaders, /X-Robots-Tag: noindex, nofollow/);
  assert.match(goalHeaders, /Cache-Control: no-cache/);

  for (const path of publicPagePaths) {
    const publicPage = fs.readFileSync(path, 'utf8');
    assert.doesNotMatch(publicPage, /href="(?:https:\/\/postandin\.com)?\/mets-16aa-goals(?:["\/?#])/, path);
  }
});

test('goal video library exposes only the 42 bounded reviewed clips', () => {
  assert.match(goalPage, /42 reviewed Seattle goals across 19 games/);
  assert.equal((goalPage.match(/<section class="game-section"/g) ?? []).length, 19);
  assert.equal((goalPage.match(/<video controls playsinline preload="none"/g) ?? []).length, 42);
  assert.equal((goalPage.match(/<source src="https:\/\/media\.postandin\.com\/mets\/2026-27\//g) ?? []).length, 42);
  assert.equal((goalPage.match(/poster="https:\/\/media\.postandin\.com\/mets\/2026-27\//g) ?? []).length, 42);

  const videoUrls = [...goalPage.matchAll(/<source src="([^"]+\.mp4)" type="video\/mp4">/g)].map((match) => match[1]);
  const posterUrls = [...goalPage.matchAll(/poster="([^"]+\.jpg)"/g)].map((match) => match[1]);
  assert.equal(new Set(videoUrls).size, 42);
  assert.equal(new Set(posterUrls).size, 42);
  for (const url of [...videoUrls, ...posterUrls]) {
    assert.match(url, /^https:\/\/media\.postandin\.com\/mets\/2026-27\/\d{4}-\d{2}-\d{2}-[a-z-]+\/goal-\d+\/v\d+\/goal-\d+\.(?:mp4|jpg)$/);
  }
});

test('goal video library uses the corrected Haglöf spelling', () => {
  assert.match(goalPage, /Max Haglöf McCallum/);
  assert.match(goalPage, /Joshua Haglöf McCallum/);
  assert.doesNotMatch(goalPage, /Haglof McCallum/);
});

test('games and timeline links are reverse chronological and mutually valid', () => {
  const sectionIds = [...goalPage.matchAll(/<section class="game-section" id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(sectionIds, [
    'game-2026-11-08-portland',
    'game-2026-11-07-portland',
    'game-2026-11-01-spokane',
    'game-2026-10-31-tri-cities',
    'game-2026-10-31-boise',
    'game-2026-10-30-spokane',
    'game-2026-10-25-tacoma',
    'game-2026-10-24-tacoma',
    'game-2026-10-18-sno-king',
    'game-2026-10-04-tri-cities',
    'game-2026-10-03-tri-cities',
    'game-2026-09-27-utah',
    'game-2026-09-26-montana',
    'game-2026-09-26-boise',
    'game-2026-09-25-wyoming',
    'game-2026-09-20-tacoma',
    'game-2026-09-19-tacoma',
    'game-2026-09-13-sno-king',
    'game-2026-09-12-sno-king',
  ]);

  const linkMatches = [...statsPage.matchAll(/class="timeline-video-link" href="\/mets-16aa-goals\/#([^"]+)" aria-label="([^"]+)"><svg class="timeline-video-icon"[^>]+><path[^>]+\/><\/svg>(Goal videos?)<\/a>/g)];
  const links = linkMatches.map((match) => match[1]);
  assert.equal(links.length, 19);
  assert.deepEqual(new Set(links), new Set(sectionIds));

  for (const match of linkMatches) {
    const sectionStart = goalPage.indexOf(`id="${match[1]}"`);
    const nextSection = goalPage.indexOf('<section class="game-section"', sectionStart + 1);
    const section = goalPage.slice(sectionStart, nextSection < 0 ? undefined : nextSection);
    const clipCount = (section.match(/<video controls/g) ?? []).length;
    assert.equal(match[3], clipCount === 1 ? 'Goal video' : 'Goal videos', match[1]);
    assert.match(match[2], /from (?:September|October|November)/);
  }
  assert.doesNotMatch(statsPage, /Goal videos \(\d+\)/);
  assert.equal((statsPage.match(/class="timeline-video-icon"[^>]+aria-hidden="true" focusable="false"/g) ?? []).length, 19);
});
