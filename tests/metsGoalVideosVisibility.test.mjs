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

test('goal video library exposes only the 28 bounded reviewed clips', () => {
  assert.match(goalPage, /28 reviewed Seattle goals across 10 games/);
  assert.equal((goalPage.match(/<section class="game-section"/g) ?? []).length, 10);
  assert.equal((goalPage.match(/<video controls playsinline preload="none"/g) ?? []).length, 28);
  assert.equal((goalPage.match(/<source src="https:\/\/media\.postandin\.com\/mets\/2026-27\//g) ?? []).length, 28);
  assert.equal((goalPage.match(/poster="https:\/\/media\.postandin\.com\/mets\/2026-27\//g) ?? []).length, 28);

  const videoUrls = [...goalPage.matchAll(/<source src="([^"]+\.mp4)" type="video\/mp4">/g)].map((match) => match[1]);
  const posterUrls = [...goalPage.matchAll(/poster="([^"]+\.jpg)"/g)].map((match) => match[1]);
  assert.equal(new Set(videoUrls).size, 28);
  assert.equal(new Set(posterUrls).size, 28);
  assert.doesNotMatch(goalPage, /\/goal-11\//);
  for (const url of [...videoUrls, ...posterUrls]) {
    assert.match(url, /^https:\/\/media\.postandin\.com\/mets\/2026-27\/\d{4}-\d{2}-\d{2}-[a-z-]+\/goal-\d+\/v\d+\/goal-\d+\.(?:mp4|jpg)$/);
  }
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
    'game-2026-09-13-sno-king',
    'game-2026-09-12-sno-king',
  ]);

  const linkMatches = [...statsPage.matchAll(/class="timeline-video-link" href="\/mets-16aa-goals\/#([^"]+)" aria-label="([^"]+)">(Watch (?:goal|\d+ goals))<\/a>/g)];
  const links = linkMatches.map((match) => match[1]);
  assert.equal(links.length, 10);
  assert.deepEqual(new Set(links), new Set(sectionIds));
  assert.doesNotMatch(statsPage, /October 18[^\n]+timeline-video-link/);

  for (const match of linkMatches) {
    const sectionStart = goalPage.indexOf(`id="${match[1]}"`);
    const nextSection = goalPage.indexOf('<section class="game-section"', sectionStart + 1);
    const section = goalPage.slice(sectionStart, nextSection < 0 ? undefined : nextSection);
    const clipCount = (section.match(/<video controls/g) ?? []).length;
    const visibleCount = match[3] === 'Watch goal' ? 1 : Number(match[3].match(/\d+/)[0]);
    assert.equal(visibleCount, clipCount, match[1]);
    assert.match(match[2], /from (?:September|October|November)/);
  }
});
