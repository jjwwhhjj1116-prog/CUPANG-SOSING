import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const stored=h=>JSON.stringify({profiles:h.sqlite.prepare('SELECT * FROM category_profiles ORDER BY id').all(),jobs:h.sqlite.prepare('SELECT * FROM collection_jobs').all(),context:h.sqlite.prepare('SELECT * FROM collection_context').all(),objects:[...h.objects].map(([key,bytes])=>[key,Array.from(bytes)])});
async function setup(company){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const api=h.load('app/api/category-profiles/route.ts'),snapshot={...hubSchemaSnapshot(company),metadata:{displayCategoryCode:'991234',kanCategoryId:3000,scopeType:'Retail_Categorized_Single',version:190}};
  const input={name:'현재 회사 보존 설정',categoryId:'991234',categoryPath:schemaPath,hubSchema:snapshot,template:null,mappings:[]};
  const profile=(await json(await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})),201)).profile;
  const raw=JSON.parse(snapshot.schemaString);raw.properties.productPage.properties.basicAttributes.properties.modelNumber.maxLength=12;
  const target={...snapshot,schemaString:JSON.stringify(raw),metadata:{...snapshot.metadata,version:191}},fork=h.load('app/api/category-profiles/[id]/refresh-definition/route.ts');
  const call=(operation,proof)=>{
   const headers={'content-type':'application/json',...(proof===undefined?{}:{'X-YOOFAM-Workspace-Owner':proof})};
   if(operation==='POST')return api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers,body:JSON.stringify({name:'수동 분류',categoryId:'80719',categoryPath:['주방용품','주방수납/정리','주방수납바구니/바스켓'],template:null,mappings:[]})}));
   if(operation==='PUT')return api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers,body:JSON.stringify({id:profile.id,expectedRevision:profile.revision,profile:{...profile,name:'직접 검토한 새 설정명'}})}));
   headers['Idempotency-Key']=randomUUID();return fork.POST(new Request(`https://app.test/api/category-profiles/${profile.id}/refresh-definition`,{method:'POST',headers,body:JSON.stringify({expectedRevision:profile.revision,hubSchema:target})}),{params:Promise.resolve({id:profile.id})});
  };
  return{h,call,profile};
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies)for(const operation of ['POST','PUT','fork'])test(`category ${operation} rejects another workspace proof before writes and accepts the current owner (${company.code})`,async()=>{
 const f=await setup(company);try{
  const before=stored(f.h);await json(await f.call(operation,'previous-owner'),409);assert.equal(stored(f.h),before,'wrong-owner proof must not create, update or fork category bytes');
  const result=await json(await f.call(operation,'owner'),operation==='PUT'?200:201);assert.ok(result.profile);assert.equal(result.profile.categoryId,operation==='POST'?'80719':f.profile.categoryId);
  if(operation==='fork')assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM category_profiles WHERE id=?').get(f.profile.id).revision,f.profile.revision);
 }finally{f.h.close();}
});

for(const company of schemaCompanies)test(`malformed category owner proofs reject all mutations while legacy manual requests remain usable (${company.code})`,async()=>{
 const f=await setup(company);try{
  const before=stored(f.h);for(const operation of ['POST','PUT','fork'])for(const proof of ['', 'x'.repeat(201), 'owner\tother']){await json(await f.call(operation,proof),400);assert.equal(stored(f.h),before);}
  await json(await f.call('POST'),201);await json(await f.call('fork'),201);await json(await f.call('PUT'),200);
 }finally{f.h.close();}
});
