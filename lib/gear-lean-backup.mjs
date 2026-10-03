import {SELLER_RECOVERY_MS} from './gear-seller-deletion.mjs';

const DAY_MS=86_400_000;
export const GEAR_LEAN_BACKUP_RETENTION_MS=30*DAY_MS;
export const GEAR_LEAN_BACKUP_VERSION=1;
export const GEAR_LEAN_REMOVAL_REASON='Owner removal remains in effect; original reason is not retained in backup.';
if(GEAR_LEAN_BACKUP_RETENTION_MS>SELLER_RECOVERY_MS)throw new Error('Gear backup retention cannot exceed seller-deletion evidence retention.');

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const TABLE_KEYS=['sellers','listings','clubs','removals'];
const SOURCE_TABLES=['gear_sellers','gear_listings','gear_listing_clubs','gear_removals','gear_deletions','gear_deletion_ledger'];
const RESTORE_TABLES=['gear_sellers','gear_listings','gear_listing_clubs','gear_photos','gear_reports','gear_removals','gear_moderation_history','gear_deletions','gear_deletion_ledger'];
const LISTING_COLUMNS=`id,seller_id,seller_name,title,description,category,size,fit,condition,city,type,
  price_cents,trade,other_club,status,verified_at,expires_at,created_at,adult_acknowledged_at,disclosure_version,duplicate_key`;

const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const safeTime=value=>Number.isSafeInteger(value)&&value>=0;
const id=value=>typeof value==='string'&&UUID.test(value);
const all=(sqlite,sql,...args)=>sqlite.prepare(sql).all(...args);
const placeholders=count=>Array.from({length:count},()=>'?').join(',');

function requireTables(sqlite,required){
  const found=new Set(all(sqlite,"SELECT name FROM sqlite_master WHERE type='table'").map(row=>row.name));
  if(required.some(name=>!found.has(name)))throw new Error('Gear backup source schema is incomplete.');
}

export function createLeanGearBackup(sqlite,{now=Date.now(),bookmark='local-test',backupId=crypto.randomUUID()}={}){
  if(!sqlite||typeof sqlite.prepare!=='function'||!safeTime(now)||!id(backupId)||typeof bookmark!=='string'||!bookmark||bookmark.length>512||/[\x00-\x1f\x7f]/.test(bookmark))throw new TypeError('Invalid Gear backup input.');
  requireTables(sqlite,SOURCE_TABLES);
  const listings=all(sqlite,`SELECT ${LISTING_COLUMNS} FROM gear_listings l
    WHERE l.status!='unverified' AND NOT EXISTS(SELECT 1 FROM gear_deletions d WHERE d.listing_id=l.id)
    ORDER BY l.id`);
  const listingIds=listings.map(row=>row.id),sellerIds=[...new Set(listings.map(row=>row.seller_id))].sort();
  const sellers=sellerIds.length?all(sqlite,`SELECT id,email,verified_at,created_at FROM gear_sellers WHERE id IN (${placeholders(sellerIds.length)}) ORDER BY id`,...sellerIds):[];
  const clubs=listingIds.length?all(sqlite,`SELECT listing_id,club FROM gear_listing_clubs WHERE listing_id IN (${placeholders(listingIds.length)}) ORDER BY listing_id,club`,...listingIds):[];
  const removals=listingIds.length?all(sqlite,`SELECT listing_id,previous_status,removed_at FROM gear_removals WHERE listing_id IN (${placeholders(listingIds.length)}) ORDER BY listing_id`,...listingIds)
    .map(row=>({...row,reason:GEAR_LEAN_REMOVAL_REASON})):[];
  const deletionEvidence=all(sqlite,`SELECT listing_id,deleted_at,purge_at FROM gear_deletion_ledger
    WHERE purged_at IS NULL ORDER BY listing_id`).map(row=>({listingId:row.listing_id,deletedAt:row.deleted_at,purgeAt:row.purge_at}));
  return {
    schemaVersion:GEAR_LEAN_BACKUP_VERSION,
    backupId,
    createdAt:now,
    expiresAt:now+GEAR_LEAN_BACKUP_RETENTION_MS,
    bookmark,
    scope:'records-only-no-photos-no-drafts-no-credentials-no-contact-no-report-history',
    tables:{sellers,listings,clubs,removals},
    deletionEvidence,
  };
}

