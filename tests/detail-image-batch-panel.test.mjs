import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const settle=async()=>{for(let index=0;index<14;index++)await new Promise(resolve=>setImmediate(resolve));};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function ui({active=true,permission=true,failed=false,uncertain=false,heldPrepare,heldRead,stage='detail',poolSize=3}={}){
 const slots=[],effects=[],layouts=[],calls=[],busy=[];let cursor=0,closed=false,saved=0,late=0,allow=permission;
 const keys=['owner/a.png','owner/b.png','owner/c.png'],imageKeys=[...keys];while(imageKeys.length<poolSize)imageKeys.push(`owner/source-${imageKeys.length}.png`);
 const view={productVersion:'2026-10-13T00:00:00.000Z',revision:2,imageKeys};
 let props={productId:'product',optionId:'red',profileId:'cat',stage,version:view.productVersion,active,beforeApply:()=>allow,onSaved(){saved++;props={...props,version:view.productVersion};},onBusyChange(value){busy.push(value);}};
 const enqueue=(queue,fn,deps)=>{const slot=cursor++,old=slots[slot];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:null};slots[slot]=next;queue.push(()=>{old?.cleanup?.();next.cleanup=fn();});}};
 const react={useState(initial){const slot=cursor++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],value=>{if(closed){late++;return;}slots[slot]=typeof value==='function'?value(slots[slot]):value;}];},useRef(initial){const slot=cursor++;return slots[slot]??(slots[slot]={current:initial});},useEffect(fn,deps){enqueue(effects,fn,deps);},useLayoutEffect(fn,deps){enqueue(layouts,fn,deps);}};
 const helpers={detailBatchSelection:()=>({keys}),detailBatchCapacity:value=>150-value.imageKeys.length,readDetailBatchView:async()=>{calls.push(['read']);await heldRead?.promise;return{...view};},prepareDetailImageBatch:async(input,signal,progress)=>{
  calls.push(['prepare',input.language,input.stage]);const value={...input,items:keys.map((sourceKey,slotIndex)=>({sourceKey,slotIndex,status:failed&&slotIndex===1?'failed':'ready',message:failed&&slotIndex===1?'읽을 수 있는 문구가 없습니다.':'',texts:[{original:'中文',translated:'한국어'}],rendered:failed&&slotIndex===1?undefined:{output:new Blob(['preview'],{type:'image/png'})}}))};
  progress(value,'준비 중');await heldPrepare?.promise;signal.throwIfAborted();return value;
 },applyDetailBatchResult:async(batch,index,signal,progress)=>{
  calls.push(['apply',index]);signal.throwIfAborted();if(uncertain){const value={...batch,items:batch.items.map(item=>item.slotIndex===index?{...item,status:'uncertain'}:item)};progress(value);throw Error('응답 유실');}
  view.productVersion=new Date(Date.parse(view.productVersion)+1).toISOString();view.revision++;view.imageKeys=[...view.imageKeys,`owner/result-${index}.png`];
  const value={...batch,view:{...view},items:batch.items.map(item=>item.slotIndex===index?{...item,status:'applied',message:'적용 완료'}:item)};progress(value);return value;
 },recoverDetailBatchResult:async batch=>{calls.push(['recover']);view.productVersion=new Date(Date.parse(view.productVersion)+1).toISOString();view.revision++;
  return{...batch,view:{...view},items:batch.items.map(item=>item.status==='uncertain'?{...item,status:'applied'}:item)};}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/detail-image-batch-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,AbortController,Blob,URL,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='@/app/detail-image-batch')return helpers;throw Error(name);}});
 function render(){cursor=0;const tree=exports.DetailImageBatchPanel(props);layouts.splice(0).forEach(fn=>fn());effects.splice(0).forEach(fn=>fn());return tree;}
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label),control=label=>nodes(render()).find(node=>node.props?.['aria-label']===label);
 return{render,calls,busy,button,control,get saved(){return saved;},get late(){return late;},update(value){props={...props,...value};return render();},permission(value){allow=value;},fail(value){uncertain=value;},async start(){render();await settle();render();},async click(label){const node=button(label);assert.ok(node&&!node.props.disabled,label+' '+text(render()));node.props.onClick();await settle();render();},review(index){const node=control(`${props.stage==='additional'?'추가':'상세'} 이미지 ${index+1} 번역 결과 검토 완료`);assert.ok(node&&!node.props.disabled);node.props.onChange({target:{checked:true}});render();},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());}};
}
test('stage-five bulk translation has a positive review-before-save flow, preserves unchecked results, and does not read while inactive',async()=>{
 const h=ui({active:false});try{await h.start();assert.equal(h.calls.length,0);h.update({active:true});await settle();h.render();
  await h.click('모든 상세 이미지 번역 준비');assert.equal(h.calls.filter(row=>row[0]==='prepare').length,1);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);
  assert.equal(h.button('검토한 상세 이미지 0개 적용').props.disabled,true);h.review(0);h.review(2);await h.click('검토한 상세 이미지 2개 적용');
  assert.deepEqual(h.calls.filter(row=>row[0]==='apply'),[['apply',0],['apply',2]]);assert.equal(h.saved,1);assert.ok(h.control('상세 이미지 2 번역 결과 검토 완료'));assert.equal(h.render().props['data-workspace-dirty'],true);
  await h.click('미적용 번역 결과 지우기 · 원본 유지');assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.calls.filter(row=>row[0]==='apply').length,2);assert.match(text(h.render()),/이미 저장한 결과와 나머지 원본은 유지/);
 }finally{h.close();}
});
test('unsaved other-editor inputs block both batch preparation and a retained apply callback',async()=>{
 const h=ui({permission:false});try{await h.start();h.button('모든 상세 이미지 번역 준비').props.onClick();await settle();assert.equal(h.calls.filter(row=>row[0]==='prepare').length,0);
  h.permission(true);await h.click('모든 상세 이미지 번역 준비');h.review(0);const retained=h.button('검토한 상세 이미지 1개 적용');h.permission(false);retained.props.onClick();await settle();assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);assert.match(text(h.render()),/먼저 저장/);
 }finally{h.close();}
});
test('unreadable images remain visible without a review checkbox while successful previews remain usable',async()=>{
 const h=ui({failed:true});try{await h.start();await h.click('모든 상세 이미지 번역 준비');assert.ok(h.control('일괄 상세 이미지 2'));assert.equal(h.control('상세 이미지 2 번역 결과 검토 완료'),undefined);assert.match(text(h.render()),/읽을 수 있는 문구/);
  h.review(0);await h.click('검토한 상세 이미지 1개 적용');assert.deepEqual(h.calls.filter(row=>row[0]==='apply'),[['apply',0]]);
 }finally{h.close();}
});
test('first uncertain save stops the queue; recovery reads only that result and requires a fresh explicit next selection',async()=>{
 const h=ui({uncertain:true});try{await h.start();await h.click('모든 상세 이미지 번역 준비');h.review(0);h.review(1);await h.click('검토한 상세 이미지 2개 적용');
  assert.deepEqual(h.calls.filter(row=>row[0]==='apply'),[['apply',0]]);assert.ok(h.button('같은 이미지 저장 상태 확인'));await h.click('같은 이미지 저장 상태 확인');assert.equal(h.calls.filter(row=>row[0]==='recover').length,1);assert.equal(h.calls.filter(row=>row[0]==='apply').length,1);
  assert.equal(h.button('검토한 상세 이미지 0개 적용').props.disabled,true);h.fail(false);h.review(1);await h.click('검토한 상세 이미지 1개 적용');assert.deepEqual(h.calls.filter(row=>row[0]==='apply'),[['apply',0],['apply',1]]);
 }finally{h.close();}
});
test('source changes keep previews but disable their stale selection and application',async()=>{
 const h=ui();try{await h.start();await h.click('모든 상세 이미지 번역 준비');h.review(0);h.update({version:'2026-10-13T00:00:01.000Z'});assert.equal(h.control('상세 이미지 1 번역 결과 검토 완료').props.disabled,true);assert.equal(h.button('검토한 상세 이미지 1개 적용').props.disabled,true);assert.match(text(h.render()),/준비한 결과는 유지/);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);
 }finally{h.close();}
});
test('a newly opened stage waits for the other image editor and loads after its processing lock is released',async()=>{
 const h=ui({active:false});try{h.update({active:true,disabled:true});await settle();assert.equal(h.calls.length,0);h.update({disabled:false});await settle();assert.equal(h.calls.filter(row=>row[0]==='read').length,1);
  const language=h.control('일괄 상세 이미지 원문 언어');language.props.onChange({target:{value:'en'}});await h.click('모든 상세 이미지 번역 준비');assert.deepEqual(h.calls.find(row=>row[0]==='prepare'),['prepare','en','detail']);
 }finally{h.close();}
});
test('cancelling preparation and closing the view stop late UI adoption without writes',async()=>{
 const held=deferred(),h=ui({heldPrepare:held});try{await h.start();h.button('모든 상세 이미지 번역 준비').props.onClick();await settle();assert.ok(h.button('일괄 이미지 작업 중단'));h.button('일괄 이미지 작업 중단').props.onClick();h.close();held.resolve();await settle();assert.equal(h.late,0);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);assert.equal(h.busy.at(-1),false);
 }finally{h.close();}
});
test('stage four exposes the observed bulk action and reviews/applies only selected additional results above fifty files',async()=>{
 const h=ui({stage:'additional',poolSize:49});try{await h.start();assert.equal(h.render().props['data-quotation-source-step'],'추가 이미지');assert.match(text(h.render()),/새 번역 이미지 저장 가능 101장/);
  await h.click('모든 이미지 일괄 처리');assert.deepEqual(h.calls.find(row=>row[0]==='prepare'),['prepare','zh','additional']);assert.equal(h.calls.filter(row=>row[0]==='apply').length,0);
  h.review(0);h.review(2);await h.click('검토한 추가 이미지 2개 적용');assert.deepEqual(h.calls.filter(row=>row[0]==='apply'),[['apply',0],['apply',2]]);assert.equal(h.saved,1);assert.match(text(h.render()),/새 번역 이미지 저장 가능 99장/);
  assert.ok(h.control('추가 이미지 2 번역 결과 검토 완료'));await h.click('미적용 번역 결과 지우기 · 원본 유지');assert.equal(h.render().props['data-workspace-dirty'],false);
 }finally{h.close();}
});
test('remaining capacity limits review selection and stops uploads at the full pool while retaining original previews',async()=>{
 const h=ui({stage:'additional',poolSize:149});try{await h.start();await h.click('모든 이미지 일괄 처리');h.review(0);assert.equal(h.control('추가 이미지 2 번역 결과 검토 완료').props.disabled,true);
  h.control('추가 이미지 2 번역 결과 검토 완료').props.onChange({target:{checked:true}});assert.ok(h.button('검토한 추가 이미지 1개 적용'));await h.click('검토한 추가 이미지 1개 적용');
  assert.match(text(h.render()),/새 번역 이미지 저장 가능 0장/);assert.equal(h.button('현재 추가 목록으로 번역 다시 준비').props.disabled,true);assert.equal(h.control('추가 이미지 2 번역 결과 검토 완료').props.disabled,true);assert.equal(h.calls.filter(row=>row[0]==='apply').length,1);
 }finally{h.close();}
});
test('additional-image uncertain save uses read-only recovery and never advances to the next checked image',async()=>{
 const h=ui({stage:'additional',uncertain:true});try{await h.start();await h.click('모든 이미지 일괄 처리');h.review(0);h.review(1);await h.click('검토한 추가 이미지 2개 적용');assert.deepEqual(h.calls.filter(row=>row[0]==='apply'),[['apply',0]]);
  await h.click('같은 이미지 저장 상태 확인');assert.equal(h.calls.filter(row=>row[0]==='recover').length,1);assert.equal(h.calls.filter(row=>row[0]==='apply').length,1);assert.equal(h.button('검토한 추가 이미지 0개 적용').props.disabled,true);
 }finally{h.close();}
});
