import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const version='2026-10-20T01:00:00.000Z',nextVersion='2026-10-20T01:00:01.000Z';
const layout=(productId,required=true,productVersion=version,profileId)=>({format:'yoofam-registration-layout-v1',productId,productVersion,sizeChartRequired:required,categoryContext:{source:profileId?'profile':'collection',profileId:profileId??null,categoryId:'81452',categoryPath:['패션','모자']}});
function harness(initial=['owner-a','product-a',version,undefined]){
 const slots=[],pending=[],effects=[],layouts=[],cache=new Map();let cursor=0,changed=false,args=initial,closed=false;
 const effect=(queue,fn,deps)=>{const index=cursor++,old=slots[index];if(!old||old.deps.length!==deps.length||deps.some((value,i)=>!Object.is(value,old.deps[i]))){const next={deps,cleanup:old?.cleanup};slots[index]=next;queue.push(()=>{old?.cleanup?.();next.cleanup=fn();});}};
 const react={useState(value){const index=cursor++;if(!(index in slots))slots[index]=value;return[slots[index],next=>{assert.equal(closed,false,'no state writes after unmount');changed=true;slots[index]=typeof next==='function'?next(slots[index]):next;}];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useEffect:(fn,deps)=>effect(effects,fn,deps),useLayoutEffect:(fn,deps)=>effect(layouts,fn,deps)};
 function load(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,Error,fetch:async(url,init)=>new Promise(resolve=>pending.push({url,init,resolve})),require(name){if(name==='react')return react;return load(name.slice(2)+'.ts');}});return exports;}
 const hook=load('app/components/use-registration-layout.ts').useRegistrationLayout,navigation=load('app/registration-navigation.ts');
 function render(passive=true){let value;do{changed=false;cursor=0;value=hook(...args);}while(changed);layouts.splice(0).forEach(fn=>fn());if(passive)effects.splice(0).forEach(fn=>fn());return value;}
 return{pending,navigation,render,select(next,passive=true){args=next;return render(passive);},async resolve(index,value,status=200){pending[index].resolve(Response.json(value,{status}));await new Promise(resolve=>setImmediate(resolve));return render();},close(){closed=true;slots.forEach(value=>value?.cleanup?.());},steps(){return [...navigation.registrationStepsForLayout(render().layout)];}};
}

test('only the scoped official layout inserts a size step; optional and unknown categories keep seven',async()=>{
 const h=harness();try{
  assert.equal(h.render().loading,true);assert.equal(h.pending[0].url,'/api/products/product-a/registration-layout');assert.equal(h.steps().length,7);
  await h.resolve(0,layout('product-a'));assert.deepEqual(h.steps(),['SEO','가격','대표 이미지','추가 이미지','상세 이미지','사이즈표','표시사항','견적서']);
  assert.equal(h.navigation.initialRegistrationStep('사이즈표'),'사이즈표');assert.equal(h.navigation.initialRegistrationStep('옵션'),'SEO');
  h.select(['owner-a','product-a',nextVersion]);assert.equal(h.steps().length,7);await h.resolve(1,layout('product-a',false,nextVersion));assert.equal(h.steps().length,7);
  h.select(['owner-a','product-a',version,'profile-a']);assert.equal(h.pending[2].url,'/api/products/product-a/registration-layout?profileId=profile-a');await h.resolve(2,layout('product-a',true,version,'profile-a'));assert.equal(h.steps().length,8);
 }finally{h.close();}
});

test('A→B→A response ordering cannot reuse the first product or company request',async()=>{
 const h=harness();try{
  h.render();h.select(['owner-a','product-b',version]);h.select(['owner-a','product-a',version]);assert.equal(h.pending.length,3);
  await h.resolve(0,layout('product-a'));assert.equal(h.render().layout,null);await h.resolve(1,layout('product-b'));assert.equal(h.render().layout,null);
  await h.resolve(2,layout('product-a'));assert.equal(h.steps().length,8);
  h.select(['owner-b','product-a',version],false);assert.equal(h.render().layout,null,'owner render invalidates before passive effects');assert.equal(h.steps().length,7);
  await h.resolve(3,layout('product-a',false));assert.equal(h.steps().length,7);
 }finally{h.close();}
});

test('wrong product clock or explicit profile is rejected without category inference or writes',async()=>{
 for(const body of [layout('product-b'),layout('product-a',true,nextVersion,'profile-a'),layout('product-a',true,version,'profile-b')]){
  const h=harness(['owner-a','product-a',version,'profile-a']);try{h.render();const result=await h.resolve(0,body);assert.equal(result.layout,null);assert.ok(result.error);assert.equal(h.steps().length,7);assert.ok(h.pending.every(value=>!value.init.method));}finally{h.close();}
 }
});

test('no product/owner and unmounted responses do not produce a layout or an automatic retry',async()=>{
 const h=harness([null,undefined,undefined]);h.render();assert.equal(h.pending.length,0);h.select(['owner-a','product-a',version]);assert.equal(h.pending.length,1);h.close();await h.resolve(0,layout('product-a'));assert.equal(h.pending.length,1);
});

test('same-category version refresh preserves labels only as pending presentation and never a fresh layout',async()=>{
 const h=harness();try{h.render();await h.resolve(0,layout('product-a'));const refreshing=h.select(['owner-a','product-a',nextVersion]);assert.equal(refreshing.layout,null);assert.equal(refreshing.loading,true);assert.equal(refreshing.pendingLayout.sizeChartRequired,true);assert.equal(refreshing.pendingLayout.productVersion,version);
  await h.resolve(1,layout('product-a',false,nextVersion));assert.equal(h.render().pendingLayout,null);assert.equal(h.steps().length,7);
  h.select(['owner-a','product-a',nextVersion,'new-profile']);assert.equal(h.render().pendingLayout,null,'a different category cannot inherit the labels');
 }finally{h.close();}
});
