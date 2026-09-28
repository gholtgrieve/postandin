// Local HTTPS preview only. No OS trust-store changes; sample data only.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {safeDatabasePath} from './local-path.mjs';
import {openLocalDatabase} from './local-db.mjs';
import {readOwnerKey} from './local-owner-key.mjs';
import {localServer} from './local-server.mjs';
if(!process.argv[2])throw new Error('Supply an absolute sample database path outside the website directory.');
const path=safeDatabasePath(process.argv[2]),temp=mkdtempSync(join(tmpdir(),'gear-preview-'));
let tls;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
 tls={key:readFileSync(join(temp,'key.pem')),cert:readFileSync(join(temp,'cert.pem'))};
}finally{rmSync(temp,{recursive:true,force:true});}
const ownerKey=process.env.GEAR_OWNER_KEY_FILE?readOwnerKey(process.env.GEAR_OWNER_KEY_FILE):undefined;
const db=openLocalDatabase(path),server=localServer(db,{tls,preview:true,ownerKey,backupDirectory:process.env.GEAR_BACKUP_DIRECTORY});
server.on('error',error=>{console.error('Local preview failed:',error);db.close();process.exitCode=1;});
server.listen(8773,'127.0.0.1',()=>console.log('Local sample-data preview: https://127.0.0.1:8773/gear/ (self-signed certificate; no real email)'));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close(()=>{db.close();});server.closeAllConnections();});
