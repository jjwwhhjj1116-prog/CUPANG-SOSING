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
 const react={useState(value){const index=cursor++;if(!(index in slots))slots[index]=value;return[slots[index],next=>{assert.equal(closed,false,'no state writes after unmount');changed=true;slots[index]=typeof next==='function'?next(slots[index]):next;}];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useCallback(fn,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={fn,deps};return slots[index].fn;},useEffect:(fn,deps)=>effect(effects,fn,deps),useLayoutEffect:(fn,deps)=>effect(layouts,fn,deps)};
 function load(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,Error,fetch:async(url,init)=>new Promise((resolve,reject)=>pending.push({url,init,resolve,reject})),require(name){if(name==='react')return react;return load(name.slice(2)+'.ts');}});return exports;}
 const hook=load('app/components/use-registration-layout.ts').useRegistrationLayout,navigation=load('app/registration-navigation.ts');
 function render(passive=true){let value;do{changed=false;cursor=0;value=hook(...args);}while(changed);layouts.splice(0).forEach(fn=>fn());if(passive)effects.splice(0).forEach(fn=>fn());return value;}
 return{pending,navigation,render,select(next,passive=true){args=next;return render(passive);},async resolve(index,value,status=200){pending[index].resolve(Response.json(value,{status}));await new Promise(resolve=>setImmediate(resolve));return render();},async reject(index,message='연결을 확인해주세요.'){pending[index].reject(new Error(message));await new Promise(resolve=>setImmediate(resolve));return render();},close(){closed=true;slots.forEach(value=>value?.cleanup?.());},steps(){return [...navigation.registrationStepsForLayout(render().layout)];}};
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
 const h=harness([null,undefined,undefined]);assert.equal(h.render().retry(),false);assert.equal(h.pending.length,0);h.select(['owner-a','product-a',version]);assert.equal(h.pending.length,1);h.close();await h.resolve(0,layout('product-a'));assert.equal(h.pending.length,1);
});

test('same-category version refresh preserves labels only as pending presentation and never a fresh layout',async()=>{
 const h=harness();try{h.render();await h.resolve(0,layout('product-a'));const refreshing=h.select(['owner-a','product-a',nextVersion]);assert.equal(refreshing.layout,null);assert.equal(refreshing.loading,true);assert.equal(refreshing.pendingLayout.sizeChartRequired,true);assert.equal(refreshing.pendingLayout.productVersion,version);
  await h.resolve(1,layout('product-a',false,nextVersion));assert.equal(h.render().pendingLayout,null);assert.equal(h.steps().length,7);
  h.select(['owner-a','product-a',nextVersion,'new-profile']);assert.equal(h.render().pendingLayout,null,'a different category cannot inherit the labels');
 }finally{h.close();}
});

test('failed initial reads require an explicit same-scope retry and recover without any write',async()=>{
 const h=harness(['owner-a','product-a',version,'profile-a']);try{
  h.render();const failed=await h.reject(0);assert.equal(failed.layout,null);assert.equal(failed.pendingLayout,null);assert.equal(failed.loading,false);assert.match(failed.error,/연결/);
  h.render();h.render();assert.equal(h.pending.length,1,'rendering an error must not automatically retry');
  assert.equal(failed.retry(),true);assert.equal(failed.retry(),false,'a retry revokes the previous callback immediately');
  const retrying=h.render();assert.equal(retrying.layout,null);assert.equal(retrying.loading,true);assert.equal(retrying.error,'');assert.equal(h.pending.length,2);
  assert.equal(h.pending[0].init.signal.aborted,true);assert.equal(h.pending[1].url,'/api/products/product-a/registration-layout?profileId=profile-a');
  const recovered=await h.resolve(1,layout('product-a',true,version,'profile-a'));assert.equal(recovered.loading,false);assert.equal(recovered.error,'');assert.equal(recovered.pendingLayout,null);assert.equal(recovered.layout.sizeChartRequired,true);assert.equal(h.steps().length,8);
  assert.ok(h.pending.every(request=>request.init.cache==='no-store'&&!request.init.method&&!request.init.body),'initial read and retry are read-only');
 }finally{h.close();}
});

