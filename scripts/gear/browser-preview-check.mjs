// Optional connected-preview check using an existing external Playwright runtime.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openLocalDatabase} from './local-db.mjs';
import {createDraft,readPublicListings} from '../../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../../lib/gear-verification.mjs';
import {localServer} from './local-server.mjs';
if(!process.env.GEAR_PLAYWRIGHT_MODULE)throw new Error('Set GEAR_PLAYWRIGHT_MODULE to an installed Playwright module.');
const {chromium}=createRequire(import.meta.url)(process.env.GEAR_PLAYWRIGHT_MODULE);
const temp=mkdtempSync(join(tmpdir(),'gear-preview-check-'));let db,server,browser;let cleanupPromise;
function cleanup(){return cleanupPromise??=Promise.allSettled([Promise.resolve().then(()=>browser?.close()),Promise.resolve().then(()=>server&&new Promise(r=>{server.close(r);server.closeAllConnections();}))]).then(()=>{try{db?.close();}finally{rmSync(temp,{recursive:true,force:true});}});}
function listen(server,port=0){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});}
const interrupt=()=>cleanup().finally(()=>process.exit(130));process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
 const tls={key:readFileSync(join(temp,'key.pem')),cert:readFileSync(join(temp,'cert.pem'))};
 db=openLocalDatabase(join(temp,'sample.sqlite'));server=localServer(db,{tls,preview:true});await listen(server);const base=`https://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1040,height:900}});const page=await context.newPage();const errors=[],consoleErrors=[];
 const monitor=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),url:m.location().url});});};monitor(page);
 const idle=()=>page.waitForFunction(()=>document.querySelector('#pi-gear-preview')?.dataset.localApi==='true'&&!document.querySelector('#pi-gear-preview').hasAttribute('aria-busy')&&document.querySelector('#pi-local-login'));
 await page.goto(base+'/gear/');await idle();assert.equal(await page.locator('#pi-count').textContent(),'0 listings');
 await page.locator('#pi-gear-rules summary').click();
 for(const width of [1040,390,320]){
  await page.setViewportSize({width,height:900});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'expanded rules overflow');
  assert.equal(await page.locator('#pi-gear-rules p').first().isVisible(),true);
  if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-rules-'+width+'.png',fullPage:true});
 }
 await page.locator('#pi-gear-rules summary').click();await page.setViewportSize({width:1040,height:900});

 for(const path of ['/scripts/gear/local-server.mjs','/instructions/gear-management.md','/.git/config','/sample.sqlite'])assert.equal((await context.request.get(base+path)).status(),404);
 assert.equal(await page.locator('link[href*="googleapis"]').count(),0);
 await page.locator('[data-screen="post"]').click();await page.locator('#pi-fill-demo').click();
 await page.locator('#pi-next-photos').click();assert.equal(await page.locator('#pi-photo-files').isDisabled(),true);
 await page.locator('#pi-next-review').click();await page.locator('#pi-post-submit').click();await idle();
 assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE status='unverified'").get().n,1);
 assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE status='available'").get().n,0);
 await page.locator('#pi-simulate-verify').click();await idle();assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE status='available'").get().n,1);
 assert.equal(await page.locator('.pi-managed-item').count(),0);assert.equal((await context.cookies()).some(c=>c.name==='gear_session'),false);
 await page.locator('#pi-recovery-send').click();await idle();await page.locator('#pi-local-login').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),1);
 // Persist real sanitized image pixels through the connected management UI.
 const imageBuffer=await page.screenshot();
 await page.locator('[data-manage="photos"]').click();
 await page.locator('#pi-stored-upload').setInputFiles({name:'sample.png',mimeType:'image/png',buffer:imageBuffer});await idle();
 await page.locator('#pi-stored-upload').setInputFiles({name:'second.png',mimeType:'image/png',buffer:imageBuffer});await idle();
 assert.equal(await page.locator('#pi-stored-photos img').count(),2);
 const photoListing=db.sqlite.prepare("SELECT id FROM gear_listings WHERE status='available'").get().id;
 const storedPhoto=db.sqlite.prepare('SELECT id FROM gear_local_photos ORDER BY position DESC LIMIT 1').get().id;
 await page.locator('[data-photo-action="main"]').last().click();await idle();assert.equal(await page.locator('#pi-stored-photos img').first().getAttribute('src'),'/management/photos/'+storedPhoto);
 await page.locator('[data-photo-action="remove"]').last().click();await idle();assert.equal(await page.locator('#pi-stored-photos img').count(),1);
 assert.equal((await context.request.get(base+'/photos/'+storedPhoto)).status(),200);
 assert.equal((await context.request.post(base+'/management/photos',{data:{id:photoListing,action:'remove',photoId:storedPhoto}})).status(),403);
 assert.equal((await context.request.post(base+'/management/photos',{headers:{Origin:base,'X-Gear-CSRF':'0'.repeat(64)},data:{id:photoListing,action:'remove',photoId:storedPhoto}})).status(),403);
 const anonymous=await browser.newContext({ignoreHTTPSErrors:true});assert.equal((await anonymous.request.get(base+'/management/photos/'+storedPhoto)).status(),404);await anonymous.close();
 for(const width of [1040,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'photo manager overflow');}
 if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-photos.png',fullPage:true});
 await page.setViewportSize({width:1040,height:900});
 await page.reload();await idle();await page.locator('[data-screen="manage"]').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),1);
 // Repeated gear is rejected at confirmation; it never becomes a second public row.
 await page.locator('[data-screen="post"]').click();await page.locator('#pi-fill-demo').click();await page.locator('#pi-next-photos').click();await page.locator('#pi-next-review').click();await page.locator('#pi-post-submit').click();await idle();await page.locator('#pi-simulate-verify').click();await idle();
 assert.equal(await page.locator('#pi-local-notice').isVisible(),true);assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE status='available'").get().n,1);
 await page.locator('[data-screen="manage"]').click();await idle();

 await page.locator('[data-manage="edit"]').click();assert.equal(await page.locator('#pi-post-email').isDisabled(),true);await page.locator('#pi-post-name').fill('Updated club bag');await page.locator('#pi-next-photos').click();await page.locator('#pi-next-review').click();await page.route('**/management/listing',route=>route.abort());await page.locator('#pi-post-submit').click();await idle();assert.equal(await page.locator('#pi-local-notice').isVisible(),true);assert.equal(await page.locator('#pi-post-name').inputValue(),'Updated club bag');
 await page.unroute('**/management/listing');await page.locator('#pi-post-submit').click();await idle();assert.equal(db.sqlite.prepare("SELECT title FROM gear_listings WHERE status='available'").get().title,'Updated club bag');
 const port=server.address().port;await new Promise(r=>{server.close(r);server.closeAllConnections();});db.close();db=null;db=openLocalDatabase(join(temp,'sample.sqlite'));server=localServer(db,{tls,preview:true});await listen(server,port);
 await page.reload();await idle();await page.locator('[data-screen="manage"]').click();await idle();assert.equal(await page.locator('.pi-managed-item h3').textContent(),'Updated club bag');assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_local_photos').get().n,1);assert.equal((await context.request.get(base+'/photos/'+storedPhoto)).status(),200);
 await page.locator('[data-manage="pending"]').click();await idle();assert.equal(db.sqlite.prepare("SELECT status FROM gear_listings WHERE title='Updated club bag'").get().status,'pending');
 await page.locator('[data-manage="close"]').click();await idle();assert.equal(db.sqlite.prepare("SELECT status FROM gear_listings WHERE title='Updated club bag'").get().status,'closed');assert.equal((await context.request.get(base+'/photos/'+storedPhoto)).status(),404);assert.equal((await context.request.get(base+'/management/photos/'+storedPhoto)).status(),200);
 await page.locator('[data-manage="renew"]').click();await idle();assert.equal(db.sqlite.prepare("SELECT status FROM gear_listings WHERE title='Updated club bag'").get().status,'available');
 await page.locator('[data-screen="gear"]').click();await idle();assert.equal(await page.locator('#pi-count').textContent(),'1 listing');await page.locator('[data-listing]').click();assert.equal(await page.locator('#pi-detail-title').textContent(),'Updated club bag');assert.equal(await page.locator('.pi-photo-stage img').count(),1);assert.equal(await page.locator('.pi-photo-stage img').evaluate(el=>el.complete&&el.naturalWidth>0),true);
 // Buyer contact: validation, failed-request recovery, local sink, and responsive form.
 await page.locator('#pi-contact-open').click();
 await page.locator('#pi-buyer-name').fill('Buyer');await page.locator('#pi-buyer-email').fill('buyer@example.test');await page.locator('#pi-buyer-message').fill('<b>Sample inquiry</b>');
 assert.equal((await(await context.request.get(base+'/local/contact-mail')).json()).receipts.length,0);
 await page.route('**/contact',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Unable to process the request.'})}));
 await page.locator('#pi-preview-send').click();await idle();assert.equal(await page.locator('#pi-buyer-message').inputValue(),'<b>Sample inquiry</b>');assert.equal(await page.locator('#pi-contact-success').isVisible(),false);
 await page.unroute('**/contact');
 for(const width of [1040,390,320]){
  await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'contact overflow at '+width);
  if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-contact-'+width+'.png',fullPage:true});
 }
 await page.locator('#pi-preview-send').click();await idle();assert.equal(await page.locator('#pi-contact-success').isVisible(),true);assert.equal(await page.locator('#pi-contact-success h2').textContent(),'Message saved locally');assert.equal(await page.locator('#pi-contact-again').evaluate(el=>el===document.activeElement),true);
 const contactMail=(await(await context.request.get(base+'/local/contact-mail')).json()).receipts;
 assert.equal(contactMail.length,1);assert.equal(contactMail[0].message,'<b>Sample inquiry</b>');assert.equal(contactMail[0].listingId,photoListing);
 await page.locator('#pi-contact-again').click();assert.equal(await page.locator('#pi-buyer-message').inputValue(),'');
 await page.locator('#pi-contact-cancel').click();await page.setViewportSize({width:1040,height:900});
 // Local reports: real validation/unavailable responses, retry, single pending write, and queue inspection.
 await page.locator('#pi-report-open').click();assert.match(await page.locator('#pi-report-note').textContent(),/Local preview only/);assert.equal(await page.locator('#pi-report-turnstile-status').textContent(),'');await page.locator('#pi-preview-report').click();await idle();
 assert.equal((await(await context.request.get(base+'/local/reports')).json()).reports.length,0);
 await page.locator('#pi-report-reason').selectOption('Misleading listing');
 db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").run(photoListing);
 await page.locator('#pi-preview-report').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/no longer available to report/);assert.equal(await page.locator('#pi-report-reason').inputValue(),'Misleading listing');assert.equal(await page.locator('#pi-report-result').isVisible(),false);
 db.sqlite.prepare("UPDATE gear_listings SET status='available' WHERE id=?").run(photoListing);
 await page.route('**/reports',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Unable to process the request.'})}));
 await page.locator('#pi-preview-report').click();await idle();assert.equal(await page.locator('#pi-report-reason').inputValue(),'Misleading listing');assert.equal(await page.locator('#pi-report-result').isVisible(),false);await page.unroute('**/reports');
 for(const width of [1040,390,320]){
  await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'report overflow at '+width);
  if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-report-'+width+'.png',fullPage:true});
 }
 let releaseReport,reportCalls=0;const reportGate=new Promise(r=>releaseReport=r);
 await page.route('**/reports',async route=>{reportCalls++;await reportGate;await route.continue();});
 await page.locator('#pi-preview-report').click();await page.waitForFunction(()=>document.querySelector('#pi-report-reason').disabled);
 await page.locator('#pi-preview-report').evaluate(el=>{el.click();el.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
 releaseReport();await idle();await page.unroute('**/reports');assert.equal(reportCalls,1);
 assert.equal(await page.locator('#pi-report-result').isVisible(),true);assert.match(await page.locator('#pi-report-result').textContent(),/saved to the local review queue/);assert.equal(await page.locator('#pi-report-result').evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('#pi-report-reason').inputValue(),'');
 const queuedReports=(await(await context.request.get(base+'/local/reports')).json()).reports;assert.equal(queuedReports.length,1);assert.equal(queuedReports[0].listingId,photoListing);assert.equal(queuedReports[0].reason,'Misleading listing');assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(photoListing).status,'available');
 await context.request.post(base+'/reports',{headers:{Origin:base},data:{id:photoListing,reason:'Other concern'}});
 await page.locator('[data-screen="gear"]').click();await page.locator('[data-listing]').click();await page.locator('#pi-report-open').click();assert.equal(await page.locator('#pi-report-result').isVisible(),false);
 await page.locator('#pi-report-reason').selectOption('Other concern');await page.locator('#pi-preview-report').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/Too many report attempts/);assert.equal(await page.locator('#pi-report-reason').inputValue(),'Other concern');
 await page.locator('#pi-report-cancel').click();assert.equal(await page.locator('#pi-report-reason').inputValue(),'');await page.setViewportSize({width:1040,height:900});
 if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-desktop.png',fullPage:true});
 // Mobile overflow and view rendering; browser console exceptions must remain empty.
 for(const width of [390,320]){await page.setViewportSize({width,height:900});for(const screen of ['gear','detail','post','manage']){await page.locator('[data-screen="'+screen+'"]').click();await idle();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),screen+' overflow at '+width);}}
 if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-mobile.png',fullPage:true});
 // Local seller deletion/recovery hides content immediately and preserves expiry.
 await page.locator('[data-screen="manage"]').click();await idle();const beforeDeleteExpiry=db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(photoListing).expires_at;
 // Failed delete must dismiss the modal so the error is visible and receives focus.
 await page.route('**/management/deletion',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'This listing cannot be recovered or changed. Refresh and check its recovery deadline.'})}));
 for(const width of [1040,390]){
  await page.setViewportSize({width,height:900});
  await page.locator('[data-manage="delete"]').first().click();
  assert.match(await page.locator('#pi-delete-dialog').textContent(),/authorized moderators can still review listing text/);
  assert.ok(await page.locator('#pi-delete-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'delete dialog overflow');
  await page.locator('#pi-delete-confirm').click();await idle();
  assert.equal(await page.locator('#pi-delete-dialog').evaluate(el=>el.open),false);
  assert.equal(await page.locator('#pi-local-notice').isVisible(),true);
  assert.match(await page.locator('#pi-local-notice').textContent(),/cannot be recovered or changed/);
  assert.equal(await page.locator('#pi-local-notice').evaluate(el=>el===document.activeElement),true);
  assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(photoListing).status,'available');
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_local_deletions WHERE listing_id=?').get(photoListing).n,0);
 }
 await page.unroute('**/management/deletion');
 await page.locator('[data-manage="delete"]').first().click();await page.locator('#pi-delete-confirm').click();await idle();assert.equal(await page.locator('#pi-managed-list .pi-managed-item').count(),0);assert.equal(await page.locator('[data-recover]').count(),1);assert.equal((await context.request.get(base+'/photos/'+storedPhoto)).status(),404);assert.equal((await context.request.get(base+'/management/photos/'+storedPhoto)).status(),404);
 for(const width of [1040,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'deletion overflow');if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-deleted-'+width+'.png',fullPage:true});}
 await page.reload();await idle();await page.locator('[data-screen="manage"]').click();await page.locator('[data-recover]').click();await idle();assert.equal(await page.locator('#pi-managed-list .pi-managed-item').count(),1);assert.equal(await page.locator('[data-recover]').count(),0);assert.equal(db.sqlite.prepare('SELECT expires_at FROM gear_listings WHERE id=?').get(photoListing).expires_at,beforeDeleteExpiry);
 await page.locator('#pi-local-logout').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),0);assert.equal((await context.cookies()).some(c=>c.name==='gear_session'),false);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_sessions WHERE revoked_at IS NULL').get().n,0);
 await page.reload();await idle();await page.locator('[data-screen="manage"]').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),0);
 // Review regressions: validation, reissue, partial success, stale identity, other offers and auth loss.
 await page.setViewportSize({width:390,height:900});
 async function prepare(title,type='Free',email='edge@example.test'){
  await page.locator('[data-screen="post"]').click();await page.locator('#pi-fill-demo').click();await page.locator('#pi-post-name').fill(title);await page.locator('input[name="offer"][value="'+type+'"]').check();
  if(type==='Trade')await page.locator('#pi-post-trade').fill('Larger gear');
  await page.locator('#pi-other-club').fill('Custom Club');await page.locator('#pi-next-photos').click();await page.locator('#pi-post-email').fill(email);await page.locator('#pi-next-review').click();
 }
 await prepare('<b>Free gear</b>','Free','parent@gmail');await page.locator('#pi-post-submit').click();await idle();
 assert.equal(await page.locator('[data-post-step="2"]').isVisible(),true);assert.ok(await page.locator('#pi-post-email').evaluate(el=>el.validationMessage));
 await page.locator('#pi-post-email').fill('edge@example.test');await page.locator('#pi-next-review').click();await page.locator('#pi-post-submit').click();await idle();
 const freeId=db.sqlite.prepare('SELECT id FROM gear_listings WHERE title=?').get('<b>Free gear</b>').id;
 db.sqlite.prepare('UPDATE gear_verification_tokens SET expires_at=? WHERE listing_id=?').run(Date.now()-1,freeId);
 await page.locator('#pi-simulate-verify').click();await idle();
 let box=await page.locator('#pi-local-notice').boundingBox();assert.ok(box.y>=0&&box.y<900,'error must be in viewport');
 await page.locator('#pi-local-reissue').click();await idle();assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_listings WHERE title=?').get('<b>Free gear</b>').n,1);
 await page.route('**/listings',r=>r.abort());await page.locator('#pi-simulate-verify').click();await idle();
 assert.equal(await page.locator('#pi-verify-screen').isVisible(),false);assert.match(await page.locator('#pi-manage-feedback').textContent(),/Listing published locally/);assert.match(await page.locator('#pi-local-notice').textContent(),/Listing published locally/);
 await page.unroute('**/listings');await page.locator('[data-screen="manage"]').click();await idle();
 await page.locator('#pi-recovery-send').click();await idle();await page.locator('#pi-recovery-email').fill('changed@example.test');assert.equal(await page.locator('#pi-local-login').isVisible(),false);
 await page.locator('#pi-recovery-email').fill('edge@example.test');await page.locator('#pi-recovery-send').click();await idle();assert.match(await page.locator('#pi-local-login').textContent(),/edge@example.test/);await page.locator('#pi-local-login').click();await idle();
 assert.equal(await page.locator('.pi-managed-item h3').textContent(),'<b>Free gear</b>');assert.equal(await page.locator('.pi-managed-item h3 b').count(),0);
 assert.deepEqual(db.sqlite.prepare('SELECT type,price_cents FROM gear_listings WHERE id=?').get(freeId),Object.assign(Object.create(null),{type:'free',price_cents:0}));
 await prepare('Trade gear','Trade');await page.locator('#pi-post-submit').click();await idle();
 await page.route('**/verification/confirm',async route=>{await route.fetch();await route.abort();});await page.locator('#pi-simulate-verify').click();await idle();await page.unroute('**/verification/confirm');
 assert.equal(await page.locator('#pi-verify-screen').isVisible(),false);assert.equal(db.sqlite.prepare("SELECT price_cents FROM gear_listings WHERE title='Trade gear'").get().price_cents,null);
 await page.locator('[data-manage="edit"]').first().click();await page.locator('#pi-next-photos').click();assert.equal(await page.locator('#pi-post-email').isVisible(),false);assert.equal(await page.locator('.pi-contact-fields > .pi-field-help').isVisible(),false);assert.equal(await page.locator('.pi-age-check').isVisible(),false);await page.locator('#pi-next-review').click();
 await page.route('**/management/listing',route=>route.fulfill({status:502,contentType:'text/plain',body:'not-json'}));await page.locator('#pi-post-submit').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/unreadable response/);await page.unroute('**/management/listing');
 db.sqlite.prepare('UPDATE gear_management_sessions SET expires_at=? WHERE revoked_at IS NULL').run(Date.now());await page.locator('#pi-post-submit').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/session has ended/);assert.equal(await page.locator('.pi-managed-item').count(),0);
 await page.locator('[data-screen="manage"]').click();await idle();await page.locator('#pi-recovery-send').click();await idle();await page.locator('#pi-local-login').click();await idle();
 // Connected email transfer: field errors, receipt invalidation, expiry, conflicts and revocation.
 await page.locator('#pi-email-change-panel summary').click();assert.equal(await page.locator('#pi-email-change').isVisible(),true);
 await page.locator('#pi-change-email').fill('bad@local');await page.locator('#pi-change-request').click();await idle();
 assert.ok(await page.locator('#pi-change-email').evaluate(el=>el.validationMessage));assert.equal(await page.locator('.pi-manage').isVisible(),true);
 await page.locator('#pi-change-email').fill('edge@example.test');await page.locator('#pi-change-request').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/different email/);
 await page.locator('#pi-change-email').fill('transfer@example.test');await page.locator('#pi-change-request').click();await idle();
 await page.locator('#pi-change-email').fill('changed@example.test');assert.equal(await page.locator('#pi-change-confirm').isVisible(),false);
 await page.locator('#pi-change-email').fill('transfer@example.test');await page.locator('#pi-change-request').click();await idle();
 db.sqlite.prepare('UPDATE gear_email_changes SET expires_at=? WHERE consumed_at IS NULL').run(Date.now()-1);
 await page.locator('#pi-change-confirm').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/expired/);assert.equal(await page.locator('.pi-managed-item').count(),2);
 await page.locator('#pi-change-request').click();await idle();
 const freeRow=(await readPublicListings(db)).find(r=>r.id===freeId);
 const duplicateTarget=await createDraft(db,{...freeRow,email:'transfer@example.test',adult:true});
 const duplicateReceipt=await issueLocalVerification(db,duplicateTarget.id);assert.equal((await confirmVerification(db,duplicateReceipt.token)).verified,true);
 await page.locator('#pi-change-confirm').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/duplicate gear/);assert.equal(await page.locator('.pi-managed-item').count(),2);
 db.sqlite.prepare("UPDATE gear_listings SET status='closed' WHERE id=?").run(duplicateTarget.id);
 for(const width of [1040,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'email form overflow');}
 if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-email-change.png',fullPage:true});
 await page.route('**/listings',r=>r.abort());await page.locator('#pi-change-confirm').click();await idle();
 assert.equal(await page.locator('.pi-managed-item').count(),0);assert.equal(await page.locator('#pi-email-change').isVisible(),false);assert.match(await page.locator('#pi-manage-feedback').textContent(),/Email changed locally/);
 assert.equal(await page.locator('#pi-recovery-email').inputValue(),'transfer@example.test');assert.equal(await page.locator('#pi-recovery-email').evaluate(el=>el===document.activeElement),true);assert.equal(await page.locator('#pi-change-email').inputValue(),'');assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM gear_management_sessions WHERE revoked_at IS NULL').get().n,0);
 await page.unroute('**/listings');await page.locator('#pi-recovery-send').click();await idle();await page.locator('#pi-local-login').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),3);
 // A committed transfer with a lost response must not claim success or leave private records visible.
 await page.locator('#pi-change-email').fill('final@example.test');await page.locator('#pi-change-request').click();await idle();
 await page.route('**/listings',r=>r.abort());await page.route('**/management/email-change/confirm',async route=>{await route.fetch();await route.abort();});await page.locator('#pi-change-confirm').click();await idle();await page.unroute('**/management/email-change/confirm');await page.unroute('**/listings');
 assert.equal(await page.locator('.pi-managed-item').count(),0);assert.match(await page.locator('#pi-local-notice').textContent(),/could not be confirmed/);
 await page.locator('#pi-recovery-email').fill('final@example.test');await page.locator('#pi-recovery-send').click();await idle();await page.locator('#pi-local-login').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),3);
 await page.route('**/listings',r=>r.abort());await page.locator('#pi-local-logout').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),0);assert.equal(await page.locator('#pi-manage-feedback').textContent(),'Signed out.');assert.equal((await context.cookies()).some(c=>c.name==='gear_session'),false);await page.unroute('**/listings');
 // Unmarked static HTML must retain demo behavior and perform no API calls.
 const staticContext=await browser.newContext({ignoreHTTPSErrors:true});const demo=await staticContext.newPage();monitor(demo);const apiCalls=[];
 demo.on('request',r=>{if(/\/(reports|contact|listings|drafts|management|verification|local)(\/|$)/.test(new URL(r.url()).pathname))apiCalls.push(r.url());});
 await demo.route(base+'/gear/',route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('../../gear/index.html',import.meta.url),'utf8')}));
 await demo.goto(base+'/gear/');await demo.waitForFunction(()=>document.querySelector('#pi-count')?.textContent==='8 listings');
 await demo.locator('[data-screen="gear"]').click();await demo.locator('[data-listing]').first().click();await demo.locator('#pi-contact-open').click();
 await demo.locator('#pi-buyer-name').fill('Sample');await demo.locator('#pi-buyer-email').fill('sample@example.test');await demo.locator('#pi-buyer-message').fill('Sample inquiry');await demo.locator('#pi-preview-send').click();assert.equal(await demo.locator('#pi-contact-success h2').textContent(),'Message preview complete');
 await demo.locator('#pi-report-open').click();await demo.locator('#pi-report-reason').selectOption('Other concern');await demo.locator('#pi-preview-report').click();assert.equal(await demo.locator('#pi-report-result').textContent(),'Report preview complete. No report was sent.');
 await demo.locator('[data-screen="post"]').click();await demo.locator('#pi-fill-demo').click();await demo.locator('#pi-next-photos').click();await demo.locator('#pi-next-review').click();await demo.locator('#pi-post-submit').click();await demo.locator('#pi-simulate-verify').click();
 assert.equal(await demo.locator('#pi-email-change').count(),0);assert.equal(await demo.locator('.pi-managed-item').count(),2);assert.deepEqual(apiCalls,[]);
 assert.deepEqual(errors,[]);
 // Expected failed requests are exercised deliberately. Do not hide arbitrary console errors.
 const unexpected=consoleErrors.filter(e=>!(/Failed to load resource/.test(e.text)&&((/\/management\/session$/.test(e.url)&&/401/.test(e.text))||(/\/verification\/confirm$/.test(e.url)&&/400|ERR_FAILED/.test(e.text))||(/\/management\/listing$/.test(e.url)&&/ERR_FAILED|502/.test(e.text))||(/\/listings$/.test(e.url)&&/ERR_FAILED/.test(e.text))||(/\/management\/email-change(?:\/confirm)?$/.test(e.url)&&/400|403|ERR_FAILED/.test(e.text))||(/\/drafts$/.test(e.url)&&/400/.test(e.text))||(/\/contact$/.test(e.url)&&/500/.test(e.text))||(/\/management\/deletion$/.test(e.url)&&/409/.test(e.text))||(/\/reports$/.test(e.url)&&/404|429|500/.test(e.text))||/favicon.ico$/.test(e.url)||/fonts.googleapis.com/.test(e.url))));
 assert.deepEqual(unexpected,[]);
 console.log('PASS: HTTPS connected preview post/verify/login/reload/edit/status/relist/browse/logout/contact/reports, duplicate rejection, interrupted-save retry, server restart persistence, mobile overflow, static-file allowlist static demo isolation and no page errors.');
}finally{try{await cleanup();}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}}
