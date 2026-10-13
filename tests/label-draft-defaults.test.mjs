import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const defaults={countryOfOrigin:'중국',precautions:'용도 외에 사용금지. 파손및화기주의',usageStandard:'14세이상'};
const named=(name,value)=>({contains:{type:'object',properties:{name:{type:'string',enum:[name]},value}}});
async function fixture(company,{attributes=[],restrictedCaution=false}={}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const sourceUrl='https://detail.1688.com/offer/629000000001.html',snapshot={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'},raw=JSON.parse(snapshot.schemaString);
  raw.properties.legalPage.properties.notices.allOf.push(named('제조국',{type:'string'}),named('취급시 주의사항',{type:'string',...(restrictedCaution?{enum:['해당사항없음','직접 확인한 전용 주의사항']}:{})}));snapshot.schemaString=JSON.stringify(raw);
  const profile=(await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'시험 최종분류',categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot,template:null,mappings:[]})})),201)).profile;
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run('629000000001',sourceUrl,'job');
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-label-defaults',collectedAt:new Date().toISOString(),title:'새 원문 상품',description:'새 원문 설명',attributes,options:[{sku:'629-first',name:'첫 옵션',unitPriceCny:2,minimumOrder:1,stock:3},{sku:'629-second',name:'다른 옵션',unitPriceCny:3,minimumOrder:1,stock:0}],images:[]}}));
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl);assert.ok(product);const base='/api/products/'+product.id;
  const read=suffix=>h.route(base+'/'+suffix).then(json),retained=()=>JSON.stringify(Object.fromEntries(['collection_results','collection_context','category_profiles','translation_jobs'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));
  return{h,profile,product,base,read,retained,sourceUrl};
 }catch(error){h.close();throw error;}
}
const notice=(view,label)=>view.resolved.schema.fields.find(field=>field.section==='legal'&&field.label===label);
for(const company of schemaCompanies){
 test(`a fresh captured category prepares Couplus's reviewable nine-row defaults outside 80719 (${company.code})`,async()=>{
  const f=await fixture(company,{attributes:[{name:'原产地',value:'台州'},{name:'产地',value:'台州'}]});try{const {h,read,product}=f,source=f.retained(),view=await read('product-labels'),row=view.rows.find(row=>row.included),plan=h.load('app/product-label.ts').productLabelPlan(view,row.optionId);
   assert.equal(view.categoryContext.categoryId,'991234');for(const [key,value]of Object.entries(defaults)){assert.equal(row.values[key],value,key+' is reviewable form text, not a source fact');const label=h.load('app/product-label.ts').productLabelFields.find(field=>field.key===key).label;assert.equal(plan.rows.find(item=>item[0]===label)[1],value);}
   const content=await h.load('db/product-content.ts').readProductContent('owner',product.id);for(const key of Object.keys(defaults))assert.equal(content.label[key].provenance,'generated');
   const quote=await read('quotation-fields'),country=notice(quote,'제조국'),caution=notice(quote,'취급시 주의사항');for(const option of quote.resolved.rows.filter(item=>item.included)){assert.equal(option.fields[country.id].value,defaults.countryOfOrigin);assert.equal(option.fields[caution.id].value,defaults.precautions);assert.equal(option.fields[country.id].needsReview,true);assert.ok(Number(option.fields.supplyPrice.value)>0);assert.ok(Number(option.fields.salePrice.value)>0);assert.equal(option.fields.packagedWeightG.value,'','no measured packing value is fabricated');assert.equal(option.fields.packagedDimensionsMm.value,'');}
   const exportModule=h.load('app/exports/quotation-source.ts'),saved=await exportModule.readQuotationExportSource('owner',product.id,null),resolved=exportModule.resolveQuotationExport(saved),rows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved,resolved,[]),bytes=new TextEncoder().encode('상품명,제조국,취급시 주의사항,공급가,판매가\n').buffer,sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
   const mapped=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes,profile:{...f.profile,template:{name:'synthetic-nine-defaults.csv',format:'csv',sheetName:'',headerRow:1,headers:['상품명','제조국','취급시 주의사항','공급가','판매가'],sha256},mappings:['title',country.id,caution.id,'supplyPrice','salePrice'].map((field,column)=>({field,column,required:false}))},rows,dataStartRow:2});
   assert.equal(mapped.values.length,2);for(const output of mapped.values){assert.equal(output[1],defaults.countryOfOrigin);assert.equal(output[2],defaults.precautions);assert.ok(Number(output[3])>0&&Number(output[4])>0);}assert.equal(f.retained(),source);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload.includes('중국'),false);assert.deepEqual(h.network,[]);
  }finally{f.h.close();}
 });
 test(`source country, deliberate common/SKU blanks and intake replay keep the original category draft (${company.code})`,async()=>{
  const f=await fixture(company,{attributes:[{name:'原产国',value:'일본'},{name:'镜片材质',value:'PC'},{name:'产地',value:'타이저우'}]});try{const {h,read,base}=f,source=f.retained();let view=await read('product-labels');assert.ok(view.rows.every(row=>row.values.countryOfOrigin==='일본'));let content=(await read('content')).content;assert.notEqual(content.label.countryOfOrigin.provenance,'generated');assert.equal(content.label.material.value,'','lens material is not a whole-product label');
   const first=view.rows.find(row=>row.included),other=view.rows.filter(row=>row.included)[1];await json(await h.route(base+'/product-labels',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:first.optionId,fieldKey:'countryOfOrigin',value:''},{optionId:other.optionId,fieldKey:'precautions',value:'직접 검토한 옵션 주의사항'}]}}));
   content=(await read('content')).content;await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{countryOfOrigin:'',precautions:'',usageStandard:''},labelClears:['countryOfOrigin','precautions','usageStandard']}}}));const before=JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_labels','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));await h.intake();
   view=await read('product-labels');assert.equal(view.rows.find(row=>row.optionId===first.optionId).values.countryOfOrigin,'');assert.equal(view.rows.find(row=>row.optionId===other.optionId).values.precautions,'직접 검토한 옵션 주의사항');assert.ok(view.rows.every(row=>row.values.usageStandard===''));const quote=await read('quotation-fields');for(const row of quote.resolved.rows){assert.equal(row.fields[notice(quote,'제조국').id].value,'');assert.equal(row.fields[notice(quote,'취급시 주의사항').id].value,'');}
   assert.equal(JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_labels','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))),before);assert.equal(f.retained(),source);
   const original=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;h.setCompany(schemaCompanies.find(value=>value.code!==company.code));assert.equal((await h.route(base+'/product-labels')).status,409);assert.equal((await h.route(base+'/quotation-fields')).status,409);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,original);assert.equal(JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_labels','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))),before);
  }finally{f.h.close();}
 });
 test(`a captured category's restrictive caution choice remains unresolved until the user reviews it (${company.code})`,async()=>{
  const f=await fixture(company,{restrictedCaution:true});try{const view=await f.read('product-labels');assert.equal(view.rows.find(row=>row.included).values.precautions,defaults.precautions);const quote=await f.read('quotation-fields'),field=notice(quote,'취급시 주의사항'),row=quote.resolved.rows.find(row=>row.included);assert.equal(row.fields[field.id].value,defaults.precautions);assert.ok(row.fields[field.id].validationIssues.length,'a form default cannot silently claim an incompatible category choice');assert.equal(row.fields[field.id].needsReview,true);const source=f.retained();await f.read('quotation-fields');assert.equal(f.retained(),source);
  }finally{f.h.close();}
 });
 test(`legacy missing label fields and saved option edits have identical read-only API bodies before and after expanded defaults (${company.code})`,async()=>{
  const f=await fixture(company);try{const {h,read,base}=f,view=await read('product-labels'),selected=view.rows.find(row=>row.included),other=view.rows.filter(row=>row.included)[1];
   await json(await h.route(base+'/product-labels',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:null,fieldKey:'manufacturer',value:''},{optionId:selected.optionId,fieldKey:'productName',value:'기존 직접 제품명'},{optionId:other.optionId,fieldKey:'countryOfOrigin',value:''}]}}));
   const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);for(const key of Object.keys(defaults))delete content.label[key];h.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
   const defaultModule=h.load('app/couplus-quotation-defaults.ts'),current=defaultModule.couplusLabelDefaults;defaultModule.couplusLabelDefaults=categoryId=>categoryId==='80719'?defaults:{};
   const before=JSON.stringify({labels:await read('product-labels'),quote:await read('quotation-fields')}),database=JSON.stringify(h.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all().flatMap(table=>({name:table.name,rows:h.sqlite.prepare('SELECT * FROM '+table.name).all()})));
   defaultModule.couplusLabelDefaults=current;const after={labels:await read('product-labels'),quote:await read('quotation-fields')};assert.equal(JSON.stringify(after),before,'GET cannot initialize an older saved product');assert.equal(after.labels.rows.find(row=>row.optionId===selected.optionId).values.productName,'기존 직접 제품명');for(const row of after.labels.rows){assert.equal(row.values.countryOfOrigin,'');assert.equal(row.values.precautions,'');assert.equal(row.values.usageStandard,'');assert.equal(row.values.manufacturer,'');}
   assert.equal(JSON.stringify(h.sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all().flatMap(table=>({name:table.name,rows:h.sqlite.prepare('SELECT * FROM '+table.name).all()}))),database);
  }finally{f.h.close();}
 });
}
test('exact country headings retain literal country text while city/region, component and conflicting headings never become declarations',()=>{
 const h=mobileIntakeHarness();try{const helper=h.load('app/collection-label-attributes.ts');for(const name of ['제조국','原产国','COUNTRY OF ORIGIN'])assert.deepEqual(plain(helper.collectionLabelAttributes([{name,value:'원문 국가'}])),{countryOfOrigin:'원문 국가'});for(const name of ['产地','原产地','발송지','shipping origin','镜片材质'])assert.deepEqual(plain(helper.collectionLabelAttributes([{name,value:'도시 또는 부품'}])),{});assert.deepEqual(plain(helper.collectionLabelAttributes([{name:'原产国',value:'일본'},{name:'제조국',value:'대한민국'}])),{});
 }finally{h.close();}
});
