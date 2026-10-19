import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function fixture(company=companies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});h.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();await h.intake();
 const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),id=product().id,base='/api/products/'+id;
 const request=(url,init)=>url==='/api/supplier-hub/catalog-context'?h.load('app/api/supplier-hub/catalog-context/route.ts').GET():h.route(url,{method:init?.method??'GET',body:init?.body});
 const api=h.load('app/batch-seo-work.ts'),products=[{id,title:'합성 SEO 검토',updated_at:product().updated_at}];
 return{h,api,products,id,base,product,request,view:()=>request(base+'/seo-workspace').then(json),state:()=>JSON.stringify(['products','product_content','product_options','collection_results','collection_context','workspace_settings'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()))};
}
for(const company of companies)test(`SEO inventory queues incomplete saved source and preserves reviewed manual blanks (${company.code})`,async()=>{
 const f=await fixture(company);try{
  const calls=[],request=(url,init)=>{calls.push({url,init});return f.request(url,init);},before=f.state(),signal=new AbortController().signal;
  let plan=await f.api.planBatchSeoWork(f.products,signal,request);assert.equal(plan.ownerId,'owner');assert.deepEqual(JSON.parse(JSON.stringify(plan.company)),company);assert.equal(plan.tasks.length,1);assert.ok(plan.tasks[0].missingFields.includes('상품명'));assert.equal(f.state(),before);assert.ok(calls.every(call=>!call.init?.method||call.init.method==='GET'));assert.ok(calls.every(call=>call.init.signal===signal));
  const fresh=await f.api.refreshBatchSeoWorkTask(plan.tasks[0],plan,signal,request);assert.equal(fresh.productVersion,plan.tasks[0].productVersion);
  const view=await f.view();await json(await f.h.route(f.base+'/seo-workspace',{method:'PATCH',body:{expectedProductVersion:view.productVersion,expectedContentRevision:view.content.revision,expectedOptionRevision:view.options.revision,seo:{title:'',keywords:[],description:''}}}));
  const manual=await f.view(),stable=f.state();plan=await f.api.planBatchSeoWork(f.products,signal,request);assert.equal(plan.tasks.length,0);assert.equal(plan.messages.length,1);assert.equal(manual.content.seo.title.value,'');assert.equal(manual.content.seo.title.provenance,'manual');assert.deepEqual(manual.content.seo.keywords.value,[]);assert.equal(f.state(),stable);assert.equal(f.h.aiSources.length,0);
 }finally{f.h.close();}
});
test('reviewed generated SEO is skipped; task refresh rejects foreign company, changed source and clocks',async()=>{
 const f=await fixture();try{
  const signal=new AbortController().signal,plan=await f.api.planBatchSeoWork(f.products,signal,f.request),task=plan.tasks[0];
  const content=await f.h.load('db/product-content.ts').readProductContent('owner',f.id);for(const[key,value]of Object.entries({title:'검토한 한국어 제목',keywords:['검토 태그'],description:'검토한 설명'}))content.seo[key]={value,provenance:'generated',updatedAt:new Date().toISOString()};
  assert.ok(await f.h.load('db/product-content.ts').saveProductContent('owner',{...content,revision:content.revision+1},content.revision));
  await assert.rejects(f.api.refreshBatchSeoWorkTask(task,plan,signal,f.request));const complete=await f.api.planBatchSeoWork(f.products,signal,f.request);assert.equal(complete.tasks.length,0);
  f.h.setCompany(companies[1]);await assert.rejects(f.api.planBatchSeoWork(f.products,signal,f.request));assert.equal(f.h.aiSources.length,0);
 }finally{f.h.close();}
});
test('aborted or malformed inventory fails without preparing a provider or pricing request',async()=>{
 const f=await fixture();try{const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(f.api.planBatchSeoWork(f.products,controller.signal,()=>{calls++;throw Error('unexpected');}));assert.equal(calls,0);
  await assert.rejects(f.api.planBatchSeoWork(f.products,new AbortController().signal,async()=>Response.json({ownerId:'owner',company:{code:'bad',name:'bad'}})));
  assert.equal(f.h.aiSources.length,0);assert.equal(f.h.calls.some(call=>call.endsWith('/automation')),false);
 }finally{f.h.close();}
});
