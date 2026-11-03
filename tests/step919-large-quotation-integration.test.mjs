import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationAiApiFixture,companies,plain} from './helpers/quotation-ai-api.mjs';
import {quotationTitleLoader} from './helpers/quotation-form-presentation.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const insertSql='INSERT INTO product_quotation_fields(product_id,owner_id,revision,payload,updated_at)';
async function largeFixture(company,{largeExistingOverrides=false}={}){
 const f=await quotationAiApiFixture(company);
 try{
  const optionModel=f.h.load('app/product-options.ts'),optionStore=f.h.load('db/product-options.ts'),queries=f.h.load('db/queries.ts');
  const before=await optionStore.readProductOptions('owner',f.id),product=await queries.findProduct('owner',f.id);
  const ids=Array.from({length:200},(_,index)=>'step919-'+String(index+1).padStart(3,'0'));
  const rows=ids.map(id=>({...optionModel.emptyOptionInput(id),originalName:'黑色',translatedName:'검정',included:true,unitCostCny:7.1,unitsPerPack:1}));
  assert.ok(await optionStore.saveProductOptions('owner',optionModel.applyOptionRows(before,rows,new Date().toISOString()),before.revision,product.updated_at));
  const priorId='step919-prior-'+company.code;
  await queries.insertProduct({...product,id:priorId,source_url:'synthetic://step919-prior-finished',registration_status:'submitted',supplier_hub_status:'FINISHED'});
  const fields=()=>f.h.route(f.base+'/quotation-fields'+f.query).then(json);
  const put=(view,changes)=>f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}});
  let view=await fields();
  const preserved=[{fieldKey:'brand',optionId:null,value:''},{fieldKey:'manufacturer',optionId:ids[0],value:'직접 확인한 제조사'}];
  if(largeExistingOverrides)for(const optionId of ids.slice(0,4))preserved.push({fieldKey:'detailHtml',optionId,value:'<p>'+('x'.repeat(119990))+'</p>'});
  view=await json(await put(view,preserved));
  const initial=await json(await f.request(undefined,'GET')),beforeGeneration=f.state();
  const generated=await json(await f.request(f.requestBody(initial)));
  assert.equal(generated.sourceCurrent,true);assert.equal(generated.job.status,'completed');assert.equal(generated.job.result.changes.length,1400);
  assert.equal(new Set(generated.job.result.changes.map(change=>change.optionId)).size,200);
  assert.equal(f.state(),beforeGeneration,'generation preserves the product, source and existing quote');
  view=await fields();const client=f.h.load('app/quotation-ai-client.ts');
  const changes=client.quotationReviewedProposalChanges(initial,view,f.id,generated.job,null,true);
  assert.equal(changes.length,1400);assert.equal(new Set(changes.map(change=>JSON.stringify([change.optionId,change.fieldKey]))).size,1400);
  const body={expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes};
  assert.ok(bytes(body)<512*1024);assert.ok(bytes(generated.job.result)<256*1024);
  const stable=()=>{
   const current={...f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.id)};delete current.updated_at;
   return JSON.stringify({current,prior:f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(priorId),
    tables:['product_content','product_options','workspace_settings','category_profiles','product_price_policy','supplier_hub_receipts'].map(table=>[table,f.h.sqlite.prepare('SELECT * FROM '+table).all()])});
  };
  const stableBefore=stable(),queriesBefore=f.queries.length;
  return{...f,ids,priorId,view,changes,body,generated,fields,put,stable,stableBefore,queriesBefore,preserved,
   commits:()=>f.queries.slice(queriesBefore).filter(sql=>sql.includes(insertSql)).length,
   confirm:(saved,previous=view,input=changes)=>f.h.load('app/quotation-fields-confirmation.ts').confirmQuotationFieldsSave(previous,saved,input)};
 }catch(error){f.close();throw error;}
}
function noExternal(f){assert.deepEqual(f.h.network,[]);assert.equal(f.h.aiSources.length,0);assert.equal(f.h.objects.size,0);assert.equal(f.jobs().length,1);assert.equal(f.jobs()[0].status,'completed');}

