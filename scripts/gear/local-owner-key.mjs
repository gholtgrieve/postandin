// Create a random SAMPLE local owner key outside the checkout; never print it.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {safeDatabasePath} from './local-path.mjs';
export function readOwnerKey(path){
 const safe=safeDatabasePath(path),info=statSync(safe);
 if((info.mode&0o777)!==0o600||info.uid!==process.getuid())throw new Error('Owner key file must belong to this user and have mode 0600.');
 const key=readFileSync(safe,'utf8').trim();if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid local owner key file.');return key;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.argv[2])throw new Error('Supply a new absolute owner-key file path outside the checkout.');
 writeFileSync(safeDatabasePath(process.argv[2]),randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
 console.log('Local owner key file created. Paste its contents into the local owner sign-in form; keep it private.');
}
