// Explicit offline sample-data cleanup; defaults to a count-only preview.
import {openLocalDatabase} from './local-db.mjs';
import {safeDatabasePath} from './local-path.mjs';
import {cleanup} from './local-lifecycle.mjs';
if(!process.argv[2]||process.argv.slice(3).some(x=>x!=='--apply'))throw new Error('Usage: local-cleanup.mjs DATABASE [--apply]. Stop the local server first.');
const db=openLocalDatabase(safeDatabasePath(process.argv[2]));try{console.log(JSON.stringify(cleanup(db,{apply:process.argv.includes('--apply')})));}finally{db.close();}
