import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {singlePacket,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';
import {singleDocumentIdentity} from '../extensions/supplier-hub/single-document.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
export async function singleReceiptStorageFixture(company=SINGLE_COMPANIES[0]){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(`
    CREATE TABLE products(id TEXT PRIMARY KEY,owner_id TEXT,updated_at TEXT,image_keys TEXT);
    CREATE TABLE product_removals(product_id TEXT,owner_id TEXT);
    CREATE TABLE product_price_policy(product_id TEXT,payload TEXT);
    CREATE TABLE product_content(product_id TEXT,owner_id TEXT,revision INTEGER);
    CREATE TABLE product_options(product_id TEXT,owner_id TEXT,revision INTEGER);
    CREATE TABLE workspace_settings(owner_id TEXT,payload TEXT);
    CREATE TABLE category_profiles(id TEXT,owner_id TEXT,revision INTEGER);
    CREATE TABLE product_quotation_fields(product_id TEXT,owner_id TEXT,revision INTEGER);
    CREATE TABLE members(id TEXT PRIMARY KEY,email TEXT,role TEXT,status TEXT,company_code TEXT,company_name TEXT);`);
  const calls=[],controls={beforeFirst:null},env={YOOFAM_AUTH_ENABLED:'true'},cache=new Map();
  const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},async run(){calls.push({sql,args});return sqlite.prepare(sql).run(...args);},async first(){calls.push({sql,args});controls.beforeFirst?.(sql,args);return sqlite.prepare(sql).get(...args)??null;},async all(){calls.push({sql,args});return {results:sqlite.prepare(sql).all(...args)};}};return q;}};env.DB=db;
  const qSource=fs.readFileSync('db/quotation-fields.ts','utf8'),qAst=ts.createSourceFile('quotation-fields.ts',qSource,ts.ScriptTarget.Latest,true),guardNode=qAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name.text==='sourceGuard');
  function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
    const source=file==='actual-source-guard'?guardNode.getText(qAst):fs.readFileSync(file,'utf8');
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
      {exports,Error,URL,Date,TextEncoder,Uint8Array,structuredClone,crypto:webcrypto,JSON,Object,Array,Reflect,Number,Set,
        require(name){if(name==='cloudflare:workers')return {env};if(name==='@/db/quotation-fields')return load('actual-source-guard');if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error('Unexpected dependency '+name);}});return exports;
  }
  const model=load('app/supplier-hub-single-receipt.ts'),storage=load('db/supplier-hub-single-receipts.ts'),packet=singlePacket(company);
  packet.accountContext=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['sourceflow-managed-product-account-v1',packet.ownerId,company.code,company.name])))).toString('hex');
  const context=await singleDocumentIdentity(packet,SINGLE_SENDER),owner=packet.ownerId,id=packet.productId,role=company.code==='A01526306'?'admin':'member',email=role==='admin'?'jwhj1116@kakao.com':'unari8484@gmail.com';
  const member={id:owner,email,role,companyCode:company.code,companyName:company.name},source={productVersion:packet.source.productVersion,imageKeys:'[]',pricingPolicy:null,contentRevision:3,optionRevision:4,settingsPayload:null,profile:{id:packet.profileId,revision:2},collection:null};
  sqlite.prepare('INSERT INTO products VALUES(?,?,?,?)').run(id,owner,source.productVersion,'[]');
  sqlite.prepare('INSERT INTO product_content VALUES(?,?,?)').run(id,owner,3);sqlite.prepare('INSERT INTO product_options VALUES(?,?,?)').run(id,owner,4);
  sqlite.prepare('INSERT INTO category_profiles VALUES(?,?,?)').run(packet.profileId,owner,2);sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?)').run(id,owner,5);
  sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?)').run(owner,email,role,'approved',company.code,company.name);
  const observedAt=Date.now()-1000,observation={format:packet.format,requestId:packet.requestId,identity:context.identity,identityDigest:context.identityDigest,packetDigest:context.packetDigest,
    preparedBodySha256:context.bodySha256,originalBodySha256:context.originalBodySha256,state:'pending',docId:701,registered:false,success:false,needsRecovery:false,
    receipt:{state:'pending',docId:701,company,identityDigest:context.identityDigest,preparedBodySha256:context.bodySha256,observedAt,receiptId:9001,qvtRequestId:9001,sourceStatus:'SUBMITTED',evidence:'document-receipt',registered:false}};
  const record=plain(await model.validateSingleReceiptObservation(observation,packet,new URL(SINGLE_SENDER.url).origin));
  const save=(value=record,auth=member)=>storage.saveSingleReceipt(owner,id,value,source,5,auth);
  const retained=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','category_profiles','workspace_settings','product_price_policy','product_removals'].map(table=>sqlite.prepare('SELECT * FROM '+table).all()));
  return {sqlite,calls,controls,env,load,model,storage,packet,context,owner,id,member,source,observation,record,save,retained,close:()=>sqlite.close()};
}
const changeReceipt=(record,status,time=record.receipt.observedAt+10)=>({...plain(record),receipt:{...plain(record.receipt),state:{SUBMITTED:'pending',FINISHED:'accepted',REJECTED:'rejected'}[status],sourceStatus:status,observedAt:time}});

