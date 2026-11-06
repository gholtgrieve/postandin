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
  assert.match(statsPage, /Pos = position; GP = games played; G = goals; A = assists; PTS = points; PEN = penalties; PIM = penalty minutes\./);
  assert.doesNotMatch(statsPage, />\+\/-</);
  assert.match(statsPage, /Mateus Mendes/);
  assert.match(statsPage, /Anthony O'Donnell/);
  assert.match(statsPage, /Through the November 1 game vs Spokane/);
  assert.match(statsPage, /<span class="stat-label">Games<\/span><span class="stat-value">18<\/span>/);
  assert.match(statsPage, /<span class="stat-value">3-13-2<\/span>/);
  assert.match(statsPage, /<span class="stat-value">39 \/ 69<\/span>/);
  assert.match(statsPage, /Mateus Mendes<\/td><td>F<\/td><td>18<\/td>.*data-reviewed="8" data-official="8"/);
  assert.match(statsPage, /Jesper Clark<\/td><td>F<\/td><td>18<\/td>.*data-reviewed="7" data-official="6"/);
  assert.match(statsPage, /Chase Pocholski<\/td><td>D<\/td><td>17<\/td>.*<td>15<\/td><td>60<\/td>/);
  assert.match(statsPage, /Joshua Haglof McCallum<\/td><td>D<\/td><td>11<\/td>/);
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
  assert.match(statsPage, /Anthony O'Donnell<\/td><td>10<\/td><td>2<\/td><td>6<\/td><td>1<\/td><td>223<\/td><td>35<\/td><td>207<\/td><td class="points" data-sort-value="92\.8">92\.8%/);
  assert.match(statsPage, /Miguel Martinez<\/td><td>9<\/td><td>1<\/td><td>7<\/td><td>1<\/td><td>260<\/td><td>34<\/td><td>237<\/td><td class="points" data-sort-value="91\.2">91\.2%/);
  assert.match(statsPage, /O'Donnell's SA, SV, and SV% cover six of ten appearances/);
  assert.match(statsPage, /Goals against count every goalie appearance/);
  assert.match(statsPage, /O'Donnell's October 31 Boise relief appearance carried no decision/);
  assert.match(statsPage, /October 31 Boise workload is excluded/);
  assert.match(statsPage, /October 31 Tri-Cities workload is also excluded/);
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
  const seasonResults = statsPage.slice(
    statsPage.indexOf('<h3 class="chart-title" id="timeline-title">Season results<\/h3>'),
    statsPage.indexOf('<section class="chart-card chart-wide" aria-labelledby="special-teams-title">')
  );
  assert.ok(seasonResults.indexOf('Nov 1') < seasonResults.indexOf('Oct 31'));
  assert.ok(seasonResults.indexOf('Oct 31') < seasonResults.indexOf('Sep 12'));
  assert.match(seasonResults, /Most recent games are shown first/);
  assert.match(statsPage, /0\.67 · 0\.83 · 0\.67/);
  assert.match(statsPage, /Mets goals per game in periods one, two, and three/);
  assert.match(statsPage, /112 minutes shorthanded/);
  assert.match(statsPage, /Penalty Minutes<\/span><strong class="metric-value">6:13/);
  assert.match(statsPage, /average minutes playing shorthanded per game/);
  assert.doesNotMatch(statsPage, /Eighteen games provide an early summary/);
  assert.doesNotMatch(statsPage, /276 penalty minutes|Penalty minutes<\/span><strong class="metric-value">15\.3/);
  assert.doesNotMatch(statsPage, /Coach-review draft/);
  assert.doesNotMatch(statsPage, /These figures describe what has happened so far/);
  assert.doesNotMatch(statsPage, /Create more pressure|Protect periods two and three|Reduce avoidable minutes/);
  assert.match(statsPage, /Shots by game/);
  assert.match(statsPage, /Special teams goals/);
  assert.match(statsPage, /Power-play goals for<\/span><strong>6/);
  assert.match(statsPage, /Power-play goals against<\/span><strong>12/);
  assert.match(statsPage, /Shorthanded goals for<\/span><strong>0/);
  assert.match(statsPage, /Shorthanded goals against<\/span><strong>5/);
  assert.match(statsPage, /50 confirmed opportunities through Oct 25/);
  assert.match(statsPage, /51 confirmed times shorthanded through Oct 25/);
  assert.match(statsPage, /1 GWG · Sep 26 vs Boise/);
  assert.match(statsPage, /1 GWG · Sep 20 vs Tacoma/);
  assert.equal((statsPage.match(/0 GWG/g) ?? []).length, 2);
  assert.match(statsPage, /Goal-type totals cover all eighteen games/);
  assert.match(statsPage, /Opportunity totals and rate statistics cover the first fourteen games/);
  assert.match(statsPage, /GWG means game-winning goal/);
  assert.doesNotMatch(statsPage, /Goal type was not recorded/);
  assert.doesNotMatch(statsPage, /Goal strength classified|27 of 37 · 73%/);
  assert.match(statsPage, /Game-by-game shot share/);
  assert.match(statsPage, /Dark points show each game's shot share/);
  assert.match(statsPage, /centered three-game average/);
  assert.match(statsPage, /using the game before and the game after each point/);
  assert.equal((statsPage.match(/class="game-point"/g) ?? []).length, 15);
  assert.equal((statsPage.match(/class="trend-line"/g) ?? []).length, 1);
  assert.doesNotMatch(statsPage, /class="trend-point"|class="trend-value"/);
  assert.match(statsPage, /Game efficiency/);
  assert.match(statsPage, /Seattle Junior share of shots/);
  assert.match(statsPage, /Final goal differential/);
  assert.match(statsPage, /On our goal \(−\)/);
  assert.match(statsPage, /On their goal \(\+\)/);
  assert.equal((statsPage.match(/class="diverging-chart game-shot-chart"/g) ?? []).length, 15);
  assert.equal((statsPage.match(/class="diverging-chart period-goal-chart"/g) ?? []).length, 3);
  assert.match(statsPage, /Goals by period/);
  assert.match(statsPage, /Penalty profile/);
  assert.match(statsPage, /Playing penalties only: 85 calls and 176 PIM/);
  assert.match(statsPage, /Misconduct records are excluded/);
  assert.doesNotMatch(statsPage, /id="misconducts-title"/);
  assert.match(statsPage, /Goaltender workload/);
  assert.equal((statsPage.match(/class="workload-row"/g) ?? []).length, 13);
  assert.doesNotMatch(statsPage, /workload-game"><strong>Oct (3|4) · L/);
  assert.match(statsPage, /Period-level shot totals are available for eight games/);
  assert.match(statsPage, /Shot location and high-danger chances are not currently tracked/);
  assert.match(statsPage, /October 3, 4, and 30 are excluded because shots and saves were not recorded/);
  assert.equal((statsPage.match(/<table[^>]+data-sortable/g) ?? []).length, 2);
});
