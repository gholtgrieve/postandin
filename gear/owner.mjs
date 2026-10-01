import {isGearAdminOrigin} from '../lib/gear-origins.mjs';

const $=id=>document.getElementById(id);
const production=isGearAdminOrigin(location.origin);
const local=location.hostname==='127.0.0.1'&&location.protocol==='https:';
let busy=false;
function clear(){$('workspace').hidden=true;$('login').hidden=production;for(const id of ['reports','removed','history'])$(id).replaceChildren();}
function notice(text){$('notice').textContent=text;$('notice').focus();}
async function request(path,body,csrf){
 const routes=production?{session:'/api/gear/admin/session',data:'/api/gear/admin/reports',action:'/api/gear/admin/actions'}:null,url=production?routes[path]:'/owner/'+path;if(!url)throw new Error('Unable to complete the request.');
 const method=body===undefined?'GET':'POST';let response,text,result;
 try{response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:body===undefined?{Accept:'application/json'}:{'Content-Type':'application/json',...(csrf?{'X-Gear-CSRF':csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new Error('The request could not be confirmed. Refresh before retrying.');}
 try{text=await response.text();}catch{throw new Error('The server response could not be read. Refresh before retrying.');}
 if(text.length>4*1024*1024)throw new Error('The server response could not be read. Refresh before retrying.');
 try{result=JSON.parse(text);}catch{throw new Error('The server response could not be read. Refresh before retrying.');}
 if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('The server response could not be read. Refresh before retrying.');
 if(!response.ok){if(response.status===401||response.status===403)clear();throw new Error(typeof result.error==='string'&&result.error.length<=300?result.error:'Unable to complete the request.');}return result;
}
async function run(task){if(busy)return;busy=true;const controls=[...document.querySelectorAll('button,input')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);try{await task();}catch(error){notice(error.message);}finally{controls.forEach(([el,disabled])=>el.disabled=disabled);busy=false;}}
function element(tag,text){const el=document.createElement(tag);el.textContent=text;return el;}
function displayLabel(value){const text=String(value||'');return text?text[0].toUpperCase()+text.slice(1):'';}
function card(record,report){
 const node=document.createElement('article'),listing=record.listing,heading=element('h3',listing?.title||record.listingTitle||'Listing unavailable');heading.id='owner-card-'+(report?(record.reportId||record.id):record.listingId);node.setAttribute('aria-labelledby',heading.id);node.append(heading);
 if(listing){
  const price=listing.priceCents===null?displayLabel(listing.type):'$'+(listing.priceCents/100).toFixed(2),meta=element('p',`${price} · ${listing.city} · ${listing.condition}`);meta.className='listing-meta';node.append(meta,element('p',listing.description));
  const seller=element('p',`Listed by ${listing.sellerName} · ${displayLabel(listing.status)} · Expires ${new Date(listing.expiresAt).toLocaleDateString()}`);seller.className='listing-secondary';node.append(seller);
  if(listing.trade){const trade=element('p','Looking for: '+listing.trade);trade.className='listing-secondary';node.append(trade);}
 }
 for(const photo of listing?.photos||[]){const img=document.createElement('img');img.src=photo.url;img.alt=listing.title;node.append(img);}
 const reasonText=element('p',report?'Reported: '+record.reason:'Removal reason: '+record.reason);reasonText.className='moderation-reason';node.append(reasonText);
 if(!report&&(listing?.deleted||record.sellerDeleted)){node.append(element('p','Deleted by seller. Recovery must happen through seller management before owner restoration.'));return node;}
 if(!report&&listing?.expiresAt<=Date.now()){node.append(element('p','Expired — this listing cannot be restored.'));return node;}
 if(report&&record.resolution!=='open')return node;
 const form=document.createElement('form'),label=element('label','Reason for this action'),reason=document.createElement('input');reason.required=true;reason.maxLength=500;reason.setAttribute('aria-label','Reason for this action: '+heading.textContent);label.append(reason);form.append(label);form.addEventListener('submit',e=>e.preventDefault());
 const actions=report?['dismiss',...(['available','pending'].includes(listing?.status)?['remove']:[])]:['restore'];
 for(const action of actions){const text=({dismiss:'Dismiss report',remove:'Remove listing',restore:'Restore listing'})[action],button=element('button',text);button.type='button';button.dataset.action=action;button.setAttribute('aria-label',text+': '+heading.textContent);button.onclick=()=>{reason.setCustomValidity(reason.value.trim()?'':'Enter a reason.');if(!form.reportValidity())return;const body={action,id:report?(record.reportId||record.id):record.listingId,reason:reason.value};run(async()=>{if(production)await request('action',body);else{const access=await request('session',{});await request('action',body,access.csrf);}try{await refresh();notice(production?'Action saved.':'Action saved locally.');}catch{clear();notice(production?'Action saved, but the latest view could not be loaded. Refresh the page.':'Action saved locally, but the latest view could not be loaded. Sign in again to refresh.');}});};form.append(button);}
 reason.oninput=()=>reason.setCustomValidity('');node.append(form);return node;
}
async function refresh(){
 const data=await request('data'),reports=Array.isArray(data.reports)?data.reports.filter(record=>record.resolution==='open'):null,removed=production?data.removals:data.removed;if(!reports||!Array.isArray(removed)||production&&(typeof data.truncated!=='boolean'||typeof data.removalsTruncated!=='boolean'))throw new Error('The server response could not be read. Refresh before retrying.');
 for(const id of ['reports','removed','history'])$(id).replaceChildren();for(const record of reports)$('reports').append(card(record,true));for(const record of removed)$('removed').append(card(record,false));
 if(!production){if(!Array.isArray(data.history))throw new Error('The server response could not be read. Refresh before retrying.');for(const h of data.history){const item=element('p',`${new Date(h.createdAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})} · ${displayLabel(h.action)}\n${displayLabel(h.beforeStatus)} → ${displayLabel(h.afterStatus)}${h.reportReason?'\nReported: '+h.reportReason:''}\n${h.reason}`);item.className='history-item';$('history').append(item);}}
 for(const id of production?['reports','removed']:['reports','removed','history'])if(!$(id).children.length)$(id).append(element('p','None.'));
 $('login').hidden=true;$('workspace').hidden=false;if(production){if(data.truncated)$('reports').prepend(element('p','More than 100 open reports exist. Resolve visible reports, then refresh.'));if(data.removalsTruncated)$('removed').prepend(element('p','Older removals are not shown.'));}
}
$('login').onsubmit=e=>{e.preventDefault();const key=$('key').value;$('key').value='';run(async()=>{await request('login',{key});await refresh();notice('Signed in as local owner.');});};
$('refresh').onclick=()=>run(async()=>{await refresh();notice('Refreshed.');});
$('logout').onclick=()=>run(async()=>{try{const access=await request('session',{});await request('logout',{},access.csrf);}finally{clear();}notice('Owner session ended.');});
if(production){document.title='Gear owner review';$('title').textContent='Gear owner review';$('intro').textContent='Review reports and take action on Gear Exchange listings.';$('login').hidden=true;$('logout').hidden=true;$('history-section').hidden=true;run(async()=>{await request('session');await refresh();});}
else if(!local){clear();$('login').hidden=true;notice('Owner review requires the private admin site or local HTTPS preview.');}
else run(async()=>{try{await request('session',{});await refresh();}catch{clear();}});
