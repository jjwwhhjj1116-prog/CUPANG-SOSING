import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';
const native=createRequire(import.meta.url),plain=value=>JSON.parse(JSON.stringify(value));
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
function ui(file,h){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports,Error,URL,Intl,require(name){if(name.endsWith('.css'))return{};if(name.startsWith('@/app/components/')){const file=name.slice(2);return ui(file+(fs.existsSync(new URL('../'+file+'.tsx',import.meta.url))?'.tsx':'.ts'),h);}return name.startsWith('@/')?h.load(name.slice(2)+'.ts'):native(name);}});return exports;}
const retain=h=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','category_profiles','collection_context'].map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()));
async function fixture(company,live){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});try{
  let hubSchema;if(live){hubSchema=hubSchemaSnapshot(company);const raw=JSON.parse(hubSchema.schemaString);raw.properties.imagePage.properties.images={type:'object',properties:{mainImage:{type:'string',title:'대표 이미지'},additionalImage:{type:'string',title:'추가 이미지'}}};raw.properties.imagePage.properties.details={type:'object',properties:{detailedImage:{type:'string',title:'상세 이미지'}}};hubSchema={...hubSchema,inputBindings:'couplus-paths-v1',schemaString:JSON.stringify(raw)};}
  const schema=h.load('app/quotation-schema.ts').getQuotationSchema(live?'991234':'80719',live?schemaPath:h.context.category.categoryPath,hubSchema),fields=schema.fields.map(field=>field.id),bytes=new Uint8Array(quotationWorkbook(fields)),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex'),storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');
  await h.bindings.FILES.put(storageKey,bytes,{customMetadata:{sha256,format:'xlsx'}});
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'최종 등록표 정상 흐름 시험',categoryId:schema.categoryId,categoryPath:schema.categoryPath,...(hubSchema?{hubSchema}:{}),template:{name:'final-board.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(h.context),'job');await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,content=(await json(await h.route(base+'/content'))).content,keys=JSON.parse(product.image_keys);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{seo:{title:'이전 공통 제목'},assets:{main:[keys[0]],additional:[keys[1]],detail:[keys[2]],label:[keys[3]]}}}}));
  let view=await json(await h.route(base+'/quotation-fields'));const targets=Object.fromEntries(['title','mainImage','additionalImages','detailImages','labelImages'].map(input=>[input,h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(view.resolved.schema.fields,input).primary]));
  const save=async changes=>{view=await json(await h.route(base+'/quotation-fields'));return view=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));};
  const list=async()=>{const body=await json(await h.load('app/api/products/route.ts').GET());return body.products.find(row=>row.id===product.id);};
  return{h,product,base,keys,targets,save,list,get view(){return view;},profile,bytes,storageKey};
 }catch(error){h.close();throw error;}
}

