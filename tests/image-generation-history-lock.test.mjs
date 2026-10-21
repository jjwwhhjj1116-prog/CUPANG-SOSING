import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';

const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
// Reuse existing real component hook fixtures without registering their tests.
// Only histories/HTTP replies are synthetic; no browser, provider or DB writes.
function declarations(file,expose){
 const url=new URL('./'+file,import.meta.url),source=fs.readFileSync(url,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
 for(const statement of ast.statements){
  if(ts.isImportDeclaration(statement))continue;
  if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
  parts.push(statement.getText(ast));
 }
 return vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(url.href))+'\n({'+expose+'})',
  {assert,fs,vm,ts,createRequire,deflateSync,nodes,URL,URLSearchParams,Blob,File,FormData,Response,Request,Headers,AbortController,DOMException,TextEncoder,TextDecoder,Uint8Array,DataView,Buffer,Date,JSON,structuredClone,crypto,console,setTimeout,clearTimeout,setImmediate});
}
const image=declarations('image-generation-panel-requests.test.mjs','harness,deferred,settle,text,refresh,prepare,execute');
const detail=declarations('detail-image-edit-dialog-integration.test.mjs','dashboard');
const paid=d=>nodes(d.render()).find(node=>node.type?.name==='@/app/components/image-generation-panel:default').props;
const button=(p,label)=>nodes(p.render()).find(node=>node.type==='button'&&image.text(node)===label);
const approval='유료 요청 승인 · 아직 호출하지 않음';
const now='2026-10-21T00:00:00.000Z',old='2026-10-01T00:00:00.000Z';
function oldRunning(job){return {...job,id:'old-running',productVersion:old,status:'running',result:null,startedAt:old};}
function card(d,stage){return stage==='main'?d.child('ProductOptionsEditor').props:nodes(d.render()).find(node=>node.type?.name?.endsWith(':OptionImageEditor')&&node.props.stage===stage).props;}
const stageTab={main:'대표 이미지',additional:'추가 이미지',detail:'상세 이미지'};
const inputFor={main:'mainImage',additional:'additionalImages',detail:'detailImages'};
const source='owner/a.png';

for(const stage of ['main','additional','detail'])test(`${stage}: unconfigured provider plus historical running record does not lock actual Dashboard free translation/manual edit`,async()=>{
 const d=detail.dashboard(),pending=image.deferred(),busy=[],product={id:'p',owner_id:'owner',updated_at:now,image_keys:JSON.stringify([source])};
 let p;
 try{
  d.render({workspaceOwnerId:'owner',product,tab:stageTab[stage],focusedOptionId:'red',preferredProfileId:'profile'});
  p=image.harness(async(_url,_init,data)=>Response.json(data.view),{status:'running',initialPending:pending.promise,initialProps:{...paid(d),onBusyChange:value=>{busy.push(value);paid(d).onBusyChange(value);}}});
  p.view.configuration={configured:false,issues:['LOCAL image provider absent']};p.job.productVersion=old;p.job.startedAt=old;
  p.view.product={id:'p',version:now,imageKeys:[source]};const history=JSON.stringify(p.view.jobs);
  pending.resolve(Response.json(p.view));await p.idle();await image.settle();p.render();d.render();
  assert.equal(busy.at(-1),false);assert.equal(stage==='main'?card(d,stage).imageProcessingBusy:card(d,stage).disabled,false);
  if(stage!=='detail')assert.equal(card(d,stage).processingConfigured,false);
  assert.equal(button(p,image.prepare).props.disabled,true);assert.equal(button(p,image.refresh).props.disabled,false);assert.equal(JSON.stringify(p.view.jobs),history);
  const target={kind:'quotation',profileId:'profile',optionId:'red',input:inputFor[stage],fieldKey:inputFor[stage],slotIndex:0,revision:3,inputFingerprint:'a'.repeat(64),optionRevision:2,value:source};
  card(d,stage).onTranslate(source,stage,'zh',target);d.render();assert.equal(d.dialog().props.open,true);assert.equal(d.editor().props.active,true);assert.equal(d.editor().props.translationTarget.sourceLanguage,'zh');
  d.editor().props.onCloseGuard(()=>true);d.dialog().props.onClose();d.render();assert.equal(d.dialog().props.open,false);
  card(d,stage).onEdit(source,stage,target);d.render();assert.equal(d.dialog().props.open,true);assert.equal(d.editor().props.translationTarget.intent,'manual');
  d.editor().props.onCloseGuard(()=>true);d.dialog().props.onClose();d.render();
  p.click(image.refresh)();await p.idle();await image.settle();p.render();d.render();assert.equal(busy.at(-1),false);
  assert.equal(p.initialCalls.length,1);assert.ok(p.calls.every(call=>!call.init?.method));assert.equal(d.requests,0);assert.equal(JSON.stringify(p.view.jobs),history);
 }finally{p?.close();d.close();}
});

test('historical running jobs independently disable prepare/approve/execute and reject retained paid callbacks even with configured provider',async()=>{
 for(const [action,status] of [[image.prepare,'prepared'],[approval,'prepared'],[image.execute,'approved']]){
  const busy=[],h=image.harness(async(_url,_init,data)=>Response.json(data.view),{status,initialProps:{onBusyChange:value=>busy.push(value)}});
  try{
   await h.idle();if(action===approval){const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props.type==='checkbox');checkbox.props.onChange({target:{checked:true}});h.render();}
   const retained=button(h,action).props.onClick;assert.equal(button(h,action).props.disabled,false);
   h.view.jobs=[h.job,oldRunning(h.job)];h.click(image.refresh)();await h.idle();await image.settle();h.render();
   assert.equal(busy.at(-1),false);assert.equal(button(h,action).props.disabled,true);assert.equal(button(h,image.prepare).props.disabled,true);
   retained();button(h,action).props.onClick();await image.settle();h.render();
   assert.equal(h.calls.filter(call=>call.init?.method==='POST').length,0);assert.equal(h.view.jobs[1].status,'running');assert.equal(h.view.jobs[1].productVersion,old);
  }finally{h.close();}
 }
});

test('an actual pending prepare/approve/execute request still locks parent editing until its response settles',async()=>{
 for(const [action,status] of [[image.prepare,'prepared'],[approval,'prepared'],[image.execute,'approved']]){
  const d=detail.dashboard(),pending=image.deferred(),busy=[];let p;
  try{
   d.render({product:{id:'p',updated_at:'v',image_keys:'["owner/raw","owner/edited","owner/label"]'},tab:'상세 이미지'});
   p=image.harness(()=>pending.promise,{status,initialProps:{...paid(d),onBusyChange:value=>{busy.push(value);paid(d).onBusyChange(value);}}});
   await p.idle();await image.settle();p.render();d.render();assert.equal(busy.at(-1),false);assert.equal(d.card().props.disabled,false);
   if(action===approval){nodes(p.render()).find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:true}});p.render();}
   p.click(action)();p.render();d.render();assert.equal(busy.at(-1),true);assert.equal(d.card().props.disabled,true);assert.equal(p.calls.filter(call=>call.init?.method==='POST').length,1);
   pending.resolve(Response.json({error:'LOCAL response failure'},{status:503}));await p.idle();await image.settle();p.render();d.render();
   assert.equal(busy.at(-1),false);assert.equal(d.card().props.disabled,false);assert.equal(d.requests,0);assert.equal(p.changed,0);
  }finally{p?.close();d.close();}
 }
});