function validSeller(row){return exactKeys(row,['id','email','verified_at','created_at'])&&id(row.id)&&typeof row.email==='string'&&row.email===row.email.toLowerCase()&&safeTime(row.created_at)&&(row.verified_at===null||safeTime(row.verified_at));}
function validListing(row){return exactKeys(row,['id','seller_id','seller_name','title','description','category','size','fit','condition','city','type','price_cents','trade','other_club','status','verified_at','expires_at','created_at','adult_acknowledged_at','disclosure_version','duplicate_key'])&&id(row.id)&&id(row.seller_id)&&['available','pending','closed','expired','removed'].includes(row.status)&&safeTime(row.created_at)&&typeof row.duplicate_key==='string'&&row.duplicate_key.length>0;}
function validClub(row){return exactKeys(row,['listing_id','club'])&&id(row.listing_id)&&typeof row.club==='string'&&row.club.length>0;}
function validRemoval(row){return exactKeys(row,['listing_id','previous_status','removed_at','reason'])&&id(row.listing_id)&&['available','pending'].includes(row.previous_status)&&safeTime(row.removed_at)&&row.reason===GEAR_LEAN_REMOVAL_REASON;}
function validEvidence(row){return exactKeys(row,['listingId','deletedAt','purgeAt'])&&id(row.listingId)&&safeTime(row.deletedAt)&&safeTime(row.purgeAt)&&row.purgeAt>row.deletedAt;}

export function validateLeanGearBackup(value,{now=null}={}){
  if(!exactKeys(value,['schemaVersion','backupId','createdAt','expiresAt','bookmark','scope','tables','deletionEvidence'])
    ||value.schemaVersion!==GEAR_LEAN_BACKUP_VERSION||!id(value.backupId)||!safeTime(value.createdAt)
    ||value.expiresAt!==value.createdAt+GEAR_LEAN_BACKUP_RETENTION_MS||typeof value.bookmark!=='string'||!value.bookmark||value.bookmark.length>512
    ||value.scope!=='records-only-no-photos-no-drafts-no-credentials-no-contact-no-report-history'
    ||!exactKeys(value.tables,TABLE_KEYS)||!TABLE_KEYS.every(key=>Array.isArray(value.tables[key]))||!Array.isArray(value.deletionEvidence)
    ||!value.tables.sellers.every(validSeller)||!value.tables.listings.every(validListing)||!value.tables.clubs.every(validClub)
    ||!value.tables.removals.every(validRemoval)||!value.deletionEvidence.every(validEvidence))throw new Error('Invalid Gear lean backup.');
  if(now!==null&&(!safeTime(now)||value.expiresAt<=now))throw new Error('Gear lean backup has expired.');
  const sellerIds=new Set(value.tables.sellers.map(row=>row.id)),sellerEmails=new Set(value.tables.sellers.map(row=>row.email)),listingIds=new Set(value.tables.listings.map(row=>row.id));
  const clubKeys=new Set(value.tables.clubs.map(row=>`${row.listing_id}\0${row.club}`)),removalIds=new Set(value.tables.removals.map(row=>row.listing_id));
  if(sellerIds.size!==value.tables.sellers.length||sellerEmails.size!==value.tables.sellers.length||listingIds.size!==value.tables.listings.length
    ||clubKeys.size!==value.tables.clubs.length||removalIds.size!==value.tables.removals.length||value.deletionEvidence.some((row,index,rows)=>rows.findIndex(other=>other.listingId===row.listingId)!==index)
    ||value.tables.listings.some(row=>!sellerIds.has(row.seller_id))||value.tables.clubs.some(row=>!listingIds.has(row.listing_id))
    ||value.tables.removals.some(row=>!listingIds.has(row.listing_id)))throw new Error('Invalid Gear lean backup relationships.');
  return value;
}

