import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';

const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const originalPath=new URL('../outputs/step573-official-sunglasses.zip',import.meta.url),schemaPath=new URL('../outputs/step573-live-69900-schema.json',import.meta.url);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
function snapshot(company,actual){return{format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath,company,observedAt:Date.now(),draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1',inputBindings:'couplus-paths-v1',
 metadata:{displayCategoryCode:'69900',kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},
 // Sanitized observed wire fragment for CI; no source fact is invented here.
 schemaString:actual?fs.readFileSync(schemaPath,'utf8'):JSON.stringify({type:'object',properties:{productPage:{type:'object',properties:{}},legalPage:{type:'object',properties:{}},startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'},categoryPath:{type:'string',title:'카테고리'}}},logisticsPage:{type:'object',required:['skuUnitBoxWeight','skuUnitBoxDimension'],properties:{skuUnitBoxWeight:{type:'string',title:'한 개 단품 포장 무게',minLength:1},skuUnitBoxDimension:{type:'string',title:'한 개 단품 포장 사이즈',minLength:1}}}}})};}
async function fixture(company,actual=false){
 let providerCalls=0;const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:()=>{providerCalls++;return new Response('',{status:429});}});
 try{
  const hubSchema=snapshot(company,actual),schema=h.load('app/quotation-schema.ts').getQuotationSchema('69900',categoryPath,hubSchema),wire=schema.fields.find(field=>field.hubInput==='packagedWeightG'&&field.numericText);
  assert.ok(wire);let connected;
  if(actual){
   const reader=h.load('app/xlsx-template.ts'),zip=fs.readFileSync(originalPath),bytes=await reader.unwrapOfficialXlsxDownload(zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength)),form=new FormData();
   form.set('file',new File([bytes],'official.xlsx'));form.set('schema',JSON.stringify(hubSchema));form.set('action','workbook');
   connected=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
  }else{
   const headers=['title','category',wire.id,'packagedDimensionsMm'],bytes=quotationWorkbook(headers),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
   await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});connected={template:{name:'synthetic-weight.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:true}))};
  }
  const profile=(await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'포장 무게 검토',categoryId:'69900',categoryPath,hubSchema,template:connected.template,mappings:connected.mappings})})),201)).profile;
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';
  const intake=await h.intake();assert.match(intake,/번역 미완료/);assert.match(intake,/HTTP 429/);assert.equal(providerCalls,1);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields';
  const retained=()=>JSON.stringify(['product_options','product_content','product_price_policy','collection_results','collection_context'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
  const before=retained();let view=await json(await h.route(endpoint));
  const save=async changes=>view=await json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  const preview=()=>h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}).then(json);
  const checkWorkbook=async expected=>{
   const result=await preview(),download=await h.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:result.fingerprint}});assert.equal(download.status,200,await download.clone().text());
   const reader=h.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(await download.arrayBuffer())),column=profile.mappings.find(mapping=>mapping.field===wire.id).column;
   assert.deepEqual(expected.map((_,index)=>reader.xlsxHeaders(sheet,profile.template.sheetName,(actual?9:2)+index)[column]),expected);
   return result;
  };
  return{h,profile,wire,product,base,endpoint,save,preview,checkWorkbook,get view(){return view;},set view(next){view=next;},retained,before,get providerCalls(){return providerCalls;}};
 }catch(error){h.close();throw error;}
}
const pair=(view,optionId,wire)=>['packagedWeightG',wire.id].map(id=>view.resolved.rows.find(row=>row.optionId===optionId).fields[id].value);
const weightIssues=(preview,wire)=>preview.submissionReview.issues.filter(issue=>['packagedWeightG',wire.id].includes(issue.fieldId)&&['FIELD_INVALID','EXCEL_FIELD_UNMAPPED','EXCEL_REQUIRED_MISSING'].includes(issue.code));

