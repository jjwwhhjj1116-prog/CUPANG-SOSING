import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];

// Reuse actual component/API harness declarations without importing their test
// registrations. The four production components communicate through their real
// callback props; only layout rendering and provider output are controlled.
function declarations(file,expose){
 const url=new URL('./'+file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  if(!ts.isVariableStatement(statement)&&!ts.isFunctionDeclaration(statement)&&!ts.isClassDeclaration(statement)&&!ts.isExpressionStatement(statement))break;
  parts.push(statement.getText(ast));
 }
 return vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(url.href))+'\n({'+expose+'})',
  {assert,fs,vm,ts,createRequire,deflateSync,mobileIntakeHarness,hubSchemaSnapshot,schemaCompanies,schemaPath,quotationWorkbook,readPackageZip,nodes,
   URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,AbortController,DOMException,TextEncoder,TextDecoder,Uint8Array,DataView,Buffer,Date,JSON,structuredClone,crypto,console,setTimeout,clearTimeout,setImmediate});
}
const main=declarations('option-main-image-editor.test.mjs','fixture,editor,plain,text');
const image=declarations('image-generation-panel-requests.test.mjs','harness,nodes,text,settle,prepare,roles,options,execute,refresh,deferred');
const detail=declarations('detail-image-edit-dialog-integration.test.mjs','dashboard');
const plain=main.plain;
const all=image.nodes;
const button=(ui,label)=>all(ui.render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||image.text(node)===label));
const input=(ui,kind,value)=>all(ui.render()).find(node=>node.type===kind&&(value===undefined||node.props.value===value));
const paid=d=>nodes(d.render()).find(node=>node.type?.name==='@/app/components/image-generation-panel:default').props;
async function publishOwnedImageAvailability(d,f){
 const route=f.backend.load('app/api/products/[id]/image-generation/route.ts'),response=await route.GET(new Request('https://app.test/api/products/'+f.product.id+'/image-generation'),{params:Promise.resolve({id:f.product.id})});
 assert.equal(response.status,200);const view=await response.json();
 paid(d).onAvailabilityChange({productId:view.product.id,productVersion:view.product.version,configured:view.configuration.configured});d.render();
}

