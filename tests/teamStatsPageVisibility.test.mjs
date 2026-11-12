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
  assert.match(statsPage, />SCORING CREDIT<\/button>/);
  assert.match(statsPage, />PIM<\/button>/);
  assert.match(statsPage, />EXPECTED PENALTY COST<\/button>/);
  assert.match(statsPage, />PK GA<\/button>/);
  assert.match(statsPage, />SCORING NET<\/button>/);
  assert.ok(statsPage.indexOf('>PTS<\/button>') < statsPage.indexOf('>SCORING CREDIT<\/button>'));
  assert.match(statsPage, /EXPECTED PENALTY COST = season-total expected goals of team goal-differential cost assigned through reviewed penalty responsibility/);
  assert.match(statsPage, /PK GA = realized goals allowed while shorthanded and assigned to the responsible penalty/);
  assert.match(statsPage, /SCORING NET = SCORING CREDIT minus PK GA/);
  assert.doesNotMatch(statsPage, />\+\/-</);
  assert.match(statsPage, /Mateus Mendes/);
  assert.match(statsPage, /Anthony O'Donnell/);
  assert.match(statsPage, /Through the November 8 game vs Portland/);
  assert.match(statsPage, /<span class="stat-label">Games<\/span><span class="stat-value">20<\/span>/);
  assert.match(statsPage, /<span class="stat-value">3-15-2<\/span>/);
  assert.match(statsPage, /<span class="stat-value">42 \/ 76<\/span>/);
  assert.match(statsPage, /Mateus Mendes<\/td><td>F<\/td><td>20<\/td>.*data-reviewed="8" data-official="8"/);
  assert.match(statsPage, /Jesper Clark<\/td><td>F<\/td><td>20<\/td>.*data-reviewed="6" data-official="6"/);
  assert.ok(statsPage.indexOf('Joshua Haglof McCallum') < statsPage.indexOf('Cruz Bugeaud'));
  assert.match(statsPage, /Chase Pocholski<\/td><td>D<\/td><td>17<\/td>.*<td>15<\/td><td>60<\/td>/);
  assert.match(statsPage, /Joshua Haglof McCallum<\/td><td>D<\/td><td>13<\/td>/);
  assert.match(statsPage, /Chase Pocholski<\/td>.*data-reviewed="0\.833" data-official="0\.333".*<td>2\.876<\/td><td>4\.500<\/td>.*data-reviewed="-3\.667" data-official="-4\.167"/);
  assert.match(statsPage, /Ethan Hines<\/td>.*data-reviewed="0\.500" data-official="0\.000".*<td>2\.684<\/td><td>1\.000<\/td>.*data-reviewed="-0\.500" data-official="-1\.000"/);
  assert.match(statsPage, /Christian Lagerholm<\/td>.*<td>1\.318<\/td><td>1\.500<\/td>.*data-reviewed="0\.000" data-official="-0\.167"/);
  assert.match(statsPage, /Juone Kim<\/td>.*data-reviewed="2\.667" data-official="2\.167".*<td>0\.000<\/td><td>0\.000<\/td>.*data-reviewed="\+2\.667" data-official="\+2\.167"/);
});

