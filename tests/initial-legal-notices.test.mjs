import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as load} from './helpers/provided-option-quotation.mjs';

const plain=value=>JSON.parse(JSON.stringify(value)),now='2026-10-18T01:00:00.000Z';
const helper=load('app/initial-legal-notices.ts'),schemas=load('app/quotation-schema.ts'),contentModel=load('app/product-content.ts');
const paths={'80719':['주방용품','주방수납/정리','주방수납바구니/바스켓'],'81452':['스포츠/레져','헬스/요가','헬스기구/용품','헬스보호대']};
function fixture(categoryId='80719',hubSchema){
 const settings={...load('app/workspace-settings.ts').newWorkspaceSettings,brand:'검토 브랜드',manufacturer:'캡처 제조사',importer:'캡처 수입사',serviceContact:'캡처 연락처',manufactureDatePreviousMonth:true,washingMethod:'손세탁',handlingPrecautions:'화기 주의'};
 const category={id:'cat',name:'격리 초기고시',categoryId,categoryPath:paths[categoryId],template:null,mappings:[],...(hubSchema?{hubSchema}:{})};
 const job={id:'70000000-0000-4000-8000-000000000001',offer_id:'90000000700',source_url:'https://detail.1688.com/offer/90000000700.html',goal:'collect',status:'awaiting_connector',created_at:now,updated_at:now,context:{category,settings,features:'',keywords:'',capturedAt:now,company:{code:'A01464742',name:'와이홉'}}};
 const receipt={schemaVersion:1,offerId:job.offer_id,sourceUrl:job.source_url,provider:'synthetic-initial-notices',collectedAt:now,title:'原文商品名',description:'原文商品说明',attributes:[{name:'材质',value:'尼龙'},{name:'型号',value:'RAW-700'},{name:'产品尺寸',value:'31 × 19 × 7 cm'}],options:[{sku:'SKU-700-1',name:'黑色',unitPriceCny:4.5,minimumOrder:2,stock:10,color:'黑色',size:'M'}],images:[]};
 const prepared=load('app/collection-product.ts').prepareCollectionProduct('owner',job,receipt,'product',now);
 const resolve=(content=prepared.content,overrides)=>schemas.resolveQuotationFields({categoryId,categoryPath:paths[categoryId],hubSchema,product:prepared.product,content,options:prepared.options,settings,...(overrides?{overrides}:{})});
 return{settings,job,receipt,prepared,resolve};
}
function liveSchema(names=['품명 및 모델명','재질','제조자(수입자)','A/S 책임자와 전화번호','세탁방법 및 취급시 주의사항','제조년월','출시년월']){
 const named=entries=>({type:'array',items:{},allOf:entries.map(name=>({contains:{type:'object',properties:{noticeItemName:{type:'string',enum:[name]},noticeItemValue:{type:'string'}},required:['noticeItemName','noticeItemValue']}}))});
 return {format:'supplier-hub-schema-v1',categoryId:'81452',categoryPath:paths['81452'],company:{code:'A01464742',name:'와이홉'},observedAt:Date.parse(now),metadata:{kanCategoryId:700,scopeType:'Retail_Categorized_Single',noticeNumber:25,version:188},inputBindings:'couplus-paths-v1',draftInitialization:'couplus-required-v1',settingsInitialization:'couplus-options-v1',schemaString:JSON.stringify({type:'object',required:['legalPage'],properties:{productPage:{type:'object',properties:{}},legalPage:{type:'object',required:['notices'],properties:{notices:named(names),manufacturer:{type:'string',title:'제조자(수입자)'},kcMarkType:{type:'string',title:'인증마크'}}}}})};
}

test('new recorded basket notices start separately from supplier facts, stage-six drafts and product manufacturer settings',()=>{
 const f=fixture(),row=f.resolve().rows[1];
 for(const id of ['noticeNameModel','noticeMaterial','noticeComponents','noticeDimensions','noticeManufacturerImporter','noticeCountryOfOrigin','noticeImportDeclaration','noticeQualityAssurance'])assert.equal(row.fields[id].value,'해당사항없음',id);
 assert.equal(row.fields.noticeServiceContact.value,'캡처 연락처');assert.equal(row.fields.noticeServiceContact.source,'settings');
 assert.equal(row.fields.noticeReleaseDate.value,'2026.09');assert.equal(row.fields.manufacturer.value,'캡처 제조사');
 assert.equal(f.prepared.content.label.manufacturer.value,'캡처 제조사');assert.equal(f.prepared.content.label.importer.value,'캡처 수입사');assert.equal(f.prepared.content.label.material.value,'尼龙');
 assert.equal(f.prepared.product.title,'原文商品名');assert.equal(f.receipt.attributes[0].value,'尼龙');assert.equal(f.prepared.content.label.productName.value,'原文商品名');
});

