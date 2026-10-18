import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {createHash} from 'node:crypto';
const plain=value=>JSON.parse(JSON.stringify(value)),nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[],text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const version='2026-10-07T00:00:00.000Z';
const resultImage=tree=>nodes(tree).find(node=>node.type==='img'&&node.props['data-saved-label-result']!==undefined);
const thumbnailImages=tree=>nodes(tree).filter(node=>node.type==='img'&&node.props['data-saved-label-result']===undefined);
const editingProofs=[];
class SaveError extends Error{constructor(message,uncertain){super(message);this.uncertain=uncertain;}}
function fixture(){
 const calls=[],writes=[],keys=['owner/old.png','owner/new.png','owner/manual.png'];let value={view:{productVersion:version,imageKeys:keys},quotation:{revision:0,productVersion:version,inputFingerprint:'a'.repeat(64),optionRevision:2,imageKeys:keys,resolved:{schema:{fields:[{id:'labelImages',type:'images'}]},rows:[{optionId:'red',fields:{labelImages:{value:[keys[0],keys[2]].join('\n')}}}]}},keys:[keys[0],keys[2]]},lose=false,unavailable=false;
 const read=()=>plain(value),helpers={ProductLabelReferenceSaveError:SaveError,
  async readProductLabelReferences(input,request){const response=await request(input.quotationEndpoint,{cache:'no-store'});if(!response.ok)throw Error('private read unavailable');return response.json();},
  verifyProductLabelReferenceSave(input,before,latest,selected){if(latest.quotation.revision!==before.quotation.revision+1||JSON.stringify(latest.keys)!==JSON.stringify(selected))throw Error('save not confirmed');},
  verifyProductLabelReferenceRefresh(input,before,latest){if(JSON.stringify(before.keys)!==JSON.stringify(latest.keys))throw Error('라벨에 다른 변경이 있습니다.');},
  async saveProductLabelReferences(input,before,selected,request){const current=await(await request(input.quotationEndpoint,{cache:'no-store'})).json();if(current.quotation.revision!==before.quotation.revision){helpers.verifyProductLabelReferenceSave(input,before,current,selected);return current;}const response=await request(input.quotationEndpoint,{method:'PUT',body:JSON.stringify({keys:selected})});return response.json();},
 };
 const request=async(url,init={})=>{calls.push({url,init});if(unavailable&&init.method!=='PUT')return Response.json({error:'read failed'},{status:503});if(init.method==='PUT'){writes.push(JSON.parse(init.body).keys);value={...value,view:{...value.view,productVersion:new Date(Date.parse(value.view.productVersion)+1).toISOString()},quotation:{revision:value.quotation.revision+1},keys:JSON.parse(init.body).keys};if(lose){lose=false;unavailable=true;throw new SaveError('전송 응답 확인 필요',true);}}return Response.json(value);};
 return {calls,writes,helpers,request,read,get value(){return value;},touch(){value={...value,view:{...value.view,productVersion:new Date(Date.parse(value.view.productVersion)+1).toISOString()}};return value.view.productVersion;},lost(){lose=true;},recover(){unavailable=false;},blank(){value.keys=[];}};
}
function editor(f,initial={}){
 let index=0,slots=[],pending=[],tree,closed=false,lateWrites=0;const props={productId:'product',optionId:'red',version,...initial},saved=[];
 const effect=(fn,deps,kind)=>{const slot=index++,old=slots[slot],changed=!old||!deps||deps.some((value,i)=>value!==old.deps?.[i]);if(changed)pending.push({slot,old,deps,kind,fn});};
 const react={useState(initial){const slot=index++;if(!(slot in slots))slots[slot]={value:typeof initial==='function'?initial():initial};return[slots[slot].value,next=>{if(closed){lateWrites++;return;}slots[slot].value=typeof next==='function'?next(slots[slot].value):next;}];},useRef(initial){const slot=index++;if(!(slot in slots))slots[slot]={current:initial};return slots[slot];},useEffect:(fn,deps)=>effect(fn,deps,'passive'),useLayoutEffect:(fn,deps)=>effect(fn,deps,'layout')};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,AbortController,TextEncoder,fetch:f.request,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='@/app/product-label-references')return f.helpers;if(name==='@/app/document-image-render'||name==='@/app/product-label-attachment')return{};if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});return exports;}
 const Component=load('app/components/product-label-editor.tsx').ProductLabelReferenceEditor;
 const render=()=>{index=0;tree=Component({...props,onSaved:()=>saved.push(1)});const effects=pending;pending=[];for(const kind of ['layout','passive']){const phase=effects.filter(effect=>effect.kind===kind);phase.forEach(effect=>effect.old?.cleanup?.());phase.forEach(effect=>{slots[effect.slot]={deps:effect.deps,kind,cleanup:effect.fn()};});}return tree;};
 const idle=async(allowBusy=false)=>{const deadline=Date.now()+10000;for(let i=0;i<16||!allowBusy&&render().props['data-workspace-saving'];i++){assert.ok(Date.now()<deadline,'label reference read did not settle');render();await new Promise(resolve=>setImmediate(resolve));}return render();};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));
 render();return {render,idle,button,saved,layoutCleanups(){return slots.filter(slot=>slot?.kind==='layout'&&typeof slot.cleanup==='function').map(slot=>slot.cleanup);},async click(label){const node=button(label);assert.ok(node,label);assert.equal(node.props.disabled,false,label+' should be enabled');node.props.onClick();await idle();},select(key){const node=nodes(render()).find(node=>node.type==='select');node.props.onChange({target:{value:key}});render();},source(value){props.version=value;render();},option(value){props.optionId=value;render();},patch(value){Object.assign(props,value);render();},close(){closed=true;for(const slot of slots)slot?.cleanup?.();},get lateWrites(){return lateWrites;}};
}

