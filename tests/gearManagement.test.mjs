import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';
import { localServer } from '../scripts/gear/local-server.mjs';
import { createDraft } from '../lib/gear-storage.mjs';
import { issueLocalVerification, confirmVerification } from '../lib/gear-verification.mjs';
import { issueLocalManagementLink, redeemManagementLink, listManaged, revokeManagement, changeListingState, editManagedListing, MANAGEMENT_TTL_MS, RECOVERY_TTL_MS } from '../lib/gear-management.mjs';
import { LIMITS } from '../lib/gear-exchange.mjs';
const input={title:'Bag',description:'Worn zipper',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'sample@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]};
async function publish(db,patch={},now=100){const {id}=await createDraft(db,{...input,...patch},now);const receipt=await issueLocalVerification(db,id,now);assert.equal((await confirmVerification(db,receipt.token,now)).verified,true);return id;}
async function login(db,email=input.email,now=200){const receipt=await issueLocalManagementLink(db,email,now);return redeemManagementLink(db,receipt.token,now);}

test('session grants verified listings only, hashes credentials and enforces expiry/CSRF/owner',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),other=await publish(db,{email:'other@example.test'});
  const draft=await createDraft(db,{...input,title:'Unverified'});
  const access=await login(db);
  assert.deepEqual((await listManaged(db,access.session,201)).map(r=>r.id),[id]);
  const rows=JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_management_sessions').all());assert.equal(rows.includes(access.session),false);assert.equal(rows.includes(access.csrf),false);
  for(const target of [other,draft.id])assert.equal(await changeListingState(db,access.session,access.csrf,target,'close',201),false);
  assert.equal(await changeListingState(db,access.session,'bad',id,'close',201),false);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'pending',201),true);
  assert.equal(await listManaged(db,access.session,200+MANAGEMENT_TTL_MS),null);
 }finally{db.close();}
});
test('reissue and redemption revoke old links and sessions; listing tokens cannot log in',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db);const first=await login(db);
  const old=await issueLocalManagementLink(db,input.email,300),fresh=await issueLocalManagementLink(db,input.email,400);
  assert.equal(await redeemManagementLink(db,old.token,401),null);
  assert.ok(await listManaged(db,first.session,401)); // requesting alone cannot log owner out
  const second=await redeemManagementLink(db,fresh.token,500);
  assert.equal(await listManaged(db,first.session,501),null);
  assert.equal(await redeemManagementLink(db,fresh.token,501),null);
  assert.ok(await listManaged(db,second.session,501));
  assert.equal(await revokeManagement(db,second.session,second.csrf,502),true);
  assert.equal(await listManaged(db,second.session,503),null);
  const expiring=await issueLocalManagementLink(db,input.email,600);
  assert.equal(await redeemManagementLink(db,expiring.token,600+RECOVERY_TTL_MS),null);
  const draft=await createDraft(db,{...input,title:'Fresh'}),verification=await issueLocalVerification(db,draft.id,600);
  assert.equal(await redeemManagementLink(db,verification.token,601),null);
  assert.equal(await issueLocalManagementLink(db,'unknown@example.test',600),null);
 }finally{db.close();}
});
test('edit preserves status/expiry/owner, updates clubs atomically and prevents duplicates',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),second=await publish(db,{title:'Second bag'}),access=await login(db);
  const before=db.sqlite.prepare('SELECT * FROM gear_listings WHERE id=?').get(id);
  assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...input,email:'other@example.test'},201),false);
  assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...input,title:'Second bag'},201),false);
  assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...input,title:'Updated',clubs:['Other'],otherClub:'Example',status:'removed',expires_at:1},201),true);
  const after=db.sqlite.prepare('SELECT * FROM gear_listings WHERE id=?').get(id);
  assert.equal(after.status,before.status);assert.equal(after.expires_at,before.expires_at);assert.equal(after.seller_id,before.seller_id);
  assert.deepEqual((await listManaged(db,access.session,202)).find(r=>r.id===id).clubs,['Other']);
  db.sqlite.exec("CREATE TRIGGER fail_club BEFORE INSERT ON gear_listing_clubs BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(editManagedListing(db,access.session,access.csrf,id,{...input,title:'Should rollback',clubs:['Kent Valley']},203));
  assert.equal(db.sqlite.prepare('SELECT title FROM gear_listings WHERE id=?').get(id).title,'Updated');
 }finally{db.close();}
});
test('close/relist enforce quota, duplicates and removed state without replay renewal',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),access=await login(db);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'close',201),true);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',202),true);
  const expires=db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at;
  assert.equal(expires,202+LIMITS.durationDays*86400000);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',203),false);
  await changeListingState(db,access.session,access.csrf,id,'close',204);
  for(let i=0;i<LIMITS.activeListings;i++)await publish(db,{title:'Quota '+i},205);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',206),false);
  db.sqlite.prepare("UPDATE gear_listings SET status='removed' WHERE id=?").run(id);
  assert.equal(await editManagedListing(db,access.session,access.csrf,id,input,207),false);
 }finally{db.close();}
});
test('HTTP recovery is generic; confirmation sets secure cookie; mutations require Origin and CSRF',async()=>{
 const db=openLocalDatabase();await publish(db,{},Date.now());const server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)});
 try{
  const unknown=await (await post('/management/recovery',{email:'unknown@example.test'})).json();
  const known=await (await post('/management/recovery',{email:input.email})).json();assert.deepEqual(known,unknown);
  const {receipts}=await(await fetch(base+'/local/management-mail')).json();const token=receipts[0].token;
  assert.equal((await fetch(base+'/management/confirm')).status,200);
  assert.equal((await post('/management/confirm',{token})).status,400);
  const response=await post('/management/confirm',{token,confirm:true});assert.equal(response.status,200);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);assert.ok(cookie.includes('Max-Age='+MANAGEMENT_TTL_MS/1000));const access=await response.json();assert.equal(access.session,undefined);
  const headers={Cookie:cookie.split(';')[0]};const listingResponse=await fetch(base+'/management/listings',{headers});assert.equal(listingResponse.status,200);const {listings}=await listingResponse.json();
  assert.equal((await post('/management/listing',{id:listings[0].id,action:'pending'},headers)).status,403);
  assert.equal((await post('/management/listing',{id:listings[0].id,action:'pending'},{...headers,'X-Gear-CSRF':access.csrf,Origin:'https://example.test'})).status,403);
  assert.equal((await post('/management/listing',{id:listings[0].id,action:'pending'},{...headers,'X-Gear-CSRF':access.csrf})).status,200);
  assert.equal((await post('/management/logout',{}, {...headers,'X-Gear-CSRF':access.csrf})).status,200);
  assert.equal((await fetch(base+'/management/listings',{headers})).status,401);
 }finally{await new Promise(r=>server.close(r));db.close();}
});

