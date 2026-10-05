import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';
import { localServer } from '../scripts/gear/local-server.mjs';
import { createDraft } from '../lib/gear-storage.mjs';
import { issueLocalVerification, confirmVerification } from '../lib/gear-verification.mjs';
import { issueLocalManagementLink, issuePostVerificationManagementLink, redeemManagementLink, listManaged, revokeManagement } from '../lib/gear-management.mjs';
import { issueLocalEmailChange, confirmEmailChange, EMAIL_CHANGE_TTL_MS } from '../lib/gear-email-change.mjs';
import { LIMITS } from '../lib/gear-exchange.mjs';
const input={title:'Bag',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'source@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db,patch={},now=100){const {id}=await createDraft(db,{...input,...patch},now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
async function login(db,email=input.email,now=200){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}
const rows=db=>JSON.stringify(['gear_sellers','gear_listings','gear_management_sessions','gear_management_links','gear_listing_management_links','gear_email_changes'].map(t=>db.sqlite.prepare('SELECT * FROM '+t).all()));

test('transfer preserves old control until confirmation; moves verified records only and revokes old access',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),durable=await issuePostVerificationManagementLink(db,id,100),draft=await createDraft(db,{...input,title:'Draft'}),access=await login(db);
  const before=db.sqlite.prepare('SELECT * FROM gear_listings WHERE id=?').get(id);
  const recovery=await issueLocalManagementLink(db,input.email,201);
  const receipt=await issueLocalEmailChange(db,access.session,access.csrf,'  NEW@Example.test ',202);
  assert.equal(receipt.recipient,'new@example.test');assert.equal(rows(db).includes(receipt.token),false);
  assert.equal((await listManaged(db,access.session,203))[0].id,id);
  const later=await publish(db,{title:'Published after request'},203);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_sellers').get().n,1);
  assert.equal(await confirmEmailChange(db,receipt.token,204),true);
  assert.equal(await confirmEmailChange(db,receipt.token,205),false);
  assert.equal(await listManaged(db,access.session,205),null);
  assert.equal(await redeemManagementLink(db,recovery.token,205),null);
  assert.equal(await redeemManagementLink(db,durable.token,205),null);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listing_management_links').get().n,0);
  const after=db.sqlite.prepare('SELECT * FROM gear_listings WHERE id=?').get(id);
  assert.notEqual(after.seller_id,before.seller_id);
  assert.deepEqual({...after,seller_id:before.seller_id},{...before});
  assert.equal(db.sqlite.prepare('SELECT seller_id FROM gear_listings WHERE id=?').get(draft.id).seller_id,before.seller_id);
  const fresh=await login(db,'new@example.test',206);
  assert.deepEqual(new Set((await listManaged(db,fresh.session,207)).map(r=>r.id)),new Set([id,later]));
 }finally{db.close();}
});

test('request requires a seller-wide session and correct CSRF; reissue, expiry, revocation and wrong credential scope fail safely',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),durable=await issuePostVerificationManagementLink(db,id,100),scoped=await redeemManagementLink(db,durable.token,199),access=await login(db);
  assert.equal(await issueLocalEmailChange(db,scoped.session,scoped.csrf,'new@example.test',200),null);
  for(const csrf of ['',null,'0'.repeat(64)])assert.equal(await issueLocalEmailChange(db,access.session,csrf,'new@example.test',201),null);
  assert.equal(await issueLocalEmailChange(db,access.session,access.csrf,input.email,201),null);
  for(const email of ['bad','a@b..test','a@b.test\r\nBcc:x@y.test',null])await assert.rejects(issueLocalEmailChange(db,access.session,access.csrf,email,201));
  const old=await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test',202);
  const current=await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test',203);
  assert.equal(await confirmEmailChange(db,old.token,204),false);
  assert.equal(await confirmEmailChange(db,current.token,202),false);
  assert.equal(await confirmEmailChange(db,current.token,203+EMAIL_CHANGE_TTL_MS),false);
  assert.equal(await confirmEmailChange(db,access.session,204),false);
  const receipt=await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test',205);
  assert.equal(await revokeManagement(db,access.session,access.csrf,206),true);
  assert.equal(await confirmEmailChange(db,receipt.token,207),false);
  assert.equal(await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test',207),null);
  const fresh=await login(db,input.email,208);
  const pending=await issueLocalEmailChange(db,fresh.session,fresh.csrf,'new@example.test',209);
  await login(db,input.email,210);
  assert.equal(await confirmEmailChange(db,pending.token,211),false);
 }finally{db.close();}
});