for(const [companyIndex,company]of companies.entries())test(`stage-seven weight edits, explicit blanks and resets agree before/after save and XLSX (${company.code})`,async()=>{
 const f=await fixture(company);const {h,wire}=f;let ui;
 try{
  const open=()=>quotationLabelFormUI({productId:f.product.id,load:h.load,request:(path,init={})=>h.route(path,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})}),renderDocument:()=>assert.fail('weight editing must not render an image')});
  ui=open();await ui.idle();ui.selectOption('');
  const entry=companyIndex?wire.id:'packagedWeightG',peer=companyIndex?'packagedWeightG':wire.id;
  ui.field(entry).props.onChange({target:{value:'420'}});ui.field('packagedDimensionsMm').props.onChange({target:{value:'160*70*50'}});
  assert.equal(ui.field(peer).props.value,'420','the unsaved sibling input must show the exact effective weight');
  const fieldBox=id=>nodes(ui.render().tree).find(node=>node.props?.className?.startsWith('quotation-field ')&&nodes(node).some(child=>child.props?.id?.endsWith('-'+id)));
  assert.match(text(fieldBox(peer)),/공통 직접 수정/);assert.ok(nodes(fieldBox(peer)).some(node=>node.type==='button'&&text(node).startsWith('수정 해제')),'an explicit paired edit stages its own peer override and exact per-field reset');
  await ui.click('견적 입력 저장');f.view=ui.view;assert.deepEqual(pair(f.view,null,wire),['420','420']);assert.equal(f.view.overrides.common[peer],'420');
  assert.deepEqual(weightIssues(await f.checkWorkbook(Array(6).fill('420')),wire),[]);
  const optionIds=f.view.resolved.rows.filter(row=>row.included).map(row=>row.optionId);ui.close();ui=null;
  // Layers are option before common, even when the option belongs to the peer.
  await f.save([{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:wire.id,optionId:null,value:'500'},
   {fieldKey:'packagedWeightG',optionId:optionIds[0],value:''},{fieldKey:wire.id,optionId:optionIds[1],value:'550'},
   {fieldKey:'packagedWeightG',optionId:optionIds[2],value:'600'},{fieldKey:wire.id,optionId:optionIds[2],value:'610'}]);
  assert.deepEqual(pair(f.view,optionIds[0],wire),['',''],'own option blank wins over a populated peer common value');
  assert.deepEqual(pair(f.view,optionIds[1],wire),['550','550'],'peer option wins over own common value');
  assert.deepEqual(pair(f.view,optionIds[2],wire),['600','610'],'different values at the same layer remain separate');
  assert.deepEqual(pair(f.view,optionIds[3],wire),['420','500']);
  const conflicted=await f.checkWorkbook(['','550','610','500','500','500']);assert.ok(weightIssues(conflicted,wire).some(issue=>issue.code==='EXCEL_FIELD_UNMAPPED'));assert.ok(weightIssues(conflicted,wire).some(issue=>issue.code==='FIELD_INVALID'));
  // Reset only a real stored entry. The UI explains the actual restored value,
  // including a peer option, instead of presenting the stale automatic blank.
  ui=open();await ui.idle();ui.selectOption(optionIds[2]);
  assert.match(text(fieldBox('packagedWeightG')),/수정 해제 후.*610/);
  nodes(fieldBox('packagedWeightG')).find(node=>node.type==='button'&&text(node).startsWith('수정 해제')).props.onClick();
  assert.equal(ui.field('packagedWeightG').props.value,'610');assert.equal(ui.field(wire.id).props.value,'610');
  assert.ok(!nodes(fieldBox('packagedWeightG')).some(node=>node.type==='button'&&text(node).startsWith('수정 해제')));
  await ui.click('견적 입력 저장');f.view=ui.view;assert.deepEqual(pair(f.view,optionIds[2],wire),['610','610']);assert.equal(Object.hasOwn(f.view.overrides.options[optionIds[2]],'packagedWeightG'),false);ui.close();ui=null;
  await f.save([{fieldKey:wire.id,optionId:null,value:null},{fieldKey:'packagedWeightG',optionId:optionIds[0],value:null}]);
  assert.deepEqual(pair(f.view,optionIds[0],wire),['420','420']);assert.deepEqual(pair(f.view,optionIds[1],wire),['550','550']);assert.equal(Object.hasOwn(f.view.overrides.common,wire.id),false);
  assert.deepEqual(weightIssues(await f.checkWorkbook(['420','550','610','420','420','420']),wire),[]);
  assert.equal(f.retained(),f.before);assert.equal(f.providerCalls,1);
 }finally{ui?.close();h.close();}
});

