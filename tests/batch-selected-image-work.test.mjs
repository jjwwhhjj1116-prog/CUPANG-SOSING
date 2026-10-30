import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const plain=value=>JSON.parse(JSON.stringify(value));
function loadModel(){
 const cache=new Map(),timers=new Map();let clock=0;
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,Date,URL,AbortController,AbortSignal,structuredClone,setTimeout:(fn,ms)=>{timers.set(++clock,{fn,ms});return clock;},clearTimeout:id=>timers.delete(id),require(name){
    if(name==='@/app/free-image-translation-client')return{};
    if(name==='@/app/image-files')return{isOwnedImageKey:(owner,key)=>typeof key==='string'&&new RegExp('^'+owner+'/[a-zA-Z0-9][a-zA-Z0-9._-]*$').test(key)};
    assert.ok(name.startsWith('@/'),name);return load(name.slice(2)+'.ts');
   }},{filename:file});return exports;
 }
 return{model:load('app/batch-selected-image-work.ts'),vision:load('app/free-image-vision-error.ts'),visionContract:load('app/image-text-vision.ts'),expire(){for(const timer of [...timers.values()])timer.fn();},timers};
}
function fixture(stage='detail',keys=['owner/source-a.png','owner/source-b.png']){
 const runtime=loadModel(),calls=[],canvases=[],controller=new AbortController();let current=true;
 const field=(value,source='content')=>({value,source,issues:[],needsReview:false});
 const fields=['mainImage','additionalImages','detailImages','detailHtml'].map(id=>({id,section:'image',label:id,type:id==='detailHtml'?'textarea':'images',required:false,visibility:'common',maxItems:id==='mainImage'?1:30}));
 fields.push({id:'wireMain',section:'image',label:'대표',type:'images',required:false,visibility:'common',maxItems:1,hubInput:'mainImage',hubWire:{path:['imagePage','images','mainImage']}});
 const stageField={main:'mainImage',additional:'additionalImages',detail:'detailImages'}[stage],values={mainImage:'owner/main.png',wireMain:'owner/main.png',additionalImages:'owner/add.png',detailImages:'owner/detail.png',detailHtml:'<p>수동 설명 보존</p>'};
 values[stageField]=keys.join('\n');if(stage==='main')values.wireMain=values.mainImage;
 const row={optionId:'option',optionLabel:'합성 옵션',included:true,fields:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,field(value)]))};
 let view={revision:1,inputFingerprint:'a'.repeat(64),productVersion:'2026-10-23T00:00:00.000Z',contentRevision:2,optionRevision:1,updatedAt:'2026-10-23T00:00:00.000Z',overrides:{common:{},options:{}},categoryContext:{source:'profile',profileId:'cat',categoryId:'991',categoryPath:['합성']},imageKeys:[...new Set(['owner/main.png','owner/add.png','owner/detail.png',...keys])],protectedDetailImageKeys:[],submissionReady:false,resolved:{schema:{fields},rows:[row],issues:[]}};
 view.automatic=plain(view.resolved);
 const content={schemaVersion:1,productId:'product',revision:2,assets:{main:{value:['owner/main.png'],provenance:'collected',updatedAt:null},additional:{value:['owner/add.png'],provenance:'collected',updatedAt:null},detail:{value:['owner/detail.png'],provenance:'collected',updatedAt:null}},sentinelManualOther:{keep:true}};
 const task={productId:'product',productTitle:'합성 상품',optionId:'option',optionLabel:'합성 옵션',stage,profileId:'cat',categoryContext:plain(view.categoryContext),productVersion:view.productVersion,imageCount:keys.length};
 const plan={scope:{ownerId:'owner',company:{code:'A01464742',name:'와이홉'}},settings:{translateImages:true},enabled:true,tasks:[task],messages:[]};
 const productOptions={productId:'product',revision:1,rows:[{id:'option',provenance:{imageKey:'collected'}}]};
 const options={ownerId:'owner',signal:controller.signal,fetcher:async(url,init)=>{calls.push(['fetch',url,init.method??'GET']);if(url==='/api/products/product/options')return Response.json({options:productOptions,productVersion:view.productVersion});assert.equal(url,'/api/products/product/content');return Response.json({content});},isCurrent:()=>current};
 options.state=runtime.model.createSelectedImageStageState('owner','product',stage);
 const region=(text,id='line')=>({id,text,box:{x:0,y:0,width:3,height:2},confidence:95,selected:true,translated:'',issue:null,translationProvenance:'empty',background:'#ffffff',foreground:'#111111',fontSize:1});
 const deps={plan:async()=>plain(plan),refresh:async()=>plain(view),readSource:async(productId,version,sourceKey,role,signal,_fetcher,target)=>{signal.throwIfAborted();calls.push(['read',sourceKey]);assert.ok(canvases.every(canvas=>canvas.width===0),'prior canvas released before another source');const canvas={width:3,height:2};canvases.push(canvas);return{source:{productId,productVersion:version,sourceKey,role,contentRevision:2,sourceSha256:'b'.repeat(64),width:3,height:2,quotationTarget:target},blob:new Blob(['synthetic']),canvas,width:3,height:2};},recognize:async(image)=>[region(image.source.sourceKey.endsWith('b.png')?'English words':'中文文句')],translate:async(source,language,regions)=>{calls.push(['translate',language]);return{source,regions:regions.map(row=>({id:row.id,original:row.text,translated:'번역 '+row.text,issue:null})),requests:1,warnings:[],stoppedHttpStatus:null};},render:async(image,regions)=>{calls.push(['render',image.source.sourceKey]);assert.ok(regions.filter(row=>row.selected).every(row=>row.translationProvenance==='generated'));return{source:image.source,output:new Blob(['synthetic PNG'],{type:'image/png'}),width:3,height:2};},apply:async(batch,index,_signal,progress)=>{
  calls.push(['apply',index]);assert.equal(batch.items.filter(row=>row.rendered).length,1,'one PNG retained per slot');assert.ok(canvases.every(canvas=>canvas.width===0));assert.equal(batch.view.productVersion,view.productVersion);
  const next=plain(view),key=`owner/free-image-product-result-${index}.png`,value=next.resolved.rows[0].fields[stageField].value.split('\n').map((key,i)=>i===index?`owner/free-image-product-result-${index}.png`:key).join('\n');
  next.revision++;next.productVersion=new Date(Date.parse(view.productVersion)+1).toISOString();next.updatedAt=next.productVersion;next.imageKeys.push(key);next.overrides.options.option={...(next.overrides.options.option??{}),[stageField]:value};next.resolved.rows[0].fields[stageField]=field(value,'manual-option');if(stage==='main')next.resolved.rows[0].fields.wireMain=field(value,'manual-option');view=next;
  const result={...batch,view:plain(next),items:batch.items.map(row=>row.slotIndex===index?{...row,status:'applied',appliedKey:key}:row)};progress(result);return result;
 }};
 return{...runtime,calls,canvases,controller,content,productOptions,plan,options,deps,region,get view(){return view;},set view(value){view=value;},scope(value){current=value;},run:()=>runtime.model.processSelectedImageStage('product',stage,options,deps)};
}

