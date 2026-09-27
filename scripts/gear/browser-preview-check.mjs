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
 await page.reload();await idle();await page.locator('[data-screen="manage"]').click();await idle();assert.equal(await page.locator('.pi-managed-item').count(),1);
 // Repeated gear is rejected at confirmation; it never becomes a second public row.
 await page.locator('[data-screen="post"]').click();await page.locator('#pi-fill-demo').click();await page.locator('#pi-next-photos').click();await page.locator('#pi-next-review').click();await page.locator('#pi-post-submit').click();await idle();await page.locator('#pi-simulate-verify').click();await idle();
 assert.equal(await page.locator('#pi-local-notice').isVisible(),true);assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM gear_listings WHERE status='available'").get().n,1);
 await page.locator('[data-screen="manage"]').click();await idle();

 await page.locator('[data-manage="edit"]').click();assert.equal(await page.locator('#pi-post-email').isDisabled(),true);await page.locator('#pi-post-name').fill('Updated club bag');await page.locator('#pi-next-photos').click();await page.locator('#pi-next-review').click();await page.route('**/management/listing',route=>route.abort());await page.locator('#pi-post-submit').click();await idle();assert.equal(await page.locator('#pi-local-notice').isVisible(),true);assert.equal(await page.locator('#pi-post-name').inputValue(),'Updated club bag');
 await page.unroute('**/management/listing');await page.locator('#pi-post-submit').click();await idle();assert.equal(db.sqlite.prepare("SELECT title FROM gear_listings WHERE status='available'").get().title,'Updated club bag');
 const port=server.address().port;await new Promise(r=>{server.close(r);server.closeAllConnections();});db.close();db=null;db=openLocalDatabase(join(temp,'sample.sqlite'));server=localServer(db,{tls,preview:true});await listen(server,port);
 await page.reload();await idle();await page.locator('[data-screen="manage"]').click();await idle();assert.equal(await page.locator('.pi-managed-item h2').textContent(),'Updated club bag');
 await page.locator('[data-manage="pending"]').click();await idle();assert.equal(db.sqlite.prepare("SELECT status FROM gear_listings WHERE title='Updated club bag'").get().status,'pending');
 await page.locator('[data-manage="close"]').click();await idle();assert.equal(db.sqlite.prepare("SELECT status FROM gear_listings WHERE title='Updated club bag'").get().status,'closed');
 await page.locator('[data-manage="renew"]').click();await idle();assert.equal(db.sqlite.prepare("SELECT status FROM gear_listings WHERE title='Updated club bag'").get().status,'available');
 await page.locator('[data-screen="gear"]').click();await idle();assert.equal(await page.locator('#pi-count').textContent(),'1 listing');await page.locator('[data-listing]').click();assert.equal(await page.locator('#pi-detail-title').textContent(),'Updated club bag');
 if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-desktop.png',fullPage:true});
 // Mobile overflow and view rendering; browser console exceptions must remain empty.
 for(const width of [390,320]){await page.setViewportSize({width,height:900});for(const screen of ['gear','detail','post','manage']){await page.locator('[data-screen="'+screen+'"]').click();await idle();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),screen+' overflow at '+width);}}
 if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-mobile.png',fullPage:true});
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
 await page.unroute('**/listings');await page.locator('#pi-local-refresh').click();await idle();
 await page.locator('#pi-recovery-send').click();await idle();await page.locator('#pi-recovery-email').fill('changed@example.test');assert.equal(await page.locator('#pi-local-login').isVisible(),false);
 await page.locator('#pi-recovery-email').fill('edge@example.test');await page.locator('#pi-recovery-send').click();await idle();assert.match(await page.locator('#pi-local-login').textContent(),/edge@example.test/);await page.locator('#pi-local-login').click();await idle();
 assert.equal(await page.locator('.pi-managed-item h2').textContent(),'<b>Free gear</b>');assert.equal(await page.locator('.pi-managed-item h2 b').count(),0);
 assert.deepEqual(db.sqlite.prepare('SELECT type,price_cents FROM gear_listings WHERE id=?').get(freeId),Object.assign(Object.create(null),{type:'free',price_cents:0}));
 await prepare('Trade gear','Trade');await page.locator('#pi-post-submit').click();await idle();
 await page.route('**/verification/confirm',async route=>{await route.fetch();await route.abort();});await page.locator('#pi-simulate-verify').click();await idle();await page.unroute('**/verification/confirm');
 assert.equal(await page.locator('#pi-verify-screen').isVisible(),false);assert.equal(db.sqlite.prepare("SELECT price_cents FROM gear_listings WHERE title='Trade gear'").get().price_cents,null);
 await page.locator('[data-manage="edit"]').first().click();await page.locator('#pi-next-photos').click();assert.equal(await page.locator('#pi-post-email').isVisible(),false);assert.equal(await page.locator('.pi-contact-fields > .pi-field-help').isVisible(),false);assert.equal(await page.locator('.pi-age-check').isVisible(),false);await page.locator('#pi-next-review').click();
 await page.route('**/management/listing',route=>route.fulfill({status:502,contentType:'text/plain',body:'not-json'}));await page.locator('#pi-post-submit').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/unreadable response/);await page.unroute('**/management/listing');
 db.sqlite.prepare('UPDATE gear_management_sessions SET expires_at=? WHERE revoked_at IS NULL').run(Date.now());await page.locator('#pi-post-submit').click();await idle();assert.match(await page.locator('#pi-local-notice').textContent(),/session has ended/);assert.equal(await page.locator('.pi-managed-item').count(),0);
 await page.locator('[data-screen="manage"]').click();await idle();await page.locator('#pi-recovery-send').click();await idle();await page.locator('#pi-local-login').click();await idle();
 // Connected email transfer: field errors, receipt invalidation, expiry, conflicts and revocation.
 assert.equal(await page.locator('#pi-email-change').isVisible(),true);
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
 demo.on('request',r=>{if(/\/(listings|drafts|management|verification|local)(\/|$)/.test(new URL(r.url()).pathname))apiCalls.push(r.url());});
 await demo.route(base+'/gear/',route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('../../gear/index.html',import.meta.url),'utf8')}));
 await demo.goto(base+'/gear/');await demo.waitForFunction(()=>document.querySelector('#pi-count')?.textContent==='8 listings');
 await demo.locator('[data-screen="post"]').click();await demo.locator('#pi-fill-demo').click();await demo.locator('#pi-next-photos').click();await demo.locator('#pi-next-review').click();await demo.locator('#pi-post-submit').click();await demo.locator('#pi-simulate-verify').click();
 assert.equal(await demo.locator('#pi-email-change').count(),0);assert.equal(await demo.locator('.pi-managed-item').count(),2);assert.deepEqual(apiCalls,[]);
 assert.deepEqual(errors,[]);
 // Expected failed requests are exercised deliberately. Do not hide arbitrary console errors.
 const unexpected=consoleErrors.filter(e=>!(/Failed to load resource/.test(e.text)&&((/\/management\/session$/.test(e.url)&&/401/.test(e.text))||(/\/verification\/confirm$/.test(e.url)&&/400|ERR_FAILED/.test(e.text))||(/\/management\/listing$/.test(e.url)&&/ERR_FAILED|502/.test(e.text))||(/\/listings$/.test(e.url)&&/ERR_FAILED/.test(e.text))||(/\/management\/email-change(?:\/confirm)?$/.test(e.url)&&/400|403|ERR_FAILED/.test(e.text))||(/\/drafts$/.test(e.url)&&/400/.test(e.text))||/favicon.ico$/.test(e.url)||/fonts.googleapis.com/.test(e.url))));
 assert.deepEqual(unexpected,[]);
 console.log('PASS: HTTPS connected preview post/verify/login/reload/edit/status/relist/browse/logout, duplicate rejection, interrupted-save retry, server restart persistence, mobile overflow, static-file allowlist static demo isolation and no page errors.');
}finally{try{await cleanup();}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}}
