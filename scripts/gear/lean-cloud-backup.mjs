import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chmodSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {createLeanGearBackup,reconcileLeanGearDeletionEvidence,validateLeanGearBackup} from '../../lib/gear-lean-backup.mjs';

const MAX_JSON_BYTES=64*1024,MAX_EXPORT_BYTES=256*1024*1024,MAX_BACKUP_BYTES=128*1024*1024;
const EXPORT_TABLES=['gear_sellers','gear_listings','gear_listing_clubs','gear_removals','gear_deletions','gear_deletion_ledger'];
const HEX32=/^[a-f0-9]{32}$/i,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i,PRINTABLE=/^[\x21-\x7e]+$/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha1=bytes=>createHash('sha1').update(bytes).digest('hex');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export const BACKUP_SUCCESS_MESSAGE='Gear backup completed and verified.';
export function exportDurationOutput(durationMs){return `D1 export completed in ${(durationMs/1000).toFixed(2)} s.`;}
export function successOutput(){return BACKUP_SUCCESS_MESSAGE;}

function value(env,name,{max=512,pattern=PRINTABLE}={}){const result=env?.[name];if(typeof result!=='string'||!result||result.length>max||!pattern.test(result))throw new Error(`Invalid ${name} configuration.`);return result;}
function configuration(env){
  return {
    accountId:value(env,'GEAR_BACKUP_CF_ACCOUNT_ID',{max:32,pattern:HEX32}),
    databaseId:value(env,'GEAR_BACKUP_D1_DATABASE_ID',{max:36,pattern:UUID}),
    cloudflareToken:value(env,'GEAR_BACKUP_CF_API_TOKEN'),
    b2KeyId:value(env,'GEAR_BACKUP_B2_KEY_ID',{max:128}),
    b2Key:value(env,'GEAR_BACKUP_B2_APP_KEY'),
    b2BucketId:value(env,'GEAR_BACKUP_B2_BUCKET_ID',{max:128}),
    ageRecipient:value(env,'GEAR_BACKUP_AGE_RECIPIENT',{max:128,pattern:/^age1[0-9a-z]{50,100}$/}),
  };
}

async function boundedBytes(response,max=MAX_JSON_BYTES){
  if(!response?.ok||!response.body)throw new Error('Backup provider request failed.');
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>max)throw new Error('Backup provider response is too large.');
  const reader=response.body.getReader(),parts=[];let total=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw new Error('Backup provider response is too large.');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
async function boundedJson(response,max=MAX_JSON_BYTES){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(response,max)));}catch(error){if(error.message?.startsWith('Backup provider'))throw error;throw new Error('Backup provider returned invalid JSON.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Backup provider returned invalid JSON.');return value;
}

async function d1Export(config,{fetchImpl,wait,clock}){
  const startedAt=clock();
  const url=`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/export`,headers={Authorization:`Bearer ${config.cloudflareToken}`,'Content-Type':'application/json'};
  let bookmark=null;
  for(let attempt=0;attempt<180;attempt++){
    const body={output_format:'polling',dump_options:{tables:EXPORT_TABLES},...(bookmark?{current_bookmark:bookmark}:{})},data=await boundedJson(await fetchImpl(url,{method:'POST',redirect:'error',headers,body:JSON.stringify(body)}));
    const result=data.result;if(data.success!==true||!result||typeof result!=='object')throw new Error('D1 export failed.');
    if(typeof result.at_bookmark==='string'&&result.at_bookmark)bookmark=result.at_bookmark;
    if(result.status==='error')throw new Error('D1 export failed.');
    if(result.status==='complete'){
      if(!bookmark)throw new Error('D1 export returned no bookmark.');
      const durationMs=clock()-startedAt;if(!Number.isFinite(durationMs)||durationMs<0)throw new Error('Invalid backup clock.');
      const signedUrl=result.result?.signed_url;if(typeof signedUrl!=='string'||!signedUrl.startsWith('https://'))throw new Error('D1 export returned no download.');
      const sql=new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(await fetchImpl(signedUrl,{redirect:'error'}),MAX_EXPORT_BYTES));
      return {bookmark,sql,durationMs};
    }
    if(!bookmark)throw new Error('D1 export returned no bookmark.');await wait(5000);
  }
  throw new Error('D1 export timed out.');
}

