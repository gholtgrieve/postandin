import { CATEGORIES, SIZES, CONDITIONS, CLUBS, LIMITS, matchesListing, clubNames, offerFields, formatPrice, normalize } from '../lib/gear-exchange.mjs';

(async()=>{
const root=document.getElementById('pi-gear-preview');
const $=s=>root.querySelector(s);
const localMode=root.dataset.localApi==='true';
const adapter=localMode?await import('./local-api.mjs'):null;
const api=adapter?.localAPI();
let localBusy=false,verificationReceipt=null,loginReceipt=null,emailChangeReceipt=null,localDraftId=null,signedIn=false;
const localNotice=document.createElement('p');localNotice.id='pi-local-notice';localNotice.className='pi-error';localNotice.tabIndex=-1;localNotice.setAttribute('role','alert');localNotice.hidden=true;root.prepend(localNotice);
function showLocalError(message){localNotice.textContent=message;localNotice.hidden=false;localNotice.focus();localNotice.scrollIntoView({block:'center'});}
function clearLocalAccess(){resetEmailChange();if($('#pi-change-email')){$('#pi-change-email').value='';$('#pi-change-email').setCustomValidity('');}signedIn=false;managed.length=0;renderManaged();$('#pi-recovery-form').hidden=false;}
function serverField(error){
 if(error.emailChange&&error.fields?.email){const input=$('#pi-change-email');input.setCustomValidity(error.fields.email);return input;}
 const fields={title:'pi-post-name',description:'pi-post-description',category:'pi-post-category',size:'pi-post-size',fit:'pi-post-fit',condition:'pi-post-condition',city:'pi-post-city',priceCents:'pi-post-price',trade:'pi-post-trade',sellerName:'pi-post-seller',email:'pi-post-email',adult:'pi-adult',otherClub:'pi-other-club'};
 for(const [key,message] of Object.entries(error.fields||{})){
  const input=$('#'+fields[key]);if(!input)continue;
  input.setCustomValidity(message);showPostStep(Number(input.closest('[data-post-step]').dataset.postStep));return input;
 }
 return null;
}
async function localAction(task){
 if(localBusy)return;localBusy=true;localNotice.hidden=true;root.setAttribute('aria-busy','true');
 const active=document.activeElement,action=active?.dataset?.manage,id=active?.dataset?.id;
 const controls=[...root.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);
 // Keep fields frozen during requests; validation itself runs before disabling fields.
 controls.filter(([el])=>el.tagName==='BUTTON').forEach(([el])=>el.disabled=true);
 let invalid=null,focusTarget=null;
 try{focusTarget=await task();}catch(error){if(error.status===401){clearLocalAccess();feedback('Your session has ended. Request a new local management link.');}invalid=serverField(error);if(!invalid){if(!error.safe)console.error(error);showLocalError(error.safe?error.message:'Unable to complete this request. Please try again.');}}
 finally{
  controls.forEach(([el,disabled])=>el.disabled=disabled);localBusy=false;root.removeAttribute('aria-busy');
  if(invalid){invalid.focus();invalid.scrollIntoView({block:'center'});invalid.reportValidity();}
  else if(focusTarget){$(focusTarget)?.focus();}
  else if(document.activeElement===document.body){const target=action?[...root.querySelectorAll('[data-manage]')].find(b=>b.dataset.id===id&&b.dataset.manage===action):active;if(target?.isConnected&&!target.disabled&&target.getClientRects().length)target.focus();else if(!$('.pi-manage').hidden){const heading=$('.pi-manage h1');heading.tabIndex=-1;heading.focus();}}
 }
}
function freezeFields(){root.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);}
async function refreshLocal(){
 const publicRows=await api.request('/listings');data.splice(0,data.length,...publicRows.listings.map(adapter.previewListing));
 const cities=new Map();for(const row of data){const key=normalize(row.city);if(!cities.has(key))cities.set(key,row.city);}
 const selected=cities.get(normalize(state.area));state.area=selected||'';
 options('#pi-area',[...cities.values()].sort((a,b)=>a.localeCompare(b)),'All cities');$('#pi-area').value=state.area;
 try{await api.session();const result=await api.request('/management/listings');signedIn=true;managed.splice(0,managed.length,...result.listings.map(adapter.previewListing));}catch(error){clearLocalAccess();if(error.status!==401)throw error;}
 if(state.screen==='detail'&&!data.some(r=>r.id===state.selected))state.screen='gear';renderManaged();render();
}
async function afterSuccess(message,screen){
 feedback(message);if(screen)go(screen);
 try{await refreshLocal();}catch{showLocalError(message+' The latest listing view could not be loaded. Use Refresh listings to retry.');}
}

const data=[
{title:'Bauer Vapor X3 junior skates',category:'Skates',size:'Junior',spec:'Size 3 · Regular width · Good condition',area:'Seattle',place:'Seattle',type:'Sale',price:65,age:'Today',icon:'footprints'},
{title:'CCM Jetspeed FT6 Pro stick',category:'Sticks',size:'Intermediate',spec:'Left shot · 55 flex · P29 curve',area:'Eastside',place:'Kirkland',type:'Sale',price:85,age:'Today',icon:'goal'},
{title:'Youth starter gear bundle',category:'Bundles',size:'Youth',spec:'Gloves, shin pads & elbow pads · Used',area:'North Sound',place:'Lynnwood',type:'Free',price:0,age:'Today',icon:'package'},
{title:'Bauer Re-Akt 85 helmet with cage',category:'Protective gear',size:'Senior',spec:'Medium · Condition details with listing',area:'Eastside',place:'Renton',type:'Sale',price:55,age:'Yesterday',icon:'shield'},
{title:'Warrior Ritual goalie pads',category:'Goalie gear',size:'Junior',spec:'28+1 in · Trade for 30+1 in pads',area:'North Sound',place:'Everett',type:'Trade',price:null,age:'Yesterday',icon:'columns-2'},
{title:'CCM Tacks junior gloves',category:'Protective gear',size:'Junior',spec:'11 in · Navy · Good condition',area:'Eastside',place:'Snoqualmie',type:'Sale',price:25,age:'2 days ago',icon:'hand',pending:true},
{title:'Bauer carry bag',category:'Bags & accessories',size:'Senior',spec:'Senior size · Black · All zippers work',area:'South Sound',place:'Kent',type:'Sale',price:30,age:'2 days ago',icon:'briefcase'},
{title:'Practice jerseys — set of two',category:'Apparel',size:'Junior',spec:'Junior large · White & navy',area:'Seattle',place:'Seattle',type:'Free',price:0,age:'3 days ago',icon:'shirt'}
];
const descriptions=[
{seller:'Alex',description:'Outgrown after a season of practices and weekend games. A solid pair for the next player moving into junior skates. Includes the original footbeds and laces. Scuffs on both toe caps. Laces are worn at the tips; see wear-detail photo.',fit:'Junior skate size 3, regular width.',condition:'Used — good'},
{seller:'Sam',description:'Moving to a higher flex. Left-handed intermediate stick used for practices. Contact me to arrange the exchange. Cosmetic marks on the shaft and tape residue on the blade.',fit:'Intermediate, left shot, 55 flex, P29 curve.',condition:'Used — good'},
{seller:'Jordan',description:'A starter set our family has outgrown. Includes gloves, shin pads, and elbow pads. Offering the bundle together to another hockey family. Visible wear on glove palms and straps. Photos show the individual pieces.',fit:'Youth assorted sizes; ask for individual measurements.',condition:'Used — fair'},
{seller:'Taylor',description:'Helmet and cage offered together. Please ask about fit and the equipment history before arranging pickup. Shell has surface scratches and cage has worn paint. Full impact history is unknown; seller-provided details are not a safety certification.',fit:'Senior medium, adjustable fit.',condition:'Used — fair'},
{seller:'Casey',description:'Looking to size up. Interested in trading these junior pads for a 30+1 inch set in similar condition. Send details of what you have. Wear along the inner edges and at the toe ties.',fit:'Junior, 28+1 inches.',condition:'Used — good'},
{seller:'Morgan',description:'Navy junior gloves, recently outgrown. A pickup is currently being arranged; you can ask to be contacted if it falls through. Palm discoloration and light wear at the fingertips.',fit:'Junior, 11 inches.',condition:'Used — good'},
{seller:'Jamie',description:'Full-size carry bag with room for a senior set of gear. All zippers work. Located in Kent. Scuffs on the bottom and a small snag in the outer fabric.',fit:'Senior equipment bag.',condition:'Used — good'},
{seller:'Drew',description:'One white and one navy practice jersey. Both washed and ready for another season. Please take the pair. Small puck marks on the white jersey.',fit:'Junior large.',condition:'Used — good'}
];
data.forEach((d,i)=>Object.assign(d,descriptions[i],{id:String(i),club:i===6?'Seattle Junior':i===7?'Sno-King':''}));
data[6].title='Seattle Junior Bauer carry bag';data[6].description='Club-branded carry bag with room for a full set of gear. All zippers work. Located in Kent. Scuffs on the bottom and a small snag in the outer fabric.';
const state={screen:'gear',q:'',category:'',size:'',area:'',club:'',price:'',type:'All',sort:'new',selected:'0'};
function options(id, values, placeholder){const select=$(id);select.replaceChildren(new Option(placeholder,''),...values.map(v=>new Option(v,v)));}
for(const [id,values,label] of [['#pi-category',CATEGORIES,'All gear'],['#pi-post-category',CATEGORIES,'Choose a category'],['#pi-size',SIZES,'All sizes'],['#pi-post-size',SIZES,'Choose a size group'],['#pi-post-condition',CONDITIONS,'Choose condition'],['#pi-club',CLUBS,'All clubs'],['#pi-area',[...new Set(data.map(d=>d.place))].sort(),'All cities']])options(id,values,label);
$('.pi-club-checks').replaceChildren(...CLUBS.map(club=>{const label=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.name='club';input.value=club;label.append(input,club==='Other'?'Other club':club);return label;}));
$('.pi-filter-disclosure').open=matchMedia('(min-width:721px)').matches;
data.forEach(d=>{d.clubs=d.club?[d.club]:[];d.otherClub='';d.city=d.place;d.priceCents=d.price===null?null:Math.round(d.price*100);d.photos=[];});
data[0].photos=[{name:'Side view'},{name:'Front view'},{name:'Wear detail'}];
data[4].trade='30+1 inch goalie pads in similar condition';
data[6].size='One size';data[7].size='Mixed sizes';data[7].clubs=['Sno-King','Other'];data[7].otherClub='Example Hockey';
function renderDetail(){
const d=data.find(d=>d.id===state.selected)||data[0];if(!d)return;
$('#pi-detail-category').textContent=d.category+' / '+d.size+(clubNames(d).length?' / '+clubNames(d).join(', '):'');
$('#pi-detail-title').textContent=d.title;
$('#pi-detail-location').textContent=d.place;
$('#pi-detail-age').textContent=localMode?'':'Posted '+d.age.toLowerCase();
$('#pi-offer-type').textContent=d.type==='Sale'?'For sale · Local pickup':d.type==='Trade'?'For trade · Local pickup':'Free · Local pickup';
$('#pi-detail-price').textContent=formatPrice(d.type.toLowerCase(),d.priceCents);
$('#pi-availability').textContent=d.pending?'Pending pickup':'Available';
$('#pi-description').textContent=d.description;
$('#pi-fit').textContent=d.fit;$('#pi-condition').textContent=d.condition;
$('#pi-seller-name').textContent=d.seller;$('#pi-trade-fact').hidden=d.type!=='Trade';$('#pi-trade-detail').textContent=d.trade||'';
const stage=$('.pi-photo-stage'), picker=$('.pi-photo-picker');stage.replaceChildren();picker.replaceChildren();
const photos=d.photos||[];picker.hidden=photos.length<2;
function show(p){stage.replaceChildren();if(p?.url){const img=document.createElement('img');img.src=p.url;img.alt=d.title;stage.append(img);}else stage.textContent=p?'Sample photo':'No photos provided';}
show(photos[0]);photos.forEach((p,i)=>{const b=document.createElement('button');b.type='button';b.textContent='Photo '+(i+1);b.setAttribute('aria-pressed',String(i===0));b.onclick=()=>{show(p);picker.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));};picker.append(b);});
}
function resetContact(){
for(const id of ['pi-buyer-name','pi-buyer-message'])$('#'+id).setCustomValidity('');
$('#pi-contact-form').reset();$('#pi-contact-form').hidden=true;$('#pi-contact-intro').hidden=false;$('#pi-contact-success').hidden=true;
$('#pi-report-form').reset();$('#pi-report-form').hidden=true;$('#pi-report-result').hidden=true;$('#pi-report-open').hidden=false;
}
function render(){
if(localMode&&state.screen==='detail'&&!data.length)state.screen='gear';
$('.pi-home').hidden=state.screen!=='home';$('.pi-gear').hidden=state.screen!=='gear';$('.pi-detail').hidden=state.screen!=='detail';$('.pi-post').hidden=state.screen!=='post';$('.pi-manage').hidden=state.screen!=='manage';$('.pi-section').hidden=state.screen==='home';$('.pi-back').hidden=state.screen==='home';renderDetail();
root.querySelectorAll('[data-screen]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.screen===state.screen)));
root.querySelectorAll('[data-type]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.type===state.type)));
let rows=data.filter(d=>matchesListing({...d,type:d.type.toLowerCase()},{q:state.q,category:state.category,size:state.size,city:state.area,club:state.club,maxPrice:state.price,type:state.type==='All'?'':state.type.toLowerCase()}));
if(state.sort!=='new')rows.sort((a,b)=>{if(a.priceCents===null)return b.priceCents===null?0:1;if(b.priceCents===null)return -1;return state.sort==='low'?a.priceCents-b.priceCents:b.priceCents-a.priceCents;});
$('.pi-results').innerHTML=rows.map(d=>`<article class="pi-row"><div class="pi-thumb"><span aria-hidden="true">◇</span><span>${d.photos.length?"Photo":"No photo"}</span></div><div><h2><button type="button" class="pi-listing-link" data-listing="${esc(d.id)}">${esc(d.title)}</button>${d.pending?'<span class="pi-status">Pending</span>':''}</h2><div class="pi-specs">${esc(d.fit)} · ${esc(d.condition)}</div><div class="pi-location">${esc(d.place)}</div>${d.clubs.length?`<div class="pi-club-tag">${esc(clubNames(d).join(", "))}</div>`:""}</div><div class="pi-money"><div class="pi-price">${esc(formatPrice(d.type.toLowerCase(),d.priceCents))}</div><small>${esc(d.age)}</small></div></article>`).join('');
$('#pi-count').textContent=rows.length+' '+(rows.length===1?'listing':'listings');
$('.pi-empty').hidden=rows.length>0;
$('.pi-clear').hidden=!(state.q||state.category||state.size||state.area||state.club||state.price!==''||state.type!=='All');
}
function syncInputs(){for(const [id,key]of [['pi-search','q'],['pi-category','category'],['pi-size','size'],['pi-area','area'],['pi-club','club'],['pi-price','price'],['pi-sort','sort']])$('#'+id).value=state[key];}
function clear(){Object.assign(state,{q:'',category:'',size:'',area:'',club:'',price:'',type:'All'});syncInputs();render();}
root.querySelectorAll('[data-screen],[data-go]').forEach(b=>b.addEventListener('click',()=>{const target=b.dataset.screen||b.dataset.go;if(target==='post'&&state.screen!=='post'){startNew();return;}resetContact();go(target);}));
$('.pi-results').addEventListener('click',e=>{const link=e.target.closest('[data-listing]');if(!link)return;e.preventDefault();state.selected=link.dataset.listing;state.screen='detail';resetContact();render();$('.pi-return').focus({preventScroll:true});root.scrollIntoView({block:'start',behavior:'instant'});});
function openContact(){$('#pi-contact-intro').hidden=true;$('#pi-contact-form').hidden=false;$('#pi-contact-success').hidden=true;$('#pi-buyer-name').focus({preventScroll:true});}
$('#pi-contact-open').addEventListener('click',openContact);
$('#pi-contact-cancel').addEventListener('click',()=>{resetContact();$('#pi-contact-open').focus({preventScroll:true});});
$('#pi-contact-again').addEventListener('click',openContact);
$('#pi-contact-form').addEventListener('submit',e=>e.preventDefault());
$('#pi-contact-form').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.preventDefault();$('#pi-preview-send').click();}});
$('#pi-preview-send').addEventListener('click',()=>{const form=$('#pi-contact-form');for(const el of [$('#pi-buyer-name'),$('#pi-buyer-message')])el.setCustomValidity(el.value.trim()?'':'Please enter '+(el.id==='pi-buyer-name'?'your first name.':'a message.'));if(!form.reportValidity())return;form.reset();form.hidden=true;$('#pi-contact-success').hidden=false;$('#pi-contact-again').focus({preventScroll:true});});
for(const id of ['pi-buyer-name','pi-buyer-message'])$('#'+id).addEventListener('input',e=>e.target.setCustomValidity(''));
$('#pi-report-open').addEventListener('click',()=>{$('#pi-report-form').hidden=false;$('#pi-report-open').hidden=true;$('#pi-report-reason').focus({preventScroll:true});});
$('#pi-report-cancel').addEventListener('click',()=>{$('#pi-report-form').hidden=true;$('#pi-report-form').reset();$('#pi-report-open').hidden=false;$('#pi-report-open').focus({preventScroll:true});});
$('#pi-report-form').addEventListener('submit',e=>e.preventDefault());
$('#pi-preview-report').addEventListener('click',()=>{if(!$('#pi-report-form').reportValidity())return;$('#pi-report-form').hidden=true;$('#pi-report-result').hidden=false;});
root.querySelectorAll('[data-type]').forEach(b=>b.addEventListener('click',()=>{state.type=b.dataset.type;render();}));
for(const [id,key]of [['pi-search','q'],['pi-category','category'],['pi-size','size'],['pi-area','area'],['pi-club','club'],['pi-price','price'],['pi-sort','sort']])$('#'+id).addEventListener('input',e=>{state[key]=e.target.value;render();});
$('.pi-clear').addEventListener('click',clear);$('[data-clear]').addEventListener('click',clear);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let postStep=1, editingId=null, pendingDraft=null, postPhotos=[];
const objectUrls=new Set();
const managed=[{id:'sample-expired',title:'Sno-King practice jersey',type:'Free',priceCents:0,category:'Apparel',size:'Junior',fit:'Junior large',condition:'Used — good',city:'Renton',clubs:['Sno-King'],description:'Club practice jersey, recently outgrown. A few small puck marks.',seller:'Alex',email:'seller@example.com',photos:[],status:'Expired',expires:null}];
const postMap={title:'pi-post-name',price:'pi-post-price',category:'pi-post-category',size:'pi-post-size',fit:'pi-post-fit',condition:'pi-post-condition',city:'pi-post-city',description:'pi-post-description',seller:'pi-post-seller',email:'pi-post-email',trade:'pi-post-trade'};
for(const [id,key] of Object.entries({...Object.fromEntries(Object.entries(postMap).filter(([k])=>k!=='price').map(([k,v])=>[v,k==='seller'?'name':k])), 'pi-other-club':'otherClub','pi-buyer-name':'name','pi-buyer-email':'email','pi-buyer-message':'message','pi-recovery-email':'email'})){if(LIMITS[key])$('#'+id).maxLength=LIMITS[key];}
$('#pi-post-price').min=String(LIMITS.minPriceCents/100);$('#pi-post-price').max=String(LIMITS.maxPriceCents/100);
function go(screen){state.screen=screen;render();if(localMode&&['gear','manage'].includes(screen))localAction(refreshLocal);const heading=$('.pi-'+state.screen+' h1');heading.tabIndex=-1;heading.focus();root.scrollIntoView({block:'start',behavior:'instant'});}
function showPostStep(step){postStep=step;$('#pi-post-title').tabIndex=-1;$('#pi-post-title').focus();$('#pi-post-form').hidden=false;$('#pi-verify-screen').hidden=true;root.querySelectorAll('[data-post-step]').forEach(el=>el.hidden=Number(el.dataset.postStep)!==step);root.querySelectorAll('[data-step-label]').forEach(el=>{if(Number(el.dataset.stepLabel)===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');});}
function offerChanged(){const type=$('input[name=offer]:checked').value;$('#pi-asking-label').hidden=type!=='Sale';$('#pi-post-price').disabled=type!=='Sale';$('#pi-trade-label').hidden=type!=='Trade';$('#pi-post-trade').disabled=type!=='Trade';$('#pi-post-trade').required=type==='Trade';}
function clubsChanged(){const other=$('input[name=club][value=Other]').checked;$('#pi-other-club').required=other;if(!other){$('#pi-other-club').value='';$('#pi-other-club').setCustomValidity('');}}
$('#pi-other-club').addEventListener('input',()=>{const filled=$('#pi-other-club').value.trim().length>0;$('input[name=club][value=Other]').checked=filled;$('#pi-other-club').required=filled;});
function validStep(n){let valid=true;const fields=root.querySelectorAll('[data-post-step="'+n+'"] input,[data-post-step="'+n+'"] select,[data-post-step="'+n+'"] textarea');for(const el of fields){if(el.disabled||el.type==='file')continue;if(el.required&&['text','textarea'].includes(el.type))el.setCustomValidity(el.value.trim()?'':'Please complete this field.');if(!el.checkValidity()){el.reportValidity();valid=false;break;}}return valid;}
function draft(){const d={};for(const [key,id]of Object.entries(postMap))d[key]=$('#'+id).value.trim();d.type=$('input[name=offer]:checked').value;Object.assign(d,offerFields(d.type.toLowerCase(),d.price,d.trade));delete d.price;d.clubs=[...root.querySelectorAll('input[name=club]:checked')].map(e=>e.value);d.otherClub=$('#pi-other-club').value.trim();d.photos=postPhotos.map(p=>({...p}));return d;}
function renderPhotos(){const list=$('#pi-upload-grid');list.replaceChildren();postPhotos.forEach((p,i)=>{const tile=document.createElement('div');tile.className='pi-upload-tile';if(p.url){const image=document.createElement('img');image.className='pi-upload-image';image.src=p.url;image.alt='Selected photo '+(i+1);tile.append(image);}else{const placeholder=document.createElement('div');placeholder.className='pi-upload-image';placeholder.textContent='Sample photo '+(i+1);tile.append(placeholder);}const label=document.createElement('small');label.textContent=p.name;tile.append(label);const actions=document.createElement('div');actions.className='pi-photo-tools';const main=document.createElement('button');main.type='button';main.textContent=i===0?'Main photo':'Make main';main.setAttribute('aria-pressed',String(i===0));main.addEventListener('click',()=>{postPhotos.unshift(postPhotos.splice(i,1)[0]);renderPhotos();});const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove photo '+(i+1));remove.addEventListener('click',()=>{postPhotos.splice(i,1);$('#pi-photo-error').hidden=true;renderPhotos();});actions.append(main,remove);tile.append(actions);list.append(tile);});$('#pi-photo-count').textContent=postPhotos.length+' of 6';}
function photoError(message){$('#pi-photo-error').textContent=message;$('#pi-photo-error').hidden=false;}
$('#pi-photo-files').addEventListener('change',e=>{const files=[...e.target.files];e.target.value='';if(files.length+postPhotos.length>LIMITS.photos){photoError('Choose up to six photos. Remove a photo before adding another.');return;}if(files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type))){photoError('Choose JPG, PNG, or WebP images for this preview.');return;}for(const file of files){const url=URL.createObjectURL(file);objectUrls.add(url);postPhotos.push({name:file.name,url});}$('#pi-photo-error').hidden=true;renderPhotos();});
$('#pi-add-sample').addEventListener('click',()=>{if(postPhotos.length>=LIMITS.photos){photoError('Six photos is the limit. Remove a photo before adding another.');return;}postPhotos.push({name:'Sample gear photo',url:null});$('#pi-photo-error').hidden=true;renderPhotos();});
window.addEventListener('pagehide',()=>objectUrls.forEach(url=>URL.revokeObjectURL(url)));
function renderReview(){const d=draft();const price=formatPrice(d.type.toLowerCase(),d.priceCents);const details=[['City',d.city],['Gear',d.category+' · '+d.size],['Size & fit',d.fit],['Club branding',clubNames(d).join(', ')||'None'],['Condition',d.condition],['Photos',d.photos.length+' of 6'],['Listed by',d.seller]];if(d.type==='Trade')details.push(['Looking for',d.trade]);$('#pi-listing-review').innerHTML='<div class="pi-eyebrow">Listing preview</div><h2>'+esc(d.title)+'</h2><div class="pi-detail-price">'+esc(price)+'</div><p>'+esc(d.description)+'</p><dl>'+details.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';const record=managed.find(r=>r.id===editingId);const reverify=localMode?!editingId:!record||d.email!==record.email;$('#pi-post-submit').textContent=reverify?'Continue to verification →':'Save changes';$('#pi-publish-explanation').textContent=reverify?'Your listing appears after you verify your email. It expires after 30 days.':'Changes will update your listing. Its status and expiration date stay the same.';}
root.querySelectorAll('input[name=offer]').forEach(el=>el.addEventListener('change',offerChanged));root.querySelectorAll('input[name=club]').forEach(el=>el.addEventListener('change',clubsChanged));
$('#pi-post-form').addEventListener('submit',e=>e.preventDefault());$('#pi-post-form').addEventListener('input',e=>{if(e.target.setCustomValidity)e.target.setCustomValidity('');});
$('#pi-next-photos').addEventListener('click',()=>{if(validStep(1)){showPostStep(2);$(localMode?'#pi-post-seller':'#pi-add-sample').focus({preventScroll:true});}});
$('#pi-next-review').addEventListener('click',()=>{if(validStep(2)){renderReview();showPostStep(3);}});
root.querySelectorAll('[data-post-back]').forEach(el=>el.addEventListener('click',()=>showPostStep(Number(el.dataset.postBack))));
function resetPost(){if(localMode){$('#pi-post-email').disabled=false;$('#pi-post-email').closest('label').hidden=false;$('.pi-contact-fields > .pi-field-help').hidden=false;$('.pi-age-check').hidden=false;$('#pi-adult').disabled=false;verificationReceipt=null;localDraftId=null;}editingId=null;pendingDraft=null;postPhotos=[];$('#pi-post-form').reset();root.querySelectorAll('#pi-post-form input,#pi-post-form textarea').forEach(el=>el.setCustomValidity(''));$('#pi-post-title').textContent='List Your Gear';$('#pi-photo-error').hidden=true;offerChanged();clubsChanged();renderPhotos();showPostStep(1);}
function fillPost(d){for(const [key,id]of Object.entries(postMap))$('#'+id).value=key==='price'?(d.type==='Sale'?(d.priceCents/100).toFixed(2):''):(d[key]??'');$('input[name=offer][value="'+d.type+'"]').checked=true;root.querySelectorAll('input[name=club]').forEach(el=>el.checked=d.clubs.includes(el.value));$('#pi-other-club').value=d.otherClub||'';$('#pi-adult').checked=true;postPhotos=localMode?[]:d.photos.map(p=>({...p}));offerChanged();clubsChanged();renderPhotos();}
$('#pi-fill-demo').addEventListener('click',()=>{resetPost();fillPost({title:'Seattle Junior hockey bag',type:'Sale',priceCents:4000,category:'Bags & accessories',size:'Junior',fit:'Junior bag, 30 × 18 × 15 in',condition:'Used — good',city:'Seattle',clubs:['Seattle Junior'],description:'Seattle Junior branded bag. Our player has changed clubs, so this is ready for another family. Scuffs on the bottom. All zippers work.',seller:'Alex',email:'seller@example.com',photos:[{name:'Front view — sample',url:null},{name:'Club logo — sample',url:null},{name:'Wear detail — sample',url:null}]});});
function activeCount(){return managed.filter(r=>['Available','Pending'].includes(r.status)).length;}
function feedback(message){$('#pi-manage-feedback').textContent=message;$('#pi-manage-feedback').hidden=false;}
function expiry(){return Date.now()+LIMITS.durationDays*24*60*60*1000;}
function renderManaged(){if(localMode){renderLocalManaged();return;}$('#pi-active-count').textContent=activeCount()+' of 10 active listings';$('#pi-managed-list').innerHTML=managed.map(r=>'<article class="pi-managed-item"><h2>'+esc(r.title)+'</h2><div class="pi-managed-meta">'+esc(formatPrice(r.type.toLowerCase(),r.priceCents))+' · '+esc(r.city)+' · '+esc(r.status)+(r.expires&&['Available','Pending'].includes(r.status)?' · Expires '+new Date(r.expires).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'')+'</div><div class="pi-managed-actions"><button type="button" data-manage="edit" data-id="'+esc(r.id)+'">Edit</button>'+(['Available','Pending'].includes(r.status)?'<button type="button" data-manage="pending" data-id="'+esc(r.id)+'">'+(r.status==='Pending'?'Mark available':'Mark pending')+'</button><button type="button" data-manage="close" data-id="'+esc(r.id)+'">Close listing</button>':'<button type="button" data-manage="renew" data-id="'+esc(r.id)+'">'+(r.status==='Closed'?'Relist for 30 days':'Renew for 30 days')+'</button>')+'<button type="button" data-manage="delete" data-id="'+esc(r.id)+'">Delete listing</button></div></article>').join('');}
$('#pi-post-submit').addEventListener('click',()=>{if(localMode){localAction(saveLocal);return;}if(!validStep(1)){showPostStep(1);return;}if(!validStep(2)){showPostStep(2);return;}const d=draft();const existing=managed.find(r=>r.id===editingId);if(existing&&existing.email===d.email){Object.assign(existing,d);renderManaged();feedback('Changes saved in this preview.');go('manage');return;}if(!existing&&activeCount()>=LIMITS.activeListings){feedback('You have ten active listings. Close a listing before adding another.');go('manage');return;}pendingDraft=d;$('#pi-verify-email').textContent=d.email;$('#pi-email-item').textContent=d.title;$('#pi-post-form').hidden=true;$('#pi-verify-screen').hidden=false;});
$('#pi-simulate-verify').addEventListener('click',()=>{if(localMode){localAction(verifyLocal);return;}if(!pendingDraft)return;const existing=managed.find(r=>r.id===editingId);if(existing){Object.assign(existing,pendingDraft);}else{if(activeCount()>=LIMITS.activeListings){feedback('You have ten active listings. Close one before publishing another.');go('manage');return;}managed.unshift({...pendingDraft,id:'demo-'+Date.now(),status:'Available',expires:expiry()});}pendingDraft=null;renderManaged();feedback('Verification simulated. Your sample listing is ready to manage; nothing was published.');go('manage');});
function startNew(){if(activeCount()>=LIMITS.activeListings){feedback('You have ten active listings. Close one before adding another.');go('manage');return;}resetPost();go('post');}
$('#pi-new-listing').addEventListener('click',startNew);
$('#pi-managed-list').addEventListener('click',e=>{if(localMode){manageLocal(e);return;}const b=e.target.closest('[data-manage]');if(!b)return;const r=managed.find(r=>r.id===b.dataset.id);if(!r)return;switch(b.dataset.manage){case'delete':deleteId=r.id;$('#pi-delete-dialog').showModal();$('#pi-delete-cancel').focus();return;case'edit':resetPost();editingId=r.id;fillPost(r);$('#pi-post-title').textContent='Edit Your Listing';go('post');return;case'pending':r.status=r.status==='Pending'?'Available':'Pending';break;case'close':r.status='Closed';break;case'renew':if(activeCount()>=LIMITS.activeListings){feedback('Close another listing before renewing this one.');return;}r.status='Available';r.expires=expiry();break;}renderManaged();feedback(r.title+' — '+r.status.toLowerCase()+' in this preview.');});
$('#pi-recovery-open').addEventListener('click',()=>{$('#pi-recovery-form').hidden=!$('#pi-recovery-form').hidden;});$('#pi-recovery-form').addEventListener('submit',e=>e.preventDefault());$('#pi-recovery-send').addEventListener('click',()=>{if(localMode){localAction(requestLocalLogin);return;}if($('#pi-recovery-form').reportValidity())$('#pi-recovery-result').hidden=false;});

function renderLocalManaged(){
 if($('#pi-email-change'))$('#pi-email-change').hidden=!signedIn;
 $('#pi-active-count').textContent=activeCount()+' of 10 active listings';
 $('#pi-managed-list').innerHTML=managed.map(r=>{
  const button=(action,label)=>`<button type="button" data-manage="${action}" data-id="${esc(r.id)}">${label}</button>`;
  const actions=r.status==='Removed'?'':button('edit','Edit')+(['Available','Pending'].includes(r.status)?button('pending',r.status==='Pending'?'Mark available':'Mark pending')+button('close','Close listing'):button('renew','Relist for 30 days'));
  return `<article class="pi-managed-item"><h2>${esc(r.title)}</h2><div class="pi-managed-meta">${esc(formatPrice(r.type.toLowerCase(),r.priceCents))} · ${esc(r.city)} · ${esc(r.status)}</div><div class="pi-managed-actions">${actions}</div></article>`;
 }).join('')||(signedIn?'<p>You have no verified listings to manage.</p>':'<p>Sign in with a local management link to see your listings.</p>');
}
async function saveLocal(){
 if(!validStep(1)){showPostStep(1);return;}if(!validStep(2)){showPostStep(2);return;}
 const d=draft(),input=adapter.listingInput(d,$('#pi-adult').checked,Boolean(editingId));freezeFields();
 if(editingId){await api.write({id:editingId,action:'edit',listing:input});await afterSuccess('Changes saved to the local database.','manage');return;}
 // Reuse an already-created draft when only receipt delivery failed and content is unchanged.
 if(!localDraftId||JSON.stringify(pendingDraft)!==JSON.stringify(d)){const created=await api.request('/drafts',input);localDraftId=created.id;pendingDraft=d;verificationReceipt=null;}
 await requestVerification();
}
async function requestVerification(){
 if(!localDraftId)throw adapter.safeError('Submit the listing form first.');
 verificationReceipt=(await api.request('/drafts/'+localDraftId+'/verification',{})).receipt;
 $('#pi-verify-email').textContent=pendingDraft.email;$('#pi-email-item').textContent=pendingDraft.title;
 $('#pi-post-form').hidden=true;$('#pi-verify-screen').hidden=false;
}
async function verifyLocal(){
 if(!verificationReceipt)throw adapter.safeError('Request a new local verification link below.');
 try{await api.request('/verification/confirm',{token:verificationReceipt.token,confirm:true});}
 catch(error){
  // A consumed token may mean its success response was lost. Only a public record
  // with our known draft ID establishes publication; otherwise retain retry state.
  const result=await api.request('/listings');if(!result.listings.some(row=>row.id===localDraftId))throw error;
 }
 verificationReceipt=null;localDraftId=null;$('#pi-recovery-email').value=pendingDraft.email;pendingDraft=null;
 loginReceipt=null;$('#pi-local-login').hidden=true;
 $('#pi-post-form').hidden=false;$('#pi-verify-screen').hidden=true;$('#pi-recovery-form').hidden=signedIn;
 await afterSuccess(signedIn?'Listing published locally.':'Listing published locally. Request and confirm a local management link below to sign in.','manage');
}
function manageLocal(e){
 const b=e.target.closest('[data-manage]');if(!b||localBusy)return;const r=managed.find(r=>r.id===b.dataset.id);if(!r)return;
 if(b.dataset.manage==='edit'){resetPost();editingId=r.id;fillPost(r);$('#pi-post-email').disabled=true;$('#pi-post-email').closest('label').hidden=true;$('.pi-contact-fields > .pi-field-help').hidden=true;$('.pi-age-check').hidden=true;$('#pi-adult').disabled=true;$('#pi-post-title').textContent='Edit Your Listing';go('post');return;}
 localAction(async()=>{try{await api.write({id:r.id,action:b.dataset.manage==='pending'?(r.status==='Pending'?'available':'pending'):b.dataset.manage==='renew'?'relist':'close'});}catch(error){try{await refreshLocal();}catch{}throw error;}await afterSuccess('Listing updated in the local database.');});
}
function resetEmailChange(){
 emailChangeReceipt=null;
 if(!$('#pi-change-confirm'))return;
 $('#pi-change-confirm').hidden=true;$('#pi-change-result').hidden=true;
}
async function requestEmailChange(){
 const form=$('#pi-email-change');if(!form.reportValidity())return;
 resetEmailChange();const email=$('#pi-change-email').value.trim().toLowerCase();freezeFields();
 try{await api.changeEmail(email);}catch(error){error.emailChange=true;if(error.status===403)throw adapter.safeError('Unable to request this change. Use a different email address and check that you are still signed in.');throw error;}
 const mailbox=await api.request('/local/email-change-mail');
 emailChangeReceipt=mailbox.receipts.filter(r=>r.recipient===email).at(-1)||null;
 if(!emailChangeReceipt)throw adapter.safeError('The local receipt is unavailable. Request a new link.');
 $('#pi-change-confirm').textContent='Confirm local change to '+email;
 $('#pi-change-confirm').hidden=false;$('#pi-change-result').hidden=false;
 $('#pi-change-result').textContent='A new link is ready in the simulated local inbox. No email was sent. Confirm within 30 minutes while your current session is still valid.';
}
async function confirmEmailChange(){
 if(!emailChangeReceipt||emailChangeReceipt.recipient!==$('#pi-change-email').value.trim().toLowerCase())throw adapter.safeError('Request a new link for the current email address.');
 const email=emailChangeReceipt.recipient;freezeFields();
 try{await api.request('/management/email-change/confirm',{token:emailChangeReceipt.token,confirm:true});}
 catch(error){
  try{await refreshLocal();}catch{clearLocalAccess();}
  if(error.status===400)throw adapter.safeError('Unable to confirm this change. The link may have expired or your session may have ended. An existing account may also have duplicate gear or exceed the ten-active-listing limit. Resolve any listing conflict and retry, or request a new link.');
  throw adapter.safeError('The email change could not be confirmed. Request a management link for the new address to check your listings before trying again.');
 }
 clearLocalAccess();loginReceipt=null;$('#pi-local-login').hidden=true;
 $('#pi-recovery-email').value=email;
 await afterSuccess('Email changed locally. Existing management sessions have ended. Request a new management link below to sign in.','manage');
 return '#pi-recovery-email';
}
async function requestLocalLogin(){
 if(!$('#pi-recovery-form').reportValidity())return;
 loginReceipt=null;$('#pi-local-login').hidden=true;
 const email=$('#pi-recovery-email').value.trim().toLowerCase();freezeFields();await api.request('/management/recovery',{email});
 const mailbox=await api.request('/local/management-mail');loginReceipt=mailbox.receipts.filter(r=>r.recipient===email).at(-1)||null;
 $('#pi-recovery-result').hidden=false;$('#pi-local-login').hidden=!loginReceipt;
 if(loginReceipt)$('#pi-local-login').textContent='Confirm local link for '+loginReceipt.recipient;
}
if(localMode){
 data.length=0;managed.length=0;options('#pi-area',[],'All cities');
 $('.pi-preview-bar > span').textContent='LOCAL DATABASE PREVIEW · Listings are saved here · No real email';
 $('.pi-manage .pi-demo-note').textContent='Local simulated inbox · Sample addresses only; this does not prove email ownership';
 $('.pi-post .pi-demo-note').firstChild.textContent='Local sample data · Saved on this computer; no real email. ';
 $('#pi-simulate-verify').textContent='Confirm local verification';
 $('#pi-verify-screen > p').innerHTML='A simulated verification link is ready for <strong id="pi-verify-email"></strong>.';
 $('#pi-verify-screen > p:nth-of-type(2)').textContent='Confirm below to publish locally. Sign in separately to manage listings.';
 $('#pi-recovery-send').textContent='Request local management link';$('#pi-recovery-result').textContent='If verified listings match, a link is available in the simulated local inbox. No email was sent.';
 const confirm=document.createElement('button');confirm.type='button';confirm.id='pi-local-login';confirm.textContent='Confirm local management link';confirm.hidden=true;confirm.className='pi-primary';$('#pi-recovery-form').append(confirm);
 $('#pi-recovery-email').addEventListener('input',()=>{loginReceipt=null;confirm.hidden=true;});
 confirm.onclick=()=>localAction(async()=>{if(!loginReceipt||loginReceipt.recipient!==$('#pi-recovery-email').value.trim().toLowerCase())throw adapter.safeError('Request a new link for the current email address.');freezeFields();clearLocalAccess();await api.request('/management/confirm',{token:loginReceipt.token,confirm:true});loginReceipt=null;confirm.hidden=true;signedIn=true;await afterSuccess('Signed in locally.');});
 const logout=document.createElement('button');logout.type='button';logout.id='pi-local-logout';logout.textContent='Sign out';logout.className='pi-text-button';$('.pi-manage-toolbar').append(logout);logout.onclick=()=>localAction(async()=>{try{await api.logout();}catch(error){if(error.status!==401)throw error;}clearLocalAccess();loginReceipt=null;confirm.hidden=true;await afterSuccess('Signed out.');});
 const changeForm=document.createElement('form');changeForm.id='pi-email-change';changeForm.className='pi-seller-form pi-recovery';changeForm.hidden=true;
 changeForm.innerHTML='<h2>Change your email</h2><p>Move all your verified listings to a new email address. Confirming ends existing management sessions for both addresses. Unverified drafts stay with the original address.</p><label>New email<input id="pi-change-email" type="email" required autocomplete="email" placeholder="you@example.com"></label><button id="pi-change-request" class="pi-primary" type="submit">Request local email-change link</button><p id="pi-change-result" role="status" hidden></p><button id="pi-change-confirm" class="pi-primary" type="button" hidden>Confirm local email change</button>';
 $('.pi-manage').append(changeForm);$('#pi-change-email').maxLength=LIMITS.email;
 changeForm.addEventListener('submit',e=>{e.preventDefault();localAction(requestEmailChange);});
 $('#pi-change-email').addEventListener('input',e=>{e.target.setCustomValidity('');resetEmailChange();});
 $('#pi-change-confirm').onclick=()=>localAction(confirmEmailChange);
 const refresh=document.createElement('button');refresh.type='button';refresh.id='pi-local-refresh';refresh.className='pi-text-button';refresh.textContent='Refresh listings';$('.pi-manage-toolbar').append(refresh);refresh.onclick=()=>localAction(refreshLocal);
 const reissue=document.createElement('button');reissue.type='button';reissue.id='pi-local-reissue';reissue.className='pi-text-button';reissue.textContent='Request a new local verification link';$('#pi-verify-screen').append(reissue);reissue.onclick=()=>localAction(requestVerification);
 $('#pi-photo-files').disabled=true;$('#pi-add-sample').disabled=true;$('.pi-photo-heading + p').textContent='Photo storage is not connected yet. Local listings are saved without photos.';
}
resetPost();renderManaged();
let deleteId=null;
$('#pi-delete-cancel').onclick=()=>$('#pi-delete-dialog').close();
$('#pi-delete-confirm').onclick=()=>{const index=managed.findIndex(r=>r.id===deleteId);if(index>=0)managed.splice(index,1);$('#pi-delete-dialog').close();renderManaged();feedback('Listing deleted from this preview.');$('#pi-new-listing').focus();};
render();
if(localMode)await localAction(refreshLocal);
})();