for(const company of SINGLE_COMPANIES)test(company.name+' validates current packet proof and atomically stores native receipt without product changes',async()=>{
  const f=await singleReceiptStorageFixture(company);try{const before=f.retained(),saved=await f.save();assert.ok(saved);assert.equal(saved.format,'yoofam-single-receipt-v1');assert.equal(saved.registered,false);assert.equal(saved.receipt.qvtRequestId,9001);
    assert.ok(Number.isFinite(Date.parse(saved.recordedAt)));assert.equal(Object.hasOwn(saved.receipt,'skuId'),false);assert.equal(f.retained(),before);
    const row=f.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get(),duplicated=await f.save();assert.deepEqual(plain(duplicated),plain(saved));assert.deepEqual(f.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get(),row);
    assert.deepEqual(plain(await f.storage.readSingleReceiptHistory(f.owner,f.id)),[plain(saved)]);assert.deepEqual(plain(await f.storage.readSingleReceiptHistory('foreign',f.id)),[]);
    const summary=(await f.storage.readSingleReceiptSummaries(f.owner,[{id:f.id}]))[f.id];assert.equal(summary.state,'pending');assert.equal(summary.optionCount,1);assert.equal(f.model.isSingleReceiptSummary(summary),true);
  }finally{f.close();}
});

test('strict observation proof rejects wrong format/owner/origin/body/source/request/native alias or SKU without saving',async()=>{
  const f=await singleReceiptStorageFixture();try{const before=f.retained();
    const changes=[o=>{o.format='foreign';},o=>{o.identity.ownerId='foreign';},o=>{o.identity.origin='https://foreign.test';},o=>{o.identity.source.contentRevision++;},o=>{o.requestId='other';},
      o=>{o.packetDigest='d'.repeat(64);},o=>{o.preparedBodySha256='d'.repeat(64);},o=>{o.originalBodySha256='d'.repeat(64);},o=>{o.identityDigest='d'.repeat(64);},o=>{o.registered=true;},o=>{o.success=true;},o=>{o.needsRecovery=true;},
      o=>{o.receipt.skuId=123;},o=>{o.receipt.evidence='document-and-sku';},o=>{o.receipt.qvtRequestId='9001';},o=>{o.receipt.sourceStatus='FINISHED';},o=>{o.receipt.docId='701';},o=>{o.receipt.company=SINGLE_COMPANIES[1];},
      o=>{o.receipt.observedAt=Date.now()+10000;},o=>{o.password='never retained';},o=>{o.error={code:'FAILED',message:'uncertain'};},o=>{o.challenge={};}];
    for(const mutate of changes){const o=plain(f.observation);mutate(o);await assert.rejects(f.model.validateSingleReceiptObservation(o,f.packet,new URL(SINGLE_SENDER.url).origin));}
    assert.equal(f.retained(),before);assert.equal(f.calls.some(call=>call.sql.startsWith('INSERT INTO supplier_hub_single_receipts')),false);
  }finally{f.close();}
});

