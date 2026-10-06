import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
const native=createRequire(import.meta.url);
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
async function fixture({companyCode='A01464742',companyName='와이홉',url='https://detail.1688.com/offer/813724060928.html?offerId=813724060928',rowCount=1}={}){
 const api=mobileIntakeHarness({companyCode,companyName}),states=[],effects=[],cleanups=[],setups=[];let cursor=0,first=true;
 api.context.category=await api.load('db/category-profiles.ts').createCategoryProfile('owner',api.context.category);
 let seed={id:'historical-selection',sourceUrl:url},rows=Array.from({length:rowCount},(_,index)=>({...api.load('app/intake-queue.ts').intakeRow(api.context.category,'existing-'+index),url:'https://detail.1688.com/offer/'+(index+1)+'.html',features:'보존할 특징',keywords:'직접 키워드',message:'편집 중'}));
 const calls=[],consumed=[],profiles=[];
 const hooks={useState(initial){const id=cursor++;if(!(id in states))states[id]=typeof initial==='function'?initial():initial;return[states[id],value=>states[id]=typeof value==='function'?value(states[id]):value];},useRef(initial){const id=cursor++;return states[id]??(states[id]={current:initial});},useEffect(fn){if(first){effects.push(fn);setups.push(fn);}}};
 const CategoryPicker=()=>null,exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,crypto,AbortController,fetch:async(url,init)=>{calls.push({url,init});return api.route(url,{method:init?.method??'GET',body:init?.body});},require(name){if(name==='react')return hooks;if(name==='@/app/components/category-picker')return{CategoryPicker};if(name==='@/app/components/intake-quotation-preview')return{IntakeQuotationPreview:()=>null};return name.startsWith('@/')?api.load(name.slice(2)+'.ts'):native(name);}});
 const render=()=>{cursor=0;const tree=exports.IntakeQueuePanel({rows,onRows:update=>{rows=update(rows);},sourceSeed:seed,onSourceConsumed:id=>{consumed.push(id);seed=undefined;},profiles:[],onProfile:value=>profiles.push(value),onAdvanced(){},onJobs(){},onBusy(){},goal:'price',onGoal(){},settings:api.load('app/workspace-settings.ts').defaultSettings,onSettingsReloaded(){}});first=false;effects.splice(0).forEach(fn=>cleanups.push(fn()));return tree;};
 const picker=()=>nodes(render()).find(node=>node.type===CategoryPicker);
 const button=label=>nodes(render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));
 return{api,calls,profiles,consumed,render,picker,button,get rows(){return rows;},get seed(){return seed;},setSeed(value){seed=value;},replayEffects(){cleanups.splice(0).forEach(fn=>fn?.());setups.forEach(fn=>cleanups.push(fn()));},close(){cleanups.forEach(fn=>fn?.());api.close();}};
}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`reused URL waits for a manual category and appends one draft without rewriting existing input (${company.companyCode})`,async()=>{
 const h=await fixture(company);try{
  const existing=JSON.stringify(h.rows),beforeProducts=h.api.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,originalContext=h.api.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload;
  assert.ok(h.picker());assert.equal(h.calls.length,0);assert.equal(h.rows.length,1);
  const selected=h.picker().props.onSelected;selected(h.api.context.category);selected(h.api.context.category);
  assert.equal(h.rows.length,2);assert.equal(JSON.stringify(h.rows.slice(0,1)),existing);assert.deepEqual(h.consumed,['historical-selection']);
  const row=h.rows[1];assert.equal(row.url,'https://detail.1688.com/offer/813724060928.html');assert.equal(row.profile.id,h.api.context.category.id);assert.equal(row.profile.revision,h.api.context.category.revision);
  assert.equal(row.features,'');assert.equal(row.keywords,'');assert.equal(row.status,'draft');assert.equal(row.productId,undefined);assert.equal(h.calls.length,0);
  // Use the real collection API to check the exact new category/revision/URL request.
  const request=h.api.load('app/intake-queue.ts').intakeQueueRequests([row],'price')[0];
  assert.deepEqual(JSON.parse(JSON.stringify(request.body)),{urls:[row.url],goal:'price',profileId:row.profile.id,expectedProfileRevision:row.profile.revision,features:'',keywords:''});
  const response=await h.api.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request.body)}));
  assert.equal(response.status,200,await response.clone().text());const saved=await response.json();assert.equal(saved.jobs[0].source_url,row.url);
  assert.ok(saved.preservedRequests[0].differences.includes('카테고리·견적서 설정'),'an existing request is preserved for review rather than assigned the new profile');
  assert.equal(h.api.sqlite.prepare('SELECT payload FROM collection_context WHERE job_id=?').get('job').payload,originalContext);
  // A separate synthetic identity has no pre-existing request and pins the selected profile.
  const fresh=await h.api.load('app/api/collection-jobs/route.ts').POST(new Request('https://app.test/api/collection-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...request.body,urls:['https://detail.1688.com/offer/813724060929.html']})}));
  assert.equal(fresh.status,200,await fresh.clone().text());assert.equal((await fresh.json()).jobs[0].context.category.id,row.profile.id);
  assert.equal(h.api.sqlite.prepare('SELECT COUNT(*) n FROM products').get().n,beforeProducts,'queueing does not create, complete, or edit a product');
 }finally{h.close();}
});

test('cancel/unmount rejects late seeded category callbacks, and the next ordinary category starts with an empty URL',async()=>{
 for(const action of ['cancel','unmount']){
  const h=await fixture();try{
   const selected=h.picker().props.onSelected,before=JSON.stringify(h.rows);
   if(action==='cancel'){h.button('카테고리 선택 취소').props.onClick();selected(h.api.context.category);assert.equal(JSON.stringify(h.rows),before);assert.deepEqual(h.consumed,['historical-selection']);
    h.button('＋ 상품 추가').props.onClick();h.picker().props.onSelected(h.api.context.category);assert.equal(h.rows.at(-1).url,'');
   }else{h.close();selected(h.api.context.category);assert.equal(JSON.stringify(h.rows),before);assert.deepEqual(h.consumed,[]);}
   assert.equal(h.calls.length,0);
  }finally{if(action!=='unmount')h.close();}
 }
});

test('full queue, invalid source and changed source identity preserve inputs and never submit',async()=>{
 for(const mode of ['full','invalid','changed']){
  const h=await fixture({rowCount:mode==='full'?50:1,url:mode==='invalid'?'https://example.invalid/not-a-product':'https://detail.1688.com/offer/813724060928.html'});try{
   const selected=h.picker().props.onSelected,before=JSON.stringify(h.rows);
   if(mode==='changed'){h.setSeed({id:'different',sourceUrl:'https://detail.1688.com/offer/999.html'});h.picker().props.onSelected(h.api.context.category);}else selected(h.api.context.category);
   assert.equal(JSON.stringify(h.rows),before);assert.equal(h.calls.length,0);assert.equal(h.profiles.length,0);assert.deepEqual(h.consumed,[]);
   if(mode!=='changed')assert.match(text(h.render()),mode==='full'?/최대 50행/:/1688 URL을 확인/);
  }finally{h.close();}
 }
});

test('development effect cleanup/setup preserves a pending URL category selection',async()=>{
 const h=await fixture();try{
  h.render();h.replayEffects();h.picker().props.onSelected(h.api.context.category);
  assert.equal(h.rows.length,2);assert.equal(h.rows[1].url,'https://detail.1688.com/offer/813724060928.html');assert.deepEqual(h.consumed,['historical-selection']);assert.equal(h.calls.length,0);
 }finally{h.close();}
});