test('reference edits report synchronously and unlock only after explicit cancel or save without disabling their own controls',async()=>{
 const f=fixture(),reports=[],h=editor(f,{onEditingChange:value=>reports.push(value)});try{
  await h.idle();assert.equal(reports.at(-1),false);const frozen=plain(f.read()),remove=h.button('최종 라벨 1 견적에서 제외').props.onClick;
  remove();assert.equal(reports.at(-1),true,'parent guard updates before a following captured callback can run');assert.equal(f.writes.length,0);assert.deepEqual(f.read(),frozen);await h.idle();assert.equal(h.button('최종 라벨 연결 저장').props.disabled,false);assert.equal(h.button('선택 취소·저장 라벨 조회').props.disabled,false);
  await h.click('선택 취소·저장 라벨 조회');assert.equal(reports.at(-1),false);assert.equal(f.writes.length,0);h.select('owner/new.png');assert.equal(reports.at(-1),false,'replacement picker alone is not a staged change');h.button('선택 파일로 최종 라벨 전체 교체').props.onClick();assert.equal(reports.at(-1),true);await h.idle();await h.click('최종 라벨 연결 저장');assert.equal(reports.at(-1),false);assert.deepEqual(f.writes,[['owner/new.png']]);
  editingProofs.push({kind:'synchronous-edit-cancel-save',reports:[...reports],writes:1,selfDisabled:false});
 }finally{h.close();}
});

test('uncertain committed reference saves remain unsettled until read-only recovery confirms their exact result',async()=>{
 const f=fixture(),reports=[],busy=[],h=editor(f,{onEditingChange:value=>reports.push(value),onBusyChange:value=>busy.push(value)});try{
  await h.idle();h.select('owner/new.png');await h.click('선택 파일로 최종 라벨 전체 교체');f.lost();await h.click('최종 라벨 연결 저장');assert.equal(reports.at(-1),true);assert.equal(busy.at(-1),false);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.button('라벨 연결 저장 결과 확인·재시도').props.disabled,false);assert.equal(f.writes.length,1);
  f.recover();await h.click('라벨 연결 저장 결과 확인·재시도');assert.equal(reports.at(-1),false);assert.equal(f.writes.length,1);assert.equal(h.saved.length,1);
  editingProofs.push({kind:'uncertain-save-recovery',writes:1,recoveryWrites:0,unsettledWhileIdle:true,recovered:false===reports.at(-1)});
 }finally{h.close();}
});

