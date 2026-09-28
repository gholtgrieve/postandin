const $=id=>document.getElementById(id);let busy=false;
function clear(){ $('workspace').hidden=true;$('login').hidden=false;for(const id of ['reports','removed','history'])$(id).replaceChildren();}
function notice(text){$('notice').textContent=text;$('notice').focus();}
async function request(path,body,csrf){
 let response,result;
 try{response=await fetch('/owner/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json',...(csrf?{'X-Gear-CSRF':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new Error('The request could not be confirmed. Refresh before retrying.');}
 try{result=await response.json();}catch{throw new Error('The server response could not be read. Refresh before retrying.');}
 if(!response.ok){if(response.status===401)clear();throw new Error(result.error||'Unable to complete the request.');}return result;
}
async function run(task){if(busy)return;busy=true;const controls=[...document.querySelectorAll('button,input')];controls.forEach(el=>el.disabled=true);try{await task();}catch(error){notice(error.message);}finally{controls.forEach(el=>el.disabled=false);busy=false;}}
function element(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
function card(record,report){
 const node=document.createElement('article'),listing=record.listing;
 node.append(element('h3',listing?.title||record.listingTitle||'Listing unavailable'));
 if(listing){node.append(element('p',`${listing.status} · ${listing.city} · ${listing.category} · ${listing.size} · ${listing.condition}\nSeller: ${listing.sellerName}\n${listing.type}${listing.priceCents===null?'':' · $'+(listing.priceCents/100).toFixed(2)} · ${listing.fit}${listing.trade?'\nTrade: '+listing.trade:''}\nExpires: ${new Date(listing.expiresAt).toLocaleString()}`),element('p',listing.description));}
 for(const photo of listing?.photos||[]){const img=document.createElement('img');img.src=photo.url;img.alt=listing.title;node.append(img);}
 node.append(element('p',report?`Reported: ${record.reason}\nResolution: ${record.resolution}`:`Removal reason: ${record.reason}`));
 if(!report&&listing?.deleted){node.append(element('p','Deleted by seller. Recovery must happen through seller management before owner restoration.'));return node;}
 if(report&&record.resolution!=='open')return node;
 const form=document.createElement('form'),label=element('label','Reason for this action'),reason=document.createElement('input');reason.required=true;reason.maxLength=500;label.append(reason);form.append(label);form.addEventListener('submit',e=>e.preventDefault());
 const actions=report?['dismiss',...(['available','pending'].includes(listing?.status)?['remove']:[])]:['restore'];
 for(const action of actions){const button=element('button',({dismiss:'Dismiss report',remove:'Remove listing',restore:'Restore listing'})[action]);button.type='button';button.dataset.action=action;button.onclick=()=>{
  reason.setCustomValidity(reason.value.trim()?'':'Enter a reason.');if(!form.reportValidity())return;
  const body={action,id:report?record.id:record.listingId,reason:reason.value};
  run(async()=>{const access=await request('session',{});await request('action',body,access.csrf);try{await refresh();notice('Action saved locally.');}catch{clear();notice('Action saved locally, but the latest view could not be loaded. Sign in again to refresh.');}});
 };form.append(button);}
 reason.oninput=()=>reason.setCustomValidity('');node.append(form);return node;
}
async function refresh(){const data=await request('data');for(const id of ['reports','removed','history'])$(id).replaceChildren();
 for(const r of data.reports)$('reports').append(card(r,true));for(const r of data.removed)$('removed').append(card(r,false));
 for(const h of data.history)$('history').append(element('p',`${new Date(h.createdAt).toLocaleString()} · ${h.actor} · ${h.action} · ${h.listingId}\n${h.beforeStatus} → ${h.afterStatus}${h.reportReason?'\nReported: '+h.reportReason:''}\n${h.reason}`));
 for(const id of ['reports','removed','history'])if(!$(id).children.length)$(id).append(element('p','None.'));
 $('login').hidden=true;$('workspace').hidden=false;
}
$('login').onsubmit=e=>{e.preventDefault();const key=$('key').value;$('key').value='';run(async()=>{await request('login',{key});await refresh();notice('Signed in as local owner.');});};
$('refresh').onclick=()=>run(async()=>{await refresh();notice('Refreshed.');});
$('logout').onclick=()=>run(async()=>{try{const access=await request('session',{});await request('logout',{},access.csrf);}finally{clear();}notice('Signed out.');});
if(location.hostname!=='127.0.0.1'||location.protocol!=='https:'){clear();$('login').hidden=true;notice('Owner review requires the local HTTPS preview.');}else run(async()=>{try{await request('session',{});await refresh();}catch{clear();}});
