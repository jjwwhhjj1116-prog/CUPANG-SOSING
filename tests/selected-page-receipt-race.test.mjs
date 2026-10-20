import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPageSource} from '../extensions/supplier-hub/page-source.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{companyCode:'A01526306',companyName:'유앤채'},{companyCode:'A01464742',companyName:'와이홉'}];
const id='75300000-0000-4000-8000-000000000001';
const plain=value=>JSON.parse(JSON.stringify(value));
function state(h){return JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,h.sqlite.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]));}
async function source(h,company){
 const snapshot=extractPageSource({sourceUrl:h.sourceUrl,title:'合成测试商品',priceText:'¥5.00',minimumOrderText:'1件起批',scripts:[JSON.stringify({subject:'合成测试商品',skuModel:{offerId:'813724060928',skuInfoMap:{black:{skuId:'synthetic-black',specAttrs:'黑色',price:'5.00'}}},offerImgList:['https://cbu01.alicdn.com/synthetic-753.png']})]});
 const fp=await h.load('app/source-inbox.ts').pageSourceFingerprint(snapshot),api=h.load('app/api/source-inbox/route.ts');
 const response=await api.POST(new Request('https://app.test/api/source-inbox',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',expectedCompany:{code:company.companyCode,name:company.companyName},id,fingerprint:fp,snapshot})}));
 assert.equal(response.status,200,await response.clone().text());
 return {snapshot,api,capture:{format:'yoofam-saved-page-capture-v1',sourceUrl:h.sourceUrl,captureId:id,fingerprint:fp,revision:1}};
}
for(const company of companies)for(const endpoint of ['collect','browser-capture'])test(`${company.companyCode} ${endpoint} cannot ACK a different selected source after another receipt wins`,async()=>{
 const h=mobileIntakeHarness(company);try{
  const f=await source(h,company),send=capture=>h.route('/api/collection-jobs/job/'+endpoint,{method:'POST',body:endpoint==='collect'?{browserCapture:capture}:capture});
  const initial=await send(f.capture);assert.equal(initial.status,200,await initial.clone().text());const receipt=await initial.json();
  const stable=state(h),same=await send(f.capture);assert.equal(same.status,200,await same.clone().text());assert.deepEqual(plain((await same.json()).receipt),plain(receipt.receipt));assert.equal(state(h),stable);
  const options=f.snapshot.options.map(({key,name,supplierSku,currency,minimumOrder})=>({key,name,supplierSku,currency,minimumOrder,unitPriceCny:8}));
  const reviewed=await f.api.PUT(new Request('https://app.test/api/source-inbox',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedOwnerId:'owner',id,expectedRevision:1,review:{title:'새 검토 상품',options}})}));assert.equal(reviewed.status,200,await reviewed.clone().text());
  const before=state(h),changed=await send({...f.capture,revision:2});assert.equal(changed.status,409,await changed.clone().text());assert.equal((await changed.json()).code,'SOURCE_SELECTION_CONFLICT');assert.equal(state(h),before);
  assert.equal((await send(f.capture)).status,422);assert.equal(state(h),before);
  assert.deepEqual(plain(await h.load('db/collection-results.ts').readCollectionResult('owner','job')),plain(receipt.receipt));
  assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{h.close();}
});

for(const endpoint of ['collect','browser-capture'])test(`${endpoint} cannot ACK a different effective supplement racing the first selected-source save`,async()=>{
 const company=companies[1],h=mobileIntakeHarness(company);try{
  const f=await source(h,company),receipts=h.load('db/collection-results.ts'),store=receipts.storeCollectionResult;
  receipts.storeCollectionResult=async(...args)=>{
   const saved=await store(...args);assert.equal(saved.status,'stored');
   const raw=h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job').payload;
   const supplement={...saved.result,description:'동시에 보관된 별도 보완 원문'};
   h.sqlite.prepare('INSERT INTO collection_source_supplements VALUES(?,?,?,?,?,?)').run('job','owner',raw,JSON.stringify(supplement),JSON.stringify(supplement),new Date().toISOString());
   return {...saved,...await receipts.readCollectionResult('owner','job')};
  };
  const response=await h.route('/api/collection-jobs/job/'+endpoint,{method:'POST',body:endpoint==='collect'?{browserCapture:f.capture}:f.capture});
  assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).code,'SOURCE_SELECTION_CONFLICT');
  const original=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results WHERE job_id=?').get('job').payload);
  assert.equal(original.description,f.snapshot.description);assert.equal((await receipts.readCollectionResult('owner','job')).result.description,'동시에 보관된 별도 보완 원문');
  assert.equal(h.network.length,0);assert.equal(h.sqlite.prepare('SELECT count(*) n FROM products').get().n,0);
 }finally{h.close();}
});
