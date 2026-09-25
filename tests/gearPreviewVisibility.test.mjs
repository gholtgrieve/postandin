import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('unfinished gear preview stays unlinked and noindex without blocking crawlers', () => {
  assert.match(read('gear/index.html'), /name="robots" content="noindex,nofollow"/);
  assert.match(read('_headers'), /\/gear\/\*\n  X-Robots-Tag: noindex, nofollow/);
  assert.doesNotMatch(read('robots.txt'), /Disallow:.*gear/);
  assert.doesNotMatch(read('sitemap.xml'), /\/gear\//);
  for (const path of ['index.html', '404.html', 'coaches/index.html', 'stick-and-puck/index.html', 'drop-in-hockey/index.html', 'public-skate/index.html', 'mets-16aa-travel/index.html', 'mets-16aa-stats/index.html']) {
    assert.doesNotMatch(read(path), /href=["'](?:https:\/\/postandin\.com)?\/gear(?:[\/?#"'])/);
  }
  assert.ok(read('404.html').includes('<html'));
  assert.equal(existsSync(new URL('../_redirects', import.meta.url)), false);
});
