import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {dirname,posix} from 'node:path';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function staticBrowserModules(entry){
  const found=new Set(),queue=[entry];
  while(queue.length){
    const path=queue.shift();if(found.has(path))continue;found.add(path);
    const source=read(path),references=[
      ...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+[^;]*?\bfrom\s+['"]([^'"]+\.mjs)['"]/g),
      ...source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+\.mjs)['"]/g),
    ];
    for(const match of references){
      if(match[1].startsWith('.'))queue.push(posix.normalize(posix.join(dirname(path),match[1])));
    }
  }
  return found;
}
function headerBlock(headers,pattern){
  const lines=headers.split('\n'),start=lines.indexOf(pattern);if(start<0)return '';
  let end=start+1;while(end<lines.length&&lines[end].startsWith('  '))end++;
  return lines.slice(start,end).join('\n');
}
test('public Gear Exchange is discoverable while owner assets remain noindex', () => {
  assert.doesNotMatch(read('gear/index.html'), /name="robots" content="noindex/);
  assert.match(read('gear/index.html'), /rel="canonical" href="https:\/\/postandin\.com\/gear\/"/);
  assert.match(read('gear/index.html'), /<div class="pi-preview-bar" hidden>/);
  assert.match(read('gear/index.html'), /<section class="pi-home" hidden>/);
  assert.match(read('gear/index.html'), /<section class="pi-gear">/);
  assert.match(read('gear/index.html'), /id="pi-local-rules" hidden/);
  for(const property of ['og:title','og:description','og:url','og:image'])assert.match(read('gear/index.html'),new RegExp(`property="${property}"`));
  for(const name of ['twitter:card','twitter:title','twitter:description','twitter:image'])assert.match(read('gear/index.html'),new RegExp(`name="${name}"`));
  assert.match(read('gear/owner.html'), /name="robots" content="noindex,nofollow"/);
  assert.doesNotMatch(headerBlock(read('_headers'),'/gear/*'), /X-Robots-Tag/);
  assert.match(headerBlock(read('_headers'),'/gear/owner*'), /X-Robots-Tag: noindex, nofollow/);
  assert.doesNotMatch(read('robots.txt'), /Disallow:.*gear/);
  assert.match(read('sitemap.xml'), /<loc>https:\/\/postandin\.com\/gear\/<\/loc>/);
  assert.match(read('index.html'), /href="\/gear\/"/);
  for (const path of ['404.html', 'coaches/index.html', 'stick-and-puck/index.html', 'drop-in-hockey/index.html', 'public-skate/index.html', 'mets-16aa-travel/index.html', 'mets-16aa-stats/index.html']) {
    assert.doesNotMatch(read(path), /href=["'](?:https:\/\/postandin\.com)?\/gear(?:[\/?#"'])/);
  }
  assert.doesNotMatch(read('index.html'), /href=["'][^"']*owner/);
  assert.doesNotMatch(read('sitemap.xml'), /owner/);
  assert.ok(read('404.html').includes('<html'));
  assert.equal(existsSync(new URL('../_redirects', import.meta.url)), false);
  const headers=read('_headers');
  for(const path of new Set([...staticBrowserModules('gear/gear.mjs'),...staticBrowserModules('gear/owner.mjs')])){
    const direct=headerBlock(headers,'/'+path),wildcard=headerBlock(headers,'/'+dirname(path)+'/*');
    assert.match(direct,/\n  Content-Type: application\/javascript(?:\n|$)/);
    assert.match(direct+'\n'+wildcard,/\n  Cache-Control: no-cache(?:\n|$)/);
  }
});
