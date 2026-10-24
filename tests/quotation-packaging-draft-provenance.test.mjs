import test from 'node:test';import assert from 'node:assert/strict';
import {apiFixture,companies} from './helpers/supplier-hub-single-projection.mjs';
import {aiFixture} from './helpers/quotation-ai.mjs';
import {legacyPackagingDraft} from './helpers/quotation-packaging-provider.mjs';
const json=async(response,status=200)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;};
async function fixture(){const f=await apiFixture(companies[0],aiFixture({company:companies[0]}).snapshot);
 const get=()=>f.h.route(f.base+'/quotation-fields'+f.query).then(json),view=await get(),helper=f.h.load('app/quotation-packaging-draft.ts'),basis=f.h.load('app/quotation-packaging-basis.ts'),options=await f.h.load('db/product-options.ts').readProductOptions('owner',f.id),scope={optionId:null,applyToAllOptions:true};
 // Provenance tests adopt an explicit historical draft. A missing provider
 // response no longer manufactures fallback values in the production path.
 const result=legacyPackagingDraft(helper,helper.buildQuotationPackagingDraftPlan(view,options,{title:'合成包装',description:'',attributes:[]},scope));
 const changes=helper.quotationPackagingDraftChanges(view,result,f.id,scope),drafts=helper.quotationPackagingDraftInputs(view,result,f.id,scope);
 const put=(before,edits=changes,...args)=>{const metadata=args.length?args[0]:drafts;return f.h.route(f.base+'/quotation-fields'+f.query,{method:'PUT',body:{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:edits,...(metadata===undefined?{}:{packagingDrafts:metadata})}});};
 return{...f,get,view,basis,changes,drafts,put};}
