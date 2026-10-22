import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const image='https://cbu01.alicdn.com/synthetic-image-company-793.png';
const sourceUrl='https://detail.1688.com/offer/700000000793.html';
const snapshot=h=>JSON.stringify(['products','product_content','product_options','collection_images'].map(table=>h.sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
const context=h=>JSON.parse(h.sqlite.prepare("SELECT payload FROM collection_context WHERE job_id='job'").get().payload);
const setContext=(h,value)=>h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(value));
async function fixture(company=companies[0],configure){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,fixtureImageUrls:[image]});
 try{
  h.sqlite.prepare("UPDATE collection_jobs SET source_url=?,offer_id=?,goal='collect' WHERE id='job'").run(sourceUrl,'700000000793');
  await h.load('db/collection-results.ts').storeCollectionResult('owner','job',{
   schemaVersion:1,sourceUrl,offerId:'700000000793',provider:'synthetic-company-test',collectedAt:'2026-10-22T00:00:00.000Z',
   title:'Synthetic company image test',description:'',options:[{sku:'SYNTHETIC-793',name:'Synthetic option',unitPriceCny:1,minimumOrder:1,stock:null,imageIndex:0}],images:[{url:image,role:'main'}],
  });
  if(configure)configure(h);
  const product=await h.route('/api/collection-jobs/job/product',{method:'POST'});
  assert.equal(product.status,200,await product.clone().text());
  return h;
 }catch(error){h.close();throw error;}
}
const send=(h,batch=false)=>h.route('/api/collection-jobs/job/'+(batch?'images-batch':'images'),{method:'POST',body:batch?{indices:[0]}:{index:0,assignToStage:false}});
async function rejected(h,response,before,{downloads,objects}={}){
 assert.equal(response.status,409,await response.clone().text());
 assert.match((await response.json()).code,/^COLLECTION_COMPANY_(MISMATCH|INVALID)$/);
 assert.equal(snapshot(h),before,'no receipt, product, content or option attachment changes');
 if(downloads!==undefined)assert.equal(h.stats.downloads,downloads);
 if(objects!==undefined)assert.equal(h.objects.size,objects);
 assert.ok(!h.network.some(host=>host.includes('1688')||host.includes('coupang')),'no supplier query or Hub requests');
}

for(const [position,company]of companies.entries()){
 test(`${company.name}: matched captured company imports once and reuses without another download`,async()=>{
  const h=await fixture(company);try{
   const first=await send(h);assert.equal(first.status,200,await first.clone().text());
   const before=snapshot(h),retry=await send(h);assert.equal(retry.status,200,await retry.clone().text());assert.equal((await retry.json()).reused,true);
   assert.equal(snapshot(h),before);assert.equal(h.stats.downloads,1);assert.equal(h.objects.size,1);
  }finally{h.close();}
 });
 for(const batch of [false,true])test(`${company.name}: other company rejects ${batch?'batch':'single'} before any image download`,async()=>{
  const h=await fixture(company);try{const before=snapshot(h);h.setCompany(companies[1-position]);await rejected(h,await send(h,batch),before,{downloads:0,objects:0});}finally{h.close();}
 });
 for(const phase of ['download','storage'])test(`${company.name}: company change during ${phase} never attaches downloaded originals`,async()=>{
  const h=await fixture(company);try{
   const before=snapshot(h);
   if(phase==='download')h.stats.onDownloadFinished=()=>h.setCompany(companies[1-position]);
   else{const put=h.bindings.FILES.put;h.bindings.FILES.put=async(...args)=>{const result=await put(...args);h.setCompany(companies[1-position]);return result;};}
   await rejected(h,await send(h),before,{downloads:1,objects:phase==='download'?0:1});
  }finally{h.close();}
 });
}

test('batch prefetch completion cannot cross the captured company into a database commit',async()=>{
 const h=await fixture();try{const before=snapshot(h);h.stats.onDownloadFinished=()=>h.setCompany(companies[1]);await rejected(h,await send(h,true),before,{downloads:1,objects:0});}finally{h.close();}
});

