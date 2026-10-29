import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {SingleDocumentError,SINGLE_DOCUMENT_ORIGIN} from '../extensions/supplier-hub/single-document.mjs';
import {assertSingleOwnedTarget,waitSingleOwnedTarget} from '../extensions/supplier-hub/single-owned-target.mjs';

const binding={identity:{appTabId:4,windowId:7},requestId:'request',packetDigest:'a'.repeat(64)},target={tabId:90,windowId:7,origin:SINGLE_DOCUMENT_ORIGIN,requestId:'request',packetDigest:binding.packetDigest};
const tab={id:90,windowId:7,url:SINGLE_DOCUMENT_ORIGIN+'/dashboard/KR',status:'complete'};
const reason=expected=>error=>error instanceof SingleDocumentError&&error.code==='TAB_CHANGED'&&error.reason===expected&&error.message.includes('확인 사유: '+expected)&&!/PRIVATE|secret|https?:|cookie|token/.test(error.message);

test('target binding failure retains TAB_CHANGED with a fixed reason and no descriptor values',()=>{
 for(const value of [null,{...target,tabId:4},{...target,windowId:8},{...target,requestId:'PRIVATE_request'},{...target,packetDigest:'PRIVATE_digest'}])assert.throws(()=>assertSingleOwnedTarget(value,binding),reason('target-binding'));
});

test('a tabs.get exception is unconfirmed rather than proof of closure, with no raw provider error exposed',async()=>{
 let calls=0;await assert.rejects(waitSingleOwnedTarget({tabs:{get:async()=>{calls++;throw Object.assign(Error('PRIVATE cookie=secret https://private.test/login'),{stack:'PRIVATE token'});}}},target,binding),reason('tab-get-unconfirmed'));assert.equal(calls,1);
});

test('window, URL, origin and exact dashboard path failures remain distinct and fail before any fallback',async()=>{
 const changes=[['target-binding',{id:91}],['window-changed',{windowId:8}],['url-invalid',{url:'PRIVATE invalid url'}],['origin-changed',{url:'https://private.test/dashboard/KR'}],['origin-changed',{url:'https://PRIVATE:secret@supplier.coupang.com/dashboard/KR'}],['path-changed',{url:SINGLE_DOCUMENT_ORIGIN+'/sr/sso/login'}],['path-changed',{url:SINGLE_DOCUMENT_ORIGIN+'/dashboard/KR?token=PRIVATE'}],['path-changed',{url:SINGLE_DOCUMENT_ORIGIN+'/dashboard/KR#PRIVATE'}],['path-changed',{pendingUrl:SINGLE_DOCUMENT_ORIGIN+'/login'}]];
 for(const [expected,change]of changes){let calls=0;await assert.rejects(waitSingleOwnedTarget({tabs:{get:async()=>{calls++;return{...tab,...change};}}},target,binding),reason(expected));assert.equal(calls,1);}
});

test('the exact completed owned dashboard remains valid',async()=>{
 const current=await waitSingleOwnedTarget({tabs:{get:async()=>({...tab})}},target,binding);assert.deepEqual(current,tab);
});

test('loading exhaustion keeps the exact original 80 attempts and fixed timeout reason',async()=>{
 const source=fs.readFileSync(new URL('../extensions/supplier-hub/single-owned-target.mjs',import.meta.url),'utf8').replace(/^import .*\r?\n/u,'').replaceAll('export ','');const delays=[];
 const {waitSingleOwnedTarget:wait}=vm.runInNewContext(source+'\n({waitSingleOwnedTarget})',{SINGLE_DOCUMENT_ORIGIN,SingleDocumentError,URL,setTimeout:(resolve,ms)=>{delays.push(ms);queueMicrotask(resolve);}});let calls=0;
 await assert.rejects(wait({tabs:{get:async()=>{calls++;return{...tab,status:'loading'};}}},target,binding),reason('load-timeout'));assert.equal(calls,80);assert.deepEqual(delays,Array(80).fill(100));
});
