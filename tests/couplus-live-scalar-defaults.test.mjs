import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const h=mobileIntakeHarness(),quotes=h.load('app/quotation-schema.ts'),compiler=h.load('app/supplier-hub-schema.ts');
test.after(()=>h.close());
const byLabel=(schema,label)=>schema.fields.find(field=>field.label===label);
function snapshot(company=schemaCompanies[0],change=()=>{}){
 const value=hubSchemaSnapshot(company),raw=JSON.parse(value.schemaString);
 raw.required=['startPage','productPage','legalPage','logisticsPage'];
 raw.properties.productPage.required=['basicAttributes','price'];
 const basic=raw.properties.productPage.properties.basicAttributes;
 basic.required=['brand','status','optionalStatus','numericInitial','booleanInitial','fashionSeason','plainText','preferredNA'];
 Object.assign(basic.properties,{
  status:{type:'string',title:'기본 선택',enum:['첫 값','둘째 값'],default:'둘째 값'},
  optionalStatus:{type:['string','null'],title:'nullable 선택',enum:['첫 값',null]},
  preferredNA:{type:'string',title:'해당없음 선택',dropdown:['첫 값','해당사항없음','둘째 값']},
  numericInitial:{type:'integer',title:'필수 숫자',minimum:1},
  booleanInitial:{type:'boolean',title:'필수 불리언'},
  fashionSeason:{type:'string',title:'시즌',enum:['여름','사계절']},
  plainText:{type:'string',title:'필수 설명',minLength:2},
  optionalText:{type:'string',title:'선택 설명'},
 });
 raw.properties.productPage.properties.optionalGroup={type:'object',required:['inside'],properties:{inside:{type:'string',title:'선택 객체 내부',enum:['자동 채우면 안 됨']}}};
 raw.properties.logisticsPage.required=['shelfLifeDays'];
 change(raw);
 return {...value,draftInitialization:'couplus-required-v1',schemaString:JSON.stringify(raw)};
}
const schemaFor=value=>quotes.getQuotationSchema(value.categoryId,schemaPath,value);

test('captured required scalars follow Couplus initialization rather than replacing it with schema annotation defaults',()=>{
 for(const company of schemaCompanies){
  const schema=schemaFor(snapshot(company));assert.equal(schema.status,'observed');
  for(const [label,expected] of [['기본 선택','첫 값'],['nullable 선택','첫 값'],['해당없음 선택','해당사항없음'],['필수 숫자','0'],['필수 불리언','false'],['시즌','사계절'],['필수 설명','']])assert.equal(byLabel(schema,label).draftDefault,expected,label);
  assert.equal(byLabel(schema,'기본 선택').schemaDefault,'둘째 값');
  assert.equal(byLabel(schema,'선택 설명').draftDefault,undefined);assert.equal(byLabel(schema,'선택 객체 내부').draftDefault,undefined);
  assert.equal(byLabel(schema,'표면 처리').draftDefault,'');assert.equal(byLabel(schema,'렌즈 관리방법').draftDefault,'해당사항없음');
 }
});

test('initialization requires the complete captured page/object/field chain and retains legacy snapshot behavior',()=>{
 const original=snapshot();
 for(const change of [raw=>{raw.required=raw.required.filter(page=>page!=='productPage');},raw=>{raw.properties.productPage.required=['price'];},raw=>{raw.properties.productPage.properties.basicAttributes.required=['brand'];}]){
  assert.equal(byLabel(schemaFor(snapshot(schemaCompanies[0],change)),'기본 선택').draftDefault,undefined);
 }
 const {draftInitialization,...legacy}=original;
 assert.equal(draftInitialization,'couplus-required-v1');assert.equal(byLabel(schemaFor(legacy),'기본 선택').draftDefault,undefined);
 const restored=compiler.validateHubSchemaSnapshot(original,original.categoryId,schemaPath);assert.equal(restored.draftInitialization,'couplus-required-v1');
 assert.equal(compiler.validateHubSchemaSnapshot(legacy,legacy.categoryId,schemaPath).draftInitialization,undefined);
 assert.throws(()=>compiler.validateHubSchemaSnapshot({...original,draftInitialization:'unknown'},original.categoryId,schemaPath),/초안 초기화 버전/);
});

