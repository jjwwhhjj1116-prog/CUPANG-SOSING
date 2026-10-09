import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { quotationWorkbook } from './helpers/quotation-workbook.mjs';
import { prepareAttachments, readPackageZip } from '../extensions/supplier-hub/package.mjs';

const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const companies=[{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}];
const keys=['purchasePrice','coupangSalePrice','msrp'];
const relation='판매가는 공급가보다 작을 수 없습니다.';
const wire=(schema,key)=>schema.fields.find(field=>!field.hubWire?.name&&JSON.stringify(field.hubWire?.path)===JSON.stringify(['productPage','commonAttributes',key]));
async function json(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
function snapshot(api,company=companies[0],type='integer'){
 const path=api.load('app/quotation-schema.ts').getQuotationSchema('80699').categoryPath;
 const scalar=title=>({type,title,...(type==='string'?{maxLength:30}:{minimum:1,maximum:Number.MAX_SAFE_INTEGER})});
 return {format:'supplier-hub-schema-v1',categoryId:'80699',categoryPath:path,company:{code:company.companyCode,name:company.companyName},observedAt:Date.now(),inputBindings:'couplus-paths-v1',
  metadata:{kanCategoryId:1,noticeNumber:1,scopeType:'Retail_Categorized_Single',version:1},
  schemaString:JSON.stringify({type:'object',properties:{productPage:{type:'object',properties:{commonAttributes:{type:'object',required:keys,
   properties:{purchasePrice:scalar('공급가'),coupangSalePrice:scalar('판매가'),msrp:scalar('권장소비자가격'),osrp:scalar('공식 판매처 가격')}}}},legalPage:{type:'object',properties:{}}}})};
}
function editor(api){
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/quotation-fields-editor.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,structuredClone,TextEncoder,require(name){if(name.endsWith('.css'))return{};if(name.startsWith('@/')){const file=name.slice(2)+'.ts';return fs.existsSync(new URL('../'+file,import.meta.url))?api.load(file):{};}return native(name);}});
 return exports;
}

test('confirmed price rules compare every supported scalar notation without inventing rules for another category',()=>{
 const api=mobileIntakeHarness();try{
  const q=api.load('app/quotation-schema.ts');
  for(const type of ['integer','number','string']){
   const snap=snapshot(api,companies[0],type),schema=q.getQuotationSchema(snap.categoryId,snap.categoryPath,snap),supply=wire(schema,'purchasePrice');assert.equal(schema.salePriceMustCoverSupply,true);
   for(const [left,right] of [['10000','9000'],['10000.0','9000.0'],['1e4','9e3'],['1E+4','9E+3'],['1.0e4','0.9e4'],[String(Number.MAX_SAFE_INTEGER),String(Number.MAX_SAFE_INTEGER-1)]]){
    assert.deepEqual(plain(q.quotationValueIssues(supply,left)),[]);assert.deepEqual(plain(q.quotationPriceIssues(schema,left,right)),[relation],`${type}: ${left}/${right}`);
   }
   for(const [left,right] of [['1e4','1E+4'],['1e4','1.1e4'],['10000.0','10000'],['1','1'],[String(Number.MAX_SAFE_INTEGER),String(Number.MAX_SAFE_INTEGER)]])assert.deepEqual(plain(q.quotationPriceIssues(schema,left,right)),[]);
   for(const value of ['+10000','-10000','0x2710','NaN','Infinity','1e999','1e-999',' 10000','10000 ','','0',String(Number.MAX_SAFE_INTEGER+1)]){
    assert.ok(q.quotationValueIssues(supply,value).length,`${type}: ${value} remains a scalar error`);assert.deepEqual(plain(q.quotationPriceIssues(schema,value,'1')),[]);
   }
   if(type==='integer'||type==='string'){assert.ok(q.quotationValueIssues(supply,'1.5').length);assert.deepEqual(plain(q.quotationPriceIssues(schema,'1.5','1')),[]);}
   else assert.deepEqual(plain(q.quotationPriceIssues(schema,'1.5','1.4')),[relation]);
   assert.deepEqual(plain(q.quotationPriceIssues({...schema,salePriceMustCoverSupply:false},'1e4','9e3')),[]);
  }
  const snap=snapshot(api),unconfirmedRule={...snap,categoryId:'991234',categoryPath:['합성 분류','별도 최종 분류']},other=q.getQuotationSchema('991234',unconfirmedRule.categoryPath,unconfirmedRule);
  assert.equal(other.salePriceMustCoverSupply,undefined);assert.deepEqual(plain(q.quotationPriceIssues(other,'1e4','9e3')),[]);
  const zero=snapshot(api),raw=JSON.parse(zero.schemaString);
  for(const key of ['purchasePrice','coupangSalePrice'])raw.properties.productPage.properties.commonAttributes.properties[key].minimum=0;
  zero.schemaString=JSON.stringify(raw);const zeroSchema=q.getQuotationSchema(zero.categoryId,zero.categoryPath,zero);
  for(const key of ['purchasePrice','coupangSalePrice'])assert.deepEqual(plain(q.quotationValueIssues(wire(zeroSchema,key),'0')),[],'the captured numeric minimum permits zero');
  assert.deepEqual(plain(q.quotationPriceIssues(zeroSchema,'1e4','0')),[relation],'an allowed zero sale price cannot bypass the relation');
  assert.deepEqual(plain(q.quotationPriceIssues(zeroSchema,'0','0')),[]);assert.deepEqual(plain(q.quotationPriceIssues(zeroSchema,'0','1')),[]);
  const canonical=q.getQuotationSchema('80699').fields.find(field=>field.id==='salePrice');assert.ok(q.quotationValueIssues(canonical,'0').length,'the existing canonical minimum still rejects zero');
 }finally{api.close();}
});

