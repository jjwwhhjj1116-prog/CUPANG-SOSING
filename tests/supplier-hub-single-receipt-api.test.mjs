import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {assetApiFixture,companies,plain} from './helpers/supplier-hub-single-assets.mjs';
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))).toString('hex');
async function fixture(company=companies[0]){
  const f=await assetApiFixture(company),view=await json(await f.h.route(f.endpoint)),prepared=await json(await f.prepare(view.fingerprint));
  const now=new Date().toISOString(),email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',role=company.code==='A01526306'?'admin':'member';
  f.h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',email,'synthetic-never-a-password',role,'approved',company.code,company.name,now,now);
  const endpoint=f.base+'/supplier-hub-single-receipt',packet=plain(await f.h.load('app/supplier-hub-single-client.ts').singlePackagePacket(prepared,'owner','synthetic-one'));
  const logical={origin:'https://app.test',...Object.fromEntries(['ownerId','accountContext','company','productId','profileId','optionId','categoryId','fingerprint','schemaSha256','source'].map(key=>[key,packet[key]]))};
  const identity={...logical,appTabId:71,windowId:5},identityDigest=await digest(identity),originalBodySha256=await digest(packet.body),deferred=structuredClone(packet.body);
  for(const key of ['msrpAgree','labelContactAgreed'])if(Object.hasOwn(deferred.jsonDocument[0].imagePage,key))deferred.jsonDocument[0].imagePage[key]=false;
  const preparedBodySha256=await digest(deferred),packetDigest=await digest({identity:logical,bodySha256:preparedBodySha256,originalBodySha256});
  const observation={format:packet.format,requestId:packet.requestId,identity,identityDigest,packetDigest,originalBodySha256,preparedBodySha256,state:'pending',docId:901,registered:false,success:false,needsRecovery:false,
    receipt:{state:'pending',docId:901,company,identityDigest,preparedBodySha256,observedAt:Date.now(),evidence:'document-receipt',receiptId:7901,qvtRequestId:7901,sourceStatus:'SUBMITTED',registered:false}};
  const post=(value=observation)=>f.h.route(endpoint,{method:'POST',body:{profileId:f.profile.id,optionId:'synthetic-one',observation:value}});
  return {...f,endpoint,packet,observation,post,prepared};
}
for(const company of companies)test('current prepared native observation persists and reloads without modifying source ('+company.code+')',async()=>{
  const f=await fixture(company);try{
    const before=f.state(),objects=f.objectState(),first=await json(await f.post());
    assert.equal(first.receipt.format,'yoofam-single-receipt-v1');assert.equal(first.receipt.registered,false);assert.equal(first.receipt.receipt.sourceStatus,'SUBMITTED');
    let history=await json(await f.h.route(f.endpoint+f.query));assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].docId,901);
    assert.equal(history.receipts[0].receipt.qvtRequestId,7901);assert.equal(typeof history.receipts[0].receipt.qvtRequestId,'number');assert.equal(f.state(),before);assert.equal(f.objectState(),objects);assert.deepEqual(f.h.network,[]);
    const accepted=structuredClone(f.observation);accepted.state=accepted.receipt.state='accepted';accepted.receipt.sourceStatus='FINISHED';accepted.receipt.observedAt+=1;
    await json(await f.post(accepted));await json(await f.post(accepted));history=await json(await f.h.route(f.endpoint));assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].receipt.state,'accepted');assert.equal(history.receipts[0].registered,false);
    const detail=await json(await f.h.load('app/api/products/[id]/route.ts').GET(new Request('https://app.test'+f.base),{params:Promise.resolve({id:f.id})}));
    assert.equal(detail.product.hub_single_receipt.docId,901);assert.equal(detail.product.hub_single_receipt.qvtRequestId,7901);assert.equal(detail.product.hub_single_receipt.optionCount,1);assert.equal(detail.product.hub_single_receipt.registered,false);assert.equal(detail.product.removal_policy.blocked,true);
    const listing=await json(await f.h.load('app/api/products/route.ts').GET(new Request('https://app.test/api/products')));
    assert.equal(listing.products.find(row=>row.id===f.id).hub_single_receipt.state,'accepted');assert.equal(f.state(),before);
    const previous=structuredClone(f.observation);previous.receipt.observedAt=accepted.receipt.observedAt+1;await json(await f.post(previous),409);
    const changed=structuredClone(accepted);changed.receipt.qvtRequestId=changed.receipt.receiptId='7901';changed.receipt.observedAt+=1;await json(await f.post(changed),409);
    assert.equal((await json(await f.h.route(f.endpoint))).receipts[0].receipt.qvtRequestId,7901);assert.equal(f.state(),before);assert.equal(f.objectState(),objects);
  }finally{f.close();}
});
test('foreign source/body/company/option or unobserved SKU never produces a saved receipt',async()=>{
  const f=await fixture();try{
    for(const mutate of [v=>v.identity.company=companies[1],v=>v.identity.optionId='synthetic-two',v=>v.packetDigest='a'.repeat(64),v=>v.receipt.skuId=88,v=>v.registered=true,v=>v.receipt.sourceStatus='UNKNOWN',v=>v.receipt.observedAt=Date.now()+120000]){
      const value=structuredClone(f.observation);mutate(value);await json(await f.post(value),409);
    }
    assert.equal((await json(await f.h.route(f.endpoint))).receipts.length,0);assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
});
test('source edit, member change and cross-site POST block persistence; old history remains readable after edit',async()=>{
  const f=await fixture();try{
    await json(await f.post());const route=f.h.load('app/api/products/[id]/supplier-hub-single-receipt/route.ts'),ctx={params:Promise.resolve({id:f.id})};
    const cross=new Request('https://app.test'+f.endpoint,{method:'POST',headers:{origin:'https://foreign.test','content-type':'application/json'},body:JSON.stringify({profileId:f.profile.id,optionId:'synthetic-one',observation:f.observation})});await json(await route.POST(cross,ctx),403);
    f.h.sqlite.prepare('UPDATE members SET status=? WHERE id=?').run('suspended','owner');await json(await f.post(),409);f.h.sqlite.prepare('UPDATE members SET status=? WHERE id=?').run('approved','owner');
    f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2099-01-01T00:00:00.000Z',f.id);await json(await f.post(),409);
    const history=await json(await f.h.route(f.endpoint));assert.equal(history.receipts.length,1);assert.equal(history.receipts[0].source.productVersion,f.observation.identity.source.productVersion);
    f.h.setCompany(companies[1]);await json(await f.h.route(f.endpoint),409);assert.deepEqual(f.h.network,[]);
  }finally{f.close();}
});
test('strict methods/query/body bounds reject unrelated or duplicate identity',async()=>{
  const f=await fixture();try{
    const route=f.h.load('app/api/products/[id]/supplier-hub-single-receipt/route.ts'),ctx={params:Promise.resolve({id:f.id})};
    assert.equal((await route.GET(new Request('https://app.test'+f.endpoint,{method:'POST'}),ctx)).status,405);
    for(const query of ['?profileId=', '?profileId=x&profileId=y', '?submit=true'])await json(await f.h.route(f.endpoint+query),400);
    for(const body of [{}, {profileId:f.profile.id,optionId:'synthetic-one',observation:f.observation,submit:true}])await json(await f.h.route(f.endpoint,{method:'POST',body}),400);
    await json(await f.h.route(f.endpoint,{method:'POST',body:' '.repeat(131073)}),413);
    f.h.sqlite.prepare('UPDATE products SET owner_id=? WHERE id=?').run('other-owner',f.id);await json(await f.h.route(f.endpoint),404);
  }finally{f.close();}
});