function partialFixture(stage='main',keys=['owner/source-a.png']){
 const h=fixture(stage,keys),documents=[],readSource=h.deps.readSource;
 h.deps.readSource=async(...args)=>{
  const image=await readSource(...args);
  if(args[2].includes('/free-image-')&&documents.length){assert.deepEqual(plain(args[7]),{restoreEditor:true,anchorPolicy:'current-target-v1'});return{...image,source:{...image.source,sourceKey:keys[0],editorSource:{resultKey:args[2],anchorPolicy:'current-target-v1'}},editDocument:plain(documents[0])};}
  return image;
 };
 h.deps.recognize=async()=>[h.region('中文一','accepted-one'),h.region('中文二','accepted-two'),h.region('未确认','rejected')];
 h.deps.translate=async(source,language,regions)=>{
  h.calls.push(['translate',language]);return{source,regions:regions.map(row=>({id:row.id,original:row.text,translated:row.id==='rejected'?null:'검증된 번역',issue:row.id==='rejected'?'영역 검증 실패: 원문에 없는 성능·주장.':null})),requests:1,stoppedHttpStatus:429,warnings:[],workersRecovery:{provider:'workers-ai',status:'partial',requests:1,sourceRegions:3,translatedRegions:2}};
 };
 h.deps.render=async(image,regions)=>{
  h.calls.push(['render',image.source.sourceKey]);const editDocument={format:'free-image-edit-v1',width:image.width,height:image.height,sourceLanguage:'zh',regions:plain(regions)};documents.push(editDocument);
  return{source:image.source,output:new Blob(['synthetic PNG'],{type:'image/png'}),width:image.width,height:image.height,editDocument};
 };
 return{...h,documents,get view(){return h.view;},set view(value){h.view=value;}};
}

for(const stage of ['main','additional','detail'])test(`${stage}: partial translations save one editable draft, preserve rejected regions, and cannot become complete on resume`,async()=>{
 const h=partialFixture(stage,stage==='main'?undefined:['owner/source-a.png','owner/source-b.png']),before=plain(h.content),result=await h.run();
 assert.equal(result.status,'partial');assert.equal(result.applied,1);assert.equal(result.failed,1);assert.deepEqual(h.content,before);
 const item=result.state.batches.option.items[0];assert.equal(item.status,'applied');assert.deepEqual(plain(item.translationReview),{status:'partial',acceptedRegions:2,unresolvedRegions:1,message:item.translationReview.message});assert.equal(item.texts.length,2);assert.equal(item.rendered,undefined);
 const rows=h.documents[0].regions;assert.deepEqual(rows.filter(row=>row.selected).map(row=>row.id),['accepted-one','accepted-two']);assert.ok(rows.filter(row=>row.selected).every(row=>row.translationProvenance==='generated'&&row.issue===null));
 const rejected=rows.find(row=>row.id==='rejected');assert.equal(rejected.text,'未确认');assert.equal(rejected.translated,'');assert.equal(rejected.translationProvenance,'empty');assert.equal(rejected.selected,false);assert.match(rejected.issue,/원문에 없는/);assert.deepEqual(rejected.box,{x:0,y:0,width:3,height:2});
 const calls=h.calls.filter(row=>['read','translate','render','apply'].includes(row[0])).length,resumed=await h.run();assert.equal(resumed.status,'partial');assert.equal(resumed.applied,1);assert.equal(resumed.failed,1);assert.equal(h.calls.filter(row=>['read','translate','render','apply'].includes(row[0])).length,calls);assert.match(resumed.messages[0],/수동 편집/);
 if(stage!=='main')assert.equal(resumed.state.batches.option.items[1].status,'pending','partial coverage stops the next image');
});