test('recorded sports notice identity excludes certification scalars while its initial colour, specifications and dimensions remain N/A',()=>{
 const f=fixture('81452'),row=f.resolve().rows[1],ids=f.prepared.content.initialLegalNotices.fields.map(field=>field.fieldId);
 for(const id of ['noticeNameModel','brace_noticeKc','brace_noticeColor','brace_noticeSizeWeight','brace_noticeSpecifications','noticeMaterial','noticeManufacturerImporter'])assert.equal(row.fields[id].value,'해당사항없음',id);
 for(const id of ['kcMarkType','kcCertificationNumber','emcCertificationNumber','safetyDeclarationNumber','kcsCertificationNumber'])assert.ok(!ids.includes(id));
 assert.equal(row.fields.color.value,'黑色');assert.equal(f.prepared.options.rows[0].size,'M');
});

test('exact named legal array alone receives the initial policy, including only the first date and captured A/S and washing exceptions',()=>{
 const snapshot=liveSchema(),f=fixture('81452',snapshot),resolved=f.resolve(),row=resolved.rows[1];
 const notice=name=>resolved.schema.fields.find(field=>JSON.stringify(field.hubWire?.path)==='["legalPage","notices"]'&&field.hubWire.name===name);
 for(const name of ['품명 및 모델명','재질','제조자(수입자)'])assert.equal(row.fields[notice(name).id].value,'해당사항없음');
 assert.equal(row.fields[notice('A/S 책임자와 전화번호').id].value,'캡처 연락처');
 assert.equal(row.fields[notice('세탁방법 및 취급시 주의사항').id].value,'세탁방법: 손세탁, 취급시 주의사항: 화기 주의');
 assert.equal(row.fields[notice('제조년월').id].value,'2026.09');assert.equal(row.fields[notice('출시년월').id].value,'해당사항없음');
 assert.ok(f.prepared.content.initialLegalNotices.fields.every(entry=>{const field=resolved.schema.fields.find(field=>field.id===entry.fieldId);return JSON.stringify(field.hubWire.path)==='["legalPage","notices"]';}));
 const controls=plain(resolved.schema),actual=notice('재질');
 controls.fields.push({...actual,id:'same-label-other-array',hubWire:{...actual.hubWire,path:['legalPage','otherNotices']}},{...actual,id:'same-label-scalar',hubWire:{path:['legalPage','material']}});
 const isolated=helper.createInitialLegalNotices(controls,f.settings,now);
 assert.ok(!isolated.fields.some(field=>['same-label-other-array','same-label-scalar'].includes(field.fieldId)));
 const alternate=(name,id)=>{const field=plain(notice(name));return {...field,id,hubWire:{...field.hubWire,nameKey:'alternateName',valueKey:'alternateValue'}};};
 controls.fields.unshift(alternate('제조년월','alternate-date-first'),alternate('A/S 책임자와 전화번호','alternate-contact'),alternate('세탁방법 및 취급시 주의사항','alternate-washing'));
 const mixed=helper.createInitialLegalNotices(controls,f.settings,now);
 for(const id of ['alternate-date-first','alternate-contact','alternate-washing']){const field=mixed.fields.find(entry=>entry.fieldId===id);assert.equal(field.value,'해당사항없음');assert.equal(field.source,'couplus-default');}
 assert.equal(mixed.fields.find(entry=>entry.fieldId===notice('제조년월').id).value,'2026.09','an earlier alternate name key cannot hide the first canonical date');
 assert.equal(helper.readInitialLegalNotices(mixed,controls).size,mixed.fields.length);
 const forged=plain(mixed);Object.assign(forged.fields.find(entry=>entry.fieldId==='alternate-contact'),{value:'위조 설정 연락처',source:'settings'});assert.equal(helper.readInitialLegalNotices(forged,controls).size,0);
});

test('blank captured settings keep N/A and an explicit truthy N/A setting retains its settings origin',()=>{
 const schema=schemas.getQuotationSchema('80719',paths['80719']);
 for(const settings of [{},{serviceContact:'',washingMethod:'',handlingPrecautions:'',manufactureDatePreviousMonth:false}]){
  const marker=helper.createInitialLegalNotices(schema,settings,now);assert.ok(marker.fields.every(entry=>entry.value==='해당사항없음'));
 }
 const marker=helper.createInitialLegalNotices(schema,{serviceContact:'해당사항없음'},now),entry=marker.fields.find(field=>field.fieldId==='noticeServiceContact');
 assert.equal(entry.value,'해당사항없음');assert.equal(entry.source,'settings');
 assert.equal(helper.createInitialLegalNotices(schema,{manufactureDatePreviousMonth:true},'invalid').fields.find(field=>field.fieldId==='noticeReleaseDate').value,'해당사항없음');
});

