import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {manualPanelFixture as fixture,nodes,text,plain} from './helpers/option-detail-manual-edit.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const cropCanvas=h=>nodes(h.render()).find(node=>node.type==='FreeImageCropCanvas');
const download=h=>h.field('편집 결과 PNG 다운로드');
const clickDownload=node=>{const event={prevented:false,preventDefault(){this.prevented=true;}};node.props.onClick(event);return event;};
const native=createRequire(import.meta.url);
async function prepare(h){await h.click('원본 불러오기 · 수동 편집');await h.change('이미지 잘라내기','',true);}
async function crop(h,rect={x:2,y:1,width:15,height:10}){for(const[field,value]of Object.entries(rect))await h.change('잘라내기 '+field,String(value));}
function pointerFixture(){
 const slots=[],effects=[],layouts=[],starts=[],completed=[],canceled=[],held=new Set();let cursor=0,closed=false,late=0,serial=0,rect={left:10,top:20,width:100,height:50};
 const surface={getBoundingClientRect:()=>({...rect}),setPointerCapture:id=>held.add(id),hasPointerCapture:id=>held.has(id),releasePointerCapture:id=>held.delete(id)};
 let props={sourceUrl:'blob:synthetic-source',width:200,height:100,scopeKey:'source-a',enabled:true,disabled:false,crop:null,onBegin(){const id='drag-'+ ++serial;starts.push(id);return id;},onComplete(id,value){completed.push({id,value});},onCancel(id){canceled.push(id);}};
 const effect=(queue,fn,deps)=>{const id=cursor++,old=slots[id];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps};slots[id]=next;queue.push(()=>{old?.cleanup?.();next.cleanup=fn();});}};
 const hooks={useState(initial){const id=cursor++;if(!(id in slots))slots[id]=typeof initial==='function'?initial():initial;return[slots[id],value=>{if(closed){late++;return;}slots[id]=typeof value==='function'?value(slots[id]):value;}];},useRef(initial){const id=cursor++;return slots[id]??(slots[id]={current:initial});},useEffect:(fn,deps)=>effect(effects,fn,deps),useLayoutEffect:(fn,deps)=>effect(layouts,fn,deps)};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/free-image-crop-canvas.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return native(name);throw Error(name);}});
 const render=()=>{cursor=0;const tree=exports.FreeImageCropCanvas(props);layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;};
 const svg=()=>nodes(render()).find(node=>node.type==='svg'),event=(x=20,y=30,patch={})=>({currentTarget:surface,clientX:x,clientY:y,pointerId:1,button:0,buttons:1,pointerType:'mouse',isPrimary:true,preventDefault(){},...patch});
 const settle=async()=>{for(let i=0;i<4;i++){render();await new Promise(resolve=>setImmediate(resolve));}};render();
 return{render,svg,event,settle,starts,completed,canceled,held,get late(){return late;},async send(name,x,y,patch){svg().props[name](event(x,y,patch));await settle();},async props(patch){props={...props,...patch};await settle();},move(patch){rect={...rect,...patch};},close(){if(closed)return;closed=true;slots.forEach(slot=>slot?.cleanup?.());}};
}

test('crop-only editing keeps the original source and enables only a reviewed local PNG download before any write',async()=>{
 const h=fixture();try{
  await prepare(h);assert.equal(h.render().props['data-workspace-dirty'],undefined);assert.equal(cropCanvas(h).props.enabled,true);
  assert.deepEqual(['x','y','width','height'].map(field=>h.field('잘라내기 '+field).props.value),[0,0,20,12]);
  await crop(h);assert.equal(h.render().props['data-workspace-dirty'],'true');assert.deepEqual(plain(h.calls.map(call=>call.action)),['source']);assert.equal(download(h),undefined);
  await h.click('번역 이미지 미리보기');const preview=h.calls.at(-1);assert.equal(preview.action,'preview');assert.deepEqual(plain(preview.crop),{x:2,y:1,width:15,height:10});assert.deepEqual(plain(preview.rows),[]);
  assert.equal(preview.image.source.width,20);assert.equal(preview.image.source.height,12);const link=download(h);assert.ok(link);assert.equal(clickDownload(link).prevented,false);assert.ok(link.props.download.endsWith('.png'));assert.match(link.props.href,/^blob:/);
  assert.deepEqual(plain(h.calls.map(call=>call.action)),['source','preview']);assert.equal(h.saved,0);
  const url=h.urls.find(item=>item.url===link.props.href);assert.ok(url);assert.equal(url.blob.type,'image/png');
 }finally{h.close();}
});

