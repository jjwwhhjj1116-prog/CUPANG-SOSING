import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const harness=mobileIntakeHarness(),quotes=harness.load('app/quotation-schema.ts');
test.after(()=>harness.close());
function snapshot(company=schemaCompanies[0],change=()=>{}){
 const value=hubSchemaSnapshot(company),raw=JSON.parse(value.schemaString);
 raw.required=['startPage','productPage','logisticsPage'];
 raw.properties.productPage={type:'object',required:['brand','businessType','importType'],properties:{
  brand:{type:'string',title:'브랜드',dropdown:['양식 브랜드','검토 브랜드']},
  manufacturer:{type:'string',title:'제조사'},
  businessType:{type:'string',title:'거래 유형',enum:['공식총판사','제조사']},
  importType:{type:'string',title:'수입 유형',enum:['수입대상아님','병행수입상품']},
  taxationSchema:{type:'string',title:'과세 여부',enum:['과세','면세']},
 }};
 raw.properties.logisticsPage={type:'object',required:['specialHandlingReason'],properties:{specialHandlingReason:{type:'string',title:'특별 취급 사유',dropdown:['유리']}}};
 change(raw);
 return {...value,draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1',settingsInitialization:'couplus-options-v1',schemaString:JSON.stringify(raw)};
}
const schemaFor=snap=>quotes.getQuotationSchema(snap.categoryId,schemaPath,snap);
function resolve(snap,settings,overrides){
 const content=harness.load('app/product-content.ts').emptyProductContent('p'),options=harness.load('app/product-options.ts').emptyProductOptions('p');
 return quotes.resolveQuotationFields({categoryId:snap.categoryId,categoryPath:schemaPath,hubSchema:snap,product:{id:'p',title:'검토 상품',image_keys:'[]',created_at:'2026-10-02T00:00:00Z',pricing_policy:JSON.stringify(settings)},content,options,settings,overrides});
}
const saved={...harness.settings,brand:'외부 브랜드, 검토 브랜드',tradeType:'기타 도소매업자',importType:'수입상품',handlingReason:'해당사항없음'};
const cells=resolved=>resolved.rows.find(row=>row.optionId===null).fields;

test('fresh captured setting choices use the public first-value fallback while valid values retain exact identity',()=>{
 for(const company of schemaCompanies){
  const snap=snapshot(company),fields=cells(resolve(snap,saved));
  for(const [id,value] of [['brand','양식 브랜드'],['tradeType','공식총판사'],['importType','수입대상아님'],['handlingReason','유리']]){
   assert.equal(fields[id].value,value,id);assert.equal(fields[id].source,'settings');assert.equal(fields[id].validationIssues.length,0,id);
  }
  const valid=cells(resolve(snap,{...saved,brand:'검토 브랜드, 외부 브랜드',tradeType:'제조사',importType:'병행수입상품',handlingReason:'유리'}));
  assert.equal(valid.brand.value,'검토 브랜드');assert.equal(valid.tradeType.value,'제조사');assert.equal(valid.importType.value,'병행수입상품');assert.equal(valid.handlingReason.value,'유리');
 }
});

test('a comma brand is reduced without choices, while empty settings leave initialized defaults intact',()=>{
 const snap=snapshot(schemaCompanies[0],raw=>{delete raw.properties.productPage.properties.brand.dropdown;});
 assert.equal(cells(resolve(snap,{...saved,brand:'  검토 브랜드  , 또 다른 브랜드'})).brand.value,'검토 브랜드');
 assert.equal(cells(resolve(snap,{...saved,brand:'  단일 브랜드  '})).brand.value,'  단일 브랜드  ');
 const blank=cells(resolve(snapshot(),{...saved,brand:'',tradeType:'',importType:'',handlingReason:''}));
 assert.equal(blank.brand.value,'양식 브랜드');assert.equal(blank.brand.source,'couplus-default');
 assert.equal(blank.handlingReason.value,'유리');assert.equal(blank.handlingReason.source,'couplus-default');
});

test('public option matching is exact and preserves an explicitly empty first choice as a selected settings value',()=>{
 const value=harness.load('app/couplus-registration-defaults.ts').couplusSettingDraftValue;
 assert.equal(value({input:'brand',values:['검토 브랜드','양식 브랜드']},'검토 브랜드, 다른 이름'),'검토 브랜드');
 assert.equal(value({input:'brand',values:['양식 브랜드','검토 브랜드']},' 검토 브랜드 '),'양식 브랜드');
 for(const first of ['',null,0,false])assert.equal(value({input:'brand',values:[first,'검토 브랜드']},'미등록 브랜드'),'');
 assert.equal(value({input:'brand',values:[true,'검토 브랜드']},'미등록 브랜드'),'true');
 assert.equal(value({input:'brand',values:[0]},'0'),'');
 assert.equal(value({input:'brand',values:['0']},'0'),'0');
 assert.equal(value({input:'brand',values:['양식 브랜드']},''),undefined);
 const empty=cells(resolve(snapshot(schemaCompanies[0],raw=>{raw.properties.productPage.properties.brand.dropdown=['','검토 브랜드'];}),saved));
 assert.equal(empty.brand.value,'');assert.equal(empty.brand.source,'settings');assert.deepEqual(JSON.parse(JSON.stringify(empty.brand.validationIssues)),['필수 값이 비어 있습니다.']);
});

test('setting initialization is frozen and rejects unknown versions without changing older snapshots',()=>{
 const model=harness.load('app/supplier-hub-schema.ts'),current=snapshot(),{settingsInitialization,...legacy}=current;
 assert.equal(settingsInitialization,'couplus-options-v1');assert.equal(model.validateHubSchemaSnapshot(current,current.categoryId,schemaPath).settingsInitialization,settingsInitialization);
 assert.equal(model.validateHubSchemaSnapshot(legacy,legacy.categoryId,schemaPath).settingsInitialization,undefined);
 assert.throws(()=>model.validateHubSchemaSnapshot({...current,settingsInitialization:'other'},current.categoryId,schemaPath),/기본설정 적용 버전/);
 const previous=cells(resolve(legacy,saved));assert.equal(previous.brand.value,saved.brand);assert.equal(previous.tradeType.value,saved.tradeType);assert.ok(previous.brand.validationIssues.length);
});

test('setting defaults bind only the four observed exact paths, never tax, manufacturer or a same-labelled sibling',()=>{
 const schema=schemaFor(snapshot(schemaCompanies[0],raw=>{raw.properties.productPage.properties.other={type:'object',properties:{brand:{type:'string',title:'브랜드',enum:['다른 브랜드']}}};}));
 assert.equal(schema.status,'observed');assert.deepEqual(schema.fields.filter(field=>field.couplusSetting).map(field=>field.hubInput).sort(),['brand','handlingReason','importType','tradeType']);
 assert.equal(schema.fields.find(field=>field.id==='taxType').couplusSetting,undefined);assert.equal(schema.fields.find(field=>field.id==='manufacturer').couplusSetting,undefined);
 assert.equal(schema.fields.find(field=>field.hubWire?.path.includes('other')).couplusSetting,undefined);
});

test('manual common values and explicit blanks take priority over automatic fallback choices',()=>{
 const fields=cells(resolve(snapshot(),saved,{common:{brand:'검토 브랜드',tradeType:'',importType:'병행수입상품',handlingReason:''},options:{}}));
 assert.equal(fields.brand.value,'검토 브랜드');assert.equal(fields.tradeType.value,'');assert.equal(fields.importType.value,'병행수입상품');assert.equal(fields.handlingReason.value,'');
 for(const id of ['brand','tradeType','importType','handlingReason'])assert.equal(fields[id].source,'manual-common');
 const invalid=cells(resolve(snapshot(),saved,{common:{tradeType:'실제 양식에 없는 수동값'},options:{}}));
 assert.equal(invalid.tradeType.value,'실제 양식에 없는 수동값');assert.ok(invalid.tradeType.validationIssues.length);
});

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
async function setup(local,snap){
 const api=local.load('app/api/category-profiles/route.ts'),input={name:'시험 최종분류',categoryId:snap.categoryId,categoryPath:schemaPath,template:null,mappings:[],hubSchema:snap};
 const response=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)}));
 assert.equal(response.status,201,await response.clone().text());const {profile}=await response.json();
 local.context.category=profile;Object.assign(local.context.settings,saved);
 local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');
 assert.match(await local.intake(),/상품 초안 저장됨/);const product=local.sqlite.prepare('SELECT * FROM products').get();
 return {api,input,profile,product,path:'/api/products/'+product.id+'/quotation-fields'};
}
for(const company of schemaCompanies)test(`URL intake applies saved category choices, keeps later review edits and exports the same final values (${company.code})`,async()=>{
 const local=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const f=await setup(local,snapshot(company));let view=await json(await local.route(f.path));
  assert.equal(view.resolved.rows.filter(row=>row.optionId!==null).length,6);
  for(const row of view.resolved.rows)assert.deepEqual(['brand','tradeType','importType','handlingReason'].map(id=>row.fields[id].value),['양식 브랜드','공식총판사','수입대상아님','유리']);
  await local.load('db/queries.ts').saveSettings('owner',JSON.stringify({...local.settings,brand:'검토 브랜드',tradeType:'제조사',handlingReason:'유리'}));
  const stable=await json(await local.route(f.path));assert.notEqual(stable.inputFingerprint,view.inputFingerprint);assert.deepEqual(stable.resolved.rows,view.resolved.rows);
  const stale=await local.route(f.path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'brand',optionId:null,value:'검토 브랜드'}]}});assert.equal(stale.status,409);
  view=stable;
  const option=view.resolved.rows.find(row=>row.optionId!==null);
  view=await json(await local.route(f.path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:'brand',optionId:option.optionId,value:'검토 브랜드'},{fieldKey:'tradeType',optionId:option.optionId,value:'제조사'},{fieldKey:'importType',optionId:option.optionId,value:'병행수입상품'},{fieldKey:'handlingReason',optionId:option.optionId,value:''}]}}));
  const source=await local.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',f.product.id,f.profile.id),resolved=local.load('app/exports/quotation-source.ts').resolveQuotationExport(source);
  const assets=JSON.parse(f.product.image_keys).map((key,index)=>({key,name:'images/'+index+'.png'}));
  const output=local.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,assets);
  assert.deepEqual(JSON.parse(JSON.stringify(['brand','tradeType','importType','handlingReason'].map(id=>output[0][id]))),['검토 브랜드','제조사','병행수입상품','']);
  assert.deepEqual(JSON.parse(JSON.stringify(['brand','tradeType','importType','handlingReason'].map(id=>output[1][id]))),['양식 브랜드','공식총판사','수입대상아님','유리']);
  assert.equal(source.hubSchema.settingsInitialization,'couplus-options-v1');assert.ok(!local.network.includes('supplier.coupang.com'));
 }finally{local.close();}
});

test('new default-choice rules on a refreshed profile do not modify the frozen draft of a working product',async()=>{
 const local=mobileIntakeHarness();try{
  const current=snapshot(),{settingsInitialization,...legacy}=current,f=await setup(local,legacy),before=await json(await local.route(f.path));
  const response=await f.api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.profile.id,expectedRevision:f.profile.revision,profile:{...f.input,hubSchema:{...legacy,settingsInitialization}}})}));
  assert.equal(response.status,200,await response.clone().text());const after=await json(await local.route(f.path));
  assert.deepEqual(after.resolved.rows,before.resolved.rows);assert.deepEqual(after.resolved.schema,before.resolved.schema);assert.equal(after.inputFingerprint,before.inputFingerprint);
 }finally{local.close();}
});