test('packaged weight resolution requires one exact editable g pair and leaves prices and ambiguous paths alone',()=>{
 const h=mobileIntakeHarness();try{
  const fields=plain(h.load('app/quotation-schema.ts').getQuotationSchema('69900',categoryPath,snapshot(companies[0])).fields),wire=fields.find(field=>field.hubInput==='packagedWeightG'&&field.numericText);
  const helper=h.load('app/quotation-packaged-weight.ts');let reads=0;
  const read=(option,id)=>{reads++;return option===null&&id==='packagedWeightG'?'420':null;};
  assert.equal(helper.quotationPackagedWeightManual(fields,wire.id,null,read).value,'420');
  for(const mutate of [
   copy=>copy.push({...copy.find(field=>field.id===wire.id),id:'ambiguous-wire'}),
   copy=>copy.find(field=>field.id===wire.id).hubWire.path=['logisticsPage','otherWeight'],
   copy=>copy.find(field=>field.id===wire.id).hubWire.name='한 개 단품 포장 무게',
   copy=>copy.find(field=>field.id===wire.id).unit='kg',
   copy=>copy.find(field=>field.id===wire.id).numericText=undefined,
   copy=>copy.find(field=>field.id==='packagedWeightG').readOnly=true,
  ]){const changed=plain(fields);mutate(changed);reads=0;assert.equal(helper.quotationPackagedWeightManual(changed,wire.id,null,read),null);assert.equal(reads,0);}
  reads=0;assert.equal(helper.quotationPackagedWeightManual(fields,'supplyPrice',null,read),null);assert.equal(reads,0);
 }finally{h.close();}
});

test('explicit g-weight plan pairs literal values and blanks but keeps exact staged null resets and ambiguous weights independent',()=>{
 const h=mobileIntakeHarness();try{
  const fields=plain(h.load('app/quotation-schema.ts').getQuotationSchema('69900',categoryPath,snapshot(companies[0])).fields),wire=fields.find(field=>field.hubInput==='packagedWeightG'&&field.numericText),helper=h.load('app/quotation-packaged-weight.ts');
  for(const fieldKey of ['packagedWeightG',wire.id])for(const value of ['420','']){
   const result=helper.quotationPackagedWeightEditChanges(fields,[{optionId:'selected',fieldKey,value}]);
   assert.deepEqual(plain(result),[{optionId:'selected',fieldKey,value},{optionId:'selected',fieldKey:fieldKey==='packagedWeightG'?wire.id:'packagedWeightG',value}]);
  }
  const reset=[{optionId:'selected',fieldKey:'packagedWeightG',value:null},{optionId:'selected',fieldKey:wire.id,value:'420'}];
  assert.deepEqual(plain(helper.quotationPackagedWeightEditChanges(fields,reset)),reset);
  assert.deepEqual(Array.from(helper.quotationPackagedWeightEditFields(fields,'packagedWeightG',null)),['packagedWeightG']);
  assert.throws(()=>helper.quotationPackagedWeightEditChanges(fields,[{optionId:null,fieldKey:'packagedWeightG',value:'420'},{optionId:null,fieldKey:wire.id,value:'610'}]),/연결된 포장 무게/);
  for(const mutate of [copy=>copy.find(field=>field.id===wire.id).unit='kg',copy=>copy.push({...copy.find(field=>field.id===wire.id),id:'ambiguous-weight'}),copy=>copy.find(field=>field.id===wire.id).hubWire.path=['logisticsPage','otherWeight']]){
   const copy=plain(fields);mutate(copy);assert.deepEqual(plain(helper.quotationPackagedWeightEditChanges(copy,[{optionId:null,fieldKey:'packagedWeightG',value:'420'}])),[{optionId:null,fieldKey:'packagedWeightG',value:'420'}]);
  }
 }finally{h.close();}
});

