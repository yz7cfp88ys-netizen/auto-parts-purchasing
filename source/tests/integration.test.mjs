import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SMTPServer} from 'smtp-server';
import {once} from 'node:events';
import {fixture} from './helpers.mjs';
import {mailWorker} from '../server/mail.js';
import {createApp} from '../server/app.js';
import {readConfig} from '../server/config.js';
import {submitInquiry} from '../delivery.js';
import {fileURLToPath} from 'node:url';

test('real SQL / HTTP / SMTP procurement workflow',async t=>{
  const f=await fixture();t.after(()=>f.close());let cookie='',csrf='',category,product,inquiryId,reference;
  const suffix=randomUUID().slice(0,8);
  async function call(url,{method='GET',body,authenticated=true,origin=f.base,csrfValue=csrf}={}){
    const response=await fetch(f.base+url,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{}),...(authenticated&&cookie?{Cookie:cookie,'X-CSRF-Token':csrfValue}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const data=await response.json();return{response,data};
  }
  const payload={requestId:randomUUID(),name:'Test buyer',email:'buyer@example.test',company:'Integration workshop '+suffix,country:'UK',business:'Auto repair workshop',orderType:'Small batch / mixed parts',consent:true,parts:[]};
  await t.test('fail closed configuration and administrator boundaries',async()=>{
    assert.throws(()=>readConfig({NODE_ENV:'production'}));
    assert.equal((await call('/api/admin/inquiries',{authenticated:false})).response.status,401);
    assert.equal((await call('/api/auth/login',{method:'POST',body:{email:f.config.adminEmail,password:'wrong'},authenticated:false})).response.status,401);
    const login=await call('/api/auth/login',{method:'POST',body:{email:f.config.adminEmail,password:f.password},authenticated:false});assert.equal(login.response.status,200);
    cookie=login.response.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;assert.match(login.response.headers.get('set-cookie'),/HttpOnly/i);assert.match(login.response.headers.get('set-cookie'),/SameSite=Strict/i);
    assert.equal((await call('/api/admin/categories',{method:'POST',body:{name:'Blocked'},csrfValue:''})).response.status,403);
    assert.equal((await call('/api/admin/categories',{method:'POST',body:{name:'Blocked'},origin:'https://evil.example'})).response.status,403);
  });
  await t.test('category and product creation, editing, filtering and duplicate safeguards',async()=>{
    let result=await call('/api/admin/categories',{method:'POST',body:{name:'Integration brakes '+suffix}});assert.equal(result.response.status,201);category=result.data;
    result=await call('/api/admin/products',{method:'POST',body:{sku:'QA-'+suffix,name:'Test brake pad <script>alert(1)</script>',categoryId:category.id,vehicleType:'auto',description:'Synthetic test record',specifications:'OEM-QA '+suffix,imageUrl:''}});assert.equal(result.response.status,201);product=result.data;
    result=await call('/api/admin/products',{method:'POST',body:{...product,id:undefined}});assert.equal(result.response.status,409);
    result=await call('/api/products?'+new URLSearchParams({q:suffix,category:category.id,vehicleType:'auto'}));assert.equal(result.data.products[0].id,product.id);
    assert.equal((await call('/api/products?'+new URLSearchParams({q:suffix,vehicleType:'moto'}))).data.total,0);
    const edited={...product,id:undefined,name:'Test pad revised '+suffix};assert.equal((await call(`/api/admin/products/${product.id}`,{method:'PUT',body:edited})).response.status,200);
    assert.equal((await call(`/api/admin/products/${product.id}`,{method:'PUT',body:edited})).response.status,409);
    assert.equal((await call(`/api/admin/categories/${category.id}`,{method:'DELETE'})).response.status,415);
    assert.equal((await call(`/api/admin/categories/${category.id}`,{method:'DELETE',body:{}})).response.status,409);
  });
  payload.parts=[{productId:product.id,description:'Tampered name',quantity:12,specifications:'Vehicle year 2020'},{description:'Unlisted motorcycle cable',quantity:3,specifications:'Length 90 cm'}];
  await t.test('customer delivery helper stores real multi-item inquiry and receives compatible receipt',async()=>{
    const saved=await submitInquiry('/api/inquiries',payload,{baseUrl:f.base,fetcher:(url,init)=>fetch(url,{...init,headers:{...init.headers,Origin:f.base}})});
    reference=saved.reference;assert.match(reference,/^IQ-[A-F0-9]{32}$/);
    const list=await call('/api/admin/inquiries?'+new URLSearchParams({q:reference}));assert.equal(list.data.inquiries.length,1);inquiryId=list.data.inquiries[0].id;
    const {data:d}=await call(`/api/admin/inquiries/${inquiryId}`);assert.equal(d.items.length,2);assert.equal(d.items[0].description,'Test pad revised '+suffix);assert.equal(d.items[0].quantity,12);assert.equal(d.items[1].product_id,null);assert.equal(d.items[1].specifications,'Length 90 cm');assert.equal(d.notification_status,'pending');
  });
  await t.test('disabled mail preserves the real pending notification without consuming attempts',async()=>{
    const worker=mailWorker(f.pool,f.config);assert.equal(worker.configured,false);assert.deepEqual(await worker.runOnce(),{configured:false});await worker.stop();
    const detail=(await call(`/api/admin/inquiries/${inquiryId}`)).data;assert.equal(detail.notification_status,'pending');assert.equal(detail.notification_attempts,0);
  });
  await t.test('concurrent retries save once and conflicting idempotency keys are rejected',async()=>{
    const results=await Promise.all(Array.from({length:3},()=>call('/api/inquiries',{method:'POST',body:payload,authenticated:false})));
    for(const r of results){assert.equal(r.response.status,201);assert.equal(r.data.reference,reference);}
    assert.equal((await call('/api/inquiries',{method:'POST',body:{...payload,notes:'changed'},authenticated:false})).response.status,409);
    const [[{count}]]=await f.pool.execute('SELECT COUNT(*) AS count FROM ams_inquiries WHERE request_id=?',[payload.requestId]);assert.equal(count,1);
  });
  await t.test('validation, SQL injection and atomic rollback',async()=>{
    for(const body of [{...payload,requestId:randomUUID(),consent:false},{...payload,requestId:randomUUID(),parts:[{description:'bad quantity',quantity:0}]},{...payload,requestId:randomUUID(),email:'bad\r\nBcc: victim@example.test'}])assert.equal((await call('/api/inquiries',{method:'POST',body,authenticated:false})).response.status,400);
    const key=randomUUID();assert.equal((await call('/api/inquiries',{method:'POST',body:{...payload,requestId:key,parts:[{description:'Valid first item',quantity:1},{description:'missing product',quantity:1,productId:randomUUID()}]},authenticated:false})).response.status,409);
    const [[{count}]]=await f.pool.execute('SELECT COUNT(*) AS count FROM ams_inquiries WHERE request_id=?',[key]);assert.equal(count,0);
    assert.equal((await call('/api/products?'+new URLSearchParams({q:"' OR 1=1 --"}))).data.total,0);
  });
  await t.test('status updates and audit history use optimistic locking',async()=>{
    const {data:d}=await call(`/api/admin/inquiries/${inquiryId}`),body={status:'reviewing',adminNotes:'Verify vehicle fitment',version:d.version};
    assert.equal((await call(`/api/admin/inquiries/${inquiryId}`,{method:'PATCH',body})).response.status,200);
    assert.equal((await call(`/api/admin/inquiries/${inquiryId}`,{method:'PATCH',body})).response.status,409);
    const detail=(await call(`/api/admin/inquiries/${inquiryId}`)).data;assert.equal(detail.status,'reviewing');assert.equal(detail.events.length,2);
  });
  await t.test('retiring products preserves historical SKU and product snapshots',async()=>{
    assert.equal((await call(`/api/admin/products/${product.id}`,{method:'DELETE',body:{}})).response.status,200);
    assert.equal((await call('/api/products?'+new URLSearchParams({q:suffix}))).data.total,0);
    const detail=(await call(`/api/admin/inquiries/${inquiryId}`)).data;assert.equal(detail.items[0].sku_snapshot,product.sku);
  });
  await t.test('persistent database and sessions survive server and connection-pool restart',async()=>{
    await f.restart();assert.equal((await call('/api/admin/session')).response.status,200);
    const d=(await call(`/api/admin/inquiries/${inquiryId}`)).data;assert.equal(d.reference,reference);assert.equal(d.status,'reviewing');
  });
  await t.test('SMTP failure retains inquiry, retry actually sends via local SMTP protocol',async()=>{
    // Dedicated protocol receiver, not evidence of delivery to an external inbox.
    const smtp=new SMTPServer({authOptional:true,disabledCommands:['AUTH','STARTTLS'],onRcptTo(address,session,done){recipients.push(address.address);done();},onData(stream,session,done){let text='';stream.on('data',chunk=>text+=chunk);stream.on('end',()=>{messages.push(text);done();});}}),messages=[],recipients=[];
    smtp.listen(0,'127.0.0.1');await once(smtp.server,'listening');const smtpPort=smtp.server.address().port;
    t.after(()=>new Promise(resolve=>smtp.close(resolve)));
    // Scope outbox processing to this run's job, keeping earlier test records intact.
    await f.pool.execute("UPDATE ams_outbox SET next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY) WHERE inquiry_id<>? AND status<>'sent'",[inquiryId]);
    let worker=mailWorker(f.pool,{...f.config,mailEnabled:true,smtp:{host:'127.0.0.1',port:smtpPort,secure:false,requireTLS:true,connectionTimeout:2000,socketTimeout:2000},mailFrom:'notify@example.test',mailTo:'operator@example.test'});
    assert.equal((await worker.runOnce()).sent,false);await worker.stop();assert.equal((await call(`/api/admin/inquiries/${inquiryId}`)).data.notification_status,'failed');
    assert.equal((await call(`/api/admin/inquiries/${inquiryId}/retry-notification`,{method:'POST',body:{}})).response.status,200);
    const mailConfig=readConfig({NODE_ENV:'test',DB_USER:f.config.db.user,DB_NAME:f.config.db.database,ADMIN_EMAIL:f.config.adminEmail,ADMIN_PASSWORD_HASH:f.config.passwordHash,MAIL_ENABLED:'true',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtpPort),SMTP_SECURE:'false',SMTP_REQUIRE_TLS:'false',SMTP_FROM_EMAIL:'notify@example.test'});
    assert.equal(mailConfig.mailTo,f.config.adminEmail);worker=mailWorker(f.pool,{...mailConfig,origin:f.base});
    assert.equal((await worker.runOnce()).sent,true);await worker.stop();assert.equal(messages.length,1);assert.deepEqual(recipients,[f.config.adminEmail]);assert.ok(messages[0].includes(reference));assert.ok(messages[0].includes('Unlisted motorcycle cable'));
    assert.equal((await call(`/api/admin/inquiries/${inquiryId}`)).data.notification_status,'sent');
  });
  await t.test('changing administrator email invalidates existing sessions and requires new identity',async()=>{
    const config={...f.config,adminEmail:'rotated@example.test'},worker=mailWorker(f.pool,config),server=createApp(f.pool,config,fileURLToPath(new URL('../../dist/public/',import.meta.url)),worker).listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const base=`http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(base+'/api/admin/session',{headers:{Cookie:cookie}})).status,401);
      const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({email:config.adminEmail,password:f.password})});assert.equal(login.status,200);
      assert.equal((await call('/api/admin/session')).response.status,200);
    }finally{await new Promise(resolve=>server.close(resolve));await worker.stop();}
  });
  await t.test('public files and APIs protect customer data and credentials',async()=>{
    for(const url of ['/.env','/source/server/schema.sql','/config/catalog.json','/data/node-local.env'])assert.equal((await fetch(f.base+url)).status,404);
    const publicResponse=await fetch(f.base+'/');assert.match(publicResponse.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(publicResponse.headers.get('x-content-type-options'),'nosniff');
    assert.equal((await call('/api/admin/inquiries',{authenticated:false})).response.status,401);
    assert.equal((await call('/api/admin/logout',{method:'POST',body:{}})).response.status,200);
    assert.equal((await call('/api/admin/session')).response.status,401);
  });
  await t.test('production sessions use Secure host-only cookies',async()=>{
    const config={...f.config,production:true};const worker=mailWorker(f.pool,config),server=createApp(f.pool,config,fileURLToPath(new URL('../../dist/public/',import.meta.url)),worker).listen(0,'127.0.0.1');await once(server,'listening');
    try{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:config.origin},body:JSON.stringify({email:config.adminEmail,password:f.password})});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/__Host-ams_session=.*Secure/);}finally{await new Promise(resolve=>server.close(resolve));await worker.stop();}
  });
  await t.test('login brute-force limits and cookie replay after logout are blocked',async()=>{
    assert.equal((await call('/api/admin/session')).response.status,401);
    const config={...f.config},worker=mailWorker(f.pool,config),server=createApp(f.pool,config,fileURLToPath(new URL('../../dist/public/',import.meta.url)),worker).listen(0,'127.0.0.1');await once(server,'listening');
    try{for(let i=0;i<9;i++){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json',Origin:config.origin},body:JSON.stringify({email:config.adminEmail,password:'incorrect'})});assert.equal(r.status,i<8?401:429);}}finally{await new Promise(resolve=>server.close(resolve));await worker.stop();}
  });
});