test('failed recovery redemption rolls back revocation and token consumption',async()=>{
 const db=openLocalDatabase();try{
  await publish(db);const old=await login(db);const link=await issueLocalManagementLink(db,input.email,300);
  db.sqlite.exec("CREATE TRIGGER fail_session BEFORE INSERT ON gear_management_sessions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(redeemManagementLink(db,link.token,400));
  assert.ok(await listManaged(db,old.session,401));
  assert.equal(db.sqlite.prepare('SELECT consumed_at FROM gear_management_links').get().consumed_at,null);
 }finally{db.close();}
});

test('write authorization rejects foreign/unverified records and missing, revoked or expired credentials',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),other=await publish(db,{email:'other@example.test'});
  const draft=await createDraft(db,{...input,title:'Unverified'}),access=await login(db);
  for(const target of [other,draft.id])assert.equal(await editManagedListing(db,access.session,access.csrf,target,input,201),false);
  for(const csrf of [null,undefined,'']){
   assert.equal(await editManagedListing(db,access.session,csrf,id,input,201),false);
   assert.equal(await changeListingState(db,access.session,csrf,id,'close',201),false);
   assert.equal(await revokeManagement(db,access.session,csrf,201),false);
  }
  const stored=db.sqlite.prepare('SELECT created_at,expires_at FROM gear_management_sessions').get();
  assert.equal(stored.expires_at-stored.created_at,MANAGEMENT_TTL_MS);
  assert.equal(access.expiresAt,stored.expires_at);
  // Session and listing both normally last 30 days. Keep this record live a
  // little longer so the boundary below isolates session authorization.
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=expires_at+1000 WHERE id=?').run(id);
  assert.ok(await listManaged(db,access.session,access.expiresAt-1));
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'pending',access.expiresAt-1),true);
  for(const now of [access.expiresAt,access.expiresAt+1]){
   assert.equal(await editManagedListing(db,access.session,access.csrf,id,input,now),false);
   assert.equal(await changeListingState(db,access.session,access.csrf,id,'close',now),false);
  }
  const fresh=await login(db,input.email,access.expiresAt+2);
  assert.equal(await revokeManagement(db,fresh.session,fresh.csrf,access.expiresAt+3),true);
  assert.equal(await editManagedListing(db,fresh.session,fresh.csrf,id,input,access.expiresAt+4),false);
  assert.equal(await changeListingState(db,fresh.session,fresh.csrf,id,'close',access.expiresAt+4),false);
 }finally{db.close();}
});

