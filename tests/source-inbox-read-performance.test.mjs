import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceInboxReadHarness,inboxReadSnapshot,inboxReadCompany,inboxReadId} from './helpers/source-inbox-read.mjs';

test('serialized list keeps exact full receipts, versions, review/status parity and validates each receipt once',async()=>{
 const h=sourceInboxReadHarness();try{
  for(let i=1;i<=6;i++){
   const source=inboxReadSnapshot(i);if(i===2){source.options[0].unitPriceCny=null;source.options[0].currency=null;}
   if(i===3)source.options[1].supplierSku=source.options[0].supplierSku;
   if(i===4)source.options[0].imageUrl='https://cbu01.alicdn.com/not-in-gallery.jpg';
   const reviewed=i===5?{...source,title:'검토한 제목 "quoted"',options:source.options.slice(0,1)}:null;
   h.seed(i,source,{reviewed});
  }
  const before=JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox_captures').all()),expected=await h.db.listSourceInbox('owner',inboxReadCompany);h.stats.validations=0;
  const response=await h.api.GET(),body=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(body.items,JSON.parse(JSON.stringify(expected)));assert.deepEqual(body.items.map(item=>item.captureVersion),[6,5,4,3,2,1]);assert.equal(h.stats.validations,7,'six snapshots plus one review; no status revalidation');
  assert.deepEqual(body.items.find(item=>item.captureVersion===2).issues,['옵션 원가','위안(CNY) 통화']);assert.deepEqual(body.items.find(item=>item.captureVersion===3).issues,['중복 공급자 SKU']);assert.deepEqual(body.items.find(item=>item.captureVersion===4).issues,['옵션 이미지 원본 연결']);
  assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM source_inbox_captures').all()),before);
 }finally{h.close();}
});

test('list scope excludes archived and foreign owner/company records before validation',async()=>{
 const h=sourceInboxReadHarness();try{
  h.seed(1);h.seed(2);h.seed(3,inboxReadSnapshot(3),{archivedAt:'2026-10-22T00:00:04Z'});
  h.seed(4,inboxReadSnapshot(4),{originId:inboxReadId(4),ownerId:'foreign'});
  h.seed(5,{...inboxReadSnapshot(5),offerId:'806000000005',sourceUrl:'https://detail.1688.com/offer/806000000005.html'},{originId:inboxReadId(5),capturedCompany:{code:'A01526306',name:'유앤채'}});
  // Even a corrupt foreign-company row cannot break or enter this member list.
  h.sqlite.prepare('UPDATE source_inbox SET payload=? WHERE id=?').run('{"bad":"stored"}',inboxReadId(5));h.stats.validations=0;
  const body=await(await h.api.GET()).json();assert.deepEqual(body.items.map(item=>item.id),[inboxReadId(2),inboxReadId(1)]);assert.equal(h.stats.validations,2);
  h.scope('foreign');assert.deepEqual((await(await h.api.GET()).json()).items.map(item=>item.id),[inboxReadId(4)]);
 }finally{h.close();}
});

test('corrupt JSON and malformed stored values fail visibly instead of producing ready or partial listings',async()=>{
 for(const payload of ['not json','{"format":"yoofam-page-source-v1"}',JSON.stringify({...inboxReadSnapshot(),options:[{key:'incomplete'}]})]){
  const h=sourceInboxReadHarness();try{h.seed(1);h.seed(2);h.sqlite.prepare('UPDATE source_inbox_captures SET payload=? WHERE id=?').run(payload,inboxReadId(2));const response=await h.api.GET(),body=await response.json();assert.equal(response.status,503);assert.equal(body.items,undefined);assert.match(body.error,/최신 수집 상태가 아닐 수/);}finally{h.close();}
 }
 for(const review of ['', '{}', 'not json']){
  const h=sourceInboxReadHarness();try{h.seed(1);h.sqlite.prepare('UPDATE source_inbox SET review_payload=?').run(review);const response=await h.api.GET();assert.equal(response.status,503);assert.equal((await response.json()).items,undefined);}finally{h.close();}
 }
});

test('40 synthetic captures keep latest first without modifying immutable payloads or lowering the limit',async()=>{
 const h=sourceInboxReadHarness();try{for(let i=1;i<=40;i++)h.seed(i);const before=JSON.stringify(h.sqlite.prepare('SELECT payload,review_payload FROM source_inbox_captures').all()),body=await(await h.api.GET()).json();assert.equal(body.items.length,40);assert.equal(body.items[0].captureVersion,40);assert.equal(body.items.at(-1).captureVersion,1);assert.equal(body.limits.active,40);assert.equal(h.stats.validations,40);assert.equal(JSON.stringify(h.sqlite.prepare('SELECT payload,review_payload FROM source_inbox_captures').all()),before);}finally{h.close();}
});
