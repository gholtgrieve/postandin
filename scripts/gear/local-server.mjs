import {localReports,ReportError} from './local-reports.mjs';
import {localContact,ContactError} from './local-contact.mjs';
import {initializePhotos,photoRows,photoContent,changePhotos,PhotoError} from './local-photos.mjs';
// LOCAL DEVELOPMENT ONLY: deliberately outside functions/, never a Pages route.
import { issueLocalEmailChange, confirmEmailChange } from '../../lib/gear-email-change.mjs';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { safeDatabasePath } from './local-path.mjs';
import { openLocalDatabase } from './local-db.mjs';
import { createDraft, readLocalDraft, readPublicListings } from '../../lib/gear-storage.mjs';
import { issueLocalVerification, confirmVerification } from '../../lib/gear-verification.mjs';
import { MANAGEMENT_TTL_MS, recoverManagementSession, issueLocalManagementLink, redeemManagementLink, listManaged, revokeManagement, changeListingState, editManagedListing } from '../../lib/gear-management.mjs';
import { DraftValidationError } from '../../lib/gear-validation.mjs';

export function localServer(db,{tls,preview=false,contactSink}={}) {
  if(preview&&!tls)throw new Error('Connected preview requires TLS.');
  initializePhotos(db);
  const contact=localContact(db,{sink:contactSink});
  const reportQueue=localReports(db);
  const assets=new Map(preview?['gear/index.html','gear/gear.css','gear/gear.mjs','gear/local-api.mjs','lib/gear-exchange.mjs'].map(path=>['/'+path,readFileSync(new URL('../../'+path,import.meta.url),'utf8')]):[]);
  const emailChangeMailbox=[];
  const localMailbox=[]; // Trusted local inspection only; bounded, never logged.
  const sessionCookie=value=>`gear_session=${value}; Path=/management; HttpOnly; Secure; SameSite=Strict; Max-Age=${value?MANAGEMENT_TTL_MS/1000:0}`;
  function session(req){const matches=(req.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('gear_session='));return matches.length===1?matches[0].slice(13):'';}

  const handler=async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(body));};
    const expected=`127.0.0.1:${req.socket.localPort}`;
    const origin=`${req.socket.encrypted?'https':'http'}://${expected}`;
    // Reject rebinding and cross-origin browser requests, including Origin:null.
    if(req.headers['sec-fetch-site']==='cross-site' || req.headers.host!==expected || (req.headers.origin && req.headers.origin!==origin)) return reply(403,{error:'Request not allowed.'});
    try {
      const url=new URL(req.url,origin);
      if(preview&&req.method==='GET'){
        const path=url.pathname==='/gear/'?'/gear/index.html':url.pathname;
        if(assets.has(path)){
          let content=assets.get(path);
          if(path==='/gear/index.html')content=content.replace('id="pi-gear-preview"','id="pi-gear-preview" data-local-api="true"').replace(/<link href="https:\/\/fonts.googleapis.com[^>]+>/,'');
          res.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});return res.end(content);
        }
      }

      const photo=url.pathname.match(/^\/(management\/)?photos\/([a-f0-9-]{36})$/);
      if(req.method==='GET'&&photo){const content=photoContent(db,photo[2],session(req),Boolean(photo[1]));if(!content)return reply(404,{error:'Not found.'});res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});return res.end(content);}
      if(req.method==='GET'&&url.pathname==='/local/reports')return reply(200,{reports:reportQueue.reports});
      if(req.method==='GET'&&url.pathname==='/local/contact-mail')return reply(200,{receipts:contact.receipts});
      if(req.method==='GET'&&url.pathname==='/local/email-change-mail')return reply(200,{receipts:emailChangeMailbox});
      if(req.method==='GET'&&url.pathname==='/management/email-change/confirm')return reply(200,{confirmationRequired:true});
      if(req.method==='GET'&&url.pathname==='/local/management-mail')return reply(200,{receipts:localMailbox});
      if(req.method==='GET'&&url.pathname==='/management/confirm')return reply(200,{confirmationRequired:true});
      if(req.method==='GET'&&url.pathname==='/management/listings'){
        const listings=await listManaged(db,session(req));return reply(listings?200:401,listings?{listings:listings.map(r=>({...r,photos:photoRows(db,r.id,true)}))}:{error:'Access unavailable.'});
      }
      const management=url.pathname.startsWith('/management/');
      if((management||url.pathname==='/contact'||url.pathname==='/reports')&&req.method==='POST'&&req.headers.origin!==origin)return reply(403,{error:'Request not allowed.'});

      if(req.method==='GET'&&url.pathname==='/verification')return reply(200,{confirmationRequired:true,notice:'Opening this URL does not verify or publish anything. POST token and confirm:true to /verification/confirm.'});
      if(req.method==='GET'&&url.pathname==='/listings') return reply(200,{listings:(await readPublicListings(db)).map(r=>({...r,photos:photoRows(db,r.id)}))});
      const match=url.pathname.match(/^\/drafts\/([a-f0-9-]{36})$/);
      if(req.method==='GET'&&match) {const draft=await readLocalDraft(db,match[1]);return reply(draft?200:404,draft?{draft}:{error:'Not found.'});}
      const issue=url.pathname.match(/^\/drafts\/([a-f0-9-]{36})\/verification$/);
      if(req.method!=='POST'||(!issue&&!['/reports','/contact','/management/photos','/drafts','/verification/confirm','/management/session','/management/email-change','/management/email-change/confirm','/management/recovery','/management/confirm','/management/logout','/management/listing'].includes(url.pathname))) return reply(404,{error:'Not found.'});
      if(req.headers['content-type']?.split(';')[0]!=='application/json') return reply(415,{error:'Use JSON.'});
      const bodyLimit=url.pathname==='/management/photos'?7*1024*1024:32768;
      const tooLarge=()=>{res.setHeader('Connection','close');reply(413,{error:'Request too large.'});req.resume();};
      if(Number(req.headers['content-length'])>bodyLimit)return tooLarge();
      const chunks=await new Promise((resolve,reject)=>{
        let bytes=0,done=false;const parts=[];
        req.on('data',chunk=>{if(done)return;bytes+=chunk.length;
          if(bytes>bodyLimit){done=true;parts.length=0;tooLarge();resolve(null);return;}
          parts.push(chunk);
        });
        req.on('end',()=>{if(!done){done=true;resolve(parts);}});
        req.on('error',error=>{if(!done){done=true;reject(error);}});
      });
      if(!chunks)return;
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON.'});}
      if(url.pathname==='/reports')return reply(200,reportQueue.submit(input));
      if(url.pathname==='/contact')return reply(200,contact.send(input));
      if(url.pathname==='/management/photos'){const ok=await changePhotos(db,session(req),req.headers['x-gear-csrf']||'',input);return reply(ok?200:403,ok?{ok:true}:{error:'Unable to change photos.'});}
      if(url.pathname==='/management/session'){
        const access=await recoverManagementSession(db,session(req));
        return reply(access?200:401,access??{error:'Access unavailable.'});
      }
      if(url.pathname==='/management/email-change'){
        const receipt=await issueLocalEmailChange(db,session(req),req.headers['x-gear-csrf']||'',input?.email);
        if(receipt){emailChangeMailbox.push(receipt);if(emailChangeMailbox.length>20)emailChangeMailbox.shift();}
        return reply(receipt?200:403,receipt?{message:'Check the new address to confirm. Local preview: no email was sent.'}:{error:'Unable to request email change.'});
      }
      if(url.pathname==='/management/email-change/confirm'){
        if(input?.confirm!==true)return reply(400,{error:'Explicit confirmation is required.'});
        const ok=await confirmEmailChange(db,input.token);
        // Recipient may confirm in a different browser. No session is granted.
        return reply(ok?200:400,ok?{ok:true}:{error:'Unable to confirm email change.'});
      }
      if(url.pathname==='/management/recovery'){
        const receipt=await issueLocalManagementLink(db,input?.email);
        if(receipt){localMailbox.push(receipt);if(localMailbox.length>20)localMailbox.shift();}
        return reply(200,{message:'If verified listings match that address, a management link will be sent. Local preview: no email was sent.'});
      }
      if(url.pathname==='/management/confirm'){
        if(input?.confirm!==true)return reply(400,{error:'Explicit confirmation is required.'});
        const access=await redeemManagementLink(db,input.token);
        if(!access)return reply(400,{error:'Access unavailable.'});
        res.setHeader('Set-Cookie',sessionCookie(access.session));
        return reply(200,{csrf:access.csrf,expiresAt:access.expiresAt});
      }
      if(url.pathname==='/management/logout'){
        const ok=await revokeManagement(db,session(req),req.headers['x-gear-csrf']||'');
        if(ok)res.setHeader('Set-Cookie',sessionCookie(''));
        return reply(ok?200:403,ok?{ok:true}:{error:'Access unavailable.'});
      }
      if(url.pathname==='/management/listing'){
        const ok=input?.action==='edit'
          ?await editManagedListing(db,session(req),req.headers['x-gear-csrf']||'',input.id,input.listing)
          :await changeListingState(db,session(req),req.headers['x-gear-csrf']||'',input?.id,input?.action);
        return reply(ok?200:403,ok?{ok:true}:{error:'Unable to change this listing.'});
      }
      if(issue){const receipt=await issueLocalVerification(db,issue[1]);return reply(receipt?200:404,receipt?{receipt}:{error:'Not found.'});}
      if(url.pathname==='/verification/confirm'){
        if(input?.confirm!==true)return reply(400,{error:'Explicit confirmation is required.'});
        const result=await confirmVerification(db,input.token);
        return reply(result.verified?200:400,result.verified?result:{error:'Unable to verify this listing.'});
      }
      return reply(201,await createDraft(db,input));
    } catch(error) {
      if(error instanceof ReportError)return reply(error.status,{error:error.message});
      if(error instanceof ContactError)return reply(error.status,{error:error.message});
      if(error instanceof PhotoError)return reply(400,{error:error.message});
      if(error instanceof DraftValidationError)return reply(400,{error:error.message,fields:error.fields});
      console.error('Local gear request failed:',error);
      return reply(500,{error:'Unable to process the request.'});
    }
  };
  return tls?createSecureServer(tls,handler):createServer(handler);
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const path=process.argv[2];
  if(!path)throw new Error('Supply an absolute database path outside the website directory. Use sample data only.');
  const db=openLocalDatabase(safeDatabasePath(path)),server=localServer(db);
  server.listen(8772,'127.0.0.1',()=>console.log('Local sample-data API: http://127.0.0.1:8772 (simulated email; publication in local database only)'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