test('partial Chinese response preserves untouched English rows without another provider request',async()=>{
 const h=partialFixture(),recognize=h.deps.recognize;h.deps.recognize=async()=>[...await recognize(),h.region('English caption','unrequested')];
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.applied,1);assert.deepEqual(h.calls.filter(row=>row[0]==='translate').map(row=>row[1]),['zh']);assert.equal(result.state.batches.option.items[0].translationReview.unresolvedRegions,2);
 const row=h.documents[0].regions.find(row=>row.id==='unrequested');assert.equal(row.text,'English caption');assert.equal(row.selected,false);assert.equal(row.translated,'');assert.match(row.issue,/추가 번역 요청을 중단/);
});

test('a partial image without its editable document cannot be saved as a flattened result',async()=>{
 const h=partialFixture(),render=h.deps.render;h.deps.render=async(...args)=>{const result=await render(...args);delete result.editDocument;return result;};const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.applied,0);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);assert.match(result.messages[0],/편집 문서/);
});

for(const committed of [false,true])test(`partial draft lost ACK (${committed?'committed':'not committed'}) retains exact editable PNG and incomplete status through recovery and resume`,async()=>{
 const h=partialFixture('detail',['owner/source-a.png','owner/source-b.png']),apply=h.deps.apply;let writes=0,attemptImage;
 h.deps.apply=async(batch,index,signal,progress)=>{
  writes++;attemptImage=batch.items[index].rendered;const saved=committed?await apply(batch,index,signal,()=>{}):batch;
  progress({...saved,view:batch.view,items:saved.items.map(row=>row.slotIndex===index?{...row,status:'uncertain',attempt:{image:attemptImage,before:batch.view}}:row)});throw Error('ACK lost');
 };
 const uncertain=await h.run();assert.equal(uncertain.status,'uncertain');assert.equal(writes,1);assert.equal(uncertain.recoveryBatch.items[0].translationReview.unresolvedRegions,1);assert.equal(attemptImage.editDocument.regions.find(row=>row.id==='rejected').selected,false);
 h.deps.recover=async(batch,_signal,progress)=>{assert.equal(batch.items[0].attempt.image,attemptImage);const next={...batch,view:plain(h.view),items:batch.items.map(row=>row.status==='uncertain'?{...row,status:committed?'applied':'ready',attempt:undefined}:row)};progress(next);return next;};
 const recovered=await h.run();assert.equal(recovered.status,'partial');assert.equal(recovered.recovered,true);assert.equal(recovered.failed,1);assert.equal(recovered.applied,committed?1:0);assert.equal(writes,1);assert.match(recovered.messages[0],/미완료/);
 h.deps.apply=apply;const resumed=await h.run();assert.equal(resumed.status,'partial');assert.equal(resumed.applied,1);assert.equal(resumed.failed,1);assert.equal(resumed.state.batches.option.items[0].translationReview.acceptedRegions,2);assert.equal(resumed.state.batches.option.items[1].status,'pending');
 assert.equal(h.calls.filter(row=>row[0]==='translate').length,1);assert.equal(h.calls.filter(row=>row[0]==='render').length,1);assert.equal(h.calls.filter(row=>row[0]==='apply').length,1,'the committed image is never uploaded twice');
});

test('retained partial drafts cannot cross owner, company, product, source, settings or saved view boundaries',async()=>{
 for(const change of ['owner','company','product','source','settings','view']){
  const h=partialFixture();await h.run();const writes=h.calls.filter(row=>row[0]==='apply').length;
  if(change==='owner')h.plan.scope.ownerId='another';if(change==='company')h.plan.scope.company={code:'A01526306',name:'유앤채'};if(change==='product')h.options.state.productId='another';
  if(change==='source')h.view.resolved.rows[0].fields.mainImage.value='owner/another.png';if(change==='settings')h.plan.settings.translateImages=false;if(change==='view')h.view.productVersion='2026-10-23T00:00:01.000Z';
  await assert.rejects(h.run(),/변경/);assert.equal(h.calls.filter(row=>row[0]==='apply').length,writes,change);assert.equal(h.calls.filter(row=>row[0]==='translate').length,1,change);
 }
});

