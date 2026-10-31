import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readSupplierHubSchema} from '../extensions/supplier-hub/schema-page.mjs';
import {readAppSupplierHubCatalog} from '../extensions/supplier-hub/catalog.mjs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {prepareAttachments,readPackageZip} from '../extensions/supplier-hub/package.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
const h=mobileIntakeHarness(),model=h.load('app/supplier-hub-schema.ts'),quotes=h.load('app/quotation-schema.ts');
test.after(()=>h.close());
const modify=(snapshot,change)=>{const raw=JSON.parse(snapshot.schemaString);change(raw);return {...snapshot,schemaString:JSON.stringify(raw)};};

test('native form transport policy is captured explicitly without upgrading legacy snapshots',()=>{
 const legacy=hubSchemaSnapshot(),before=JSON.stringify(legacy);
 const old=model.validateHubSchemaSnapshot(legacy,legacy.categoryId,schemaPath);
 assert.equal(Object.hasOwn(old,'nativeSerializationPolicy'),false);
 const current={...legacy,draftInitialization:'couplus-required-v1',nativeSerializationPolicy:'supplier-hub-native-required-form-v1'};
 const next=model.validateHubSchemaSnapshot(current,current.categoryId,schemaPath);
 assert.equal(next.nativeSerializationPolicy,'supplier-hub-native-required-form-v1');
 assert.equal(next.schemaString,legacy.schemaString);assert.equal(JSON.stringify(legacy),before);
 assert.throws(()=>model.validateHubSchemaSnapshot({...current,nativeSerializationPolicy:'unknown'},current.categoryId,schemaPath));
 assert.throws(()=>model.validateHubSchemaSnapshot({...legacy,nativeSerializationPolicy:current.nativeSerializationPolicy},current.categoryId,schemaPath));
});
test('live schema compiles exact section/attribute identity, real enums/defaults and distinct kan/display IDs',()=>{
 for(const company of schemaCompanies){const snapshot=hubSchemaSnapshot(company),valid=model.validateHubSchemaSnapshot(snapshot,snapshot.categoryId,schemaPath);
  assert.equal(valid.metadata.kanCategoryId,3000);assert.equal(valid.categoryId,'991234');
  const schema=quotes.getQuotationSchema(snapshot.categoryId,schemaPath,valid);assert.equal(schema.status,'observed');assert.equal(schema.submissionReady,false);
  const lens=schema.fields.find(field=>field.label==='렌즈 유형');assert.match(lens.id,/^live_991234_[a-f0-9]{16}$/);assert.equal(lens.required,true);assert.equal(lens.draftDefault,'');assert.deepEqual(plain(lens.choices),[{value:'',label:'해당사항없음'},{value:'UV',label:'UV'}]);
  assert.deepEqual(plain(lens.hubWire),{path:['productPage','commonAttributes','exposedAttributes'],nameKey:'name',valueKey:'value',name:'렌즈 유형'});
  assert.equal(schema.fields.find(field=>field.label==='표면 처리').draftDefault,'');assert.equal(schema.fields.find(field=>field.label==='렌즈 관리방법').draftDefault,'해당사항없음');
  assert.equal(schema.fields.find(field=>field.id==='taxType').schemaDefault,'과세');assert.equal(schema.fields.find(field=>field.id==='supplyPrice').min,1);
 }
});
test('named category arrays keep field identity, defaults and source linkage when JSON value precedes name',()=>{
 for(const company of schemaCompanies){
  const snapshot=hubSchemaSnapshot(company),original=quotes.getQuotationSchema(snapshot.categoryId,schemaPath,snapshot);
  const reversed=modify(snapshot,raw=>{
   const reorder=node=>{
    if(!node||typeof node!=='object')return;
    if(node.contains?.properties?.name&&node.contains.properties.value){
     const {name,value}=node.contains.properties;node.contains.properties={value,name};
    }
    for(const child of Object.values(node))if(Array.isArray(child))child.forEach(reorder);else reorder(child);
   };
   reorder(raw);
  });
  const actual=quotes.getQuotationSchema(snapshot.categoryId,schemaPath,reversed);
  assert.equal(actual.status,'observed');assert.deepEqual(plain(actual.fields),plain(original.fields));
  const imported=h.load('app/product-content.ts').emptyProductContent('read-only');
  const option={id:'SKU',originalName:'원본 색상',translatedName:'검토한 색상',supplierSku:'123',included:true,color:'검정',unitsPerPack:1,
   unitCostCny:1,weightKg:null,size:null,widthCm:null,lengthCm:null,heightCm:null,imageKey:null,provenance:{color:'manual'}};
  const input={categoryId:snapshot.categoryId,categoryPath:schemaPath,product:{id:'read-only',title:'읽은 상품',image_keys:'[]',source_price_cny:1},
   content:imported,settings:h.settings,options:[option]};
  const before=quotes.resolveQuotationFields({...input,hubSchema:snapshot}),after=quotes.resolveQuotationFields({...input,hubSchema:reversed});
  assert.deepEqual(plain(after.rows),plain(before.rows));
  const color=actual.fields.find(field=>field.hubWire?.name==='색상');
  assert.equal(after.rows.find(row=>row.optionId==='SKU').fields[color.id].value,'검정');
 }
});
test('explicit name/value keys distinguish a single permitted value and preserve manual values for either JSON order',()=>{
 const snapshot=modify(hubSchemaSnapshot(),raw=>{
  raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1].contains.properties.value={type:'string',enum:['UV']};
 });
 const reversed=modify(snapshot,raw=>{
  const item=raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1];
  const {name,value}=item.contains.properties;item.contains.properties={value,name};
 });
 const before=model.compileHubQuotationSchema(snapshot),after=model.compileHubQuotationSchema(reversed);
 assert.deepEqual(plain(after),plain(before));
 const lens=after.fields.find(field=>field.hubWire.name==='렌즈 유형');
 assert.equal(lens.hubWire.nameKey,'name');assert.equal(lens.hubWire.valueKey,'value');assert.equal(lens.choices[0].value,'UV');
 const changed=quotes.applyQuotationChanges(quotes.emptyQuotationOverrides(),[{fieldKey:lens.id,optionId:'SKU',value:'UV'}]);
 assert.equal(changed.options.SKU[lens.id],'UV');assert.equal(before.fields.find(field=>field.hubWire.name==='렌즈 유형').id,lens.id);
});
test('documented attribute keys support singleton choices while unknown pairs never infer singleton-enum order',()=>{
 const snapshot=hubSchemaSnapshot();
 const replace=properties=>modify(snapshot,raw=>{
  raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf=[{contains:{type:'object',properties}}];
 });
 const named={type:'string',enum:['시험 속성']},value={type:'string'};
 const forward=model.compileHubQuotationSchema(replace({attributeName:named,attributeValue:value}));
 const reverse=model.compileHubQuotationSchema(replace({attributeValue:value,attributeName:named}));
 assert.deepEqual(plain(reverse),plain(forward));assert.equal(reverse.unsupported.length,0);
 assert.deepEqual(plain(reverse.fields.find(field=>field.hubWire.name==='시험 속성').hubWire),{
  path:['productPage','commonAttributes','exposedAttributes'],nameKey:'attributeName',valueKey:'attributeValue',name:'시험 속성',
 });
 // Public extractSchemaInfoForQuotation (outputs/step546-public-methods.json)
 // identifies attributeName/attributeValue explicitly, including one choice.
 for(const properties of [{attributeName:named,attributeValue:{type:'string',enum:['한 값']}},{attributeValue:{type:'string',enum:['한 값']},attributeName:named}]){
  const result=model.compileHubQuotationSchema(replace(properties));assert.equal(result.unsupported.length,0);
  const selected=result.fields.find(field=>field.hubWire.name==='시험 속성');assert.equal(selected.hubWire.nameKey,'attributeName');assert.equal(selected.hubWire.valueKey,'attributeValue');assert.deepEqual(plain(selected.choices),[{value:'한 값',label:'한 값'}]);
 }
 for(const properties of [{customName:named,customValue:{type:'string',enum:['한 값']}},{customValue:{type:'string',enum:['한 값']},customName:named},
  {name:{type:'string'},value:{type:'string',enum:['잘못된 이름 후보']}}]){
  const result=model.compileHubQuotationSchema(replace(properties));
  assert.ok(result.unsupported.includes('productPage / commonAttributes / exposedAttributes'));
  assert.ok(!result.fields.some(field=>field.hubWire.path.at(-1)==='exposedAttributes'));
 }
});
test('snapshot rejects cross-category/path/company metadata, prototype keys and malformed/oversized raw schema',()=>{
 const snap=hubSchemaSnapshot();
 for(const patch of [{categoryId:'007'}, {categoryPath:['other']},{company:schemaCompanies[1],categoryPath:[]},{company:{code:'A00000000',name:'와이홉'}},{observedAt:Date.now()+120000},{metadata:{displayCategoryCode:'other'}},{metadata:{token:'private'}},{schemaString:'{}'},{schemaString:'x'.repeat(200001)},{schemaString:'{"properties":{"productPage":{},"legalPage":{}},"__proto__":{}}'}])assert.throws(()=>model.validateHubSchemaSnapshot({...snap,...patch},snap.categoryId,schemaPath));
});
test('new schema constraints replace stale recorded choices and unsupported conditions keep the schema unconfirmed',()=>{
 const snap=hubSchemaSnapshot(),base=[{id:'taxType',section:'product',visibility:'common',label:'과세여부',type:'select',required:false,choices:[{value:'OLD',label:'OLD'}],min:50,max:100,integer:true}];
 const noEnum=modify(snap,raw=>{delete raw.properties.productPage.properties.basicAttributes.properties.taxationSchema.enum;});
 const tax=model.compileHubQuotationSchema(noEnum,base).fields.find(field=>field.id==='taxType');assert.equal(tax.type,'text');assert.equal(tax.choices,undefined);assert.equal(tax.min,undefined);assert.equal(tax.integer,undefined);
 for(const change of [raw=>{raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.maxItems=2;},raw=>{raw.properties.productPage.if={};},raw=>{raw.properties.productPage.properties.basicAttributes.properties.brand.pattern='[a-z]';},raw=>{raw.properties.productPage.properties.basicAttributes.properties.brand.oneOf=[];}]){
  const unsupported=quotes.getQuotationSchema(snap.categoryId,schemaPath,modify(snap,change));assert.equal(unsupported.status,'unconfirmed');assert.ok(unsupported.unsupportedFields.length);
 }
});

