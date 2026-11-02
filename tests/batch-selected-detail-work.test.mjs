import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import {fixture, runtime, plain} from './helpers/detail-workspace.mjs';

async function setup({saved=false,excluded=false,account}={}){
 const f=await fixture(account),calls=[],controller=new AbortController();
 f.view.resolved.schema.fields.push({id:'altText',type:'textarea'});
 for(const row of [...f.view.resolved.rows,...f.view.automatic.rows])row.fields.altText={value:'자동 대체 설명',source:'content',issues:[]};
 for(const row of [...f.view.resolved.rows,...f.view.automatic.rows])for(const cell of Object.values(row.fields))cell.source='content';
 f.view.overrides={common:{},options:{}};f.view.resolved.rows[0].fields.detailImages.value='owner/replacement.png';
 if(excluded){for(const part of ['resolved','automatic'])f.view[part].rows.push({...plain(f.view[part].rows[0]),optionId:'excluded',included:false});}
 const r=runtime(f.request),settings={...r.load('app/workspace-settings.ts').newWorkspaceSettings,translateImages:true};
 let company=plain(f.company),intercept;
 const content={productId:'product',schemaVersion:1,revision:3,assets:{detail:{value:['owner/one.png','owner/two.png'],provenance:'collected',updatedAt:null}}};
 const fetcher=async(url,init={})=>{
  calls.push({url,method:init.method??'GET'});const response=await intercept?.(url,init);if(response!==undefined)return response;
  if(url==='/api/settings')return Response.json({scope:{ownerId:'owner',company},settings});
  if(url.includes('/quotation-fields'))return Response.json(f.view);
  if(url.endsWith('/content'))return Response.json({content});
  if(url.includes('/detail-workspace?')&&(init.method??'GET')==='GET'&&new URL(url,'https://fixture.test').searchParams.get('optionId')!=='red')return Response.json({...f.reply(),workspace:null});
  return f.request(url,init);
 };
 const base=runtime(fetcher),exports={};
 assert.ok(fs.existsSync(new URL('../app/batch-selected-detail-work.ts',import.meta.url)),'automatic detail coordinator is missing');
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/batch-selected-detail-work.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,Date,URL,URLSearchParams,AbortController,AbortSignal,setTimeout,clearTimeout,structuredClone,crypto,TextEncoder,Uint8Array,Blob,fetch:fetcher,require:name=>base.load(name.slice(2)+'.ts')});
 const model=exports,vision=base.load('app/image-text-vision.ts'),configuration={provider:'workers-ai-vision',model:vision.IMAGE_TEXT_VISION_MODEL,configured:true,paidAllowed:true,notice:vision.IMAGE_TEXT_VISION_NOTICE};
 const clients=base.load('app/detail-workspace-client.ts');
 if(saved){const selection=f.selection(),before=await clients.readDetailWorkspace(selection,controller.signal,fetcher),input=await clients.createDetailWorkspaceSave(selection,before,f.document());await clients.saveDetailWorkspace(input,{},controller.signal,fetcher);}
 let lastImageReply,applies=0;
 const region={id:'vision-1',text:'原文',translated:'번역 문구',box:{x:1,y:1,width:3,height:3},confidence:100,selected:true,issue:null,translationProvenance:'generated',background:'#ffffff',foreground:'#000000',fontSize:2};
 const deps={
  async readImage(context){const photo=context.saved.workspace.document.photos.find(row=>row.id===context.target.photoId),file=context.saved.workspace.files.find(row=>row.key===photo.key);calls.push({operation:'image-read',key:photo.key,photoId:photo.id});return {source:{productId:'product',productVersion:f.view.productVersion,contentRevision:f.view.contentRevision,sourceKey:photo.key,sourceSha256:file.sha256,role:'detail',width:file.width,height:file.height,workspaceTarget:{...context.target,bindingSha256:'b'.repeat(64)}},width:file.width,height:file.height,canvas:{width:file.width,height:file.height,getContext:()=>({getImageData:(_x,_y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(255)}),measureText:()=>({width:2})})},visionConfiguration:configuration};},
  async recognize(image){calls.push({operation:'vision',key:image.source.sourceKey});image.visionResult={provider:'workers-ai-vision',model:vision.IMAGE_TEXT_VISION_MODEL,requests:1,notice:vision.IMAGE_TEXT_VISION_NOTICE,blocks:[{id:'vision-1',text:'原文',translated:'번역 문구',issue:null,box:region.box}],inspection:{policy:vision.IMAGE_TEXT_INSPECTION_POLICY,decision:'foreign-text'}};return [plain(region)];},
  async render(image,regions){calls.push({operation:'render',key:image.source.sourceKey});return{source:image.source,output:new Blob(['synthetic png'],{type:'image/png'}),width:image.width,height:image.height,editDocument:{format:'free-image-edit-v1',width:image.width,height:image.height,sourceLanguage:'zh',regions:plain(regions)}};},
  async applyImage(image,context){applies++;calls.push({operation:'image-apply',photoId:context.target.photoId});const key='owner/free-image-workspace-product-'+'c'.repeat(64)+'-'+String(applies).padStart(64,'0')+'.png',old=f.workspace,photos=old.document.photos.map(photo=>photo.id===context.target.photoId?{...photo,key}:photo),document={...old.document,photos,generatedHtml:base.model.generateDetailWorkspaceHtml(photos,old.document.imageMargin)},file=old.files.find(row=>row.key===image.source.sourceKey),files=new Map([...old.files,{...file,key,sha256:'d'.repeat(64)}].map(row=>[row.key,row])),record={...old,revision:old.revision+1,document,files:base.model.detailWorkspaceFileKeys(document).map(key=>files.get(key))};delete record.digest;f.workspace={...record,digest:await base.model.detailWorkspaceDigest(record)};lastImageReply={source:image.source,key,applied:true,editDocumentSha256:'e'.repeat(64),...f.reply()};return lastImageReply;},
  async recoverImage(){calls.push({operation:'image-recover'});return lastImageReply;},
  async prepareComposite(selection,snapshot,_signal,_fetcher,peers,publicationPolicy){calls.push({operation:'composite-prepare',keys:snapshot.workspace.document.photos.map(photo=>photo.key),peers:plain(peers),publicationPolicy});return{...selection,workspace:snapshot.workspace,peers,publicationPolicy,keys:snapshot.workspace.document.photos.map(photo=>photo.key),sources:snapshot.workspace.files,output:new Blob(['composite'],{type:'image/png'}),width:800,height:50,sha256:'e'.repeat(64),uploadId:'f'.repeat(64)};},
  async applyComposite(input,attempt){calls.push({operation:'composite-apply'});f.view={...f.view,revision:f.view.revision+1,inputFingerprint:'f'.repeat(64),productVersion:'2026-10-16T00:00:02.000Z'};attempt.completed=plain(f.view);return plain(f.view);},
  async recoverComposite(_input,attempt){calls.push({operation:'composite-recover'});attempt.completed=plain(f.view);delete attempt.pending;return'completed';},
 };
 const state=model.createSelectedDetailWorkState('owner','product'),options={ownerId:'owner',company:f.company,signal:controller.signal,fetcher,state,assertCurrent:async()=>{assert.deepEqual(company,f.company);}};
 return{f,calls,deps,model,options,state,configuration,vision,base,settings,content,controller,run:()=>model.processSelectedDetailWork('product',options,deps),intercept(fn){intercept=fn;},company(value){company=value;}};
}