test('recovery rejects changed mailbox and edits normalize only the existing email',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),access=await login(db);
  assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...input,email:'  SAMPLE@Example.test  '},201),true);
  for(const email of [null,7,'different@example.test'])assert.equal(await editManagedListing(db,access.session,access.csrf,id,{...input,email},202),false);
  const link=await issueLocalManagementLink(db,input.email,300);
  db.sqlite.prepare('UPDATE gear_sellers SET email=? WHERE email=?').run('new@example.test',input.email);
  assert.equal(await redeemManagementLink(db,link.token,301),null);
  assert.equal(db.sqlite.prepare('SELECT consumed_at FROM gear_management_links').get().consumed_at,null);
 }finally{db.close();}
});

test('relist rejects active duplicates and renews time-expired records without a restart',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db),access=await login(db);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'pending',201),true);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'available',202),true);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'close',203),true);
  const match=await publish(db,{},204);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',205),false);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(id).status,'closed');
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(206,match);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',206),true);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(match).status,'expired');
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id=?').run(207,id);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'available',207),false);
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'relist',207),true);
  assert.equal(db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(id).expires_at,207+LIMITS.durationDays*86400000);
 }finally{db.close();}
});

test('stale duplicate cleanup is owner guarded and rolls back with a failed edit',async()=>{
 const db=openLocalDatabase();try{
  const id=await publish(db,{title:'Target'}),stale=await publish(db),foreign=await publish(db,{email:'other@example.test'}),access=await login(db);
  db.sqlite.prepare('UPDATE gear_listings SET expires_at=? WHERE id IN (?,?)').run(201,stale,foreign);
  const otherAccess=await login(db,'other@example.test',200);
  for(const wrongCSRF of ['0'.repeat(64),otherAccess.csrf]){
   assert.equal(await editManagedListing(db,access.session,wrongCSRF,id,input,202),false);
   assert.equal(await changeListingState(db,access.session,wrongCSRF,stale,'relist',202),false);
   assert.equal(await revokeManagement(db,access.session,wrongCSRF,202),false);
   assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(stale).status,'available');
   assert.equal(db.sqlite.prepare('SELECT title FROM gear_listings WHERE id=?').get(id).title,'Target');
   assert.ok(await listManaged(db,access.session,202));
  }
  assert.equal(await editManagedListing(db,access.session,'bad',id,input,202),false);
  assert.equal(await editManagedListing(db,access.session,access.csrf,foreign,input,202),false);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(stale).status,'available');
  db.sqlite.exec("CREATE TRIGGER fail_edit BEFORE UPDATE OF title ON gear_listings BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(editManagedListing(db,access.session,access.csrf,id,input,202));
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(stale).status,'available');
  assert.equal(db.sqlite.prepare('SELECT title FROM gear_listings WHERE id=?').get(id).title,'Target');
  db.sqlite.exec('DROP TRIGGER fail_edit');
  assert.equal(await editManagedListing(db,access.session,access.csrf,id,input,203),true);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(stale).status,'expired');
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(foreign).status,'available');
 }finally{db.close();}
});