test('same-tick crop edits invalidate retained preview/apply/download controls; invalid bounds stay dirty and reset remains explicit',async()=>{
 const h=fixture();try{
  await prepare(h);await crop(h);await h.click('번역 이미지 미리보기');const link=download(h),apply=h.button('검토한 번역 이미지 적용').props.onClick,preview=h.button('번역 이미지 미리보기').props.onClick;
  h.field('잘라내기 width').props.onChange({target:{value:'21',valueAsNumber:21}});preview();apply();assert.equal(clickDownload(link).prevented,true);await h.settle();
  assert.equal(h.field('잘라내기 width').props.value,21);assert.equal(h.render().props['data-workspace-dirty'],'true');assert.equal(download(h),undefined);assert.equal(h.calls.filter(call=>call.action==='apply').length,0);assert.equal(h.calls.filter(call=>call.action==='preview').length,1);
  const button=h.button('번역 이미지 미리보기');assert.ok(button.props.disabled||text(h.render()).includes('정수 픽셀'));
  await h.click('잘라내기 초기화');assert.deepEqual(['x','y','width','height'].map(field=>h.field('잘라내기 '+field).props.value),[0,0,20,12]);assert.equal(h.render().props['data-workspace-dirty'],undefined);
  await crop(h,{x:0,y:0,width:10,height:12});await h.change('이미지 잘라내기','',false);assert.equal(h.render().props['data-workspace-dirty'],'true');assert.equal(cropCanvas(h),undefined);assert.equal(h.saved,0);
  await h.change('이미지 잘라내기','',true);assert.equal(h.field('잘라내기 width').props.value,10);await h.click('잘라내기 초기화');assert.equal(h.render().props['data-workspace-dirty'],undefined);
 }finally{h.close();}
});

test('crop gestures use original pixels, block processing while drawing, and late cancel/version/slot/close callbacks cannot change the draft',async()=>{
 for(const mode of ['complete','cancel','version','slot','close']){
  const h=fixture();try{
   await prepare(h);const canvas=cropCanvas(h).props,id=canvas.onBegin();assert.ok(id);h.render();assert.equal(h.render().props['data-workspace-saving'],'true');assert.equal(h.button('번역 이미지 미리보기').props.disabled,true);
   if(mode==='cancel')canvas.onCancel(id);
   if(mode==='version')h.setProps({version:'2026-10-06T00:00:02.000Z'});
   if(mode==='slot')h.setProps({quotationContext:{profileId:null,optionId:'another',input:'detailImages'}});
   if(mode==='close')h.close();
   canvas.onComplete(id,{x:1,y:2,width:12,height:8});await h.settle();
   assert.equal(h.calls.filter(call=>call.action==='preview'||call.action==='apply'||call.action==='ocr'||call.action==='translate').length,0);
   if(mode==='complete'){assert.equal(h.field('잘라내기 x').props.value,1);assert.equal(h.render().props['data-workspace-dirty'],'true');}
   else{assert.equal(h.field('잘라내기 x').props.value,0);if(mode!=='close')assert.notEqual(h.render().props['data-workspace-dirty'],'true');}
   assert.equal(h.late,0);
  }finally{h.close();}
 }
});