test('nullable choices and Boolean unions retain the initializer distinction without inventing a selection',()=>{
 const schema=schemaFor(snapshot(schemaCompanies[0],raw=>{
  const fields=raw.properties.productPage.properties.basicAttributes.properties;
  fields.optionalStatus.enum=[null,'첫 값'];fields.booleanInitial.type=['boolean','null'];
 }));
 assert.equal(byLabel(schema,'nullable 선택').draftDefault,'');assert.equal(byLabel(schema,'필수 불리언').draftDefault,'');
 assert.ok(byLabel(schema,'필수 불리언').choices.some(choice=>choice.value===''));
});

test('malformed required chains cannot be treated as a supported complete form',()=>{
 for(const change of [raw=>{raw.required='productPage';},raw=>{raw.required.push('missingPage');},raw=>{raw.required.push('productPage');},raw=>{raw.properties.productPage.required={basicAttributes:true};},raw=>{raw.properties.productPage.properties.basicAttributes.required.push('missingField');}]){
  const schema=schemaFor(snapshot(schemaCompanies[0],change));assert.equal(schema.status,'unconfirmed');assert.ok(schema.unsupportedFields.some(path=>path.endsWith('required')));
 }
});

test('root conditional schemas stay unconfirmed instead of presenting unconditional placeholders as a complete form',()=>{
 for(const key of ['$ref','oneOf','anyOf','allOf','if','not','dependentRequired','dependencies','patternProperties']){
  const schema=schemaFor(snapshot(schemaCompanies[0],raw=>{raw[key]={};}));assert.equal(schema.status,'unconfirmed');assert.ok(schema.unsupportedFields.includes('schema'));
 }
});

test('the two exact image agreement fields match Couplus post-initialization without selecting unrelated Boolean values',()=>{
 const snap=snapshot(schemaCompanies[0],raw=>{
  raw.properties.imagePage.properties.msrpAgree={type:'boolean',title:'가격 동의'};
  raw.properties.imagePage.properties.labelContactAgreed={type:'boolean',title:'표시사항 동의'};
  const basic=raw.properties.productPage.properties.basicAttributes;
  basic.required.push('msrpAgree');basic.properties.msrpAgree={type:'boolean',title:'다른 구역의 같은 이름'};
 });
 const schema=schemaFor(snap);
 assert.equal(byLabel(schema,'가격 동의').draftDefault,'true');assert.equal(byLabel(schema,'표시사항 동의').draftDefault,'true');
 assert.equal(byLabel(schema,'다른 구역의 같은 이름').draftDefault,'false');
 const {draftInitialization,...legacy}=snap;assert.equal(draftInitialization,'couplus-required-v1');assert.equal(byLabel(schemaFor(legacy),'가격 동의').draftDefault,undefined);
});

test('Couplus placeholders do not bypass required, numeric, string or actual choice validation',()=>{
 const schema=schemaFor(snapshot());
 const numeric=byLabel(schema,'필수 숫자'),plain=byLabel(schema,'필수 설명'),season=byLabel(schema,'시즌');
 assert.match(quotes.quotationValueIssues(numeric,numeric.draftDefault).join(),/숫자/);
 assert.match(quotes.quotationValueIssues(plain,plain.draftDefault).join(),/필수/);
 assert.equal(quotes.quotationValueIssues(season,season.draftDefault).length,0);
 const invalid=schemaFor(snapshot(schemaCompanies[0],raw=>{raw.properties.productPage.properties.basicAttributes.properties.fashionSeason.enum=['여름'];}));
 assert.match(quotes.quotationValueIssues(byLabel(invalid,'시즌'),'사계절').join(),/선택값/);
 const conflict=schemaFor(snapshot(schemaCompanies[0],raw=>{raw.properties.productPage.properties.basicAttributes.properties.status.dropdown=['다른 값'];}));
 assert.equal(conflict.status,'unconfirmed');assert.ok(conflict.unsupportedFields.length);
});