test('automatic detail translates raw BODY once and composites its ordered banners instead of the saved final quote',async()=>{
 const h=await setup(),result=await h.run();
 assert.equal(result.status,'completed',result.messages.join(' '));assert.equal(result.applied,2);
 assert.deepEqual(h.calls.filter(row=>row.operation==='vision').map(row=>row.key),['owner/one.png','owner/two.png']);
 assert.ok(!h.calls.some(row=>row.operation==='image-read'&&row.key==='owner/replacement.png'));
 const keys=h.calls.find(row=>row.operation==='composite-prepare').keys;assert.equal(keys[0],'owner/top.png');assert.equal(keys.at(-1),'owner/bottom.png');assert.equal(keys.length,4);
 assert.equal(h.calls.find(row=>row.operation==='composite-prepare').publicationPolicy,h.base.load('app/detail-save-plan.ts').DETAIL_SAVE_PUBLICATION_POLICY);
 assert.equal(h.calls.filter(row=>row.operation==='composite-apply').length,1);assert.ok(h.f.workspace.document.photos.filter(row=>row.role==='body').every(row=>row.originKey!==row.key));
});

test('missing configured workspace Vision blocks explicitly before local OCR, translation, render or final save',async()=>{
 const h=await setup();const read=h.deps.readImage;h.deps.readImage=async(...args)=>{const value=await read(...args);delete value.visionConfiguration;return value;};
 const result=await h.run();assert.equal(result.status,'partial');assert.match(result.messages.join(' '),/Vision/);assert.ok(!h.calls.some(row=>['vision','render','image-apply','composite-apply'].includes(row.operation)));
});

