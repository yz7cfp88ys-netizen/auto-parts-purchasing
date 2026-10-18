import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const php=process.env.PHP_BINARY||path.join(root,'data/runtime/php-8.5.11/php.exe');
const args=process.env.PHP_BINARY?[]:['-d',`extension_dir=${path.join(root,'data/runtime/php-8.5.11/ext')}`,'-d','extension=pdo_sqlite','-d','extension=curl','-d','extension=openssl'];
args.push('-d','upload_max_filesize=5M','-d','post_max_size=16M','-d','max_file_uploads=3');
for(const file of ['parts-core.php','parts.php','sourcing.php','orders.php']){
  const lint=spawnSync(php,[...args,'-l',path.join(root,'source/api',file)],{encoding:'utf8'});assert.equal(lint.status,0,lint.stderr||lint.error?.message||lint.stdout);
}
await mkdir(path.join(root,'data/search-tests'),{recursive:true});
const run=await mkdtemp(path.join(root,'data/search-tests/run-')),publicRoot=path.join(run,'public_html'),storage=path.join(run,'private');
await mkdir(storage);await cp(path.join(root,'source'),publicRoot,{recursive:true});
await cp(path.join(root,'config/catalog.json'),path.join(publicRoot,'api/catalog.json'));
const site=JSON.parse(await readFile(path.join(root,'config/site.json'),'utf8'));
await writeFile(path.join(publicRoot,'site.json'),JSON.stringify({...site,inquiryEndpoint:'./api/inquiries.php',orderEndpoint:'./api/orders.php',partsEndpoint:'./api/parts.php',sourcingEndpoint:'./api/sourcing.php'}));
const admin=randomBytes(32).toString('hex');
await writeFile(path.join(storage,'settings.json'),JSON.stringify({adminToken:admin,publicBaseUrl:'https://example.invalid/',paypal:{environment:'sandbox',clientId:'',clientSecret:''}}));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=','base64');
await writeFile(path.join(run,'TEST-ONLY-upload.png'),png);
const ev={source:'SYNTHETIC QA FIXTURE ONLY — NOT A REAL PART OR FITMENT',verifiedAt:'2026-10-18T00:00:00Z'};
const vehicle={type:'auto',make:'TEST AUTO MAKE',model:'TEST MODEL',year:2020,engine:'TEST 2.0',...ev};
const product=(sku,number,extra={})=>({sku,name:'TEST ONLY service filter',brand:'TEST BRAND',description:'SYNTHETIC catalogue acceptance data',image:'',system:'TEST maintenance',category:'TEST filters',unitPriceCents:null,moq:null,supplyStatus:'unconfirmed',published:true,...ev,numbers:[{kind:'oem',brand:'TEST OEM',number,...ev},{kind:'cross',brand:'TEST CROSS',number:'QA-X-900',...ev},{kind:'manufacturer',brand:'TEST BRAND',number:'QA-M-42',...ev}],fitments:[vehicle],...extra});
const fixtures=[product('QA-AUTO','QA-1234'),product('QA-HYPHEN','QA1234',{numbers:[{kind:'oem',brand:'TEST',number:'QA1234',...ev}]}),product('QA-MOTO','MC-888',{fitments:[{...vehicle,type:'moto',make:'TEST MOTO MAKE',model:'TEST BIKE',engine:'TEST 150cc'}],numbers:[{kind:'manufacturer',brand:'TEST',number:'MC-888',...ev}]}),product('QA-UNPUBLISHED','SECRET-123',{published:false,numbers:[{kind:'oem',brand:'TEST',number:'SECRET-123',...ev}]})];
async function server(){
  const child=spawn(php,[...args,'-S','127.0.0.1:0','-t',publicRoot],{env:{...process.env,ORDER_STORAGE_DIR:storage,PARTS_STORAGE_DIR:storage,ORDER_SETTINGS_FILE:path.join(storage,'settings.json'),INQUIRY_STORAGE_DIR:path.join(storage,'inquiries')},stdio:['ignore','pipe','pipe']});
  let log='';const base=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error(log));},10000);child.stderr.on('data',b=>{log+=b;const m=log.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(`http://127.0.0.1:${m[1]}`);}});child.once('error',e=>{clearTimeout(timer);reject(e);});});
  return {base,stop:async()=>{child.kill();await once(child,'exit');await writeFile(path.join(run,'php-test.log'),log);}};
}
test('PHP + SQLite search, vehicle fitment, private images and source-to-order quotation end to end',async()=>{
  let app=await server();const evidence={synthetic:true,realCatalogDataProvided:false,run,verifiedAt:new Date().toISOString(),checks:[]};
  const post=(file,data,key=admin)=>fetch(`${app.base}/api/${file}`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(data)});
  const get=async(params)=>{const r=await fetch(`${app.base}/api/parts.php?${new URLSearchParams(params)}`);assert.equal(r.status,200,await r.clone().text());return r.json();};
  const sourcePayload=()=>({action:'create',requestId:randomUUID(),name:'QA TEST ONLY',email:'qa@example.invalid',country:'United Kingdom',company:'TEST ONLY',partNumber:'NOT-IN-CATALOG-778',keywords:'TEST ONLY unlisted part',vehicle:'TEST AUTO MAKE / TEST MODEL / 2020 / TEST 2.0',quantity:2,requirements:'Synthetic sourcing request; no real customer or fitment claim',referenceUrl:'https://example.invalid/test-part',consent:true,website:''});
  const upload=async(data,bytes=png,name='TEST-ONLY.png',type='image/png')=>{const body=new FormData();body.set('metadata',JSON.stringify(data));if(bytes)body.append('photos[]',new Blob([bytes],{type}),name);return fetch(`${app.base}/api/sourcing.php`,{method:'POST',body});};
  try{
    assert.equal((await get({q:'QA-1234'})).catalogCount,0,'no catalogue data is fabricated');
    assert.equal((await post('parts.php',{action:'import',products:fixtures},'wrong')).status,401);
    const imported=await post('parts.php',{action:'import',products:fixtures});assert.equal(imported.status,200,await imported.clone().text());
    let r=await get({q:' q a - 1 2 3 4 '});assert.equal(r.total,1);assert.equal(r.products[0].sku,'QA-AUTO');assert.equal(r.products[0].matchType,'part_number_exact');
    r=await get({q:'qa-x-900'});assert.equal(r.products[0].sku,'QA-AUTO');assert.equal(r.products[0].matchType,'cross_reference_exact');
    r=await get({q:'QA-M-42'});assert.equal(r.products[0].matchType,'part_number_exact');
    r=await get({q:'QA1234'});assert.equal(r.products[0].sku,'QA-HYPHEN','hyphens remain significant');
    for(const wrong of ['QA-1235','QA-123O','QA_1234','QA–1234']){r=await get({q:wrong});assert.equal(r.total,0);assert.equal(r.reliableMatch,false);for(const p of r.suggestions)assert.equal(p.matchType,'fuzzy_candidate');}
    assert.equal((await get({q:'QA-1235'})).suggestions.length,1);
    assert.equal((await get({q:'SECRET-123'})).total,0,'unpublished records never appear');
    assert.equal((await get({q:'test brand'})).products[0].matchType,'keyword_candidate');
    evidence.checks.push('OEM/manufacturer exact, case/spaces, verified cross-reference, hyphen/digit/letter separation, labelled fuzzy candidates, unpublished isolation');
    r=await get({type:'auto',make:vehicle.make,model:vehicle.model,year:'2020',engine:vehicle.engine,system:'TEST maintenance',category:'TEST filters'});assert.equal(r.total,2);assert.ok(r.products.every(p=>p.fitments.every(v=>v.type==='auto')));
    r=await get({type:'moto',make:'TEST MOTO MAKE',model:'TEST BIKE',year:'2020',engine:'TEST 150cc'});assert.equal(r.total,1);assert.equal(r.products[0].sku,'QA-MOTO');
    assert.equal((await get({type:'auto',make:'TEST MOTO MAKE'})).total,0);
    assert.deepEqual((await get({action:'options',type:'moto',level:'make'})).options,['TEST MOTO MAKE']);
    assert.deepEqual((await get({action:'options',type:'auto',make:vehicle.make,model:vehicle.model,year:'2020',level:'engine'})).options,[vehicle.engine]);
    assert.equal((await get({q:"%' OR 1=1 --"})).total,0);
    evidence.checks.push('car make/model/year/engine/system/category, separate motorcycle fitment and dependent filter options');
    const bad=product('QA-BAD','BAD-123',{fitments:[{...vehicle,source:''}]});
    assert.equal((await post('parts.php',{action:'import',products:[product('QA-ROLLBACK','ROLL-1'),bad]})).status,422);
    assert.equal((await get({q:'ROLL-1'})).total,0,'failed import rolls back the complete batch');
    assert.equal((await post('parts.php',{action:'import',products:[fixtures[0]]})).status,409,'stale edits blocked');
    assert.equal((await post('parts.php',{action:'import',products:[product('QA-PRICE','PRICE-1',{unitPriceCents:100})]})).status,422,'unsupported price claim rejected');
    const catalog=await(await fetch(`${app.base}/api/orders.php`)).json();assert.ok(catalog.products.some(p=>p.sku==='PB-BRK-001'));assert.ok(catalog.products.some(p=>p.sku==='QA-AUTO'));assert.ok(!catalog.products.some(p=>p.sku==='QA-UNPUBLISHED'));
    const mixedKey=randomBytes(32).toString('hex');
    const mixed=await post('orders.php',{action:'create',requestId:randomUUID(),customer:{name:'QA',email:'qa@example.invalid',company:'TEST ONLY',country:'UK',address:'TEST ONLY address'},items:[{sku:'QA-AUTO',quantity:2},{sku:'PB-BRK-001',quantity:3}],notes:'SYNTHETIC mixed search/legacy cart test'},mixedKey);assert.equal(mixed.status,201,await mixed.clone().text());assert.equal((await mixed.json()).order.items.length,2);
    const request=sourcePayload();let response=await upload(request);assert.equal(response.status,201,await response.clone().text());const receipt=await response.json();assert.match(receipt.sourcingNumber,/^SR-\d{8}-[A-F0-9]{16}$/);assert.equal(receipt.fileCount,1);
    response=await upload(request);assert.equal(response.status,200);assert.equal((await response.json()).sourcingNumber,receipt.sourcingNumber);
    assert.equal((await upload({...request,quantity:3})).status,409);
    assert.equal((await upload(sourcePayload(),Buffer.from('<?php echo "unsafe";'),'bad.png')).status,422,'fake image rejected by content inspection');
    assert.equal((await post('sourcing.php',{action:'admin_list'},'wrong')).status,401);
    let detail=(await(await post('sourcing.php',{action:'admin_read',sourcingNumber:receipt.sourcingNumber})).json()).request;assert.equal(detail.details.partNumber,request.partNumber);assert.equal(detail.details.vehicle,request.vehicle);assert.equal(detail.files.length,1);
    const fileResponse=await post('sourcing.php',{action:'admin_file',fileId:detail.files[0].id});assert.equal(fileResponse.status,200);assert.equal(createHash('sha256').update(Buffer.from(await fileResponse.arrayBuffer())).digest('hex'),createHash('sha256').update(png).digest('hex'));
    // PHP's development server may fall back to index.html instead of a 404.
    for(const url of ['/private/parts.sqlite',`/sourcing-images/${detail.files[0].id}.bin`]){
      const response=await fetch(app.base+url),bytes=Buffer.from(await response.arrayBuffer());
      assert.ok(response.status===404||response.headers.get('content-type')?.startsWith('text/html'));
      assert.ok(!bytes.subarray(0,16).toString().startsWith('SQLite format'));assert.notDeepEqual(bytes,png);
    }
    evidence.sourcingNumber=receipt.sourcingNumber;evidence.uploadSha256=detail.files[0].sha256;evidence.checks.push('unlisted image multipart upload, private image content hash, durable receipt, safe retries, duplicate conflict, spoofed image rejection, administrator-only access');
    assert.equal((await post('orders.php',{action:'source_convert',sourcingNumber:receipt.sourcingNumber,productName:'TEST private part',specification:'TEST ONLY verified spec',customer:{address:'TEST ONLY address'}})).status,409,'review is required before conversion');
    response=await post('sourcing.php',{action:'admin_update',sourcingNumber:receipt.sourcingNumber,expectedVersion:1,status:'located',note:'SYNTHETIC supplier check; fitment NOT established from image'});assert.equal(response.status,200);
    const convert={action:'source_convert',sourcingNumber:receipt.sourcingNumber,productName:'TEST ONLY private sourced part',specification:'SYNTHETIC source specification; fitment pending written verification',customer:{address:'TEST ONLY delivery address'}};
    response=await post('orders.php',convert);assert.equal(response.status,201,await response.clone().text());const converted=await response.json();let order=converted.order;assert.ok(converted.orderAccessKey);assert.equal(order.items[0].quantity,2);assert.equal(order.items[0].unitPriceCents,null);
    response=await post('orders.php',convert);assert.equal(response.status,200);assert.equal((await response.json()).order.orderNumber,order.orderNumber);
    const quote={action:'quote',orderNumber:order.orderNumber,expectedVersion:order.version,items:order.items.map(i=>({sku:i.sku,quantity:i.quantity,availability:'available',unitPriceCents:1250,wholesaleCostCents:900,supplier:'SYNTHETIC supplier',stockVerified:2,leadTime:'TEST ONLY 7 days',note:'SYNTHETIC QA quotation, no actual goods'})),shippingCents:500,shippingTerms:'TEST ONLY shipping',quoteNote:'SYNTHETIC full-payment flow, no money collected'};
    response=await post('orders.php',quote);assert.equal(response.status,200,await response.clone().text());const quoted=await response.json();order=quoted.order;assert.equal(order.totalCents,3000);
    response=await post('orders.php',{action:'read',orderNumber:order.orderNumber},quoted.quoteAccessKey);assert.equal(response.status,200);assert.equal((await response.json()).order.items[0].supplier,undefined);
    response=await post('orders.php',{action:'confirm',orderNumber:order.orderNumber,expectedVersion:order.version,quoteRevision:1,totalCents:3000},quoted.quoteAccessKey);assert.equal(response.status,200);order=(await response.json()).order;assert.equal(order.status,'confirmed');
    response=await post('orders.php',{action:'paypal_create',orderNumber:order.orderNumber,expectedVersion:order.version},quoted.quoteAccessKey);assert.equal(response.status,503,'unconfigured PayPal fails closed; no simulated payment');
    const noResult=await get({q:'NOT-IN-CATALOG-778',type:'auto',make:vehicle.make});assert.equal(noResult.reliableMatch,false);
    const fallback=sourcePayload();fallback.partNumber=noResult.query;fallback.requirements='TEST no-result fallback';response=await upload(fallback,null);assert.equal(response.status,201);evidence.fallbackNumber=(await response.json()).sourcingNumber;
    evidence.checks.push('source located -> private product order -> quote -> private customer link -> confirm total -> unconfigured PayPal blocked; no-result request preserves original query/vehicle');
    evidence.privateOrderNumber=order.orderNumber;evidence.paymentStatus=order.paymentStatus;evidence.paypalLiveVerified=false;
    await app.stop();app=await server();assert.equal((await get({q:'QA-1234'})).total,1);
    detail=(await(await post('sourcing.php',{action:'admin_read',sourcingNumber:receipt.sourcingNumber})).json()).request;assert.equal(detail.linkedOrder,order.orderNumber);assert.equal(detail.files.length,1);
    evidence.checks.push('database and private uploaded image survive PHP restart');
    const reference=JSON.parse(await readFile(path.join(root,'config/reference-validation.json'),'utf8'));
    response=await post('parts.php',{action:'import',products:reference.products});assert.equal(response.status,200,await response.clone().text());
    for(const number of ['HU 719/7 x','071115562A','045115466C']){
      r=await get({q:number});assert.equal(r.total,1);assert.equal(r.products[0].sku,'REF-MANN-HU7197X');assert.equal(r.products[0].unitPriceCents,null);assert.equal(r.products[0].supplyStatus,'unconfirmed');
      assert.equal(r.products[0].matchType,number==='045115466C'?'cross_reference_exact':'part_number_exact');
    }
    r=await get({type:'auto',make:'AUDI',model:'A2 (8Z)',year:'2001',engine:reference.products[0].fitments[0].engine,system:'Filters & maintenance',category:'Oil filters'});assert.equal(r.total,1);assert.equal(r.products[0].sku,'REF-MANN-HU7197X');
    evidence.officialReference={source:reference.products[0].source,manufacturerNumber:'HU 719/7 x',oemNumber:'071115562A',crossReference:'045115466C',vehicle:'AUDI A2 (8Z), production year 2001, 1.2 TDI / ANY',operatingCatalogImported:false};
    evidence.checks.push('official MANN-FILTER manufacturer number, OE number, cross-reference and documented production-year/engine lookup against the real database; no invented commercial data');
    response=await post('parts.php',{action:'import',products:[product('QA-MOQ','MOQ-1',{moq:3,commercialEvidence:'SYNTHETIC MOQ TEST ONLY'})]});assert.equal(response.status,200);
    response=await post('orders.php',{action:'create',requestId:randomUUID(),customer:{name:'QA',email:'qa@example.invalid',company:'TEST ONLY',country:'UK',address:'TEST ONLY address'},items:[{sku:'QA-MOQ',quantity:1}],notes:'SYNTHETIC below-MOQ test'},randomBytes(32).toString('hex'));assert.equal(response.status,422,'MOQ cannot be bypassed by sending a direct order request');
    evidence.checks.push('verified product MOQ enforced by order API');
    const integrity=spawnSync(php,[...args,'-r',`$d=new PDO('sqlite:'.getenv('QA_DB'));echo $d->query('PRAGMA integrity_check')->fetchColumn();`],{encoding:'utf8',env:{...process.env,QA_DB:path.join(storage,'parts.sqlite')}});assert.equal(integrity.stdout,'ok');
    await writeFile(path.join(run,'acceptance-evidence.json'),JSON.stringify(evidence,null,2));
    await writeFile(path.join(root,'data/search-tests/latest.json'),JSON.stringify({run,synthetic:true},null,2));
    console.log(`Acceptance evidence: ${path.join(run,'acceptance-evidence.json')}`);
  }finally{await app.stop();}
});
