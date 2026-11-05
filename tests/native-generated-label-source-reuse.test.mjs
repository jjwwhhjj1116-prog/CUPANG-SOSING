import test from 'node:test';
import assert from 'node:assert/strict';
import {assetApiFixture,companies} from './helpers/supplier-hub-single-assets.mjs';
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function fixture(collection=false){
 const f=await assetApiFixture();try{
  if(collection){const job=f.h.sqlite.prepare("SELECT source_url FROM collection_jobs WHERE id='job'").get();f.h.context.category=f.profile;f.h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(f.h.context));f.h.sqlite.prepare('UPDATE products SET source_url=? WHERE id=?').run(job.source_url,f.id);f.h.sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run('job','owner',f.id,new Date().toISOString());f.query='';}
  const get=f.h.bindings.FILES.get;f.h.bindings.FILES.get=async(key,options)=>{const object=await get(key,options),bytes=f.h.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.length:offset+options.range.length;return{...object,body:new Response(bytes.slice(offset,end)).body};};
  const endpoint=f.base+'/product-labels'+f.query,quotationEndpoint=f.base+'/quotation-fields'+f.query,view=await json(await f.h.route(endpoint));
  const request=async(url,init={})=>url==='/api/files'?f.h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):f.h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});
  const optionId=view.rows.find(row=>row.optionId!==null).optionId,attached=await f.h.load('app/product-label-attachment.ts').attachProductLabel({productId:f.id,endpoint,quotationEndpoint,renderedView:view,optionId,blob:new Blob([f.h.objects.get(f.keys[0])],{type:'image/png'}),uploadedKey:null,onUploaded(){}},request);
  assert.equal((await f.h.bindings.FILES.head(attached.key)).customMetadata.productLabelRecipe,'product-label-png-v1');
  const api=f.h.load('app/api/products/[id]/native-assets/route.ts'),context={params:Promise.resolve({id:f.id})},send=()=>api.GET(new Request('https://app.test'+f.base+'/native-assets'+f.query),context);
  return{...f,send};
 }catch(error){f.close();throw error;}
}
for(const collection of [false,true])test(`actual ${collection?'queryless collection':'explicit profile'} generated-label plan preserves the exact legacy plan with fewer D1 reads`,async t=>{
 const f=await fixture(collection);try{
  const source=f.h.load('app/exports/quotation-source.ts'),original=source.readQuotationExportSource,db=f.h.bindings.DB,prepare=db.prepare.bind(db);await json(await f.send());let queries=[];db.prepare=sql=>{queries.push(sql);return prepare(sql);};
  source.readQuotationExportSource=(owner,id,profile)=>original(owner,id,profile);const legacy=await json(await f.send()),baseline=queries.filter(sql=>sql.startsWith('SELECT p.*')).length,totalBefore=queries.length;
  queries=[];source.readQuotationExportSource=original;const current=await json(await f.send()),reads=queries.filter(sql=>sql.startsWith('SELECT p.*')).length;
  assert.deepEqual(current,legacy);assert.equal(baseline,7);assert.equal(reads,collection?5:4,'fresh export sources and profile-specific quotation reads stay within their own phases');assert.equal(queries.filter(sql=>sql.startsWith('SELECT revision,payload,updated_at FROM product_labels')).length,2,'labels stay fresh at both phases');assert.deepEqual(f.h.network,[]);
  assert.ok(queries.length<totalBefore);t.diagnostic(JSON.stringify({totalSqlBefore:totalBefore,totalSqlAfter:queries.length,productReadsBefore:baseline,productReadsAfter:reads}));
 }finally{f.close();}
});
for(const kind of ['settings','content','label','profile','company','membership'])test(`generated-label source reuse rejects a ${kind} race before releasing a plan`,async()=>{
 const f=await fixture();try{
  const source=f.h.load('app/exports/quotation-source.ts'),original=source.readQuotationExportSource;let calls=0;
  source.readQuotationExportSource=async(...args)=>{if(++calls===2){
   if(kind==='settings')f.h.sqlite.prepare("UPDATE workspace_settings SET payload=json_set(payload,'$.brand','changed brand') WHERE owner_id='owner'").run();
   if(kind==='content')f.h.sqlite.prepare("UPDATE product_content SET revision=revision+1,payload=json_set(payload,'$.revision',revision+1) WHERE product_id=?").run(f.id);
   if(kind==='label')f.h.sqlite.prepare("UPDATE product_labels SET revision=revision+1,payload=json_set(payload,'$.revision',revision+1,'$.overrides.common.productName','changed label') WHERE product_id=?").run(f.id);
   if(kind==='profile')f.h.sqlite.prepare('UPDATE category_profiles SET revision=revision+1 WHERE id=?').run(f.profile.id);
   if(kind==='company')f.h.setCompany(companies[1]);
   if(kind==='membership')f.h.setMembershipStatus('suspended');
  }return original(...args);};
  const response=await f.send();assert.equal(calls,2);assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).images,undefined);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