async function fixture(company,type){
 const api=mobileIntakeHarness(company);try{
  const get=api.bindings.FILES.get;api.bindings.FILES.get=async(key,options)=>{const object=await get(key),bytes=api.objects.get(key);if(!object||!bytes)return object;const offset=options?.range?.offset??0,end=options?.range?.length===undefined?bytes.byteLength:offset+options.range.length;return {...object,body:new Response(bytes.slice(offset,end)).body};};
  const q=api.load('app/quotation-schema.ts'),hubSchema=snapshot(api,company,type),schema=q.getQuotationSchema(hubSchema.categoryId,hubSchema.categoryPath,hubSchema),headers=schema.fields.map(field=>field.id),bytes=new Uint8Array(quotationWorkbook(headers));
  const sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=api.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');api.objects.set(storageKey,bytes);
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'가격 표기 관계 시험',categoryId:hubSchema.categoryId,categoryPath:hubSchema.categoryPath,hubSchema,
   template:{name:'synthetic-price-notation.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))},'cat');
  api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,url=base+'/quotation-fields';
  const read=()=>api.route(url).then(json),save=async(view,changes)=>api.route(url,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  let view=await read();view=await save(view,Object.entries({model:'SYNTHETIC',taxType:'과세',kcMarkType:'해당사항없음',shelfLifeDays:'0',handlingReason:'해당사항없음',packagedWeightG:'100',packagedDimensionsMm:'100*100*100',labelImages:view.imageKeys[3]}).map(([fieldKey,value])=>({fieldKey,value,optionId:null})));
  const selected=view.resolved.rows.find(row=>row.optionId),targets=api.load('app/quotation-price-targets.ts').quotationPriceTargets(view.resolved.schema.fields),osrp=wire(view.resolved.schema,'osrp');
  const changes=(supply,sale,optionId=null)=>[...targets.supplyPrice.linked.map(fieldKey=>({fieldKey,value:supply,optionId})),...targets.salePrice.linked.map(fieldKey=>({fieldKey,value:sale,optionId}))];
  const preview=()=>api.route(base+'/quotation',{method:'POST',body:{action:'preview'}}).then(json),review=()=>api.route(base+'/submission-review?profileId=cat').then(json);
  const exported=async value=>{const response=await api.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:value.fingerprint}});assert.equal(response.status,200,await response.clone().text());return new Uint8Array(await response.arrayBuffer());};
  return {api,q,product,base,headers,read,save,selected,targets,osrp,changes,preview,review,exported};
 }catch(error){api.close();throw error;}
}