test('manual/cropped BODY editors are preserved and never inferred again',async()=>{
 const h=await setup({saved:true}),read=h.deps.readImage;h.deps.readImage=async(...args)=>{const value=await read(...args);value.editDocument={crop:{x:1},regions:[{translationProvenance:'manual'}]};return value;};
 const before=plain(h.f.workspace.document),result=await h.run();assert.equal(result.status,'completed');assert.deepEqual(h.f.workspace.document,before);assert.ok(!h.calls.some(row=>['vision','render','image-apply'].includes(row.operation)));
});

test('distinct excluded workspace/automatic sources block the whole-product compositor and preserve translated raw results',async()=>{
 const h=await setup({excluded:true});h.f.view.automatic.rows.find(row=>row.optionId==='excluded').fields.detailImages.value='owner/top.png\nowner/replacement.png\nowner/bottom.png';
 const result=await h.run();assert.equal(result.status,'partial');assert.ok(h.calls.some(row=>row.operation==='image-apply'));assert.ok(!h.calls.some(row=>row.operation==='composite-apply'));assert.match(result.messages.join(' '),/옵션|구성/);
});

for(const field of ['detailImages','detailHtml','altText'])test(`a manual ${field} blank prevents whole-product final overwrite`,async()=>{
 const h=await setup({excluded:true});h.f.view.overrides.options.excluded={[field]:''};
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(h.f.view.overrides.options.excluded[field],'');assert.ok(!h.calls.some(row=>row.operation==='composite-apply'));
});

test('a lost committed BODY apply ACK is recovered before any new image or final write',async()=>{
 const h=await setup(),apply=h.deps.applyImage;let lost=false;h.deps.applyImage=async(...args)=>{const value=await apply(...args);if(!lost){lost=true;throw Error('lost BODY ACK');}return value;};
 const first=await h.run();assert.equal(first.status,'uncertain');const before=h.calls.length,second=await h.run();assert.equal(second.recovered,true);assert.equal(h.calls.slice(before).filter(row=>row.operation==='image-recover').length,1);assert.ok(!h.calls.slice(before).some(row=>['vision','image-apply','composite-apply'].includes(row.operation)));
 assert.equal((await h.run()).status,'completed');assert.equal(h.calls.filter(row=>row.operation==='image-apply').length,2);
});

test('a lost committed seed ACK resumes by reads and does not infer or save a second seed',async()=>{
 const h=await setup();let lost=false;h.intercept(async(url,init)=>{if(init.method!=='PUT'||lost)return;lost=true;await h.f.request(url,init);throw Error('lost seed ACK');});
 assert.equal((await h.run()).status,'uncertain');const before=h.calls.length,result=await h.run();assert.equal(result.recovered,true);assert.ok(!h.calls.slice(before).some(row=>row.method==='PUT'||row.operation==='vision'));assert.equal((await h.run()).status,'completed');
});

test('a lost committed composite ACK is read back without another render, image write or final save',async()=>{
 const h=await setup(),apply=h.deps.applyComposite;h.deps.applyComposite=async(input,attempt,...args)=>{attempt.pending='save';await apply(input,attempt,...args);delete attempt.completed;throw Error('lost composite ACK');};
 assert.equal((await h.run()).status,'uncertain');const before=h.calls.length,result=await h.run();assert.equal(result.recovered,true);assert.equal(result.status,'completed');assert.equal(h.calls.slice(before).filter(row=>row.operation==='composite-recover').length,1);assert.ok(!h.calls.slice(before).some(row=>['vision','render','image-apply','composite-apply'].includes(row.operation)));
});