test('both player tables provide sortable column controls', () => {
  assert.equal((statsPage.match(/<table[^>]+data-sortable/g) ?? []).length, 2);
  assert.match(statsPage, /button\.addEventListener\('click'/);
  assert.match(statsPage, /aria-sort="descending"/);
});

test('scoring credit, penalty cost, and PK goals stay aligned for every player and source', () => {
  const playerTable = statsPage.match(/<table data-sortable data-player-table[\s\S]*?<\/table>/)?.[0] ?? '';
  const headers = [...playerTable.matchAll(/<th[^>]*>[\s\S]*?<button[^>]*>([^<]+)<\/button>[\s\S]*?<\/th>/g)]
    .map((match) => match[1]);
  assert.deepEqual(headers, [
    '#', 'Player', 'Pos', 'GP', 'G', 'A', 'PTS', 'SCORING CREDIT',
    'PEN', 'PIM', 'EXPECTED PENALTY COST', 'PK GA', 'SCORING NET',
  ]);

  const body = playerTable.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((rowMatch) => (
    [...rowMatch[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((cellMatch) => ({
      attributes: cellMatch[1],
      text: cellMatch[2].replace(/<[^>]+>/g, '').trim(),
    }))
  ));
  assert.equal(rows.length, 17);

  const creditTotals = { reviewed: 0, official: 0 };
  let activePkGoalsAgainst = 0;
  for (const cells of rows) {
    assert.equal(cells.length, 13);
    const credit = cells[7];
    const penaltyCost = Number(cells[10].text);
    const pkGoalsAgainst = Number(cells[11].text);
    const scoringNet = cells[12];
    assert.doesNotMatch(cells[10].attributes, /stat-switch|data-reviewed|data-official/);
    assert.doesNotMatch(cells[11].attributes, /stat-switch|data-reviewed|data-official/);
    assert.ok(Number.isFinite(penaltyCost));
    assert.ok(Number.isFinite(pkGoalsAgainst));
    activePkGoalsAgainst += pkGoalsAgainst;

    for (const view of ['reviewed', 'official']) {
      const creditValue = Number(credit.attributes.match(new RegExp(`data-${view}="([^"]+)"`))?.[1]);
      const netValue = Number(scoringNet.attributes.match(new RegExp(`data-${view}="([^"]+)"`))?.[1]);
      assert.ok(Number.isFinite(creditValue));
      assert.ok(Number.isFinite(netValue));
      assert.ok(Math.abs((creditValue - pkGoalsAgainst) - netValue) <= 0.0011);
      creditTotals[view] += creditValue;
    }
    assert.equal(credit.text, credit.attributes.match(/data-reviewed="([^"]+)"/)?.[1]);
    assert.equal(scoringNet.text, scoringNet.attributes.match(/data-reviewed="([^"]+)"/)?.[1]);
  }

  assert.ok(Math.abs(creditTotals.reviewed - 42) < 0.01);
  assert.ok(Math.abs(creditTotals.official - 41) < 0.01);
  assert.equal(activePkGoalsAgainst, 15);
  assert.match(statsPage, /All 42 goals have been reviewed by video/);
  assert.match(statsPage, /One official goal has no identified scorer or assists, so official scoring credit totals 41/);
});

test('goalie totals include derived saves and save percentage', () => {
  assert.match(statsPage, />SA<\/button>/);
  assert.match(statsPage, />GA<\/button>/);
  assert.match(statsPage, />SV<\/button>/);
  assert.match(statsPage, />SV%<\/button>/);
  assert.match(statsPage, /Anthony O'Donnell<\/td><td>11<\/td><td>2<\/td><td>7<\/td><td>1<\/td><td>251<\/td><td>38<\/td><td>232<\/td><td class="points" data-sort-value="92\.4">92\.4%/);
  assert.match(statsPage, /Miguel Martinez<\/td><td>10<\/td><td>1<\/td><td>8<\/td><td>1<\/td><td>278<\/td><td>37<\/td><td>252<\/td><td class="points" data-sort-value="90\.6">90\.6%/);
  assert.match(statsPage, /SA = shots against; GA = goals against; SV = saves; SV% = save percentage/);
  assert.doesNotMatch(statsPage, /Goals against count every goalie appearance|October 31 Boise workload|October 31 Tri-Cities workload/);
});

test('display names retain natural order while sorting by surname', () => {
  assert.match(statsPage, /data-sort-value="Haglof McCallum, Max">Max Haglof McCallum/);
  assert.match(statsPage, /data-sort-value="O'Donnell, Anthony">Anthony O'Donnell/);
  assert.match(statsPage, /dataset\.sortValue \|\|/);
});

test('player positions reflect the current Seattle Junior roster', () => {
  assert.match(statsPage, /Max Haglof McCallum<\/td><td>F<\/td>/);
  assert.match(statsPage, /Zaedan Longley<\/td><td>F\/D<\/td>/);
  assert.match(statsPage, /Eliot Osborn<\/td><td>F\/D<\/td>/);
});

test('coach-review analytics preserve the basic tables and label data limitations', () => {
  assert.match(statsPage, /Season Snapshot/);
  const seasonResults = statsPage.slice(
    statsPage.indexOf('<h3 class="chart-title" id="timeline-title">Season results<\/h3>'),
    statsPage.indexOf('<section class="chart-card chart-wide" aria-labelledby="special-teams-title">')
  );
  assert.ok(seasonResults.indexOf('Nov 8') < seasonResults.indexOf('Nov 7'));
  assert.ok(seasonResults.indexOf('Nov 7') < seasonResults.indexOf('Nov 1'));
  assert.ok(seasonResults.indexOf('Nov 1') < seasonResults.indexOf('Oct 31'));
  assert.ok(seasonResults.indexOf('Oct 31') < seasonResults.indexOf('Sep 12'));
  assert.doesNotMatch(seasonResults, /Most recent games are shown first/);
  assert.doesNotMatch(seasonResults, /Seattle Junior's score is listed first/);
  assert.match(statsPage, /period-label">P1<\/span> 13 · <span class="period-label">P2<\/span> 16 · <span class="period-label">P3<\/span> 13/);
  assert.match(statsPage, /Goals by Period/);
  assert.doesNotMatch(statsPage, /Average goals per game in periods one, two, and three/);
  assert.match(statsPage, /<strong>123 minutes<\/strong>/);
  assert.doesNotMatch(statsPage, /Elapsed time at a player disadvantage/);
  assert.match(statsPage, /<h2 id="players-heading">Players<\/h2>/);
  assert.doesNotMatch(statsPage, /skater/i);
  assert.doesNotMatch(statsPage, /manpower/i);
  assert.match(statsPage, /Avg\. PK Time\/Game<\/span><strong class="metric-value">6:08/);
  assert.match(statsPage, /Avg\. Goals\/Game<\/span><strong class="metric-value">2\.10/);
  assert.match(statsPage, /Expected penalty cost/);
  assert.match(statsPage, /0\.91 goals\/game/);
  assert.match(statsPage, /Future penalties are expected to reduce team goal differential by about 18 goals per 20 games/);
  assert.match(statsPage, /SCORING CREDIT divides each team goal equally among its credited scorer and assist providers/);
  const teamMetrics = statsPage.slice(
    statsPage.indexOf('<div class="metric-grid" aria-label="Team performance metrics">'),
    statsPage.indexOf('<section class="chart-card chart-wide" aria-labelledby="timeline-title">')
  );
  assert.ok(teamMetrics.indexOf('Avg. shot differential') < teamMetrics.indexOf('Avg. Goals/Game'));
  assert.ok(teamMetrics.indexOf('Avg. Goals/Game') < teamMetrics.indexOf('Team save percentage'));
  assert.doesNotMatch(statsPage, /metric-context/);
  assert.doesNotMatch(statsPage, /Eighteen games provide an early summary/);
  assert.doesNotMatch(statsPage, /36\.4% average shot share in fifteen games with data/);
  assert.doesNotMatch(statsPage, /276 penalty minutes|Penalty minutes<\/span><strong class="metric-value">15\.3/);
  assert.doesNotMatch(statsPage, /Coach-review draft/);
  assert.doesNotMatch(statsPage, /These figures describe what has happened so far/);
  assert.doesNotMatch(statsPage, /Create more pressure|Protect periods two and three|Reduce avoidable minutes/);
  assert.doesNotMatch(statsPage, /Shots by game/);
  assert.match(statsPage, /Special teams goals/);
  assert.match(statsPage, /Power-play conversion<\/span><strong>12\.2%/);
  assert.match(statsPage, /Power-play goals against<\/span><strong>14/);
  assert.match(statsPage, /Shorthanded goals for<\/span><strong>0/);
  assert.match(statsPage, /Shorthanded goals against<\/span><strong>6/);
  assert.match(statsPage, /9 goals on 74 power plays/);
  assert.match(statsPage, /83\.1% · 69 successful penalty kills on 83 opportunities/);
  assert.doesNotMatch(statsPage, /GWG/);
  assert.doesNotMatch(statsPage, /Goal-type totals cover all eighteen games/);
  assert.doesNotMatch(statsPage, /Opportunity totals and rate statistics cover the first fourteen games/);
  assert.doesNotMatch(statsPage, /Goal type was not recorded/);
  assert.doesNotMatch(statsPage, /Goal strength classified|27 of 37 · 73%/);
  assert.match(statsPage, /Game-by-game shot share/);
  assert.match(statsPage, /Dark points show each game's shot share\. The gold line shows the centered three-game average, using the game before and the game after each point\. The October 3, 4, and 30 games are excluded because shots were not recorded/);
  assert.match(statsPage, /centered three-game average/);
  assert.match(statsPage, /using the game before and the game after each point/);
  assert.equal((statsPage.match(/class="game-point"/g) ?? []).length, 17);
  assert.equal((statsPage.match(/class="trend-line"/g) ?? []).length, 1);
  assert.doesNotMatch(statsPage, /class="trend-point"|class="trend-value"/);
  assert.match(statsPage, /Game efficiency/);
  assert.match(statsPage, /Hover over or focus a point for the matchup and final score\. This compares game results with shot volume, but does not account for shot location or quality\. The October 3, 4, and 30 games are excluded because shots were not recorded/);
  assert.doesNotMatch(statsPage, /Shot share is plotted left to right|Each point is a game|Select it for the matchup and score/);
  assert.match(statsPage, /Seattle Junior share of shots/);
  assert.match(statsPage, /Final goal differential/);
  assert.equal((statsPage.match(/class="efficiency-point"/g) ?? []).length, 17);
  assert.doesNotMatch(statsPage, /class="diverging-chart game-shot-chart"/);
  assert.equal((statsPage.match(/class="diverging-chart period-goal-chart"/g) ?? []).length, 3);
  assert.match(statsPage, /Goals by period/);
  assert.match(statsPage, /Penalty profile/);
  assert.match(statsPage, /92 penalties · 190 PIM · Excludes misconducts/);
  assert.doesNotMatch(statsPage, /Misconduct records are excluded/);
  assert.doesNotMatch(statsPage, /id="misconducts-title"/);
  assert.doesNotMatch(statsPage, /Goaltender workload|class="workload-row"/);
  assert.doesNotMatch(statsPage, /All eighteen games share a thirty-goal scale|Period-level shot totals are available for eight games/);
  assert.match(statsPage, /All 42 goals have been reviewed by video, with 24 corrections/);
  assert.match(statsPage, /Video-reviewed totals use confirmed corrections; official totals come directly from scoresheets or the NWAHL webpage/);
  assert.doesNotMatch(statsPage, /Misconducts and game misconducts are each counted as separate penalties/);
  assert.doesNotMatch(statsPage, /Shot location and high-danger chances are not currently tracked/);
  assert.doesNotMatch(statsPage, /October 3, 4, and 30 are excluded because shots and saves were not recorded/);
  assert.equal((statsPage.match(/<table[^>]+data-sortable/g) ?? []).length, 2);
});