test('a fresh run reads persisted partial issues before skipping a saved manual-option image',async()=>{
 const h=partialFixture();await h.run();const version=h.view.productVersion;
 assert.equal(h.view.resolved.rows[0].fields.mainImage.source,'manual-option');assert.match(h.documents[0].regions.find(row=>row.id==='rejected').issue,/^자동 번역 미완료:/);
 h.options.state=h.model.createSelectedImageStageState('owner','product','main');const translations=h.calls.filter(row=>row[0]==='translate').length,writes=h.calls.filter(row=>row[0]==='apply').length;
 const resumed=await h.run();assert.equal(resumed.status,'partial');assert.equal(resumed.applied,0);assert.equal(resumed.failed,1);assert.equal(resumed.skipped,0);assert.match(resumed.messages[0],/이전 작업.*미완료/);assert.equal(resumed.state.batches.option.items[0].translationReview.unresolvedRegions,1);
 assert.equal(h.calls.filter(row=>row[0]==='translate').length,translations);assert.equal(h.calls.filter(row=>row[0]==='apply').length,writes);assert.equal(h.view.productVersion,version);assert.ok(h.canvases.every(canvas=>canvas.width===0));
 h.documents[0].regions.find(row=>row.id==='rejected').issue='수동 재요청도 번역하지 못했습니다.';h.options.state=h.model.createSelectedImageStageState('owner','product','main');assert.equal((await h.run()).status,'partial','a newer editor failure does not erase pending review');
 h.documents[0].regions.find(row=>row.id==='rejected').issue=null;h.documents[0].regions.find(row=>row.id==='rejected').translationProvenance='manual';h.documents[0].regions.find(row=>row.id==='rejected').translated='직접 검토한 문구';h.options.state=h.model.createSelectedImageStageState('owner','product','main');assert.equal((await h.run()).status,'skipped','explicitly reviewed editor state stays preserved');
 assert.equal(h.calls.filter(row=>row[0]==='translate').length,translations);assert.equal(h.calls.filter(row=>row[0]==='apply').length,writes);
});

test('saved editor inspection fails closed on missing read or changed source scope without OCR or writes',async()=>{
 for(const mode of ['read','owner','product','version','result-key','role']){
  const h=partialFixture();await h.run();h.options.state=h.model.createSelectedImageStageState('owner','product','main');const readSource=h.deps.readSource;
  h.deps.readSource=async(...args)=>{if(mode==='read')throw Error('saved edit read failed');const image=await readSource(...args);if(mode==='owner')image.source.sourceKey='another/private.png';if(mode==='product')image.source.productId='another';if(mode==='version')image.source.productVersion='2026-10-23T01:00:00.000Z';if(mode==='result-key')image.source.editorSource.resultKey='owner/another.png';if(mode==='role')image.source.role='detail';return image;};
  const result=await h.run();assert.equal(result.status,'partial',mode);assert.equal(result.applied,0,mode);assert.equal(result.failed,1,mode);assert.equal(h.calls.filter(row=>row[0]==='translate').length,1,mode);assert.equal(h.calls.filter(row=>row[0]==='apply').length,1,mode);
 }
});

for(const stage of ['main','additional','detail'])test(`${stage}: explicit action saves generated drafts one slot at a time and leaves content/original roles intact`,async()=>{
 const h=fixture(stage,stage==='main'?['owner/source-a.png']:undefined),before=plain(h.content),result=await h.run();
 assert.equal(result.status,'completed');assert.equal(result.applied,stage==='main'?1:2);assert.equal(result.failed,0);assert.ok(result.productVersion);assert.equal(result.recoveryBatch,undefined);assert.deepEqual(h.content,before);assert.ok(h.view.imageKeys.includes('owner/source-a.png'));assert.ok(h.canvases.every(canvas=>canvas.width===0&&canvas.height===0));assert.equal(h.timers.size,0);assert.equal(h.calls.filter(row=>row[0]==='apply').length,result.applied);assert.match(result.messages.at(-1),/초안.*검토/);
 if(stage!=='main')assert.deepEqual(h.calls.filter(row=>row[0]==='translate').map(row=>row[1]),['zh','en']);
});

test('saved setting, manual role, manual quotation choice and previous edited results are preserved without OCR or writes',async()=>{
 for(const kind of ['disabled','role','quotation','edited']){
  const h=fixture('detail',kind==='edited'?['owner/free-image-product-old.png']:undefined);
  if(kind==='disabled')h.plan.enabled=false;if(kind==='role')h.content.assets.detail={value:[],provenance:'manual',updatedAt:null};if(kind==='quotation')h.view.overrides.options.option={detailImages:h.view.resolved.rows[0].fields.detailImages.value};
  const before=plain(h.view),result=await h.run();assert.equal(result.status,'skipped',kind);assert.equal(result.applied,0);assert.equal(h.calls.filter(row=>['render','apply'].includes(row[0])).length,0);assert.equal(h.calls.filter(row=>row[0]==='read').length,kind==='edited'?1:0);assert.deepEqual(h.view,before);
 }
});

test('detail banner slots retain exact positions and only ordinary source slots are processed',async()=>{
 const h=fixture('detail',['owner/top.png','owner/source-a.png','owner/bottom.png']);h.view.protectedDetailImageKeys=['owner/top.png','owner/bottom.png'];
 const result=await h.run();assert.equal(result.applied,1);assert.equal(result.skipped,2);assert.deepEqual(h.calls.filter(row=>row[0]==='read').map(row=>row[1]),['owner/source-a.png']);assert.equal(h.view.resolved.rows[0].fields.detailImages.value,'owner/top.png\nowner/free-image-product-result-1.png\nowner/bottom.png');
});