for(const company of companies)test(`step919 ${company.code}: completed 200-option AI job parses and commits all 1400 changes with one exact CAS`,async()=>{
 const f=await largeFixture(company);try{
  const plan=quotationTitleLoader()('app/components/quotation-fields-editor.tsx').quotationSavePlan(f.view,f.changes,f.ids[0],false);
  assert.equal(plan.changes.length,1400);assert.equal(plan.propagated.length,0,'AI-reviewed explicit option changes do not expand through the manual copy switch');
  const saved=await json(await f.put(f.view,f.changes)),confirmed=f.confirm(saved);
  assert.equal(confirmed.revision,f.view.revision+1);assert.equal(f.commits(),1);
  assert.deepEqual(plain(confirmed.overrides),plain(f.h.load('app/quotation-schema.ts').applyQuotationChanges(f.view.overrides,f.changes)));
  for(const change of f.changes){assert.equal(confirmed.overrides.options[change.optionId][change.fieldKey],change.value);assert.equal(confirmed.resolved.rows.find(row=>row.optionId===change.optionId).fields[change.fieldKey].value,change.value);}
  assert.equal(confirmed.overrides.common.brand,'');assert.equal(confirmed.overrides.options[f.ids[0]].manufacturer,'직접 확인한 제조사');
  assert.equal(f.stable(),f.stableBefore,'price, source, manual data and the separate finished prior product remain exact');
  noExternal(f);
  console.log('STEP919_PROOF '+JSON.stringify({company:company.code,includedOptions:200,changes:f.changes.length,requestBytes:bytes(f.body),overrideBytes:bytes(confirmed.overrides),revisionDelta:confirmed.revision-f.view.revision,quotationCAS:f.commits(),originalManualBlankPreserved:true,protectedPriorUnchanged:true,externalCalls:0}));
 }finally{f.close();}
});

test('step919 lost JSON ACK confirms the same 1400-cell save by GET without another PUT or AI execution',async()=>{
 const f=await largeFixture(companies[0]);try{
  const calls=f.provider.calls.length,response=await f.put(f.view,f.changes);assert.equal(response.status,200);
  const lost=new Response(null,{status:200});await assert.rejects(lost.json());
  const observed=await f.fields(),confirmed=f.confirm(observed);
  assert.equal(confirmed.revision,f.view.revision+1);assert.equal(f.commits(),1);assert.equal(f.provider.calls.length,calls);
  assert.equal(f.stable(),f.stableBefore);noExternal(f);
 }finally{f.close();}
});

test('step919 stale CAS retains a concurrent manual blank and rejects the entire large write',async()=>{
 const f=await largeFixture(companies[0]);try{
  const competing=await json(await f.put(f.view,[{fieldKey:'manufacturer',optionId:f.ids[1],value:''}]));
  const before=f.state(),commits=f.commits();await json(await f.put(f.view,f.changes),409);
  assert.equal(f.state(),before);assert.equal(f.commits(),commits);assert.equal((await f.fields()).overrides.options[f.ids[1]].manufacturer,'');
  assert.throws(()=>f.confirm(competing),/저장 응답/);noExternal(f);
 }finally{f.close();}
});

test('step919 source settings drift rejects the large save even when the quotation revision is unchanged',async()=>{
 const f=await largeFixture(companies[1]);try{
  const queries=f.h.load('db/queries.ts'),settings=JSON.parse((await queries.getSettings('owner')).payload);
  await queries.saveSettings('owner',JSON.stringify({...settings,hiddenAttributes:false}));
  const current=await f.fields();assert.equal(current.revision,f.view.revision);assert.notEqual(current.inputFingerprint,f.view.inputFingerprint);
  const before=f.state(),commits=f.commits();await json(await f.put(f.view,f.changes),409);
  assert.equal(f.state(),before);assert.equal(f.commits(),commits);assert.throws(()=>f.confirm(current),/저장 응답/);noExternal(f);
 }finally{f.close();}
});

test('step919 request-body and final-overrides byte limits reject atomically instead of saving a partial prefix',async()=>{
 const f=await largeFixture(companies[1],{largeExistingOverrides:true});try{
  const oversized=[...f.changes,...f.ids.slice(4,8).map(optionId=>({fieldKey:'detailHtml',optionId,value:'<p>'+('x'.repeat(130000))+'</p>'}))];
  assert.ok(bytes({...f.body,changes:oversized})>512*1024);
  let before=f.state(),commits=f.commits();await json(await f.put(f.view,oversized),413);assert.equal(f.state(),before);assert.equal(f.commits(),commits);
  const final=f.h.load('app/quotation-schema.ts').applyQuotationChanges(f.view.overrides,f.changes);assert.ok(bytes(final)>500*1024);
  before=f.state();commits=f.commits();await json(await f.put(f.view,f.changes),413);assert.equal(f.state(),before);assert.equal(f.commits(),commits);noExternal(f);
 }finally{f.close();}
});
