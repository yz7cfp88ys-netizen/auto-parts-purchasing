// Runs only against the isolated local acceptance server, never the operating catalogue.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const {run}=JSON.parse(await readFile('data/search-tests/latest.json','utf8'));
const cli=path.join(process.env.APPDATA,'npm/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools.js');
const base='http://127.0.0.1:4186';
function call(cmd,...args){const r=spawnSync(process.execPath,[cli,cmd,...args,'--output-format=json'],{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw new Error(r.stdout+r.stderr);const result=JSON.parse(r.stdout);if(result.isError||result.error||(Array.isArray(result)&&result.some(c=>c.type==='text'&&/^Error:/.test(c.text))))throw new Error(JSON.stringify(result));return result;}
function evaluate(script){const r=call('evaluate_script',script);const match=r.message?.match(/```json\n([\s\S]*?)\n```/);if(!match)throw new Error(JSON.stringify(r));return JSON.parse(match[1]);}
const wait=`const wait=fn=>new Promise((resolve,reject)=>{let count=0;const t=setInterval(()=>{if(fn()){clearInterval(t);resolve();}else if(++count>150){clearInterval(t);reject(new Error('UI did not reach expected state'));}},100);});`;
for(const f of ['search.js','search-admin.js','app.js','cart.js','orders-client.js','api/parts.php'])await copyFile(path.join('source',f),path.join(run,'public_html',f));
const evidence={run,localOnly:true,usesSyntheticRequests:true,usesOfficialManufacturerReference:true,verifiedAt:new Date().toISOString()};
call('new_page',base,'--isolatedContext','parts-search-acceptance');
call('emulate','--viewport','1440x1000x1');
evidence.search=evaluate(`async()=>{${wait}
  await wait(()=>document.querySelector('#search-results .search-result'));
  const input=document.querySelector('#parts-query'),form=document.querySelector('#parts-search-form');
  const cases=[];
  for(const [query,expected] of [['HU 719/7 x','Exact part-number match'],['071115562A','Exact part-number match'],['045115466C','Verified cross-reference match'],['QA-1235','Similar number only']]){
    input.value=query;form.requestSubmit();await wait(()=>!document.querySelector('#search-results').hasAttribute('aria-busy'));
    const area=document.querySelector('#find-parts').innerText;if(!area.includes(expected))throw new Error('Missing match label for '+query);cases.push({query,label:expected});
  }
  input.value='';document.querySelector('#vehicle-entry').click();
  for(const [name,value] of [['type','auto'],['make','AUDI'],['model','A2 (8Z)'],['year','2001'],['engine','1.2 TDI / ANY / 1191 cc / 45 kW'],['system','Filters & maintenance'],['category','Oil filters']]){
    const select=document.querySelector('#vehicle-fields [name='+name+']');await wait(()=>!select.disabled&&[...select.options].some(o=>o.value===value));select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  form.requestSubmit();await wait(()=>!document.querySelector('#search-results').hasAttribute('aria-busy'));
  if(!document.querySelector('#search-results [data-sku="REF-MANN-HU7197X"]'))throw new Error('Vehicle lookup failed');
  document.querySelector('#search-results .result-offer button').click();await wait(()=>document.querySelector('#cart-lines').textContent.includes('Oil filter HU 719/7 x'));
  return {cases,vehicle:'AUDI A2 (8Z) / 2001 / 1.2 TDI ANY / Filters & maintenance / Oil filters',searchResultAddedToCart:true,cart:document.querySelector('#cart-total').textContent};
}`);
evidence.fallback=evaluate(`async()=>{${wait}
  document.querySelector('#parts-query').value='UNLISTED-BROWSER-778';document.querySelector('#parts-search-form').requestSubmit();await wait(()=>!document.querySelector('#search-results').hasAttribute('aria-busy'));
  if(document.querySelector('#sourcing-fallback').hidden)throw new Error('No-result fallback hidden');document.querySelector('#fallback-source').click();
  const f=document.querySelector('#sourcing-form');
  if(f.elements.partNumber.value!=='UNLISTED-BROWSER-778'||!f.elements.vehicle.value.includes('AUDI'))throw new Error('Search context lost');
  for(const [k,v] of Object.entries({name:'QA BROWSER TEST ONLY',email:'qa@example.invalid',country:'United Kingdom',company:'SYNTHETIC ACCEPTANCE',keywords:'Unlisted part image test',quantity:'3',requirements:'TEST ONLY; this uploaded pixel is a transport fixture, not a vehicle fitment claim'}))f.elements[k].value=v;
  f.elements.consent.checked=true;return {partNumber:f.elements.partNumber.value,vehicle:f.elements.vehicle.value,open:document.querySelector('#source-part').open};
}`);
// Browser's file chooser cannot read the D-drive project under the installed tool's
// workspace restrictions. Create an explicitly marked test PNG inside the browser.
// This still exercises the real file input, FormData upload, PHP inspection and DB.
evaluate(`async()=>{const c=document.createElement('canvas');c.width=500;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,500,200);ctx.fillStyle='#19201e';ctx.font='24px sans-serif';ctx.fillText('PARTSBRIDGE TEST IMAGE ONLY',20,65);ctx.fillText('No vehicle fitment claim',20,115);const blob=await new Promise(r=>c.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'TEST-ONLY.png',{type:'image/png'}));const input=document.querySelector('#sourcing-form input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return {files:input.files.length};}`);
evidence.sourcing=evaluate(`async()=>{${wait}
  const f=document.querySelector('#sourcing-form');if(f.elements['photos[]'].files.length!==1)throw new Error('Browser did not attach exactly one image');if(!f.checkValidity())throw new Error('Sourcing form invalid');f.requestSubmit();await wait(()=>document.querySelector('#sourcing-status').textContent.startsWith('Request saved:'));
  const first=document.querySelector('#sourcing-status').textContent,number=first.match(/SR-[0-9]{8}-[A-F0-9]{16}/)[0];
  await wait(()=>!document.querySelector('#submit-sourcing').disabled);f.requestSubmit();await wait(()=>!document.querySelector('#submit-sourcing').disabled);
  if(!first.includes('1 image(s)'))throw new Error('Image receipt mismatch');if(!document.querySelector('#sourcing-status').textContent.includes(number))throw new Error('Retry duplicated request');return {number,receipt:first,retrySameNumber:true};
}`);
call('navigate_page','--url',base+'/?q=HU%20719%2F7%20x#find-parts');
evaluate(`async()=>{${wait}await wait(()=>document.querySelector('#search-results [data-sku="REF-MANN-HU7197X"]'));return true;}`);
await mkdir('docs/qa',{recursive:true});
const desktopShot=call('take_screenshot');assert.ok(desktopShot.images?.[0]?.filePath);await copyFile(desktopShot.images[0].filePath,'docs/qa/search-desktop.png');
evidence.desktop=evaluate('()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth})');
call('emulate','--viewport','390x844x1,mobile,touch');
evaluate(`async()=>{${wait}document.querySelector('#vehicle-picker').open=true;document.querySelector('#source-part').open=true;await new Promise(r=>setTimeout(r,200));return true;}`);
evidence.mobile=evaluate('()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth,searchInput:!!document.querySelector("#parts-query")})');assert.equal(evidence.mobile.overflow,false);
assert.equal(evidence.mobile.width,390);
const mobileShot=call('take_screenshot');assert.ok(mobileShot.images?.[0]?.filePath);await copyFile(mobileShot.images[0].filePath,'docs/qa/search-mobile.png');
const settings=JSON.parse(await readFile(path.join(run,'private/settings.json'),'utf8'));
evidence.searchConsole=call('list_console_messages','--types','error');
call('new_page',base+'/admin.html','--isolatedContext','parts-search-acceptance');
evidence.admin=evaluate(`async()=>{${wait}
  document.querySelector('#admin-login input').value=${JSON.stringify(settings.adminToken)};document.querySelector('#admin-login').requestSubmit();await wait(()=>document.querySelector('#sourcing-admin-list .admin-order-row'));
  const row=[...document.querySelectorAll('#sourcing-admin-list .admin-order-row')].find(r=>r.textContent.includes(${JSON.stringify(evidence.sourcing.number)}));if(!row)throw new Error('Sourcing request not in admin');row.querySelector('button').click();await wait(()=>document.querySelector('#sourcing-admin-detail .purchase-form'));
  const details=document.querySelector('#sourcing-admin-detail').textContent;if(!details.includes('UNLISTED-BROWSER-778'))throw new Error('Original search missing in admin');
  [...document.querySelectorAll('#sourcing-admin-detail button')].find(b=>b.textContent.startsWith('View private image')).click();await wait(()=>document.querySelector('#sourcing-admin-detail img')?.naturalWidth>0);
  [...document.querySelectorAll('#parts-admin button')].find(b=>b.textContent==='Check server readiness').click();await wait(()=>document.querySelector('#parts-admin-status').textContent.includes('pdoSqlite'));
  return {sourcingNumber:${JSON.stringify(evidence.sourcing.number)},privateImageDisplayed:true,originalSearchInAdmin:true,serverReadiness:JSON.parse(document.querySelector('#parts-admin-status').textContent)};
}`);
const conversion=evaluate(`async()=>{${wait}
  let form=document.querySelector('#sourcing-admin-detail form');form.elements.status.value='located';form.elements.note.value='SYNTHETIC sourcing evidence only. Browser-generated test image does not establish fitment.';form.requestSubmit();
  await wait(()=>document.querySelectorAll('#sourcing-admin-detail form').length===2);
  form=document.querySelectorAll('#sourcing-admin-detail form')[1];form.elements.productName.value='TEST ONLY private product';form.elements.specification.value='SYNTHETIC test specification; customer must verify fitment';form.elements.address.value='TEST ONLY delivery address';form.requestSubmit();
  await wait(()=>document.querySelector('.quote-editor'));const quote=document.querySelector('.quote-editor');
  for(const fs of quote.querySelectorAll('fieldset'))for(const [k,v] of Object.entries({quantity:'3',price:'12.50',supplier:'SYNTHETIC TEST SUPPLIER',cost:'8.00',stock:'3',leadTime:'TEST ONLY 7 days',note:'SYNTHETIC private quotation; not a commercial offer'}))fs.querySelector('[name='+k+']').value=v;
  quote.elements.shipping.value='5.00';quote.elements.shippingTerms.value='TEST ONLY shipping';quote.elements.quoteNote.value='SYNTHETIC browser quote acceptance. No actual goods or funds.';if(!quote.checkValidity())throw new Error('Invalid quote form');quote.requestSubmit();
  await wait(()=>document.querySelector('.quote-share textarea'));const text=document.querySelector('.quote-share textarea').value;const url=text.split(String.fromCharCode(10)).find(line=>line.startsWith('http://127.0.0.1:4186/'));
  if(!url)throw new Error('Customer quotation link missing');return {url,orderNumber:document.querySelector('#admin-detail h2').textContent};
}`);
call('new_page',conversion.url,'--isolatedContext','parts-search-acceptance');
evidence.privateQuote=evaluate(`async()=>{${wait}
  await wait(()=>document.querySelector('#order-detail h3'));
  const button=[...document.querySelectorAll('#order-detail button')].find(b=>b.textContent.startsWith('Confirm full quotation'));if(!button)throw new Error('Customer confirmation action missing');button.click();
  await wait(()=>[...document.querySelectorAll('#order-detail button')].some(b=>b.textContent==='Pay entire order with PayPal'));
  [...document.querySelectorAll('#order-detail button')].find(b=>b.textContent==='Pay entire order with PayPal').click();await wait(()=>document.querySelector('#shop-status').textContent.includes('PayPal')&&!document.querySelector('#shop-status').textContent.startsWith('Preparing'));
  return {orderNumber:document.querySelector('#order-detail h3').textContent,fullQuoteConfirmed:true,totalText:[...document.querySelectorAll('#order-detail strong')].map(e=>e.textContent).find(t=>t.startsWith('Order total:')),paymentMessage:document.querySelector('#shop-status').textContent,paymentNotSimulated:true};
}`);
const errors=call('list_console_messages','--types','error');evidence.paymentConsoleExpected503=errors;await writeFile(path.join(run,'browser-evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