test('main stage preserves an option image that was explicitly selected in the option editor',async()=>{
 const h=fixture('main',['owner/source-a.png']);h.productOptions.rows[0].provenance.imageKey='manual';const result=await h.run();assert.equal(result.status,'skipped');assert.equal(result.applied,0);assert.match(result.messages[0],/옵션 대표 이미지 선택을 유지/);assert.equal(h.calls.filter(row=>row[0]==='read').length,0);
});

test('no foreign text keeps the original slot while a partial translation still blocks completion',async()=>{
 const h=fixture();h.deps.recognize=async(image)=>image.source.sourceKey.endsWith('a.png')?[]:[h.region('中文')];h.deps.translate=async(source,_language,regions)=>({source,regions:regions.map(row=>({id:row.id,translated:null,issue:'unavailable'})),warnings:['공급자 응답 지연']});
 const before=plain(h.view),result=await h.run();assert.equal(result.status,'partial');assert.equal(result.failed,1);assert.equal(result.skipped,1);assert.equal(result.applied,0);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);assert.deepEqual(h.view,before);assert.ok(h.canvases.every(canvas=>canvas.width===0));
});

test('plain photos with a completed empty OCR result skip accurately, while engine failure remains failed',async()=>{
 for(const noText of [async()=>[],async()=>{throw Error('읽을 수 있는 문구를 찾지 못했습니다. 필요한 영역과 원문을 직접 추가해주세요.');}]){
  const h=fixture('main',['owner/source-a.png']);h.deps.recognize=noText;const result=await h.run();assert.equal(result.status,'skipped');assert.equal(result.skipped,1);assert.equal(result.failed,0);assert.match(result.messages[0],/문구 인식을 완료/);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);
 }
 const failed=fixture('main',['owner/source-a.png']);failed.deps.recognize=async()=>{throw Error('OCR engine failed');};const result=await failed.run();assert.equal(result.status,'partial');assert.equal(result.failed,1);assert.equal(result.skipped,0);
});

test('fallback rejection exposes the existing provider status and region issue without retrying or painting',async()=>{
 const h=fixture('main',['owner/source-a.png']);let requests=0;
 h.deps.translate=async(source,_language,regions)=>{requests++;return{source,regions:regions.map(row=>({id:row.id,original:row.text,translated:null,issue:'영역별 원문·숫자·단위·코드를 확인하지 못했습니다. 원문을 유지했습니다.'})),requests:1,stoppedHttpStatus:429,workersRecovery:{provider:'workers-ai',status:'invalid-response',requests:1,sourceRegions:1,translatedRegions:0},warnings:['Google HTTP 429로 중단된 문구만 무료 AI에 한 묶음으로 번역 요청했습니다.']};};
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(requests,1);assert.equal(h.calls.filter(row=>['render','apply'].includes(row[0])).length,0);assert.match(result.messages[0],/1개 문구 중 1개/);assert.match(result.messages[0],/무료 AI 결과: 응답 검증 실패 \(0\/1개 검증\)/);assert.match(result.messages[0],/영역별 원문·숫자·단위·코드/);assert.equal(h.options.state.batches.option.items[0].message,result.messages[0].split(': ').slice(1).join(': '));
});

test('an explicit retry resumes only untranslated slots after this session created a manual-option override',async()=>{
 const h=fixture(),recognize=h.deps.recognize;h.deps.recognize=async image=>{if(image.source.sourceKey.endsWith('b.png'))throw Error('temporary OCR failure');return recognize(image);};
 const partial=await h.run();assert.equal(partial.status,'partial');assert.equal(partial.applied,1);assert.equal(h.view.resolved.rows[0].fields.detailImages.source,'manual-option');assert.equal(partial.state,h.options.state);
 h.deps.recognize=recognize;const before=h.calls.filter(row=>row[0]==='apply').length,complete=await h.run();assert.equal(complete.status,'completed');assert.equal(complete.applied,2);assert.equal(h.calls.filter(row=>row[0]==='apply').length,before+1);assert.deepEqual(h.calls.filter(row=>row[0]==='read').map(row=>row[1]),['owner/source-a.png','owner/source-b.png','owner/source-b.png']);
 const count=h.calls.filter(row=>row[0]==='apply').length;assert.equal((await h.run()).status,'completed');assert.equal(h.calls.filter(row=>row[0]==='apply').length,count,'verified complete retry never uploads again');
});

test('changed views/settings and unrelated manual edits reject retained partial state before another save',async()=>{
 for(const change of ['view','settings','content']){
  const h=fixture(),recognize=h.deps.recognize;h.deps.recognize=async image=>{if(image.source.sourceKey.endsWith('b.png'))throw Error('temporary');return recognize(image);};await h.run();const before=h.calls.filter(row=>row[0]==='apply').length;
  h.deps.recognize=recognize;if(change==='view'){h.view.overrides.options.option.detailImages='owner/user-choice.png';h.view.revision++;}if(change==='settings')h.plan.settings.newManualSetting=true;if(change==='content'){h.content.revision++;h.content.assets.detail.provenance='manual';}
  await assert.rejects(h.run(),/변경/);assert.equal(h.calls.filter(row=>row[0]==='apply').length,before,change);
 }
});

