import {request} from 'node:http';
import {localServer} from '../scripts/gear/local-server.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {deflateSync,inflateSync} from 'node:zlib';
import {openLocalDatabase} from '../scripts/gear/local-db.mjs';
import {initializePhotos,changePhotos,photoRows,photoContent,sanitizePhoto,validPhotoDimensions} from '../scripts/gear/local-photos.mjs';
import {createDraft} from '../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../lib/gear-verification.mjs';
import {issueLocalManagementLink,redeemManagementLink,changeListingState} from '../lib/gear-management.mjs';
import {issueLocalEmailChange,confirmEmailChange} from '../lib/gear-email-change.mjs';
function chunk(type,data){const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const b of content){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);content.copy(result,4);result.writeUInt32BE((crc^0xffffffff)>>>0,result.length-4);return result;}
function fixture(width=2,height=1){const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const pixels=Buffer.alloc(height*(1+width*3));for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*(1+width*3)+1+x*3;pixels[i]=x*70;pixels[i+1]=y*130;pixels[i+2]=(x+y)*40;}return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('tEXt',Buffer.from('Comment\0private GPS sample')),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');}
function orientJPEG(jpeg,orientation,bigEndian=false){
 const parts=[jpeg.subarray(0,2)];let i=2;
 while(i+4<=jpeg.length){const marker=jpeg[i+1];if(marker===0xda){parts.push(jpeg.subarray(i));break;}const n=jpeg.readUInt16BE(i+2);if(marker!==0xe1)parts.push(jpeg.subarray(i,i+n+2));i+=n+2;}
 const tiff=Buffer.alloc(26);tiff.write(bigEndian?'MM':'II');
 const u16=(value,offset)=>bigEndian?tiff.writeUInt16BE(value,offset):tiff.writeUInt16LE(value,offset),u32=(value,offset)=>bigEndian?tiff.writeUInt32BE(value,offset):tiff.writeUInt32LE(value,offset);
 u16(42,2);u32(8,4);u16(1,8);u16(0x112,10);u16(3,12);u32(1,14);u16(orientation,18);
 const exif=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),marker=Buffer.alloc(4);marker[0]=255;marker[1]=225;marker.writeUInt16BE(exif.length+2,2);
 return Buffer.concat([parts[0],marker,exif,...parts.slice(1)]);
}
// Decode the encoder's RGB/RGBA test output to compare actual pixel placement.
function pngPixels(b){
 const width=b.readUInt32BE(16),height=b.readUInt32BE(20),channels=b[25]===6?4:3;assert.equal(b[24],8);assert.ok([2,6].includes(b[25]));const parts=[];
 for(let i=8;i+12<=b.length;){const n=b.readUInt32BE(i);if(b.toString('ascii',i+4,i+8)==='IDAT')parts.push(b.subarray(i+8,i+8+n));i+=n+12;}
 const raw=inflateSync(Buffer.concat(parts)),stride=width*channels,decoded=Buffer.alloc(stride*height);let pos=0;
 for(let y=0;y<height;y++){const filter=raw[pos++];for(let x=0;x<stride;x++){const a=x>=channels?decoded[y*stride+x-channels]:0,c=y&&x>=channels?decoded[(y-1)*stride+x-channels]:0,up=y?decoded[(y-1)*stride+x]:0,p=a+up-c;const pa=Math.abs(p-a),pb=Math.abs(p-up),pc=Math.abs(p-c);const prediction=[0,a,up,Math.floor((a+up)/2),pa<=pb&&pa<=pc?a:pb<=pc?up:c][filter];assert.notEqual(prediction,undefined);decoded[y*stride+x]=(raw[pos++]+prediction)&255;}}
 return {width,height,pixels:Array.from({length:width*height},(_,i)=>[...decoded.subarray(i*channels,i*channels+3)])};
}
const sample={title:'Photo bag',description:'Used bag',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'photo@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function login(db,email=sample.email){const link=await issueLocalManagementLink(db,email);return redeemManagementLink(db,link.token);}
async function publish(db,patch={}){const {id}=await createDraft(db,{...sample,...patch});const receipt=await issueLocalVerification(db,id);await confirmVerification(db,receipt.token);return id;}
test('trusted local sanitizer decodes pixels and strips metadata; rejects spoofed and malformed files',async()=>{
 const image=await sanitizePhoto(fixture());assert.equal(image.toString('ascii',1,4),'PNG');assert.equal(image.includes(Buffer.from('private GPS')),false);
 for(const value of [Buffer.from('<svg/>').toString('base64'),'!!!!',Buffer.from([255,216,255,0]).toString('base64'),'A'.repeat(7*1024*1024)])await assert.rejects(sanitizePhoto(value));
});
test('local photo dimensions include current 24 MP phone output but stop at 25 million pixels',()=>{
 assert.equal(validPhotoDimensions(5712,4284),true);
 assert.equal(validPhotoDimensions(5000,5000),true);
 assert.equal(validPhotoDimensions(5000,5001),false);
 assert.equal(validPhotoDimensions(12001,1),false);
});
test('photos persist, enforce owner/CSRF/six limit, reorder/delete and follow listing visibility and email transfer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gear-photo-test-')),path=join(dir,'db.sqlite');let db=openLocalDatabase(path);initializePhotos(db);
 try{
  const id=await publish(db),access=await login(db),foreignId=await publish(db,{email:'foreign@example.test',title:'Other'}),foreign=await login(db,'foreign@example.test');
  const input={id,action:'upload',data:fixture()};
  assert.equal(await changePhotos(db,foreign.session,foreign.csrf,input),false);assert.equal(await changePhotos(db,access.session,'0'.repeat(64),input),false);
  const draft=await createDraft(db,{...sample,title:'Draft'});assert.equal(await changePhotos(db,access.session,access.csrf,{...input,id:draft.id}),false);
  for(let i=0;i<6;i++)assert.equal(await changePhotos(db,access.session,access.csrf,input),true);
  await assert.rejects(changePhotos(db,access.session,access.csrf,input),/Six photos/);
  let rows=photoRows(db,id);const main=rows[5].id;
  assert.equal(await changePhotos(db,access.session,access.csrf,{id,action:'main',photoId:main}),true);assert.equal(photoRows(db,id)[0].id,main);
  assert.ok(photoContent(db,main,'',false));assert.equal(photoContent(db,main,foreign.session,true),null);
  await changeListingState(db,access.session,access.csrf,id,'close');assert.equal(photoContent(db,main,'',false),null);assert.ok(photoContent(db,main,access.session,true));
  db.close();db=openLocalDatabase(path);initializePhotos(db);assert.equal(photoRows(db,id)[0].id,main);assert.equal(photoRows(db,id).length,6);
  const transfer=await issueLocalEmailChange(db,access.session,access.csrf,'new-photo@example.test');assert.equal(await confirmEmailChange(db,transfer.token),true);
  assert.equal(photoContent(db,main,access.session,true),null);const next=await login(db,'new-photo@example.test');assert.ok(photoContent(db,main,next.session,true));
  assert.equal(await changePhotos(db,next.session,next.csrf,{id:foreignId,action:'remove',photoId:main}),false);
  assert.equal(await changePhotos(db,next.session,next.csrf,{id,action:'remove',photoId:main}),true);assert.equal(photoContent(db,main,next.session,true),null);assert.equal(photoRows(db,id).length,5);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('concurrent decoding cannot exceed six and revocation during decode prevents attachment',async()=>{
 const db=openLocalDatabase();initializePhotos(db);
 try{
  const id=await publish(db),access=await login(db),input={id,action:'upload',data:fixture()};
  const results=await Promise.allSettled(Array.from({length:7},()=>changePhotos(db,access.session,access.csrf,input)));
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value).length,6);assert.equal(photoRows(db,id).length,6);
  await changePhotos(db,access.session,access.csrf,{id,action:'remove',photoId:photoRows(db,id)[0].id});
  const pending=changePhotos(db,access.session,access.csrf,input);
  db.sqlite.prepare('UPDATE gear_management_sessions SET revoked_at=?').run(Date.now());
  assert.equal(await pending,false);assert.equal(photoRows(db,id).length,5);
 }finally{db.close();}
});