for(const company of schemaCompanies)test(`selected final main image travels through real card, options wrapper, dashboard and AI panel into one explicit local prepared job (${company.code})`,async()=>{
 const f=await main.fixture(company),d=detail.dashboard();let o,p;
 try{
  const before=await f.read(),tables=()=>JSON.stringify(['products','product_content','product_options','product_price_policy','product_quotation_fields'].flatMap(table=>f.backend.sqlite.prepare('SELECT * FROM '+table).all())),baseline=tables(),network=[...f.backend.network];
  for(const key of before.imageKeys)f.backend.objects.set(key,f.backend.objects.get(key).slice(0,-1));
  f.backend.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';f.backend.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';
  const api=f.backend.load('app/api/products/[id]/image-generation/route.ts'),context={params:Promise.resolve({id:f.product.id})},endpoint='/api/products/'+f.product.id+'/image-generation';
  const read=()=>api.GET(new Request('https://app.test'+endpoint),context);
  d.render({workspaceOwnerId:'owner',product:{...f.product,owner_id:'owner'},tab:'대표 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id});
  const paidProps=()=>paid(d),card=()=>d.child('ProductOptionsEditor').props;
  const posts=[];
  p=image.harness(async(url,init)=>{assert.equal(url,endpoint);const body=JSON.parse(init.body);posts.push(body);assert.equal(body.action,'prepare','provider execution is forbidden in this fixture');return api.POST(new Request('https://app.test'+endpoint,{...init}),context);},
   {initialPending:read(),initialProps:{...paidProps(),productId:f.product.id,version:f.product.updated_at,imageKeys:before.imageKeys}});
  await p.idle();d.render();
  input(p,'textarea').props.onChange({target:{value:'직접 입력한 배경 보존 요청'}});input(p,'select','1024x1024').props.onChange({target:{value:'1536x1024'}});input(p,'select','low').props.onChange({target:{value:'high'}});
  o=main.editor(f,{wrapper:true,onProcess:(...args)=>card().onProcess(...args)});await o.idle();
  await o.click('최종 대표이미지 AI 처리');d.render();p.update(paidProps());await p.idle();
  const handed=paidProps().processingTarget;assert.equal(handed.sourceKey,f.key);assert.notEqual(handed.sourceKey,f.source);assert.equal(handed.quotationTarget.optionId,f.id);assert.equal(handed.quotationTarget.profileId,f.profile.id);assert.equal(handed.quotationTarget.value,f.key);assert.equal(paidProps().processingTargetActive,true);
  assert.equal(input(p,'select',f.key).props.disabled,true);assert.equal(input(p,'select','cleanup').props.disabled,true);assert.equal(input(p,'textarea').props.value,'직접 입력한 배경 보존 요청');assert.ok(input(p,'select','1536x1024'));assert.ok(input(p,'select','high'));
  assert.equal(button(p,image.roles),undefined);assert.equal(button(p,image.options),undefined);assert.equal(button(p,'검토한 결과 0개를 원본 위치에 함께 적용 · 무료'),undefined);assert.equal(posts.length,0);assert.equal(tables(),baseline);assert.equal(d.requests,0);
  p.click(image.prepare)();await p.idle();assert.equal(posts.length,1);assert.deepEqual({sourceKey:posts[0].sourceKey,purpose:posts[0].purpose,prompt:posts[0].prompt,size:posts[0].size,quality:posts[0].quality},
   {sourceKey:f.key,purpose:'cleanup',prompt:'직접 입력한 배경 보존 요청',size:'1536x1024',quality:'high'});
  const jobs=f.backend.sqlite.prepare('SELECT * FROM image_jobs').all();assert.equal(jobs.length,1);const saved=jobs[0],review=JSON.parse(saved.review);assert.equal(saved.status,'prepared');assert.equal(review.sourceKey,f.key);assert.equal(review.purpose,'cleanup');assert.equal(saved.result,null);
  assert.equal(tables(),baseline,'preparing a review cannot change any product, source, price or quotation');assert.deepEqual(f.backend.network,network);
 }finally{o?.close();p?.close();d.close();f.close();}
});

test('dashboard gates AI from the existing configuration callback and rejects old owner/version/option scope proofs while free tools remain supplied',()=>{
 const d=detail.dashboard(),product={id:'p',owner_id:'owner',updated_at:'2026-10-18T00:00:00.000Z',image_keys:'["owner/a.png"]'},base={workspaceOwnerId:'owner',product,tab:'대표 이미지',focusedOptionId:'red',preferredProfileId:'profile'};
 const proof={productId:'p',productVersion:product.updated_at,configured:true},target={kind:'quotation',profileId:'profile',optionId:'red',input:'mainImage',fieldKey:'mainImage',slotIndex:0,revision:1,inputFingerprint:'a'.repeat(64),optionRevision:1,value:'owner/a.png'};
 try{
  d.render(base);const card=()=>d.child('ProductOptionsEditor').props;
  assert.equal(card().processingConfigured,null);assert.equal(typeof card().onTranslate,'function');assert.equal(typeof card().onEdit,'function');
  card().onProcess('owner/a.png','main',target);assert.equal(paid(d).processingTarget,undefined);
  paid(d).onAvailabilityChange({...proof,configured:false});d.render();assert.equal(card().processingConfigured,false);card().onProcess('owner/a.png','main',target);assert.equal(paid(d).processingTarget,undefined);
  paid(d).onAvailabilityChange(proof);d.render();assert.equal(card().processingConfigured,true);
  const old=paid(d).onAvailabilityChange;
  for(const patch of [{tab:'추가 이미지'},{focusedOptionId:'blue'},{preferredProfileId:'other'},{product:{...product,updated_at:'2026-10-18T00:00:01.000Z'}},{workspaceOwnerId:'other'},{product:{...product,id:'other-product'}}]){
   d.render(patch);d.render(base);old(proof);d.render();assert.equal(card().processingConfigured,null,'old configuration callback cannot cross an ABA scope');
   card().onProcess('owner/a.png','main',target);assert.equal(paid(d).processingTarget,undefined);
  }
  paid(d).onAvailabilityChange(proof);d.render();card().onProcess('owner/a.png','main',target);assert.equal(paid(d).processingTarget.sourceKey,'owner/a.png');assert.equal(d.requests,0);
 }finally{d.close();}
});

test('retained card and dashboard handoffs cannot reopen after stage, focus, profile, version or owner ABA changes',async()=>{
 const f=await main.fixture(),d=detail.dashboard();let o;
 try{
  f.backend.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';f.backend.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';
  const product={...f.product,owner_id:'owner'},base={workspaceOwnerId:'owner',product,tab:'대표 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id};d.render(base);await publishOwnedImageAvailability(d,f);
  o=main.editor(f,{wrapper:true,onProcess:(...args)=>d.child('ProductOptionsEditor').props.onProcess(...args)});await o.idle();const oldCard=o.button('최종 대표이미지 AI 처리').props.onClick;
  o.props.imageView=false;await o.idle();o.props.imageView=true;await o.idle();oldCard();d.render();assert.equal(paid(d).processingTarget,undefined);
  await o.click('최종 대표이미지 AI 처리');d.render();const target=paid(d).processingTarget;assert.ok(target);
  for(const patch of [{tab:'추가 이미지'},{focusedOptionId:'other'},{preferredProfileId:'other-profile'},{product:{...product,updated_at:'2099-01-01T00:00:00.000Z'}},{workspaceOwnerId:'other'}]){
   const old=d.child('ProductOptionsEditor').props.onProcess;d.render(patch);d.render(base);old(f.key,'main',target.quotationTarget);d.render();assert.equal(paid(d).processingTarget,target);assert.equal(paid(d).processingTargetActive,false);
  }
  paid(d).onCloseProcessingTarget();d.render();assert.equal(paid(d).processingTarget,undefined);assert.equal(d.requests,0);assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{o?.close();d.close();f.close();}
});

const target=()=>({sourceKey:'owner/raw',sequence:1,productVersion:'v',quotationTarget:{kind:'quotation',profileId:'profile',optionId:'one',input:'mainImage',fieldKey:'mainImage',slotIndex:0,revision:2,inputFingerprint:'a'.repeat(64),optionRevision:1,value:'owner/raw'}});
test('a selected-image handoff during initial history loading completes without another GET or any POST',async()=>{
 const pending=image.deferred(),h=image.harness(()=>{throw Error('No extra requests allowed');},{initialPending:pending.promise});
 try{h.update({processingTarget:target(),processingTargetActive:true});pending.resolve(Response.json(h.view));await h.idle();assert.equal(h.initialCalls.length,1);assert.equal(h.initialCalls[0].init.signal.aborted,false);assert.equal(h.calls.length,0);assert.ok(h.click(image.prepare));assert.equal(input(h,'select','owner/raw').props.disabled,true);}
 finally{h.close();}
});
test('pinned mode preserves its source and manual request across invalidation; retained prepare and broad apply callbacks cannot write',async()=>{
 const pending=image.deferred(),h=image.harness(()=>pending.promise);
 try{await h.idle();const oldRoles=h.click(image.roles),oldOptions=h.click(image.options),oldPrepare=h.click(image.prepare);
  input(h,'textarea').props.onChange({target:{value:'보존할 직접 입력'}});h.update({processingTarget:target(),processingTargetActive:true});await image.settle();oldRoles();oldOptions();oldPrepare();await image.settle();assert.equal(h.calls.length,0);
  const currentPrepare=h.click(image.prepare);h.update({processingTargetActive:false});h.update({processingTargetActive:true});currentPrepare();await image.settle();assert.equal(h.calls.length,0,'active ABA cannot revive a captured callback');
  const action=h.click(image.prepare);action();assert.equal(h.calls.length,1);h.update({processingTargetActive:false});assert.equal(h.calls[0].init.signal.aborted,true);pending.resolve(Response.json({job:{...h.job,status:'prepared',result:null}}));await image.settle();assert.equal(h.changed,0);assert.equal(input(h,'textarea').props.value,'보존할 직접 입력');assert.equal(input(h,'select','owner/raw').props.disabled,true);assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,image.roles),undefined);assert.equal(button(h,image.options),undefined);
 }finally{h.close();}
});
test('unconfigured provider disables both selected-source preparation and an already approved execution',async()=>{
 const pending=image.deferred(),h=image.harness(()=>{throw Error('No provider request allowed');},{status:'approved',initialPending:pending.promise,initialProps:{processingTarget:target()}});
 try{h.job.review.purpose='cleanup';h.view.configuration.configured=false;h.view.configuration.issues=['검수용 미연결'];pending.resolve(Response.json(h.view));await h.idle();assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,image.execute).props.disabled,true);button(h,image.prepare).props.onClick();button(h,image.execute).props.onClick();await image.settle();assert.equal(h.calls.length,0);assert.match(image.text(h.render()),/검수용 미연결/);}
 finally{h.close();}
});
test('inactive selected-image scope can explicitly reread a running job without reopening any write or losing the manual request',async()=>{
 let closed=0;const h=image.harness(async(_url,init,data)=>{assert.equal(init?.method,undefined);return Response.json({...data.view,jobs:[{...data.job,status:'completed',result:{attached:true,storageKey:'owner/edited'}}]});},
  {status:'running',initialProps:{processingTarget:target(),onCloseProcessingTarget(){closed++;}}});
 try{await h.idle();input(h,'textarea').props.onChange({target:{value:'실행 결과 확인 중에도 보존'}});h.update({processingTargetActive:false});
  assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,'선택 옵션 AI 처리 종료 · 공통 작업으로 돌아가기').props.disabled,false,'historical running status alone does not lock the inactive editor');
  h.click(image.refresh)();assert.equal(button(h,'선택 옵션 AI 처리 종료 · 공통 작업으로 돌아가기').props.disabled,true,'the active history read still locks closing');await h.idle();assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,undefined);assert.equal(button(h,image.prepare).props.disabled,true);assert.equal(button(h,image.roles),undefined);assert.equal(button(h,image.options),undefined);assert.equal(input(h,'textarea').props.value,'실행 결과 확인 중에도 보존');
  h.click('선택 옵션 AI 처리 종료 · 공통 작업으로 돌아가기')();assert.equal(closed,1);assert.equal(h.calls.some(call=>call.init.method==='POST'||call.init.method==='PATCH'),false);
 }finally{h.close();}
});