test('same-scope source refresh retains the report and old cleanup cannot clear a new dirty scope',async()=>{
 for(const changed of [{productId:'other-product'},{optionId:'blue'},{profileId:'another-profile'}]){
  const f=fixture(),reports=[],h=editor(f,{onEditingChange:value=>reports.push(value)});try{
   await h.idle();await h.click('최종 라벨 1 견적에서 제외');const beforeSourceCleanup=h.layoutCleanups().at(-1);h.source(f.touch());await h.idle();assert.equal(reports.at(-1),true);assert.equal(h.render().props['data-workspace-dirty'],true);const retainedReports=reports.length;beforeSourceCleanup();assert.equal(reports.length,retainedReports);assert.equal(reports.at(-1),true);
   const previousCleanup=h.layoutCleanups().at(-1);h.patch(changed);await h.idle();assert.equal(reports.at(-1),false);assert.equal(h.render().props['data-workspace-dirty'],false);await h.click('최종 라벨 1 견적에서 제외');assert.equal(reports.at(-1),true);const count=reports.length;previousCleanup();assert.equal(reports.length,count);assert.equal(reports.at(-1),true);assert.equal(f.writes.length,0);
   editingProofs.push({kind:'scope-and-source-cleanup',scopeChange:changed,sameScopeDraftRetained:true,oldCleanupIgnored:true,writes:0});
  }finally{h.close();}
 }
});

test('uncertainty belongs to its option scope and live callback replacement receives current dirty state and final cleanup',async()=>{
 const f=fixture(),first=[],second=[],h=editor(f,{onEditingChange:value=>first.push(value)});try{
  await h.idle();h.select('owner/new.png');await h.click('선택 파일로 최종 라벨 전체 교체');f.lost();await h.click('최종 라벨 연결 저장');assert.equal(first.at(-1),true);f.recover();h.patch({optionId:'blue',version:f.value.view.productVersion});await h.idle();assert.equal(first.at(-1),false);assert.equal(h.button('최종 라벨 전체 비우기').props.disabled,false,'old option uncertainty must not lock the new scope');await h.click('최종 라벨 1 견적에서 제외');assert.equal(first.at(-1),true);
  h.patch({onEditingChange:value=>second.push(value)});await h.idle();assert.equal(second.at(-1),true);const staleCleanup=h.layoutCleanups().at(-1),firstCount=first.length;h.close();assert.equal(second.at(-1),false);assert.equal(first.length,firstCount);const secondCount=second.length;staleCleanup();assert.equal(second.length,secondCount);assert.equal(h.lateWrites,0);
  editingProofs.push({kind:'uncertainty-scope-live-observer',oldUncertaintyCleared:true,newObserverCurrent:true,cleanupFalse:true,writes:1});
 }finally{if(second.at(-1)!==false)h.close();}
});

test('captured child edit/save callbacks respect current parent lock while cancel and saved-reference reads remain available',async()=>{
 const f=fixture(),reports=[],h=editor(f,{onEditingChange:value=>reports.push(value)});try{
  await h.idle();const remove=h.button('최종 라벨 1 견적에서 제외').props.onClick;h.patch({disabled:true});remove();await h.idle();assert.equal(reports.at(-1),false);assert.equal(h.render().props['data-workspace-dirty'],false);h.patch({disabled:false});await h.click('최종 라벨 1 견적에서 제외');const save=h.button('최종 라벨 연결 저장').props.onClick;h.patch({disabled:true});save();await h.idle();assert.equal(f.writes.length,0);assert.equal(reports.at(-1),true);await h.click('선택 취소·저장 라벨 조회');assert.equal(reports.at(-1),false);assert.equal(f.writes.length,0);
  editingProofs.push({kind:'parent-live-lock',staleEditBlocked:true,staleSaveBlocked:true,readAndCancelAllowed:true,writes:0});
 }finally{h.close();}
});