test('photo HTTP endpoints bound bodies and require owner cookie, CSRF and exact Origin',async()=>{
 const db=openLocalDatabase(),server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const id=await publish(db),access=await login(db),port=server.address().port,origin='http://127.0.0.1:'+port;
  const post=(body,extra={})=>new Promise((resolve,reject)=>{const text=JSON.stringify(body),req=request({hostname:'127.0.0.1',port,path:'/management/photos',method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:'gear_session='+access.session,'X-Gear-CSRF':access.csrf,...extra}},res=>{let result='';res.on('data',c=>result+=c);res.on('end',()=>resolve({status:res.statusCode,body:result}));});req.on('error',reject);req.end(text);});
  const input={id,action:'upload',data:fixture()};
  assert.equal((await post(input,{Origin:'https://foreign.test'})).status,403);
  assert.equal((await post(input,{Cookie:''})).status,403);
  assert.equal((await post(input,{'X-Gear-CSRF':''})).status,403);
  assert.equal((await post(input,{'Content-Length':8*1024*1024})).status,413);
  const invalid=await post({...input,data:Buffer.from('<svg/>').toString('base64')});assert.equal(invalid.status,400);assert.doesNotMatch(invalid.body,/sips|\/tmp|stack/i);
  assert.equal((await post(input)).status,200);assert.equal(photoRows(db,id).length,1);
 }finally{await new Promise(r=>{server.close(r);server.closeAllConnections();});db.close();}
});

