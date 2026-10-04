import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

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
  'mets-16aa-travel/index.html',
  'functions/coaches/[slug].js',
];

test('team stats page remains direct-link and non-indexed', () => {
  assert.match(statsPage, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(statsPage, /Unofficial team stats/);
  assert.doesNotMatch(sitemap, /mets-16aa-stats/);
  assert.doesNotMatch(robots, /Disallow:\s*\/mets-16aa-stats\//);

  const statsHeaders = headers.match(/^\/mets-16aa-stats\/\*(?:\n[ \t]+[^\n]+)*/m)?.[0] ?? '';
  assert.match(statsHeaders, /X-Robots-Tag: noindex, nofollow/);
  assert.match(statsHeaders, /Cache-Control: no-cache/);

  for (const path of publicPagePaths) {
    const publicPage = fs.readFileSync(path, 'utf8');
    assert.doesNotMatch(publicPage, /href="(?:https:\/\/postandin\.com)?\/mets-16aa-stats(?:["\/?#])/, path);
  }
});

test('team stats page exposes the expected season table without plus-minus', () => {
  assert.match(statsPage, />GP<\/button>/);
  assert.match(statsPage, />G<\/button>/);
  assert.match(statsPage, />A<\/button>/);
  assert.match(statsPage, />PTS<\/button>/);
  assert.match(statsPage, />PIM<\/button>/);
  assert.match(statsPage, /Pos = position; GP = games played; G = goals; A = assists; PTS = points; PIM = penalty minutes\./);
  assert.doesNotMatch(statsPage, />\+\/-</);
  assert.match(statsPage, /Mateus Mendes/);
  assert.match(statsPage, /Anthony O'Donnell/);
  assert.match(statsPage, /Through September 27, 2026/);
  assert.match(statsPage, /<span class="stat-label">Games<\/span><span class="stat-value">8<\/span>/);
  assert.match(statsPage, /<span class="stat-value">1-6-1<\/span>/);
  assert.match(statsPage, /<span class="stat-value">13 \/ 24<\/span>/);
  assert.match(statsPage, /Mateus Mendes<\/td><td>F<\/td><td>8<\/td><td>3<\/td><td>1<\/td><td class="points">4<\/td><td>0<\/td>/);
  assert.match(statsPage, /Jesper Clark<\/td><td>F<\/td><td>8<\/td><td>2<\/td><td>1<\/td><td class="points">3<\/td><td>4<\/td>/);
  assert.match(statsPage, /Chase Pocholski<\/td><td>D<\/td><td>7<\/td><td>0<\/td><td>0<\/td><td class="points">0<\/td><td>37<\/td>/);
});

test('both player tables provide sortable column controls', () => {
  assert.equal((statsPage.match(/<table[^>]+data-sortable/g) ?? []).length, 2);
  assert.match(statsPage, /button\.addEventListener\('click'/);
  assert.match(statsPage, /aria-sort="descending"/);
});

test('goalie totals include derived saves and save percentage', () => {
  assert.match(statsPage, />SA<\/button>/);
  assert.match(statsPage, />GA<\/button>/);
  assert.match(statsPage, />SV<\/button>/);
  assert.match(statsPage, />SV%<\/button>/);
  assert.match(statsPage, /Anthony O'Donnell<\/td><td>4<\/td><td>0<\/td><td>3<\/td><td>1<\/td><td>166<\/td><td>12<\/td><td>154<\/td><td class="points" data-sort-value="92\.8">92\.8%/);
  assert.match(statsPage, /Miguel Martinez<\/td><td>4<\/td><td>1<\/td><td>3<\/td><td>0<\/td><td>150<\/td><td>12<\/td><td>138<\/td><td class="points" data-sort-value="92\.0">92\.0%/);
});

test('display names retain natural order while sorting by surname', () => {
  assert.match(statsPage, /data-sort-value="Haglof McCallum, Max">Max Haglof McCallum/);
  assert.match(statsPage, /data-sort-value="O'Donnell, Anthony">Anthony O'Donnell/);
  assert.match(statsPage, /dataset\.sortValue \|\|/);
});

test('player positions reflect the current Seattle Junior roster', () => {
  assert.match(statsPage, /Max Haglof McCallum<\/td><td>F<\/td>/);
  assert.match(statsPage, /Zaedan Longley<\/td><td>F\/D<\/td>/);
});

test('coach-review analytics preserve the basic tables and label data limitations', () => {
  assert.match(statsPage, /Season Snapshot/);
  assert.doesNotMatch(statsPage, /Coach-review draft/);
  assert.doesNotMatch(statsPage, /These figures describe what has happened so far/);
  assert.doesNotMatch(statsPage, /Create more pressure|Protect periods two and three|Reduce avoidable minutes/);
  assert.match(statsPage, /Shots by game/);
  assert.match(statsPage, /Special teams goals/);
  assert.match(statsPage, /Power-play goals for<\/span><strong>2/);
  assert.match(statsPage, /Power-play goals against<\/span><strong>2/);
  assert.match(statsPage, /Shorthanded goals for<\/span><strong>0/);
  assert.match(statsPage, /Shorthanded goals against<\/span><strong>3/);
  assert.match(statsPage, /26 opportunities · 7\.7%/);
  assert.match(statsPage, /25 times shorthanded · 92\.0% PK/);
  assert.match(statsPage, /1 GWG · Sep 26 vs Boise/);
  assert.match(statsPage, /1 GWG · Sep 20 vs Tacoma/);
  assert.equal((statsPage.match(/0 GWG/g) ?? []).length, 2);
  assert.match(statsPage, /Special-teams totals cover eight games/);
  assert.match(statsPage, /GWG means game-winning goal/);
  assert.doesNotMatch(statsPage, /Goal type was not recorded/);
  assert.doesNotMatch(statsPage, /Goal strength classified|27 of 37 · 73%/);
  assert.match(statsPage, /Three-game shot-share trend/);
  assert.match(statsPage, /34\.1%/);
  assert.match(statsPage, /31\.4%/);
  assert.equal((statsPage.match(/class="trend-point"/g) ?? []).length, 6);
  assert.match(statsPage, /Game efficiency/);
  assert.match(statsPage, /Seattle Junior share of shots/);
  assert.match(statsPage, /Final goal differential/);
  assert.match(statsPage, /On our goal \(−\)/);
  assert.match(statsPage, /On their goal \(\+\)/);
  assert.equal((statsPage.match(/class="diverging-chart game-shot-chart"/g) ?? []).length, 8);
  assert.equal((statsPage.match(/class="diverging-chart period-goal-chart"/g) ?? []).length, 3);
  assert.match(statsPage, /Goals by period/);
  assert.match(statsPage, /Penalty profile/);
  assert.match(statsPage, /Playing penalties only: 32 calls and 67 PIM/);
  assert.match(statsPage, /Misconduct records are excluded/);
  assert.doesNotMatch(statsPage, /id="misconducts-title"/);
  assert.match(statsPage, /Goaltender workload/);
  assert.match(statsPage, /Period-level shot totals are available for four games/);
  assert.match(statsPage, /Shot location and high-danger chances are not currently tracked/);
  assert.equal((statsPage.match(/<table[^>]+data-sortable/g) ?? []).length, 2);
});