test('lost ACK state is read-only recovered before a separate explicit retry can save the next slot',async()=>{
 const h=fixture(),apply=h.deps.apply;let captured;
 h.deps.apply=async(batch,index,_signal,progress)=>{h.calls.push(['attempt',index]);captured={...batch,items:batch.items.map(row=>row.slotIndex===index?{...row,status:'uncertain',attempt:{image:row.rendered,before:batch.view}}:row)};progress(captured);throw Error('lost ACK');};
 const uncertain=await h.run();assert.equal(uncertain.status,'uncertain');assert.equal(h.options.state.batches.option,captured);
 h.deps.recover=async(batch,_signal,progress)=>{h.calls.push(['recover']);assert.equal(batch.items[0].attempt.image,captured.items[0].attempt.image);const recovered={...batch,items:batch.items.map(row=>row.status==='uncertain'?{...row,status:'ready',attempt:undefined}:row)};progress(recovered);return recovered;};
 const reads=h.calls.filter(row=>row[0]==='read').length,recovered=await h.run();assert.equal(recovered.status,'partial');assert.equal(recovered.recovered,true);assert.equal(h.calls.filter(row=>row[0]==='read').length,reads);assert.equal(h.calls.filter(row=>row[0]==='attempt').length,1);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);
 h.deps.apply=apply;const completed=await h.run();assert.equal(completed.status,'completed');assert.equal(completed.applied,2);assert.equal(h.calls.filter(row=>row[0]==='read').length,reads+1,'unapplied recovery reuses exact first PNG and prepares only remaining image');
});

test('failed read-only recovery retains its PNG and cannot fall through to a new upload',async()=>{
 const h=fixture('main',['owner/source-a.png']);h.deps.apply=async(batch,index,_signal,progress)=>{progress({...batch,items:batch.items.map(row=>({...row,status:'uncertain',attempt:{image:row.rendered,before:batch.view}}))});throw Error('lost');};await h.run();const source=h.options.state.batches.option.items[0].attempt.image;
 h.deps.recover=async()=>{throw Error('still unknown');};const result=await h.run();assert.equal(result.status,'uncertain');assert.equal(result.recovered,undefined);assert.equal(h.options.state.batches.option.items[0].attempt.image,source);assert.equal(h.calls.filter(row=>row[0]==='read').length,1);
});

test('recovering the first option cannot complete a stage whose later options have not started',async()=>{
 const h=fixture('main',['owner/source-a.png']),apply=h.deps.apply;h.plan.tasks.push({...h.plan.tasks[0],optionId:'later-option',optionLabel:'다음 옵션'});
 h.deps.apply=async(batch,index,_signal,progress)=>{progress({...batch,items:batch.items.map(row=>({...row,status:'uncertain',attempt:{image:row.rendered,before:batch.view}}))});throw Error('lost');};await h.run();
 h.deps.recover=async(batch,signal,progress)=>apply({...batch,items:batch.items.map(row=>({...row,status:'ready'}))},0,signal,progress);
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.recovered,true);assert.equal(result.applied,1);assert.equal(result.state.batches['later-option'],undefined);assert.match(result.messages[0],/남은 이미지/);
});

test('unknown write outcome retains exact source/PNG recovery proof and stops before the next slot',async()=>{
 const h=fixture();h.deps.apply=async(batch,index,_signal,progress)=>{h.calls.push(['apply',index]);const entry=batch.items[index],attempt={image:entry.rendered,before:batch.view};progress({...batch,items:batch.items.map(row=>row.slotIndex===index?{...row,status:'uncertain',attempt}:row)});throw Error('ACK lost');};
 const result=await h.run();assert.equal(result.status,'uncertain');assert.equal(result.applied,0);assert.equal(result.failed,1);assert.equal(h.calls.filter(row=>row[0]==='read').length,1);assert.equal(h.calls.filter(row=>row[0]==='apply').length,1);assert.ok(result.recoveryBatch.items[0].attempt.image.output instanceof Blob);assert.equal(result.recoveryBatch.items[0].attempt.image.source.sourceKey,'owner/source-a.png');assert.equal(result.recoveryBatch.items[1].status,'pending');
});

test('owner, initial version and foreground scope changes cannot start or publish an image mutation',async()=>{
 const foreign=fixture();foreign.plan.scope.ownerId='other';await assert.rejects(foreign.run(),/계정/);assert.equal(foreign.calls.length,0);
 const stale=fixture();stale.options.expectedProductVersion='2026-10-22T00:00:00Z';await assert.rejects(stale.run(),/변경/);assert.equal(stale.calls.filter(row=>row[0]==='read').length,0);
 const changed=fixture();changed.deps.render=async()=>{changed.scope(false);return{output:new Blob(['png'],{type:'image/png'})};};await assert.rejects(changed.run(),/변경/);assert.equal(changed.calls.filter(row=>row[0]==='apply').length,0);assert.ok(changed.canvases.every(canvas=>canvas.width===0));
});

