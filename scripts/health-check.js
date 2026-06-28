#!/usr/bin/env node
//
// Health check for postandin.com — no external dependencies, Node 18+ fetch only.
//
// Notes:
//   (1) The coaches API filters by status server-side using an Airtable formula
//       ({status} = "Live"). Status is not included in the returned objects, so
//       checks here assert name and slug instead of status: "Live".
//
//   (2) KNOWN_COACH_SLUG is hardcoded to "tj-oshie", confirmed as a live slug
//       from /api/coaches during initial setup. Update it if that coach is ever
//       removed from the directory.
//
//   (3) To run against a local dev server:
//       BASE_URL=http://localhost:8788 node scripts/health-check.js
//

const BASE = (process.env.BASE_URL ?? 'https://postandin.com').replace(/\/$/, '');
const KNOWN_COACH_SLUG = 'tj-oshie';

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`✓ ${label}`);
  passed++;
}

function fail(label, reason) {
  console.log(`✗ ${label}: ${reason}`);
  failed++;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'follow' });
  return res;
}

async function getJson(path) {
  const res = await get(path);
  const body = await res.json();
  return { res, body };
}

// ── Checks ────────────────────────────────────────────────────────────────────

async function checkHtml(label, path) {
  const res = await get(path);
  if (res.status === 200) {
    ok(label);
  } else {
    fail(label, `HTTP ${res.status}`);
  }
}

async function checkCoachesList() {
  const label = 'GET /api/coaches — array with ≥1 coach, each has name + slug';
  let res, body;
  try {
    ({ res, body } = await getJson('/api/coaches'));
  } catch (e) {
    fail(label, `fetch/parse error: ${e.message}`);
    return null;
  }

  if (res.status !== 200) { fail(label, `HTTP ${res.status}`); return null; }
  if (!Array.isArray(body)) { fail(label, `expected array, got ${typeof body}`); return null; }
  if (body.length === 0) { fail(label, 'array is empty'); return null; }

  const bad = body.find(c => !c.name || !c.slug);
  if (bad) { fail(label, `coach missing name or slug: ${JSON.stringify(bad)}`); return null; }

  ok(label);
  return body;
}

async function checkCoachGoodSlug() {
  const label = `GET /api/coach/${KNOWN_COACH_SLUG} — 200 with coach object`;
  let res, body;
  try {
    ({ res, body } = await getJson(`/api/coach/${KNOWN_COACH_SLUG}`));
  } catch (e) {
    fail(label, `fetch/parse error: ${e.message}`);
    return;
  }

  if (res.status !== 200) { fail(label, `HTTP ${res.status}`); return; }
  if (typeof body !== 'object' || Array.isArray(body)) { fail(label, 'expected a coach object'); return; }
  if (!body.name || !body.slug) { fail(label, `missing name or slug in response`); return; }
  ok(label);
}

async function checkCoachBadSlug() {
  const label = 'GET /api/coach/not-a-real-coach — 404';
  let res;
  try {
    res = await get('/api/coach/not-a-real-coach');
    await res.text();
  } catch (e) {
    fail(label, `fetch error: ${e.message}`);
    return;
  }
  if (res.status === 404) {
    ok(label);
  } else {
    fail(label, `expected 404, got HTTP ${res.status}`);
  }
}

async function checkGroupsSession() {
  const label = 'GET /api/groups/session — 200 with JSON body';
  let res, body;
  try {
    ({ res, body } = await getJson('/api/groups/session'));
  } catch (e) {
    fail(label, `fetch/parse error: ${e.message}`);
    return;
  }
  if (res.status !== 200) { fail(label, `HTTP ${res.status}`); return; }
  if (typeof body !== 'object' || body === null) { fail(label, 'expected a JSON object'); return; }
  ok(label);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`\nPost & In health check — ${BASE}\n`);

await checkHtml('GET / — 200', '/');
await checkHtml('GET /coaches/ — 200', '/coaches/');
await checkHtml('GET /stick-and-puck/ — 200', '/stick-and-puck/');
await checkCoachesList();
await checkCoachGoodSlug();
await checkCoachBadSlug();
await checkGroupsSession();

console.log(`\n${passed + failed} checks: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
