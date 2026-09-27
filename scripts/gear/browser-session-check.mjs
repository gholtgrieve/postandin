// Optional real-browser check. Uses an externally installed Playwright, not a repo dependency.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { openLocalDatabase } from './local-db.mjs';
import { localServer } from './local-server.mjs';
import { createDraft } from '../../lib/gear-storage.mjs';
import { issueLocalVerification,confirmVerification } from '../../lib/gear-verification.mjs';
import { issueLocalManagementLink,MANAGEMENT_TTL_MS } from '../../lib/gear-management.mjs';
const modulePath=process.env.GEAR_PLAYWRIGHT_MODULE;
if(!modulePath)throw new Error('Set GEAR_PLAYWRIGHT_MODULE to an installed Playwright module absolute path.');
const {chromium}=createRequire(import.meta.url)(modulePath);
const temp=mkdtempSync(join(tmpdir(),'gear-browser-'));
const db=openLocalDatabase();let server,foreign,browser;
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const close=server=>server?new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}):Promise.resolve();
let cleanupPromise;
function cleanup(){
 return cleanupPromise??=Promise.allSettled([
  Promise.resolve().then(()=>rmSync(temp,{recursive:true,force:true})),
  Promise.resolve().then(()=>browser?.close()),
  Promise.resolve().then(()=>close(server)),
  Promise.resolve().then(()=>close(foreign)),
  Promise.resolve().then(()=>db.close()),
 ]).then(results=>{const failed=results.filter(r=>r.status==='rejected');if(failed.length)throw new AggregateError(failed.map(r=>r.reason),'Browser harness cleanup failed');});
}
const interrupt=()=>{cleanup().catch(()=>console.error('Browser harness cleanup failed during interruption.')).finally(()=>process.exit(130));};
process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
const email='browser@example.test';
try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(temp,'key.pem'),'-out',join(temp,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1'],{stdio:'ignore'});
 const tls={key:readFileSync(join(temp,'key.pem')),cert:readFileSync(join(temp,'cert.pem'))};
 const {id}=await createDraft(db,{title:'Browser bag',description:'Sample',city:'Seattle',fit:'Junior',sellerName:'Sample',email,adult:true,category:'Bags & accessories',size:'Junior',condition:'Used — good',type:'sale',priceCents:4000,clubs:[]});
 const verification=await issueLocalVerification(db,id);assert.equal((await confirmVerification(db,verification.token)).verified,true);
 server=localServer(db,{tls});await listen(server);const base=`https://127.0.0.1:${server.address().port}`;
 foreign=createServer(tls,(req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Other origin</title>');});await listen(foreign);
 const foreignOrigin=`https://127.0.0.1:${foreign.address().port}`;
 const denied=[];server.on('request',(req,res)=>{res.on('finish',()=>{if(req.headers.origin===foreignOrigin)denied.push(res.statusCode);});});
 browser=await chromium.launch({channel:'chrome',headless:true});
 // Only the ephemeral self-signed certificate bypasses validation; cookie/CORS rules remain active.
 const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
 await page.goto(base+'/management/confirm');
 const post=(page,path,body={},csrf)=>page.evaluate(async({path,body,csrf})=>{
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(csrf?{'X-Gear-CSRF':csrf}:{})},body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 },{path,body,csrf});
 const login=async()=>{const receipt=await issueLocalManagementLink(db,email);const result=await post(page,'/management/confirm',{token:receipt.token,confirm:true});assert.equal(result.status,200);return result.body;};
 const access=await login();
 const cookie=(await context.cookies()).find(c=>c.name==='gear_session');
 assert.ok(cookie);assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Strict');assert.equal(cookie.path,'/management');
 assert.ok(Math.abs(cookie.expires*1000-access.expiresAt)<2000);assert.ok(cookie.expires*1000-Date.now()<=MANAGEMENT_TTL_MS);
 assert.equal(await page.evaluate(()=>document.cookie.includes('gear_session')),false);
 await page.reload();const recovered=await post(page,'/management/session');assert.equal(recovered.status,200);assert.deepEqual(recovered.body,access);
 const tab=await context.newPage();await tab.goto(base+'/management/confirm');assert.deepEqual((await post(tab,'/management/session')).body,access);
 assert.equal((await post(page,'/management/listing',{id,action:'pending'},access.csrf)).status,200);
 assert.equal((await post(tab,'/management/listing',{id,action:'available'},access.csrf)).status,200);
 const anonymous=await browser.newContext({ignoreHTTPSErrors:true});const anon=await anonymous.newPage();await anon.goto(base+'/management/confirm');assert.equal((await post(anon,'/management/session')).status,401);
 // A same-site but different-origin page must not bootstrap or mutate with the browser cookie.
 const attacker=await context.newPage();await attacker.goto(`https://127.0.0.1:${foreign.address().port}`);
 await attacker.evaluate(async base=>{await fetch(base+'/management/session',{method:'POST',mode:'no-cors',credentials:'include',headers:{'Content-Type':'text/plain'},body:'{}'});},base);
 assert.deepEqual(denied,[403]);
 assert.equal((await post(page,'/management/logout',{},access.csrf)).status,200);
 assert.equal((await context.cookies()).some(c=>c.name==='gear_session'),false);
 assert.equal((await post(tab,'/management/session')).status,401);
 await login(); // Replacement login invalidates the copied cookie below.
 const oldCookie=(await context.cookies()).find(c=>c.name==='gear_session');
 const stale=await browser.newContext({ignoreHTTPSErrors:true});await stale.addCookies([oldCookie]);
 const stalePage=await stale.newPage();await stalePage.goto(base+'/management/confirm');await login();
 assert.equal((await post(stalePage,'/management/session')).status,401);
 db.sqlite.prepare('UPDATE gear_management_sessions SET expires_at=? WHERE revoked_at IS NULL').run(Date.now());
 assert.equal((await post(page,'/management/session')).status,401);
 console.log('PASS: HTTPS Chrome cookie flags/HttpOnly, reload and two-tab recovery, authorized writes, anonymous isolation, cross-origin rejection, logout clearing, replacement revocation and expiry.');
}finally{
 try{await cleanup();}finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);}
}
