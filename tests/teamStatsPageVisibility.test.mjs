import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const statsPage = fs.readFileSync('mets-16aa-stats/index.html', 'utf8');
const socialPreview = fs.readFileSync('mets-16aa-stats/social-preview.png');
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

test('team stats page provides a large social sharing preview', () => {
  assert.match(statsPage, /<meta property="og:image" content="https:\/\/postandin\.com\/mets-16aa-stats\/social-preview\.png">/);
  assert.match(statsPage, /<meta property="og:image:width" content="1200">/);
  assert.match(statsPage, /<meta property="og:image:height" content="630">/);
  assert.match(statsPage, /<meta property="og:image:alt" content="[^"]+">/);
  assert.match(statsPage, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(statsPage, /<meta name="twitter:image" content="https:\/\/postandin\.com\/mets-16aa-stats\/social-preview\.png">/);
  assert.equal(socialPreview.readUInt32BE(16), 1200);
  assert.equal(socialPreview.readUInt32BE(20), 630);
});

test('team stats page exposes the expected season table without plus-minus', () => {
  assert.match(statsPage, />GP<\/button>/);
  assert.match(statsPage, />G<\/button>/);
  assert.match(statsPage, />A<\/button>/);
  assert.match(statsPage, />PTS<\/button>/);
  assert.match(statsPage, />PIM<\/button>/);
  assert.doesNotMatch(statsPage, />GOAL CREDIT<\/button>|>EXPECTED PENALTY COST<\/button>|>PK GA<\/button>|>SCORING NET<\/button>/);
  assert.doesNotMatch(statsPage, />\+\/-</);
  assert.match(statsPage, /Mateus Mendes/);
  assert.match(statsPage, /Anthony O'Donnell/);
  assert.match(statsPage, /Through the November 22 game versus New Mexico/);
  assert.match(statsPage, /aria-label="November 22 versus New Mexico, loss, 2 to 4"/);
  assert.match(statsPage, /<title>November 22 versus New Mexico: 47\.1%<\/title>/);
  assert.match(statsPage, /aria-label="November 21 versus New Mexico, loss, 1 to 4"/);
  assert.match(statsPage, /<title>November 21 versus New Mexico: 20\.0%<\/title>/);
  assert.match(statsPage, /aria-label="November 15 at Tri-Cities, loss, 1 to 4"/);
  assert.match(statsPage, /<title>November 15 at Tri-Cities: 34\.5%<\/title>/);
  assert.doesNotMatch(statsPage, /November 14 at Boise|Nov 14 · at Boise/);
  assert.match(statsPage, /aria-label="November 14 versus Boise, win, 5 to 1"/);
  assert.match(statsPage, /<title>November 14 versus Boise: 51\.9%<\/title>/);
  assert.match(statsPage, /October 31 at Boise/);
  assert.match(statsPage, /<span class="stat-label">Games<\/span><span class="stat-value">26<\/span>/);
  assert.match(statsPage, /<span class="stat-value">6-18-2<\/span>/);
  assert.match(statsPage, /<span class="stat-value">58 \/ 92<\/span>/);
  assert.match(statsPage, /Mateus Mendes<\/td><td>F<\/td><td>26<\/td><td>11<\/td>/);
  assert.match(statsPage, /Jesper Clark<\/td><td>F<\/td><td>26<\/td><td>10<\/td>/);
  assert.ok(statsPage.indexOf('Joshua Haglöf McCallum') < statsPage.indexOf('Cruz Bugeaud'));
  assert.match(statsPage, /Chase Pocholski<\/td><td>D<\/td><td>21<\/td>.*<td>16<\/td><td>62<\/td>/);
  assert.match(statsPage, /Joshua Haglöf McCallum<\/td><td>D<\/td><td>19<\/td>.*<td>5<\/td><td>10<\/td>/);
  assert.match(statsPage, /Ethan Hines<\/td><td>D<\/td><td>22<\/td>.*<td>25<\/td><td>88<\/td>/);
});

test('both player tables provide sortable column controls and players default to number order', () => {
  assert.equal((statsPage.match(/<table[^>]+data-sortable/g) ?? []).length, 2);
  assert.match(statsPage, /button\.addEventListener\('click'/);
  assert.match(statsPage, /<table data-sortable data-player-table[\s\S]*?<th scope="col" aria-sort="ascending"><button class="sort-button" type="button" data-type="number">#<\/button><\/th>/);
  assert.match(statsPage, /table\.applyCurrentSort\(\);/);
  assert.match(statsPage, /table\.matches\('\[data-player-table\]'\).*columnIndex === 6.*direction === 'descending'/);
  assert.match(statsPage, /rightGoals - leftGoals/);
  assert.match(statsPage, /leftName\.localeCompare\(rightName/);
});

test('player table keeps the compact public columns for every active player', () => {
  const playerTable = statsPage.match(/<table data-sortable data-player-table[\s\S]*?<\/table>/)?.[0] ?? '';
  const headers = [...playerTable.matchAll(/<th[^>]*>[\s\S]*?<button[^>]*>([^<]+)<\/button>[\s\S]*?<\/th>/g)]
    .map((match) => match[1]);
  assert.deepEqual(headers, [
    '#', 'Player', 'Pos', 'GP', 'G', 'A', 'PTS', 'PEN', 'PIM',
  ]);

  const body = playerTable.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((rowMatch) => (
    [...rowMatch[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map((cellMatch) => ({
      attributes: cellMatch[1],
      text: cellMatch[2].replace(/<[^>]+>/g, '').trim(),
    }))
  ));
  assert.equal(rows.length, 17);
  assert.deepEqual(rows.map((cells) => Number(cells[0].text)), [
    3, 6, 7, 9, 10, 12, 13, 14, 17, 21, 22, 23, 40, 57, 64, 65, 87,
  ]);

  for (const cells of rows) {
    assert.equal(cells.length, 9);
    for (const cell of cells) {
      if (!/\bstat-switch\b/.test(cell.attributes)) continue;
      const reviewedValue = cell.attributes.match(/data-reviewed="([^"]+)"/)?.[1];
      assert.equal(cell.text, reviewedValue);
    }
  }
  assert.match(statsPage, /42 of 58 goals have been reviewed by video/);
  assert.match(statsPage, /data-player-table data-stat-view="reviewed"/);
  assert.match(statsPage, /data-stat-view="reviewed" aria-pressed="true">Video reviewed/);
  assert.match(statsPage, /data-stat-view="official" aria-pressed="false">Official/);
  assert.match(statsPage, /Mateus Mendes[\s\S]*?data-reviewed="9" data-official="8">9<\/td>[\s\S]*?data-reviewed="20" data-official="19">20<\/td>/);
  assert.match(statsPage, /Joshua Haglöf McCallum[\s\S]*?data-reviewed="2" data-official="0">2<\/td>[\s\S]*?data-reviewed="3" data-official="1">3<\/td>/);
  assert.ok(playerTable.indexOf('Sebastian Salmon') < playerTable.indexOf('Eliot Osborn'));
  assert.ok(playerTable.indexOf('Joshua Haglöf McCallum') < playerTable.indexOf('Cruz Bugeaud'));
  assert.ok(playerTable.indexOf('Joshua Haglöf McCallum') < playerTable.indexOf('Chase Pocholski'));
});

test('goalie totals include derived saves and save percentage', () => {
  assert.match(statsPage, />SA<\/button>/);
  assert.match(statsPage, />GA<\/button>/);
  assert.match(statsPage, />SV<\/button>/);
  assert.match(statsPage, />SV%<\/button>/);
  assert.match(statsPage, /Anthony O'Donnell<\/td><td>14<\/td><td>4<\/td><td>8<\/td><td>1<\/td><td>298<\/td><td>41<\/td><td>264<\/td><td class="points" data-sort-value="88\.6">88\.6%/);
  assert.match(statsPage, /Miguel Martinez<\/td><td>14<\/td><td>2<\/td><td>10<\/td><td>1<\/td><td>384<\/td><td>50<\/td><td>345<\/td><td class="points" data-sort-value="89\.8">89\.8%/);
  assert.match(statsPage, /SA = shots against; GA = goals against; SV = saves; SV% = save percentage/);
  assert.doesNotMatch(statsPage, /Goals against count every goalie appearance|October 31 Boise workload|October 31 Tri-Cities workload/);
});

test('display names retain natural order while sorting by surname', () => {
  assert.match(statsPage, /data-sort-value="Haglöf McCallum, Max">Max Haglöf McCallum/);
  assert.doesNotMatch(statsPage, /Haglof McCallum/);
  assert.match(statsPage, /data-sort-value="O'Donnell, Anthony">Anthony O'Donnell/);
  assert.match(statsPage, /dataset\.sortValue \|\|/);
});

test('player positions reflect the current Seattle Junior roster', () => {
  assert.match(statsPage, /Max Haglöf McCallum<\/td><td>F<\/td>/);
  assert.match(statsPage, /Zaedan Longley<\/td><td>D\/F<\/td>/);
  assert.match(statsPage, /Eliot Osborn<\/td><td>F\/D<\/td>/);
});

test('coach-review analytics preserve the basic tables and label data limitations', () => {
  assert.match(statsPage, /Season Snapshot/);
  const seasonResults = statsPage.slice(
    statsPage.indexOf('<h3 class="chart-title" id="timeline-title">Season results<\/h3>'),
    statsPage.indexOf('<section class="chart-card chart-wide" aria-labelledby="special-teams-title">')
  );
  assert.ok(seasonResults.indexOf('>Nov 22<') < seasonResults.indexOf('>Nov 21<'));
  assert.ok(seasonResults.indexOf('>Nov 21<') < seasonResults.indexOf('at Tri-Cities'));
  assert.ok(seasonResults.indexOf('at Tri-Cities') < seasonResults.indexOf('vs Boise'));
  assert.ok(seasonResults.indexOf('vs Boise') < seasonResults.indexOf('vs Tri-Cities'));
  assert.ok(seasonResults.indexOf('vs Tri-Cities') < seasonResults.indexOf('at Spokane'));
  assert.ok(seasonResults.indexOf('at Spokane') < seasonResults.indexOf('>Nov 8<'));
  assert.ok(seasonResults.indexOf('>Nov 8<') < seasonResults.indexOf('>Nov 7<'));
  assert.ok(seasonResults.indexOf('>Nov 7<') < seasonResults.indexOf('>Nov 1<'));
  assert.ok(seasonResults.indexOf('>Nov 1<') < seasonResults.indexOf('>Oct 31<'));
  assert.ok(seasonResults.indexOf('Oct 31') < seasonResults.indexOf('Sep 12'));
  assert.doesNotMatch(seasonResults, /Most recent games are shown first/);
  assert.doesNotMatch(seasonResults, /Seattle Junior's score is listed first/);
  assert.match(statsPage, /period-label">P1<\/span> 19 · <span class="period-label">P2<\/span> 23 · <span class="period-label">P3<\/span> 16/);
  assert.match(statsPage, /Goals by Period/);
  assert.doesNotMatch(statsPage, /Average goals per game in periods one, two, and three/);
  assert.match(statsPage, /<strong>151 minutes<\/strong>/);
  assert.doesNotMatch(statsPage, /Elapsed time at a player disadvantage/);
  assert.match(statsPage, /<h2 id="players-heading">Players<\/h2>/);
  assert.doesNotMatch(statsPage, /skater/i);
  assert.doesNotMatch(statsPage, /manpower/i);
  assert.match(statsPage, /Avg\. PK Time\/Game<\/span><strong class="metric-value">5:49/);
  assert.match(statsPage, /Avg\. Goals\/Game<\/span><strong class="metric-value">2\.23/);
  assert.match(statsPage, /Shot volume<\/span>\s*<strong>473 for · 729 against/);
  assert.match(statsPage, /Avg\. shot share<\/span><strong class="metric-value">38\.5%/);
  assert.match(statsPage, /Avg\. shot differential<\/span><strong class="metric-value">−11\.6/);
  assert.match(statsPage, /Team save percentage<\/span><strong class="metric-value">89\.3%/);
  assert.match(statsPage, /Expected penalty cost/);
  assert.match(statsPage, /0\.74 goals\/game/);
  assert.match(statsPage, /Future penalties are expected to reduce team goal differential by about 7 goals per 10 games/);
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
  assert.match(statsPage, /Power-play conversion<\/span><strong>11\.5%/);
  assert.match(statsPage, /Power-play goals against<\/span><strong>21/);
  assert.match(statsPage, /Shorthanded goals for<\/span><strong>0/);
  assert.match(statsPage, /Shorthanded goals against<\/span><strong>6/);
  assert.match(statsPage, /10 goals on 87 power plays/);
  assert.match(statsPage, /77\.2% · 71 successful penalty kills on 92 opportunities/);
  assert.doesNotMatch(statsPage, /GWG/);
  assert.doesNotMatch(statsPage, /Goal-type totals cover all eighteen games/);
  assert.doesNotMatch(statsPage, /Opportunity totals and rate statistics cover the first fourteen games/);
  assert.doesNotMatch(statsPage, /Goal type was not recorded/);
  assert.doesNotMatch(statsPage, /Goal strength classified|27 of 37 · 73%/);
  assert.match(statsPage, /Game-by-game shot share/);
  assert.match(statsPage, /Dark points show each game's shot share\. The gold line shows the centered three-game average, using the game before and the game after each point\. The October 3, 4, and 30 games and the November 13 Spokane game are excluded because shots were not recorded/);
  assert.match(statsPage, /centered three-game average/);
  assert.match(statsPage, /using the game before and the game after each point/);
  assert.equal((statsPage.match(/class="game-point"/g) ?? []).length, 22);
  assert.equal((statsPage.match(/class="trend-line"/g) ?? []).length, 1);
  assert.doesNotMatch(statsPage, /class="trend-point"|class="trend-value"/);
  assert.match(statsPage, /Game efficiency/);
  assert.match(statsPage, /Hover over or focus a point for the matchup and final score\. This compares game results with shot volume, but does not account for shot location or quality\. The October 3, 4, and 30 games and the November 13 Spokane game are excluded because shots were not recorded/);
  assert.doesNotMatch(statsPage, /Shot share is plotted left to right|Each point is a game|Select it for the matchup and score/);
  assert.match(statsPage, /Seattle Junior share of shots/);
  assert.match(statsPage, /Final goal differential/);
  assert.equal((statsPage.match(/class="efficiency-point"/g) ?? []).length, 22);
  assert.doesNotMatch(statsPage, /class="diverging-chart game-shot-chart"/);
  assert.equal((statsPage.match(/class="diverging-chart period-goal-chart"/g) ?? []).length, 3);
  assert.match(statsPage, /Goals by period/);
  assert.match(statsPage, /Penalty profile/);
  assert.match(statsPage, /116 penalties · 244 PIM · Excludes misconducts/);
  const penaltyProfile = statsPage.slice(
    statsPage.indexOf('<h3 class="chart-title" id="penalties-title">Penalty profile<\/h3>'),
    statsPage.indexOf('<figure class="chart-card chart-wide" aria-labelledby="period-title">')
  );
  assert.ok(penaltyProfile.indexOf('<strong>Head contact<\/strong>') < penaltyProfile.indexOf('<strong>Holding<\/strong>'));
  assert.ok(penaltyProfile.indexOf('<strong>Holding<\/strong>') < penaltyProfile.indexOf('<strong>Checking from behind<\/strong>'));
  assert.doesNotMatch(statsPage, /Misconduct records are excluded/);
  assert.doesNotMatch(statsPage, /id="misconducts-title"/);
  assert.doesNotMatch(statsPage, /Goaltender workload|class="workload-row"/);
  assert.doesNotMatch(statsPage, /All eighteen games share a thirty-goal scale|Period-level shot totals are available for eight games/);
  assert.match(statsPage, /42 of 58 goals have been reviewed by video, with 24 corrections/);
  assert.match(statsPage, /Video-reviewed totals use confirmed corrections; official totals come directly from scoresheets or the NWAHL webpage/);
  assert.doesNotMatch(statsPage, /Misconducts and game misconducts are each counted as separate penalties/);
  assert.doesNotMatch(statsPage, /Shot location and high-danger chances are not currently tracked/);
  assert.doesNotMatch(statsPage, /October 3, 4, and 30 are excluded because shots and saves were not recorded/);
  assert.equal((statsPage.match(/<table[^>]+data-sortable/g) ?? []).length, 2);
});
