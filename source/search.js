import {element, money} from './orders-client.js';
const q=s=>document.querySelector(s), form=q('#parts-search-form'), source=q('#sourcing-form');
const levels=['make','model','year','engine','system','category'];
const labels={make:'Make',model:'Model',year:'Year',engine:'Engine',system:'Parts system',category:'Category'};
let endpoint='',sourcingEndpoint='',searchSequence=0,optionSequence=0,pending=null,lastContext='';
const fields=q('#vehicle-fields');
for(const name of levels){
  const label=element('label',labels[name]),select=element('select');select.name=name;select.setAttribute('form',form.id);select.disabled=true;
  select.append(new Option(`Any ${labels[name].toLowerCase()}`,''));label.append(select);fields.append(label);
}
const select=name=>fields.querySelector(`[name="${name}"]`);
function filters(){return Object.fromEntries(new FormData(form));}
function vehicleText(){const f=filters();return ['type',...levels].filter(k=>f[k]).map(k=>`${k==='type'?'Vehicle type':labels[k]}: ${f[k]}`).join(' · ');}
function context(){return JSON.stringify([q('#parts-query').value.trim(),vehicleText()]);}
function prefill(force=false,product=null){
  const c=context();
  if(force||c!==lastContext){source.elements.partNumber.value=q('#parts-query').value.trim();source.elements.vehicle.value=vehicleText();lastContext=c;}
  if(product){source.elements.keywords.value=`${product.brand} ${product.name}`;source.elements.partNumber.value=product.numbers.find(n=>n.kind!=='cross')?.number||q('#parts-query').value;source.elements.requirements.value=`Please verify ${product.sku}, availability and fitment before quoting.`;}
}
function openSource(product=null){prefill(false,product);q('#source-part').open=true;location.hash='source-part';source.elements.partNumber.focus({preventScroll:true});}
function button(text,fn){const b=element('button',text,'button');b.type='button';b.addEventListener('click',fn);return b;}
async function json(url,options={}){
  const r=await fetch(url,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(30000),...options});
  let d;try{d=await r.json();}catch{throw new Error('The parts service did not return a receipt. Keep your details and retry.');}
  if(!r.ok)throw new Error(d.error||'Service unavailable. Please retry.');return d;
}
async function options(start=0){
  if(!endpoint)return;
  const seq=++optionSequence;
  for(const name of levels.slice(start)){
    const el=select(name);el.disabled=true;
    const d=await json(`${endpoint}?${new URLSearchParams({...filters(),action:'options',level:name})}`);
    if(seq!==optionSequence)return;
    const value=el.value;el.replaceChildren(new Option(`Any ${labels[name].toLowerCase()}`,''));
    for(const v of d.options)el.append(new Option(String(v),String(v)));
    el.value=d.options.map(String).includes(value)?value:'';el.disabled=!d.options.length;
  }
  q('#vehicle-status').textContent=select('make').options.length===1?'No verified vehicle fitments are published yet. Enter your vehicle in a sourcing request.':'';
}
fields.addEventListener('change',async e=>{
  const index=e.target.name==='type'?-1:levels.indexOf(e.target.name);
  for(const key of levels.slice(index+1)){select(key).value='';select(key).disabled=true;}
  try{await options(index+1);prefill();}catch(err){q('#vehicle-status').textContent=err.message;}
});
q('#clear-vehicle').addEventListener('click',async()=>{
  select('type').value='';for(const name of levels)select(name).value='';
  try{await options();prefill(true);await search();}catch(e){q('#search-status').textContent=e.message;}
});
q('#vehicle-entry').addEventListener('click',()=>{q('#vehicle-picker').open=true;});
q('#source-entry').addEventListener('click',()=>openSource());
q('#fallback-source').addEventListener('click',()=>openSource());
document.querySelector('.find-banner a')?.addEventListener('click',e=>{e.preventDefault();openSource();});
function result(p){
  const article=element('article','','search-result');article.dataset.sku=p.sku;
  const image=element('div',p.image?'':'Product photo not supplied','result-image');
  if(p.image){const img=element('img');img.src=p.image;img.alt=p.name;img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>image.replaceChildren(element('span','Product photo unavailable')),{once:true});image.append(img);}
  const detail=element('div'),candidate=['fuzzy_candidate','keyword_candidate'].includes(p.matchType);
  const match={part_number_exact:'Exact part-number match',cross_reference_exact:'Verified cross-reference match',verified_catalog:'Documented catalogue fitment',keyword_candidate:'Keyword candidate — confirm part number & fitment',fuzzy_candidate:'Similar number only — NOT an exact match'};
  detail.append(element('span',match[p.matchType],`match-label${candidate?' candidate':''}`),element('h3',p.name),element('p',`${p.brand} · ${p.sku} · ${p.system} / ${p.category}`));
  const numbers=element('ul');for(const n of p.numbers)numbers.append(element('li',`${n.kind==='oem'?'OEM':n.kind==='cross'?'Cross-reference':'Manufacturer'} · ${n.brand}: ${n.number}`));detail.append(numbers);
  if(p.fitments.length){detail.append(element('strong','Documented vehicle fitment'));const list=element('ul');for(const v of p.fitments.slice(0,4))list.append(element('li',`${v.type==='moto'?'Motorcycle':'Auto'} · ${v.make} ${v.model} · ${v.year} · ${v.engine}`));detail.append(list);if(p.fitments.length>4)detail.append(element('p',`Plus ${p.fitments.length-4} more documented fitments; see evidence.`));}
  else detail.append(element('p','Vehicle fitment has not been verified. Ask us to confirm before ordering.'));
  const evidence=element('details');evidence.append(element('summary','View verification evidence'));
  for(const n of [...p.numbers,...p.fitments])evidence.append(element('p',`${n.number||`${n.make} ${n.model} ${n.year} ${n.engine}`} · ${n.source} · Checked ${n.verifiedAt}`));detail.append(evidence);
  const offer=element('div','','result-offer');offer.append(element('strong',p.unitPriceCents==null?'Request a quotation':money(p.unitPriceCents)),element('p',p.moq==null?'MOQ: confirm with sourcing team':`MOQ: ${p.moq}`),element('p',`Supply: ${{unconfirmed:'Not confirmed',on_request:'On request',available:'Supplier availability verified; reconfirm at quotation',unavailable:'Unavailable'}[p.supplyStatus]}`));
  if(!candidate&&p.supplyStatus!=='unavailable')offer.append(button('Add to mixed-parts cart',()=>{
    window.dispatchEvent(new CustomEvent('pb-add-product',{detail:{sku:p.sku,quantity:p.moq||1,specification:vehicleText()}}));
  }));
  offer.append(button(candidate?'Ask us to verify this candidate':'Request confirmation / quote',()=>openSource(p)));
  article.append(image,detail,offer);return article;
}
async function search(page=1){
  if(!endpoint)return;
  const seq=++searchSequence;
  q('#search-status').textContent='Searching verified catalogue records…';q('#search-results').setAttribute('aria-busy','true');
  try{
    const params={...filters(),page:String(page)};const d=await json(`${endpoint}?${new URLSearchParams(params)}`);
    if(seq!==searchSequence)return;
    const url=new URL(location.href);for(const [k,v] of Object.entries(params)){if(v)url.searchParams.set(k,v);else url.searchParams.delete(k);}url.searchParams.delete('page');history.replaceState(null,'',url);
    q('#search-results').replaceChildren(...d.products.map(result));q('#search-pagination').replaceChildren();
    if(page>1)q('#search-pagination').append(button('Previous results',()=>search(page-1)));
    if(page*24<d.total)q('#search-pagination').append(button('Next results',()=>search(page+1)));
    q('#search-status').textContent=!d.catalogCount?'No verified products have been published yet. Our team can source your part directly.':d.total?`${d.total} ${d.reliableMatch?'verified catalogue result(s)':'keyword candidate(s) — confirm before ordering'}. Part-number matches do not guarantee fitment for an unlisted vehicle.`:'No reliable catalogue match. Send your request below.';
    q('#sourcing-fallback').hidden=d.reliableMatch;q('#search-suggestions').replaceChildren();
    if(d.suggestions.length){q('#search-suggestions').append(element('h3','Similar numbers — candidates only'),element('p','These numbers differ from your search. They are not interchangeable without separate verification.'),...d.suggestions.map(result));}
    prefill();
  }catch(e){if(seq===searchSequence){q('#search-results').replaceChildren();q('#search-status').textContent=e.message;q('#sourcing-fallback').hidden=false;}}
  finally{if(seq===searchSequence)q('#search-results').removeAttribute('aria-busy');}
}
form.addEventListener('submit',e=>{e.preventDefault();search();location.hash='find-parts';});
source.addEventListener('submit',async e=>{
  e.preventDefault();if(!sourcingEndpoint)return;
  const submit=q('#submit-sourcing');submit.disabled=true;
  try{
    const fd=new FormData(source),files=[...source.elements['photos[]'].files];
    if(files.length>3||files.some(f=>f.size>5*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type)))throw new Error('Upload up to 3 JPG, PNG or WebP images, 5 MB each.');
    const details=Object.fromEntries([...fd].filter(([k])=>k!=='photos[]'));
    details.quantity=Number(details.quantity);details.consent=fd.get('consent')==='on';
    const hashes=await Promise.all(files.map(async f=>({name:f.name,size:f.size,hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await f.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')})));
    const signature=JSON.stringify([details,hashes]);
    if(!pending||pending.signature!==signature){pending={signature,requestId:crypto.randomUUID()};try{sessionStorage.setItem('pb-sourcing-pending',JSON.stringify(pending));}catch{/* same-tab retry still works */}}
    const body=new FormData();body.set('metadata',JSON.stringify({action:'create',requestId:pending.requestId,...details}));for(const f of files)body.append('photos[]',f);
    q('#sourcing-status').textContent='Uploading and saving your sourcing request…';
    const r=await json(sourcingEndpoint,{method:'POST',body});
    if(r.status!=='saved'||!/^SR-\d{8}-[A-F0-9]{16}$/.test(r.sourcingNumber)||r.fileCount!==files.length)throw new Error('The receipt could not be verified. Retry with the same details.');
    q('#sourcing-status').textContent=`Request saved: ${r.sourcingNumber}\n${r.fileCount} image(s) stored privately. Save this number. Our team will verify the part and contact you with a quotation. No order or payment has been taken.`;
  }catch(err){q('#sourcing-status').textContent=err.message;}
  finally{submit.disabled=false;}
});
try{pending=JSON.parse(sessionStorage.getItem('pb-sourcing-pending')||'null');}catch{/* optional recovery */}
try{
  const settings=await json('./site.json');endpoint=settings.partsEndpoint||'';sourcingEndpoint=settings.sourcingEndpoint||'';
  for(const value of [endpoint,sourcingEndpoint])if(value&&new URL(value,location.href).origin!==location.origin)throw new Error('Parts services must use this website.');
  if(!endpoint||!sourcingEndpoint)throw new Error('This static preview cannot search the database or receive photos. Open the PHP website, or use the purchasing brief below.');
  q('#submit-sourcing').disabled=false;
  const params=new URLSearchParams(location.search);q('#parts-query').value=params.get('q')||'';
  select('type').value=params.get('type')||'';
  await options();
  for(let i=0;i<levels.length;i++){const value=params.get(levels[i]);if(value&&[...select(levels[i]).options].some(o=>o.value===value)){select(levels[i]).value=value;await options(i+1);}}
  await search();
  if(location.hash==='#source-part')q('#source-part').open=true;
}catch(e){q('#search-status').textContent=e.message;q('#sourcing-fallback').hidden=false;}
