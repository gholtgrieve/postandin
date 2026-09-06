import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const travelPage = fs.readFileSync('mets-16aa-travel/index.html', 'utf8');
const socialPreview = fs.readFileSync('mets-16aa-travel/social-preview.png');
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
  'functions/coaches/[slug].js',
];

test('travel page remains direct-link and non-indexed', () => {
  assert.match(travelPage, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(sitemap, /mets-16aa-travel/);
  assert.doesNotMatch(robots, /Disallow:\s*\/mets-16aa-travel\//);

  const travelHeaders = headers.match(/^\/mets-16aa-travel\/\*(?:\n[ \t]+[^\n]+)*/m)?.[0] ?? '';
  assert.match(travelHeaders, /X-Robots-Tag: noindex, nofollow/);
  assert.match(travelHeaders, /Cache-Control: no-cache/);

  for (const path of publicPagePaths) {
    const publicPage = fs.readFileSync(path, 'utf8');
    assert.doesNotMatch(publicPage, /href="\/mets-16aa-travel(?:["/?#])/, path);
  }
});

test('every trip with published game times includes the warmup reminder', () => {
  const trips = [...travelPage.matchAll(/<article class="trip(?: priority)?" id="([^"]+)">([\s\S]*?)<\/article>/g)];
  assert.ok(trips.length > 0);

  for (const [, id, content] of trips) {
    const hasPublishedTime = /<time datetime=/.test(content);
    const hasReminder = /class="game-arrival-note"/.test(content);
    assert.equal(hasReminder, hasPublishedTime, id);
  }
});

test('travel page provides a complete large-image social preview', () => {
  assert.match(travelPage, /<meta property="og:type" content="website">/);
  assert.match(travelPage, /<meta property="og:title" content="Seattle Junior Mets 16U AA Travel Information">/);
  assert.match(travelPage, /<meta property="og:description" content="[^"]+">/);
  assert.match(travelPage, /<meta property="og:url" content="https:\/\/postandin\.com\/mets-16aa-travel\/">/);
  assert.match(travelPage, /<meta property="og:image" content="https:\/\/postandin\.com\/mets-16aa-travel\/social-preview\.png">/);
  assert.match(travelPage, /<meta property="og:image:width" content="1200">/);
  assert.match(travelPage, /<meta property="og:image:height" content="630">/);
  assert.match(travelPage, /<meta property="og:image:alt" content="[^"]+">/);
  assert.match(travelPage, /<meta name="twitter:card" content="summary_large_image">/);
  assert.ok(socialPreview.length > 10_000);
  assert.deepEqual(
    [...socialPreview.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(socialPreview.readUInt32BE(16), 1200);
  assert.equal(socialPreview.readUInt32BE(20), 630);
});
