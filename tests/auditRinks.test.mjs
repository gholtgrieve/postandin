import assert from 'node:assert/strict';
import test from 'node:test';

import { isKnownEverettInstruction } from '../scripts/audit-rinks.js';

test('Everett instructional title families remain excluded when schedule details change', () => {
  for (const title of [
    '🏒 Hockey Tots - Mon - 05:00 pm',
    '🏒 Hockey Tots - Sat - 10:45 am',
    '🏒 Hockey 1-4 - Mon - 05:35 pm',
    '🏒 Hockey 1-4 - Sat - 11:20 am',
    '🏒 Adult Hockey Skating (Adult 4+) - Fri - 07:00 pm',
    '🏒⚡ Advanced Hockey: Power Skating - Tue - 06:30 pm',
  ]) {
    assert.equal(isKnownEverettInstruction(title), true, title);
  }
});

test('Everett open-hockey titles are not hidden by instructional patterns', () => {
  assert.equal(isKnownEverettInstruction('🏒 Drop-In Hockey'), false);
  assert.equal(isKnownEverettInstruction('🏒 Stick & Puck'), false);
  assert.equal(isKnownEverettInstruction('🏒 Hockey Pickup'), false);
});
