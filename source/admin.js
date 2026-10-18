import {money,parseMoney,element,orderLines,orderRequest,quoteText} from './orders-client.js';
import {initSearchAdmin} from './search-admin.js';
const q=s=>document.querySelector(s);let key='',endpoint='';
function status(message){q('#admin-status').textContent=message;}
function button(text,callback){const b=element('button',text,'button');b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await callback();}catch(e){status(e.message);}finally{b.disabled=false;}});return b;}
const api=data=>orderRequest(endpoint,data,key);
async function list(){
  const r=await api({action:'admin_list'});q('#admin-orders').replaceChildren();
  if(!r.orders.length)q('#admin-orders').append(element('p','No orders have been submitted.'));
  for(const o of r.orders){const row=element('div','','admin-order-row');row.append(element('strong',o.orderNumber),element('span',o.customer.company),element('span',`${o.items.length} products · ${money(o.totalCents)} · ${o.status} / ${o.paymentStatus}`),button('Review order',()=>load(o.orderNumber)));q('#admin-orders').append(row);}
}
async function load(number){const r=await api({action:'admin_read',orderNumber:number});show(r.order);}
function field(label,name,value,type='text',required=true){const l=element('label',label),i=element('input');i.type=type;i.name=name;i.value=value??'';i.required=required;if(type==='number'){i.min='1';i.max='1000000';i.step='1';}else{i.maxLength=500;}l.append(i);return l;}
function amount(cents){return cents==null?'':(cents/100).toFixed(2);}
function show(o){
  const view=q('#admin-detail');view.replaceChildren(element('h2',o.orderNumber));
  view.append(element('p',`${o.customer.name} · ${o.customer.email} · ${o.customer.company}`),element('p',`${o.customer.country} · ${o.customer.address}`),element('p',o.notes),element('p',`Order ${o.status} · Whole-order payment ${o.paymentStatus}${o.paymentEnvironment==='sandbox'?' (SANDBOX TEST)':''} · Quote revision ${o.quoteRevision}`),orderLines(o),element('strong',`Order total: ${money(o.totalCents)}`));
  view.append(button('Reload latest order',()=>load(o.orderNumber)));
  if(o.paypalOrderId&&o.paymentStatus!=='paid')view.append(button('Reconcile with PayPal',async()=>{const r=await api({action:'admin_reconcile',orderNumber:o.orderNumber,paypalOrderId:o.paypalOrderId});show(r.order);await list();status('PayPal reconciliation complete. Check payment environment before fulfillment.');}));
  if(o.paymentStatus==='paid'){
    if(o.paymentEnvironment==='sandbox'){view.append(element('p','Sandbox payment only. Real shipment is blocked.'));return;}
    if(o.status==='shipped'){view.append(element('p',`Combined shipment: ${o.shipment.carrier} · ${o.shipment.tracking}`));return;}
    const form=element('form','','purchase-form');form.append(element('h3','Consolidated shipment'),field('Carrier','carrier',''),field('Tracking / shipment reference','tracking',''),element('button','Record one combined shipment','button'));
    form.addEventListener('submit',async e=>{e.preventDefault();const b=form.querySelector('button');b.disabled=true;try{const d=Object.fromEntries(new FormData(form));const r=await api({action:'ship',orderNumber:o.orderNumber,expectedVersion:o.version,...d});show(r.order);await list();status('Combined shipment saved for all available products.');}catch(err){status(err.message);}finally{b.disabled=false;}});view.append(form);return;
  }
  if(o.paypalOrderId){view.append(element('p','PayPal checkout is in progress. Reconcile payment before changing commercial terms.'));return;}
  const form=element('form','','quote-editor');form.append(element('h3','Review and publish a complete quotation'),element('p','Every available product needs verified supply, cost, stock and lead time. Exclude unavailable lines with a reason; the remaining items stay in this order.'));
  for(const line of o.items){
    const fs=element('fieldset','','quote-item');fs.dataset.sku=line.sku;fs.append(element('legend',`${line.sku} — ${line.name}`),element('p',`Customer requested ${line.requestedQuantity}. ${line.specification}`));
    const availability=element('label','Availability'),select=element('select');select.name='availability';for(const value of ['available','unavailable']){const opt=element('option',value==='available'?'Available — include in quote':'Unavailable — exclude this item');opt.value=value;select.append(opt);}select.value=line.availability==='unavailable'?'unavailable':'available';availability.append(select);fs.append(availability);
    const row=element('div','','form-row');row.append(field('Quoted quantity','quantity',line.quantity,'number'),field('Unit selling price (USD)','price',amount(line.unitPriceCents)));fs.append(row);
    const supply=element('div','','quote-supply');supply.append(field('Verified supplier / source','supplier',line.supplier));const costs=element('div','','form-row');costs.append(field('Wholesale cost per unit (USD, private)','cost',amount(line.wholesaleCostCents)),field('Verified stock quantity (private)','stock',line.stockVerified,'number'));supply.append(costs,field('Lead time','leadTime',line.leadTime));fs.append(supply,field('Customer note / exclusion reason','note',line.note,'text',false));
    const update=()=>{const active=select.value==='available';supply.hidden=!active;supply.querySelectorAll('input').forEach(i=>{i.required=active;i.disabled=!active;});fs.querySelector('[name=price]').required=active;fs.querySelector('[name=price]').disabled=!active;fs.querySelector('[name=note]').required=!active;};select.addEventListener('change',update);update();form.append(fs);
  }
  form.append(field('Combined shipping amount (USD)','shipping',amount(o.shippingCents)),field('Shipping terms, route and delivery estimate','shippingTerms',o.shippingTerms),field('Full quote notes (taxes, duties, fitment, validity)','quoteNote',o.quoteNote,'text',false),element('button','Publish full quotation — requires customer confirmation','button'));
  form.addEventListener('submit',async event=>{
    event.preventDefault();const b=form.querySelector('button');b.disabled=true;
    try{
      const items=[...form.querySelectorAll('fieldset')].map(fs=>{const d=Object.fromEntries(new FormData(form));for(const i of fs.querySelectorAll('input,select'))d[i.name]=i.value;const active=d.availability==='available';return {sku:fs.dataset.sku,quantity:Number(d.quantity),availability:d.availability,unitPriceCents:active?parseMoney(d.price):null,supplier:active?d.supplier:'',wholesaleCostCents:active?parseMoney(d.cost):0,stockVerified:active?Number(d.stock):0,leadTime:active?d.leadTime:'',note:d.note};});
      const d=Object.fromEntries(new FormData(form));
      const r=await api({action:'quote',orderNumber:o.orderNumber,expectedVersion:o.version,items,shippingCents:parseMoney(d.shipping),shippingTerms:d.shippingTerms,quoteNote:d.quoteNote});
      show(r.order);await list();
      const url=new URL('./',location.href);url.hash=new URLSearchParams({order:o.orderNumber,key:r.quoteAccessKey}).toString();const text=quoteText(r.order,url.href);
      const share=element('div','','quote-share');share.append(element('h3','Send the complete quotation'),element('p','Save this private customer link now. A later quotation replaces it. Customer confirmation and payment use this same order number.'));
      const textarea=element('textarea');textarea.value=text;textarea.readOnly=true;textarea.setAttribute('aria-label','Complete customer quotation');share.append(textarea);
      share.append(button('Copy complete quotation',async()=>{await navigator.clipboard.writeText(text);status('Complete quotation copied. Send it to the customer using your normal channel.');}));
      const email=element('a','Open email app','button');email.href=`mailto:${r.order.customer.email}?subject=${encodeURIComponent(`Quotation ${o.orderNumber} revision ${r.order.quoteRevision}`)}&body=${encodeURIComponent(text)}`;share.append(email);view.append(share);
      status(`Quotation revision ${r.order.quoteRevision} saved. Total ${money(r.order.totalCents)}. Send the complete quotation to the customer.`);
    }catch(e){status(e.message);}finally{b.disabled=false;}
  });view.append(form);
}
q('#admin-login').addEventListener('submit',async event=>{event.preventDefault();key=String(new FormData(event.currentTarget).get('key'));const b=event.currentTarget.querySelector('button');b.disabled=true;try{await list();q('#admin-login input').value='';status('Orders loaded from the private database.');await initSearchAdmin(key,load);}catch(e){status(e.message);}finally{b.disabled=false;}});
try{const s=await(await fetch('./site.json')).json();endpoint=s.orderEndpoint||'';if(!endpoint)throw new Error('Order administration requires the PHP website.');if(new URL(endpoint,location.href).origin!==location.origin)throw new Error('Invalid order service.');}catch(e){status(e.message);q('#admin-login button').disabled=true;}