test('a new manual role/content revision before save blocks upload and a slot timeout releases canvas',async()=>{
 const h=fixture('main',['owner/source-a.png']);const render=h.deps.render;h.deps.render=async(...args)=>{const result=await render(...args);h.content.revision++;h.content.assets.main.provenance='manual';return result;};const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.sourceChanged,true);assert.equal(result.applied,0);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);
 const timeout=fixture('main',['owner/source-a.png']);timeout.deps.recognize=async(_image,_language,signal)=>{timeout.expire();signal.throwIfAborted();};const stopped=await timeout.run();assert.equal(stopped.status,'partial');assert.equal(stopped.applied,0);assert.match(stopped.messages[0],/90초/);assert.ok(timeout.canvases.every(canvas=>canvas.width===0));assert.equal(timeout.timers.size,0);
});

test('a caught typed source mismatch stops before another image and is distinguishable from confirmed OCR failure',async()=>{
 const changed=fixture(),read=changed.deps.readSource;changed.deps.readSource=async(...args)=>{const image=await read(...args);image.source.sourceKey='owner/different-source.png';return image;};
 const result=await changed.run();assert.equal(result.status,'partial');assert.equal(result.sourceChanged,true);assert.equal(result.applied,0);assert.equal(changed.calls.filter(row=>row[0]==='read').length,1);assert.equal(changed.calls.some(row=>row[0]==='apply'),false);assert.equal(result.state.batches.option.items[1].status,'pending');assert.ok(changed.canvases.every(canvas=>canvas.width===0));
 const failed=fixture();failed.deps.recognize=async()=>{throw Error('ordinary confirmed OCR error');};const partial=await failed.run();assert.equal(partial.status,'partial');assert.equal(partial.sourceChanged,undefined);assert.equal(partial.applied,0);assert.equal(failed.calls.filter(row=>row[0]==='read').length,2);assert.equal(failed.calls.some(row=>row[0]==='apply'),false);
});

test('lack of images or a missing save acknowledgement never counts as completed',async()=>{
 const empty=fixture();empty.plan.tasks=[];empty.plan.messages=[{productId:'product',message:'저장한 이미지가 없습니다.'}];assert.equal((await empty.run()).status,'partial');
 const fake=fixture('main',['owner/source-a.png']);fake.deps.apply=async batch=>batch;const result=await fake.run();assert.equal(result.status,'partial');assert.equal(result.applied,0);assert.equal(result.failed,1);
});

test('a pre-dispatch rejection is retryable failure, and timeout after verified save preserves its applied proof',async()=>{
 const rejected=fixture('main',['owner/source-a.png']);rejected.deps.apply=async()=>{throw Error('source changed before dispatch');};const failed=await rejected.run();assert.equal(failed.status,'partial');assert.equal(failed.recoveryBatch,undefined);assert.equal(failed.state.batches.option.items[0].status,'failed');
 const h=fixture('main',['owner/source-a.png']),apply=h.deps.apply;h.deps.apply=async(...args)=>{const result=await apply(...args);h.expire();return result;};
 const stopped=await h.run();assert.equal(stopped.status,'partial');assert.equal(stopped.applied,1);assert.equal(stopped.state.batches.option.items[0].status,'applied');assert.equal(stopped.state.batches.option.items[0].rendered,undefined);h.deps.apply=apply;
 const resumed=await h.run();assert.equal(resumed.status,'completed');assert.equal(h.calls.filter(row=>row[0]==='apply').length,1);
});

test('Vision Korean results in selected main/additional/detail jobs are never sent to a second provider',async()=>{
 for(const stage of ['main','additional','detail']){
  const h=fixture(stage,['owner/source-a.png']);h.deps.recognize=async image=>{image.visionResult={provider:'workers-ai-vision',notice:'Cloudflare 사용량 과금 가능'};return[{...h.region('中文'),translated:'검정',translationProvenance:'generated'}];};
  h.deps.translate=async()=>{throw Error('Vision must never start Google or another provider');};
  const result=await h.run();assert.equal(result.status,'completed');assert.equal(result.applied,1);assert.equal(h.calls.filter(row=>row[0]==='render').length,1);assert.equal(h.calls.filter(row=>row[0]==='apply').length,1);
 }
});
test('failed Vision blocks preserve the source and stop without a second translation request or image save',async()=>{
 const h=fixture('main',['owner/source-a.png']);h.deps.recognize=async image=>{image.visionResult={provider:'workers-ai-vision',notice:'Cloudflare 사용량 과금 가능'};return[{...h.region('中文'),issue:'번역 검증 실패'}];};h.deps.translate=async()=>{throw Error('No fallback');};
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.applied,0);assert.equal(h.calls.filter(row=>row[0]==='render'||row[0]==='apply'||row[0]==='translate').length,0);
});
test('unsafe Vision geometry is a review failure, never no-foreign-text success or an automatic image apply',async()=>{
 const h=fixture('main',['owner/source-a.png']);h.deps.recognize=async image=>{image.visionResult={provider:'workers-ai-vision'};image.visionStyleIssues=['VISION_REGION_OVERLAP'];return[{...h.region('中文'),translated:'검정',translationProvenance:'generated',selected:false,issue:'VISION_REGION_OVERLAP'}];};
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.failed,1);assert.equal(result.applied,0);assert.match(result.messages.join(' '),/VISION_REGION_OVERLAP/);assert.equal(h.calls.filter(row=>['translate','render','apply'].includes(row[0])).length,0);
});