test('same-scope source refresh explicitly clears current parent busy while an aborted dirty read or save retains its choices',async()=>{
 for(const method of ['GET','PUT']){
  const f=fixture(),original=f.request,reports=[],accepted=[],rejected=[];let parentClock=0,parentBusy=false,hold=false,release;
  const observer=clock=>value=>{if(parentClock!==clock){rejected.push({clock,value});return;}parentBusy=value;accepted.push({clock,value});};
  f.request=async(url,init={})=>{const result=original(url,init);if(hold&&(init.method??'GET')===method){hold=false;await new Promise(resolve=>{release=resolve;});}return result;};
  const h=editor(f,{onBusyChange:observer(0),onEditingChange:value=>reports.push(value)});try{
   await h.idle();await h.click('최종 라벨 1 견적에서 제외');hold=true;h.button(method==='GET'?'선택 유지·최신 라벨 조회':'최종 라벨 연결 저장').props.onClick();await h.idle(true);assert.equal(typeof release,'function');assert.equal(parentBusy,true);const readsBeforeRefresh=f.calls.length,writesBeforeRefresh=f.writes.length;
   parentClock=1;h.patch({version:f.touch(),onBusyChange:observer(1)});await h.idle(true);assert.ok(rejected.some(report=>report.clock===0&&report.value===false),'old source cleanup is correctly rejected by the guarded parent observer');assert.equal(parentBusy,false,'the current source must report idle even when its dirty draft prevents automatic reload');assert.deepEqual(accepted.at(-1),{clock:1,value:false});assert.equal(h.render().props['data-workspace-saving'],false);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(reports.at(-1),true);assert.equal(f.calls.length,readsBeforeRefresh,'refresh with dirty choices must not start another request');assert.equal(f.writes.length,writesBeforeRefresh);
   release();await h.idle();assert.equal(parentBusy,false);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(reports.at(-1),true);assert.equal(h.saved.length,0);assert.equal(f.writes.length,method==='PUT'?1:0);assert.equal(h.button('선택 취소·저장 라벨 조회').props.disabled,false);
   editingProofs.push({kind:'dirty-source-current-busy-reset',delayedMethod:method,oldObserverRejected:true,currentObserverIdle:true,draftRetained:true,writes:f.writes.length,refreshRequests:0});
  }finally{release?.();h.close();}
 }
});

after(()=>{
 const source=fs.readFileSync(new URL('../app/components/product-label-editor.tsx',import.meta.url),'utf8'),start=source.indexOf('type ReferenceProps='),child=source.slice(start),testSource=fs.readFileSync(new URL('./product-label-reference-editor.test.mjs',import.meta.url));assert.ok(start>0);
 fs.writeFileSync(new URL('../outputs/step710-reference-child-proof.json',import.meta.url),JSON.stringify({format:'step710-label-reference-child-v1',childRange:{file:'app/components/product-label-editor.tsx',startMarker:'type ReferenceProps=',end:'EOF',rangeUnit:'source suffix; other parent ranges excluded',sha256:createHash('sha256').update(child).digest('hex')},testHash:createHash('sha256').update(testSource).digest('hex'),traces:editingProofs,boundary:'Actual child component callbacks with synthetic scheduler/auth-free reference APIs. No real browser, files, products, source collection, provider or Supplier Hub writes. Parent integration tests are root-owned.'},null,2)+'\n');
});

test('saved option label cards open the exact selected translation slot without saving or touching nine-row values',async()=>{
 const f=fixture(),opened=[],h=editor(f,{profileId:'profile',onTranslate:(...args)=>opened.push(args)});try{await h.idle();
  await h.click('최종 라벨 2 중국어 한국어 번역');await h.click('최종 라벨 1 영어 한국어 번역');
  assert.equal(opened.length,2);assert.deepEqual(plain(opened[0]),['owner/manual.png','label','zh',{kind:'quotation',profileId:'profile',optionId:'red',input:'labelImages',fieldKey:'labelImages',slotIndex:1,revision:0,inputFingerprint:'a'.repeat(64),optionRevision:2,value:'owner/old.png\nowner/manual.png'}]);
  assert.equal(opened[1][0],'owner/old.png');assert.equal(opened[1][2],'en');assert.equal(opened[1][3].slotIndex,0);assert.equal(f.writes.length,0);assert.equal(h.saved.length,0);
 }finally{h.close();}
});

test('retained label translation buttons cannot bypass dirty refs, source changes, busy or nine-row editing guards',async()=>{
 const f=fixture(),opened=[],h=editor(f,{onTranslate:(...args)=>opened.push(args)});try{await h.idle();const old=h.button('최종 라벨 2 중국어 한국어 번역').props.onClick;
  h.patch({disabled:true});old();await h.idle();assert.equal(opened.length,0);h.patch({disabled:false,beforeSave:()=>false});old();assert.equal(opened.length,0);
  h.patch({beforeSave:()=>true});await h.click('최종 라벨 1 견적에서 제외');old();assert.equal(opened.length,0);assert.equal(h.button('최종 라벨 1 중국어 한국어 번역').props.disabled,true);
  await h.click('선택 취소·저장 라벨 조회');h.source(f.touch());old();await h.idle();assert.equal(opened.length,0);assert.equal(f.writes.length,0);
  h.option('blue');old();assert.equal(opened.length,0);
 }finally{h.close();}
 const common=fixture(),c=editor(common,{optionId:null,onTranslate:()=>assert.fail('common translation is outside this scope')});try{await c.idle();assert.equal(nodes(c.render()).filter(node=>node.type==='button'&&/한국어 번역/.test(node.props['aria-label']??'')).length,0);}finally{c.close();}
});

