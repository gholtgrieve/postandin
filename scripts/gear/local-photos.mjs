// macOS-only local image pipeline. Never import into deployed Workers.
import {isDeleted} from './local-lifecycle.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile),hash=s=>createHash('sha256').update(s).digest('hex');
export class PhotoError extends Error {}
export const MAX_PHOTO_BYTES=5*1024*1024;
export const MAX_PHOTO_PIXELS=25_000_000;
export function validPhotoDimensions(width,height){
 return Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0
  &&width*height<=MAX_PHOTO_PIXELS&&Math.max(width,height)<=12000;
}
export function initializePhotos(db){db.sqlite.exec(`CREATE TABLE IF NOT EXISTS gear_local_photos (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES gear_listings(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, content BLOB NOT NULL, created_at INTEGER NOT NULL)`);}
function owner(db,session,csrf,id,write=false){
 if(!/^[a-f0-9]{64}$/.test(session||'')||(write&&!/^[a-f0-9]{64}$/.test(csrf||'')))return false;
 const now=Date.now();return Boolean(db.sqlite.prepare(`SELECT l.id FROM gear_listings l JOIN gear_sellers s ON s.id=l.seller_id JOIN gear_management_sessions m ON m.seller_id=s.id
 WHERE l.id=? AND l.verified_at IS NOT NULL AND s.verified_at IS NOT NULL AND l.status!='unverified' ${write?"AND l.status!='removed'":''}
 AND m.session_hash=? AND m.created_at<=? AND m.expires_at>? AND m.revoked_at IS NULL
 AND (m.listing_id IS NULL OR m.listing_id=l.id) ${write?'AND m.csrf_hash=?':''}`).get(...[id,hash(session),now,now,...(write?[hash(csrf)]:[])]));
}
export function photoRows(db,id,privateView=false){return db.sqlite.prepare('SELECT id FROM gear_local_photos WHERE listing_id=? ORDER BY position,id').all(id).map((r,i)=>({id:r.id,name:'Photo '+(i+1),url:(privateView?'/management':'')+'/photos/'+r.id}));}
export function photoContent(db,id,session,privateView=false){
 const row=db.sqlite.prepare('SELECT p.*,l.status,l.verified_at,l.expires_at,s.verified_at AS seller_verified FROM gear_local_photos p JOIN gear_listings l ON l.id=p.listing_id JOIN gear_sellers s ON s.id=l.seller_id WHERE p.id=?').get(id);
 if(!row||isDeleted(db,row.listing_id))return null;
 if(privateView?!owner(db,session,null,row.listing_id):!(['available','pending'].includes(row.status)&&row.verified_at!==null&&row.seller_verified!==null&&row.expires_at>Date.now()))return null;
 return row.content;
}
// Read only the bounded TIFF orientation field; the system decoder still validates pixels.
function tiffOrientation(input){
 const b=input.subarray(input.subarray(0,6).equals(Buffer.from('Exif\0\0'))?6:0);
 if(b.length<8)return 1;
 const little=b.toString('ascii',0,2)==='II',big=b.toString('ascii',0,2)==='MM';
 if(!little&&!big)return 1;
 const u16=i=>little?b.readUInt16LE(i):b.readUInt16BE(i),u32=i=>little?b.readUInt32LE(i):b.readUInt32BE(i);
 if(u16(2)!==42)return 1;
 const offset=u32(4);if(offset<8||offset>b.length-2)return 1;
 const count=u16(offset);if(count>Math.floor((b.length-offset-2)/12))return 1;
 for(let i=0;i<count;i++){const pos=offset+2+i*12;if(u16(pos)===0x112&&u16(pos+2)===3&&u32(pos+4)===1){const n=u16(pos+8);return n>=1&&n<=8?n:1;}}
 return 1;
}
function imageOrientation(b){
 if(b[0]===255&&b[1]===216){
  let i=2;while(i+4<=b.length){if(b[i++]!==255)break;while(i<b.length&&b[i]===255)i++;const marker=b[i++];if(marker===0xda||marker===0xd9)break;if(i+2>b.length)break;const n=b.readUInt16BE(i);if(n<2||i+n>b.length)break;
   if(marker===0xe1&&b.toString('ascii',i+2,i+8)==='Exif\0\0')return tiffOrientation(b.subarray(i+2,i+n));i+=n;}
 }else if(b.toString('ascii',1,4)==='PNG'){
  for(let i=8;i+12<=b.length;){const n=b.readUInt32BE(i);if(n>b.length-i-12)break;if(b.toString('ascii',i+4,i+8)==='eXIf')return tiffOrientation(b.subarray(i+8,i+8+n));i+=n+12;}
 }else if(b.toString('ascii',8,12)==='WEBP'){
  for(let i=12;i+8<=b.length;){const n=b.readUInt32LE(i+4);if(n>b.length-i-8)break;if(b.toString('ascii',i,i+4)==='EXIF')return tiffOrientation(b.subarray(i+8,i+8+n));i+=8+n+(n%2);}
 }
 return 1;
}
export async function sanitizePhoto(data){
 if(typeof data!=='string'||data.length>Math.ceil(MAX_PHOTO_BYTES/3)*4||!data.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(data))throw new PhotoError('Choose an image up to 5 MB.');
 const bytes=Buffer.from(data,'base64');if(bytes.toString('base64')!==data)throw new PhotoError('Choose a valid image.');
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(bytes.length>MAX_PHOTO_BYTES||!(png||jpeg||webp))throw new PhotoError('Choose a valid JPG, PNG or WebP image up to 5 MB.');
 const dir=await mkdtemp(join(tmpdir(),'gear-image-'));
 try{
  const input=join(dir,'input'),output=join(dir,'output.png');await writeFile(input,bytes,{mode:0o600});
  const opts={timeout:15000,maxBuffer:65536};
  const probe=await run('/usr/bin/sips',['-g','pixelWidth','-g','pixelHeight',input],opts);
  const width=Number(probe.stdout.match(/pixelWidth: (\d+)/)?.[1]),height=Number(probe.stdout.match(/pixelHeight: (\d+)/)?.[1]);
  if(!validPhotoDimensions(width,height))throw new PhotoError('Choose an image no larger than 25 megapixels.');
  const orientation=imageOrientation(bytes);
  // sips applies flips before rotation, regardless of argument order.
  const transforms={2:['-f','horizontal'],3:['-r','180'],4:['-f','vertical'],5:['-r','90','-f','vertical'],6:['-r','90'],7:['-r','90','-f','horizontal'],8:['-r','270']};
  await run('/usr/bin/sips',['-s','format','png',...(transforms[orientation]||[]),...(Math.max(width,height)>1600?['-Z','1600']:[]),input,'--out',output],opts);
  const encoded=await readFile(output),parts=[encoded.subarray(0,8)];let offset=8,ended=false;
  if(!encoded.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Invalid encoder output');
  // Keep only pixel/format chunks. Strip EXIF, comments, profiles and other metadata.
  while(offset+12<=encoded.length){const length=encoded.readUInt32BE(offset),end=offset+length+12;if(end>encoded.length)throw new Error('Invalid PNG chunk');const type=encoded.toString('ascii',offset+4,offset+8);if(['IHDR','PLTE','tRNS','IDAT','IEND'].includes(type))parts.push(encoded.subarray(offset,end));offset=end;if(type==='IEND'){ended=true;break;}}
  const result=Buffer.concat(parts);if(!ended||result.length>12*1024*1024)throw new Error('Invalid encoder output');return result;
 }catch(error){if(error instanceof PhotoError)throw error;throw new PhotoError('This image could not be processed. Try a different JPG, PNG or WebP.');}
 finally{await rm(dir,{recursive:true,force:true});}
}
export async function changePhotos(db,session,csrf,input){
 const id=input?.id;if(typeof id!=='string'||!owner(db,session,csrf,id,true))return false;
 if(!['upload','main','remove'].includes(input.action))throw new PhotoError('Choose a photo action.');
 if(input.action==='upload'&&photoRows(db,id).length>=6)throw new PhotoError('Six photos is the limit. Remove a photo first.');
 const content=input.action==='upload'?await sanitizePhoto(input.data):null;
 // Recheck credentials and quota after asynchronous decoding; all mutations are atomic.
 db.sqlite.exec('BEGIN');
 try{
  if(!owner(db,session,csrf,id,true)){db.sqlite.exec('ROLLBACK');return false;}
  const rows=photoRows(db,id);
  if(content){if(rows.length>=6)throw new PhotoError('Six photos is the limit. Remove a photo first.');db.sqlite.prepare('INSERT INTO gear_local_photos VALUES(?,?,?,?,?)').run(randomUUID(),id,rows.length,content,Date.now());}
  else{
   if(!rows.some(r=>r.id===input.photoId)){db.sqlite.exec('ROLLBACK');return false;}
   if(input.action==='remove')db.sqlite.prepare('DELETE FROM gear_local_photos WHERE id=? AND listing_id=?').run(input.photoId,id);
   const ordered=input.action==='main'?[...rows.filter(r=>r.id===input.photoId),...rows.filter(r=>r.id!==input.photoId)]:rows.filter(r=>r.id!==input.photoId);
   ordered.forEach((r,i)=>db.sqlite.prepare('UPDATE gear_local_photos SET position=? WHERE id=? AND listing_id=?').run(i,r.id,id));
  }
  db.sqlite.exec('COMMIT');return true;
 }catch(error){db.sqlite.exec('ROLLBACK');throw error;}
}