for(const company of companies)test(`explicit selected weight/blank and copy-to-all reconcile conflicting peers without changing excluded rows (${company.code})`,async()=>{
 const f=await fixture(company);let ui;try{
  const ids=f.view.resolved.rows.filter(row=>row.included).map(row=>row.optionId),{wire,h}=f;
  await f.save([{optionId:null,fieldKey:'packagedWeightG',value:'400'},{optionId:null,fieldKey:wire.id,value:'500'},{optionId:null,fieldKey:'packagedDimensionsMm',value:'160*70*50'},
   ...ids.flatMap((optionId,index)=>[{optionId,fieldKey:'packagedWeightG',value:String(600+index*20)},{optionId,fieldKey:wire.id,value:String(610+index*20)}])]);
  const options=await json(await h.route(f.base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);rows.at(-1).included=false;
  await json(await h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  f.view=await json(await h.route(f.endpoint));const sources=f.retained(),before=plain(f.view.overrides),excluded=plain(before.options[ids.at(-1)]);
  const writes=[];ui=quotationLabelFormUI({productId:f.product.id,load:h.load,request:(path,init={})=>{if(init.method==='PUT')writes.push(JSON.parse(init.body));return h.route(path,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});},renderDocument:()=>assert.fail('packaging edits never render an image')});
  await ui.idle();ui.selectOption(ids[0]);ui.field('packagedWeightG').props.onChange({target:{value:'420'}});
  assert.equal(ui.field(wire.id).props.value,'420');await ui.click('견적 입력 저장');f.view=ui.view;
  assert.deepEqual(writes.at(-1).changes.map(change=>[change.optionId,change.fieldKey,change.value]),[[ids[0],'packagedWeightG','420'],[ids[0],wire.id,'420']]);
  assert.deepEqual(pair(f.view,ids[0],wire),['420','420']);for(const optionId of ids.slice(1))assert.deepEqual(plain(f.view.overrides.options[optionId]),before.options[optionId]);assert.deepEqual(plain(f.view.overrides.common),before.common);
  ui.field(wire.id).props.onChange({target:{value:''}});assert.equal(ui.field('packagedWeightG').props.value,'');await ui.click('견적 입력 저장');f.view=ui.view;assert.deepEqual(pair(f.view,ids[0],wire),['','']);
  const common=plain(f.view.overrides.common);ui.field('packagedWeightG').props.onChange({target:{value:'420'}});
  nodes(ui.render().tree).find(node=>node.type==='input'&&node.props.role==='switch').props.onChange({target:{checked:true}});
  await ui.click('견적 입력 저장');f.view=ui.view;
  for(const optionId of ids.slice(0,-1)){assert.deepEqual(pair(f.view,optionId,wire),['420','420']);assert.equal(f.view.overrides.options[optionId].packagedWeightG,'420');assert.equal(f.view.overrides.options[optionId][wire.id],'420');}
  assert.deepEqual(plain(f.view.overrides.options[ids.at(-1)]),excluded);assert.deepEqual(plain(f.view.overrides.common),common);
  assert.equal(writes.at(-1).changes.length,10);assert.ok(writes.at(-1).changes.every(change=>ids.slice(0,-1).includes(change.optionId)&&['packagedWeightG',wire.id].includes(change.fieldKey)));
  assert.deepEqual(weightIssues(await f.checkWorkbook(Array(5).fill('420')),wire),[]);assert.equal(f.retained(),sources);
 }finally{ui?.close();f.h.close();}
});

test('a source clock change rejects a reviewed paired weight PUT as a whole',async()=>{
 const f=await fixture(companies[0]);try{
  const old=f.view,id=old.resolved.rows.find(row=>row.included).optionId,changes=f.h.load('app/quotation-packaged-weight.ts').quotationPackagedWeightEditChanges(old.resolved.schema.fields,[{optionId:id,fieldKey:'packagedWeightG',value:'420'}]);
  const current=f.h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id);
  assert.ok(await f.h.load('db/queries.ts').updateProduct('owner',f.product.id,{title:'별도 편집자가 저장한 상품명'},current.updated_at));
  const before=JSON.stringify(['products','product_quotation_fields','product_options','product_content'].map(table=>f.h.sqlite.prepare('SELECT * FROM '+table).all()));
  const response=await f.h.route(f.endpoint,{method:'PUT',body:{expectedRevision:old.revision,expectedInputFingerprint:old.inputFingerprint,changes}});assert.equal(response.status,409,await response.clone().text());
  assert.equal(JSON.stringify(['products','product_quotation_fields','product_options','product_content'].map(table=>f.h.sqlite.prepare('SELECT * FROM '+table).all())),before);
 }finally{f.h.close();}
});

