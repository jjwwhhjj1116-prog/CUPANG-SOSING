import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const native=createRequire(import.meta.url),version='2026-10-06T00:00:00.000Z';
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):typeof value==='boolean'?'':String(value??'');
const equalDeps=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));

function harness({focusedOptionId='b',count=3,initialBulkAction='remove',pricingView=true}={}){
 const contexts=new Map(),cache=new Map(),pendingEffects=[],requests=[],files=[];let active,seen,saves=0;
 const state={failSave:false,beforeSave:null,options:null};
 const serverProduct={id:'p',owner_id:'owner',title:'합성 옵션 삭제 검토',source_price_cny:999,exchange_rate:100,supply_margin:0,coupang_margin:0,image_keys:'["owner/a.png","owner/b.png"]',updated_at:version};
 const hooks={
  useState(initial){const ctx=active,index=ctx.cursor++;if(!(index in ctx.slots))ctx.slots[index]=typeof initial==='function'?initial():initial;return[ctx.slots[index],value=>{ctx.slots[index]=typeof value==='function'?value(ctx.slots[index]):value;}];},
  useRef(initial){const ctx=active,index=ctx.cursor++;return ctx.slots[index]??(ctx.slots[index]={current:initial});},
  useMemo(fn,deps){const ctx=active,index=ctx.cursor++,previous=ctx.slots[index];if(!previous||!equalDeps(previous.deps,deps))ctx.slots[index]={deps,value:fn()};return ctx.slots[index].value;},
  useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},
  useEffect(fn,deps){const ctx=active,index=ctx.cursor++,previous=ctx.slots[index];if(!previous||!equalDeps(previous.deps,deps)){ctx.slots[index]={deps,cleanup:previous?.cleanup};pendingEffects.push({ctx,index,fn});}},
 };
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,Date,URL,AbortController,TextEncoder,TextDecoder,Uint8Array,Response,Request,crypto,process:{env:{NODE_ENV:'development'}},fetch:async(url,init={})=>{
   requests.push({url,method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});assert.equal(url,'/api/products/p/options');
   const route=load('app/api/products/[id]/options/route.ts');return route[init.method??'GET'](new Request('https://synthetic.test'+url,init),{params:Promise.resolve({id:'p'})});
  },require(name){
   if(name==='react')return hooks;if(name==='next/server')return{NextResponse:Response};
   if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>({verifiedAccess:true,userId:'owner'}),getWorkspaceOwnerId:async()=>'owner'};
   if(name==='@/db/queries')return{findProduct:async(owner,id)=>owner==='owner'&&id==='p'?structuredClone(serverProduct):null,getSettings:async()=>null};
   if(name==='@/db/collection-images')return{readOptionSourceImages:async()=>({})};
   if(name==='@/db/product-options')return{
    readProductOptions:async()=>structuredClone(state.options),
    saveProductOptions:async(owner,next,revision,expectedVersion)=>{
     state.beforeSave?.();if(state.failSave)throw Error('Synthetic save failure.');
     if(owner!=='owner'||next.productId!=='p'||state.options.revision!==revision||serverProduct.updated_at!==expectedVersion)return null;
     state.options=structuredClone(next);serverProduct.updated_at=next.updatedAt;return structuredClone(next);
    },
   };
   if(name==='cloudflare:workers')return{env:{FILES:{head:async key=>{files.push(['head',key]);return{httpMetadata:{contentType:'image/png'}};},delete:async()=>assert.fail('Option review cannot delete image files.'),put:async()=>assert.fail('Option review cannot write image files.')}}};
   if(name.startsWith('@/'))return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));return native(name);
  }},{filename:file});return exports;
 }
 const model=load('app/product-options.ts'),policy={exchangeRate:100,supplyMargin:0,coupangMargin:0,minimumMargin:0,msrpMultiple:1,roundingUnit:1};
 serverProduct.pricing_policy=JSON.stringify(policy);
 const inputs=Array.from({length:count},(_,index)=>({...model.emptyOptionInput(String.fromCharCode(97+index)),originalName:'원문 '+index,translatedName:'옵션 '+index,supplierSku:'SKU-'+index,unitCostCny:2+index,included:true,stock:10+index,imageKey:index?'owner/b.png':'owner/a.png'}));
 state.options=model.applyOptionRows(model.emptyProductOptions('p'),inputs,version);
 const props={product:structuredClone(serverProduct),focusedOptionId,initialBulkAction,pricingView,onSaved(){saves++;props.product.updated_at=serverProduct.updated_at;}};
 const component=load('app/components/product-options-editor.tsx').ProductOptionsEditor;
 function expand(node,path){
  if(Array.isArray(node))return node.map((child,index)=>expand(child,path+'/'+index));if(!node||typeof node!=='object')return node;
  if(typeof node.type==='function'){
   const id=path+'/'+node.type.name+':'+String(node.key??'');seen.add(id);let ctx=contexts.get(id);if(!ctx){ctx={id,slots:[],cursor:0};contexts.set(id,ctx);}ctx.cursor=0;
   const previous=active;active=ctx;const rendered=node.type(node.props);active=previous;return expand(rendered,id);
  }
  return{...node,props:{...node.props,children:expand(node.props?.children,path+'/children')}};
 }
 function render(){seen=new Set();const tree=expand({type:component,key:'p',props},'root');for(const [id,ctx] of contexts)if(!seen.has(id)){for(const slot of ctx.slots)slot?.cleanup?.();contexts.delete(id);}return tree;}
 function runEffects(){while(pendingEffects.length){const {ctx,index,fn}=pendingEffects.shift();ctx.slots[index].cleanup?.();ctx.slots[index].cleanup=fn();}}
 async function settle(){for(let i=0;i<12;i++){render();runEffects();await new Promise(resolve=>setImmediate(resolve));}}
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node)===label);
 const input=label=>nodes(render()).find(node=>node.props?.['aria-label']===label);
 const operation=()=>nodes(render()).find(node=>node.type==='select'&&nodes(node).some(option=>option.type==='option'&&option.props.value==='remove'));
 const rowIds=()=>nodes(render()).filter(node=>node.type==='tr'&&Object.hasOwn(node.props,'data-option-target')).map(node=>nodes(node).find(child=>child.type==='input'&&child.props['aria-label']?.endsWith('개당 원가'))?.props['aria-label']);
 const draftRows=()=>{const ctx=[...contexts.values()].find(value=>value.id.includes('/OptionsEditor:'));return ctx.slots[1];};
 return{props,state,requests,files,serverProduct,model,render,settle,button,input,operation,rowIds,draftRows,get saves(){return saves;},async start(){render();runEffects();await settle();},close(){for(const ctx of contexts.values())for(const slot of ctx.slots)slot?.cleanup?.();}};
}

