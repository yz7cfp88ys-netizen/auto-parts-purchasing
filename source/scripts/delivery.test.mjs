import {test} from 'node:test';
import assert from 'node:assert/strict';
import {submitInquiry} from '../delivery.js';

const inquiry={requestId:'12e35dbd-8c35-4fc0-95bb-97a7daaa013f'};
const receipt={status:'saved',reference:'IQ-12E35DBD8C354FC095BB97A7DAAA013F',receivedAt:'2026-10-17T00:00:00Z'};
const options=(fetcher)=>({fetcher,baseUrl:'https://preview.example.test/shop/'});

test('receipt requires a matching saved reference, posts only to the same site',async()=>{
  let request;
  const result=await submitInquiry('./api/inquiries.php',inquiry,options(async(url,init)=>{
    request={url,init};return {ok:true,json:async()=>receipt};
  }));
  assert.deepEqual(result,receipt);
  assert.equal(request.url,'https://preview.example.test/shop/api/inquiries.php');
  assert.equal(request.init.method,'POST');
  assert.equal(request.init.redirect,'error');
  assert.deepEqual(JSON.parse(request.init.body),inquiry);
  await assert.rejects(submitInquiry('https://other.example.test/api',inquiry,options(()=>{throw new Error('must not send');})),/this website/);
});

test('never reports a successful receipt for server failures, HTML or mismatched replies',async()=>{
  for(const response of [
    {ok:false,status:503},
    {ok:true,json:async()=>{throw new SyntaxError('HTML instead of JSON');}},
    {ok:true,json:async()=>({...receipt,status:'queued'})},
    {ok:true,json:async()=>({...receipt,reference:'OTHER'})},
    {ok:true,json:async()=>({...receipt,receivedAt:'unknown'})},
  ])await assert.rejects(submitInquiry('./api/inquiries.php',inquiry,options(async()=>response)));
});

test('rate limiting and timeout keep failures explicit',async()=>{
  await assert.rejects(submitInquiry('./api/inquiries.php',inquiry,options(async()=>({ok:false,status:429}))),/Too many/);
  await assert.rejects(submitInquiry('./api/inquiries.php',inquiry,{
    ...options((url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))))),timeoutMs:5,
  }),/timed out/);
});