for(const company of companies)test(`field-selected copy preview stages each exact weight pair once and preserves the source/common layer (${company.code})`,async()=>{
 const f=await fixture(company);let ui;try{
  const {wire,h}=f,ids=f.view.resolved.rows.filter(row=>row.included).map(row=>row.optionId);
  await f.save([{optionId:null,fieldKey:'packagedWeightG',value:'400'},{optionId:null,fieldKey:wire.id,value:'500'},{optionId:null,fieldKey:'packagedDimensionsMm',value:'160*70*50'},
   ...ids.flatMap((optionId,index)=>[{optionId,fieldKey:'packagedWeightG',value:index?'600':'420'},{optionId,fieldKey:wire.id,value:index?'610':'420'}])]);
  const before=plain(f.view.overrides),sources=f.retained(),writes=[];
  ui=quotationLabelFormUI({productId:f.product.id,load:h.load,request:(path,init={})=>{if(init.method==='PUT')writes.push(JSON.parse(init.body));return h.route(path,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});},renderDocument:()=>assert.fail('copy preview does not render an image')});
  await ui.idle();ui.selectOption(ids[0]);
  for(const fieldKey of ['packagedWeightG',wire.id]){
   const box=nodes(ui.render().tree).find(node=>node.props?.className?.startsWith('quotation-field ')&&nodes(node).some(child=>child.props?.id?.endsWith('-'+fieldKey)));
   nodes(box).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});
  }
  await ui.click('적용 범위 미리보기');assert.equal(writes.length,0);assert.match(text(ui.render().tree),/5개 옵션.*10개 값 변경 예정/);
  await ui.click('확인한 범위에 적용');assert.equal(writes.length,0);ui.selectOption(ids[1]);assert.equal(ui.field('packagedWeightG').props.value,'420');assert.equal(ui.field(wire.id).props.value,'420');
  await ui.click('견적 입력 저장');f.view=ui.view;
  assert.equal(writes.length,1);assert.equal(writes[0].changes.length,10);assert.equal(new Set(writes[0].changes.map(change=>JSON.stringify([change.optionId,change.fieldKey]))).size,10);
  assert.deepEqual(plain(f.view.overrides.common),before.common);assert.deepEqual(plain(f.view.overrides.options[ids[0]]),before.options[ids[0]]);
  for(const optionId of ids.slice(1))assert.deepEqual(pair(f.view,optionId,wire),['420','420']);
  assert.deepEqual(weightIssues(await f.checkWorkbook(Array(6).fill('420')),wire),[]);assert.equal(f.retained(),sources);
 }finally{ui?.close();f.h.close();}
});

for(const company of companies)test(`actual original 69900 XLSX accepts either stage-seven weight input after Google 429 (${company.code})`,{skip:!fs.existsSync(originalPath)||!fs.existsSync(schemaPath)},async()=>{
 const f=await fixture(company,true);let ui;try{
  for(const entry of ['packagedWeightG',f.wire.id]){
   const peer=entry==='packagedWeightG'?f.wire.id:'packagedWeightG';
   await f.save([{fieldKey:entry,optionId:null,value:'420'},{fieldKey:peer,optionId:null,value:null},{fieldKey:'packagedDimensionsMm',optionId:null,value:'160*70*50'}]);
   const preview=await f.checkWorkbook(Array(6).fill('420'));assert.deepEqual(weightIssues(preview,f.wire),[]);
   assert.ok(preview.submissionReview.issues.some(issue=>issue.kind==='error'),'other real missing inputs still block submission');
   assert.equal(Object.hasOwn(f.view.overrides.common,peer),false);
  }
  const ids=f.view.resolved.rows.filter(row=>row.included).map(row=>row.optionId);
  await f.save(ids.flatMap((optionId,index)=>[{optionId,fieldKey:'packagedWeightG',value:String(600+index)},{optionId,fieldKey:f.wire.id,value:String(610+index)}]));
  ui=quotationLabelFormUI({productId:f.product.id,load:f.h.load,request:(path,init={})=>f.h.route(path,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})}),renderDocument:()=>assert.fail('packaging editing never translates or renders an image')});
  await ui.idle();ui.selectOption(ids[0]);ui.field(f.wire.id).props.onChange({target:{value:'420'}});
  nodes(ui.render().tree).find(node=>node.type==='input'&&node.props.role==='switch').props.onChange({target:{checked:true}});
  await ui.click('견적 입력 저장');f.view=ui.view;assert.ok(f.view.resolved.rows.filter(row=>row.included).every(row=>pair(f.view,row.optionId,f.wire).every(value=>value==='420')));
  assert.deepEqual(weightIssues(await f.checkWorkbook(Array(6).fill('420')),f.wire),[]);
  assert.equal(f.retained(),f.before);assert.equal(f.providerCalls,1);assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{ui?.close();f.h.close();}
});