test('management opens an existing focused option in remove review and does not preview, apply or save on navigation',async()=>{
 const h=harness();try{
  const before=JSON.stringify(h.state.options);await h.start();assert.equal(h.operation().props.value,'remove');assert.equal(nodes(h.render()).find(node=>node.type==='details').props.open,true);
  assert.equal(h.input('가격 옵션 1 선택').props.checked,false);assert.equal(h.input('가격 옵션 2 선택').props.checked,true);assert.equal(h.input('가격 옵션 3 선택').props.checked,false);
  assert.equal(h.button('편집 내용에 적용'),undefined);assert.equal(h.button('변경 미리보기').props.disabled,false);assert.equal(h.button('옵션 저장·가격 계산').props.disabled,true);assert.match(text(h.render()),/삭제 검토 대상으로 표시/);
  assert.deepEqual(h.requests.map(request=>request.method),['GET']);assert.equal(JSON.stringify(h.state.options),before);assert.equal(h.draftRows().length,3);
 }finally{h.close();}
});

test('explicit preview, apply, undo and save preserve unselected rows and use the exact revision/version',async()=>{
 const h=harness();try{
  await h.start();const before=JSON.stringify(h.state.options),original=JSON.stringify(h.draftRows()),unselected=h.draftRows().filter(row=>row.id!=='b').map(row=>JSON.stringify(row));
  h.button('변경 미리보기').props.onClick();assert.deepEqual(h.requests.map(request=>request.method),['GET']);assert.equal(JSON.stringify(h.draftRows()),original);assert.match(text(h.render()),/옵션 삭제 · 1개 옵션 미리보기/);
  h.button('편집 내용에 적용').props.onClick();assert.deepEqual(Array.from(h.draftRows(),row=>row.id),['a','c']);assert.deepEqual(h.draftRows().map(row=>JSON.stringify(row)),unselected);assert.equal(JSON.stringify(h.state.options),before);assert.equal(h.requests.length,1);
  h.button('최근 일괄 변경 되돌리기').props.onClick();assert.equal(JSON.stringify(h.draftRows()),original);assert.equal(h.requests.length,1);
  h.input('가격 옵션 2 선택').props.onChange({target:{checked:true}});h.button('변경 미리보기').props.onClick();h.button('편집 내용에 적용').props.onClick();
  h.button('옵션 저장·가격 계산').props.onClick();await h.settle();assert.deepEqual(h.requests.map(request=>request.method),['GET','PATCH']);
  const patch=h.requests[1].body;assert.equal(patch.expectedRevision,1);assert.equal(patch.expectedProductVersion,version);assert.deepEqual(patch.rows.map(row=>row.id),['a','c']);assert.deepEqual(patch.rows.map(row=>JSON.stringify(row)),unselected);
  assert.deepEqual(Array.from(h.state.options.rows,row=>row.id),['a','c']);assert.equal(h.state.options.revision,2);assert.equal(h.saves,1);assert.equal(h.button('옵션 저장·가격 계산').props.disabled,true);assert.ok(h.files.every(([method])=>method==='head'));
 }finally{h.close();}
});

