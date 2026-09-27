// Loaded only by the opt-in loopback HTTPS preview. Never used by the static demo.
export function safeError(message){return Object.assign(new Error(message),{safe:true});}
export function localAPI(){
 if(location.hostname!=='127.0.0.1'||location.protocol!=='https:')throw safeError('Local API preview requires loopback HTTPS.');
 async function request(path,body,csrf){
  let response;
  try{response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json',...(csrf?{'X-Gear-CSRF':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw safeError('The request could not be confirmed. Check the connection and try again.');}
  let result;try{result=await response.json();}catch{throw safeError('The server returned an unreadable response. Please try again.');}
  if(!result||typeof result!=='object')throw safeError('The server returned an unreadable response. Please try again.');
  if(!response.ok){const error=safeError(response.status===401?'Your session has ended. Request a new management link.':result.error||'Unable to complete this request.');error.status=response.status;error.fields=result.fields;throw error;}
  return result;
 }
 const session=()=>request('/management/session',{});
 return {request,session,async write(body){const access=await session();return request('/management/listing',body,access.csrf);},async logout(){const access=await session();return request('/management/logout',{},access.csrf);}};
}
export function previewListing(row){return {...row,type:row.type==='sale'?'Sale':row.type==='free'?'Free':'Trade',seller:row.sellerName,place:row.city,photos:[],age:'Local listing',pending:row.status==='pending',status:row.status[0].toUpperCase()+row.status.slice(1),expires:row.expiresAt};}
export function listingInput(d,adult,editing=false){const result={title:d.title,description:d.description,category:d.category,size:d.size,fit:d.fit,condition:d.condition,city:d.city,type:d.type.toLowerCase(),priceCents:d.priceCents,trade:d.trade,clubs:d.clubs,otherClub:d.otherClub,sellerName:d.seller};if(!editing){result.email=d.email;result.adult=adult;}return result;}