for(const company of schemaCompanies)for(const live of [false,true])test(`stage-seven final names and images reach registration rows, option rows and quotation preview (${company.code}, ${live?'exact Hub aliases':'canonical'})`,async()=>{
 const f=await fixture(company,live);try{
  const included=f.view.resolved.rows.filter(row=>row.optionId&&row.included),[first,second]=included,content=f.h.sqlite.prepare('SELECT payload FROM product_content').get().payload,options=f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload;
  await f.save(['title','mainImage','additionalImages','detailImages','labelImages'].flatMap(input=>[
   {optionId:null,fieldKey:f.targets[input],value:input==='title'?'공통 최종 견적 제목':f.keys[{mainImage:4,additionalImages:5,detailImages:6,labelImages:7}[input]]},
   {optionId:first.optionId,fieldKey:f.targets[input],value:input==='title'?'첫 옵션 직접 검토 제목':input==='additionalImages'?'':f.keys[{mainImage:8,detailImages:9,labelImages:10}[input]]},
   {optionId:second.optionId,fieldKey:f.targets[input],value:''},
  ]));
  const before=retain(f.h),listed=await f.list(),summary=listed.content_summary,board=ui('app/components/registration-board.tsx',f.h),optionBoard=await ui('app/components/product-option-board.tsx',f.h).readOptionBoard(f.product.id,new AbortController().signal,(path,init)=>f.h.route(path,{method:init?.method??'GET'}));
  assert.equal(summary.seoTitle,'첫 옵션 직접 검토 제목','the upper registration row must display the current final name, not the previous shared SEO title');assert.equal(board.registrationTitle(listed),'첫 옵션 직접 검토 제목');assert.equal(summary.mainImageKey,f.keys[8]);assert.equal(board.registrationThumbnail(listed),'/api/files/'+f.keys[8]);
  for(const [role,input]of [['main','mainImage'],['additional','additionalImages'],['detail','detailImages'],['label','labelImages']]){
   const values=f.view.resolved.rows.filter(row=>row.included).flatMap(row=>row.fields[f.targets[input]].value.split('\n').filter(Boolean));assert.equal(summary[role],new Set(values).size);assert.equal(board.registrationStepLabel(listed,{main:'대표 이미지',additional:'추가 이미지',detail:'상세 이미지',label:'표시사항'}[role]),'대기','an included blank final row keeps the stage pending even when other rows have images');
   for(const row of included)assert.deepEqual(plain(optionBoard.quotationContent[row.optionId][role]),f.view.resolved.rows.find(value=>value.optionId===row.optionId).fields[f.targets[input]].value.split('\n').filter(Boolean));
  }
  const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));assert.equal(preview.rows[0][f.profile.template.headers.indexOf(f.targets.title)],summary.seoTitle);
  const originalBytes=new Map([...f.h.objects].map(([key,bytes])=>[key,bytes.slice()])),exported=await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'export',profileId:f.profile.id,fingerprint:preview.fingerprint}});assert.equal(exported.status,200,await exported.clone().text());
  const zip=readPackageZip(new Uint8Array(await exported.arrayBuffer())),reader=f.h.load('app/xlsx-template.ts'),workbook=reader.inspectXlsxArchive(await reader.readXlsxArchive(zip.get(preview.filename).slice().buffer));
  for(const input of ['title','mainImage','additionalImages','detailImages','labelImages']){const column=f.profile.template.headers.indexOf(f.targets[input]);assert.equal(reader.xlsxHeaders(workbook,'견적서',2)[column]??'',String(preview.rows[0][column]??''));}
  for(const [key,bytes]of originalBytes)assert.deepEqual(f.h.objects.get(key),bytes,'preparing the file preserves every original image and workbook byte');
  const markup=renderToStaticMarkup(React.createElement(board.RegistrationBoard,{products:[listed],selected:new Set(),onSelected(){},onOpen(){},loading:false,error:'',onArchive(){}}));assert.match(markup,/첫 옵션 직접 검토 제목/);assert.doesNotMatch(markup,/이전 공통 제목/);assert.ok(markup.includes('/api/files/'+f.keys[8]));assert.equal(board.registrationTransmissionLabel(listed),'등록대기');
  assert.equal(retain(f.h),before);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_content').get().payload,content);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);assert.deepEqual(f.h.objects.get(f.storageKey),f.bytes);
  await f.save(['title','mainImage','additionalImages','detailImages','labelImages'].flatMap(input=>f.view.resolved.rows.filter(row=>row.optionId&&row.included).map(row=>({optionId:row.optionId,fieldKey:f.targets[input],value:''}))));
  const clearedBefore=retain(f.h),cleared=await f.list();assert.equal(cleared.content_summary.seoTitle,'');assert.equal(board.registrationTitle(cleared),'상품명 미입력');assert.equal(cleared.content_summary.mainImageKey,null);for(const role of ['main','additional','detail','label'])assert.equal(cleared.content_summary[role],0);assert.equal(cleared.content_summary.missingImages,false);
  assert.equal(board.registrationTransmissionLabel(cleared),'등록대기');assert.equal(retain(f.h),clearedBefore);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_content').get().payload,content);assert.equal(f.h.sqlite.prepare('SELECT payload FROM product_options').get().payload,options);assert.ok(!f.h.network.includes('supplier.coupang.com'));
 }finally{f.h.close();}
});