test('stage six displays final-reference thumbnails, stages exclusion and explicit whole replacement without auto saving',async()=>{
 const f=fixture(),h=editor(f);try{await h.idle();assert.equal(thumbnailImages(h.render()).length,2);assert.equal(f.writes.length,0);
  await h.click('최종 라벨 1 견적에서 제외');assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(thumbnailImages(h.render()).length,1);assert.deepEqual(f.value.keys,['owner/old.png','owner/manual.png']);
  h.select('owner/new.png');await h.click('선택 파일로 최종 라벨 전체 교체');assert.equal(f.writes.length,0);assert.equal(thumbnailImages(h.render())[0].props.src,'/api/files/owner/new.png');
  await h.click('최종 라벨 연결 저장');assert.deepEqual(f.writes,[['owner/new.png']]);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.saved.length,1);assert.ok(f.calls.every(call=>!call.url.includes('/api/files')));
 }finally{h.close();}
});

test('explicit blank stays blank and a newer source keeps local reference exclusions until an explicit safe refresh',async()=>{
 const f=fixture(),h=editor(f);try{await h.idle();await h.click('최종 라벨 1 견적에서 제외');const oldSave=h.button('최종 라벨 연결 저장').props.onClick;h.source(f.touch());await h.idle();assert.equal(thumbnailImages(h.render()).length,1);assert.equal(h.render().props['data-workspace-dirty'],true);oldSave();await h.idle();assert.equal(f.writes.length,0);
  await h.click('선택 유지·최신 라벨 조회');await h.click('최종 라벨 전체 비우기');await h.click('최종 라벨 연결 저장');assert.deepEqual(f.value.keys,[]);assert.deepEqual(f.writes,[[]]);assert.match(text(h.render()),/공통 라벨을 자동으로 다시 선택하지 않습니다/);
 }finally{h.close();}
 const blank=fixture();blank.blank();const blankEditor=editor(blank);try{await blankEditor.idle();assert.equal(nodes(blankEditor.render()).filter(node=>node.type==='img').length,0);assert.equal(blank.writes.length,0);}finally{blankEditor.close();}
});

