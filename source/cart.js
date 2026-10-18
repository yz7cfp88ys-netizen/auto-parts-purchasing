import {money,cartTotals,orderRequest,element,orderLines,quoteText} from './orders-client.js';
const root=document.querySelector('#shop');
const find=s=>root.querySelector(s);
let endpoint='',products=[],cart=[],current=null,accessKey='',submitting=false;
const store={get(key,session=false){try{return JSON.parse((session?sessionStorage:localStorage).getItem(key)||'null');}catch{return null;}},set(key,value,session=false){try{(session?sessionStorage:localStorage).setItem(key,JSON.stringify(value));return true;}catch{return false;}}};
const saved=store.get('pb-cart-v1');if(Array.isArray(saved))cart=saved.filter(i=>typeof i.sku==='string'&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=1000000).slice(0,100);
function message(text){find('#shop-status').textContent=text;}
function saveCart(){store.set('pb-cart-v1',cart);}
function button(text,callback){const b=element('button',text,'button');b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await callback();}catch(e){message(e.message);}finally{b.disabled=false;}});return b;}
function input(label,type='text',value=''){
  const l=element('label',label),i=element('input');i.type=type;i.value=value;l.append(i);return {label:l,input:i};
}
root.innerHTML=`<div class="section-heading"><div><h2>Mix your parts. One order.</h2><p>Different categories, one quotation, one PayPal payment, one coordinated shipment.</p></div><a class="text-link" href="#order-lookup">View your order</a></div>
<p id="catalog-status" role="status">Loading purchasing catalogue…</p><div id="product-list" class="product-list"></div>
<div class="purchase-layout"><form id="checkout-form" class="purchase-form"><h3>Your mixed-parts cart</h3><div id="cart-lines"></div><p id="cart-total"></p><p>Unpriced items and shipping remain pending until our complete quotation. No payment is taken when you submit.</p><div class="form-row"><label>Your name<input name="name" required maxlength="100" autocomplete="name"></label><label>Business email<input name="email" type="email" required maxlength="200" autocomplete="email"></label></div><div class="form-row"><label>Company<input name="company" required maxlength="160" autocomplete="organization"></label><label>Destination country<input name="country" required maxlength="100" autocomplete="country-name"></label></div><label>Shipping address<textarea name="address" required maxlength="1000" autocomplete="street-address"></textarea></label><label>Order notes<textarea name="notes" maxlength="3000" placeholder="Fitment, inspection or packing requirements"></textarea></label><label hidden>Website<input name="website" tabindex="-1" autocomplete="off"></label><button class="button" id="place-order" disabled>Submit one procurement order</button><p>Keep your private order access key. Submitted details are saved on our server. Your cart stays on this device; order keys stay in this browser session.</p></form>
<div><form id="order-lookup" class="purchase-form"><h3>View your order</h3><label>Order number<input name="orderNumber" required maxlength="40" placeholder="PO-…"></label><label>Private access key<input name="key" required type="password" autocomplete="off" maxlength="64"></label><button class="button">Load order</button><p>Use the private link from your quotation or the access key saved when ordering.</p></form><div id="order-detail" class="order-detail" tabindex="-1"></div></div></div><p id="shop-status" class="shop-status" role="status" aria-live="polite"></p>`;
function renderCart(){
  const lines=find('#cart-lines');lines.replaceChildren();
  if(!cart.length)lines.append(element('p','Your cart is empty. Add parts above to start a mixed order.'));
  for(const item of cart){
    const p=products.find(p=>p.sku===item.sku),row=element('div','','cart-line');
    row.append(element('strong',p?.name||item.sku),element('span',item.sku));
    const qty=input('Quantity','number',item.quantity);Object.assign(qty.input,{min:String(p?.moq||1),max:'1000000',step:'1',required:true});
    qty.input.addEventListener('input',()=>{item.quantity=Number(qty.input.value);saveCart();renderTotals();});
    const spec=element('label','OEM / model / year / specification'),text=element('textarea');text.value=item.specification||'';text.maxLength=1000;text.rows=2;text.addEventListener('input',()=>{item.specification=text.value;saveCart();});spec.append(text);
    const subtotal=element('span',p?.unitPriceCents==null?'Pending quote':money(p.unitPriceCents*item.quantity),'cart-subtotal');subtotal.dataset.sku=item.sku;
    const remove=button('Remove',()=>{cart=cart.filter(i=>i!==item);saveCart();renderCart();});remove.className='inline-link';remove.setAttribute('aria-label',`Remove ${item.sku}`);
    row.append(qty.label,subtotal,spec,remove);lines.append(row);
  }
  renderTotals();
}
function renderTotals(){
  try{
    const {known,pending}=cartTotals(cart,products);
    find('#cart-total').textContent=`${cart.length} product types · Priced subtotal: ${money(known)} · ${pending} pending quote · Shipping pending`;
    for(const row of root.querySelectorAll('.cart-subtotal')){const i=cart.find(i=>i.sku===row.dataset.sku),p=products.find(p=>p.sku===i.sku);row.textContent=p?.unitPriceCents==null?'Pending quote':money(p.unitPriceCents*i.quantity);}
    find('#place-order').disabled=!endpoint||!cart.length||submitting;
  }catch(e){find('#cart-total').textContent=e.message;find('#place-order').disabled=true;}
}
function renderProducts(){
  find('#product-list').replaceChildren();
  for(const p of products){
    const row=element('article','','product-row'),details=element('div');
    details.append(element('h3',p.name),element('p',`${p.sku} · ${p.category}`),element('p',money(p.unitPriceCents)));
    const add=button('Add to cart',()=>{
      const existing=cart.find(i=>i.sku===p.sku);
      if(p.supplyStatus==='unavailable')throw new Error('This product is unavailable. Request sourcing.');
      if(existing){if(existing.quantity+(p.moq||1)>1000000)throw new Error('Maximum quantity reached.');existing.quantity+=p.moq||1;}
      else {if(cart.length>=100)throw new Error('A cart can contain up to 100 product types.');cart.push({sku:p.sku,quantity:p.moq||1,specification:''});}
      saveCart();renderCart();message(`${p.sku} added. ${cart.length} product types in your cart.`);
    });add.setAttribute('aria-label',`Add ${p.sku} to cart`);if(p.supplyStatus==='unavailable'){add.disabled=true;add.textContent='Unavailable';}row.append(details,add);find('#product-list').append(row);
  }
}
window.addEventListener('pb-add-category',event=>{
  const p=products.find(p=>p.category===event.detail);
  if(!p){message('The catalogue is unavailable. Please wait for it to load or use the PHP website.');return;}
  root.querySelector(`[aria-label="Add ${p.sku} to cart"]`).click();
});
window.addEventListener('pb-add-product',async event=>{
  try {
    if(!endpoint)throw new Error('Open the PHP website to add a verified product.');
    products=(await orderRequest(endpoint,null,'','GET')).products;
    const {sku,quantity,specification}=event.detail;
    const p=products.find(p=>p.sku===sku);
    if(!p||p.supplyStatus==='unavailable')throw new Error('This product changed or is unavailable. Request a quotation.');
    const qty=Math.max(quantity||1,p.moq||1),existing=cart.find(i=>i.sku===sku);
    if(existing){if(existing.quantity+qty>1000000)throw new Error('Maximum quantity reached.');existing.quantity+=qty;}
    else {if(cart.length>=100)throw new Error('A cart can contain up to 100 product types.');cart.push({sku,quantity:qty,specification:specification||''});}
    saveCart();renderProducts();renderCart();message(`${sku} added to your mixed-parts cart. Supply and fitment remain subject to your complete quotation.`);location.hash='shop';
  }catch(e){message(e.message);location.hash='shop';}
});
function remember(o,key){
  const receipts=store.get('pb-orders-v1',true)||{};receipts[o.orderNumber]=key;
  if(!store.set('pb-orders-v1',receipts,true))message('Browser storage is unavailable. Save the private access key shown below before leaving.');
  find('#order-lookup [name=orderNumber]').value=o.orderNumber;find('#order-lookup [name=key]').value=key;
}
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=element('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function showOrder(o,key){
  current=o;accessKey=key;remember(o,key);
  const view=find('#order-detail');view.replaceChildren(element('h3',o.orderNumber));
  view.append(element('p',`Order: ${o.status.replaceAll('_',' ')} · Whole-order payment: ${o.paymentStatus}${o.paymentEnvironment==='sandbox'?' (SANDBOX TEST — no real funds)':''}`),element('p',`Quote revision ${o.quoteRevision} · ${o.items.length} product types`),orderLines(o));
  view.append(element('p',`Priced items: ${money(o.knownSubtotalCents)} · ${o.pendingQuoteItems} pending quote`),element('p',`Consolidated shipping: ${money(o.shippingCents)}`),element('strong',`Order total: ${money(o.totalCents)}`));
  if(o.shippingTerms)view.append(element('p',o.shippingTerms));if(o.quoteNote)view.append(element('p',o.quoteNote));
  if(o.shipment)view.append(element('p',`Combined shipment: ${o.shipment.carrier} · ${o.shipment.tracking} · ${o.shipment.skus.join(', ')}`));
  const secret=element('details'),label=element('summary','Save your private order access key');secret.append(label,element('p',key,'access-key'),element('p','Anyone with this key can view and confirm this order. Keep it private.'));view.append(secret);
  const actions=element('div','','order-actions');
  actions.append(button('Refresh order',async()=>{const r=await orderRequest(endpoint,{action:'read',orderNumber:o.orderNumber},key);showOrder(r.order,key);message('Order refreshed.');}),button('Download order',()=>download(`${o.orderNumber}.txt`,quoteText(o)+`\n\nPrivate access key: ${key}`)));
  if(o.status==='quoted')actions.append(button(`Confirm full quotation ${money(o.totalCents)}`,async()=>{
    const r=await orderRequest(endpoint,{action:'confirm',orderNumber:o.orderNumber,expectedVersion:o.version,quoteRevision:o.quoteRevision,totalCents:o.totalCents},key);showOrder(r.order,key);message('Full quotation confirmed. You can now pay the entire order with PayPal.');
  }));
  if(o.status==='confirmed'){
    actions.append(button('Pay entire order with PayPal',async()=>{
      message('Preparing PayPal checkout for the confirmed order…');
      const r=await orderRequest(endpoint,{action:'paypal_create',orderNumber:o.orderNumber,expectedVersion:o.version},key);showOrder(r.order,key);
      const url=new URL(r.approvalUrl);if(url.protocol!=='https:'||!['www.paypal.com','www.sandbox.paypal.com'].includes(url.hostname))throw new Error('Invalid PayPal checkout link.');
      const link=element('a',r.environment==='sandbox'?'Continue to PayPal SANDBOX (test only)':'Continue to PayPal','button');link.href=url.href;
      view.append(link);message('Continue to PayPal, then return here to verify payment.');
    }));
    if(o.paypalOrderId)actions.append(button('Verify PayPal payment',async()=>{
      message('Verifying payment directly with PayPal…');
      const r=await orderRequest(endpoint,{action:'paypal_capture',orderNumber:o.orderNumber,paypalOrderId:o.paypalOrderId},key);showOrder(r.order,key);message(r.order.paymentEnvironment==='sandbox'?'Sandbox payment verified. No real funds received.':'PayPal payment verified for the complete order.');
    }));
  }
  view.append(actions);
}
find('#checkout-form').addEventListener('submit',async event=>{
  event.preventDefault();if(submitting||!endpoint)return;
  try{
    cartTotals(cart,products);if(!cart.length)throw new Error('Add at least one product.');
    const fd=new FormData(event.currentTarget),customer=Object.fromEntries(['name','email','company','country','address'].map(k=>[k,String(fd.get(k)).trim()]));
    const details={customer,items:cart.map(i=>({...i})),notes:String(fd.get('notes')).trim(),website:String(fd.get('website'))};
    let pending=store.get('pb-pending-order-v1',true);
    if(!pending||JSON.stringify(pending.details)!==JSON.stringify(details)){
      pending={details,requestId:crypto.randomUUID(),key:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')};
      if(!store.set('pb-pending-order-v1',pending,true))throw new Error('Session storage is required to preserve safe retries. Enable it before ordering.');
    }
    const snapshot=JSON.stringify(cart);submitting=true;renderTotals();message('Saving all items as one procurement order…');
    const r=await orderRequest(endpoint,{action:'create',requestId:pending.requestId,...details},pending.key);
    if(!r.order?.orderNumber||!Array.isArray(r.order.items)||r.order.items.length!==details.items.length)throw new Error('Order receipt is incomplete. Retry with the same details.');
    showOrder(r.order,pending.key);
    if(snapshot===JSON.stringify(cart)){cart=[];saveCart();renderCart();}
    // Retain idempotency key until the next, different cart submission.
    message(`Saved one order: ${r.order.orderNumber}. All ${r.order.items.length} product types are included. Save your private access key.`);find('#order-detail').focus();
  }catch(e){message(e.message);}finally{submitting=false;renderTotals();}
});
find('#order-lookup').addEventListener('submit',async event=>{
  event.preventDefault();const f=new FormData(event.currentTarget),key=String(f.get('key')).trim(),number=String(f.get('orderNumber')).trim();
  const b=event.currentTarget.querySelector('button');b.disabled=true;
  try{const r=await orderRequest(endpoint,{action:'read',orderNumber:number},key);showOrder(r.order,key);message('Order loaded from server.');}catch(e){message(e.message);}finally{b.disabled=false;}
});
try{
  const settings=await (await fetch('./site.json',{cache:'no-store'})).json();endpoint=settings.orderEndpoint||'';
  if(!endpoint)throw new Error('Online ordering is unavailable on this static preview. Use the PHP website to submit an order.');
  if(new URL(endpoint,location.href).origin!==location.origin)throw new Error('Invalid order service configuration.');
  const catalog=await orderRequest(endpoint,null,'','GET');products=catalog.products;
  find('#catalog-status').textContent='Catalogue references describe sourcing requests. Confirm exact OEM, fitment, supply and pricing in your quotation.';
  renderProducts();renderCart();
  const fragment=new URLSearchParams(location.hash.slice(1)),params=new URLSearchParams(location.search);
  const number=fragment.get('order')||params.get('order'),key=fragment.get('key')||(store.get('pb-orders-v1',true)||{})[number];
  if(number&&key){const r=await orderRequest(endpoint,{action:'read',orderNumber:number},key);showOrder(r.order,key);if(fragment.has('key'))history.replaceState(null,'',location.pathname+'#shop');if(params.get('paypal'))message('Returned from PayPal. Choose Verify PayPal payment to confirm the actual payment status.');}
}catch(e){find('#catalog-status').textContent=e.message;renderCart();}
