import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
const plain=value=>JSON.parse(JSON.stringify(value)),nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[],text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
const version='2026-10-07T00:00:00.000Z';
class SaveError extends Error{constructor(message,uncertain){super(message);this.uncertain=uncertain;}}
function fixture(){
 const calls=[],writes=[],keys=['owner/old.png','owner/new.png','owner/manual.png'];let value={view:{productVersion:version,imageKeys:keys},quotation:{revision:0},keys:[keys[0],keys[2]]},lose=false,unavailable=false;
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
 const effect=(fn,deps)=>{const slot=index++,old=slots[slot],changed=!old||!deps||deps.some((value,i)=>value!==old.deps?.[i]);if(changed)pending.push(()=>{old?.cleanup?.();slots[slot]={deps,cleanup:fn()};});};
 const react={useState(initial){const slot=index++;if(!(slot in slots))slots[slot]={value:typeof initial==='function'?initial():initial};return[slots[slot].value,next=>{if(closed){lateWrites++;return;}slots[slot].value=typeof next==='function'?next(slots[slot].value):next;}];},useRef(initial){const slot=index++;if(!(slot in slots))slots[slot]={current:initial};return slots[slot];},useEffect:effect,useLayoutEffect:effect};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,AbortController,TextEncoder,fetch:f.request,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};if(name==='@/app/product-label-references')return f.helpers;if(name==='@/app/document-image-render'||name==='@/app/product-label-attachment')return{};if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');if(name.startsWith('@/'))return load(name.slice(2)+'.ts');throw Error(name);}});return exports;}
 const Component=load('app/components/product-label-editor.tsx').ProductLabelReferenceEditor;
 const render=()=>{index=0;tree=Component({...props,onSaved:()=>saved.push(1)});const effects=pending;pending=[];effects.forEach(run=>run());return tree;};
 const idle=async()=>{for(let i=0;i<16;i++){render();await new Promise(resolve=>setImmediate(resolve));}return render();};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));
 render();return {render,idle,button,saved,async click(label){const node=button(label);assert.ok(node,label);assert.equal(node.props.disabled,false,label+' should be enabled');node.props.onClick();await idle();},select(key){const node=nodes(render()).find(node=>node.type==='select');node.props.onChange({target:{value:key}});render();},source(value){props.version=value;render();},option(value){props.optionId=value;render();},close(){closed=true;for(const slot of slots)slot?.cleanup?.();},get lateWrites(){return lateWrites;}};
}

test('stage six displays final-reference thumbnails, stages exclusion and explicit whole replacement without auto saving',async()=>{
 const f=fixture(),h=editor(f);try{await h.idle();assert.equal(nodes(h.render()).filter(node=>node.type==='img').length,2);assert.equal(f.writes.length,0);
  await h.click('최종 라벨 1 견적에서 제외');assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(nodes(h.render()).filter(node=>node.type==='img').length,1);assert.deepEqual(f.value.keys,['owner/old.png','owner/manual.png']);
  h.select('owner/new.png');await h.click('선택 파일로 최종 라벨 전체 교체');assert.equal(f.writes.length,0);assert.equal(nodes(h.render()).find(node=>node.type==='img').props.src,'/api/files/owner/new.png');
  await h.click('최종 라벨 연결 저장');assert.deepEqual(f.writes,[['owner/new.png']]);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.saved.length,1);assert.ok(f.calls.every(call=>!call.url.includes('/api/files')));
 }finally{h.close();}
});

test('explicit blank stays blank and a newer source keeps local reference exclusions until an explicit safe refresh',async()=>{
 const f=fixture(),h=editor(f);try{await h.idle();await h.click('최종 라벨 1 견적에서 제외');const oldSave=h.button('최종 라벨 연결 저장').props.onClick;h.source(f.touch());await h.idle();assert.equal(nodes(h.render()).filter(node=>node.type==='img').length,1);assert.equal(h.render().props['data-workspace-dirty'],true);oldSave();await h.idle();assert.equal(f.writes.length,0);
  await h.click('선택 유지·최신 라벨 조회');await h.click('최종 라벨 전체 비우기');await h.click('최종 라벨 연결 저장');assert.deepEqual(f.value.keys,[]);assert.deepEqual(f.writes,[[]]);assert.match(text(h.render()),/공통 라벨을 자동으로 다시 선택하지 않습니다/);
 }finally{h.close();}
 const blank=fixture();blank.blank();const blankEditor=editor(blank);try{await blankEditor.idle();assert.equal(nodes(blankEditor.render()).filter(node=>node.type==='img').length,0);assert.equal(blank.writes.length,0);}finally{blankEditor.close();}
});

test('unknown committed save retains choices and explicit retry confirms without another PUT',async()=>{
 const f=fixture(),h=editor(f);try{await h.idle();h.select('owner/new.png');await h.click('선택 파일로 최종 라벨 전체 교체');f.lost();await h.click('최종 라벨 연결 저장');assert.equal(h.saved.length,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(f.writes.length,1);assert.equal(h.button('최종 라벨 전체 비우기').props.disabled,true);
  f.recover();await h.click('라벨 연결 저장 결과 확인·재시도');assert.equal(f.writes.length,1);assert.equal(h.saved.length,1);assert.equal(h.render().props['data-workspace-dirty'],false);
 }finally{h.close();}
});
