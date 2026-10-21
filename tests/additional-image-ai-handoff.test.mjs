import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
// Existing real component hooks/API fixtures only; no test registrations or
// older suite after-hooks are imported. Fixture transforms add the new props
// and an observed native additional-image field, never replace production code.
function declarations(file,expose,transform=source=>source){
 const url=new URL('./'+file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  if(!ts.isVariableStatement(statement)&&!ts.isFunctionDeclaration(statement)&&!ts.isClassDeclaration(statement)&&!ts.isExpressionStatement(statement))break;
  parts.push(statement.getText(ast));
 }
 return vm.runInNewContext(transform(parts.join('\n')).replaceAll('import.meta.url',JSON.stringify(url.href))+'\n({'+expose+'})',
  {assert,fs,path,vm,ts,createRequire,deflateSync,mobileIntakeHarness,hubSchemaSnapshot,schemaCompanies,schemaPath,quotationWorkbook,readPackageZip,nodes,
   URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,AbortController,DOMException,TextEncoder,TextDecoder,Uint8Array,DataView,Buffer,Date,JSON,structuredClone,crypto,console,setTimeout,clearTimeout,setImmediate});
}
function replaceOnce(source,before,after){assert.equal(source.split(before).length-1,1,'existing fixture declaration: '+before);return source.replace(before,after);}
const core=declarations('option-main-image-editor.test.mjs','fixture,plain',source=>replaceOnce(source,'snapshot.schemaString=JSON.stringify(schema);',"schema.properties.imagePage.properties.images.properties.additionalImage={type:'string',title:'추가 이미지',requirement:'선택'};snapshot.schemaString=JSON.stringify(schema);"));
const cardFixture=declarations('option-image-editor.test.mjs','imageUI,text',source=>{
 source=replaceOnce(source,'confirmImage=()=>true,onTranslate,onEdit}={})','confirmImage=()=>true,onTranslate,onEdit,onProcess,processingConfigured=null}={})');
 source=replaceOnce(source,'disabled,onTranslate,onEdit,onSaved(){','disabled,onTranslate,onEdit,onProcess,processingConfigured,onSaved(){');
 return replaceOnce(source,'close(){closed=true;','configured(value){processingConfigured=value;render();},close(){closed=true;');
});
const image=declarations('image-generation-panel-requests.test.mjs','harness,nodes,text,prepare,roles,options,execute,refresh,deferred,settle');
const detail=declarations('detail-image-edit-dialog-integration.test.mjs','dashboard');
const plain=core.plain,json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const button=(ui,label)=>nodes(ui.render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||image.text(node)===label));
const input=(ui,kind,value)=>nodes(ui.render()).find(node=>node.type===kind&&(value===undefined||node.props.value===value));
const paid=d=>nodes(d.render()).find(node=>node.type?.name==='@/app/components/image-generation-panel:default').props;
const aiDisclosure=d=>nodes(d.render()).find(node=>node.type==='details'&&nodes(node.props.children).some(child=>child.type?.name==='@/app/components/image-generation-panel:default'));
const card=d=>nodes(d.render()).find(node=>node.type?.name?.endsWith(':OptionImageEditor')&&node.props.stage==='additional').props;
const ai='추가 이미지 2 AI 처리',applySelected='선택 옵션 추가이미지에 적용',recoverSelected='같은 추가이미지 저장 결과 확인 · 읽기 전용';
async function fixture(company=schemaCompanies[0]){
 const f=await core.fixture(company);
 try{
  const view=await f.read(),model=f.backend.load('app/quotation-image-targets.ts'),list=view.imageKeys.filter(key=>key!==f.key).slice(0,3);assert.equal(list.length,3);
  await json(await f.backend.route(f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:model.optionImageChanges(view,f.id,{additionalImages:list.join('\n')})}}));
  Object.assign(f.product,plain(f.backend.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id)));
  return Object.assign(f,{list,selectedKey:list[1],sourceTables:()=>JSON.stringify(['product_content','product_options','product_price_policy','collection_results','collection_context'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table).all()))});
 }catch(cause){f.close();throw cause;}
}
async function availability(d,f){
 const response=await f.backend.load('app/api/products/[id]/image-generation/route.ts').GET(new Request('https://app.test/api/products/'+f.product.id+'/image-generation'),{params:Promise.resolve({id:f.product.id})});
 const view=await json(response);paid(d).onAvailabilityChange({productId:view.product.id,productVersion:view.product.version,configured:view.configuration.configured});d.render();
}
function editor(f,d,extra={}){return cardFixture.imageUI((url,init)=>f.request(url,init),{productId:f.product.id,optionId:f.id,version:f.product.updated_at,profileId:f.profile.id,stage:'additional',active:true,saveOnChange:true,processingConfigured:card(d).processingConfigured,
 onProcess:(...args)=>card(d).onProcess(...args),onTranslate:(...args)=>card(d).onTranslate(...args),onEdit:(...args)=>card(d).onEdit(...args),...extra});}

