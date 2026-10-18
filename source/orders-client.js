export const money = cents => cents === null || cents === undefined ? 'Pending quote' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export function parseMoney(value) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(String(value))) throw new Error('Enter a non-negative amount with at most two decimal places.');
  const [whole,fraction=''] = String(value).split('.');
  const cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents>1e12)throw new Error('Amount exceeds the order limit.');
  return cents;
}
export function cartTotals(items, products) {
  let known=0,pending=0;
  for(const item of items){
    if(!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>1000000)throw new Error('Each quantity must be a whole number from 1 to 1,000,000.');
    const product=products.find(p=>p.sku===item.sku);
    if(!product)throw new Error(`Product ${item.sku} is unavailable. Remove it and select another part.`);
    if(product.moq&&item.quantity<product.moq)throw new Error(`Minimum quantity for ${item.sku} is ${product.moq}.`);
    if(product.supplyStatus==='unavailable')throw new Error(`Product ${item.sku} is unavailable. Request sourcing instead.`);
    if(product.unitPriceCents===null)pending++;else known+=product.unitPriceCents*item.quantity;
  }
  if(known>1e12)throw new Error('Order amount exceeds the limit.');
  return {known,pending};
}
export async function orderRequest(endpoint,data,key='',method='POST') {
  const response=await fetch(endpoint,{method,headers:method==='POST'?{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})}:{},body:method==='POST'?JSON.stringify(data):undefined,signal:AbortSignal.timeout(70000),credentials:'same-origin',cache:'no-store'});
  let body;try{body=await response.json();}catch{throw new Error('The order service did not return a receipt. Your cart is preserved; retry.');}
  if(!response.ok)throw new Error(body.error||'Order service unavailable. Retry with the same details.');
  return body;
}
export function element(tag,text='',className='') {const e=document.createElement(tag);e.textContent=text;if(className)e.className=className;return e;}
export function orderLines(order) {
  const wrap=element('div','','order-lines');
  for(const i of order.items){
    const row=element('div','','order-line');
    const detail=element('div');detail.append(element('strong',i.name),element('p',`${i.sku} · ${i.category}`),element('p',i.specification||''));
    if(i.note)detail.append(element('p',i.note));
    if(i.leadTime&&i.availability!=='unavailable')detail.append(element('p',`Lead time: ${i.leadTime}`));
    row.append(detail,element('div',i.availability==='unavailable'?`Requested quantity: ${i.requestedQuantity??i.quantity} · excluded`:`${i.quantity} × ${money(i.unitPriceCents)}`),element('strong',i.availability==='unavailable'?'Excluded / unavailable':money(i.subtotalCents)));
    wrap.append(row);
  }
  return wrap;
}
export function quoteText(o,link='') {
  const lines=o.items.map(i=>[
    `${i.sku} — ${i.name}`,i.specification,
    i.availability==='unavailable'?`Requested quantity: ${i.requestedQuantity??i.quantity} — Excluded / unavailable`:`${i.quantity} × ${money(i.unitPriceCents)} = ${money(i.subtotalCents)}`,
    i.note,i.availability!=='unavailable'&&i.leadTime?`Lead time: ${i.leadTime}`:''
  ].filter(Boolean).join('\n'));
  return [`PARTSBRIDGE — ${o.orderNumber}`,`Quotation revision: ${o.quoteRevision} | ${o.currency}`,`Buyer: ${o.customer.company}`,`Destination: ${o.customer.country} — ${o.customer.address}`,...lines,`Items: ${money(o.knownSubtotalCents)}`,`Consolidated shipping: ${money(o.shippingCents)}`,`TOTAL: ${money(o.totalCents)}`,`Shipping terms: ${o.shippingTerms}`,o.quoteNote,o.quoteRevision?'Please review and confirm this full quotation before paying with PayPal.':'Sourcing review is pending. A complete quotation will follow.',link].filter(Boolean).join('\n\n');
}