test('crop drafts survive same-source refresh and source/language attempts while changed bytes cannot rebind them',async()=>{
 const h=fixture();try{
  await prepare(h);await crop(h);await h.click('문구 영역 직접 추가');await h.change('문구 1 한국어','직접 보존한 문구');
  h.setProps({translationTarget:{sourceKey:'owner/second.png',sequence:2,role:'detail',intent:'manual'}});await h.settle();assert.equal(h.field('번역할 원본 이미지').props.value,'owner/original.png');assert.equal(h.field('잘라내기 x').props.value,2);
  h.setProps({version:'2026-10-06T00:00:02.000Z'});await h.settle();await h.click('원본 저장 상태 다시 확인');assert.equal(h.field('잘라내기 width').props.value,15);assert.equal(h.field('문구 1 한국어').props.value,'직접 보존한 문구');
  h.setSource(image=>({...image,source:{...image.source,sourceSha256:'b'.repeat(64)}}));await h.click('원본 저장 상태 다시 확인');assert.match(text(h.render()),/파일|변경/);assert.equal(h.field('잘라내기 x').props.value,2);assert.equal(h.field('문구 1 한국어').props.value,'직접 보존한 문구');
  assert.equal(h.calls.filter(call=>call.action==='preview'||call.action==='apply'||call.action==='ocr'||call.action==='translate').length,0);
 }finally{h.close();}
});

test('busy cropped saves freeze crop controls and download until the original reviewed PNG is acknowledged',async()=>{
 const h=fixture(),wait=deferred();try{
  await prepare(h);await crop(h);await h.click('번역 이미지 미리보기');const staleCrop=h.field('잘라내기 x').props.onChange,reset=h.button('잘라내기 초기화').props.onClick,link=download(h);
  h.setApply((_image,signal)=>{assert.equal(signal.aborted,false);return wait.promise;});h.button('검토한 번역 이미지 적용').props.onClick();await h.settle();assert.equal(h.field('잘라내기 x').props.disabled,true);staleCrop({target:{value:'0'}});reset();assert.equal(clickDownload(link).prevented,true);
  wait.resolve({applied:true});await h.settle();assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],undefined);
 }finally{h.close();}
});

test('unknown final-slot crop saves recover the identical source/rectangle/PNG through version changes and ready-retry locks',async()=>{
 class UnknownCropSave extends Error{constructor(message){super(message);this.uncertain=true;}}
 const target={kind:'quotation',profileId:null,optionId:'red',input:'detailImages',fieldKey:'detailImages',slotIndex:0,revision:1,inputFingerprint:'c'.repeat(64),optionRevision:1,value:'owner/original.png'};
 const h=fixture({quotationContext:{profileId:null,optionId:'red',input:'detailImages'},translationTarget:{sourceKey:'owner/original.png',sequence:1,role:'detail',quotationTarget:target}},{FreeImageApplyError:UnknownCropSave});
 try{
  await prepare(h);await crop(h);await h.click('번역 이미지 미리보기');const cropChange=h.field('잘라내기 x').props.onChange,link=download(h);
  h.setApply(async()=>{throw new UnknownCropSave('synthetic crop ACK lost');});await h.click('검토한 번역 이미지 적용');assert.equal(h.saved,0);assert.ok(h.button('같은 결과의 저장 상태 다시 확인'));const sent=h.calls.find(call=>call.action==='apply').image;
  cropChange({target:{value:'0'}});assert.equal(clickDownload(link).prevented,true);assert.equal(h.field('잘라내기 x').props.value,2);
  h.setProps({version:'2026-10-06T00:00:02.000Z'});await h.settle();h.setRecover(async image=>{assert.equal(image,sent);return{applied:false};});await h.click('같은 결과의 저장 상태 다시 확인');assert.ok(h.button('같은 미리보기 다시 적용'));assert.equal(h.field('잘라내기 x').props.disabled,true);
  cropChange({target:{value:'0'}});assert.equal(h.field('잘라내기 x').props.value,2);h.setApply(async image=>{assert.equal(image,sent);return{applied:true};});await h.click('같은 미리보기 다시 적용');assert.equal(h.saved,1);
  assert.deepEqual(plain(h.calls.filter(call=>call.action==='apply').map(call=>({width:call.image.width,height:call.image.height,crop:call.image.crop}))),[{width:15,height:10,crop:{x:2,y:1,width:15,height:10,sourceWidth:20,sourceHeight:12}},{width:15,height:10,crop:{x:2,y:1,width:15,height:10,sourceWidth:20,sourceHeight:12}}]);
  assert.deepEqual(plain(h.calls.map(call=>call.action)),['source','preview','apply','recover','apply']);assert.equal(h.render().props['data-workspace-dirty'],undefined);
 }finally{h.close();}
});

