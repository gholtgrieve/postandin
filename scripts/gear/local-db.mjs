import { duplicateKey } from '../../lib/gear-duplicates.mjs';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, statSync, readFileSync } from 'node:fs';
// Small local adapter for the D1 methods used by storage. No remote connection.
export function openLocalDatabase(path=':memory:') {
  // Inspect existing files read-only before allowing any migration writes.
  if(path!==':memory:' && existsSync(path) && statSync(path).size>0) {
    const check=new DatabaseSync(path,{readOnly:true});
    try {
      if(!check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gear_local_migrations'").get()) {
        throw new Error('Refusing to modify an existing non-Gear database.');
      }
    } finally {check.close();}
  }
  const sqlite=new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec('CREATE TABLE IF NOT EXISTS gear_local_migrations (version INTEGER PRIMARY KEY)');
  for(const [version,file] of [[1,'0001_drafts.sql'],[2,'0002_verification.sql'],[3,'0003_duplicates.sql'],[4,'0004_publication_duplicates.sql'],[5,'0005_management.sql'],[6,'0006_email_change.sql'],[7,'0007_production_foundation.sql'],[8,'0008_moderation.sql'],[9,'0009_seller_deletions.sql'],[10,'0010_maintenance.sql'],[11,'0011_photo_quarantines.sql']]) {
    if(sqlite.prepare('SELECT version FROM gear_local_migrations WHERE version=?').get(version))continue;
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/gear/'+file,import.meta.url),'utf8'));
      sqlite.prepare('INSERT INTO gear_local_migrations VALUES(?)').run(version);
      sqlite.exec('COMMIT');
    } catch(error) {sqlite.exec('ROLLBACK');sqlite.close();throw error;}
  }
  // Also repair NULL keys left by running older app code after a rollback.
  // Keep normalization changes in a new versioned re-key migration.
  sqlite.exec('BEGIN');
  try {
    sqlite.prepare("UPDATE gear_listings SET status='expired' WHERE status IN ('available','pending') AND expires_at<=?").run(Date.now());
    for(const row of sqlite.prepare('SELECT * FROM gear_listings WHERE duplicate_key IS NULL').all()){
      const clubs=sqlite.prepare('SELECT club FROM gear_listing_clubs WHERE listing_id=?').all(row.id).map(r=>r.club);
      sqlite.prepare('UPDATE gear_listings SET duplicate_key=? WHERE id=?').run(duplicateKey({...row,clubs,otherClub:row.other_club}),row.id);
    }
    sqlite.exec('COMMIT');
  }catch(error){
    sqlite.exec('ROLLBACK');sqlite.close();
    if(/UNIQUE constraint failed/.test(String(error.message)))throw new Error('Duplicate-key backfill found conflicting active listings. No backfill changes were saved. Resolve sample conflicts or use a new sample database; no records were deleted.');
    throw error;
  }
  return {
    sqlite,
    prepare(sql) {
      const statement=sqlite.prepare(sql);
      return {bind(...args) {return {
        run:()=>statement.run(...args),
        first:async()=>statement.get(...args)??null,
        all:async()=>({results:statement.all(...args)}),
      };}};
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {const result=statements.map(s=>s.run());sqlite.exec('COMMIT');return result;}
      catch(error) {sqlite.exec('ROLLBACK');throw error;}
    },
    close:()=>sqlite.close(),
  };
}