// Synthetic JSON Schema contract; no captured official form is claimed to use
// compound object choices. Independent scalar choices cannot enforce a pair.
function compoundSnapshot(company,keyword,scope=['productPage','careChoice']) {
 const snapshot={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1'};
 return modify(snapshot,raw=>{
  raw.required=['productPage','legalPage'];raw.properties.productPage.required=['careChoice'];
  raw.properties.productPage.properties.careChoice={type:'object',required:['method','material'],properties:{
   method:{type:'string',title:'관리 방식',enum:['물세탁','드라이'],default:'드라이'},
   material:{type:'string',title:'전용 재질',enum:['면','울'],default:'울'},
   note:{type:'string',title:'사용자 메모',default:'원본 기본값'},
  }};
  if(keyword){
   const choices=[{method:'물세탁',material:'면'},{method:'드라이',material:'울'}];
   let target=raw;for(const key of scope)target=target.properties[key];
   target[keyword]=keyword==='enum'?choices:choices[0];
  }
 });
}

test('root, page and nested object enum/const constraints remain unsupported without losing scalar fields',()=>{
 for(const company of schemaCompanies){
  const baseline=compoundSnapshot(company),expected=quotes.getQuotationSchema(baseline.categoryId,schemaPath,baseline);
  assert.equal(expected.status,'observed');
  for(const keyword of ['enum','const'])for(const scope of [[],['productPage'],['productPage','careChoice']]){
   const snapshot=compoundSnapshot(company,keyword,scope),before=JSON.stringify(snapshot),schema=quotes.getQuotationSchema(snapshot.categoryId,schemaPath,snapshot);
   assert.equal(schema.status,'unconfirmed',`${company.code}/${keyword}/${scope.join('/')||'root'}`);
   assert.ok(schema.unsupportedFields.includes(scope.join(' / ')||'schema'));
   assert.deepEqual(plain(schema.fields),plain(expected.fields),'unsupported compound rules never infer or remove scalar choices/defaults');
   assert.equal(JSON.stringify(snapshot),before);
  }
 }
});

test('named array aggregate and contains enum/const cannot confirm values outside their whole-structure choices',()=>{
 for(const company of schemaCompanies){
  const baseline=hubSchemaSnapshot(company),expected=quotes.getQuotationSchema(baseline.categoryId,schemaPath,baseline);
  assert.equal(expected.status,'observed');
  for(const scope of ['array','contains'])for(const keyword of ['enum','const']){
   const snapshot=modify(baseline,raw=>{
    const array=raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes;
    const allowed=scope==='array'?[{name:'색상',value:'허용된 색상'},{name:'렌즈 유형',value:'UV'}]:{name:'색상',value:'허용된 색상'};
    (scope==='array'?array:array.allOf[0].contains)[keyword]=keyword==='enum'?[allowed]:allowed;
   });
   const before=JSON.stringify(snapshot),schema=quotes.getQuotationSchema(snapshot.categoryId,schemaPath,snapshot),field=schema.fields.find(field=>field.label==='색상');
   const originalPath='productPage / commonAttributes / exposedAttributes'+(scope==='contains'?' / allOf / 0 / contains':'');
   assert.equal(schema.status,'unconfirmed',`${company.code}/${scope}/${keyword}`);assert.ok(schema.unsupportedFields.includes(originalPath));
   assert.deepEqual(plain(schema.fields),plain(expected.fields),'ordinary named-array item enums/defaults and editable IDs are retained');
   const changes=quotes.validateQuotationChanges([{optionId:null,fieldKey:field.id,value:'금지된 색상'}],{schema,optionIds:[]});
   const input={categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,product:{id:'p',title:'상품',image_keys:'[]',pricing_policy:JSON.stringify(h.settings)},content:h.load('app/product-content.ts').emptyProductContent('p'),settings:h.settings,options:h.load('app/product-options.ts').emptyProductOptions('p'),overrides:quotes.applyQuotationChanges(quotes.emptyQuotationOverrides(),changes)};
   const resolved=quotes.resolveQuotationFields(input),review=h.load('app/submission-review.ts').inspectSubmission(resolved,[]);
   assert.equal(resolved.rows[0].fields[field.id].value,'금지된 색상','unsupported constraints do not infer a replacement value');
   assert.deepEqual(plain(resolved.rows[0].fields[field.id].validationIssues),[],'the scalar string alone remains valid');
   assert.ok(review.issues.some(issue=>issue.kind==='error'&&issue.code==='SCHEMA_UNCONFIRMED'));
   assert.ok(review.issues.some(issue=>issue.kind==='error'&&issue.code==='QUOTATION_CONSTRAINT'&&issue.message.includes(originalPath)));
   assert.equal(JSON.stringify(snapshot),before);
  }
 }
});

test('ordinary nested scalar enums/defaults and named array defaults remain supported and manual blanks retain priority',()=>{
 const snapshot=compoundSnapshot(schemaCompanies[0]),schema=quotes.getQuotationSchema(snapshot.categoryId,schemaPath,snapshot);
 const find=label=>schema.fields.find(field=>field.label===label),method=find('관리 방식'),material=find('전용 재질'),note=find('사용자 메모');
 assert.equal(schema.status,'observed');assert.deepEqual(plain(schema.unsupportedFields),[]);
 assert.deepEqual(plain(method.choices),[{value:'물세탁',label:'물세탁'},{value:'드라이',label:'드라이'}]);
 assert.equal(method.schemaDefault,'드라이');assert.equal(method.draftDefault,'물세탁');assert.equal(material.draftDefault,'면');assert.equal(note.schemaDefault,'원본 기본값');
 assert.equal(find('렌즈 유형').draftDefault,'');assert.equal(find('표면 처리').draftDefault,'');
 const input={categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,product:{id:'p',title:'상품',image_keys:'[]',pricing_policy:JSON.stringify(h.settings)},content:h.load('app/product-content.ts').emptyProductContent('p'),settings:h.settings,options:h.load('app/product-options.ts').emptyProductOptions('p')};
 const before=JSON.stringify(input),initial=quotes.resolveQuotationFields(input).rows[0];
 assert.equal(initial.fields[method.id].value,'물세탁');assert.equal(initial.fields[method.id].source,'couplus-default');assert.equal(initial.fields[note.id].value,'원본 기본값');
 const cleared=quotes.resolveQuotationFields({...input,overrides:{common:{[method.id]:'',[note.id]:''},options:{}}}).rows[0];
 assert.equal(cleared.fields[method.id].value,'');assert.equal(cleared.fields[method.id].source,'manual-common');assert.equal(cleared.fields[note.id].value,'');assert.equal(cleared.fields[note.id].source,'manual-common');
 assert.ok(cleared.fields[method.id].validationIssues.some(message=>message.includes('필수')),'a saved blank never disables the ordinary required-field check');
 assert.equal(JSON.stringify(input),before);
});

for(const company of schemaCompanies)for(const keyword of ['enum','const'])test(`unsupported compound ${keyword} survives profile/intake/manual review and blocks transmission readiness (${company.code})`,async()=>{
 const local=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snapshot=compoundSnapshot(company,keyword),schema=local.load('app/quotation-schema.ts').getQuotationSchema(snapshot.categoryId,schemaPath,snapshot),labels=['관리 방식','전용 재질','사용자 메모'];
  const fields=labels.map(label=>schema.fields.find(field=>field.label===label));
  const bytes=quotationWorkbook(labels),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=`owner/category-templates/${sha256}.xlsx`;
  await local.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'},httpMetadata:{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  const input={name:'복합 객체 조건 회귀',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:{name:'test.xlsx',format:'xlsx',sheetName:'견적서',headerRow:1,dataStartRow:2,headers:labels,sha256,storageKey},mappings:fields.map((field,column)=>({column,field:field.id,required:field.required}))};
  const post=await local.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
  assert.equal(post.status,201,await post.clone().text());const {profile}=await post.json();
  local.context.category=profile;local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');assert.match(await local.intake(),/상품 초안 저장됨/);
  const product=local.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  let view=await(await local.route(base+'/quotation-fields')).json();
  assert.equal(view.resolved.schema.status,'unconfirmed');assert.ok(view.resolved.schema.unsupportedFields.includes('productPage / careChoice'));
  const selected=view.resolved.rows.find(row=>row.included),changes=[{optionId:null,fieldKey:fields[0].id,value:'물세탁'},{optionId:null,fieldKey:fields[1].id,value:'울'},{optionId:selected.optionId,fieldKey:fields[2].id,value:''}];
  const put=await local.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}});assert.equal(put.status,200,await put.clone().text());
  view=await(await local.route(base+'/quotation-fields')).json();
  const current=view.resolved.rows.find(row=>row.optionId===selected.optionId);assert.deepEqual(fields.slice(0,2).map(field=>current.fields[field.id].value),['물세탁','울']);
  assert.equal(current.fields[fields[2].id].value,'');assert.equal(current.fields[fields[2].id].source,'manual-option');assert.equal(view.resolved.rows.find(row=>row.included&&row.optionId!==selected.optionId).fields[fields[2].id].value,'원본 기본값');
  const retained=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','collection_context','category_profiles'].map(table=>local.sqlite.prepare('SELECT * FROM '+table).all())),before=retained();
  const previewResponse=await local.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}});assert.equal(previewResponse.status,200,await previewResponse.clone().text());const preview=await previewResponse.json();
  assert.ok(preview.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.code==='SCHEMA_UNCONFIRMED'));
  assert.ok(preview.submissionReview.issues.some(issue=>issue.kind==='error'&&issue.code==='QUOTATION_CONSTRAINT'&&issue.message.includes('productPage / careChoice')));
  assert.deepEqual(preview.rows[0],['물세탁','울','']);assert.deepEqual(preview.rows[1],['물세탁','울','원본 기본값']);
  const exportResponse=await local.route(base+'/quotation',{method:'POST',body:{action:'export',profileId:profile.id,fingerprint:preview.fingerprint}});assert.equal(exportResponse.status,200,await exportResponse.clone().text());
  const packageBytes=new Uint8Array(await exportResponse.arrayBuffer()),archive=readPackageZip(packageBytes),review=JSON.parse(new TextDecoder().decode(archive.get('submission-review.json')));
  assert.ok(review.issues.some(issue=>issue.kind==='error'&&issue.code==='SCHEMA_UNCONFIRMED'));await assert.rejects(prepareAttachments(packageBytes),/수정이 필요한 오류/);
  const reader=local.load('app/xlsx-template.ts'),output=reader.inspectXlsxArchive(await reader.readXlsxArchive(archive.get(preview.filename).slice().buffer));
  assert.deepEqual(plain(reader.xlsxHeaders(output,'견적서',2)),['물세탁','울','']);assert.deepEqual(plain(reader.xlsxHeaders(output,'견적서',3)),['물세탁','울','원본 기본값']);
  assert.deepEqual(Buffer.from(local.objects.get(storageKey)),Buffer.from(bytes));assert.equal(retained(),before);assert.equal(product.supplier_hub_status,'미전송');assert.ok(!local.network.includes('supplier.coupang.com'));
 }finally{local.close();}
});
function schemaPage(snapshot,{body,after,path='/qvt/registration',response}={}){
 const calls=[],document={body:{innerText:'Company Code: '+snapshot.company.code}},location={origin:'https://supplier.coupang.com',pathname:path};
 return {calls,run:()=>vm.runInNewContext(`(${readSupplierHubSchema.toString()})(categoryId,path,company)`,{categoryId:snapshot.categoryId,path:snapshot.categoryPath,company:snapshot.company,location,document,Date,setTimeout,clearTimeout,AbortController,TextEncoder,TextDecoder,Uint8Array,fetch:async(url,init)=>{calls.push({url,...init});const result=response?response(url):Response.json(body??{schemaString:snapshot.schemaString,...snapshot.metadata});Object.defineProperty(result,'url',{value:url});after?.(document,location);return result;}})};
}
test('schema GET uses exact leaf display code in existing approved company page, bounded JSON and no writes',async()=>{
 for(const company of schemaCompanies){const snap=hubSchemaSnapshot(company),p=schemaPage(snap),result=await p.run();assert.equal(result.categoryId,snap.categoryId);assert.deepEqual(plain(result.company),company);assert.equal(result.schemaString,snap.schemaString);assert.equal(result.metadata.kanCategoryId,3000);
  assert.equal(p.calls.length,1);assert.equal(p.calls[0].url,'https://supplier.coupang.com/sr/schema/api/get-default-schemaform?internalDisplayCode=991234&useCustomizedJsonSchema=true');assert.equal(p.calls[0].method,'GET');assert.equal(p.calls[0].body,undefined);assert.equal(p.calls[0].redirect,'error');assert.equal(p.calls[0].credentials,'same-origin');
 }
});
test('login HTML, failed/oversized responses and company/navigation changes never save a detailed schema',async()=>{
 const snap=hubSchemaSnapshot();
 for(const config of [{path:'/settings'},{after:doc=>{doc.body.innerText='Company Code: A01526306';}},{after:(_doc,location)=>{location.pathname='/login';}},{body:{schemaString:snap.schemaString,displayCategoryCode:'991235'}},{body:{schemaString:'{}'}},{response:()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}})},{response:()=>Response.json({},{status:401})},{response:()=>new Response('x'.repeat(512*1024+1),{headers:{'content-type':'application/json'}})}])await assert.rejects(schemaPage(snap,config).run());
});
test('extension schema dispatcher verifies current leaf and member in the same Chrome window before returning raw schema',async()=>{
 const parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:'991234',name:schemaPath[1],isLeaf:true};
 for(const company of schemaCompanies){let failLeaf=false,changedMember=false;const calls=[],snap=hubSchemaSnapshot(company),sender={url:'http://localhost:3000/',frameId:0,tab:{id:1,windowId:7}};
  const api={tabs:{get:async id=>({id,windowId:7,url:id===1?sender.url:'https://supplier.coupang.com/qvt/registration'}),query:async query=>{assert.equal(query.windowId,7);return[{id:2,windowId:7,url:'https://supplier.coupang.com/qvt/registration'}];},sendMessage:async()=>({ok:true,ownerId:changedMember&&calls.includes('readSupplierHubSchema')?'other':'owner',company})},scripting:{executeScript:async({func,target,args})=>{assert.equal(target.tabId,2);calls.push(func.name);return[{result:func.name==='verifySupplierHubCompany'?{code:company.code}:func.name==='readSupplierHubSchema'?(assert.deepEqual(args,[snap.categoryId,schemaPath,company]),snap):{source:'supplier-hub-category-api',company,trail:[parent],children:[{...leaf,isLeaf:!failLeaf}],observedAt:Date.now(),fullCatalogVerified:false}}];}}};
  const message={type:'YOOFAM_READ_CATEGORY_SCHEMA',trail:[parent],selection:{categoryId:leaf.categoryId,name:leaf.name}};
  assert.equal((await readAppSupplierHubCatalog(message,sender,api)).schema.schemaString,snap.schemaString);assert.deepEqual(calls,['verifySupplierHubCompany','readSupplierHubCategoryBranch','readSupplierHubSchema']);
  calls.length=0;failLeaf=true;await assert.rejects(readAppSupplierHubCatalog(message,sender,api));assert.ok(!calls.includes('readSupplierHubSchema'));
  calls.length=0;failLeaf=false;changedMember=true;await assert.rejects(readAppSupplierHubCatalog(message,sender,api));
 }
});
test('app detailed schema loader verifies capability, owner, leaf, full path and returned company',async()=>{
 const snapshot=hubSchemaSnapshot(),parent={categoryId:'100',name:schemaPath[0],isLeaf:false},leaf={categoryId:snapshot.categoryId,name:schemaPath[1],isLeaf:true},calls=[];let capability=true;
 let branch={source:'supplier-hub-category-api',ownerId:'owner',company:snapshot.company,trail:[parent],children:[leaf],observedAt:Date.now(),fullCatalogVerified:false,schema:snapshot};
 const client={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-catalog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:client,Date,Error,require:name=>name==='@/app/supplier-hub-schema'?model:{exchange:async(type,payload,signal)=>{if(signal.aborted)throw Error('aborted');calls.push({type,payload:plain(payload)});return type==='PING'?{categorySchema:capability}:{branch};}}});
 const choice=client.hubCategoryChoice(branch,leaf),signal=new AbortController().signal;
 const captured=await client.loadLiveHubCategorySchema(choice,signal);assert.equal(captured.schemaString,snapshot.schemaString);assert.equal(captured.draftInitialization,'couplus-required-v1');assert.equal(captured.inputBindings,'couplus-paths-v1');assert.equal(captured.settingsInitialization,'couplus-options-v1');assert.equal(snapshot.draftInitialization,undefined);assert.equal(snapshot.inputBindings,undefined);assert.equal(snapshot.settingsInitialization,undefined);assert.deepEqual(calls.map(call=>call.type),['PING','SCHEMA']);assert.deepEqual(calls[1].payload,{trail:[parent],selection:{categoryId:leaf.categoryId,name:leaf.name}});
 assert.equal(captured.nativeSerializationPolicy,'supplier-hub-native-required-form-v1');assert.equal(Object.hasOwn(snapshot,'nativeSerializationPolicy'),false);
 const original=branch;for(const change of [{ownerId:'other'},{children:[{...leaf,name:'other'}]},{schema:{...snapshot,company:schemaCompanies[1]}},{schema:{...snapshot,categoryPath:['other']}},{schema:{...snapshot,categoryId:'991235'}}]){branch={...original,...change};await assert.rejects(client.loadLiveHubCategorySchema(choice,signal));}
 branch=original;capability=false;calls.length=0;await assert.rejects(client.loadLiveHubCategorySchema(choice,signal));assert.deepEqual(calls.map(call=>call.type),['PING']);
 await assert.rejects(client.loadLiveHubCategorySchema(choice,AbortSignal.abort()));
});
test('new category schema links URL draft, defaults, manual blanks, Excel values and frozen capture for both companies',async()=>{
 for(const company of schemaCompanies){const local=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const snap=hubSchemaSnapshot(company),input={name:'시험 최종분류',categoryId:snap.categoryId,categoryPath:schemaPath,template:null,mappings:[],hubSchema:snap},api=local.load('app/api/category-profiles/route.ts');
  const post=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(input)}));assert.equal(post.status,201,await post.clone().text());const {profile}=await post.json();
  const wrong=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,hubSchema:hubSchemaSnapshot(schemaCompanies.find(item=>item.code!==company.code))})}));assert.equal(wrong.status,400);
  local.context.category=profile;local.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(local.context),'job');assert.match(await local.intake(),/상품 초안 저장됨/);
  const product=local.sqlite.prepare('SELECT * FROM products').get(),path='/api/products/'+product.id+'/quotation-fields',view=await(await local.route(path)).json(),schema=view.resolved.schema;
  const hidden=schema.fields.find(field=>field.label==='표면 처리'),lens=schema.fields.find(field=>field.label==='렌즈 유형'),notice=schema.fields.find(field=>field.label==='렌즈 관리방법');
  const color=schema.fields.find(field=>field.label==='색상'),optionRow=view.resolved.rows.find(row=>row.optionId!==null);assert.equal(optionRow.fields[color.id].source,'option');assert.ok(optionRow.fields[color.id].value);
  assert.equal(view.resolved.rows.filter(row=>row.optionId!==null).length,6);assert.equal(view.resolved.rows[0].fields[hidden.id].source,'couplus-default');assert.equal(view.resolved.rows[0].fields[notice.id].value,'해당사항없음');assert.equal(view.resolved.rows[0].fields.taxType.value,'과세');
  const put=await local.route(path,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{fieldKey:lens.id,optionId:null,value:'UV'},{fieldKey:notice.id,optionId:null,value:''},{fieldKey:'title',optionId:null,value:'사용자 검토 상품명'}]}});assert.equal(put.status,200,await put.clone().text());
  const saved=await local.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,profile.id),resolved=local.load('app/exports/quotation-source.ts').resolveQuotationExport(saved),rows=local.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved,resolved,[]);
  assert.equal(rows[0][lens.id],'UV');assert.equal(rows[0][notice.id],'');assert.equal(rows[0].title,'사용자 검토 상품명');
  const next=modify(snap,raw=>{raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[1].contains.properties.value.enum=[null,'NEW'];});
  const update=await api.PUT(new Request('https://app.test/api/category-profiles',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({id:profile.id,expectedRevision:profile.revision,profile:{...input,hubSchema:next}})}));assert.equal(update.status,409,await update.clone().text());
  const replacement=await api.POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,hubSchema:next})}));assert.equal(replacement.status,201,await replacement.clone().text());
  const replacementProfile=(await replacement.json()).profile;assert.notEqual(replacementProfile.id,profile.id);assert.equal(replacementProfile.hubSchema.schemaString,next.schemaString);
  await assert.rejects(local.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,replacementProfile.id),error=>error.status===409,'a new form cannot silently retarget the original URL draft');
  const unchanged=await(await local.route(path)).json();assert.deepEqual(unchanged.resolved.schema.fields.find(field=>field.id===lens.id).choices,lens.choices);assert.equal(unchanged.resolved.rows[0].fields[lens.id].value,'UV');assert.equal(unchanged.resolved.rows[0].fields[notice.id].source,'manual-common');
  const frozen=await local.load('app/exports/quotation-source.ts').readQuotationExportSource('owner',product.id,profile.id);assert.equal(frozen.hubSchema.schemaString,snap.schemaString);assert.ok(!local.network.includes('supplier.coupang.com'));
  const mapped=await local.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',product.id,profile.id);assert.equal(mapped.profile.hubSchema.schemaString,snap.schemaString);
  const headers=['렌즈 유형','렌즈 관리방법'],originalBytes=new TextEncoder().encode(headers.join(',')+'\n').buffer,sha256=Buffer.from(await crypto.subtle.digest('SHA-256',originalBytes)).toString('hex');
  const csvProfile={...mapped.profile,template:{name:'test.csv',format:'csv',sheetName:'',headerRow:1,headers,sha256,storageKey:'owner/category-templates/test.csv'},mappings:[{column:0,field:lens.id,required:true,choiceFormat:'label'},{column:1,field:notice.id,required:false}]};
  const output=await local.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes,profile:csvProfile,rows,dataStartRow:2});assert.equal(output.values[0][0],'UV');assert.equal(output.values[0][1],'');
 }finally{local.close();}}
});
test('dynamic Excel mappings use exact unique labels and reject foreign or unknown category fields',()=>{
 const snap=hubSchemaSnapshot(),schema=quotes.getQuotationSchema(snap.categoryId,schemaPath,snap),lens=schema.fields.find(field=>field.label==='렌즈 유형'),profiles=h.load('app/category-profiles.ts'),mappings={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/quotation-mapping.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mappings,require:name=>name==='./category-profiles'?profiles:quotes});
 const proposal=mappings.suggestQuotationMappings(['렌즈 유형','렌즈 관리방법'],snap.categoryId,null,snap);assert.equal(proposal.mappings[0].field,lens.id);
 const input={name:'시험분류',categoryId:snap.categoryId,categoryPath:schemaPath,hubSchema:snap,template:{name:'test.csv',format:'csv',sheetName:'',headerRow:1,headers:['렌즈 유형','렌즈 관리방법'],sha256:'a'.repeat(64),storageKey:'owner/category-templates/test.csv'},mappings:plain(proposal.mappings)};
 assert.equal(profiles.validateCategoryProfile(input).mappings[0].field,lens.id);
 assert.throws(()=>profiles.validateCategoryProfile({...input,mappings:[{column:0,field:lens.id.replace('991234','991235'),required:false}]}));assert.throws(()=>profiles.validateCategoryProfile({...input,mappings:[{column:0,field:'live_991234_unknown',required:false}]}));
 assert.deepEqual(plain(mappings.suggestQuotationMappings(['렌즈 유형','렌즈 유형'],snap.categoryId,null,snap).ambiguousColumns),[0,1]);
});