// Recorded-source adapter, real SQLite/routes/exporter and a synthetic original
// workbook. No operating product, external Hub request or registration occurs.
for(const company of companies)for(const type of ['integer','string'])test(`saved ${type} prices retain notation but low sale price blocks the real package (${company.companyCode})`,async()=>{
 const f=await fixture(company,type);try{
  const policy=()=>f.api.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(f.product.id)?.payload??null;
  const before={options:f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload,content:f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,context:f.api.sqlite.prepare('SELECT payload FROM collection_context').get().payload,policy:policy()};
  const low=type==='integer'?['1e4','9e3']:['10000.0','9000.0'];let view=await f.read();
  view=await f.save(view,[{fieldKey:f.osrp.id,value:'',optionId:null},...f.changes(...low)]);
  const row=view.resolved.rows.find(row=>row.optionId===f.selected.optionId);assert.equal(row.fields[f.targets.supplyPrice.primary].value,low[0]);assert.equal(row.fields[f.targets.salePrice.primary].value,low[1]);assert.equal(row.fields[f.targets.salePrice.primary].source,'manual-common');assert.equal(row.fields[f.osrp.id].value,'');
  const stored=JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload);assert.ok(JSON.stringify(stored).includes(low[0]));assert.ok(JSON.stringify(stored).includes(low[1]));
  const preview=await f.preview(),review=await f.review();assert.equal(preview.submissionReview.errorCount,6);assert.equal(review.errorCount,6);assert.ok(preview.submissionReview.issues.filter(issue=>issue.kind==='error').every(issue=>issue.message.includes(relation)));
  const bytes=await f.exported(preview),zip=readPackageZip(bytes),plan=JSON.parse(new TextDecoder().decode(zip.get('supplier-hub-upload-plan.json'))),report=JSON.parse(new TextDecoder().decode(zip.get('submission-review.json')));
  assert.equal(report.errorCount,6);await assert.rejects(prepareAttachments(bytes),/수정이 필요한 오류/);
  const reader=f.api.load('app/xlsx-template.ts'),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(zip.get(plan.quotation.file.filename))),output=reader.xlsxHeaders(sheet,'견적서',2);
  assert.equal(output[f.headers.indexOf(f.targets.supplyPrice.primary)],type==='integer'?'10000':low[0]);assert.equal(output[f.headers.indexOf(f.targets.salePrice.primary)],type==='integer'?'9000':low[1]);
  const option=f.api.load('app/option-price-save.ts'),ui=editor(f.api),current=await f.read();
  assert.ok(option.optionPriceDraftIssues(current,[]).some(issue=>issue.includes(relation)));assert.throws(()=>option.optionPriceChanges(current,f.changes(...low,f.selected.optionId)),/공급가보다/);assert.throws(()=>ui.quotationSavePlan(current,f.changes(...low,f.selected.optionId),f.selected.optionId,false),/공급가보다/);
  for(const pair of type==='integer'?[['1e4','1E+4'],['10000.0','1.1e4']]:[['10000.0','10000'],['10000','11000.0']]){
   view=await f.save(await f.read(),f.changes(...pair));const ready=await f.preview();assert.equal(ready.submissionReview.errorCount,0);assert.ok(await prepareAttachments(await f.exported(ready)));assert.equal(view.resolved.rows.find(row=>row.optionId===f.selected.optionId).fields[f.osrp.id].value,'');
  }
  view=await f.save(await f.read(),f.changes('',''));const blanks=view.resolved.rows.find(row=>row.optionId===f.selected.optionId);assert.equal(blanks.fields[f.targets.supplyPrice.primary].value,'');assert.equal(blanks.fields[f.targets.salePrice.primary].value,'');assert.equal(blanks.fields[f.targets.salePrice.primary].source,'manual-common');assert.ok(!(await f.review()).issues.some(issue=>issue.message.includes(relation)));
  assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload,before.options);assert.equal(f.api.sqlite.prepare('SELECT payload FROM product_content').get().payload,before.content);assert.equal(f.api.sqlite.prepare('SELECT payload FROM collection_context').get().payload,before.context);assert.equal(policy(),before.policy);assert.equal(f.api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');assert.ok(!f.api.network.includes('supplier.coupang.com'));
 }finally{f.api.close();}
});