test('reused object ACK rechecks company after storage HEAD and never returns a stale success',async()=>{
 const h=await fixture();try{
  assert.equal((await send(h)).status,200);const before=snapshot(h),head=h.bindings.FILES.head;
  h.bindings.FILES.head=async(...args)=>{const result=await head(...args);h.setCompany(companies[1]);return result;};
  await rejected(h,await send(h),before,{downloads:1,objects:1});
 }finally{h.close();}
});

test('legacy schema company remains authoritative; genuine unscoped legacy remains owner-only without backfill',async()=>{
 for(const scenario of ['schema','legacy']){
  const h=await fixture();
  try{
   const value=context(h);delete value.company;if(scenario==='schema')value.category.hubSchema={company:companies[0]};setContext(h,value);
   const raw=h.sqlite.prepare("SELECT payload FROM collection_context WHERE job_id='job'").get().payload;
   h.setCompany(companies[1]);
   if(scenario==='schema')await rejected(h,await send(h),snapshot(h),{downloads:0,objects:0});
   else{const response=await send(h);assert.equal(response.status,200,await response.clone().text());}
   assert.equal(h.sqlite.prepare("SELECT payload FROM collection_context WHERE job_id='job'").get().payload,raw,'no current-company backfill');
  }finally{h.close();}
 }
});

test('contradictory or invalid captured company data rejects before fetch',async()=>{
 for(const scenario of ['conflicting-schema','invalid-company']){
  const h=await fixture();try{
   const value=context(h);if(scenario==='conflicting-schema')value.category.hubSchema={company:companies[1]};else value.company={code:companies[0].code,name:companies[1].name};setContext(h,value);
   await rejected(h,await send(h),snapshot(h),{downloads:0,objects:0});
  }finally{h.close();}
 }
});

test('exact raw context fence rejects a same-company context change immediately before the SQL batch',async()=>{
 for(const legacy of [false,true]){
  const h=await fixture(companies[0],h=>{if(legacy){const value=context(h);delete value.company;setContext(h,value);}});try{
   const before=snapshot(h),batch=h.db.batch;let injected=false;
   h.db.batch=async statements=>{
    // The image object exists only after download+put, so this targets the write
    // boundary rather than any schema/bootstrap batch.
    if(!injected&&h.objects.size){injected=true;setContext(h,{...context(h),features:'same-company concurrent change'});}
    return batch(statements);
   };
   await rejected(h,await send(h),before,{downloads:1,objects:1});assert.equal(injected,true);
  }finally{h.close();}
 }
});

test('native membership suspension or company reassignment at SQL commit prevents all attachments',async()=>{
 for(const change of ['suspended','company']){
  const h=await fixture();try{
   h.bindings.YOOFAM_AUTH_ENABLED='true';
   h.sqlite.prepare("INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run('owner','jwhj1116@kakao.com','synthetic','admin','approved',companies[0].code,companies[0].name,'now','now');
   const before=snapshot(h),batch=h.db.batch;let injected=false;
   h.db.batch=async statements=>{if(!injected&&h.objects.size){injected=true;if(change==='suspended')h.sqlite.exec("UPDATE members SET status='suspended' WHERE id='owner'");else h.sqlite.prepare("UPDATE members SET company_code=?,company_name=? WHERE id='owner'").run(companies[1].code,companies[1].name);}return batch(statements);};
   await rejected(h,await send(h),before,{downloads:1,objects:1});assert.equal(injected,true);
  }finally{h.close();}
 }
});

test('scope mutation by a companion SQL trigger rolls back the image anchor and manual draft references',async()=>{
 const h=await fixture();try{
  const before=snapshot(h),raw=context(h);
  const changed=JSON.stringify({...raw,features:'changed inside transaction'}).replaceAll("'","''");
  h.sqlite.exec(`CREATE TRIGGER change_image_context AFTER INSERT ON collection_images BEGIN UPDATE collection_context SET payload='${changed}' WHERE job_id='job'; END;`);
  const response=await send(h);assert.equal(response.status,503,await response.clone().text());
  assert.equal(snapshot(h),before);assert.deepEqual(context(h),raw,'trigger mutation rolled back with the transaction');assert.equal(h.stats.downloads,1);
 }finally{h.close();}
});
