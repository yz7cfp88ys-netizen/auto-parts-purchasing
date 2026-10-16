import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatInquiry,validateInquiry} from '../inquiry.js';
const example=()=>({name:'Alex',email:'alex@example.com',company:'Workshop',country:'UK',business:'Auto repair workshop',orderType:'Small batch / mixed parts',parts:[{description:'Brake pads / reference 123',quantity:12}],services:['Inspection'],notes:'Check fitment first.'});
test('export preserves buyer requirements and clarifies commercial status',()=>{const text=formatInquiry(example());assert.match(text,/Quantity: 12/);assert.match(text,/Brake pads \/ reference 123/);assert.match(text,/Inspection/);assert.match(text,/Check fitment first/);assert.match(text,/Not an order/);});
test('rejects missing required details and empty parts',()=>{for(const key of ['name','email','company','country','business','orderType'])assert.throws(()=>validateInquiry({...example(),[key]:''}));assert.throws(()=>validateInquiry({...example(),parts:[]}));});
test('rejects fractional, negative, excessive or nonnumeric quantities',()=>{for(const quantity of [0,-1,1.2,1000001,NaN,Infinity])assert.throws(()=>validateInquiry({...example(),parts:[{description:'Filter',quantity}]}));});
test('rejects invalid email and blank part descriptions',()=>{assert.throws(()=>validateInquiry({...example(),email:'wrong'}));assert.throws(()=>validateInquiry({...example(),parts:[{description:' ',quantity:1}]}));});
test('accepts mixed parts and prevents header field line injection',()=>{const text=formatInquiry({...example(),name:'Alex\nInjected',parts:[{description:'Filter\nSKU 7',quantity:2},{description:'Cable',quantity:4}]});assert.match(text,/Name: Alex Injected/);assert.match(text,/2\. Cable \| Quantity: 4/);});