export function reconcileLeanGearDeletionEvidence(value,deletionEvidence){
  validateLeanGearBackup(value);
  if(!Array.isArray(deletionEvidence)||!deletionEvidence.every(validEvidence))throw new TypeError('Invalid Gear deletion evidence.');
  const evidence=[...new Map(deletionEvidence.map(row=>[row.listingId,row])).values()].sort((left,right)=>left.listingId.localeCompare(right.listingId)),blocked=new Set(evidence.map(row=>row.listingId));
  const listings=value.tables.listings.filter(row=>!blocked.has(row.id)),listingIds=new Set(listings.map(row=>row.id)),sellerIds=new Set(listings.map(row=>row.seller_id));
  return {...value,tables:{
    sellers:value.tables.sellers.filter(row=>sellerIds.has(row.id)),
    listings,
    clubs:value.tables.clubs.filter(row=>listingIds.has(row.listing_id)),
    removals:value.tables.removals.filter(row=>listingIds.has(row.listing_id)),
  },deletionEvidence:evidence};
}

function insertRows(sqlite,table,columns,rows){
  if(!rows.length)return;
  const statement=sqlite.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${placeholders(columns.length)})`);
  for(const row of rows)statement.run(...columns.map(column=>row[column]));
}

export function restoreLeanGearBackup(sqlite,value,{now=Date.now(),newerDeletionEvidence=[]}={}){
  validateLeanGearBackup(value,{now});
  if(!sqlite||typeof sqlite.prepare!=='function'||!Array.isArray(newerDeletionEvidence)||!newerDeletionEvidence.every(validEvidence))throw new TypeError('Invalid Gear restore input.');
  requireTables(sqlite,RESTORE_TABLES);
  for(const table of RESTORE_TABLES){
    if(sqlite.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get())throw new Error('Gear restore target is not empty.');
  }
  const evidence=[...value.deletionEvidence,...newerDeletionEvidence],blocked=new Set(evidence.map(row=>row.listingId));
  const listings=value.tables.listings.filter(row=>!blocked.has(row.id)),listingIds=new Set(listings.map(row=>row.id));
  const sellerIds=new Set(listings.map(row=>row.seller_id)),sellers=value.tables.sellers.filter(row=>sellerIds.has(row.id));
  sqlite.exec('BEGIN');
  try{
    insertRows(sqlite,'gear_sellers',['id','email','verified_at','created_at'],sellers);
    insertRows(sqlite,'gear_listings',['id','seller_id','seller_name','title','description','category','size','fit','condition','city','type','price_cents','trade','other_club','status','verified_at','expires_at','created_at','adult_acknowledged_at','disclosure_version','duplicate_key'],listings);
    insertRows(sqlite,'gear_listing_clubs',['listing_id','club'],value.tables.clubs.filter(row=>listingIds.has(row.listing_id)));
    insertRows(sqlite,'gear_removals',['listing_id','previous_status','removed_at','reason'],value.tables.removals.filter(row=>listingIds.has(row.listing_id)));
    const uniqueEvidence=[...new Map(evidence.map(row=>[row.listingId,row])).values()];
    insertRows(sqlite,'gear_deletion_ledger',['listing_id','deleted_at','purge_at','purged_at'],uniqueEvidence.map(row=>({listing_id:row.listingId,deleted_at:row.deletedAt,purge_at:row.purgeAt,purged_at:Math.max(now,row.purgeAt)})));
    sqlite.exec('COMMIT');
  }catch(error){sqlite.exec('ROLLBACK');throw error;}
  return {listings:listings.length,sellers:sellers.length,photos:0,blocked:blocked.size};
}
