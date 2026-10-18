import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,copyFile,readFile,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cartTotals,parseMoney,quoteText} from '../orders-client.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const php=process.env.PHP_BINARY||path.join(root,'data/runtime/php-8.5.11/php.exe');
const args=process.env.PHP_BINARY?[]:['-d',`extension_dir=${path.join(root,'data/runtime/php-8.5.11/ext')}`,'-d','extension=pdo_sqlite','-d','extension=curl','-d','extension=openssl'];
for(const file of ['orders.php','paypal.php']){const lint=spawnSync(php,[...args,'-l',path.join(root,'source/api',file)],{encoding:'utf8'});assert.equal(lint.status,0,lint.stderr||lint.error?.message);}
const products=[{sku:'TEST-BRK-001',name:'TEST ONLY brake pads',category:'Braking systems',unitPriceCents:1250},{sku:'TEST-FLT-002',name:'TEST ONLY filter',category:'Filters & maintenance',unitPriceCents:820},{sku:'TEST-MOT-003',name:'TEST ONLY motorcycle chain',category:'Motorcycle components',unitPriceCents:null}];
const items=[{sku:products[0].sku,quantity:2,specification:'TEST ONLY OEM A'},{sku:products[1].sku,quantity:3,specification:'TEST ONLY OEM B'},{sku:products[2].sku,quantity:5,specification:'TEST ONLY OEM C'}];
const admin=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex');
const payload=()=>({action:'create',requestId:randomUUID(),customer:{name:'QA TEST ONLY',company:'LOCAL ACCEPTANCE TEST — NOT A CUSTOMER',email:'qa@example.invalid',country:'United Kingdom',address:'TEST ONLY address'},items,notes:'Synthetic test data only. <script> stays text.'});
await mkdir(path.join(root,'data/order-tests'),{recursive:true});
const run=await mkdtemp(path.join(root,'data/order-tests/run-')),publicRoot=path.join(run,'public_html'),storage=path.join(run,'private');
await mkdir(path.join(publicRoot,'api'),{recursive:true});await mkdir(storage);
for(const f of ['orders.php','paypal.php'])await copyFile(path.join(root,'source/api',f),path.join(publicRoot,'api',f));
const catalog=path.join(storage,'catalog.json');await writeFile(catalog,JSON.stringify({currency:'USD',products}));
await writeFile(path.join(storage,'settings.json'),JSON.stringify({adminToken:admin,publicBaseUrl:'https://example.invalid/',paypal:{environment:'sandbox',clientId:'',clientSecret:''}}));
async function server(dir=storage){
  const child=spawn(php,[...args,'-S','127.0.0.1:0','-t',publicRoot],{env:{...process.env,ORDER_STORAGE_DIR:dir,ORDER_CATALOG_FILE:catalog},stdio:['ignore','pipe','pipe']});
  let log='';
  const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error(log));},10000);child.stderr.on('data',chunk=>{log+=chunk;const m=log.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('exit',code=>{clearTimeout(timer);reject(new Error(`PHP exited ${code}: ${log}`));});});
  return {base,stop:async()=>{child.kill();await once(child,'exit');}};
}
test('mixed cart uses integer cents and validates quantities without floating point totals',()=>{
  assert.deepEqual(cartTotals(items,products),{known:4960,pending:1});
  assert.equal(parseMoney('12.30'),1230);assert.equal(parseMoney('0.29'),29);
  for(const bad of ['1.001','-1','NaN','1e3',''])assert.throws(()=>parseMoney(bad));
  for(const qty of [0,-1,1.5,1000001,NaN])assert.throws(()=>cartTotals([{sku:products[0].sku,quantity:qty}],products));
});
test('customer quote export keeps requested quantity for exclusions and omits obsolete delivery promises',()=>{
  const text=quoteText({orderNumber:'PO-TEST',quoteRevision:2,currency:'USD',customer:{company:'QA',country:'UK',address:'TEST'},items:[{sku:'TEST',name:'Excluded part',requestedQuantity:3,quantity:2,availability:'unavailable',note:'No stock',leadTime:'OBSOLETE LEAD TIME'}],knownSubtotalCents:2500,shippingCents:100,totalCents:2600,shippingTerms:'TEST',quoteNote:''});
  assert.match(text,/Requested quantity: 3/);assert.match(text,/Excluded \/ unavailable/);assert.doesNotMatch(text,/OBSOLETE/);assert.match(text,/TOTAL: \$26.00/);
});
test('real PHP HTTP: three mixed SKUs -> one durable order -> whole quote -> confirm -> revise and reconfirm; rejects spoofed payment',async()=>{
  let app=await server();
  const post=(data,secret=key,headers={})=>fetch(app.base+'/api/orders.php',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${secret}`,...headers},body:JSON.stringify(data)});
  const read=async(number,secret=key)=>{const r=await post({action:'read',orderNumber:number},secret);assert.equal(r.status,200);return (await r.json()).order;};
  let evidence={synthetic:true,run,verifiedAt:new Date().toISOString()};
  try{
    const catalogue=await(await fetch(app.base+'/api/orders.php')).json();assert.deepEqual(catalogue.products,products);
    const data=payload();const created=await post({...data,totalCents:1,items:items.map(i=>({...i,unitPriceCents:1}))});assert.equal(created.status,201);
    const o=(await created.json()).order,number=o.orderNumber;
    assert.match(number,/^PO-\d{8}-[A-F0-9]{16}$/);assert.equal(o.items.length,3);assert.deepEqual(o.items.map(i=>i.quantity),[2,3,5]);assert.deepEqual(o.items.map(i=>i.subtotalCents),[2500,2460,null]);assert.equal(o.knownSubtotalCents,4960);assert.equal(o.totalCents,null);assert.equal(o.pendingQuoteItems,1);
    assert.equal((await post(data)).status,200,'same canonical request ignores forged client prices and returns the same order');
    assert.equal((await post({...data,notes:'changed'})).status,409);
    assert.equal((await post(data,randomBytes(32).toString('hex'))).status,403);
    assert.equal((await post(payload(),key,{Origin:'https://other.invalid'})).status,403);
    for(const quantity of [0,-1,1.5,1000001,'2'])assert.equal((await post({...payload(),items:[{sku:products[0].sku,quantity}]})).status,422);
    assert.equal((await post({...payload(),items:[items[0],items[0]]})).status,422);
    assert.equal((await post({...payload(),items:[{sku:'UNKNOWN',quantity:1}]})).status,422);
    assert.equal((await post({...payload(),customer:{...data.customer,email:'invalid'}})).status,422);
    assert.equal((await post({...payload(),notes:'x'.repeat(140000)})).status,413);
    assert.equal((await post({action:'read',orderNumber:number},'wrong')).status,404);
    assert.equal((await post({action:'admin_list'},'wrong')).status,401);
    assert.equal((await post({action:'confirm',orderNumber:number,expectedVersion:o.version,quoteRevision:1,totalCents:8240})).status,409);
    await app.stop();app=await server();assert.equal((await read(number)).orderNumber,number);
    const afterRestart=await post(data);assert.equal(afterRestart.status,200);assert.equal((await afterRestart.json()).order.orderNumber,number);
    const quoteItems=items.map((i,n)=>({...i,availability:'available',unitPriceCents:[1250,820,410][n],supplier:'SYNTHETIC verified supplier '+n,wholesaleCostCents:100,stockVerified:100,leadTime:'SYNTHETIC 7 days',note:''}));
    const quote={action:'quote',orderNumber:number,expectedVersion:1,items:quoteItems,shippingCents:1230,shippingTerms:'TEST ONLY consolidated shipping, taxes excluded',quoteNote:'SYNTHETIC acceptance quote'};
    const invalidQuote=await post({...quote,items:quoteItems.map((i,n)=>n===2?{...i,stockVerified:0}:i)},admin);assert.equal(invalidQuote.status,422);assert.equal((await read(number)).version,1,'invalid line must roll back whole quotation');
    const quotedResponse=await post(quote,admin);assert.equal(quotedResponse.status,200);const published=await quotedResponse.json();const quoted=published.order;assert.equal(quoted.totalCents,8240);assert.equal(quoted.knownSubtotalCents,7010);assert.equal(quoted.quoteRevision,1);assert.equal(quoted.orderNumber,number);assert.equal(quoted.pendingQuoteItems,0);
    const customer=await read(number);assert.equal(customer.items[0].supplier,undefined);assert.equal(customer.items[0].wholesaleCostCents,undefined);assert.equal(customer.quoteAccessHash,undefined);
    assert.equal((await read(number,published.quoteAccessKey)).orderNumber,number);
    assert.equal((await post({...quote,expectedVersion:1},admin)).status,409,'stale quote cannot overwrite');
    const confirm={action:'confirm',orderNumber:number,expectedVersion:quoted.version,quoteRevision:1,totalCents:8240};
    assert.equal((await post({...confirm,totalCents:8239})).status,409);
    assert.equal((await post({...confirm,quoteRevision:2})).status,409);
    let response=await post(confirm);assert.equal(response.status,200);const confirmed=(await response.json()).order;assert.equal(confirmed.status,'confirmed');
    assert.equal((await post({action:'paypal_create',orderNumber:number,expectedVersion:confirmed.version})).status,503,'unconfigured PayPal must fail closed');
    assert.equal((await read(number)).paymentStatus,'unpaid');
    assert.equal((await post({action:'paypal_capture',orderNumber:number,paypalOrderId:'FORGED',paymentStatus:'paid',amountCents:8240})).status,409);
    assert.equal((await post({action:'ship',orderNumber:number,expectedVersion:confirmed.version,carrier:'Fake',tracking:'Fake'},admin)).status,409);
    const amended={...quote,expectedVersion:confirmed.version,items:quoteItems.map((i,n)=>n===1?{...i,availability:'unavailable',note:'TEST ONLY unavailable source'}:i)};
    response=await post(amended,admin);assert.equal(response.status,200);const amendment=await response.json();const revised=amendment.order;assert.equal(revised.orderNumber,number);assert.equal(revised.items.length,3);assert.equal(revised.items[1].subtotalCents,0);assert.equal(revised.items[0].subtotalCents,2500);assert.equal(revised.items[2].subtotalCents,2050);assert.equal(revised.totalCents,5780);assert.equal(revised.confirmedRevision,null);assert.equal(revised.status,'quoted');
    assert.equal((await post(confirm)).status,409);
    assert.equal((await post({action:'read',orderNumber:number},published.quoteAccessKey)).status,404,'old quotation link is revoked on revision');
    assert.equal((await post({action:'paypal_create',orderNumber:number,expectedVersion:revised.version})).status,409,'payment blocked until revised total is confirmed');
    response=await post({action:'confirm',orderNumber:number,expectedVersion:revised.version,quoteRevision:2,totalCents:5780},amendment.quoteAccessKey);assert.equal(response.status,200);
    const final=(await response.json()).order;assert.equal(final.confirmedRevision,2);assert.equal(final.paymentStatus,'unpaid');
    const concurrent=payload();const replies=await Promise.all([post(concurrent),post(concurrent),post(concurrent)]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,200,201]);const numbers=await Promise.all(replies.map(async r=>(await r.json()).order.orderNumber));assert.equal(new Set(numbers).size,1);
    const listing=await(await post({action:'admin_list'},admin)).json();assert.equal(listing.orders.length,2);
    evidence={...evidence,orderNumber:number,quantities:[2,3,5],initialKnownSubtotalCents:4960,initialPendingQuoteItems:1,quoteSubtotalCents:7010,shippingCents:1230,quoteTotalCents:8240,revisedTotalCents:5780,finalOrder:final,concurrentRetriesOneOrder:true,paypalLiveVerified:false,checks:'restart, idempotency, rollback, private access, optimistic concurrency, cents, quote revision, forged payment and unpaid shipment rejection passed'};
    await app.stop();app=await server(path.join(publicRoot,'unsafe-storage'));
    assert.equal((await post(payload())).status,503,'public storage is forbidden');
    await app.stop();app=await server(path.join(catalog,'cannot-write'));
    assert.equal((await post(payload())).status,503,'unwritable storage must not return success');
    const probe=spawnSync(php,[...args,'-r',' $db=new PDO("sqlite:".$argv[1]); echo json_encode(["integrity"=>$db->query("PRAGMA integrity_check")->fetchColumn(),"orders"=>$db->query("SELECT COUNT(*) FROM orders")->fetchColumn(),"events"=>$db->query("SELECT COUNT(*) FROM events")->fetchColumn(),"payments"=>$db->query("SELECT COUNT(*) FROM payments")->fetchColumn()]);',path.join(storage,'orders.sqlite')],{encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);const database=JSON.parse(probe.stdout);assert.equal(database.integrity,'ok');assert.equal(database.orders,2);assert.equal(database.payments,0);
    await writeFile(path.join(run,'acceptance.json'),JSON.stringify({...evidence,database},null,2));
    console.log(`Acceptance evidence: ${path.join(run,'acceptance.json')}`);
  }finally{await app.stop();}
});
test('PayPal response validator rejects wrong amount, currency, reference, pending and duplicate captures (unit fixtures only; no provider simulation)',async()=>{
  const script=path.join(run,'paypal-validator.php');
  const paypalFile=path.join(root,'source/api/paypal.php').replaceAll('\\','/');
  await writeFile(script,`<?php
function failOrder(int $s,string $m): never {throw new RuntimeException($m);}
require ${JSON.stringify(paypalFile)};
$o=['orderNumber'=>'PO-TEST','quoteRevision'=>1,'currency'=>'USD','totalCents'=>8240];
$valid=['id'=>'TESTORDER','status'=>'COMPLETED','purchase_units'=>[['custom_id'=>'PO-TEST-Q1','payments'=>['captures'=>[['id'=>'TESTCAPTURE','status'=>'COMPLETED','amount'=>['currency_code'=>'USD','value'=>'82.40']]]]]]];
paypalCompleted($valid,$o,'TESTORDER');
$cases=[];$c=$valid;$c['status']='APPROVED';$cases[]=$c;
$c=$valid;$c['purchase_units'][0]['custom_id']='PO-OTHER-Q1';$cases[]=$c;
$c=$valid;$c['purchase_units'][0]['payments']['captures'][0]['amount']['value']='82.39';$cases[]=$c;
$c=$valid;$c['purchase_units'][0]['payments']['captures'][0]['amount']['currency_code']='EUR';$cases[]=$c;
$c=$valid;$c['purchase_units'][0]['payments']['captures'][0]['status']='PENDING';$cases[]=$c;
$c=$valid;$c['purchase_units'][0]['payments']['captures'][]=$c['purchase_units'][0]['payments']['captures'][0];$cases[]=$c;
foreach($cases as $case){try{paypalCompleted($case,$o,'TESTORDER');exit(1);}catch(RuntimeException){}}
echo 'Validated exact whole-order capture and rejected six invalid fixtures';
`);
  const r=spawnSync(php,[...args,script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);
});
