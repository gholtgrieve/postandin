import {existsSync,lstatSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openLocalDatabase} from './local-db.mjs';
import {restoreLeanGearBackup,validateLeanGearBackup} from '../../lib/gear-lean-backup.mjs';

const MAX_BACKUP_BYTES=128*1024*1024;

function path(value,label,{mustExist=true}={}){
  if(typeof value!=='string'||!value||value.includes('\0'))throw new Error(`Invalid ${label} path.`);
  const absolute=resolve(value);if(mustExist){const stat=lstatSync(absolute);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<2||stat.size>MAX_BACKUP_BYTES)throw new Error(`Invalid ${label} file.`);}return absolute;
}

export function readLeanBackupFile(file,{now=null}={}){
  const source=path(file,'backup');let value;try{value=JSON.parse(readFileSync(source,'utf8'));}catch{throw new Error('Invalid Gear lean backup file.');}return validateLeanGearBackup(value,{now});
}

export function restoreLeanBackupFile(file,target,{now=Date.now(),newerFiles=[]}={}){
  const source=path(file,'backup'),destination=path(target,'restore target',{mustExist:false});
  if(source===destination||existsSync(destination))throw new Error('Restore target must be a new file.');
  const backup=readLeanBackupFile(source,{now}),newerDeletionEvidence=[];
  for(const newer of newerFiles)newerDeletionEvidence.push(...readLeanBackupFile(newer).deletionEvidence);
  let db;
  try{writeFileSync(destination,'',{mode:0o600,flag:'wx'});db=openLocalDatabase(destination);const result=restoreLeanGearBackup(db.sqlite,backup,{now,newerDeletionEvidence});db.close();db=null;return result;}
  catch(error){db?.close();rmSync(destination,{force:true});throw error;}
}

const sqlValue=value=>value===null?'NULL':typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
export function writeLeanRestoreSql(file,output,{now=Date.now(),newerFiles=[]}={}){
  const destination=path(output,'SQL restore target',{mustExist:false});if(existsSync(destination))throw new Error('SQL restore target must be a new file.');
  const directory=mkdtempSync(join(tmpdir(),'gear-lean-sql-')),databasePath=join(directory,'restored.sqlite');let db;
  try{
    restoreLeanBackupFile(file,databasePath,{now,newerFiles});db=new DatabaseSync(databasePath,{readOnly:true});
    const definitions=[
      ['gear_sellers',['id','email','verified_at','created_at']],
      ['gear_listings',['id','seller_id','seller_name','title','description','category','size','fit','condition','city','type','price_cents','trade','other_club','status','verified_at','expires_at','created_at','adult_acknowledged_at','disclosure_version','duplicate_key']],
      ['gear_listing_clubs',['listing_id','club']],
      ['gear_removals',['listing_id','previous_status','removed_at','reason']],
      ['gear_deletion_ledger',['listing_id','deleted_at','purge_at','purged_at']],
    ];
    const lines=['-- Post & In Gear lean records restore. Apply only to a new database after migrations 0001-0018.'];
    for(const [table,columns] of definitions){for(const row of db.prepare(`SELECT ${columns.join(',')} FROM ${table} ORDER BY ${columns[0]}`).all())lines.push(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(column=>sqlValue(row[column])).join(',')});`);}
    const bytes=Buffer.from(lines.join('\n')+'\n');if(bytes.length>MAX_BACKUP_BYTES)throw new Error('Gear restore SQL is too large.');writeFileSync(destination,bytes,{mode:0o600,flag:'wx'});return {bytes:bytes.length};
  }catch(error){rmSync(destination,{force:true});throw error;}
  finally{db?.close();rmSync(directory,{recursive:true,force:true});}
}

function usage(){throw new Error('Usage: lean-backup.mjs verify BACKUP.json | restore BACKUP.json NEW.sqlite [NEWER-BACKUP.json ...] | sql BACKUP.json NEW.sql [NEWER-BACKUP.json ...]');}
if(import.meta.main){
  try{
    const [command,file,target,...newerFiles]=process.argv.slice(2);
    if(command==='verify'&&file&&!target){const backup=readLeanBackupFile(file,{now:Date.now()});console.log(JSON.stringify({ok:true,backupId:backup.backupId,createdAt:backup.createdAt,expiresAt:backup.expiresAt,scope:backup.scope}));}
    else if(command==='restore'&&file&&target)console.log(JSON.stringify({ok:true,...restoreLeanBackupFile(file,target,{newerFiles})}));
    else if(command==='sql'&&file&&target)console.log(JSON.stringify({ok:true,...writeLeanRestoreSql(file,target,{newerFiles})}));
    else usage();
  }catch(error){console.error(error.message);process.exitCode=1;}
}