test('small images stay small, large images shrink, and all eight JPEG orientations transform pixels before metadata stripping',async()=>{
 const small=await sanitizePhoto(fixture());assert.deepEqual([small.readUInt32BE(16),small.readUInt32BE(20)],[2,1]);
 const large=await sanitizePhoto(fixture(2000,2));assert.equal(large.readUInt32BE(16),1600);
 const dir=mkdtempSync(join(tmpdir(),'gear-orientation-test-'));
 try{
  writeFileSync(join(dir,'grid.png'),Buffer.from(fixture(3,2),'base64'));
  execFileSync('/usr/bin/sips',['-s','format','jpeg',join(dir,'grid.png'),'--out',join(dir,'grid.jpg')],{stdio:'ignore'});
  const jpeg=readFileSync(join(dir,'grid.jpg')),baseline=pngPixels(await sanitizePhoto(orientJPEG(jpeg,1).toString('base64')));
  const expected=[[0,1,2,3,4,5],[2,1,0,5,4,3],[5,4,3,2,1,0],[3,4,5,0,1,2],[0,3,1,4,2,5],[3,0,4,1,5,2],[5,2,4,1,3,0],[2,5,1,4,0,3]];
  const bigEndianOutput=await sanitizePhoto(orientJPEG(jpeg,6,true).toString('base64')),portrait=pngPixels(bigEndianOutput);
  assert.deepEqual([portrait.width,portrait.height],[2,3]);
  assert.deepEqual(portrait.pixels,expected[5].map(i=>baseline.pixels[i]),'big-endian orientation 6');
  assert.equal(bigEndianOutput.includes(Buffer.from('Exif')),false);
  for(let n=1;n<=8;n++){const output=await sanitizePhoto(orientJPEG(jpeg,n).toString('base64')),actual=pngPixels(output);assert.deepEqual([actual.width,actual.height],n>=5?[2,3]:[3,2]);assert.deepEqual(actual.pixels,expected[n-1].map(i=>baseline.pixels[i]),'orientation '+n);assert.equal(output.includes(Buffer.from('Exif')),false);}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
