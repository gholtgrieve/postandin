import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const gearHtml=read('gear/index.html');
const gearScript=read('gear/gear.mjs');
const gearStyles=read('gear/gear.css');
const gearPhoneOverrides=gearStyles.slice(gearStyles.lastIndexOf('@media(max-width:450px){'));
const scheduleStyles=read('stick-and-puck/schedule.css');
const coachesHtml=read('coaches/index.html');
const coachProfile=read('functions/coaches/[slug].js');

test('shared visual shell keeps the primary navigation lockup aligned',()=>{
  assert.match(gearStyles,/\.pi-logo\{font-size:24px\}/);
  assert.match(gearStyles,/\.pi-section\{font:400 24px\/1 'Bebas Neue'/);
  assert.match(gearStyles,/padding-left:calc\(max\(0px,\(100% - 1100px\)\/2\) \+ clamp\(1rem,4vw,2rem\)\)/);
  assert.match(scheduleStyles,/\.logo \{[\s\S]*?font-size: 24px;/);
  assert.match(scheduleStyles,/\.logo \.section \{ color: #D6BC58; \}/);
  assert.match(scheduleStyles,/\.coach-nav-link \{\s*display: inline-flex;\s*align-items: center;/);
  assert.match(coachesHtml,/\.logo \.section \{ color: #D6BC58; \}/);
  assert.match(coachProfile,/\.logo \.section \{ color: #D6BC58; \}/);
  assert.match(coachProfile,/:root \{ --paper:#E8E3D8; --panel:#EFEBE2; --rule:#B8B2A4; --ink:#2E2A26;/);
});

test('Gear browse hierarchy and sticky scroll targets remain accessible',()=>{
  assert.match(gearHtml,/<h2>Latest gear<\/h2>/);
  assert.match(gearScript,/<h3><button type="button" class="pi-listing-link"/);
  assert.doesNotMatch(gearScript,/<h2><button type="button" class="pi-listing-link"/);
  assert.match(gearStyles,/html\{scroll-padding-top:64px\}/);
  assert.match(gearStyles,/#pi-gear-preview #pi-photo-manager\{scroll-margin-top:64px\}/);
  assert.match(gearStyles,/\.pi-status\{font:500 10px\/1\.4 'IBM Plex Mono'/);
  assert.match(gearStyles,/\.pi-row h3\{[^}]*margin:0 0 6px;overflow-wrap:anywhere/);
  assert.match(gearStyles,/#pi-gear-preview #pi-gear-rules\{width:100%/);
  assert.ok(gearHtml.indexOf('id="pi-gear-rules"')>gearHtml.indexOf('id="pi-delete-dialog"'));
  assert.ok(gearHtml.indexOf('id="pi-gear-rules"')<gearHtml.indexOf('<footer class="pi-footer">'));
  assert.match(gearStyles,/#pi-gear-preview #pi-gear-rules\{[^}]*margin:auto auto 0;[^}]*border-top:1px solid var\(--pi-rule\);border-bottom:0/);
  assert.match(gearStyles,/\.pi-detail,#pi-gear-preview \.pi-seller-page\{width:100%/);
  assert.match(gearStyles,/#pi-gear-preview #pi-local-notice\{width:100%;max-width:calc\(1100px \+ clamp\(2rem,8vw,4rem\)\);margin:12px auto;padding-left:clamp\(1rem,4vw,2rem\);padding-right:clamp\(1rem,4vw,2rem\)\}/);
  assert.match(gearPhoneOverrides,/@media\(max-width:450px\)\{[\s\S]*?#pi-gear-preview \.pi-price\{font-size:25px\}\s*#pi-gear-preview \.pi-money\{overflow-wrap:anywhere\}/);
});