for(const company of schemaCompanies)test(`${company.code}: selected middle additional card reaches the dashboard and pinned existing prepare endpoint exactly once without running a model`,async()=>{
 const f=await fixture(company),d=detail.dashboard();let o,p;
 try{
  f.backend.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';f.backend.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';f.backend.objects.set(f.selectedKey,f.backend.objects.get(f.selectedKey).slice(0,-1));
  const before=await f.read(),tables=()=>JSON.stringify(['products','product_content','product_options','product_quotation_fields','image_jobs'].map(table=>f.backend.sqlite.prepare('SELECT * FROM '+table).all())),baseline=tables(),sourceBefore=f.sourceTables(),productBefore=JSON.stringify(f.backend.sqlite.prepare('SELECT * FROM products').all()),files=[...f.backend.objects.keys()],network=[...f.backend.network];
  d.render({workspaceOwnerId:'owner',product:{...f.product,owner_id:'owner'},tab:'추가 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id});
  const api=f.backend.load('app/api/products/[id]/image-generation/route.ts'),endpoint='/api/products/'+f.product.id+'/image-generation',context={params:Promise.resolve({id:f.product.id})},posts=[];
  p=image.harness(async(url,init)=>{assert.equal(url,endpoint);const body=JSON.parse(init.body);posts.push(body);assert.equal(body.action,'prepare','no provider execution');return api.POST(new Request('https://app.test'+endpoint,init),context);},{initialPending:api.GET(new Request('https://app.test'+endpoint),context),initialProps:{...paid(d)}});await p.idle();d.render();
  input(p,'textarea').props.onChange({target:{value:'직접 입력한 추가이미지 문구 정리 요청'}});input(p,'select','1024x1024').props.onChange({target:{value:'1536x1024'}});input(p,'select','low').props.onChange({target:{value:'high'}});
  o=editor(f,d);await o.idle();await o.click('추가 이미지 2 크게 보기');await o.click(ai);d.render();p.update(paid(d));await p.idle();
  const target=paid(d).processingTarget;assert.equal(target.sourceKey,f.selectedKey);assert.equal(target.quotationTarget.input,'additionalImages');assert.equal(target.quotationTarget.slotIndex,1);assert.equal(target.quotationTarget.value,f.list.join('\n'));assert.equal(target.quotationTarget.optionId,f.id);assert.equal(target.quotationTarget.profileId,f.profile.id);assert.deepEqual(plain(target.quotationView),plain(before));assert.equal(paid(d).processingTargetActive,true);
  assert.equal(input(p,'select',f.selectedKey).props.disabled,true);assert.equal(input(p,'select','cleanup').props.disabled,true);assert.equal(input(p,'textarea').props.value,'직접 입력한 추가이미지 문구 정리 요청');assert.ok(input(p,'select','1536x1024'));assert.ok(input(p,'select','high'));assert.equal(posts.length,0);assert.equal(tables(),baseline);assert.equal(button(p,image.roles),undefined);assert.equal(button(p,image.options),undefined);
  p.click(image.prepare)();await p.idle();assert.equal(posts.length,1);assert.deepEqual({sourceKey:posts[0].sourceKey,purpose:posts[0].purpose,prompt:posts[0].prompt,size:posts[0].size,quality:posts[0].quality},{sourceKey:f.selectedKey,purpose:'cleanup',prompt:'직접 입력한 추가이미지 문구 정리 요청',size:'1536x1024',quality:'high'});
  const jobs=f.backend.sqlite.prepare('SELECT * FROM image_jobs').all();assert.equal(jobs.length,1);assert.equal(jobs[0].status,'prepared');assert.equal(jobs[0].result,null);assert.equal(JSON.parse(jobs[0].review).sourceKey,f.selectedKey);
  assert.deepEqual(plain(await f.read()),plain(before));assert.equal(f.sourceTables(),sourceBefore);assert.equal(JSON.stringify(f.backend.sqlite.prepare('SELECT * FROM products').all()),productBefore);assert.deepEqual([...f.backend.objects.keys()],files);assert.deepEqual(f.backend.network,network);assert.equal(d.requests,0);
 }finally{o?.close();p?.close();d.close();f.close();}
});

test('additional dashboard rejects retained owner, product, version, option, category and stage ABA handoffs while provider-false free tools remain usable',async()=>{
 const f=await fixture(),d=detail.dashboard();let o;
 try{
  const product={...f.product,owner_id:'owner'},base={workspaceOwnerId:'owner',product,tab:'추가 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id};d.render(base);
  await availability(d,f);assert.equal(card(d).processingConfigured,false);let translated=0,edited=0;
  o=editor(f,d,{onTranslate(){translated++;},onEdit(){edited++;}});await o.idle();await o.click('추가 이미지 2 크게 보기');assert.equal(button(o,ai).props.disabled,true);assert.equal(cardFixture.text(button(o,ai)),'AI 서버 설정 필요');button(o,ai).props.onClick();assert.equal(paid(d).processingTarget,undefined);
  await o.click('추가 이미지 2 중국어 한국어 번역');await o.click('추가 이미지 2 편집하기');assert.equal(translated,1);assert.equal(edited,1);
  f.backend.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';f.backend.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';await availability(d,f);o.configured(true);await o.idle();
  const view=await f.read(),model=f.backend.load('app/quotation-image-targets.ts'),target={kind:'quotation',profileId:f.profile.id,optionId:f.id,input:'additionalImages',fieldKey:model.optionImageTargets(view.resolved.schema.fields).additionalImages.primary,slotIndex:1,revision:view.revision,inputFingerprint:view.inputFingerprint,optionRevision:view.optionRevision,value:f.list.join('\n')};
  for(const patch of [{tab:'대표 이미지'},{focusedOptionId:'other'},{preferredProfileId:'other-category'},{product:{...product,updated_at:'2099-01-01T00:00:00.000Z'}},{workspaceOwnerId:'other'},{product:{...product,id:'other-product'}}]){
   const old=card(d).onProcess;d.render(patch);d.render(base);old(f.selectedKey,'additional',target,view);d.render();assert.equal(paid(d).processingTarget,undefined,'retained callback cannot cross ABA');await availability(d,f);
  }
  await o.click(ai);d.render();assert.equal(paid(d).processingTarget.sourceKey,f.selectedKey);assert.ok(f.calls.every(call=>call.method==='GET'));assert.equal(d.requests,0);
 }finally{o?.close();d.close();f.close();}
});

async function completedFixture(company){
 const f=await fixture(company),d=detail.dashboard();let o,p,changed=0,lose=false,unavailable=false,heldWrite=null;const calls=[];
 try{
  f.backend.bindings.OPENAI_API_KEY='TEST-ONLY-NOT-A-REAL-KEY';f.backend.bindings.SOURCEFLOW_IMAGE_MODEL='gpt-image-1.5';f.backend.objects.set(f.selectedKey,f.backend.objects.get(f.selectedKey).slice(0,-1));
  const before=await f.read(),base='/api/products/'+f.product.id;d.render({workspaceOwnerId:'owner',product:{...f.product,owner_id:'owner'},tab:'추가 이미지',focusedOptionId:f.id,preferredProfileId:f.profile.id});await availability(d,f);
  o=editor(f,d);await o.idle();await o.click('추가 이미지 2 크게 보기');await o.click(ai);d.render();const target=paid(d).processingTarget;assert.ok(target.quotationView);
  const api=f.backend.load('app/api/products/[id]/image-generation/route.ts'),context={params:Promise.resolve({id:f.product.id})},readJobs=()=>api.GET(new Request('https://app.test'+base+'/image-generation'),context),config=await json(await readJobs());
  const model=f.backend.load('app/automation/image-edit.ts'),store=f.backend.load('db/image-jobs.ts'),id=crypto.randomUUID(),review=await model.prepareImageReview({sourceKey:f.selectedKey,prompt:'합성 추가 이미지 정리',purpose:'cleanup',size:'1024x1024',quality:'low'},await model.imageMetadata(f.backend.objects.get(f.selectedKey)),'gpt-image-1.5',config.settings);
  const job={id,productId:f.product.id,productVersion:f.product.updated_at,contentRevision:before.contentRevision,status:'prepared',review,result:null,error:null,createdAt:new Date().toISOString(),approvedAt:null,startedAt:null,finishedAt:null};
  assert.equal((await store.createImageJob('owner',job,f.product.image_keys,'local-additional-'+id,'LOCAL-ONLY-RESULT')).conflict,false);await store.approveImageJob('owner',f.product.id,id,review.fingerprint,new Date().toISOString());const running=await store.claimImageJob('owner',f.product.id,id,review.fingerprint,'LOCAL-ONLY-CLAIM',new Date().toISOString());assert.equal(running.status,'running');
  const crc32=f.backend.load('app/exports/zip.ts').crc32,chunk=(name,data)=>{const label=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([length,label,data,crc]);},header=Buffer.alloc(13);header.writeUInt32BE(1024);header.writeUInt32BE(1024,4);header[8]=8;header[9]=6;
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(1024*(1024*4+1)))),chunk('IEND',Buffer.alloc(0))]),metadata=await model.imageMetadata(bytes),key='owner/ai-'+id+'.png';
  await f.backend.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'},customMetadata:{imageJobId:id,provenance:'generated',sha256:metadata.sha256}});
  const completed=await store.finishImageSuccess('owner',running,'LOCAL-ONLY-CLAIM',{...metadata,storageKey:key,model:review.model,purpose:review.purpose,generatedAt:new Date().toISOString(),providerRequestId:null,usage:null,attached:false,assignedRole:false,provenance:'generated',reviewRequired:true});assert.equal(completed.result.attached,true);
  const productNow=()=>plain(f.backend.sqlite.prepare('SELECT * FROM products WHERE id=?').get(f.product.id));d.render({product:productNow()});assert.equal(paid(d).processingTargetActive,false);assert.equal(paid(d).processingResultActive,true);
  const transport=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body?JSON.parse(init.body):undefined});if(unavailable&&(init.method??'GET')==='GET')throw Error('LOCAL read unavailable');
   if(url===base+'/image-generation'){assert.equal(init.method,undefined,'no provider execution');return readJobs();}if(url.startsWith('/api/files/'))return new Response(f.backend.objects.get(url.slice(11).split('/').map(decodeURIComponent).join('/')),{headers:{'content-type':'image/png'}});
   assert.ok(url.startsWith(base+'/quotation-fields'),'no source write');const response=await f.backend.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});
   if(heldWrite&&init.method==='PUT'){assert.equal(response.status,200);const pending=heldWrite;heldWrite=null;pending.started.resolve();await pending.gate.promise;}if(lose&&init.method==='PUT'){assert.equal(response.status,200);lose=false;unavailable=true;throw Error('LOCAL committed additional-image ACK lost');}return response;
  };
  const props=()=>({...paid(d),onProductChanged(){changed++;paid(d).onProductChanged();}});p=image.harness(transport,{initialPending:readJobs(),initialProps:props()});await p.idle();
  return{f,d,o,p,before,key,bytes,target,completed,calls,productNow,get changed(){return changed;},read:()=>f.read(),lost(){lose=true;},recover(){unavailable=false;},syncPanel(){p.update(props());},holdWrite(){heldWrite={gate:image.deferred(),started:image.deferred()};return heldWrite;},async reload(){Object.assign(f.product,productNow());d.render({product:productNow()});o.source(f.product.updated_at,f.product.updated_at);await o.idle();p.update(props());await p.idle();},close(){p.close();o.close();d.close();f.close();}};
 }catch(cause){p?.close();o?.close();d.close();f.close();throw cause;}
}
for(const company of schemaCompanies)test(`${company.code}: completed owned cleanup result replaces only the selected middle additional-image slot and linked field`,async()=>{
 const h=await completedFixture(company);try{
  const sources=h.f.sourceTables(),files=[...h.f.backend.objects.keys()],network=[...h.f.backend.network],model=h.f.backend.load('app/quotation-image-targets.ts');input(h.p,'textarea').props.onChange({target:{value:'유지할 추가 이미지 수동 요청'}});assert.equal(button(h.p,applySelected).props.disabled,false);
  h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,1,image.text(h.p.render()));const after=await h.read(),expected=plain(h.before.overrides),list=[h.f.list[0],h.key,h.f.list[2]];
  for(const field of model.optionImageTargets(after.resolved.schema.fields).additionalImages.linked)expected.options[h.f.id][field]=list.join('\n');assert.deepEqual(plain(after.overrides),expected);assert.equal(after.revision,h.before.revision+1);assert.equal(after.contentRevision,h.before.contentRevision);assert.equal(after.optionRevision,h.before.optionRevision);assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(h.f.sourceTables(),sources);assert.deepEqual([...h.f.backend.objects.keys()],files);assert.deepEqual(h.f.backend.network,network);
  await h.reload();assert.deepEqual(plain(h.o.ordered()),list);assert.equal(input(h.p,'textarea').props.value,'유지할 추가 이미지 수동 요청');h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,2,image.text(h.p.render()));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1,'same stored result is acknowledged without another write');
 }finally{h.close();}
});
test('additional-image apply with lost ACK retains the exact slot attempt and explicit read recovery never repeats PUT',async()=>{
 const h=await completedFixture(schemaCompanies[0]);try{h.lost();h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,0);assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.ok(button(h.p,recoverSelected));assert.equal(button(h.p,applySelected).props.disabled,true);
  h.recover();h.p.click(recoverSelected)();await h.p.idle();assert.equal(h.changed,1,image.text(h.p.render()));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(button(h.p,recoverSelected),undefined);assert.equal((await h.read()).resolved.rows.find(row=>row.optionId===h.f.id).fields.additionalImages.value,[h.f.list[0],h.key,h.f.list[2]].join('\n'));
 }finally{h.close();}
});
test('additional-image apply rejects changed source or result bytes and retained cross-stage result callbacks before any PUT',async()=>{
 for(const mode of ['manual','bytes','owner','option','category','stage','dirty']){const h=await completedFixture(schemaCompanies[1]);try{
   if(mode==='manual'){const view=await h.read();await h.f.backend.route(h.f.endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:[{optionId:null,fieldKey:'brand',value:'다른 저장 브랜드'}]}});}
   if(mode==='bytes')h.f.backend.objects.set(h.key,h.bytes.slice(0,-1));
   if(['owner','option','category','stage'].includes(mode)){const old=button(h.p,applySelected).props.onClick,base={workspaceOwnerId:'owner',focusedOptionId:h.f.id,preferredProfileId:h.f.profile.id,tab:'추가 이미지'},patch=mode==='owner'?{workspaceOwnerId:'other'}:mode==='option'?{focusedOptionId:'other'}:mode==='category'?{preferredProfileId:'other-category'}:{tab:'대표 이미지'};h.d.render(patch);h.d.render(base);h.syncPanel();old();await image.settle();assert.equal(h.calls.filter(call=>call.method==='PUT').length,0);assert.equal(h.changed,0);continue;}
   if(mode==='dirty'){h.d.render({onBeforeFreeImageApply:()=>false});h.syncPanel();}
   const source=h.f.sourceTables(),before=await h.read();h.p.click(applySelected)();await h.p.idle();assert.equal(h.changed,0,mode);assert.equal(h.calls.filter(call=>call.method==='PUT').length,0,mode);assert.deepEqual(plain(await h.read()),plain(before));assert.equal(h.f.sourceTables(),source);
  }finally{h.close();}}
});
test('additional stage change after a committed PUT preserves only read recovery for the original exact slot',async()=>{
 const h=await completedFixture(schemaCompanies[0]);try{const pending=h.holdWrite();h.p.click(applySelected)();await pending.started.promise;h.d.render({tab:'상세 이미지'});h.syncPanel();assert.ok(button(h.p,recoverSelected));assert.equal(button(h.p,applySelected).props.disabled,true);pending.gate.resolve();await h.p.idle();assert.equal(h.changed,0);assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);
  h.p.click(recoverSelected)();await h.p.idle();assert.equal(h.changed,1,image.text(h.p.render()));assert.equal(h.calls.filter(call=>call.method==='PUT').length,1);assert.equal(button(h.p,recoverSelected),undefined);
 }finally{h.close();}
});