test('removing the last option keeps the real undo tool mounted and restores its full draft with GET-only requests',async()=>{
 const h=harness({count:1,focusedOptionId:'a'});try{
  await h.start();const original=JSON.stringify(h.draftRows()),server=JSON.stringify(h.state.options);
  h.button('변경 미리보기').props.onClick();h.button('편집 내용에 적용').props.onClick();assert.equal(h.draftRows().length,0);assert.match(text(h.render()),/저장한 옵션이 없습니다/);assert.ok(h.button('최근 일괄 변경 되돌리기'));
  h.button('최근 일괄 변경 되돌리기').props.onClick();assert.equal(JSON.stringify(h.draftRows()),original);assert.equal(JSON.stringify(h.state.options),server);assert.deepEqual(h.requests.map(request=>request.method),['GET']);
 }finally{h.close();}
});

test('missing targets and stale preview selections never remove another option',async()=>{
 const missing=harness({focusedOptionId:'missing'});try{
  await missing.start();const before=JSON.stringify(missing.draftRows());assert.equal(missing.button('변경 미리보기').props.disabled,true);missing.button('변경 미리보기').props.onClick();assert.equal(missing.button('편집 내용에 적용'),undefined);assert.equal(JSON.stringify(missing.draftRows()),before);assert.deepEqual(missing.requests.map(request=>request.method),['GET']);
 }finally{missing.close();}
 const h=harness();try{
  await h.start();const before=JSON.stringify(h.draftRows());h.button('변경 미리보기').props.onClick();const apply=h.button('편집 내용에 적용');h.input('가격 옵션 2 선택').props.onChange({target:{checked:false}});assert.equal(h.button('편집 내용에 적용').props.disabled,true);h.button('편집 내용에 적용').props.onClick();assert.equal(JSON.stringify(h.draftRows()),before);assert.equal(apply.props.disabled,false);assert.deepEqual(h.requests.map(request=>request.method),['GET']);
 }finally{h.close();}
});

test('save failures and CAS conflicts retain the removal draft and saved option records',async()=>{
 for(const failure of ['unavailable','conflict']){
  const h=harness();try{
   await h.start();const before=JSON.stringify(h.state.options);h.button('변경 미리보기').props.onClick();h.button('편집 내용에 적용').props.onClick();const draft=JSON.stringify(h.draftRows());
   if(failure==='unavailable')h.state.failSave=true;else h.state.beforeSave=()=>{h.state.beforeSave=null;h.serverProduct.updated_at='2026-10-06T00:00:01.000Z';};
   h.button('옵션 저장·가격 계산').props.onClick();await h.settle();assert.equal(JSON.stringify(h.draftRows()),draft);assert.equal(JSON.stringify(h.state.options),before);assert.equal(h.saves,0);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));
   assert.deepEqual(h.requests.map(request=>request.method),['GET','PATCH']);assert.equal(h.button('옵션 저장·가격 계산').props.disabled,failure==='conflict');
  }finally{h.close();}
 }
});

test('changing only the initial action remounts bulk review state while option drafts remain mounted',async()=>{
 const h=harness({initialBulkAction:undefined});try{
  h.props.initialBulkAction=undefined;await h.start();assert.equal(h.operation().props.value,'unitsPerPack');
  h.input('가격 옵션 1 개당 원가').props.onChange({target:{value:'8',valueAsNumber:8}});const draft=JSON.stringify(h.draftRows());
  h.props.initialBulkAction='remove';assert.equal(h.operation().props.value,'remove');assert.equal(nodes(h.render()).find(node=>node.type==='details').props.open,true);h.button('변경 미리보기').props.onClick();assert.ok(h.button('편집 내용에 적용'));
  h.props.pricingView=false;h.render();assert.ok(h.button('편집 내용에 적용'),'normal tab movement keeps management intent and preview');assert.equal(JSON.stringify(h.draftRows()),draft);
  h.props.initialBulkAction=undefined;assert.equal(h.operation().props.value,'unitsPerPack');assert.equal(h.button('편집 내용에 적용'),undefined);assert.equal(JSON.stringify(h.draftRows()),draft);await h.settle();assert.deepEqual(h.requests.map(request=>request.method),['GET']);
 }finally{h.close();}
});
