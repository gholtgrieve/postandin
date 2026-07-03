#!/usr/bin/env node
//
// Local-only replacement for the old public /api/groups/purge.js endpoint,
// which was removed after it wiped production GROUPS data with no auth and
// no backup. This script:
//
//   - only runs locally, using your own `wrangler login` credentials
//   - requires an explicit --confirm flag AND typing "PURGE" at a prompt
//     (no query-string flag that could be pasted into a URL by accident)
//   - always backs up GROUPS to R2 first, and refuses to delete anything
//     if that backup fails
//   - prints exactly what it's about to delete before asking for confirmation
//
// Usage:
//   node scripts/admin-purge.js --confirm
//
// Requires: `wrangler login` already run, R2 bucket + backup cron set up
// (see scheduler/README.md).

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEDULER_DIR = join(__dirname, '..', 'scheduler');
const WRANGLER_TOML_PATH = join(SCHEDULER_DIR, 'wrangler.toml');

function readTomlValue(bindingName, field) {
  // scheduler/wrangler.toml is small and hand-written, so a simple
  // block-scoped regex is enough here — no need for a full TOML parser.
  const toml = readFileSync(WRANGLER_TOML_PATH, 'utf8');
  const blocks = toml.split(/\n(?=\[\[)/);
  const block = blocks.find(b => new RegExp(`binding\\s*=\\s*"${bindingName}"`).test(b));
  if (!block) throw new Error(`No binding "${bindingName}" found in scheduler/wrangler.toml`);
  const match = block.match(new RegExp(`${field}\\s*=\\s*"([^"]+)"`));
  if (!match) throw new Error(`No "${field}" found for binding "${bindingName}" in scheduler/wrangler.toml`);
  return match[1];
}

const GROUPS_NAMESPACE_ID = readTomlValue('GROUPS', 'id');
const BACKUP_BUCKET = readTomlValue('BACKUPS', 'bucket_name');

function wrangler(args) {
  return execFileSync('wrangler', args, { encoding: 'utf8', cwd: SCHEDULER_DIR });
}

function listKeys() {
  const out = wrangler(['kv', 'key', 'list', '--namespace-id', GROUPS_NAMESPACE_ID, '--remote']);
  return JSON.parse(out).map(k => k.name);
}

function getValue(key) {
  return wrangler(['kv', 'key', 'get', key, '--namespace-id', GROUPS_NAMESPACE_ID, '--text', '--remote']);
}

function deleteKey(key) {
  wrangler(['kv', 'key', 'delete', key, '--namespace-id', GROUPS_NAMESPACE_ID, '--remote']);
}

// Mirrors scheduler/src/backup.js's backupGroups(), but driven from the CLI
// instead of a Worker binding, so it can run standalone from a laptop.
function backupBeforePurge(keys) {
  const exportedAt = new Date().toISOString();
  const values = {};
  for (const key of keys) {
    values[key] = getValue(key);
  }
  const path = `backups/groups-${exportedAt.slice(0, 10)}-pre-purge.json`;
  const payload = JSON.stringify({ exportedAt, keys: values });

  const tmpFile = join(tmpdir(), `admin-purge-backup-${Date.now()}.json`);
  writeFileSync(tmpFile, payload);
  try {
    wrangler(['r2', 'object', 'put', `${BACKUP_BUCKET}/${path}`, '--file', tmpFile, '--ct', 'application/json', '--remote']);
  } finally {
    unlinkSync(tmpFile);
  }
  return { path, keyCount: keys.length };
}

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm.\n\nUsage: node scripts/admin-purge.js --confirm');
    process.exit(1);
  }

  console.log(`Namespace: GROUPS (${GROUPS_NAMESPACE_ID})`);
  console.log('Listing keys...');
  const keys = listKeys();
  console.log(`This will delete ALL ${keys.length} key(s) in GROUPS:`);
  for (const key of keys) console.log(`  - ${key}`);

  if (keys.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  console.log('\nBacking up GROUPS to R2 before doing anything else...');
  let backup;
  try {
    backup = backupBeforePurge(keys);
  } catch (e) {
    console.error(`\nBackup failed — aborting. No keys were deleted.\n${e.message}`);
    process.exit(1);
  }
  console.log(`Backup written: ${BACKUP_BUCKET}/${backup.path} (${backup.keyCount} keys)`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nType PURGE to permanently delete all ${keys.length} key(s) above from GROUPS: `,
  );
  rl.close();

  if (answer !== 'PURGE') {
    console.log('Confirmation did not match "PURGE" exactly. Aborting — nothing was deleted.');
    process.exit(1);
  }

  console.log('\nDeleting...');
  for (const key of keys) {
    deleteKey(key);
    console.log(`  deleted ${key}`);
  }
  console.log(`\nDeleted ${keys.length} key(s). Backup for recovery: ${BACKUP_BUCKET}/${backup.path}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