test('HTTP rejects missing Origin, duplicate cookies and missing logout CSRF; validates edits',async()=>{
 const db=openLocalDatabase();await publish(db,{},Date.now());const server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  for(const path of ['/management/recovery','/management/confirm'])assert.equal((await post(path,{email:input.email,confirm:true})).status,403);
  await post('/management/recovery',{email:input.email},{Origin:base});
  const {receipts}=await(await fetch(base+'/local/management-mail')).json();
  const response=await post('/management/confirm',{token:receipts[0].token,confirm:true},{Origin:base});
  const cookie=response.headers.get('set-cookie').split(';')[0],access=await response.json();
  const headers={Origin:base,Cookie:cookie,'X-Gear-CSRF':access.csrf};
  assert.equal((await fetch(base+'/management/listings',{headers:{Cookie:cookie+'; '+cookie}})).status,401);
  assert.equal((await post('/management/logout',{}, {Origin:base,Cookie:cookie})).status,403);
  const {listings}=await(await fetch(base+'/management/listings',{headers})).json();
  const body={id:listings[0].id,action:'edit',listing:{...input,title:'HTTP edit'}};
  assert.equal((await post('/management/listing',body,headers)).status,200);
  const invalid=await post('/management/listing',{...body,listing:{...input,title:''}},headers);
  assert.equal(invalid.status,400);assert.ok((await invalid.json()).fields);
  assert.equal(db.sqlite.prepare('SELECT title FROM gear_listings WHERE id=?').get(body.id).title,'HTTP edit');
 }finally{await new Promise(r=>server.close(r));db.close();}
});

test('session bootstrap recovers stable CSRF without extending expiry, reviving logout or storing raw secrets',async()=>{
 const {recoverManagementSession}=await import('../lib/gear-management.mjs');
 const db=openLocalDatabase();try{
  const id=await publish(db),access=await login(db);
  const first=await recoverManagementSession(db,access.session,201),second=await recoverManagementSession(db,access.session,202);
  assert.deepEqual(first,{csrf:access.csrf,expiresAt:access.expiresAt});assert.deepEqual(second,first);
  assert.equal(await changeListingState(db,access.session,first.csrf,id,'pending',203),true);
  assert.equal(await recoverManagementSession(db,'0'.repeat(64),204),null);
  assert.equal(await recoverManagementSession(db,access.session,199),null);
  assert.equal(await recoverManagementSession(db,access.session,access.expiresAt),null);
  assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_management_sessions').all()).includes(first.csrf),false);
  assert.equal(await revokeManagement(db,access.session,first.csrf,205),true);
  assert.equal(await recoverManagementSession(db,access.session,206),null);
 }finally{db.close();}
});

test('legacy sessions bootstrap once; HTTP bootstrap requires Origin and a unique cookie and grants no session',async()=>{
 const db=openLocalDatabase();const id=await publish(db,{},Date.now());const access=await login(db,input.email,Date.now());
 db.sqlite.prepare('UPDATE gear_management_sessions SET csrf_hash=?').run('legacy-random-csrf-hash');
 const server=localServer(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const cookie='gear_session='+access.session;
 const post=headers=>fetch(base+'/management/session',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:'{}'});
 try{
  assert.equal(await changeListingState(db,access.session,access.csrf,id,'pending'),false);
  const before=JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_management_sessions').all());
  assert.equal((await fetch(base+'/management/session',{headers:{Cookie:cookie}})).status,404);
  for(const Origin of [undefined,'null','http://127.0.0.1:1']){
   assert.equal((await post({Cookie:cookie,...(Origin?{Origin}:{})})).status,403);
  }
  assert.equal(JSON.stringify(db.sqlite.prepare('SELECT * FROM gear_management_sessions').all()),before);
  assert.equal((await post({Origin:base})).status,401);
  assert.equal((await post({Origin:base,Cookie:cookie+'; '+cookie})).status,401);
  const response=await post({Origin:base,Cookie:cookie});assert.equal(response.status,200);
  assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('cache-control'),'no-store');
  const recovered=await response.json();assert.deepEqual(recovered,{csrf:access.csrf,expiresAt:access.expiresAt});
  assert.equal(await changeListingState(db,access.session,recovered.csrf,id,'pending'),true);
  assert.notEqual(db.sqlite.prepare('SELECT csrf_hash FROM gear_management_sessions').get().csrf_hash,'legacy-random-csrf-hash');
 }finally{await new Promise(r=>server.close(r));db.close();}
});