test('failed version reads and retries retain only verified same-category presentation',async()=>{
 const h=harness();try{
  h.render();await h.resolve(0,layout('product-a'));h.select(['owner-a','product-a',nextVersion]);
  const failed=await h.resolve(1,{error:'unavailable'},503);assert.equal(failed.layout,null);assert.equal(failed.loading,false);assert.ok(failed.error);assert.equal(failed.pendingLayout.productVersion,version);assert.equal(failed.pendingLayout.sizeChartRequired,true);
  assert.equal(h.navigation.registrationStepsForLayout(failed.pendingLayout).length,8,'verified labels can still be presented');assert.equal(h.steps().length,7,'pending labels do not supply a navigation layout');
  failed.retry();const retrying=h.render();assert.equal(retrying.loading,true);assert.equal(retrying.pendingLayout.productVersion,version);
  const failedAgain=await h.reject(2);assert.equal(failedAgain.layout,null);assert.equal(failedAgain.pendingLayout.sizeChartRequired,true);assert.equal(failedAgain.loading,false);h.render();assert.equal(h.pending.length,3);
  failedAgain.retry();h.render();const recovered=await h.resolve(3,layout('product-a',false,nextVersion));assert.equal(recovered.layout.productVersion,nextVersion);assert.equal(recovered.layout.sizeChartRequired,false);assert.equal(recovered.pendingLayout,null);
 }finally{h.close();}
});

test('retry callbacks cannot act after owner, product, version, profile, or A→B→A transitions',async()=>{
 const initial=['owner-a','product-a',version,'profile-a'];
 for(const other of [['owner-b','product-a',version,'profile-a'],['owner-a','product-b',version,'profile-a'],['owner-a','product-a',nextVersion,'profile-a'],['owner-a','product-a',version,'profile-b']]){
  const h=harness(initial);try{
   const first=h.render();h.select(other,false);assert.equal(first.retry(),false,'a context render revokes callbacks before passive effects');h.render();
   const returned=h.select(initial);assert.equal(first.retry(),false,'returning to identical values must not revive the old callback');assert.equal(h.pending.length,3);
   assert.equal(returned.retry(),true);const fresh=h.render();assert.equal(h.pending.length,4);assert.equal(fresh.layout,null);assert.equal(fresh.loading,true);
   await h.resolve(0,layout('product-a',true,version,'profile-a'));await h.resolve(2,layout('product-a',true,version,'profile-a'));assert.equal(h.render().layout,null,'neither the original nor superseded returned request may become ready');
   const latest=await h.resolve(3,layout('product-a',true,version,'profile-a'));assert.equal(latest.layout.sizeChartRequired,true);
  }finally{h.close();}
 }
});

test('retry revokes a response before rerender and preserves no unverified presentation across scopes',async()=>{
 const h=harness();try{
  const first=h.render();assert.equal(first.retry(),true);const afterOld=await h.resolve(0,layout('product-a'));assert.equal(afterOld.layout,null);assert.equal(afterOld.pendingLayout,null);assert.equal(afterOld.loading,true);
  await h.resolve(1,layout('product-a'));const current=h.render();h.select(['owner-b','product-a',version]);const failed=await h.reject(2);assert.equal(failed.pendingLayout,null,'an old company layout cannot survive a new company read failure');assert.equal(current.retry(),false);
  failed.retry();h.render();const unmounted=h.render().retry;h.close();assert.equal(unmounted(),false);await h.resolve(3,layout('product-a'));assert.equal(h.pending.length,4);
 }finally{h.close();}
});

test('a stale server clock cannot replace verified labels during a newer product read or retry',async()=>{
 const h=harness();try{
  h.render();await h.resolve(0,layout('product-a'));h.select(['owner-a','product-a',nextVersion]);
  const failed=await h.resolve(1,layout('product-a',false,version));assert.equal(failed.layout,null);assert.ok(failed.error);assert.equal(failed.pendingLayout.productVersion,version);assert.equal(failed.pendingLayout.sizeChartRequired,true,'the rejected seven-step response must not become presentation');
  failed.retry();h.render();const recovered=await h.resolve(2,layout('product-a',false,nextVersion));assert.equal(recovered.layout.sizeChartRequired,false);assert.equal(recovered.error,'');assert.equal(recovered.pendingLayout,null);
 }finally{h.close();}
});
