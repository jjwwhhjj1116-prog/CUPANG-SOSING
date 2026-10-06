import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';

const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
// Run the real document renderer. A small Canvas adapter records text and
// rasterizes its drawing commands through sharp; this is not browser font QA.
function pixelRenderer(load){
 const drawings=[];
 const document={fonts:{load:async()=>[],ready:Promise.resolve()},createElement(tag){
  assert.equal(tag,'canvas');const commands=[],texts=[],canvas={width:0,height:0};
  const context={font:'24px sans-serif',fillStyle:'#000000',strokeStyle:'#000000',lineWidth:1,
   measureText(value){return{width:Array.from(value).length*Number(/(\d+)px/.exec(this.font)[1])*0.7};},
   fillRect(x,y,width,height){commands.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${this.fillStyle}"/>`);},
   strokeRect(x,y,width,height){commands.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${this.strokeStyle}" stroke-width="${this.lineWidth}"/>`);},
   fillText(value,x,y){const size=Number(/(\d+)px/.exec(this.font)[1]);texts.push(value);commands.push(`<text x="${x}" y="${y+size}" font-family="sans-serif" font-size="${size}" fill="${this.fillStyle}">${escape(value)}</text>`);},
  };
  canvas.getContext=kind=>{assert.equal(kind,'2d');return context;};
  canvas.toBlob=(callback,mime)=>{assert.equal(mime,'image/png');const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">${commands.join('')}</svg>`;sharp(Buffer.from(svg)).png().toBuffer().then(bytes=>{drawings.push({texts,bytes});callback(new Blob([bytes],{type:mime}));},()=>callback(null));};
  return canvas;
 }};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/document-image-render.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,document,Blob,require:name=>{assert.equal(name,'@/app/document-image');return load('app/document-image.ts');}});
 return{renderDocument:exports.renderDocument,drawings};
}
function snapshot(company){
 // Small sanitized fragment of the observed 69900 paths. No private full
 // schema/workbook is needed in CI and this workbook is never sent to Hub.
 const named=(name)=>({contains:{type:'object',properties:{attributeName:{type:'string',enum:[name]},attributeValue:{type:'string'}}}});
 return{format:'supplier-hub-schema-v1',categoryId:'69900',categoryPath:['패션의류잡화','유니섹스/남녀공용 패션','공용 잡화','선글라스','남녀공용패션선글라스'],company,observedAt:Date.now(),inputBindings:'couplus-paths-v1',
  metadata:{displayCategoryCode:'69900',kanCategoryId:2624,scopeType:'Retail_Categorized_Single',noticeNumber:4,version:188},
  schemaString:JSON.stringify({type:'object',properties:{
   startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'}}},
   productPage:{type:'object',properties:{brand:{type:'string',title:'브랜드'},
    commonAttributes:{type:'object',properties:{exposedAttributes:{type:'array',allOf:[named('색상'),named('패션의류/잡화 사이즈')]}}},
    unexposedAttributes:{type:'array',allOf:[named('렌즈 색상')]}}},
   legalPage:{type:'object',properties:{}},
  }})};
}

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`saved live option attributes reach label pixels, revision recovery and quotation XLSX (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});let ui;
 try{
  const hubSchema=snapshot(company),schema=h.load('app/quotation-schema.ts').getQuotationSchema(hubSchema.categoryId,hubSchema.categoryPath,hubSchema);
  const headers=['skuId',...schema.fields.map(field=>field.id)],workbook=quotationWorkbook(headers),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile={name:'라벨 연동 시험',categoryId:hubSchema.categoryId,categoryPath:hubSchema.categoryPath,hubSchema,template:{name:'synthetic-label.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers},mappings:headers.map((field,column)=>({field,column,required:false}))};
  await h.load('db/category-profiles.ts').createCategoryProfile('owner',profile,'cat');h.context.category={...profile,id:'cat'};h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare("UPDATE collection_jobs SET goal='work'").run();await h.intake();
  const product=()=>h.sqlite.prepare('SELECT * FROM products').get(),id=product().id,base='/api/products/'+id,endpoint=base+'/quotation-fields';
  const receipt=h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,context=h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,policy=product().pricing_policy;
  const content=(await json(await h.route(base+'/content'))).content,existingLabel=JSON.parse(product().image_keys)[3];
  const assets=Object.fromEntries(Object.entries(content.assets).map(([role,field])=>[role,role==='label'?[existingLabel]:field.value.filter(key=>key!==existingLabel)]));
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{material:''},labelClears:['material'],assets}}}));
  let view=await json(await h.route(endpoint));const color=view.resolved.schema.fields.find(field=>field.hubWire?.name==='색상'),size=view.resolved.schema.fields.find(field=>field.hubWire?.name==='패션의류/잡화 사이즈'),hidden=view.resolved.schema.fields.find(field=>field.hubWire?.name==='렌즈 색상');
  const included=view.resolved.rows.filter(row=>row.included),firstId=included[0].optionId,blankId=included[1].optionId;
  const save=changes=>h.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}).then(json);
  view=await save([{fieldKey:color.id,optionId:null,value:'공통 갈색'},{fieldKey:color.id,optionId:firstId,value:'옵션 녹색'},{fieldKey:color.id,optionId:blankId,value:''},{fieldKey:size.id,optionId:null,value:'검토 크기'},{fieldKey:size.id,optionId:blankId,value:''},{fieldKey:hidden.id,optionId:null,value:'라벨에 추가하지 않는 비노출값'}]);
  const plan=h.load('app/quotation-label-plan.ts'),firstPlan=plan.quotationLabelPlan(view.resolved,firstId),blankPlan=plan.quotationLabelPlan(view.resolved,blankId);
  assert.equal(firstPlan.rows.find(row=>row[0]===color.label)?.[1],'옵션 녹색','saved live option color must appear in PNG');
  assert.equal(blankPlan.rows.find(row=>row[0]===color.label)?.[1],'[공란]');assert.equal(blankPlan.rows.find(row=>row[0]===size.label)?.[1],'[공란]');assert.ok(!firstPlan.rows.some(row=>row[0]===hidden.label));
  const firstUploadId=await h.load('app/quotation-label-upload.ts').quotationLabelUploadId({productId:id,endpoint,view,optionId:firstId}),reviewedView=view;
  const get=h.bindings.FILES.get;h.bindings.FILES.get=async(key,options)=>{const object=await get(key);if(!object)return null;const bytes=new Uint8Array(await object.arrayBuffer());return{...object,body:new Response(bytes.slice(0,options?.range?.length??bytes.length)).body};};
  const calls=[],renderer=pixelRenderer(h.load),request=async(path,init={})=>{calls.push({path,method:init.method??'GET'});return path==='/api/files'?h.load('app/api/files/route.ts').POST(new Request('https://app.test/api/files',{method:'POST',body:init.body})):h.route(path,{method:init.method??'GET',...(typeof init.body==='string'?{body:JSON.parse(init.body)}:{})});};
  const open=()=>quotationLabelFormUI({productId:id,load:h.load,request,renderDocument:renderer.renderDocument});ui=open();await ui.idle();await ui.click('전체 포함 옵션 라벨 생성·연결');assert.deepEqual(ui.alerts(),[]);assert.equal(renderer.drawings.length,6);assert.equal(calls.filter(call=>call.path==='/api/files').length,6);
  view=ui.view;const labels=view.resolved.rows.filter(row=>row.included).map(row=>row.fields.labelImages.value.split('\n'));assert.ok(labels.every(keys=>keys.length===2&&keys[0]===existingLabel));
  assert.ok(renderer.drawings[0].texts.includes('옵션 녹색'));assert.ok(renderer.drawings[1].texts.includes('[공란]'));
  const initialBytes=h.objects.get(labels[0][1]),meta=await sharp(initialBytes).metadata(),stats=await sharp(initialBytes).stats();assert.equal(meta.format,'png');assert.equal(meta.width,1200);assert.ok(meta.height>1000);assert.ok(stats.channels.some(channel=>channel.min<200&&channel.max===255));
  ui.close();view=await save([{fieldKey:color.id,optionId:firstId,value:'옵션 파랑'}]);assert.notEqual(await h.load('app/quotation-label-upload.ts').quotationLabelUploadId({productId:id,endpoint,view,optionId:firstId}),firstUploadId,'same option ID with revised saved color needs a different PNG');
  await assert.rejects(h.load('app/quotation-label-attachment.ts').attachQuotationLabel({productId:id,endpoint,renderedView:reviewedView,optionId:firstId,blob:null,uploadedKey:labels[0][1],onUploaded(){}},request),/변경/);
  ui=open();await ui.idle();await ui.click('전체 포함 옵션 라벨 생성·연결');assert.deepEqual(ui.alerts(),[]);assert.equal(renderer.drawings.length,7);assert.equal(calls.filter(call=>call.path==='/api/files').length,7,'only revised option uploads a new PNG');view=ui.view;
  const revisedKeys=view.resolved.rows.find(row=>row.optionId===firstId).fields.labelImages.value.split('\n');assert.deepEqual(revisedKeys.slice(0,2),labels[0]);assert.notDeepEqual(h.objects.get(revisedKeys[2]),initialBytes);assert.ok(renderer.drawings[6].texts.includes('옵션 파랑'));ui.close();
  const options=(await json(await h.route(base+'/options'))).options,optionRows=h.load('app/product-options.ts').optionInputs(options);optionRows[5].included=false;await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.revision,expectedProductVersion:product().updated_at,rows:optionRows}}));
  ui=open();await ui.idle();await ui.click('전체 포함 옵션 라벨 생성·연결');assert.deepEqual(ui.alerts(),[]);assert.equal(renderer.drawings.length,7);assert.throws(()=>plan.quotationLabelPlan(ui.view.resolved,optionRows[5].id),/포함/);
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}})),bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200,await bundle.clone().text());
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer()),document=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json'))),upload=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))),sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(upload.quotation.file.filename)));
  assert.equal(document.rows.length,5);assert.equal(document.excludedOptions[0].optionId,optionRows[5].id);
  for(const [index,row]of document.rows.entries()){const cells=reader.xlsxHeaders(sheet,'견적서',index+2);assert.equal(cells[headers.indexOf(color.id)],index===0?'옵션 파랑':index===1?'':'공통 갈색');const keys=row.fields.labelImages.value.split('\n');assert.equal(cells[headers.indexOf('labelImages')],keys.map(key=>document.uploadFilenames[key]).join('\n'));for(const key of keys){const file=upload.labelImages.find(file=>file.filename===document.uploadFilenames[key]);assert.deepEqual(Buffer.from(files.get(file.archivePath)),Buffer.from(h.objects.get(key)));}}
  const labelHtml=new TextDecoder().decode(files.get('quotation-labels.html'));assert.match(labelHtml,/옵션 파랑/);assert.match(labelHtml,/\[공란\]/);assert.doesNotMatch(labelHtml,/라벨에 추가하지 않는 비노출값/);
  assert.equal((await json(await h.route(base+'/content'))).content.label.material.value,'');assert.equal(product().pricing_policy,policy);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload,receipt);assert.equal(h.sqlite.prepare('SELECT payload FROM collection_context').get().payload,context);assert.equal(product().supplier_hub_status,'미전송');
 }finally{ui?.close();h.close();}
});