for(const stage of ['main','additional','detail'])test(`${stage}: uncertain Vision inference retains one source attempt and stops all later slots/options without upload recovery`,async()=>{
 const h=fixture(stage,stage==='main'?['owner/source-a.png']:undefined),requestId='0fa1748b-fd6e-4b16-8120-754071c7a73f';
 h.plan.tasks.push({...h.plan.tasks[0],optionId:'later-option',optionLabel:'후속 옵션'});
 const read=h.deps.readSource;h.deps.readSource=async(...args)=>{const loaded=await read(...args);loaded.source.quotationTarget.bindingSha256='c'.repeat(64);return loaded;};
 h.deps.recognize=async image=>{h.calls.push(['vision',image.source.sourceKey]);image.visionRequestId=requestId;throw new h.vision.FreeImageVisionError('provider response uncertain','IMAGE_VISION_TIMEOUT',true,{requestId,source:image.source,sourceLanguage:'zh',configuration:{provider:'workers-ai-vision',model:h.visionContract.IMAGE_TEXT_VISION_MODEL,configured:true,paidAllowed:true,notice:h.visionContract.IMAGE_TEXT_VISION_NOTICE}});};
 h.deps.recover=async()=>assert.fail('Vision is not an uncertain upload');
 h.deps.observe=async attempt=>{h.calls.push(['vision-status',attempt.requestId]);return{status:'uncertain'};};
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.inferencePending,true);assert.equal(result.recoveryBatch,undefined);assert.equal(result.applied,0);assert.equal(result.failed,1);
 assert.equal(h.calls.filter(row=>row[0]==='read').length,1);assert.equal(h.calls.filter(row=>row[0]==='vision').length,1);assert.equal(h.calls.some(row=>['translate','render','apply'].includes(row[0])),false);assert.ok(h.canvases.every(canvas=>canvas.width===0));
 const pending=plain(result.state.inferencePending);assert.equal(pending.attempt.requestId,requestId);assert.equal(pending.optionId,'option');assert.equal(pending.slotIndex,0);assert.equal(pending.attempt.source.sourceKey,'owner/source-a.png');assert.equal(result.state.batches['later-option'],undefined);
 const calls=h.calls.length,resumed=await h.run();assert.equal(resumed.inferencePending,true);assert.equal(h.calls.length,calls+1,'only the retained request status is read');assert.equal(h.calls.at(-1)[0],'vision-status');assert.deepEqual(plain(resumed.state.inferencePending),{...pending,observation:{status:'uncertain'}});
 h.plan.scope.company={code:'A01526306',name:'유앤채'};await assert.rejects(h.run(),/변경/);assert.equal(h.calls.length,calls+1);
});

for(const stage of ['main','additional','detail'])test(`${stage}: confirmed capacity stops remaining images and options without pending inference, fallback or image writes`,async()=>{
 const h=fixture(stage,stage==='main'?['owner/source-a.png']:undefined),requestId='0fa1748b-fd6e-4b16-8120-754071c7a73f',before=plain([h.content,h.view]);
 h.plan.tasks.push({...h.plan.tasks[0],optionId:'later-option',optionLabel:'후속 옵션'});
 const read=h.deps.readSource;h.deps.readSource=async(...args)=>{const image=await read(...args);image.source.quotationTarget.bindingSha256='c'.repeat(64);return image;};
 h.deps.recognize=async image=>{h.calls.push(['vision',image.source.sourceKey]);throw new h.vision.FreeImageVisionError('이미지 번역 서버가 혼잡합니다.','IMAGE_VISION_CAPACITY',false,{requestId,source:image.source,sourceLanguage:'zh',configuration:{provider:'workers-ai-vision',model:h.visionContract.IMAGE_TEXT_VISION_MODEL,configured:true,paidAllowed:true,notice:h.visionContract.IMAGE_TEXT_VISION_NOTICE}});};
 h.deps.observe=async()=>assert.fail('confirmed non-admission has no uncertain inference to observe');h.deps.recover=async()=>assert.fail('no upload was attempted');
 const result=await h.run();assert.equal(result.status,'partial');assert.equal(result.failed,1);assert.equal(result.applied,0);assert.equal(result.inferencePending,undefined);assert.equal(result.state.inferencePending,undefined);assert.equal(result.recoveryBatch,undefined);
 assert.equal(h.calls.filter(row=>row[0]==='read').length,1);assert.equal(h.calls.filter(row=>row[0]==='vision').length,1);assert.equal(h.calls.some(row=>['translate','render','apply'].includes(row[0])),false);
 assert.equal(result.state.batches.option.items[0].status,'failed');assert.ok(result.state.batches.option.items.slice(1).every(row=>row.status==='pending'));assert.equal(result.state.batches['later-option'],undefined);assert.match(result.messages.join(' '),/혼잡|남은 이미지/);
 assert.deepEqual(plain([h.content,h.view]),before);assert.ok(h.canvases.every(canvas=>canvas.width===0));
});
