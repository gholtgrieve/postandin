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

test('Spokane shows Thursday or Friday as arrival options', () => {
  const glance = travelPage.match(/<a class="glance-link" href="#spokane">([\s\S]*?)<\/a>/)?.[1] ?? '';
  const spokane = travelPage.match(/<article class="trip priority" id="spokane">([\s\S]*?)<\/article>/)?.[1] ?? '';
  assert.match(glance, /Arrive Thu or Fri/);
  assert.match(glance, /Hotel updates until Oct\. 29/);
  assert.match(spokane, /<span class="fact-label">Arrive<\/span><span class="fact-value arrival-options">Thursday <span class="arrival-alternative">or Friday<\/span>/);
  assert.match(spokane, /A Friday–Sunday stay is also available/);
  assert.match(spokane, /You can update your hotel reservation until October 29\./);
  assert.doesNotMatch(spokane, /group-rate booking deadline was September 29/);
});

test('Portland shows both Beaverton games and the Tigard room block', () => {
  const glance = travelPage.match(/<a class="glance-link" href="#portland">([\s\S]*?)<\/a>/)?.[1] ?? '';
  const portland = travelPage.match(/<article class="trip" id="portland">([\s\S]*?)<\/article>/)?.[1] ?? '';
  assert.match(glance, /Jan\. 9–10 · Arrive Saturday/);
  assert.match(glance, /Book by Dec\. 26/);
  assert.match(portland, /<span class="fact-label">Arrive<\/span><span class="fact-value">Saturday<\/span>/);
  assert.match(portland, /<span class="fact-label">Depart<\/span><span class="fact-value">Sunday<\/span>/);
  assert.doesNotMatch(portland, /Travel timing TBD/);
  assert.match(portland, /Hampton Inn &amp; Suites Portland-Tigard/);
  assert.match(portland, /\$119 per night/);
  assert.match(portland, /Book by December 26 for the group rate/);
  assert.match(portland, /hilton\.com\/en\/attend-my-event\/seattlejuniormets2027\//);
  assert.match(portland, /<time datetime="2027-01-09T18:30">6:30–8:00 PM<\/time>/);
  assert.match(portland, /<time datetime="2027-01-10T09:00">9:00–10:30 AM<\/time>/);
  assert.equal((portland.match(/Winterhawks Skating Center · Beaverton/g) ?? []).length, 2);
  assert.match(portland, /class="game-arrival-note"/);
});

test('completed trips are collapsed after upcoming trips without expired booking actions', () => {
  const glance = travelPage.match(/<nav id="trips"[\s\S]*?<\/nav>/)?.[0] ?? '';
  const archiveStart = travelPage.indexOf('<section class="past-trips"');
  assert.doesNotMatch(glance, /href="#tacoma"/);
  assert.doesNotMatch(glance, /href="#tri-cities-october"/);
  assert.deepEqual([...travelPage.matchAll(/<article class="trip priority" id="([^"]+)">/g)].map(match => match[1]), ['spokane']);
  assert.match(travelPage, /<article class="trip priority" id="spokane">\s*<header class="trip-heading"><p class="eyebrow">Next trip<\/p>/);
  assert.ok(archiveStart > travelPage.indexOf('<article class="trip" id="gopher-state">'));
  assert.match(travelPage.slice(archiveStart), /<details>\s*<summary>Tri-Cities · October 3–4, 2026<\/summary>\s*<article class="trip" id="tri-cities-october">/);
  assert.match(travelPage.slice(archiveStart), /<details>\s*<summary>Tacoma · September 25–27, 2026<\/summary>\s*<article class="trip" id="tacoma">/);
  assert.ok(travelPage.indexOf('<article class="trip" id="tri-cities-october">') < travelPage.indexOf('<article class="trip" id="tacoma">'));
  assert.doesNotMatch(travelPage, /groupCode=100326SEA|Book by September 30 for the group rate/);
  assert.doesNotMatch(travelPage.slice(archiveStart), /ctyhocn=SEADPHX/);
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
  assert.equal(socialPreview.toString('ascii', 12, 16), 'IHDR');
  assert.equal(socialPreview.readUInt32BE(16), 1200);
  assert.equal(socialPreview.readUInt32BE(20), 630);
});