test('saved settings or source changes after a partial run cannot adopt its retained images',async()=>{
 for(const change of ['settings','view','company']){const h=await setup(),read=h.deps.readImage;let first=true;h.deps.readImage=async(...args)=>{if(first){first=false;throw Error('local source interrupted');}return read(...args);};assert.equal((await h.run()).status,'partial');
  if(change==='settings')h.settings.brand='다른 설정';else if(change==='view')h.f.view.inputFingerprint='9'.repeat(64);else h.company({code:'A01526306',name:'유앤채'});
  const before=h.calls.length,result=await h.run();assert.equal(result.status,'partial');assert.equal(result.sourceChanged,true);assert.ok(!h.calls.slice(before).some(row=>['vision','image-apply','composite-apply'].includes(row.operation)),change);
 }
});

for(const issue of ['제공자 번역 검증을 통과하지 못했습니다.','자동 번역 미완료: 원문 확인'])test(`a saved BODY editor with unresolved issue retains its exact pixels without completing (${issue})`,async()=>{
 const h=await setup({saved:true}),read=h.deps.readImage;h.deps.readImage=async(...args)=>({...await read(...args),editDocument:{regions:[{selected:false,issue,text:'原文',translated:'',translationProvenance:'empty'}]}});
 const before=plain(h.f.workspace),result=await h.run();assert.equal(result.status,'partial');assert.deepEqual(h.f.workspace,before);assert.ok(!h.calls.some(row=>['vision','render','image-apply','composite-apply'].includes(row.operation)));
});

test('a selected saved BODY region with an empty translation cannot become completed',async()=>{
 const h=await setup({saved:true}),read=h.deps.readImage;h.deps.readImage=async(...args)=>({...await read(...args),editDocument:{regions:[{selected:true,issue:null,text:'原文',translated:'',translationProvenance:'empty'}]}});
 assert.equal((await h.run()).status,'partial');assert.ok(!h.calls.some(row=>['vision','image-apply','composite-apply'].includes(row.operation)));
});

for(const mode of ['manual-role','manual-blank','disabled'])test(`current ${mode} preserves detail choices before any seed or provider write`,async()=>{
 const h=await setup();if(mode==='disabled')h.settings.translateImages=false;else{h.content.assets.detail.provenance='manual';if(mode==='manual-blank')h.content.assets.detail.value=[];}
 const result=await h.run();assert.equal(result.status,'skipped');assert.ok(!h.calls.some(row=>row.method==='PUT'||['vision','image-apply','composite-apply'].includes(row.operation)));
});

test('an identical raw composition across excluded scopes is translated once and binds every peer to the atomic final save',async()=>{
 const h=await setup({excluded:true}),result=await h.run();assert.equal(result.status,'completed',result.messages.join(' '));assert.equal(h.calls.filter(row=>row.operation==='vision').length,2);assert.equal(h.calls.filter(row=>row.operation==='image-apply').length,2);assert.equal(h.calls.filter(row=>row.operation==='composite-apply').length,1);
 assert.deepEqual(h.calls.find(row=>row.operation==='composite-prepare').peers,[{optionId:'red',workspace:{revision:3,digest:h.f.workspace.digest}},{optionId:'excluded',workspace:null}]);
});

test('server no-text proof keeps the raw BODY and bypasses OCR, rendering and image writes',async()=>{
 const h=await setup(),read=h.deps.readImage;h.deps.readImage=async(...args)=>{const image=await read(...args);image.noTextProof={policy:h.vision.IMAGE_TEXT_INSPECTION_POLICY,productId:'product',sourceKey:image.source.sourceKey,sourceSha256:image.source.sourceSha256,width:image.width,height:image.height,requestId:'11111111-1111-4111-8111-111111111111',verifiedAt:'2026-10-16T00:00:00.000Z',sourceLanguage:'zh',configuration:h.configuration};return image;};
 const result=await h.run();assert.equal(result.status,'completed');assert.equal(result.applied,0);assert.equal(result.skipped,2);assert.ok(!h.calls.some(row=>['vision','render','image-apply'].includes(row.operation)));assert.equal(h.calls.filter(row=>row.operation==='composite-apply').length,1);
});

