import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pages = [
  {
    path: 'index.html',
    url: 'https://postandin.com/',
    title: 'Post &amp; In — Seattle Hockey Schedules &amp; Coaches',
    description: 'Find live ice times and youth hockey coaches across the Seattle area.',
  },
  {
    path: 'stick-and-puck/index.html',
    url: 'https://postandin.com/stick-and-puck/',
    title: 'Stick &amp; Puck Seattle | Open Ice Sessions at Local Rinks | Post &amp; In',
    description: 'Find open ice stick &amp; puck sessions at Seattle area rinks — updated live. Filter by day, rink, and availability.',
  },
  {
    path: 'drop-in-hockey/index.html',
    url: 'https://postandin.com/drop-in-hockey/',
    title: 'Drop-in Hockey | Post &amp; In',
    description: 'Find drop-in hockey sessions around Seattle.',
  },
  {
    path: 'public-skate/index.html',
    url: 'https://postandin.com/public-skate/',
    title: 'Public Skate Seattle | Post &amp; In',
    description: 'Find public ice skating sessions around Seattle, with times and rink locations updated live.',
  },
  {
    path: 'coaches/index.html',
    url: 'https://postandin.com/coaches/',
    title: 'Seattle Youth Hockey Coaches | Private Lessons &amp; Team Coaching | Post &amp; In',
    description: 'Find Seattle youth hockey coaches offering private lessons. Filter by specialty, age group, rink, and level.',
  },
];

const socialImageUrl = 'https://postandin.com/social-preview.png';

for (const page of pages) {
  test(`${page.path} provides the site-wide large-image social preview`, () => {
    const html = readFileSync(new URL(`../${page.path}`, import.meta.url), 'utf8');

    assert.match(html, /<meta property="og:type" content="website">/);
    assert.ok(html.includes(`<link rel="canonical" href="${page.url}">`));
    assert.ok(html.includes(`<meta property="og:title" content="${page.title}">`));
    assert.ok(html.includes(`<meta property="og:description" content="${page.description}">`));
    assert.ok(html.includes(`<meta property="og:url" content="${page.url}">`));
    assert.match(html, new RegExp(`<meta property="og:image" content="${socialImageUrl.replaceAll('.', '\\.')}">`));
    assert.match(html, /<meta property="og:image:width" content="1200">/);
    assert.match(html, /<meta property="og:image:height" content="630">/);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+">/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.ok(html.includes(`<meta name="twitter:title" content="${page.title}">`));
    assert.ok(html.includes(`<meta name="twitter:description" content="${page.description}">`));
    assert.match(html, new RegExp(`<meta name="twitter:image" content="${socialImageUrl.replaceAll('.', '\\.')}">`));
    assert.match(html, /<meta name="twitter:image:alt" content="[^"]+">/);

    assert.equal((html.match(/property="og:image"/g) ?? []).length, 1);
    assert.equal((html.match(/name="twitter:image"/g) ?? []).length, 1);
  });
}

test('site-wide social preview is a genuine 1200×630 PNG', () => {
  const image = readFileSync(new URL('../social-preview.png', import.meta.url));

  assert.ok(image.length > 10_000);
  assert.deepEqual(
    [...image.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(image.toString('ascii', 12, 16), 'IHDR');
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});