test('a superseded crop preview, changed final scope or unmounted download callback cannot publish or save an old result',async()=>{
 for(const mode of ['version','scope','close']){
  const h=fixture(),wait=deferred();try{
   await prepare(h);await crop(h);await h.click('번역 이미지 미리보기');const link=download(h);h.setRender((image,_rows,signal)=>{assert.equal(signal.aborted,false);return wait.promise;});h.button('번역 이미지 미리보기').props.onClick();await h.settle();
   if(mode==='version')h.setProps({version:'2026-10-06T00:00:02.000Z'});if(mode==='scope')h.setProps({quotationContext:{profileId:null,optionId:'different',input:'mainImage'}});if(mode==='close')h.close();
   const previous=h.calls.filter(call=>call.action==='preview').at(-1).image;wait.resolve({source:previous.source,output:new Blob(['stale PNG'],{type:'image/png'}),width:15,height:10,crop:{x:2,y:1,width:15,height:10,sourceWidth:20,sourceHeight:12}});await h.settle();
   assert.equal(clickDownload(link).prevented,true);assert.equal(h.calls.filter(call=>call.action==='apply').length,0);assert.equal(h.saved,0);assert.equal(h.late,0);
  }finally{h.close();}
 }
});

test('the actual crop SVG maps scaled/reversed pointer rectangles to original pixels and clamps image edges without resizing',async()=>{
 const h=pointerFixture();try{
  assert.equal(h.svg().props['data-testid'],'free-image-crop-surface');assert.equal(h.svg().props.viewBox,'0 0 200 100');
  await h.send('onPointerDown',50,45);await h.send('onPointerUp',20,30);assert.deepEqual(plain(h.completed[0].value),{x:20,y:20,width:61,height:31});assert.equal(h.held.size,0);
  await h.send('onPointerDown',0,0);await h.send('onPointerMove',-100,-100);await h.send('onPointerUp',500,500);assert.deepEqual(plain(h.completed[1].value),{x:0,y:0,width:200,height:100});assert.equal(h.canceled.length,0);
 }finally{h.close();}
});

test('the actual crop SVG cancels changed scope/source/geometry/capture and ignores old pointer handlers without late commits',async()=>{
 for(const mode of ['scope','source','size','disabled','geometry','cancel','lost','close']){
  const h=pointerFixture();try{
   const old=h.svg().props;await h.send('onPointerDown');if(mode==='scope')await h.props({scopeKey:'different'});if(mode==='source')await h.props({sourceUrl:'blob:different'});
   if(mode==='size')await h.props({width:201});if(mode==='disabled')await h.props({disabled:true});if(mode==='geometry'){h.move({top:25});await h.send('onPointerMove',40,40);}
   if(mode==='cancel')await h.send('onPointerCancel');if(mode==='lost')await h.send('onLostPointerCapture');if(mode==='close')h.close();
   old.onPointerMove(h.event(70,40));old.onPointerUp(h.event(70,40));await h.settle();assert.equal(h.completed.length,0,mode);assert.deepEqual(h.canceled,['drag-1'],mode);assert.equal(h.held.size,0);assert.equal(h.late,0);
  }finally{h.close();}
 }
});
