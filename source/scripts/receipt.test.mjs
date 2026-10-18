import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,mkdir,readdir,mkdtemp} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const php=process.env.PHP_BINARY||path.join(root,'data/runtime/php-8.5.11/php.exe');
const lint=spawnSync(php,['-l',path.join(root,'source/api/inquiries.php')],{encoding:'utf8'});
assert.equal(lint.status,0,lint.stderr||lint.error?.message);
await mkdir(path.join(root,'data/receipt-tests'),{recursive:true});
const run=await mkdtemp(path.join(root,'data/receipt-tests/run-'));
const publicRoot=path.join(run,'public_html');
const storage=path.join(run,'private/inquiries');
await mkdir(publicRoot,{recursive:true});
const endpoint=path.join(root,'source/api/inquiries.php');
const example=()=>({requestId:randomUUID(),name:'QA TEST — not a customer',email:'qa@example.invalid',company:'LOCAL ACCEPTANCE TEST',country:'United Kingdom',business:'Auto repair workshop',orderType:'Small batch / mixed parts',parts:[{description:'QA brake pads — OEM TEST-001',quantity:12}],services:['Inspection'],notes:'Synthetic acceptance data only. <script> must remain plain text.'});

async function server(directory){
  const child=spawn(php,['-S','127.0.0.1:0','-t',publicRoot,endpoint],{env:{...process.env,INQUIRY_STORAGE_DIR:directory},stdio:['ignore','pipe','pipe']});
  let log='';
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{child.kill();reject(new Error('PHP startup timed out: '+log));},10000);
    child.stderr.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}/api/inquiries.php`);}});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error('PHP exited '+code+': '+log));});
  });
  return {url,stop:async()=>{child.kill();await once(child,'exit');}};
}

test('real PHP HTTP receipt persists exact data, survives restart, and handles failure safely',async()=>{
  let app=await server(storage);
  const post=(data,options={})=>fetch(app.url,{method:'POST',headers:{'Content-Type':'application/json',...options.headers},body:JSON.stringify(data)});
  try{
    const inquiry=example();
    const response=await post(inquiry);assert.equal(response.status,201);
    const receipt=await response.json();assert.equal(receipt.status,'saved');
    const recordPath=path.join(storage,receipt.reference+'.json');
    const record=JSON.parse(await readFile(recordPath,'utf8'));
    assert.equal(record.inquiry.email,inquiry.email);
    assert.deepEqual(record.inquiry.parts,inquiry.parts);
    assert.equal(record.inquiry.notes,inquiry.notes);
    assert.equal(record.reference,receipt.reference);
    assert.equal((await fetch(app.url)).status,405);
    assert.equal((await post(inquiry,{headers:{Origin:'https://other.example.invalid'}})).status,403);
    assert.equal((await post({...example(),parts:[{description:'Filter',quantity:1.5}]})).status,422);
    assert.equal((await post({...example(),website:'spam'})).status,422);
    assert.equal((await post({...example(),email:'bad'})).status,422);
    assert.equal((await post({...example(),notes:'x'.repeat(65537)})).status,413);
    assert.equal((await post({...inquiry,notes:'Different payload'})).status,409);
    const duplicate=await post(inquiry);assert.equal(duplicate.status,200);assert.deepEqual(await duplicate.json(),receipt);
    await app.stop();app=await server(storage);
    const afterRestart=await post(inquiry);assert.equal(afterRestart.status,200);assert.deepEqual(await afterRestart.json(),receipt);
    assert.equal((await readdir(storage)).filter(name=>name.startsWith('IQ-')).length,1);
    for(let i=0;i<9;i++)assert.equal((await post(example())).status,201);
    const limited=await post(example());assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('Retry-After'))>0);
    assert.equal((await post(inquiry)).status,200,'retry of a saved request remains available despite rate limit');
    await app.stop();app=await server(path.join(publicRoot,'unsafe-public-storage'));
    const unsafe=await post(example());assert.equal(unsafe.status,503);assert.doesNotMatch(await unsafe.text(),/status.*saved/);
    await app.stop();app=await server(path.join(recordPath,'cannot-create-directory'));
    const unwritable=await post(example());assert.equal(unwritable.status,503);assert.doesNotMatch(await unwritable.text(),/status.*saved/);
    console.log('Private test records retained at '+run);
  }finally{await app.stop();}
});