test('unknown Vision keeps one exact workspace request; completed readback applies only that BODY without another inference',async()=>{
 const h=await setup(),ErrorClass=h.base.load('app/free-image-vision-error.ts').FreeImageVisionError;let attempt,status='running',requests=0;
 for(const key of h.f.objects.keys())h.f.objects.set(key,await sharp({create:{width:100,height:80,channels:4,background:'#ffffff'}}).png().toBuffer());
 h.deps.recognize=async image=>{requests++;attempt={requestId:'11111111-1111-4111-8111-111111111111',source:image.source,sourceLanguage:'zh',configuration:h.configuration,inspectionPolicy:h.vision.IMAGE_TEXT_INSPECTION_POLICY};throw new ErrorClass('lost Vision ACK','IMAGE_VISION_ACK_MISSING',true,attempt);};
 h.deps.observe=async current=>{assert.deepEqual(plain(current),plain(attempt));return{format:'yoofam-image-vision-status-v1',requestId:attempt.requestId,source:attempt.source,configuration:h.configuration,sourceLanguage:'zh',status,result:status==='completed'?{provider:'workers-ai-vision',model:h.vision.IMAGE_TEXT_VISION_MODEL,requests:1,notice:h.vision.IMAGE_TEXT_VISION_NOTICE,blocks:[{id:'vision-1',text:'原文',translated:'번역 문구',issue:null,box:{x:20,y:20,width:60,height:30}}]}:null,failure:null,execution:{requests:0},readOnly:true};};
 assert.equal((await h.run()).inferencePending,true);const before=h.calls.length;assert.equal((await h.run()).inferencePending,true);assert.ok(!h.calls.slice(before).some(row=>row.operation==='image-apply'));
 status='completed';const recovered=await h.run();assert.equal(recovered.recovered,true,recovered.messages.join(' '));assert.equal(recovered.applied,1);assert.equal(requests,1);assert.ok(!h.calls.some(row=>row.operation==='composite-apply'));
});

test('turning off saved image translation while BODY pixels load prevents the paid Vision call',async()=>{
 const h=await setup(),read=h.deps.readImage;h.deps.readImage=async(...args)=>{const image=await read(...args);h.settings.translateImages=false;return image;};
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.sourceChanged,true);assert.ok(!h.calls.some(row=>['vision','render','image-apply','composite-apply'].includes(row.operation)));
});

test('a single-option manual ALT blank prevents the final common ALT replacement',async()=>{
 const h=await setup();h.f.view.overrides.options.red={altText:''};const result=await h.run();assert.equal(result.status,'partial');assert.equal(h.f.view.overrides.options.red.altText,'');assert.ok(!h.calls.some(row=>row.operation==='composite-apply'));
});

test('cancellation after a dispatched unknown Vision response retains its exact UUID for read-only resume',async()=>{
 const h=await setup(),ErrorClass=h.base.load('app/free-image-vision-error.ts').FreeImageVisionError;let calls=0,attempt;
 h.deps.recognize=async image=>{calls++;attempt={requestId:'11111111-1111-4111-8111-111111111111',source:image.source,sourceLanguage:'zh',configuration:h.configuration,inspectionPolicy:h.vision.IMAGE_TEXT_INSPECTION_POLICY};h.controller.abort(Error('closed after dispatch'));throw new ErrorClass('lost on close','IMAGE_VISION_ACK_MISSING',true,attempt);};
 await assert.rejects(h.run(),/closed after dispatch/);assert.equal(h.state.inference.attempt.requestId,attempt.requestId);
 h.options.signal=new AbortController().signal;h.deps.observe=async value=>{assert.deepEqual(plain(value),plain(attempt));return{format:'yoofam-image-vision-status-v1',requestId:attempt.requestId,source:attempt.source,configuration:h.configuration,sourceLanguage:'zh',status:'running',result:null,failure:null,execution:{requests:0},readOnly:true};};
 assert.equal((await h.run()).inferencePending,true);assert.equal(calls,1);assert.ok(!h.calls.some(row=>row.operation==='image-apply'));
});

for(const field of ['altText','description'])test(`manual stage-five ${field} provenance also blocks final replacement when resolved source is content`,async()=>{
 const h=await setup();h.content.detail={[field]:{value:'',provenance:'manual',updatedAt:'2026-10-16T00:00:00.000Z'}};
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(h.content.detail[field].value,'');assert.ok(!h.calls.some(row=>row.operation==='composite-apply'));
});