async function currentDeletionEvidence(config,fetchImpl){
  const url=`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`,response=await boundedJson(await fetchImpl(url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${config.cloudflareToken}`,'Content-Type':'application/json'},body:JSON.stringify({sql:'SELECT listing_id AS listingId,deleted_at AS deletedAt,purge_at AS purgeAt FROM gear_deletion_ledger WHERE purged_at IS NULL ORDER BY listing_id'})}));
  const rows=response.success===true&&Array.isArray(response.result)&&Array.isArray(response.result[0]?.results)?response.result[0].results:null;
  if(!rows)throw new Error('Unable to read current deletion evidence.');return rows;
}

export function ageEncrypt(input,output,recipient,{spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{const child=spawnImpl('age',['--recipient',recipient,'--output',output,input],{stdio:['ignore','ignore','pipe']}),errors=[];child.stderr.on('data',chunk=>{if(errors.reduce((sum,item)=>sum+item.length,0)<4096)errors.push(chunk);});child.on('error',()=>reject(new Error('Unable to start age encryption.')));child.on('close',code=>code===0?resolve():reject(new Error('Age encryption failed.')));});
}

async function b2Authorize(config,fetchImpl){
  const basic=Buffer.from(`${config.b2KeyId}:${config.b2Key}`).toString('base64'),data=await boundedJson(await fetchImpl('https://api.backblazeb2.com/b2api/v4/b2_authorize_account',{headers:{Authorization:`Basic ${basic}`},redirect:'error'}));
  const storage=data.apiInfo?.storageApi,allowed=storage?.allowed,capabilities=allowed?.capabilities;
  if(typeof data.authorizationToken!=='string'||typeof storage?.apiUrl!=='string'||typeof storage?.downloadUrl!=='string'||!Array.isArray(capabilities)||[...capabilities].sort().join(',')!=='readFiles,writeFiles'||allowed.namePrefix!=='gear/'||!Array.isArray(allowed.buckets)||allowed.buckets.length!==1||allowed.buckets[0]?.id!==config.b2BucketId)throw new Error('B2 backup key is not safely scoped.');
  return {token:data.authorizationToken,apiUrl:storage.apiUrl,downloadUrl:storage.downloadUrl};
}

async function b2Upload(config,auth,fileName,bytes,fetchImpl){
  const endpoint=new URL('/b2api/v4/b2_get_upload_url',auth.apiUrl);endpoint.searchParams.set('bucketId',config.b2BucketId);
  const upload=await boundedJson(await fetchImpl(endpoint,{headers:{Authorization:auth.token},redirect:'error'}));
  if(typeof upload.uploadUrl!=='string'||typeof upload.authorizationToken!=='string')throw new Error('B2 upload endpoint is unavailable.');
  const digest=sha1(bytes),result=await boundedJson(await fetchImpl(upload.uploadUrl,{method:'POST',redirect:'error',headers:{Authorization:upload.authorizationToken,'X-Bz-File-Name':encodeURIComponent(fileName),'Content-Type':'application/octet-stream','Content-Length':String(bytes.length),'X-Bz-Content-Sha1':digest},body:bytes}));
  if(typeof result.fileId!=='string'||result.contentLength!==bytes.length&&Number(result.contentLength)!==bytes.length||result.contentSha1!==digest)throw new Error('B2 upload verification failed.');return result.fileId;
}

async function b2ReadBack(auth,fileId,expected,fetchImpl){
  const endpoint=new URL('/b2api/v4/b2_download_file_by_id',auth.downloadUrl);endpoint.searchParams.set('fileId',fileId);const bytes=await boundedBytes(await fetchImpl(endpoint,{headers:{Authorization:auth.token},redirect:'error'}),MAX_BACKUP_BYTES);
  if(bytes.length!==expected.length||sha256(bytes)!==sha256(expected))throw new Error('B2 read-back verification failed.');
}

export async function runLeanCloudBackup({env=process.env,fetchImpl=fetch,wait=sleep,now=Date.now,clock=performance.now.bind(performance),uuid=randomUUID,encrypt=ageEncrypt,onExportMeasured=()=>{}}={}){
  const config=configuration(env),createdAt=now();if(!Number.isSafeInteger(createdAt)||createdAt<0)throw new Error('Invalid backup clock.');
  const directory=mkdtempSync(join(tmpdir(),'postandin-gear-backup-')),plainPath=join(directory,'gear.json'),encryptedPath=join(directory,'gear.json.age');let database;
  try{
    const exported=await d1Export(config,{fetchImpl,wait,clock});onExportMeasured(exported.durationMs);database=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
    try{database.exec(exported.sql);}catch{throw new Error('D1 export SQL could not be loaded.');}
    let backup=createLeanGearBackup(database,{now:createdAt,bookmark:exported.bookmark,backupId:uuid()});
    backup=reconcileLeanGearDeletionEvidence(backup,await currentDeletionEvidence(config,fetchImpl));validateLeanGearBackup(backup,{now:createdAt});
    const plain=Buffer.from(JSON.stringify(backup));if(plain.length>MAX_BACKUP_BYTES)throw new Error('Lean backup is too large.');writeFileSync(plainPath,plain,{mode:0o600,flag:'wx'});
    await encrypt(plainPath,encryptedPath,config.ageRecipient);chmodSync(encryptedPath,0o600);const encrypted=readFileSync(encryptedPath);if(!encrypted.length||statSync(encryptedPath).mode&0o077)throw new Error('Encrypted backup file is unsafe.');
    const fileName=`gear/records-${new Date(createdAt).toISOString().slice(0,10)}-${backup.backupId}.json.age`,auth=await b2Authorize(config,fetchImpl),fileId=await b2Upload(config,auth,fileName,encrypted,fetchImpl);await b2ReadBack(auth,fileId,encrypted,fetchImpl);
    return {backupId:backup.backupId,fileName,createdAt,expiresAt:backup.expiresAt,bytes:encrypted.length,scope:backup.scope,d1ExportMs:exported.durationMs};
  }finally{database?.close();rmSync(directory,{recursive:true,force:true});}
}

function directRun(){
  try{return Boolean(process.argv[1])&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));}catch{return false;}
}

const SAFE_FAILURES=new Set([
  'Encrypted backup file is unsafe.',
  'D1 export SQL could not be loaded.',
  'Gear backup source schema is incomplete.',
  'Gear backup retention cannot exceed seller-deletion evidence retention.',
  'Gear lean backup has expired.',
  'Invalid Gear deletion evidence.',
  'Invalid Gear backup input.',
  'Invalid Gear lean backup relationships.',
  'Invalid Gear lean backup.',
  'Invalid backup clock.',
  'Lean backup is too large.',
]);

export function safeFailure(error){
  const message=error instanceof Error?error.message:'';
  if(message.startsWith('Invalid GEAR_BACKUP_'))return 'Backup configuration is invalid.';
  if(SAFE_FAILURES.has(message))return message;
  if(message.startsWith('D1 export'))return message;
  if(message==='Unable to read current deletion evidence.')return message;
  if(message.startsWith('B2 ')||message.startsWith('Backup provider')||message.startsWith('Age encryption')||message.startsWith('Unable to start age'))return message;
  return 'Unexpected backup failure.';
}

if(directRun()){
  runLeanCloudBackup({onExportMeasured:durationMs=>console.log(exportDurationOutput(durationMs))}).then(()=>console.log(successOutput())).catch(error=>{console.error(`Gear backup failed: ${safeFailure(error)}`);process.exitCode=1;});
}
