import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const defaults={countryOfOrigin:'중국',precautions:'용도 외에 사용금지. 파손및화기주의',usageStandard:'14세이상'};
const named=(name,value)=>({contains:{type:'object',properties:{name:{type:'string',enum:[name]},value}}});
async function fixture(company,{attributes=[],restrictedCaution=false,native=false,categoryPath=schemaPath,bundlePricing=false,optionColors=[],singleOption=false}={}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  const sourceUrl='https://detail.1688.com/offer/629000000001.html',snapshot={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'},raw=JSON.parse(snapshot.schemaString);
  raw.properties.legalPage.properties.notices.allOf.push(named('제조국',{type:'string'}),named('취급시 주의사항',{type:'string',...(restrictedCaution?{enum:['해당사항없음','직접 확인한 전용 주의사항']}:{})}));
  if(optionColors.length||singleOption)raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.splice(1);
  snapshot.schemaString=JSON.stringify(raw);
  snapshot.categoryPath=[...categoryPath];if(native)snapshot.nativeSerializationPolicy='supplier-hub-native-required-form-v1';
  const profile=(await json(await h.load('app/api/category-profiles/route.ts').POST(new Request('https://app.test/api/category-profiles',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'시험 최종분류',categoryId:snapshot.categoryId,categoryPath,hubSchema:snapshot,template:null,mappings:[]})})),201)).profile;
  h.context.category=profile;
  if(bundlePricing)Object.assign(h.context.settings,{bundleEnabled:true,bundleCriterion:'supplyMargin',bundleMinimumSupplyMargin:3000,bundleMinimumCoupangMargin:3000});
  h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');
  h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=? WHERE id=?').run('629000000001',sourceUrl,'job');
  const options=[{sku:'629-first',name:'첫 옵션',unitPriceCny:2,minimumOrder:1,stock:3},{sku:'629-second',name:'다른 옵션',unitPriceCny:3,minimumOrder:1,stock:0}]
   .slice(0,singleOption?1:2).map((option,index)=>optionColors[index]?{...option,color:optionColors[index]}:option);
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-label-defaults',collectedAt:new Date().toISOString(),title:'새 원문 상품',description:'새 원문 설명',attributes,options,images:[]}}));
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products WHERE source_url=?').get(sourceUrl);assert.ok(product);const base='/api/products/'+product.id;
  const read=suffix=>h.route(base+'/'+suffix).then(json),retained=()=>JSON.stringify(Object.fromEntries(['collection_results','collection_context','category_profiles','translation_jobs'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));
  return{h,profile,product,base,read,retained,sourceUrl};
 }catch(error){h.close();throw error;}
}
const notice=(view,label)=>view.resolved.schema.fields.find(field=>field.section==='legal'&&field.label===label);
test('confirmed native collection keeps raw facts, translates exact structured colors and links origin to both stages',async()=>{
 const f=await fixture(schemaCompanies[0],{native:true,optionColors:['绿色','加液旋转锅刷【白色】'],attributes:[{name:'原产国/地区',value:'中国'},{name:'产地',value:'浙江台州'},{name:'发货地',value:'日本'}]});
 try{
  const {h,read,base,product}=f,source=f.retained(),content=(await read('content')).content;
  assert.equal(content.label.countryOfOrigin.value,'중국');
  assert.equal(content.label.countryOfOrigin.provenance,'translated');
  const options=await h.load('db/product-options.ts').readProductOptions('owner',product.id);
  assert.deepEqual(plain(options.rows.map(option=>[option.color,option.provenance.color])),[['그린','translated'],['화이트','translated']]);
  let quote=await read('quotation-fields'),labels=await read('product-labels');
  const color=quote.resolved.schema.fields.find(field=>field.visibility==='exposed'&&field.label==='색상'),origin=notice(quote,'제조국');
  const [first,second]=quote.resolved.rows.filter(row=>row.included);
  assert.deepEqual([first.fields[color.id].value,second.fields[color.id].value],['그린','화이트']);
  const baseName=first.fields.title.value;assert.ok(baseName);
  assert.equal(first.productNameProposal.value,baseName+' 그린');
  assert.equal(first.fields[origin.id].value,'중국');
  assert.ok(labels.rows.filter(row=>row.included).every(row=>row.values.countryOfOrigin==='중국'&&row.values.productName===baseName));
  await json(await h.route(base+'/product-labels',{method:'PUT',body:{expectedRevision:labels.revision,expectedInputFingerprint:labels.inputFingerprint,changes:[{optionId:first.optionId,fieldKey:'countryOfOrigin',value:''}]}}));
  quote=await read('quotation-fields');labels=await read('product-labels');
  assert.equal(labels.rows.find(row=>row.optionId===first.optionId).values.countryOfOrigin,'');
  assert.deepEqual(quote.resolved.rows.filter(row=>row.included).map(row=>row.fields[origin.id].value),['','중국']);
  assert.equal(f.retained(),source);assert.deepEqual(h.network,[]);
  const {confirmedCollectionOrigin}=h.load('app/collection-label-attributes.ts');
  assert.deepEqual(plain(confirmedCollectionOrigin([{name:'原产地',value:'中国浙江省'}])),{value:'중국',provenance:'translated'});
  assert.deepEqual(plain(confirmedCollectionOrigin([{name:'原产国',value:'日本'}])),{value:'일본',provenance:'translated'});
 }finally{f.h.close();}
});
test('native structured color separates the observed length qualifier from exposure and proposals',async()=>{
 const f=await fixture(schemaCompanies[0],{native:true,optionColors:['粉色【不可伸缩】','灰色【可伸缩】']});
 try{
  const {h,read,product}=f,options=await h.load('db/product-options.ts').readProductOptions('owner',product.id);
  assert.deepEqual(plain(options.rows.map(row=>[row.color,row.provenance.color])),[['핑크','translated'],['그레이','translated']]);
  const quote=await read('quotation-fields'),color=quote.resolved.schema.fields.find(field=>field.visibility==='exposed'&&field.label==='색상');
  for(const [index,expected] of ['핑크','그레이'].entries()){
   const row=quote.resolved.rows.find(row=>row.optionId===options.rows[index].id);
   assert.equal(row.fields[color.id].value,expected);
   assert.ok(row.fields.title.value);
   assert.equal(row.productNameProposal.value,row.fields.title.value+' '+expected);
  }
  const {quotationStructuredOptionColor}=h.load('app/quotation-option-color.ts');
  const choices=['핑크','그레이'].map(value=>({label:value,value}));
  for(const [value,expected] of [['분홍색(길이 조절 불가)','핑크'],['회색(길이 조절 가능)','그레이']]){
   assert.equal(quotationStructuredOptionColor(value),expected);
   assert.equal(quotationStructuredOptionColor(value,choices),expected);
  }
  for(const value of ['粉色灰色【可伸缩】','분홍색 회색(길이 조절 가능)','혼합색(길이 조절 가능)']){
   assert.equal(quotationStructuredOptionColor(value),undefined);
  }
 }finally{f.h.close();}
});
test('only a sole collected SKU inherits the exact product color without guessing variants',async()=>{
 const attributes=[{name:'颜色',value:'绿色'},{name:'原产国/地区',value:'中国'}];
 for(const singleOption of [true,false]){
  const f=await fixture(schemaCompanies[0],{native:true,attributes,singleOption});
  try{
   const {h,read,product}=f,options=await h.load('db/product-options.ts').readProductOptions('owner',product.id);
   assert.deepEqual(plain(options.rows.map(row=>row.color)),singleOption?['그린']:['','']);
   const quote=await read('quotation-fields'),row=quote.resolved.rows.find(row=>row.included);
   const color=quote.resolved.schema.fields.find(field=>field.visibility==='exposed'&&field.label==='색상');
   assert.equal(row.fields[color.id].value,singleOption?'그린':'');
  }finally{f.h.close();}
 }
});
test('native collection does not declare origin from city alone, seller location or conflicting countries',async()=>{
 for(const attributes of [
  [{name:'原产地',value:'台州'},{name:'供应商所在地',value:'中国浙江'}],
  [{name:'原产国',value:'日本'},{name:'制造国',value:'中国'}],
 ]){
  const f=await fixture(schemaCompanies[0],{native:true,attributes,optionColors:['磨砂未确认']});
  try{
   const {read}=f,content=(await read('content')).content,quote=await read('quotation-fields'),labels=await read('product-labels');
   const row=quote.resolved.rows.find(row=>row.included),origin=notice(quote,'제조국');
   assert.equal(content.label.countryOfOrigin.value,'');assert.equal(content.label.countryOfOrigin.provenance,'unverified');
   assert.equal(labels.rows.find(row=>row.included).values.countryOfOrigin,'');assert.equal(row.fields[origin.id].value,'');
   assert.ok(row.productNameProposal.missing.includes('색상'));
  }finally{f.h.close();}
 }
});
test('fresh native collection derives label quantity, verified material and category type before label generation',async()=>{
 const f=await fixture(schemaCompanies[0],{native:true,categoryPath:['문구/오피스','정리용품','펜홀더/연필꽂이'],attributes:[{name:'材质',value:'塑料'}]});
 try{
  const {h,read,base}=f,source=f.retained(),view=await read('product-labels'),row=view.rows.find(row=>row.included);
  assert.equal(row.values.netContents,'1개');
  assert.equal(row.values.material,'플라스틱');
  assert.equal(row.values.productType,'문구용품');
  assert.equal((await read('content')).content.label.material.value,'塑料');
  const label=h.load('app/product-label.ts'),rows=new Map(label.productLabelPlan(view,row.optionId).rows);
  for(const key of ['netContents','material','productType']){
   assert.equal(rows.get(label.productLabelFields.find(field=>field.key===key).label),row.values[key]);
  }
  assert.equal(row.values.countryOfOrigin,'');
  assert.equal(rows.has(label.productLabelFields.find(field=>field.key==='countryOfOrigin').label),false);
  assert.deepEqual(h.network,[]);
  await json(await h.route(base+'/product-labels',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:row.optionId,fieldKey:'material',value:''}]}}));
  const saved=await read('product-labels'),changed=saved.rows.find(option=>option.optionId===row.optionId);
  assert.equal(changed.values.material,'');assert.equal(changed.sources.material,'manual-option');
  assert.equal(changed.values.productType,'문구용품');assert.equal(f.retained(),source);
 }finally{f.h.close();}
});
test('fresh cleaning-tool labels use the cleaning category and keep unknown material reviewable',async()=>{
 const f=await fixture(schemaCompanies[0],{native:true,categoryPath:['생활용품','청소용품','청소솔']});
 try{
  const view=await f.read('product-labels'),row=view.rows.find(row=>row.included);
  assert.equal(row.values.productType,'청소용품');
  assert.equal(row.values.material,'상세정보참조');
  assert.equal(row.values.netContents,'1개');
 }finally{f.h.close();}
});
test('baking rolling pins do not inherit cleaning labels from the shared word 밀대',async()=>{
 const f=await fixture(schemaCompanies[0],{native:true,categoryPath:['주방용품','베이킹용품','반죽 밀대']});
 try{
  const view=await f.read('product-labels'),row=view.rows.find(row=>row.included);
  assert.equal(row.values.productType,'반죽 밀대');
  const categoryType=f.h.load('app/product-label-current-rules.ts').productLabelCategoryType;
  assert.equal(categoryType(['생활용품','청소용품','청소솔/스틱']),'청소용품');
  assert.equal(categoryType(['생활용품','바닥 밀대']),'청소용품');
  assert.equal(categoryType(['문구/오피스','펜홀더/연필꽂이']),'문구용품');
  assert.equal(categoryType(['부품','펜홀더 교체부품']),'펜홀더 교체부품');
  assert.equal(categoryType(['가구/홈데코','수납가구','서랍장']),'서랍장');
  assert.equal(categoryType(['가구/홈데코','수납가구','기타']),'수납가구');
  assert.equal(categoryType(['미분류','기타']),undefined);
 }finally{f.h.close();}
});
test('label count defaults use confirmed bundle lineage and never a price suggestion',async()=>{
 const f=await fixture(schemaCompanies[0],{native:true,bundlePricing:true});
 try{
  const {h,read,product}=f,db=h.load('db/product-options.ts');
  const options=await db.readProductOptions('owner',product.id),source=options.rows[0];
  assert.ok(source.unitsPerPack>1,'the initial pricing calculator suggested a bundle');
  const before=await read('product-labels');
  assert.equal(before.rows.find(row=>row.optionId===source.id).values.netContents,'1개');
  const version=new Date(Date.parse(before.productVersion)+1).toISOString(),optionId='confirmed-bundle';
  const next=h.load('app/option-bundles.ts').applyBundleAddRows(options,[{sourceOptionId:source.id,optionId}],4,version);
  assert.ok(await db.saveProductOptions('owner',next,options.revision,before.productVersion));
  const after=await read('product-labels');
  assert.equal(after.rows.find(row=>row.optionId===optionId).values.netContents,'4개');
  assert.equal(after.rows.find(row=>row.optionId===source.id).values.netContents,'1개');
  assert.equal(after.rows.find(row=>row.optionId===null).values.netContents,'');
 }finally{f.h.close();}
});
for(const company of schemaCompanies){
 test(`a fresh captured category prepares Couplus's reviewable nine-row defaults outside 80719 (${company.code})`,async()=>{
  const f=await fixture(company,{attributes:[{name:'原产地',value:'台州'},{name:'产地',value:'台州'}]});try{const {h,read,product}=f,source=f.retained(),view=await read('product-labels'),row=view.rows.find(row=>row.included),plan=h.load('app/product-label.ts').productLabelPlan(view,row.optionId);
   assert.equal(view.categoryContext.categoryId,'991234');for(const [key,value]of Object.entries(defaults)){assert.equal(row.values[key],value,key+' is reviewable form text, not a source fact');const label=h.load('app/product-label.ts').productLabelFields.find(field=>field.key===key).label;assert.equal(plan.rows.find(item=>item[0]===label)[1],value);}
   const content=await h.load('db/product-content.ts').readProductContent('owner',product.id);for(const key of Object.keys(defaults))assert.equal(content.label[key].provenance,'generated');
   const quote=await read('quotation-fields'),country=notice(quote,'제조국'),caution=notice(quote,'취급시 주의사항');for(const option of quote.resolved.rows.filter(item=>item.included)){assert.equal(option.fields[country.id].value,'해당사항없음','legacy label defaults are not confirmed quotation facts');assert.equal(option.fields[caution.id].value,'해당사항없음');assert.equal(option.fields[country.id].needsReview,true);assert.ok(Number(option.fields.supplyPrice.value)>0);assert.ok(Number(option.fields.salePrice.value)>0);assert.equal(option.fields.packagedWeightG.value,'','no measured packing value is fabricated');assert.equal(option.fields.packagedDimensionsMm.value,'');}
   const exportModule=h.load('app/exports/quotation-source.ts'),saved=await exportModule.readQuotationExportSource('owner',product.id,null),resolved=exportModule.resolveQuotationExport(saved),rows=h.load('app/exports/quotation-fields.ts').resolvedQuotationRows(saved,resolved,[]),bytes=new TextEncoder().encode('상품명,제조국,취급시 주의사항,공급가,판매가\n').buffer,sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
   const mapped=await h.load('app/exports/mapped-quotation.ts').createMappedQuotation({originalBytes:bytes,profile:{...f.profile,template:{name:'synthetic-nine-defaults.csv',format:'csv',sheetName:'',headerRow:1,headers:['상품명','제조국','취급시 주의사항','공급가','판매가'],sha256},mappings:['title',country.id,caution.id,'supplyPrice','salePrice'].map((field,column)=>({field,column,required:false}))},rows,dataStartRow:2});
   assert.equal(mapped.values.length,2);for(const output of mapped.values){assert.equal(output[1],'해당사항없음');assert.equal(output[2],'해당사항없음');assert.ok(Number(output[3])>0&&Number(output[4])>0);}assert.equal(f.retained(),source);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload.includes('중국'),false);assert.deepEqual(h.network,[]);
  }finally{f.h.close();}
 });
 test(`source country, deliberate common/SKU blanks and intake replay keep the original category draft (${company.code})`,async()=>{
  const f=await fixture(company,{attributes:[{name:'原产国',value:'일본'},{name:'镜片材质',value:'PC'},{name:'产地',value:'타이저우'}]});try{const {h,read,base}=f,source=f.retained();let view=await read('product-labels');assert.ok(view.rows.every(row=>row.values.countryOfOrigin==='일본'));let content=(await read('content')).content;assert.notEqual(content.label.countryOfOrigin.provenance,'generated');assert.equal(content.label.material.value,'','lens material is not a whole-product label');
   const first=view.rows.find(row=>row.included),other=view.rows.filter(row=>row.included)[1];await json(await h.route(base+'/product-labels',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:first.optionId,fieldKey:'countryOfOrigin',value:''},{optionId:other.optionId,fieldKey:'precautions',value:'직접 검토한 옵션 주의사항'}]}}));
   content=(await read('content')).content;await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{countryOfOrigin:'',precautions:'',usageStandard:''},labelClears:['countryOfOrigin','precautions','usageStandard']}}}));const before=JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_labels','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])));await h.intake();
   view=await read('product-labels');assert.equal(view.rows.find(row=>row.optionId===first.optionId).values.countryOfOrigin,'');assert.equal(view.rows.find(row=>row.optionId===other.optionId).values.precautions,'직접 검토한 옵션 주의사항');assert.ok(view.rows.every(row=>row.values.usageStandard===''));const quote=await read('quotation-fields');for(const row of quote.resolved.rows){assert.equal(row.fields[notice(quote,'제조국').id].value,'');assert.equal(row.fields[notice(quote,'취급시 주의사항').id].value,row.optionId===other.optionId?'직접 검토한 옵션 주의사항':'');}
   assert.equal(JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_labels','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))),before);assert.equal(f.retained(),source);
   const original=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload;h.setCompany(schemaCompanies.find(value=>value.code!==company.code));assert.equal((await h.route(base+'/product-labels')).status,409);assert.equal((await h.route(base+'/quotation-fields')).status,409);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,original);assert.equal(JSON.stringify(Object.fromEntries(['products','product_content','product_options','product_labels','product_quotation_fields'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()]))),before);
  }finally{f.h.close();}
 });
 test(`a captured category's restrictive caution choice remains unresolved until the user reviews it (${company.code})`,async()=>{
  const f=await fixture(company,{restrictedCaution:true});try{
   const {h,read,base}=f,source=f.retained(),view=await read('product-labels'),option=view.rows.find(row=>row.included);
   assert.equal(option.values.precautions,defaults.precautions);
   const initial=await read('quotation-fields'),field=notice(initial,'취급시 주의사항');
   assert.equal(initial.resolved.rows.find(row=>row.optionId===option.optionId).fields[field.id].value,'해당사항없음');
   await json(await h.route(base+'/product-labels',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:option.optionId,fieldKey:'precautions',value:defaults.precautions}]}}));
   const quote=await read('quotation-fields'),cell=quote.resolved.rows.find(row=>row.optionId===option.optionId).fields[field.id];
   assert.equal(cell.value,defaults.precautions);
   assert.ok(cell.validationIssues.length,'a saved label cannot silently claim an incompatible category choice');
   assert.equal(cell.needsReview,true);
   assert.equal(f.retained(),source);
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
test('confirmed origin rejects a mainland regional qualifier containing a second country',()=>{
 const h=mobileIntakeHarness();try{
  const {confirmedCollectionOrigin}=h.load('app/collection-label-attributes.ts');
  assert.deepEqual(plain(confirmedCollectionOrigin([{name:'原产国',value:'中国浙江省台州市'}])),{value:'중국',provenance:'translated'});
  for(const value of ['中国浙江省德国','中国浙江省泰国','中國浙江省法國','中国浙江省香港']){
   assert.equal(confirmedCollectionOrigin([{name:'原产国',value}]),undefined,value);
  }
 }finally{h.close();}
});