test('merge with existing destination keeps drafts isolated and invalidates both sellers sessions and links',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),destId=await publish(db,{email:'dest@example.test',title:'Skates'}),destDurable=await issuePostVerificationManagementLink(db,destId,100);
  const draft=await createDraft(db,{...input,email:'dest@example.test',title:'Draft'});
  const source=await login(db),dest=await login(db,'dest@example.test');
  assert.equal(await issueLocalEmailChange(db,source.session,dest.csrf,'third@example.test',201),null);
  const oldLink=await issueLocalManagementLink(db,'dest@example.test',201);
  const outgoing=await issueLocalEmailChange(db,dest.session,dest.csrf,'third@example.test',201);
  const receipt=await issueLocalEmailChange(db,source.session,source.csrf,'dest@example.test',202);
  assert.equal(await confirmEmailChange(db,receipt.token,203),true);
  assert.equal(await listManaged(db,dest.session,204),null);
  assert.equal(await redeemManagementLink(db,oldLink.token,204),null);
  assert.equal(await redeemManagementLink(db,destDurable.token,204),null);
  assert.equal(await confirmEmailChange(db,outgoing.token,204),false);
  const fresh=await login(db,'dest@example.test',205);
  assert.deepEqual(new Set((await listManaged(db,fresh.session,206)).map(r=>r.id)),new Set([id,destId]));
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(draft.id).status,'unverified');
 }finally{db.close();}
});

test('quota and live duplicate conflicts roll back everything; stale matches do not block transfer',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),other=await publish(db,{email:'dest@example.test'}),access=await login(db);
  const receipt=await issueLocalEmailChange(db,access.session,access.csrf,'dest@example.test',201);
  const before=rows(db);
  assert.equal(await confirmEmailChange(db,receipt.token,202),false);assert.equal(rows(db),before);
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(203,other);
  assert.equal(await confirmEmailChange(db,receipt.token,203),true);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(other).status,'expired');
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'available');
 }finally{db.close();}
 const db2=openLocalDatabase();try{
  await publish(db2);const access=await login(db2);
  const receipt=await issueLocalEmailChange(db2,access.session,access.csrf,'dest@example.test',201);
  for(let i=0;i<LIMITS.activeListings;i++)await publish(db2,{email:'dest@example.test',title:'Other '+i},202);
  db2.sqlite.prepare("UPDATE gear_listings SET status='pending' WHERE title='Other 0'").run();
  const before=rows(db2);assert.equal(await confirmEmailChange(db2,receipt.token,203),false);assert.equal(rows(db2),before);
  db2.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE title='Other 0'").run();
  assert.equal(await confirmEmailChange(db2,receipt.token,204),true);
 }finally{db2.close();}
});

