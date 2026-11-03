import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {aiFixture,companies,mockProvider} from './quotation-ai.mjs';
import {loadComposite} from './detail-image-composite.mjs';
import {packagingResponse,packagingItem} from './quotation-packaging-provider.mjs';
import {config} from './supplier-hub-single-assets.mjs';
import {step920PixelCanvas} from './step920-pixel-canvas.mjs';
export {companies};
const json=async(response)=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const translations=[['合成硅胶保护带','합성 실리콘 보호대'],['硅胶保护带','실리콘 보호대'],['材质','재질'],['数量','수량'],['1个','1개'],['硅胶','실리콘'],['黑色','검정']];

/** Actual local API/SQLite/client modules. Supplier/model replies and browser
 * Canvas/Worker primitives are inert; no stage adapter or result is replaced. */
export async function selectedWorkflowFixture(company=companies[0],{completeInputs=false,foreignTextImages=false,qwenSeo=false,initialSnapshot}={}){
 const boundaries=[],requests=[],events=[],keys=new Map(),initialInputs=[];let stage='setup';
 const imageUrls=Array.from({length:3},(_,index)=>`https://cbu01.alicdn.com/step920-synthetic-${index}.png`);
 const imageBytes=await Promise.all(imageUrls.map((_,index)=>{const height=index<2?800:600,image=sharp({create:{width:800,height,channels:4,background:{r:180+index*20,g:200,b:220,alpha:1}}});return(foreignTextImages?image.composite([{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}"><text x="24" y="39" font-size="20" fill="black">中文</text></svg>`)}]):image).png().toBuffer();}));
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name,
  fixtureImageUrls:imageUrls,fixtureImageBytes:imageBytes,
  sourceFetcher:async()=>assert.fail('Supplier access is forbidden'),
  translationFetcher:async(target)=>{const original=new URL(target).searchParams.get('q');assert.equal(typeof original,'string');let translated=original;for(const[from,to]of translations)translated=translated.replaceAll(from,to);boundaries.push({stage,type:'google-translation',original});return Response.json([[[translated,original,null,null,10]],null,'zh-CN']);}});
 try{
  Object.assign(h.bindings,{SOURCEFLOW_TEXT_PROVIDER:'google-free',SOURCEFLOW_QUOTATION_AI_PROVIDER:'workers-ai',SOURCEFLOW_QUOTATION_AI_FREE_ONLY:'true',YOOFAM_AUTH_ENABLED:'true',
   SOURCEFLOW_IMAGE_TEXT_PROVIDER:'workers-ai-vision',SOURCEFLOW_IMAGE_TEXT_MODEL:'@cf/qwen/qwen3.8-27b',SOURCEFLOW_IMAGE_TEXT_PAID_ALLOWED:'true',YOOFAM_DETAIL_IMAGE_SECRET:config.secret,YOOFAM_DETAIL_IMAGE_ORIGIN:config.origin});
  if(qwenSeo)Object.assign(h.bindings,{SOURCEFLOW_TEXT_PROVIDER:'workers-ai',SOURCEFLOW_TEXT_MODEL:'@cf/qwen/qwen3-30b-a3b-fp8',SOURCEFLOW_TEXT_MAX_OUTPUT_TOKENS:'4096'});
  h.settings.translateImages=true;
  if(completeInputs)Object.assign(h.settings,{taxType:'과세',shelfLifeDays:0,handlingReason:'해당사항없음'});
  const get=h.bindings.FILES.get,put=h.bindings.FILES.put;
  h.bindings.FILES.get=async(...args)=>{const object=await get(...args);if(!object)return null;const range=args[1]?.range,bytes=h.objects.get(args[0]);return{...object,body:new ReadableStream({start(controller){controller.enqueue(range?bytes.slice(range.offset,range.offset+range.length):bytes.slice());controller.close();}})};};
  h.bindings.FILES.put=async(...args)=>{const result=await put(...args);return result===null?null:h.bindings.FILES.head(args[0]);};
  const now=new Date().toISOString(),email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',role=company.code==='A01526306'?'admin':'member';
  h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',email,'synthetic-unused',role,'approved',company.code,company.name,now,now);
  const snapshot=initialSnapshot??aiFixture({company}).snapshot,profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'STEP920 SYNTHETIC NATIVE PROFILE',categoryId:snapshot.categoryId,categoryPath:snapshot.categoryPath,hubSchema:snapshot,template:null,mappings:[]});
  const context={...h.context,category:{...profile},company:{...company}};
  h.sqlite.prepare('UPDATE collection_jobs SET goal=? WHERE id=?').run('work','job');h.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(context),'job');
  const quotationProvider=mockProvider();
  h.bindings.AI.run=async(model,input)=>{
   if(model==='@cf/qwen/qwen3.8-27b'){const foreign=foreignTextImages&&['mainImage','additionalImages','detailImage'].includes(stage);boundaries.push({stage,type:'workers-model',model,task:foreign?'vision-foreign-text':'vision-no-foreign-text'});assert.ok(Array.isArray(input.messages));return{response:foreign?{decision:'foreign-text',blocks:[{original:'中文',translated:'중문',box:{x:20,y:20,width:60,height:24}}]}:{decision:'no-foreign-text',blocks:[]}};}
   if(model==='@cf/qwen/qwen3-30b-a3b-fp8'&&input.messages[1].content.startsWith('Translate the Chinese product data below into Korean.')){
    assert.equal(input.max_tokens,4096);const source=JSON.parse(input.messages[1].content.split('\n\nPRODUCT_SOURCE_JSON:\n')[1].slice(0,-'\n/no_think'.length));boundaries.push({stage,type:'workers-model',model,task:'qwen-integrated-translation'});
    const translate=value=>{for(const[from,to]of translations)value=value.replaceAll(from,to);assert.doesNotMatch(value,/\p{Script=Han}/u);return value;};
    const attributes=source.attributes.map((pair,index)=>({sourceIndex:pair.sourceIndex??index,name:pair.outputName??(/^option(?:-color|-size)?:/u.test(pair.name)?pair.name.startsWith('option-color:')?'색상':pair.name.startsWith('option-size:')?'사이즈':'옵션명':translate(pair.name)),value:translate(pair.value)}));
    return{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({title:'합성 실리콘 보호대',description:'실리콘 보호대 1개',keywords:['실리콘 보호대'],attributes,warnings:[]})}}]};
   }
   const payload=JSON.parse(input.messages[1].content.replace(/\n\/no_think$/u,''));boundaries.push({stage,type:'workers-model',model,task:payload.task??(payload.source?'seo-generation':payload.packages?'packaging':'unknown')});
   if(payload.packages){assert.equal(model,'@cf/qwen/qwen3-30b-a3b-fp8');return packagingResponse(payload.packages.map(item=>packagingItem(item,{weightG:40,widthMm:60,lengthMm:80,heightMm:15})));}
   const envelope=response=>model==='@cf/qwen/qwen3-30b-a3b-fp8'?{choices:[{finish_reason:'stop',message:{role:'assistant',content:response}}]}:{response};
   assert.equal(model,qwenSeo?'@cf/qwen/qwen3-30b-a3b-fp8':'@cf/meta/llama-3.3-70b-instruct-fp8-fast');
   if(payload.task==='KOREAN_LABELS')return envelope(JSON.stringify({content:'1개',material:'실리콘',type:'보호대'}));
   if(payload.task){assert.match(payload.task,/^(?:ANALYZE_SCHEMA_ATTRIBUTES|GET_COMMON_|GET_DIFFERENTIATED_)/u);const result=await quotationProvider.run(model,{...input,messages:[input.messages[0],{...input.messages[1],content:JSON.stringify(payload)}]});return envelope(result.response);}
   assert.ok(payload.source&&payload.memo,'Unexpected synthetic provider contract');return{response:JSON.stringify({title:'검토 브랜드 실리콘 보호대 검정',description:'실리콘 보호대 1개',keywords:['실리콘 보호대'],attributes:[],warnings:[]})};
  };
  const request=async(input,init={})=>{
   const url=String(input),method=init.method??'GET';requests.push({stage,url,method,...(typeof init.body==='string'?{body:JSON.parse(init.body)}:{})});
   const req=()=>{const headers=new Headers(init.headers);if(!['GET','HEAD'].includes(method))headers.set('origin','https://app.test');return new Request('https://app.test'+url,{...init,headers});};
   if(url==='/api/supplier-hub/catalog-context')return h.load('app/api/supplier-hub/catalog-context/route.ts').GET(req());
   if(url.startsWith('/api/settings'))return h.load('app'+new URL(url,'https://app.test').pathname+'/route.ts')[method](req());
   if(url==='/api/files')return h.load('app/api/files/route.ts')[method](req());
   if(url.startsWith('/api/files/'))return h.load('app/api/files/[...key]/route.ts').GET(req(),{params:Promise.resolve({key:new URL(url,'https://app.test').pathname.slice('/api/files/'.length).split('/').map(decodeURIComponent)})});
   const product=new URL(url,'https://app.test').pathname.match(/^\/api\/products\/([A-Za-z0-9_-]+)(\/.*)?$/u);
   if(product)return h.load('app/api/products/[id]'+(product[2]??'')+'/route.ts')[method](req(),{params:Promise.resolve({id:product[1]})});
   return h.route(url,{method,body:init.body});
  };
  await json(await request('/api/settings',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({...h.settings,expectedOwnerId:'owner'})}));
  if(completeInputs)initialInputs.push({source:'explicit synthetic member settings PUT /api/settings',values:{taxType:'과세',shelfLifeDays:0,handlingReason:'해당사항없음'}});
  const receipt={schemaVersion:1,sourceUrl:h.sourceUrl,provider:'synthetic-step920',collectedAt:now,title:'合成硅胶保护带',description:'硅胶保护带，1个',attributes:[{name:'材质',value:'硅胶'},{name:'数量',value:'1个'}],
   options:[{sku:'STEP920-BLACK',name:'黑色',unitPriceCny:7.1,minimumOrder:1,stock:12,imageIndex:0}],images:imageUrls.map((url,index)=>({url,role:['main','additional','detail'][index]}))};
  await json(await request('/api/collection-jobs/job/result',{method:'POST',body:JSON.stringify(receipt)}));
  const imported=await h.load('app/collection-import.ts').runCollectionImport('job',3,{fetcher:request,assignToStage:false,imageBatchSize:3});assert.equal(imported.status,'completed',imported.error);assert.ok(imported.productId);
  const productId=imported.productId,base='/api/products/'+productId;
  const originals=new Map([...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes)]));
  const immutableSource=()=>JSON.stringify(['collection_results','collection_context','collection_products'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table).all()])),sourceBefore=immutableSource();
  if(completeInputs){
   const previous=await json(await request(base+'/quotation-fields'));
   const changes=[{fieldKey:'kcMarkType',optionId:null,value:'해당사항없음'}];
   const saved=await json(await request(base+'/quotation-fields',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedRevision:previous.revision,expectedInputFingerprint:previous.inputFingerprint,changes})}));
   h.load('app/quotation-fields-confirmation.ts').confirmQuotationFieldsSave(previous,saved,changes);
   initialInputs.push({source:'explicit synthetic legal assessment PUT '+base+'/quotation-fields',changes});
  }
  const configuration=(await json(await request(base+'/seo-generation'))).configuration;
  // The shared browser loader parses as TSX; this unchanged non-browser
  // adapter contains an ambiguous generic arrow, so use the existing TS loader.
  const pixel=foreignTextImages?await step920PixelCanvas(imageBytes,row=>boundaries.push({stage,...row})):null;
  const browser=loadComposite({request},{...(pixel?{document:pixel.document}:{}),modules:{'@/app/batch-selected-packaging-work':h.load('app/batch-selected-packaging-work.ts'),...(pixel?{'@/app/free-image-inpaint-client':pixel.inpaintClient}:{})}}),create=browser.document.createElement;
  browser.document.fonts={load:async()=>[],ready:Promise.resolve()};
  if(!pixel)browser.document.createElement=name=>{const canvas=create(name),context=canvas.getContext('2d'),texts=[];context.measureText=text=>({width:Array.from(text).length*(Number(/([0-9.]+)px/u.exec(context.font??'24px')?.[1])||24)*.65});context.fillText=(text,x,y)=>texts.push({text,x,y,font:context.font,color:context.fillStyle});context.strokeRect=()=>{};
   canvas.getContext=()=>context;const encode=canvas.toBlob.bind(canvas);canvas.toBlob=(callback,type,quality)=>{if(!texts.length)return encode(callback,type,quality);boundaries.push({stage,type:'synthetic-canvas',textRows:texts.length});
    const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}"><rect width="100%" height="100%" fill="white"/>${texts.map(row=>`<text x="${row.x}" y="${row.y+24}" font-size="24" font-family="Malgun Gothic,sans-serif" fill="${escape(row.color)}">${escape(row.text)}</text>`).join('')}</svg>`;
    void sharp(Buffer.from(svg)).png().toBuffer().then(bytes=>callback(new Blob([bytes],{type:'image/png'})),()=>callback(null));};return canvas;};
  const runner={},entry='app/batch-selected-work.ts';
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+entry,import.meta.url),'utf8'),{fileName:entry,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports:runner,Error,Date,AbortSignal,Map,Set,JSON,require:name=>name==='@/app/batch-selected-packaging-work'?h.load('app/batch-selected-packaging-work.ts'):browser.load(name.slice(2)+'.ts')},{filename:entry});
  return{h,company,profile,productId,base,requests,boundaries,events,keys,initialInputs,request,originals,immutableSource,sourceBefore,
   async run(stages=['seo','pricing']){stage='preflight';return runner.runSelectedBatchProduct(productId,{stages,mode:'full',expectedOwnerId:'owner',signal:new AbortController().signal,fetcher:request,keys,newKey:randomUUID,seoGenerationConsent:configuration,
    onStage:result=>{stage=result.id;events.push(JSON.parse(JSON.stringify(result)));}});},
   counts(){return{requests:requests.length,catalogContext:requests.filter(row=>row.url==='/api/supplier-hub/catalog-context').length,writes:requests.filter(row=>!['GET','HEAD'].includes(row.method)).length,workersAi:boundaries.filter(row=>row.type==='workers-model').length,google:boundaries.filter(row=>row.type==='google-translation').length,canvas:boundaries.filter(row=>row.type==='synthetic-canvas').length,
    perStage:Object.fromEntries([...new Set(requests.map(row=>row.stage))].map(id=>[id,{requests:requests.filter(row=>row.stage===id).length,catalogContext:requests.filter(row=>row.stage===id&&row.url==='/api/supplier-hub/catalog-context').length,writes:requests.filter(row=>row.stage===id&&!['GET','HEAD'].includes(row.method)).length,workersAi:boundaries.filter(row=>row.stage===id&&row.type==='workers-model').length,google:boundaries.filter(row=>row.stage===id&&row.type==='google-translation').length,canvas:boundaries.filter(row=>row.stage===id&&row.type==='synthetic-canvas').length}]))};},
   close(){h.close();}};
 }catch(error){h.close();throw error;}
}