test('approved member identity remains inside INSERT and fallback SELECT, source/revision changes remain atomic',async()=>{
  const f=await singleReceiptStorageFixture();try{
    for(const column of ['status','email','role','company_code','company_name']){
      f.controls.beforeFirst=sql=>{if(!sql.startsWith('INSERT INTO supplier_hub_single_receipts'))return;f.controls.beforeFirst=null;f.sqlite.prepare('UPDATE members SET '+column+'=? WHERE id=?').run(column==='status'?'suspended':'foreign',f.owner);};
      assert.equal(await f.save(),null);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_single_receipts').get().n,0);
      f.sqlite.prepare("UPDATE members SET email=?,role=?,status='approved',company_code=?,company_name=? WHERE id=?").run(f.member.email,f.member.role,f.member.companyCode,f.member.companyName,f.owner);
    }
    for(const mutation of [()=>f.sqlite.prepare('UPDATE product_content SET revision=4').run(),()=>f.sqlite.prepare('UPDATE product_options SET revision=5').run(),
      ()=>f.sqlite.prepare('UPDATE product_quotation_fields SET revision=6').run(),()=>f.sqlite.prepare('UPDATE category_profiles SET revision=3').run(),()=>f.sqlite.prepare("UPDATE products SET image_keys='[1]'").run()]){
      f.controls.beforeFirst=sql=>{if(!sql.startsWith('INSERT INTO supplier_hub_single_receipts'))return;f.controls.beforeFirst=null;mutation();};assert.equal(await f.save(),null);
      f.sqlite.prepare('UPDATE product_content SET revision=3').run();f.sqlite.prepare('UPDATE product_options SET revision=4').run();f.sqlite.prepare('UPDATE product_quotation_fields SET revision=5').run();f.sqlite.prepare('UPDATE category_profiles SET revision=2').run();f.sqlite.prepare("UPDATE products SET image_keys='[]'").run();
    }
    await f.save();f.controls.beforeFirst=sql=>{if(!sql.includes('JOIN supplier_hub_single_receipts r'))return;f.controls.beforeFirst=null;f.sqlite.prepare("UPDATE members SET status='suspended'").run();};assert.equal(await f.save(),null);
  }finally{f.close();}
});

test('direct saves require exact approved native member, source and quotation revision',async()=>{
  const f=await singleReceiptStorageFixture();try{
    for(const member of [null,{}, {...f.member,id:'other'},{...f.member,email:'other@example.test'},{...f.member,companyCode:'foreign'}])assert.equal(await f.storage.saveSingleReceipt(f.owner,f.id,f.record,f.source,5,member),null);
    assert.equal(await f.storage.saveSingleReceipt('foreign',f.id,f.record,f.source,5,f.member),null);
    assert.equal(await f.storage.saveSingleReceipt(f.owner,f.id,f.record,{...f.source,contentRevision:99},5,f.member),null);
    assert.equal(await f.storage.saveSingleReceipt(f.owner,f.id,f.record,f.source,6,f.member),null);
    await assert.rejects(f.save({...f.record,recordedAt:new Date().toISOString()}));assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_single_receipts').get().n,0);
  }finally{f.close();}
});

test('pending to accepted refresh pins raw IDs/type/package/identity forever, older idempotent reads preserve row bytes',async()=>{
  const f=await singleReceiptStorageFixture();try{
    const first=await f.save(),accepted=await f.save(changeReceipt(f.record,'FINISHED'));assert.equal(accepted.receipt.state,'accepted');const row=f.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get();
    assert.deepEqual(plain(await f.save()),plain(accepted));assert.deepEqual(f.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get(),row);
    assert.equal(await f.save(changeReceipt(f.record,'SUBMITTED',accepted.receipt.observedAt+10)),null);
    for(const mutate of [r=>{r.receipt.qvtRequestId=r.receipt.receiptId='9001';},r=>{r.docId=r.receipt.docId='701';},r=>{r.optionId=r.identity.optionId='another-option';},
      r=>{r.packetDigest='d'.repeat(64);},r=>{r.originalBodySha256='d'.repeat(64);},r=>{r.preparedBodySha256=r.receipt.preparedBodySha256='d'.repeat(64);},r=>{r.identityDigest=r.receipt.identityDigest='d'.repeat(64);}]){
      const r=changeReceipt(f.record,'FINISHED',accepted.receipt.observedAt+20);mutate(r);assert.equal(await f.save(r),null);
    }
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_single_receipts').get().n,1);assert.ok(first.recordedAt);assert.deepEqual(f.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get(),row);
  }finally{f.close();}
});

test('rejected receipt cannot resurrect, and another request cannot steal its document or registration-file ID',async()=>{
  const f=await singleReceiptStorageFixture();try{
    const rejected=await f.save(changeReceipt(f.record,'REJECTED'));
    for(const status of ['SUBMITTED','FINISHED'])assert.equal(await f.save(changeReceipt(f.record,status,rejected.receipt.observedAt+10)),null);
    for(const patch of [{requestId:'another-request'},{requestId:'another-request',docId:702,receipt:{...f.record.receipt,docId:702}}])assert.equal(await f.save({...f.record,...patch}),null);
  }finally{f.close();}
});

