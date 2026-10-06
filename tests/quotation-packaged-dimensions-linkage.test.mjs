import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';

const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/quotation-packaged-dimensions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const {normalizePackagedDimensionsMm:normalize,isCanonicalPackagedDimensionsMm:canonical,isPackagedDimensionsMmField:bound}=exports;
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],categoryPath=['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'];
const originalPath=new URL('../outputs/step573-official-sunglasses.zip',import.meta.url),schemaPath=new URL('../outputs/step573-live-69900-schema.json',import.meta.url);
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

test('explicit integer millimetre input normalizes separators only and leaves invalid or absent facts raw',()=>{
 for(const [raw,expected] of [['160×70×50','160*70*50'],[' 160 x 70 X 50 ','160*70*50'],['\t160 * 70 * 50\n','160*70*50'],['00160×070×050','00160*070*050'],['1000000×1×2','1000000*1*2'],['160*70*50','160*70*50']]){
  assert.equal(normalize(raw),expected);assert.equal(canonical(expected),true);if(raw!==expected)assert.equal(canonical(raw),false);
 }
 for(const raw of ['', ' ', '0', '0×70×50', '160×0×50', '160×70×0','1000001×1×2','160.5×70×50','1e2×70×50','160×70','160×70×50×2','160×70×50 mm','가로160×세로70×높이50','１６０×７０×５０','160/70/50']){
  assert.equal(normalize(raw),raw);assert.equal(canonical(raw),false);
 }
});

test('only canonical mm packaging or its exact logistics wire can use normalization',()=>{
 const base={id:'packagedDimensionsMm',section:'logistics',visibility:'common',type:'text',unit:'mm',label:'한 개 단품 포장 사이즈',required:true};
 const wire={...base,id:'live_exact_dimension',hubInput:'packagedDimensionsMm',hubWire:{path:['logisticsPage','skuUnitBoxDimension']}};
 assert.equal(bound(base),true);assert.equal(bound(wire),true);
 for(const field of [{...base,id:'noticeDimensions'},{...base,section:'legal'},{...base,unit:'cm'},{...base,readOnly:true},{...wire,hubInput:'size'},
  {...wire,hubWire:{path:['logisticsPage','similarlyNamedDimension']}},{...wire,hubWire:{path:['productPage','skuUnitBoxDimension']}},
  {...wire,hubWire:{...wire.hubWire,name:'한 개 단품 포장 사이즈'}},{...wire,hubWire:{...wire.hubWire,nameKey:'name',valueKey:'value'}}])assert.equal(bound(field),false);
});

test('the real CSV encoder preserves Korean scalar text and multiplication signs outside the packaging cell',()=>{
 const pricing={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/pricing.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:pricing});
 const scalar='한글 상품, X × 160x70x50',description='한글 160x70x50 mm',rows=[[scalar,normalize('160×70×50'),description]],before=JSON.stringify(rows);
 assert.equal(pricing.quotationCsv(rows),'\uFEFF"한글 상품, X × 160x70x50","160*70*50","한글 160x70x50 mm"');assert.equal(JSON.stringify(rows),before);
});

async function fixture(company){
 let providerCalls=0;const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,translationFetcher:()=>{providerCalls++;return new Response('',{status:429});}});
 try{
  const hubSchema={format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath,company,observedAt:Date.now(),draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1',inputBindings:'couplus-paths-v1',metadata:{displayCategoryCode:'69900',kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},schemaString:fs.readFileSync(schemaPath,'utf8')};
  const reader=h.load('app/xlsx-template.ts'),zip=fs.readFileSync(originalPath),bytes=await reader.unwrapOfficialXlsxDownload(zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength)),form=new FormData();form.set('file',new File([bytes],'official.xlsx'));form.set('schema',JSON.stringify(hubSchema));form.set('action','workbook');
  const connection=await json(await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form})),201);
  const profile=(await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'합성 포장 형식 회귀',categoryId:'69900',categoryPath,hubSchema,template:connection.template,mappings:connection.mappings})})),201)).profile;
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();h.bindings.SOURCEFLOW_TEXT_PROVIDER='google-free';assert.match(await h.intake(),/HTTP 429/);assert.equal(providerCalls,1);
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,endpoint=base+'/quotation-fields';
  const get=()=>h.route(endpoint).then(json),save=async changes=>{const view=await get();return json(await h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
  const preview=()=>h.route(base+'/quotation',{method:'POST',body:{action:'preview',profileId:profile.id}}).then(json);
  const workbookRows=async()=>{const result=await preview(),response=await h.route(base+'/quotation',{method:'POST',body:{action:'download',profileId:profile.id,fingerprint:result.fingerprint}});assert.equal(response.status,200,await response.clone().text());const book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));return{result,rows:Array.from({length:6},(_,index)=>reader.xlsxHeaders(book,profile.template.sheetName,9+index))};};
  return{h,product,profile,base,endpoint,get,save,preview,workbookRows,get providerCalls(){return providerCalls;}};
 }catch(error){h.close();throw error;}
}