for(const company of schemaCompanies)test(`excluded rows do not replace the first included final title or image (${company.code})`,async()=>{
 const f=await fixture(company,false);try{
  const current=await json(await f.h.route(f.base+'/options')),names=Object.keys(f.h.load('app/product-options.ts').optionFieldNames),excluded=current.options.rows[0].id,selected=current.options.rows[1].id;
  await json(await f.h.route(f.base+'/options',{method:'PATCH',body:{expectedRevision:current.options.revision,expectedProductVersion:current.productVersion,rows:current.options.rows.map(row=>({id:row.id,...Object.fromEntries(names.map(name=>[name,row[name]])),included:row.id!==excluded}))}}));
  await f.save([{optionId:null,fieldKey:f.targets.title,value:'공통 검토 제목'},{optionId:excluded,fieldKey:f.targets.title,value:'제외된 옵션 제목'},{optionId:selected,fieldKey:f.targets.title,value:'첫 포함 옵션 제목'},
   {optionId:null,fieldKey:f.targets.mainImage,value:f.keys[4]},{optionId:excluded,fieldKey:f.targets.mainImage,value:f.keys[10]},{optionId:selected,fieldKey:f.targets.mainImage,value:f.keys[8]}]);
  const before=retain(f.h),listed=await f.list(),board=ui('app/components/registration-board.tsx',f.h);assert.equal(board.registrationTitle(listed),'첫 포함 옵션 제목');assert.equal(board.registrationThumbnail(listed),'/api/files/'+f.keys[8]);assert.equal(listed.content_summary.main,2);
  const preview=await json(await f.h.route(f.base+'/quotation',{method:'POST',body:{action:'preview',profileId:f.profile.id}}));assert.equal(preview.rows[0][f.profile.template.headers.indexOf(f.targets.title)],listed.content_summary.seoTitle);assert.equal(retain(f.h),before);assert.equal(board.registrationTransmissionLabel(listed),'등록대기');assert.ok(!f.h.network.includes('supplier.coupang.com'));
 }finally{f.h.close();}
});

test('readonly targets, scoped common blanks and optionless/deleted option contracts retain their resolved meaning',()=>{
 const h=mobileIntakeHarness();try{
  const schema=h.load('app/quotation-schema.ts'),get=schema.getQuotationSchema;schema.getQuotationSchema=(...args)=>{const value=get(...args);return{...value,fields:value.fields.map(field=>['title','mainImage','additionalImages','detailImages','labelImages'].includes(field.id)?{...field,readOnly:true}:field)};};
  const model=h.load('app/registration-content-summary.ts'),content=h.load('app/product-content.ts').emptyProductContent('p'),product={id:'p',image_keys:JSON.stringify(['owner/auto','owner/option','owner/manual'])};content.seo.title.value='자동 제목';content.assets.main.value=['owner/auto'];
  const input={ownerId:'owner',categoryId:'80719',categoryPath:h.context.category.categoryPath,options:{revision:1,rows:[{id:'included',included:true,imageKey:'owner/option'},{id:'excluded',included:false,imageKey:'owner/manual'}]},state:{overrides:{common:{},options:{}},categoryOverrides:{'category:80719':{common:{title:'직접 수정 무시',mainImage:'owner/manual'},options:{included:{title:'',mainImage:''}}}}}};
  let summary=model.registrationContentSummary(product,content,input);assert.equal(summary.seoTitle,'자동 제목');assert.equal(summary.mainImageKey,'owner/option');assert.equal(summary.main,1);
  schema.getQuotationSchema=get;input.options={revision:0,rows:[]};input.state.categoryOverrides['category:80719']={common:{title:'',mainImage:'',additionalImages:'',detailImages:'',labelImages:''},options:{}};
  summary=model.registrationContentSummary(product,content,input);assert.equal(summary.seoTitle,'');assert.equal(summary.mainImageKey,null);assert.equal(summary.main,0);assert.equal(summary.missingImages,false,'explicit common blanks do not recover old common assignments');
  input.options={revision:1,rows:[]};summary=model.registrationContentSummary(product,content,input);assert.equal(summary.seoTitle,'자동 제목');for(const role of ['main','additional','detail','label'])assert.equal(summary[role],0,'deleted option arrays do not invent an optionless export row');
  input.options={revision:1,rows:[{id:'excluded',included:false,imageKey:'owner/manual'}]};summary=model.registrationContentSummary(product,content,input);assert.equal(summary.seoTitle,'자동 제목');assert.equal(summary.main,0);
 }finally{h.close();}
});
