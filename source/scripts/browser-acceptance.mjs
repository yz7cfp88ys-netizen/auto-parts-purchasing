// Local synthetic acceptance only. Exercises real UI controls against the PHP server.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const cli=path.join(process.env.APPDATA,'npm/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools.js');
function call(command,...args){const r=spawnSync(process.execPath,[cli,command,...args,'--output-format=json'],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:60000});if(r.status!==0)throw new Error(r.error?.message||r.stdout+r.stderr);const out=JSON.parse(r.stdout);if(out.isError||out.error)throw new Error(JSON.stringify(out));return out;}
function evaluate(code){const r=call('evaluate_script',code);const m=r.message?.match(/```json\n([\s\S]*?)\n```/);if(!m)throw new Error(JSON.stringify(r));return JSON.parse(m[1]);}
const stage=process.argv[2]||'create';
await mkdir('data/browser-acceptance',{recursive:true});
if(stage==='create'){
  call('navigate_page','--url','http://127.0.0.1:4184/#shop');
  const result=evaluate(`async () => {
    const wait=predicate=>new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(predicate()){clearInterval(timer);resolve();}else if(++attempts>100){clearInterval(timer);reject(new Error('UI update timed out'));}},100);});
    await wait(()=>document.querySelector('[aria-label="Add PB-BRK-001 to cart"]'));
    if(document.querySelectorAll('.cart-line').length)throw new Error('A pre-existing cart is present. Preserve it.');
    for(const sku of ['PB-BRK-001','PB-FLT-001','PB-MOT-001'])document.querySelector('[aria-label="Add '+sku+' to cart"]').click();
    document.querySelector('[aria-label="Remove PB-FLT-001"]').click();
    await wait(()=>!document.querySelector('[aria-label="Add PB-FLT-001 to cart"]').disabled);
    document.querySelector('[aria-label="Add PB-FLT-001 to cart"]').click();
    const rows=[...document.querySelectorAll('.cart-line')];
    for(const row of rows){const sku=row.querySelector('span').textContent;const qty={'PB-BRK-001':2,'PB-FLT-001':3,'PB-MOT-001':5}[sku];const i=row.querySelector('input');i.value=qty;i.dispatchEvent(new Event('input',{bubbles:true}));const s=row.querySelector('textarea');s.value='SYNTHETIC BROWSER TEST OEM '+sku;s.dispatchEvent(new Event('input',{bubbles:true}));}
    const f=document.querySelector('#checkout-form');
    for(const [name,value] of Object.entries({name:'QA BROWSER TEST ONLY',email:'qa@example.invalid',company:'SYNTHETIC BROWSER ACCEPTANCE',country:'United Kingdom',address:'TEST ONLY shipping address',notes:'NOT A CUSTOMER. Browser acceptance test.'}))f.elements[name].value=value;
    if(!f.checkValidity())throw new Error('Customer form invalid');f.requestSubmit();
    await wait(()=>document.querySelector('#order-detail h3'));
    return {orderNumber:document.querySelector('#order-detail h3').textContent,lines:document.querySelectorAll('#order-detail .order-line').length,detail:document.querySelector('#order-detail').innerText.replace(/[a-f0-9]{64}/g,'[PRIVATE KEY REDACTED]'),status:document.querySelector('#shop-status').textContent};
  }`);
  assert.equal(result.lines,3);assert.match(result.orderNumber,/^PO-/);assert.match(result.status,/Saved one order/);await writeFile('data/browser-acceptance/order.json',JSON.stringify(result,null,2));console.log(JSON.stringify({orderNumber:result.orderNumber,lines:3,quantities:[2,3,5],submittedThroughCustomerForm:true,removeAndReaddVerified:true}));
}else if(stage==='quote'){
  const saved=JSON.parse(await readFile('data/browser-acceptance/order.json','utf8'));
  const settings=JSON.parse(await readFile('data/orders-private/settings.json','utf8'));
  call('new_page','http://127.0.0.1:4184/admin.html');
  const result=evaluate(`async () => {
    const wait=predicate=>new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(predicate()){clearInterval(timer);resolve();}else if(++attempts>100){clearInterval(timer);reject(new Error('Admin UI update timed out'));}},100);});
    document.querySelector('#admin-login input').value=${JSON.stringify(settings.adminToken)};document.querySelector('#admin-login').requestSubmit();
    await wait(()=>document.querySelector('.admin-order-row'));
    const row=[...document.querySelectorAll('.admin-order-row')].find(r=>r.textContent.includes(${JSON.stringify(saved.orderNumber)}));if(!row)throw new Error('Customer order missing');row.querySelector('button').click();
    await wait(()=>document.querySelector('.quote-editor'));
    const form=document.querySelector('.quote-editor');
    for(const fs of form.querySelectorAll('fieldset')){
      const price={'PB-BRK-001':'12.50','PB-FLT-001':'8.20','PB-MOT-001':'4.10'}[fs.dataset.sku];
      for(const [name,value] of Object.entries({price,supplier:'SYNTHETIC verified supplier',cost:'1.00',stock:'100',leadTime:'TEST ONLY 7 days',note:'Synthetic quotation only'}))fs.querySelector('[name='+name+']').value=value;
    }
    form.elements.shipping.value='12.30';form.elements.shippingTerms.value='TEST ONLY combined shipping; taxes excluded';form.elements.quoteNote.value='SYNTHETIC browser acceptance quote. Not a commercial offer.';
    if(!form.checkValidity())throw new Error('Quote form invalid');form.requestSubmit();
    await wait(()=>document.querySelector('.quote-share textarea'));
    return {quote:document.querySelector('.quote-share textarea').value.replace(/key=[a-f0-9]{64}/g,'key=[PRIVATE KEY REDACTED]'),status:document.querySelector('#admin-status').textContent};
  }`);
  assert.match(result.quote,/TOTAL: \$82.40/);await writeFile('data/browser-acceptance/quote.json',JSON.stringify(result,null,2));console.log(JSON.stringify({adminQuoteSubmittedThroughForm:true,totalCents:8240,status:result.status}));
}else if(stage==='exclusion'){
  const saved=JSON.parse(await readFile('data/browser-acceptance/order.json','utf8'));
  const settings=JSON.parse(await readFile('data/orders-private/settings.json','utf8'));
  call('select_page','3');call('navigate_page','--url','http://127.0.0.1:4184/admin.html');
  const result=evaluate(`async () => {
    const wait=predicate=>new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(predicate()){clearInterval(timer);resolve();}else if(++attempts>100){clearInterval(timer);reject(new Error('Exclusion UI timed out'));}},100);});
    document.querySelector('#admin-login input').value=${JSON.stringify(settings.adminToken)};document.querySelector('#admin-login').requestSubmit();
    await wait(()=>document.querySelector('.admin-order-row'));
    [...document.querySelectorAll('.admin-order-row')].find(r=>r.textContent.includes(${JSON.stringify(saved.orderNumber)})).querySelector('button').click();await wait(()=>document.querySelector('.quote-editor'));
    let form=document.querySelector('.quote-editor'),line=form.querySelector('[data-sku="PB-FLT-001"]');
    line.querySelector('select').value='unavailable';line.querySelector('select').dispatchEvent(new Event('change',{bubbles:true}));line.querySelector('[name=note]').value='TEST ONLY unavailable item';line.querySelector('[name=stock]').value='0';
    if(!form.checkValidity())throw new Error('Hidden unavailable fields block quote submission');form.requestSubmit();await wait(()=>document.querySelector('.quote-share textarea'));
    if(!document.querySelector('.quote-share textarea').value.includes('TOTAL: $57.80'))throw new Error('Revised total mismatch');
    [...document.querySelectorAll('#admin-detail button')].find(b=>b.textContent==='Reload latest order').click();await wait(()=>document.querySelector('.quote-editor')&&!document.querySelector('.quote-share'));
    form=document.querySelector('.quote-editor');if(!form.checkValidity())throw new Error('Reopened unavailable line prevents quote republishing');form.requestSubmit();await wait(()=>document.querySelector('.quote-share textarea'));
    return {status:document.querySelector('#admin-status').textContent,excludedRepublish:true,totalCents:5780};
  }`);
  assert.match(result.status,/\$57.80/);await writeFile('data/browser-acceptance/exclusion.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  call('select_page','2');
  const revised=evaluate(`async () => { const b=[...document.querySelectorAll('#order-detail button')].find(b=>b.textContent==='Refresh order');b.click();for(let n=0;n<100;n++){if(document.querySelector('#order-detail').textContent.includes('Order: quoted'))return {requiresReconfirmation:!document.querySelector('#order-detail').textContent.includes('Pay entire order'),total:document.querySelector('#order-detail').textContent.includes('Order total: $57.80')};await new Promise(r=>setTimeout(r,100));}throw new Error('Customer revision not reflected'); }`);assert.equal(revised.requiresReconfirmation,true);assert.equal(revised.total,true);console.log(JSON.stringify(revised));
}else if(stage==='confirm'){
  call('select_page','2');
  const result=evaluate(`async () => {
    const wait=predicate=>new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(predicate()){clearInterval(timer);resolve();}else if(++attempts>100){clearInterval(timer);reject(new Error('Order UI timed out'));}},100);});
    const click=text=>{const b=[...document.querySelectorAll('#order-detail button')].find(b=>b.textContent.startsWith(text));if(!b)throw new Error('Button missing: '+text);b.click();};
    click('Refresh order');await wait(()=>[...document.querySelectorAll('#order-detail button')].some(b=>b.textContent.startsWith('Confirm full quotation')||b.textContent.startsWith('Pay entire order')));
    if([...document.querySelectorAll('#order-detail button')].some(b=>b.textContent.startsWith('Confirm full quotation')))click('Confirm full quotation');await wait(()=>document.querySelector('#order-detail').textContent.includes('Order: confirmed'));
    click('Pay entire order');await wait(()=>/not configured|Configure the public HTTPS/.test(document.querySelector('#shop-status').textContent));
    return {detail:document.querySelector('#order-detail').innerText.replace(/[a-f0-9]{64}/g,'[PRIVATE KEY REDACTED]'),status:document.querySelector('#shop-status').textContent,overflow:document.documentElement.scrollWidth>innerWidth};
  }`);
  assert.match(result.detail,/Order total: \$82.40/);assert.match(result.detail,/Whole-order payment: unpaid/);assert.match(result.status,/not configured|Configure the public HTTPS/);await writeFile('data/browser-acceptance/confirmed.json',JSON.stringify(result,null,2));console.log(JSON.stringify({customerConfirmedTotalCents:8240,paypalUnconfiguredBlocked:true,paid:false,overflow:result.overflow}));
}else if(stage==='screenshots'){
  const saved=JSON.parse(await readFile('data/browser-acceptance/order.json','utf8'));
  call('navigate_page','--url',`http://127.0.0.1:4184/?order=${encodeURIComponent(saved.orderNumber)}#shop`);
  evaluate('async () => { for(let n=0;n<100;n++){if(document.querySelector("#order-detail h3"))return true;await new Promise(r=>setTimeout(r,100));}throw new Error("Order reload failed"); }');
  await mkdir('docs/qa/mixed-orders',{recursive:true});
  for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
    call('emulate','--viewport',`${width}x${height}x1${name==='mobile'?',mobile,touch':''}`);
    const layout=evaluate('() => { document.querySelector("#order-detail").scrollIntoView({block:"start"}); return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>innerWidth}; }');
    assert.equal(layout.width,width);
    assert.equal(layout.overflow,false,JSON.stringify(layout));
    const result=call('take_screenshot');const screenshot=result.images?.[0]?.filePath;if(!screenshot)throw new Error(JSON.stringify(result));await copyFile(screenshot,`docs/qa/mixed-orders/${name}.png`);console.log(JSON.stringify({name,...layout,screenshot:path.resolve(`docs/qa/mixed-orders/${name}.png`)}));
  }
  evaluate('() => { document.querySelector("#order-detail .order-actions").scrollIntoView({block:"end"}); return true; }');
  const totals=call('take_screenshot');await copyFile(totals.images[0].filePath,'docs/qa/mixed-orders/mobile-total.png');
  call('select_page','3');call('emulate','--viewport','1440x1000x1');
  evaluate('() => { document.querySelector("#admin-detail").scrollIntoView({block:"start"}); return true; }');
  const adminShot=call('take_screenshot');await copyFile(adminShot.images[0].filePath,'docs/qa/mixed-orders/admin.png');
  call('select_page','2');
  console.log(JSON.stringify(call('list_console_messages','--types','error')));
}
