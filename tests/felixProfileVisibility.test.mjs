import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');
const page = read('felix-holtgrieve/index.html');
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

test('Felix profile scaffold includes verified facts and an empty clip state', () => {
  assert.match(page, /Seattle Junior Mets/);
  assert.match(page, /<dt>Position<\/dt>\s*<dd>Defense<\/dd>/);
  assert.match(page, /<dt>Number<\/dt>\s*<dd>17<\/dd>/);
  assert.match(page, /2026–27 Highlights/);
  assert.match(page, /Clips coming soon/);
});
