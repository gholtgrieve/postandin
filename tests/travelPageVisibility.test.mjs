import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const travelPage = fs.readFileSync('mets-16aa-travel/index.html', 'utf8');
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