// The workbook and schema are recorded originals; physical values are synthetic
// boundary inputs. These tests cannot establish a real product's measurements,
// translation completion or Supplier Hub acceptance.
for(const company of companies)test(`one common seller edit normalizes all six original XLSX rows and matches numeric option PATCH (${company.code})`,{skip:!fs.existsSync(originalPath)||!fs.existsSync(schemaPath)},async()=>{
 const f=await fixture(company);let ui;
 try{
  const retained=()=>JSON.stringify(['product_options','product_content','collection_context','collection_results'].map(table=>f.h.sqlite.prepare('SELECT * FROM '+table).all())),before=retained(),view=await f.get(),definition=view.resolved.schema.fields.find(field=>field.id==='packagedDimensionsMm');
  assert.deepEqual(Array.from(definition.hubWire.path),['logisticsPage','skuUnitBoxDimension']);assert.equal(bound(definition),true);
  const rawSchema=JSON.parse(fs.readFileSync(schemaPath,'utf8'));assert.match(rawSchema.properties.logisticsPage.properties.skuUnitBoxDimension.description,/별표\(\*\)/);
  ui=quotationLabelFormUI({productId:f.product.id,load:f.h.load,request:(path,init={})=>f.h.route(path,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})}),renderDocument:()=>assert.fail('measurement entry must not generate images')});await ui.idle();ui.selectOption('');
  ui.field('packagedWeightG').props.onChange({target:{value:'420'}});ui.field('packagedDimensionsMm').props.onChange({target:{value:' 160×70 X 50 '}});
  const scalar='한글 상품, × X 160x70x50';ui.field('title').props.onChange({target:{value:scalar}});
  assert.equal(ui.field('packagedDimensionsMm').props.value,'160*70*50');assert.equal(ui.field('title').props.value,scalar);await ui.click('견적 입력 저장');
  assert.equal(ui.view.overrides.common.packagedDimensionsMm,'160*70*50');assert.ok(ui.view.resolved.rows.filter(row=>row.included).every(row=>row.fields.packagedDimensionsMm.value==='160*70*50'&&row.fields.packagedDimensionsMm.validationIssues.length===0));assert.equal(retained(),before);
  const output=await f.workbookRows(),column=f.profile.mappings.find(mapping=>mapping.field==='packagedDimensionsMm').column,titleColumn=f.profile.mappings.find(mapping=>mapping.field==='title').column;
  assert.deepEqual(output.rows.map(row=>row[column]),Array(6).fill('160*70*50'));assert.deepEqual(output.rows.map(row=>row[titleColumn]),Array(6).fill(scalar));assert.ok(output.result.submissionReview.errorCount>0,'other unverified required facts still block submission');
  // A direct client reaches the same server validator, without browser edits.
  for(const value of ['160x70x50','160X70X50','160 × 70 × 50','160 * 70 * 50'])assert.equal((await f.save([{fieldKey:'packagedDimensionsMm',optionId:null,value}])).overrides.common.packagedDimensionsMm,'160*70*50');
  const current=await json(await f.h.route(f.base+'/options')),rows=f.h.load('app/product-options.ts').optionInputs(current.options);rows.forEach(row=>Object.assign(row,{packagedWeightG:420,packagedWidthMm:160,packagedLengthMm:70,packagedHeightMm:50,packagingConfirmed:true}));
  await json(await f.h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows}}));
  await f.save([{fieldKey:'packagedDimensionsMm',optionId:null,value:null},{fieldKey:'packagedWeightG',optionId:null,value:null}]);
  const automatic=await f.workbookRows();assert.deepEqual(automatic.rows.map(row=>row[column]),Array(6).fill('160*70*50'));assert.ok((await f.get()).resolved.rows.filter(row=>row.included).every(row=>row.fields.packagedDimensionsMm.source==='option'));
  for(const value of [0,1000001]){const latest=await json(await f.h.route(f.base+'/options')),bad=f.h.load('app/product-options.ts').optionInputs(latest.options);bad[0].packagedWidthMm=value;assert.equal((await f.h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:latest.options.revision,expectedProductVersion:latest.productVersion,rows:bad}})).status,400);}
  assert.equal(f.providerCalls,1);assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{ui?.close();f.h.close();}
});