async function completedMainFixture(company){
 const f=await main.fixture(company),d=detail.dashboard();let o,p,changed=0,lose=false,unavailable=false,heldWrite=null,heldSaveRead=null,quoteReads=0;
 const calls=[];
 try{
  const before=await f.read(),product={...f.product,owner_id:'owner'},base='/api/products/'+f.product.id;
  f.backend.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';f.backend.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';
  f.backend.objects.set(f.key,f.backend.objects.get(f.key).slice(0,-1));
  d.render({workspaceOwnerId:'owner',product,tab:'대표 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id});
  await publishOwnedImageAvailability(d,f);
  o=main.editor(f,{wrapper:true,onProcess:(...args)=>d.child('ProductOptionsEditor').props.onProcess(...args)});await o.idle();await o.click('최종 대표이미지 AI 처리');d.render();const target=paid(d).processingTarget;
  assert.ok(target.quotationView);assert.equal(target.ownerId,'owner');
  const api=f.backend.load('app/api/products/[id]/image-generation/route.ts'),context={params:Promise.resolve({id:f.product.id})},readJobs=()=>api.GET(new Request('https://app.test'+base+'/image-generation'),context),config=await(await readJobs()).json();
  const model=f.backend.load('app/automation/image-edit.ts'),store=f.backend.load('db/image-jobs.ts'),id=crypto.randomUUID();
  const review=await model.prepareImageReview({sourceKey:f.key,prompt:'보존할 수동 요청',purpose:'cleanup',size:'1024x1024',quality:'low'},await model.imageMetadata(f.backend.objects.get(f.key)),'gpt-image-1.5',config.settings);
  const job={id,productId:f.product.id,productVersion:f.product.updated_at,contentRevision:before.contentRevision,status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
  assert.equal((await store.createImageJob('owner',job,f.product.image_keys,'local-main-'+id,'LOCAL-ONLY-IMAGE-PROOF')).conflict,false);await store.approveImageJob('owner',f.product.id,id,review.fingerprint,new Date().toISOString());
  const running=await store.claimImageJob('owner',f.product.id,id,review.fingerprint,'LOCAL-ONLY-CLAIM',new Date().toISOString());assert.equal(running.status,'running');
  const crc32=f.backend.load('app/exports/zip.ts').crc32,chunk=(name,data)=>{const label=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([length,label,data,crc]);},header=Buffer.alloc(13);header.writeUInt32BE(1024);header.writeUInt32BE(1024,4);header[8]=8;header[9]=6;
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(1024*(1024*4+1)))),chunk('IEND',Buffer.alloc(0))]),metadata=await model.imageMetadata(bytes),key='owner/ai-'+id+'.png';
  await f.backend.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{imageJobId:id,provenance:'generated',sha256:metadata.sha256}});
  const completed=await store.finishImageSuccess('owner',running,'LOCAL-ONLY-CLAIM',{...metadata,storageKey:key,model:review.model,purpose:review.purpose,generatedAt:new Date().toISOString(),providerRequestId:null,usage:null,attached:false,assignedRole:false,provenance:'generated',reviewRequired:true});assert.equal(completed.result.attached,true);
  const productNow=()=>plain(f.backend.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id));
  d.render({product:productNow()});assert.equal(paid(d).processingTargetActive,false);assert.equal(paid(d).processingResultActive,true);
  const transport=async(url,init={})=>{
   calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});
   if(unavailable&&(init.method??'GET')==='GET')throw Error('LOCAL read unavailable');
   if(url===base+'/image-generation'){assert.equal(init.method,undefined,'model execution is forbidden');return readJobs();}
   if(url.startsWith('/api/files/')){const owned=url.slice(11).split('/').map(decodeURIComponent).join('/');return new Response(f.backend.objects.get(owned),{headers:{'content-type':'image/png'}});}
   assert.ok(url.startsWith(base+'/quotation-fields'),'unexpected source write');if(heldSaveRead&&(init.method??'GET')==='GET'&&++quoteReads===2){const pending=heldSaveRead;heldSaveRead=null;pending.started.resolve();await pending.gate.promise;}
   const response=await f.backend.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});
   if(heldWrite&&init.method==='PUT'){assert.equal(response.status,200);const pending=heldWrite;heldWrite=null;pending.started.resolve();await pending.gate.promise;}
   if(lose&&init.method==='PUT'){assert.equal(response.status,200);lose=false;unavailable=true;throw Error('LOCAL committed main-image ACK lost');}return response;
  };
  p=image.harness(transport,{initialPending:readJobs(),initialProps:{...paid(d),onProductChanged(){changed++;paid(d).onProductChanged();}}});await p.idle();
  return {f,d,o,p,before,target,completed,key,bytes,calls,productNow,read:()=>f.read(),get changed(){return changed;},lost(){lose=true;},recover(){unavailable=false;},holdWrite(){heldWrite={gate:image.deferred(),started:image.deferred()};return heldWrite;},holdSaveRead(){quoteReads=0;heldSaveRead={gate:image.deferred(),started:image.deferred()};return heldSaveRead;},syncPanel(){p.update({...paid(d),onProductChanged(){changed++;paid(d).onProductChanged();}});},
   async newCleanupTarget(){
    Object.assign(f.product,productNow());d.render({product:productNow()});await publishOwnedImageAvailability(d,f);o.props.version=f.product.updated_at;o.props.refreshToken=f.product.updated_at;await o.idle();await o.click('최종 대표이미지 AI 처리');d.render();
    const freshBefore=await f.read(),freshProduct=productNow(),freshId=crypto.randomUUID(),freshKey='owner/ai-'+freshId+'.png',freshReview=await model.prepareImageReview({sourceKey:f.key,prompt:'새로 검토한 요청',purpose:'cleanup',size:'1024x1024',quality:'low'},await model.imageMetadata(f.backend.objects.get(f.key)),'gpt-image-1.5',config.settings);
    const freshJob={...job,id:freshId,productVersion:freshProduct.updated_at,contentRevision:freshBefore.contentRevision,review:freshReview,createdAt:new Date().toISOString()};
    assert.equal((await store.createImageJob('owner',freshJob,freshProduct.image_keys,'local-fresh-'+freshId,'LOCAL-ONLY-FRESH-PROOF')).conflict,false);await store.approveImageJob('owner',f.product.id,freshId,freshReview.fingerprint,new Date().toISOString());
    const freshRunning=await store.claimImageJob('owner',f.product.id,freshId,freshReview.fingerprint,'LOCAL-FRESH-CLAIM',new Date().toISOString());assert.equal(freshRunning.status,'running');
    await f.backend.bindings.FILES.put(freshKey,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{imageJobId:freshId,provenance:'generated',sha256:metadata.sha256}});
    const freshCompleted=await store.finishImageSuccess('owner',freshRunning,'LOCAL-FRESH-CLAIM',{...completed.result,storageKey:freshKey,generatedAt:new Date().toISOString(),attached:false});assert.equal(freshCompleted.result.attached,true);
    d.render({product:productNow()});p.update({...paid(d),onProductChanged(){changed++;paid(d).onProductChanged();}});await p.idle();return freshKey;
   },
   source:()=>JSON.stringify(['product_options','product_content','product_price_policy'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table).all())),
   async reload(){d.render({product:productNow()});Object.assign(f.product,productNow());o.props.version=f.product.updated_at;o.props.refreshToken=f.product.updated_at;await o.idle();p.update({...paid(d),onProductChanged(){changed++;paid(d).onProductChanged();}});await p.idle();},close(){p.close();o.close();d.close();f.close();}};
 }catch(cause){p?.close();o?.close();d.close();f.close();throw cause;}
}
const applySelected='선택 옵션 대표이미지에 적용',recoverSelected='같은 대표이미지 저장 결과 확인 · 읽기 전용';
for(const company of schemaCompanies)test(`${company.code}: completed owned AI result applies directly to the selected final quotation after its verified image-only product advance`,async()=>{
 const h=await completedMainFixture(company);try{
  const source=h.source(),files=[...h.f.backend.objects.keys()],network=[...h.f.backend.network];input(h.p,'textarea').props.onChange({target:{value:'직접 작성한 요청 보존'}});assert.equal(button(h.p,applySelected).props.disabled,false);assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);
  h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,1,image.text(h.p.render()));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);const after=await h.read(),binding=h.f.backend.load('app/quotation-main-image.ts').verifyMainImageView(after),expected=plain(h.before.overrides);
  for(const field of binding.linked)expected.options[h.f.id][field]=h.key;assert.deepEqual(plain(after.overrides),expected);assert.equal(after.revision,h.before.revision+1);assert.equal(after.contentRevision,h.before.contentRevision);assert.equal(after.optionRevision,h.before.optionRevision);assert.equal(h.source(),source);assert.deepEqual([...h.f.backend.objects.keys()],files);assert.deepEqual(h.f.backend.network,network);
  await h.reload();assert.equal(input(h.p,'textarea').props.value,'직접 작성한 요청 보존');assert.ok(nodes(h.o.render()).some(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지'&&node.props.src==='/api/files/'+h.key));
  h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,2,image.text(h.p.render()));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1,'identical already selected result is confirmed without another PUT');assert.equal(h.source(),source);
 }finally{h.close();}
});
test('direct main AI apply blocks changed source/other manual fields or altered stored result bytes before a PUT',async()=>{
 for(const mode of ['manual','bytes','option','dirty']){const h=await completedMainFixture(schemaCompanies[0]);try{
   if(mode==='manual'){const view=await h.read();await h.f.backend.route(h.f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:null,fieldKey:'brand',value:'다른 저장 수정'}]}});}
   if(mode==='bytes')h.f.backend.objects.set(h.key,h.bytes.slice(0,-1));
   if(mode==='option'){const old=button(h.p,applySelected).props.onClick,baseProps={...h.d.child('ProductOptionsEditor').props};h.d.render({focusedOptionId:'other'});h.d.render({focusedOptionId:baseProps.focusedOptionId});h.p.update(paid(h.d));old();await image.settle();assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);continue;}
   if(mode==='dirty'){h.d.render({onBeforeFreeImageApply:()=>false});h.p.update(paid(h.d));}
   const source=h.source(),before=await h.read();h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,0);assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);assert.deepEqual(plain(await h.read()),plain(before));assert.equal(h.source(),source);
  }finally{h.close();}
 }
});
test('a committed direct AI image save with lost ACK keeps its result and only explicit read recovery confirms without another PUT',async()=>{
 const h=await completedMainFixture(schemaCompanies[1]);try{h.lost();h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,0);assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.ok(button(h.p,recoverSelected));assert.equal(button(h.p,applySelected).props.disabled,true);
  h.recover();h.p.click(recoverSelected)();await h.p.idle();assert.equal(h.changed,1);assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(button(h.p,recoverSelected),undefined);assert.equal((await h.read()).resolved.rows.find(row=>row.optionId===h.f.id).fields.mainImage.value,h.key);
 }finally{h.close();}
});
test('stage change after exact AI image PUT dispatch retains the read-only recovery even when its ACK is aborted',async()=>{
 const h=await completedMainFixture(schemaCompanies[0]);try{
  const pending=h.holdWrite();h.p.click(applySelected)();await pending.started.promise;
  h.d.render({tab:'추가 이미지'});h.syncPanel();assert.equal(button(h.p,applySelected).props.disabled,true);assert.ok(button(h.p,recoverSelected));
  pending.gate.resolve();await h.p.idle();assert.equal(h.changed,0);assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);
  h.p.click(recoverSelected)();await h.p.idle();assert.equal(h.changed,1,image.text(h.p.render())+' '+JSON.stringify(h.calls));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(button(h.p,recoverSelected),undefined);
  assert.equal((await h.read()).resolved.rows.find(row=>row.optionId===h.f.id).fields.mainImage.value,h.key);
 }finally{h.close();}
});
test('a proven pre-PUT conflict clears its cached attempt so a newly explicit main-image handoff can apply a fresh owned result',async()=>{
 const h=await completedMainFixture(schemaCompanies[1]);try{
  const pending=h.holdSaveRead();h.p.click(applySelected)();await pending.started.promise;
  const current=await h.read();await h.f.backend.route(h.f.endpoint,{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[{optionId:null,fieldKey:'brand',value:'사용자가 새로 저장한 브랜드'}]}});
  pending.gate.resolve();await h.p.idle();assert.equal(h.changed,0);assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);assert.equal(button(h.p,recoverSelected),undefined);
  const freshKey=await h.newCleanupTarget();h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,1,image.text(h.p.render()));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);
  const saved=await h.read();assert.equal(saved.resolved.rows.find(row=>row.optionId===h.f.id).fields.mainImage.value,freshKey);assert.equal(saved.overrides.common.brand,'사용자가 새로 저장한 브랜드');
 }finally{h.close();}
});