test('completed additional result keeps its actual AI disclosure open after image-only version advance and cannot reopen across stage, owner or review ABA',async()=>{
 for(const mode of ['stage','owner','category','option']){const h=await completedFixture(schemaCompanies[0]);try{
   assert.notEqual(h.productNow().updated_at,h.target.productVersion,'the real result attachment advances the product version');
   assert.equal(paid(h.d).processingTargetActive,false);assert.equal(paid(h.d).processingResultActive,true);assert.equal(aiDisclosure(h.d).props.open,true,'the parent keeps the completed result and its selected-slot apply control visible');
   const current={workspaceOwnerId:'owner',product:h.productNow(),tab:'추가 이미지',focusedOptionId:h.f.id,preferredProfileId:h.f.profile.id},before=await h.read(),sources=h.f.sourceTables();
   const patch=mode==='stage'?{tab:'대표 이미지'}:mode==='owner'?{workspaceOwnerId:'other'}:mode==='category'?{preferredProfileId:'other-category'}:{focusedOptionId:'other'};
   h.d.render(patch);assert.notEqual(aiDisclosure(h.d).props.open,true,mode+' leaves the original result scope');
   h.d.render(current);assert.notEqual(aiDisclosure(h.d).props.open,true,mode+' ABA cannot revive the old result disclosure');assert.equal(paid(h.d).processingResultActive,false);
   assert.equal(h.calls.filter(call=>call.method!=='GET').length,0);assert.equal(h.changed,0);assert.deepEqual(plain(await h.read()),plain(before));assert.equal(h.f.sourceTables(),sources);
  }finally{h.close();}}
});
