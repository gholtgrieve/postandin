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
  if(!sqlite.prepare('SELECT version FROM gear_local_migrations WHERE version=1').get()) {
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/gear/0001_drafts.sql',import.meta.url),'utf8'));
      sqlite.exec('INSERT INTO gear_local_migrations VALUES(1); COMMIT');
    } catch(error) {sqlite.exec('ROLLBACK');sqlite.close();throw error;}
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