test('unknown committed save retains choices and explicit retry confirms without another PUT',async()=>{
 const f=fixture(),h=editor(f);try{await h.idle();h.select('owner/new.png');await h.click('선택 파일로 최종 라벨 전체 교체');f.lost();await h.click('최종 라벨 연결 저장');assert.equal(h.saved.length,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(f.writes.length,1);assert.equal(h.button('최종 라벨 전체 비우기').props.disabled,true);
  f.recover();await h.click('라벨 연결 저장 결과 확인·재시도');assert.equal(f.writes.length,1);assert.equal(h.saved.length,1);assert.equal(h.render().props['data-workspace-dirty'],false);
 }finally{h.close();}
});

test('entry and reopen show the actual saved final PNG at readable size; thumbnail switching is read only',async()=>{
 const f=fixture(),opened=[],h=editor(f,{onTranslate:(...args)=>opened.push(args)});try{await h.idle();
  const first=resultImage(h.render());assert.equal(first.props.src,'/api/files/owner/old.png');assert.deepEqual(plain(first.props.style),{width:'100%',height:'auto'});assert.equal(first.props.width,undefined);assert.equal(first.props.height,undefined);
  const download=nodes(h.render()).find(node=>node.type==='a'&&node.props['aria-label']==='최종 라벨 1 이미지 다운로드');assert.equal(download.props.href,first.props.src);assert.equal(download.props.download,'old.png');
  const reads=f.calls.length;assert.equal(h.button('최종 라벨 1 저장 결과 보기').props['aria-pressed'],true);await h.click('최종 라벨 2 저장 결과 보기');
  assert.equal(resultImage(h.render()).props.src,'/api/files/owner/manual.png');assert.equal(h.button('최종 라벨 2 저장 결과 보기').props['aria-pressed'],true);assert.equal(h.button('최종 라벨 1 저장 결과 보기').props['aria-pressed'],false);
  await h.click('최종 라벨 1 저장 결과 보기');assert.equal(resultImage(h.render()).props.src,first.props.src);assert.equal(f.calls.length,reads);assert.equal(f.writes.length,0);assert.equal(h.saved.length,0);assert.equal(opened.length,0);
  assert.ok(f.calls.every(call=>(call.init.method??'GET')==='GET'&&call.url.endsWith('/quotation-fields')));
 }finally{h.close();}
 const reopened=editor(f);try{await reopened.idle();assert.equal(resultImage(reopened.render()).props.src,'/api/files/owner/old.png');assert.equal(f.writes.length,0);}finally{reopened.close();}
});

test('a staged replacement cannot masquerade as saved label pixels and saved blanks have no automatic image fallback',async()=>{
 const f=fixture(),h=editor(f);try{await h.idle();await h.click('최종 라벨 2 저장 결과 보기');h.select('owner/new.png');await h.click('선택 파일로 최종 라벨 전체 교체');
  assert.equal(resultImage(h.render()).props.src,'/api/files/owner/manual.png');assert.equal(thumbnailImages(h.render())[0].props.src,'/api/files/owner/new.png');assert.equal(h.button('최종 라벨 1 저장 결과 보기').props.disabled,true);assert.match(text(h.render()),/변경 선택은 저장한 뒤 반영/);assert.equal(f.writes.length,0);
  await h.click('최종 라벨 연결 저장');assert.equal(resultImage(h.render()).props.src,'/api/files/owner/new.png');assert.deepEqual(f.writes,[['owner/new.png']]);
  await h.click('최종 라벨 전체 비우기');assert.equal(resultImage(h.render()).props.src,'/api/files/owner/new.png');await h.click('최종 라벨 연결 저장');assert.equal(resultImage(h.render()),undefined);assert.equal(thumbnailImages(h.render()).length,0);assert.match(text(h.render()),/공통 라벨을 자동으로 다시 선택하지 않습니다/);
 }finally{h.close();}
 const blank=fixture();blank.blank();const empty=editor(blank);try{await empty.idle();assert.equal(resultImage(empty.render()),undefined);assert.equal(blank.writes.length,0);assert.equal(blank.calls.length,1);}finally{empty.close();}
});

test('unowned final references never become the saved result or a file request',async()=>{
 const f=fixture();f.value.keys=['foreign/missing.png','owner/manual.png'];const h=editor(f);try{await h.idle();
  assert.equal(resultImage(h.render()).props.src,'/api/files/owner/manual.png');assert.equal(resultImage(h.render()).props.alt,'저장된 최종 라벨 2 결과');assert.equal(h.button('최종 라벨 1 저장 결과 보기'),undefined);assert.ok(nodes(h.render()).filter(node=>node.type==='img'||node.type==='a').every(node=>!(node.props.src??node.props.href).includes('foreign')));assert.equal(f.writes.length,0);
 }finally{h.close();}
 const missing=fixture();missing.value.keys=['foreign/missing.png'];const unavailable=editor(missing);try{await unavailable.idle();assert.equal(resultImage(unavailable.render()),undefined);assert.equal(thumbnailImages(unavailable.render()).length,0);assert.match(text(unavailable.render()),/연결 파일을 확인하지 못했습니다/);assert.equal(missing.writes.length,0);}finally{unavailable.close();}
});

test('product, option, profile and source clocks hide the previous saved result before refresh and reject retained thumbnail callbacks',async()=>{
 for(const change of [{productId:'other-product'},{optionId:'blue'},{profileId:'other-profile'},{refreshToken:'new-read'},{version:'2026-10-07T00:00:00.001Z'}]){
  const f=fixture(),original=f.request;let hold=false,release;f.request=async(url,init)=>{const response=original(url,init);if(hold){hold=false;await new Promise(resolve=>{release=resolve;});}return response;};
  const h=editor(f);try{await h.idle();await h.click('최종 라벨 2 저장 결과 보기');const retained=h.button('최종 라벨 2 저장 결과 보기').props.onClick;hold=true;if(change.version)f.touch();h.patch(change);
   assert.equal(resultImage(h.render()),undefined,'the previous source must not be painted during refresh');retained();await h.idle(true);assert.equal(resultImage(h.render()),undefined);assert.equal(typeof release,'function');release();await h.idle();
   assert.equal(resultImage(h.render()).props.src,'/api/files/owner/old.png','each new identity begins with its own first saved reference');retained();await h.idle();assert.equal(resultImage(h.render()).props.src,'/api/files/owner/old.png');assert.equal(f.writes.length,0);assert.equal(h.saved.length,0);
  }finally{release?.();h.close();}
 }
});