test('one owner cannot reuse the same request across another product, even with different native IDs',async()=>{
  const f=await singleReceiptStorageFixture();try{
    await f.save();const otherId='another-product';f.sqlite.prepare('INSERT INTO products VALUES(?,?,?,?)').run(otherId,f.owner,f.source.productVersion,'[]');
    f.sqlite.prepare('INSERT INTO product_content VALUES(?,?,?)').run(otherId,f.owner,3);f.sqlite.prepare('INSERT INTO product_options VALUES(?,?,?)').run(otherId,f.owner,4);f.sqlite.prepare('INSERT INTO product_quotation_fields VALUES(?,?,?)').run(otherId,f.owner,5);
    const other={...plain(f.record),productId:otherId,identity:{...plain(f.record.identity),productId:otherId}};
    assert.equal(await f.storage.saveSingleReceipt(f.owner,otherId,other,f.source,5,f.member),null);
    other.docId=other.receipt.docId=702;other.receipt.receiptId=other.receipt.qvtRequestId=9002;
    assert.equal(await f.storage.saveSingleReceipt(f.owner,otherId,other,f.source,5,f.member),null);
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM supplier_hub_single_receipts').get().n,1);
  }finally{f.close();}
});

test('latest insertion keeps old refreshed request behind new option; counts never merge different fingerprints',async()=>{
  const f=await singleReceiptStorageFixture();try{
    await f.save();const next={...plain(f.record),requestId:'request-two',optionId:'option-two',identity:{...plain(f.record.identity),optionId:'option-two'},docId:702,receipt:{...plain(f.record.receipt),docId:702,receiptId:9002,qvtRequestId:9002}};
    await f.save(next);await f.save(changeReceipt(f.record,'FINISHED',f.record.receipt.observedAt+20));
    let summary=(await f.storage.readSingleReceiptSummaries(f.owner,[{id:f.id}]))[f.id];assert.equal(summary.optionId,'option-two');assert.equal(summary.optionCount,2);assert.equal(summary.docId,702);
    const third={...plain(next),requestId:'request-three',fingerprint:'d'.repeat(64),identity:{...plain(next.identity),fingerprint:'d'.repeat(64)},docId:703,receipt:{...plain(next.receipt),docId:703,receiptId:9003,qvtRequestId:9003}};
    await f.save(third);summary=(await f.storage.readSingleReceiptSummaries(f.owner,[{id:f.id}]))[f.id];assert.equal(summary.optionCount,1);assert.equal(summary.fingerprint,'d'.repeat(64));
    assert.deepEqual(plain(await f.storage.readSingleReceiptSummaries('foreign',[{id:f.id}])),{});
    const before=f.calls.length;await f.storage.readSingleReceiptSummaries(f.owner,[{id:f.id},{id:'missing'}]);
    assert.equal(f.calls.slice(before).filter(call=>call.sql.startsWith('CREATE TABLE')).length,1);
  }finally{f.close();}
});

test('stored row/record metadata corruption, unknown state, unknown fields or history overflow fail closed',async()=>{
  const f=await singleReceiptStorageFixture();try{
    const saved=await f.save(),row=f.sqlite.prepare('SELECT * FROM supplier_hub_single_receipts').get();
    for(const mutate of [r=>{r.productId='foreign';},r=>{r.identity.ownerId='foreign';},r=>{r.requestId='foreign';},r=>{r.receipt.observedAt++;},r=>{r.receipt.skuId=1;},r=>{r.receipt.sourceStatus='UNKNOWN';},r=>{r.recordedAt='2999-01-01T00:00:00.000Z';}]){
      const bad=plain(saved);mutate(bad);f.sqlite.prepare('UPDATE supplier_hub_single_receipts SET payload=?').run(JSON.stringify(bad));
      await assert.rejects(f.storage.readSingleReceiptHistory(f.owner,f.id));assert.equal((await f.storage.readSingleReceiptSummaries(f.owner,[{id:f.id}]))[f.id],null);
    }
    f.sqlite.prepare('UPDATE supplier_hub_single_receipts SET payload=?').run(row.payload);
    for(let i=0;i<200;i++)f.sqlite.prepare('INSERT INTO supplier_hub_single_receipts VALUES(?,?,?,?,?,?)').run(f.owner,f.id,'overflow-'+i,row.observed_at,row.payload,row.created_at);
    await assert.rejects(f.storage.readSingleReceiptHistory(f.owner,f.id));assert.equal((await f.storage.readSingleReceiptSummaries(f.owner,[{id:f.id}]))[f.id],null);
  }finally{f.close();}
});