test('accepted estimates persist exact origin/basis and remain non-measured in saved final receipt review',async()=>{
 const f=await fixture();try{const options=JSON.stringify(await f.h.load('db/product-options.ts').readProductOptions('owner',f.id));
  for(const origin of ['ai-estimate','couplus-fallback']){
   const before=await f.get(),drafts=f.drafts.map(item=>({...item,origin})),saved=await json(await f.put(before,f.changes,drafts));
   for(const change of f.changes){const fact=saved.packagingBasis.options[change.optionId][change.fieldKey];assert.deepEqual(fact.nonMeasuredDraft,{origin,measured:false});assert.equal(fact.value,change.value);assert.equal(fact.fieldSignature,JSON.stringify(saved.resolved.schema.fields.find(field=>field.id===change.fieldKey)));assert.equal(fact.unitsPerPack[change.optionId],1);}
   const readback=await f.get();assert.deepEqual(readback.packagingBasis,saved.packagingBasis);
   const review=f.h.load('app/submission-review.ts').inspectSubmission(readback.resolved,[]);assert.ok(review.issues.some(issue=>issue.kind==='review'&&issue.message.includes('실측값이 아닙니다')));
   assert.equal(f.h.load('app/quotation-fields-confirmation.ts').confirmQuotationFieldsSave(before,saved,f.changes,readback,drafts),saved);
  }
  assert.equal(JSON.stringify(await f.h.load('db/product-options.ts').readProductOptions('owner',f.id)),options);assert.equal(f.h.aiSources.length,0);assert.deepEqual(f.h.network,[]);
 }finally{f.close();}
});
test('same-value/unrelated saves retain the estimate marker; manual value/blank/reset clear only the affected marker',async()=>{
 const f=await fixture();try{let saved=await json(await f.put(f.view));
  const target=f.changes[0],other=f.changes[1],original=structuredClone(saved.packagingBasis);
  saved=await json(await f.put(saved,[target],undefined));assert.deepEqual(saved.packagingBasis,original);
  saved=await json(await f.put(saved,[{optionId:target.optionId,fieldKey:'salePrice',value:'23000'}],undefined));assert.deepEqual(saved.packagingBasis,original);
  saved=await json(await f.put(saved,[{...target,value:target.value.includes('*')?'110*110*110':'110'}],undefined));assert.equal(saved.packagingBasis.options[target.optionId][target.fieldKey].nonMeasuredDraft,undefined);assert.deepEqual(saved.packagingBasis.options[other.optionId][other.fieldKey].nonMeasuredDraft,{origin:'couplus-fallback',measured:false});
  saved=await json(await f.put(saved,[{...target,value:''}],undefined));assert.equal(saved.packagingBasis.options[target.optionId]?.[target.fieldKey],undefined);
  saved=await json(await f.put(saved,[{...other,value:null}],undefined));assert.equal(saved.packagingBasis,undefined);assert.equal(saved.overrides.options[target.optionId][target.fieldKey],'');
 }finally{f.close();}
});
test('missing or forged origin/basis, foreign fields/values/options and stale clocks cannot commit draft metadata',async()=>{
 const f=await fixture();try{const before=f.state();for(const patch of [{measured:true},{origin:'collected'},{origin:'measured'},{unitsPerPack:2},{fieldSignature:'different schema'},{fieldKey:'salePrice'},{optionId:'foreign'},{value:'555'},{private:'not permitted'}])await json(await f.put(f.view,f.changes,[{...f.drafts[0],...patch}]),400);
  await json(await f.put(f.view,f.changes,[f.drafts[0],f.drafts[0]]),400);assert.equal(f.state(),before);
  await json(await f.put({...f.view,revision:99}),409);assert.equal(f.state(),before);
 }finally{f.close();}
});
test('old payloads remain compatible, while old marker cannot certify a changed quantity or schema',async()=>{
 const f=await fixture();try{const fields=f.view.resolved.schema.fields,quantities=f.view.optionPackQuantities,old=f.basis.applyQuotationPackagingBasis(undefined,fields,quantities,f.changes);assert.doesNotThrow(()=>f.basis.validateQuotationPackagingBasis(old));
  assert.ok(Object.values(old.options).every(fields=>Object.values(fields).every(fact=>fact.nonMeasuredDraft===undefined)));
  const marked=f.basis.applyQuotationPackagingBasis(undefined,fields,quantities,f.changes,f.drafts),quantityChanged={...quantities,[f.changes[0].optionId]:3};
  assert.throws(()=>f.basis.applyQuotationPackagingBasis(marked,fields,quantityChanged,f.changes,f.drafts));
  const confirmed=f.basis.applyQuotationPackagingBasis(marked,fields,quantityChanged,f.changes);assert.deepEqual(confirmed.options[f.changes[0].optionId][f.changes[0].fieldKey].nonMeasuredDraft,{origin:'couplus-fallback',measured:false});
  const different=fields.map(field=>field.id===f.changes[0].fieldKey?{...field,help:'changed schema'}:field);assert.throws(()=>f.basis.applyQuotationPackagingBasis(marked,different,quantities,f.changes,f.drafts));
 }finally{f.close();}
});
test('same-value g aliases and explicit copies never wash a known estimate into an unmarked value',async()=>{
 const f=await fixture();try{
  const fields=f.view.resolved.schema.fields,first=f.changes[0],copied={...first,optionId:'other'},quantities={...f.view.optionPackQuantities,other:3},changes=[...f.changes,copied];
  const next=f.basis.applyQuotationPackagingBasis(undefined,fields,quantities,changes,f.drafts);
  assert.deepEqual(JSON.parse(JSON.stringify(next.options.other[first.fieldKey].nonMeasuredDraft)),{origin:'couplus-fallback',measured:false});assert.deepEqual(JSON.parse(JSON.stringify(next.options.other[first.fieldKey].unitsPerPack)),{other:3});
  const again=f.basis.applyQuotationPackagingBasis(next,fields,quantities,[{...copied,optionId:'synthetic-one'}]);assert.deepEqual(JSON.parse(JSON.stringify(again.options['synthetic-one'][first.fieldKey].nonMeasuredDraft)),{origin:'couplus-fallback',measured:false});
 }finally{f.close();}
});
function member(f){f.h.sqlite.exec(f.h.load('db/member-schema.ts').memberSchema0);const now=new Date().toISOString();f.h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner','jwhj1116@kakao.com','synthetic-unused','admin','approved',companies[0].code,companies[0].name,now,now);f.h.bindings.YOOFAM_AUTH_ENABLED='true';}
for(const boundary of ['before-write','in-transaction'])test(`current-company native fence prevents persistent packaging metadata across ${boundary} membership change`,async()=>{
 const f=await fixture();try{member(f);const before=f.state(),old=f.h.sqlite.prepare('SELECT * FROM members').get();let changed=false;
  if(boundary==='before-write'){const prepare=f.h.db.prepare;f.h.db.prepare=function(sql){const statement=prepare(sql),execute=statement.execute;if(sql.startsWith('INSERT INTO product_quotation_fields'))statement.execute=function(){changed=true;f.h.sqlite.prepare("UPDATE members SET company_code=?,company_name=? WHERE id='owner'").run(companies[1].code,companies[1].name);return execute();};return statement;};}
  else f.h.sqlite.exec("CREATE TRIGGER packaging_company_change AFTER UPDATE OF updated_at ON products BEGIN UPDATE members SET company_code='A01464742',company_name='와이홉' WHERE id='owner'; END");
  await json(await f.put(f.view),boundary==='before-write'?409:503);assert.equal(f.state(),before);if(boundary==='before-write')assert.equal(changed,true);else assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM members').get(),old);
 }finally{f.close();}
});