test('both companies connect URL drafts to required scalar defaults, preserve manual blanks and export final reviewed values',async()=>{
 for(const company of schemaCompanies){
  const local=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
  try{
   const snap=snapshot(company),input={name:'시험 최종분류',categoryId:snap.categoryId,categoryPath:schemaPath,template:null,mappings:[],hubSchema:snap};
   const api=local.load('app/api/category-profiles/route.ts');
   const post=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)}));
   assert.equal(post.status,201,await post.clone().text());const {profile}=await post.json();
   assert.equal(profile.hubSchema.draftInitialization,'couplus-required-v1');
   local.context.category=profile;local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');
   assert.match(await local.intake(),/상품 초안 저장됨/);
   const product=local.sqlite.prepare('SELECT * FROM products').get(),path='/api/products/'+product.id+'/quotation-fields';
   let view=await(await local.route(path)).json();const schema=view.resolved.schema;
   const status=byLabel(schema,'기본 선택'),numeric=byLabel(schema,'필수 숫자'),bool=byLabel(schema,'필수 불리언'),season=byLabel(schema,'시즌');
   assert.equal(view.resolved.rows.filter(row=>row.optionId!==null).length,6);
   for(const row of view.resolved.rows){
    assert.equal(row.fields[status.id].value,'첫 값');assert.equal(row.fields[status.id].source,'couplus-default');
    assert.equal(row.fields[numeric.id].value,'0');assert.ok(row.fields[numeric.id].validationIssues.length);
    assert.equal(row.fields[bool.id].value,'false');assert.equal(row.fields[season.id].value,'사계절');
    assert.equal(row.fields.brand.source,'settings');assert.equal(row.fields.brand.value,'검토 브랜드');
   }
   const option=view.resolved.rows.find(row=>row.optionId!==null);
   assert.ok(Number(option.fields.supplyPrice.value)>0,'calculated source prices take priority over numeric initialization');
   assert.notEqual(option.fields.title.value,'');
   const changes=[{fieldKey:status.id,optionId:null,value:'둘째 값'},{fieldKey:numeric.id,optionId:null,value:'9'},{fieldKey:status.id,optionId:option.optionId,value:''},{fieldKey:bool.id,optionId:null,value:'true'}];
   const put=await local.route(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}});
   assert.equal(put.status,200,await put.clone().text());view=await(await local.route(path)).json();
   assert.equal(view.resolved.rows.find(row=>row.optionId===option.optionId).fields[status.id].source,'manual-option');
   const source=await local.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,profile.id);
   const resolved=local.load('app/exports/quotation-source.ts').resolveQuotationExport(source);
   const rows=local.load('app/exports/quotation-fields.ts').resolvedQuotationRows(source,resolved,[]);
   assert.equal(rows.length,6);assert.equal(rows[0][status.id],'');assert.equal(rows[1][status.id],'둘째 값');assert.equal(rows[0][numeric.id],9);assert.equal(rows[0][bool.id],'true');
   const headers=['기본 선택','필수 숫자','필수 불리언'],originalBytes=new TextEncoder().encode(headers.join(',')+'\n').buffer;
   const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',originalBytes)).toString('hex');
   const csvProfile={...profile,template:{name:'test.csv',format:'csv',sheetName:'',headerRow:1,headers,sha256},mappings:[{column:0,field:status.id,required:false},{column:1,field:numeric.id,required:true},{column:2,field:bool.id,required:true}]};
   const mapped=await local.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes,profile:csvProfile,rows,dataStartRow:2});
   assert.deepEqual(JSON.parse(JSON.stringify(mapped.values[0])),['',9,'true']);
   assert.equal(source.hubSchema.draftInitialization,'couplus-required-v1');assert.ok(!local.network.includes('supplier.coupang.com'));
  }finally{local.close();}
 }
});

test('refreshing a category profile cannot add scalar initialization to an older working product',async()=>{
 const local=mobileIntakeHarness();try{
  const tagged=snapshot(),{draftInitialization,...legacy}=tagged;
  const input={name:'시험 최종분류',categoryId:legacy.categoryId,categoryPath:schemaPath,template:null,mappings:[],hubSchema:legacy};
  const api=local.load('app/api/category-profiles/route.ts');
  const post=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)}));
  assert.equal(post.status,201);const {profile}=await post.json();
  local.context.category=profile;local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');await local.intake();
  const product=local.sqlite.prepare('SELECT * FROM products').get(),path='/api/products/'+product.id+'/quotation-fields';
  const before=await(await local.route(path)).json(),field=byLabel(before.resolved.schema,'기본 선택');assert.equal(field.draftDefault,undefined);
  const update=await api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:profile.id,expectedRevision:profile.revision,profile:{...input,hubSchema:{...legacy,draftInitialization}}})}));
  assert.equal(update.status,200,await update.clone().text());
  const after=await(await local.route(path)).json();assert.deepEqual(after.resolved.rows,before.resolved.rows);assert.deepEqual(after.resolved.schema,before.resolved.schema);
  assert.equal(after.inputFingerprint,before.inputFingerprint);
 }finally{local.close();}
});
