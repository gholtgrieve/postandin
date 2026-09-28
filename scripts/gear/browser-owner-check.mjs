// Optional local owner dashboard check; existing external Playwright only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {openLocalDatabase} from './local-db.mjs';
import {localServer} from './local-server.mjs';
import {localReports} from './local-reports.mjs';
import {createDraft} from '../../lib/gear-storage.mjs';
import {issueLocalVerification,confirmVerification} from '../../lib/gear-verification.mjs';
if(!process.env.GEAR_PLAYWRIGHT_MODULE)throw new Error('Set GEAR_PLAYWRIGHT_MODULE to an installed Playwright module.');
const {chromium}=createRequire(import.meta.url)(process.env.GEAR_PLAYWRIGHT_MODULE);
const temp=mkdtempSync(join(tmpdir(),'gear-owner-browser-'));let db,server,browser;
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key'),'-out',join(temp,'cert'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
 const tls={key:readFileSync(join(temp,'key')),cert:readFileSync(join(temp,'cert'))},ownerKey=randomBytes(32).toString('hex');
 db=openLocalDatabase(join(temp,'sample.sqlite'));server=localServer(db,{tls,preview:true,ownerKey});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`https://127.0.0.1:${server.address().port}`;
 const ids=[],queue=localReports(db,{persistent:true});for(const title of ['<b>Bag one</b>','Bag two']){
  const {id}=await createDraft(db,{title,description:'Sample worn gear',city:'Seattle',fit:'Junior',sellerName:'Sample',email:'seller@example.test',adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]});
  const receipt=await issueLocalVerification(db,id);assert.equal((await confirmVerification(db,receipt.token)).verified,true);ids.push(id);queue.submit({id,reason:'Other concern'});
 }
 const photoId=crypto.randomUUID();db.sqlite.prepare('INSERT INTO gear_local_photos VALUES(?,?,?,?,?)').run(photoId,ids[0],0,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5S8AAAAASUVORK5CYII=','base64'),Date.now());
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1040,height:900}}),page=await context.newPage(),errors=[],consoleErrors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push({text:m.text(),url:m.location().url});});
 const idle=()=>page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
 await page.goto(base+'/owner/');await idle();assert.equal(await page.locator('#workspace').isVisible(),false);
 await page.locator('#key').fill(ownerKey);await page.locator('#login button').click();await idle();assert.equal(await page.locator('#key').inputValue(),'');assert.equal(await page.locator('#reports article').count(),2);assert.equal(await page.locator('#reports h3 b').count(),0);
 assert.equal((await context.request.get(base+'/local/reports')).status(),404);
 const guest=await browser.newContext({ignoreHTTPSErrors:true});assert.equal((await guest.request.get(base+'/owner/data')).status(),401);assert.equal((await guest.request.get(base+'/owner/photos/'+photoId)).status(),401);await guest.close();
 const bag=()=>page.locator('#reports article').filter({has:page.locator('h3',{hasText:'<b>Bag one</b>'})});
 await bag().locator('[data-action="remove"]').click();await idle();assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(ids[0]).status,'available');
 await bag().locator('input').fill('Review sample <script>');
 await page.route('**/owner/action',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Unable to process the request.'})}));
 await bag().locator('[data-action="remove"]').click();await idle();assert.equal(await bag().locator('input').inputValue(),'Review sample <script>');await page.unroute('**/owner/action');
 await bag().locator('[data-action="remove"]').click();await idle();assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(ids[0]).status,'removed');assert.equal((await context.request.get(base+'/photos/'+photoId)).status(),404);assert.equal((await context.request.get(base+'/owner/photos/'+photoId)).status(),200);
 assert.equal((await(await context.request.get(base+'/listings')).json()).listings.length,1);
 for(const width of [1040,390,320]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'owner overflow at '+width);if(process.env.GEAR_PREVIEW_SCREENSHOT)await page.screenshot({path:process.env.GEAR_PREVIEW_SCREENSHOT+'-owner-'+width+'.png',fullPage:true});}
 await page.reload();await idle();assert.equal(await page.locator('#removed article').count(),1);
 await page.locator('#removed input').fill('Restoration checked');await page.locator('[data-action="restore"]').click();await idle();assert.equal(db.sqlite.prepare('SELECT status FROM gear_listings WHERE id=?').get(ids[0]).status,'available');
 const second=page.locator('#reports article').filter({has:page.locator('h3',{hasText:'Bag two'})});await second.locator('input').fill('No issue found');await second.locator('[data-action="dismiss"]').click();await idle();assert.equal(await page.locator('#history p').count(),3);
 // A committed action whose response is lost is recovered by refresh, not retried automatically.
 queue.submit({id:ids[0],reason:'Misleading listing'});await page.locator('#refresh').click();await idle();const open=page.locator('#reports article').filter({has:page.locator('[data-action="remove"]')});await open.locator('input').fill('Lost-response sample');
 await page.route('**/owner/action',async r=>{await r.fetch();await r.abort();});await open.locator('[data-action="remove"]').click();await idle();assert.match(await page.locator('#notice').textContent(),/could not be confirmed/);await page.unroute('**/owner/action');await page.locator('#refresh').click();await idle();assert.equal(await page.locator('#removed article').count(),1);assert.equal(await page.locator('#history p').count(),4);assert.match(await page.locator('#history p').first().textContent(),/Reported: Misleading listing/);
 await page.locator('#logout').click();await idle();assert.equal(await page.locator('#workspace').isVisible(),false);assert.equal((await context.request.get(base+'/owner/data')).status(),401);
 assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors.filter(e=>!(/Failed to load resource/.test(e.text)&&((/\/owner\/session$/.test(e.url)&&/401/.test(e.text))||(/\/owner\/action$/.test(e.url)&&/500|ERR_FAILED/.test(e.text))||/favicon.ico$/.test(e.url)))),[]);
 console.log('PASS: local owner login/reload/dismiss/remove/restore/history/logout, anonymous denial, public photo removal, failure preservation, lost-response recovery and desktop/mobile layout.');
}finally{await browser?.close();if(server)await new Promise(r=>{server.close(r);server.closeAllConnections();});db?.close();rmSync(temp,{recursive:true,force:true});}