test('unexpected transfer failure rolls back new seller, consumption and all listing/session changes',async()=>{
 const db=openLocalDatabase();try{
  await publish(db);const access=await login(db);
  const receipt=await issueLocalEmailChange(db,access.session,access.csrf,'new@example.test',201),before=rows(db);
  db.sqlite.exec("CREATE TRIGGER fail_transfer BEFORE UPDATE OF revoked_at ON gear_management_sessions BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  await assert.rejects(confirmEmailChange(db,receipt.token,202));assert.equal(rows(db),before);
  db.sqlite.exec('DROP TRIGGER fail_transfer');
  assert.equal(await confirmEmailChange(db,receipt.token,203),true);
 }finally{db.close();}
});

test('competing transfers cannot overfill the destination quota',async()=>{
 const db=openLocalDatabase();try{
  for(let i=0;i<9;i++)await publish(db,{email:'dest@example.test',title:'Destination '+i});
  await publish(db,{title:'Source one'});await publish(db,{email:'other@example.test',title:'Source two'});
  const a=await login(db),b=await login(db,'other@example.test');
  const first=await issueLocalEmailChange(db,a.session,a.csrf,'dest@example.test',201);
  const second=await issueLocalEmailChange(db,b.session,b.csrf,'dest@example.test',201);
  const result=await Promise.all([confirmEmailChange(db,first.token,202),confirmEmailChange(db,second.token,202)]);
  assert.equal(result.filter(Boolean).length,1);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE seller_id=(SELECT id FROM gear_sellers WHERE email='dest@example.test') AND status IN ('available','pending')").get().n,10);
 }finally{db.close();}
});

test('HTTP email change requires Origin, cookie and CSRF; scanner GET and unconfirmed POST do nothing',async()=>{
 const db=openLocalDatabase();await publish(db,{},Date.now());const access=await login(db,input.email,Date.now());
 const server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)});
 const headers={Cookie:'gear_session='+access.session,'X-Gear-CSRF':access.csrf};
 try{
  for(const path of ['/management/email-change','/management/email-change/confirm']){
   const noOrigin=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({email:'new@example.test',confirm:true})});
   assert.equal(noOrigin.status,403);
  }
  assert.equal((await post('/management/email-change',{email:'new@example.test'})).status,403);
  assert.equal((await post('/management/email-change',{email:'new@example.test'},{...headers,Origin:'https://example.test'})).status,403);
  assert.equal((await post('/management/email-change',{email:'bad'},headers)).status,400);
  const request=await post('/management/email-change',{email:'new@example.test'},headers);assert.equal(request.status,200);assert.equal((await request.json()).token,undefined);
  const {receipts}=await(await fetch(base+'/local/email-change-mail')).json();const token=receipts[0].token;
  const before=rows(db);assert.equal((await fetch(base+'/management/email-change/confirm?token='+token)).status,200);
  assert.equal((await post('/management/email-change/confirm',{token})).status,400);assert.equal(rows(db),before);
  assert.equal((await post('/management/email-change/confirm',{token,confirm:true},{Origin:'null'})).status,403);
  db.sqlite.exec("CREATE TRIGGER fail_http_transfer BEFORE UPDATE OF revoked_at ON gear_management_sessions BEGIN SELECT RAISE(ABORT,'private injected failure'); END;");
  const logged=console.error;const errors=[];console.error=(...args)=>errors.push(args);
  try {
   const failed=await post('/management/email-change/confirm',{token,confirm:true});
   assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:'Unable to process the request.'});
   assert.equal(errors.length,1);assert.equal(rows(db),before);
  }finally{console.error=logged;db.sqlite.exec('DROP TRIGGER fail_http_transfer');}
  const confirmed=await post('/management/email-change/confirm',{token,confirm:true});
  assert.equal(confirmed.status,200);assert.equal(confirmed.headers.get('set-cookie'),null);
  assert.equal((await post('/management/email-change/confirm',{token,confirm:true})).status,400);
 }finally{await new Promise(r=>server.close(r));db.close();}
});

test('transfer preserves inactive states, never verifies destination drafts, and requires a live originating session',async()=>{
 const db=openLocalDatabase();try{
  const ids=[];
  for(const status of ['pending','closed','expired','removed']){
   const id=await publish(db,{title:status});ids.push(id);
   db.sqlite.prepare('UPDATE gear_listings SET status=? WHERE id=?').run(status,id);
  }
  const draft=await createDraft(db,{...input,email:'dest@example.test',title:'Not verified'});
  const access=await login(db),receipt=await issueLocalEmailChange(db,access.session,access.csrf,'dest@example.test',201);
  assert.equal(await confirmEmailChange(db,receipt.token,201+EMAIL_CHANGE_TTL_MS-1),true);
  const dest=await login(db,'dest@example.test',201+EMAIL_CHANGE_TTL_MS);
  const managed=await listManaged(db,dest.session,202+EMAIL_CHANGE_TTL_MS);
  assert.deepEqual(new Set(managed.map(r=>r.id)),new Set(ids));
  assert.deepEqual(new Set(managed.map(r=>r.status)),new Set(['pending','closed','expired','removed']));
  assert.equal(db.sqlite.prepare('SELECT verified_at FROM gear_listings WHERE id=?').get(draft.id).verified_at,null);
  const late=await issueLocalEmailChange(db,dest.session,dest.csrf,'third@example.test',dest.expiresAt-1);
  assert.equal(await confirmEmailChange(db,late.token,dest.expiresAt),false);
  assert.equal(await issueLocalEmailChange(db,dest.session,dest.csrf,'third@example.test',dest.expiresAt),null);
 }finally{db.close();}
});