for(const company of companies)test(`legacy raw dimensions keep their fingerprint and accepted receipt bytes until an explicit new save (${company.code})`,{skip:!fs.existsSync(originalPath)||!fs.existsSync(schemaPath)},async()=>{
 const f=await fixture(company);try{
  await f.save([{fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'160*70*50'}]);
  const row=f.h.sqlite.prepare('SELECT * FROM product_quotation_fields').get(),state=JSON.parse(row.payload);
  // Simulate a pre-fix persisted override only in this disposable SQLite DB.
  const overrides=state.categoryOverrides?.['category:69900'];assert.ok(overrides?.common);overrides.common.packagedDimensionsMm='160×70×50';
  f.h.sqlite.prepare('UPDATE product_quotation_fields SET payload=?').run(JSON.stringify(state));
  const retained=f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload,saved=await f.h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',f.product.id,f.profile.id),dataStart=f.h.load('app/category-profiles.ts').quotationStartRow(f.profile.template);
  const baselineSource=execFileSync('git',['show','6b95a0e:app/exports/quotation-source.ts'],{encoding:'utf8'}),baseline={};
  vm.runInNewContext(ts.transpileModule(baselineSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:baseline,Error,require(name){if(name==='@/app/chatgpt-auth')return{};return f.h.load(name.slice(2)+'.ts');}});
  const oldHash=await baseline.quotationExportFingerprint(saved,dataStart),current=await f.preview();assert.equal(current.fingerprint,oldHash);
  const view=await f.get();assert.ok(view.resolved.rows.filter(row=>row.included).every(row=>row.fields.packagedDimensionsMm.value==='160×70×50'&&row.fields.packagedDimensionsMm.validationIssues.some(issue=>issue.includes('별표'))));assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload,retained);
  const result={state:'validation-complete',filename:current.filename,company,includedOptions:6,quotationId:'synthetic-legacy-dimensions-'+company.code,observedAt:Date.now(),registered:false};
  await json(await f.h.route(f.base+'/supplier-hub-receipt',{method:'POST',body:{profileId:f.profile.id,categoryId:'69900',fingerprint:oldHash,result}}));const receiptBytes=f.h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts WHERE fingerprint=?').get(oldHash).payload;
  for(const value of ['','   ']){const blank=await f.save([{fieldKey:'packagedDimensionsMm',optionId:null,value}]);assert.equal(blank.overrides.common.packagedDimensionsMm,value);assert.ok(blank.resolved.rows.filter(row=>row.included).every(row=>row.fields.packagedDimensionsMm.value===value));}
  const corrected=await f.save([{fieldKey:'packagedDimensionsMm',optionId:null,value:'160×70×50'}]);assert.equal(corrected.overrides.common.packagedDimensionsMm,'160*70*50');assert.notEqual((await f.preview()).fingerprint,oldHash);
  assert.equal(f.h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts WHERE fingerprint=?').get(oldHash).payload,receiptBytes);assert.equal((await json(await f.h.route(f.base+'/supplier-hub-receipt?fingerprint='+oldHash))).receipt.result.quotationId,result.quotationId);
  for(const value of ['0','0×70×50','160×70','160.5×70×50','160×70×50 mm']){const latest=await f.get(),before=f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload;assert.equal((await f.h.route(f.endpoint,{method:'PUT',body:{expectedRevision:latest.revision,expectedInputFingerprint:latest.inputFingerprint,changes:[{fieldKey:'packagedDimensionsMm',optionId:null,value}]}})).status,400);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload,before);}
  assert.equal(f.h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{f.h.close();}
});
