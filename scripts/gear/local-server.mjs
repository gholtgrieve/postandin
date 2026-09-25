// LOCAL DEVELOPMENT ONLY: deliberately outside functions/, never a Pages route.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { safeDatabasePath } from './local-path.mjs';
import { openLocalDatabase } from './local-db.mjs';
import { createDraft, readLocalDraft, readPublicListings } from '../../lib/gear-storage.mjs';
import { DraftValidationError } from '../../lib/gear-validation.mjs';

export function localServer(db) {
  return createServer(async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
    const expected=`127.0.0.1:${req.socket.localPort}`;
    // Reject rebinding and cross-origin browser requests, including Origin:null.
    if(req.headers['sec-fetch-site']==='cross-site' || req.headers.host!==expected || (req.headers.origin && req.headers.origin!==`http://${expected}`)) return reply(403,{error:'Request not allowed.'});
    try {
      const url=new URL(req.url,`http://${expected}`);
      if(req.method==='GET'&&url.pathname==='/listings') return reply(200,{listings:await readPublicListings(db)});
      const match=url.pathname.match(/^\/drafts\/([a-f0-9-]{36})$/);
      if(req.method==='GET'&&match) {const draft=await readLocalDraft(db,match[1]);return reply(draft?200:404,draft?{draft}:{error:'Not found.'});}
      if(req.method!=='POST'||url.pathname!=='/drafts') return reply(404,{error:'Not found.'});
      if(req.headers['content-type']?.split(';')[0]!=='application/json') return reply(415,{error:'Use JSON.'});
      const tooLarge=()=>{res.setHeader('Connection','close');reply(413,{error:'Request too large.'});req.resume();};
      if(Number(req.headers['content-length'])>32768)return tooLarge();
      const chunks=await new Promise((resolve,reject)=>{
        let bytes=0,done=false;const parts=[];
        req.on('data',chunk=>{if(done)return;bytes+=chunk.length;
          if(bytes>32768){done=true;parts.length=0;tooLarge();resolve(null);return;}
          parts.push(chunk);
        });
        req.on('end',()=>{if(!done){done=true;resolve(parts);}});
        req.on('error',error=>{if(!done){done=true;reject(error);}});
      });
      if(!chunks)return;
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON.'});}
      return reply(201,await createDraft(db,input));
    } catch(error) {
      if(error instanceof DraftValidationError)return reply(400,{error:error.message,fields:error.fields});
      console.error('Local gear request failed:',error);
      return reply(500,{error:'Unable to process the request.'});
    }
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const path=process.argv[2];
  if(!path)throw new Error('Supply an absolute database path outside the website directory. Use sample data only.');
  const db=openLocalDatabase(safeDatabasePath(path)),server=localServer(db);
  server.listen(8772,'127.0.0.1',()=>console.log('Local sample-data API: http://127.0.0.1:8772 (no email or publishing)'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
