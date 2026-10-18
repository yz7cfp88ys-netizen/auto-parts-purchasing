import {element,orderRequest} from './orders-client.js';
let key='',partsEndpoint='',sourcingEndpoint='',orderEndpoint='',openOrder=null,container=null;
const q=s=>container.querySelector(s);
const message=text=>{q('#parts-admin-status').textContent=text;};
function button(text,callback){const b=element('button',text,'button');b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await callback();}catch(e){message(e.message);}finally{b.disabled=false;}});return b;}
const post=(url,data)=>orderRequest(url,data,key);
function field(form,label,name,value='',required=true){const l=element('label',label),i=element('input');i.name=name;i.value=value;i.required=required;i.maxLength=2000;l.append(i);form.append(l);return i;}
async function list(){
  const r=await post(sourcingEndpoint,{action:'admin_list'});q('#sourcing-admin-list').replaceChildren();
  for(const s of r.requests){const row=element('div','','admin-order-row');row.append(element('strong',s.number),element('span',`${s.name} · ${s.partNumber||s.keywords} · ${s.status}`),button('Review sourcing request',()=>read(s.number)));q('#sourcing-admin-list').append(row);}
  if(!r.requests.length)q('#sourcing-admin-list').append(element('p','No sourcing requests yet.'));
}
async function read(sourcingNumber){
  const {request:r}=await post(sourcingEndpoint,{action:'admin_read',sourcingNumber});const view=q('#sourcing-admin-detail');view.replaceChildren(element('h3',r.sourcingNumber));
  view.append(element('pre',JSON.stringify(r.details,null,2),'source-detail'),element('p',`Status: ${r.status} · Version ${r.version} · Received ${r.createdAt}`));
  for(const f of r.files){
    view.append(button(`View private image (${Math.ceil(f.size/1024)} KB)`,async()=>{
      const response=await fetch(sourcingEndpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({action:'admin_file',fileId:f.id}),cache:'no-store',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('Private image unavailable or not authorized');
      const blob=await response.blob(),url=URL.createObjectURL(blob),image=element('img');image.src=url;image.alt='Customer part reference — fitment not established by this photo';const wrap=element('div','','source-detail');wrap.append(image);view.append(wrap);
      image.onload=()=>URL.revokeObjectURL(url);
    }));
  }
  if(r.linkedOrder){view.append(button(`Open order ${r.linkedOrder}`,()=>openOrder(r.linkedOrder)));return;}
  const form=element('form','','purchase-form');form.append(element('h3','Process this sourcing request'));
  const label=element('label','Processing status'),select=element('select');select.name='status';for(const value of ['received','reviewing','located','unable_to_source'])select.append(new Option(value.replaceAll('_',' '),value));select.value=r.status;label.append(select);form.append(label);
  field(form,'Sourcing findings / evidence / candidate assessment','note',r.details.processingNote||'');form.append(element('button','Save processing notes','button'));
  form.addEventListener('submit',async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{await post(sourcingEndpoint,{action:'admin_update',sourcingNumber,expectedVersion:r.version,...Object.fromEntries(new FormData(form))});await read(sourcingNumber);await list();message('Processing notes saved. Image candidates still require separate fitment evidence.');}catch(err){message(err.message);}finally{b.disabled=false;}});view.append(form);
  if(r.status==='located'){
    const convert=element('form','','purchase-form');convert.append(element('h3','Create a private product order'),element('p','This does not publish a catalogue item or invent a price. Verify the part, obtain the delivery address and quote supply using the existing order editor.'));
    field(convert,'Verified product name','productName',r.details.keywords||r.details.partNumber);
    field(convert,'Verified specification and fitment evidence / limitations','specification','');field(convert,'Customer shipping address (obtain from customer)','address','');convert.append(element('button','Create private order for full quotation','button'));
    convert.addEventListener('submit',async e=>{e.preventDefault();const b=convert.querySelector('button');b.disabled=true;try{
      const d=Object.fromEntries(new FormData(convert));const result=await post(orderEndpoint,{action:'source_convert',sourcingNumber,productName:d.productName,specification:d.specification,customer:{address:d.address}});
      await read(sourcingNumber);await list();await openOrder(result.order.orderNumber);message(`Private order ${result.order.orderNumber} created. Publish its complete quotation below to generate the customer confirmation and full-payment link.`);
    }catch(err){message(err.message);}finally{b.disabled=false;}});view.append(convert);
  }
}
export async function initSearchAdmin(secret,onOrder){
  key=secret;openOrder=onOrder;
  const settings=await(await fetch('./site.json',{cache:'no-store'})).json();partsEndpoint=settings.partsEndpoint;sourcingEndpoint=settings.sourcingEndpoint;orderEndpoint=settings.orderEndpoint;
  if(!partsEndpoint||!sourcingEndpoint)return;
  for(const endpoint of [partsEndpoint,sourcingEndpoint,orderEndpoint])if(new URL(endpoint,location.href).origin!==location.origin)throw new Error('Administrator services must be same-origin');
  container=document.querySelector('#parts-admin');
  if(!container){container=element('section','','search-admin');container.id='parts-admin';document.querySelector('#admin-orders').before(container);}
  container.replaceChildren(element('h2','Parts catalogue & sourcing'));
  const status=element('p','','shop-status');status.id='parts-admin-status';status.setAttribute('role','status');container.append(status);
  const tools=element('div','','finder-actions');tools.append(button('Refresh sourcing requests',list));
  tools.append(button('Check server readiness',async()=>{const r=await post(partsEndpoint,{action:'preflight'});message(JSON.stringify(r,null,2));}));
  const editor=element('textarea');editor.id='catalog-editor';editor.setAttribute('aria-label','Verified product import JSON');editor.spellcheck=false;editor.placeholder='Export the current catalogue, or import a JSON object with a products array. See docs/search-system.md for the data contract. No sample catalogue is installed.';
  tools.append(button('Export catalogue for editing',async()=>{const data=await post(partsEndpoint,{action:'export'});editor.value=JSON.stringify(data,null,2);message(`${data.products.length} product records loaded, including unpublished entries. Keep expectedRevision when editing.`);}));
  const details=element('details');details.append(element('summary','Maintain verified part numbers and vehicle fitment'),element('p','Import 1–100 verified products atomically. Every number and fitment needs source and verifiedAt. Prices, MOQ and supply need commercialEvidence. Existing records require expectedRevision. Set published=false to withdraw an item.'),editor);
  details.append(button('Validate & save catalogue JSON',async()=>{const data=JSON.parse(editor.value);const r=await post(partsEndpoint,{...data,action:'import'});message(`Saved ${r.saved.length} product(s). Re-export to edit their latest revisions.`);}));
  const listView=element('div');listView.id='sourcing-admin-list';const detailView=element('section');detailView.id='sourcing-admin-detail';container.append(tools,details,element('h3','Customer sourcing requests'),listView,detailView);await list();
}