test('new quotation notice date uses product creation time while the independent stage-six draft retains its captured-time rule',()=>{
 const f=fixture();f.job.context.capturedAt='2026-09-18T01:00:00.000Z';
 const prepared=load('app/collection-product.ts').prepareCollectionProduct('owner',f.job,f.receipt,'product',now);
 assert.equal(prepared.content.label.releaseDate.value,'2026.08');
 assert.equal(prepared.content.initialLegalNotices.fields.find(field=>field.fieldId==='noticeReleaseDate').value,'2026.09');
});

test('SEO and stage-six saves, including unchanged labels and blanks, preserve the new quotation initial snapshot',()=>{
 const f=fixture(),original=plain(f.prepared.content.initialLegalNotices);
 for(const patch of [{seo:{title:'한국어 SEO 상품'}},{label:{material:f.prepared.content.label.material.value}},{label:{productName:'',material:'',manufacturer:'',importer:'',contact:'',releaseDate:''}}]){
  const content=contentModel.applyContentPatch(f.prepared.content,patch,'2026-10-18T02:00:00.000Z');
  assert.deepEqual(plain(content.initialLegalNotices),original);
  const row=f.resolve(content).rows[1];assert.equal(row.fields.noticeNameModel.value,'해당사항없음');assert.equal(row.fields.noticeMaterial.value,'해당사항없음');assert.equal(row.fields.noticeManufacturerImporter.value,'해당사항없음');assert.equal(row.fields.noticeServiceContact.value,'캡처 연락처');
 }
});

test('stage-seven common and option overrides, including deliberate blanks, keep their established priority',()=>{
 const f=fixture(),id=f.prepared.options.rows[0].id,overrides={common:{noticeMaterial:'사람이 확인한 재질',noticeServiceContact:''},options:{[id]:{noticeMaterial:''}}};
 const row=f.resolve(f.prepared.content,overrides).rows[1];assert.equal(row.fields.noticeMaterial.value,'');assert.equal(row.fields.noticeMaterial.source,'manual-option');assert.equal(row.fields.noticeServiceContact.value,'');assert.equal(row.fields.noticeServiceContact.source,'manual-common');assert.equal(row.fields.noticeNameModel.value,'해당사항없음');
});

test('legacy products without a snapshot retain prior label linkage rather than receiving a new initial policy on read',()=>{
 const f=fixture(),content=structuredClone(f.prepared.content);delete content.initialLegalNotices;
 const before=JSON.stringify(content),row=f.resolve(content).rows[1];assert.equal(row.fields.noticeMaterial.value,'尼龙');assert.equal(row.fields.noticeNameModel.value,'原文商品名 / RAW-700');assert.match(row.fields.noticeManufacturerImporter.value,/캡처 제조사/);assert.equal(JSON.stringify(content),before);
});

test('category, named-field identity, ordering and malformed marker changes never grant initial-notice authority',()=>{
 const f=fixture(),schema=schemas.getQuotationSchema('80719',paths['80719']),marker=f.prepared.content.initialLegalNotices;
 const mutations=[value=>{value.categoryId='81452';},value=>{value.categoryPath=['other'];},value=>{value.fields.reverse();},value=>{value.fields.pop();},value=>{value.fields[0].signature='changed';},value=>{value.fields[0].value='fabricated';},value=>{value.fields[0].source='settings';},value=>{value.fields[0].source=['settings'];},value=>{value.fields[0].extra=true;},value=>{value.extra=true;}];
 for(const mutate of mutations){const copy=plain(marker);mutate(copy);assert.equal(helper.readInitialLegalNotices(copy,schema).size,0);}
 const changed=plain(schema);changed.fields.find(field=>field.id==='noticeMaterial').required=true;assert.equal(helper.readInitialLegalNotices(marker,changed).size,0);
 assert.equal(helper.createInitialLegalNotices(schemas.getQuotationSchema(null),{},now),undefined);
});

test('the initial snapshot remains server-owned and its helpers do not mutate input schema or settings',()=>{
 const f=fixture(),schema=schemas.getQuotationSchema('80719',paths['80719']),before=JSON.stringify({schema,settings:f.settings});
 const marker=helper.createInitialLegalNotices(schema,f.settings,now);assert.equal(helper.readInitialLegalNotices(marker,schema).size,10);assert.equal(JSON.stringify({schema,settings:f.settings}),before);
 assert.throws(()=>contentModel.validateContentInput({expectedRevision:1,patch:{initialLegalNotices:marker}},[],'owner'),/지원하지 않는/);
});
