import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {refreshSupplierHubRegistration} from '../extensions/supplier-hub/app-registration.mjs';
import {searchSupplierHubRegistration} from '../extensions/supplier-hub/registration-search.mjs';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/registration-search.mjs',import.meta.url),'utf8').replace('export async function','async function');
function harness(options={}){
 let clicks=0,resets=0,observerCallback,resultRows=options.initialRows??[];const events=[],timers=new Map();
 const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const tableBody={};let table={getClientRects:()=>[{}],querySelectorAll:selector=>selector==='thead th'?headings.map(innerText=>({innerText})):resultRows.map(cells=>({getClientRects:()=>[{}],querySelectorAll:()=>cells.map(innerText=>({innerText,querySelectorAll:()=>[]}))})),querySelector:()=>null,contains:node=>node===tableBody};
 const filters=new Map(['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].map(selector=>[selector,{value:'old-filter',type:selector.endsWith('isReplyNeeded')?'checkbox':'text',checked:true,getClientRects:()=>[{}]}]));
 class Input {get value(){return this.current||'';}set value(v){this.current=v;}}
 const input=new Input();Object.assign(input,{value:options.value||'',disabled:!!options.disabled,readOnly:false,isConnected:true,getClientRects:()=>[{}],dispatchEvent:e=>{events.push(e.type);if(options.replace)input.isConnected=false;}});
 const button={innerText:'검색',isConnected:true,disabled:!!options.buttonDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{clicks++;if(options.resultMode){if(options.resultMode==='switch')input.value='other';
  if(['replace-table','replace-wrapper','unrelated-table','unrelated-wrapper'].includes(options.resultMode)){const replacement={...table};if(options.resultMode.startsWith('replace-')){table=replacement;resultRows=options.resultRows??[];}
   const added=options.resultMode.endsWith('wrapper')?{querySelector:selector=>selector==='table'?replacement:null,contains:node=>node===replacement}:replacement;
   observerCallback?.([{type:'childList',target:{},addedNodes:[added]}]);}
  else observerCallback?.([{type:options.resultMode==='attribute'?'attributes':'childList',target:options.resultMode==='unrelated'?{}:tableBody,addedNodes:[]}]);}}};
 const label={innerText:'견적서 ID',getClientRects:()=>[{}]};
 const reset={innerText:' 재설정',disabled:!!options.resetDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{resets++;if(!options.resetFails)input.value='';if(options.resetReplaces)input.isConnected=false;for(const [key,filter]of filters){if(options.staleFilter!==key){filter.value='';filter.checked=false;}}}};
 const context=vm.createContext({HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}disconnect(){observerCallback=undefined;}},setTimeout:(callback,ms)=>{timers.set(callback,ms);return callback;},clearTimeout:callback=>timers.delete(callback),location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims',...options.location},document:{body:{innerText:'Company Code: '+(options.companyCode??'A01464742')},querySelectorAll(selector){if(selector==='table')return options.missingTable?[]:[table];if(selector.startsWith('.pagination'))return [];if(filters.has(selector))return options.missingFilter===selector?[]:[filters.get(selector)];if(selector.startsWith('input'))return options.duplicate?[input,input]:[input];if(selector.startsWith('label'))return [label];return options.missingReset?[button]:[button,reset];}}});
 vm.runInContext(source,context);
 return {run:(id,wait=false)=>context.searchSupplierHubRegistration(id,wait),script:(func,args=[])=>vm.runInContext(`(${func.toString()})(...args)`,Object.assign(context,{args})),input,events,filters,resets:()=>resets,clicks:()=>clicks,button,timers,tick(ms){for(const [callback,duration]of [...timers])if(duration===ms){timers.delete(callback);callback();}},changed(){observerCallback?.([{type:'childList',target:tableBody,addedNodes:[]}]);}};
}
test('exact validated quotation ID is entered with native events before one search',async()=>{
 for(const value of ['', 'quote-123']){const h=harness({value});const result=await h.run('quote-123');assert.equal(h.input.value,'quote-123');assert.deepEqual(h.events,['input','change']);assert.equal(h.clicks(),1);assert.equal(result.registered,false);assert.equal(result.state,'search-requested');}
});
test('existing different search, duplicate controls, disabled or wrong page do not click',async()=>{
 for(const opts of [{value:'other'},{duplicate:true},{disabled:true},{buttonDisabled:true},{location:{pathname:'/qvt/registration'}},{location:{origin:'https://example.com'}}]){const h=harness(opts);await assert.rejects(h.run('quote-123'));assert.equal(h.clicks(),0);assert.equal(h.events.length,0);}
 for(const id of ['', ' x', null, 'x'.repeat(201)]){const h=harness();await assert.rejects(h.run(id));assert.equal(h.clicks(),0);}
});
test('a form replaced by input events is not searched',async()=>{const h=harness({replace:true});await assert.rejects(h.run('quote-123'),/양식이 변경/);assert.equal(h.clicks(),0);});

test('Hub reset clears previous filters before the exact quotation search',async()=>{
 const h=harness({value:'quote-123'});await h.run('quote-123');
 assert.equal(h.resets(),1);assert.equal(h.clicks(),1);
 for(const filter of h.filters.values()){assert.equal(filter.value,'');assert.equal(filter.checked,false);}
});

test('missing reset, unfinished reset and stale filters never issue a misleading search',async()=>{
 for(const opts of [{missingReset:true},{resetDisabled:true},{resetFails:true,value:'quote-123'},{resetReplaces:true},
  ...['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].flatMap(staleFilter=>[{staleFilter},{missingFilter:staleFilter}])]){
  const h=harness(opts);await assert.rejects(h.run('quote-123'));assert.equal(h.clicks(),0);assert.equal(h.events.length,0);
 }
 const h=harness({value:'other'});await assert.rejects(h.run('quote-123'));assert.equal(h.resets(),0);
});

test('app status lookup waits for rendered result rows rather than the search click or unrelated mutations',async()=>{
 const settle=async()=>{for(let i=0;i<4;i++)await Promise.resolve();};
 const h=harness({resultMode:'changed'});const pending=h.run('quote-123',true);await settle();
 assert.equal(h.clicks(),1);assert.equal(h.timers.size,2);h.tick(350);assert.equal((await pending).state,'search-complete');assert.equal(h.timers.size,0);
 for(const resultMode of [undefined,'unrelated','attribute']){const bad=harness({resultMode});const request=bad.run('quote-123',true);await settle();bad.tick(350);bad.tick(8000);await assert.rejects(request,/갱신/);assert.equal(bad.timers.size,0);}
 const switched=harness({resultMode:'switch'});const request=switched.run('quote-123',true);await settle();switched.tick(350);await assert.rejects(request,/변경/);assert.equal(switched.timers.size,0);
 const missing=harness({missingTable:true});await assert.rejects(missing.run('quote-123',true),/결과 표/);assert.equal(missing.clicks(),0);
});

test('result rendering cannot finish while the search button remains disabled',async()=>{
 const h=harness({resultMode:'changed'});const request=h.run('quote-123',true);for(let i=0;i<4;i++)await Promise.resolve();
 h.button.disabled=true;h.tick(350);assert.equal(h.timers.size,1);h.button.disabled=false;h.changed();h.tick(350);assert.equal((await request).state,'search-complete');assert.equal(h.timers.size,0);
});

test('replacing the matching result table completes exact-ID search without mistaking an unrelated table for results',async()=>{
 for(const resultMode of ['replace-table','replace-wrapper','unrelated-table','unrelated-wrapper']){
  const h=harness({resultMode}),pending=h.run('quote-123',true);for(let i=0;i<4;i++)await Promise.resolve();
  h.tick(350);h.tick(8000);
  if(resultMode.startsWith('replace-'))assert.equal((await pending).state,'search-complete');else await assert.rejects(pending,/갱신/);
  assert.equal(h.clicks(),1);assert.equal(h.input.value,'quote-123');assert.equal(h.timers.size,0);
 }
});

test('an unrelated table wrapper leaves the lookup pending until the real result table changes',async()=>{
 const h=harness({resultMode:'unrelated-wrapper'});let completed=false;
 const pending=h.run('quote-123',true).then(result=>{completed=true;return result;});
 for(let i=0;i<4;i++)await Promise.resolve();h.tick(350);await Promise.resolve();
 assert.equal(completed,false);assert.deepEqual([...h.timers.values()],[8000]);
 h.changed();h.tick(350);assert.equal((await pending).state,'search-complete');assert.equal(h.timers.size,0);
});

test('app status recovery reads only freshly rendered SKU rows after a serialized replacement without replaying attachments',async()=>{
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])for(const resultMode of ['replace-table','replace-wrapper','unrelated-wrapper']){
  const identity={origin:'http://localhost:3000',productId:'p',categoryId:'80719',fingerprint:'a'.repeat(64)},quotationId='quote-123';
  const saved={...identity,company,includedOptions:3,filename:`YOOFAM-${identity.fingerprint}.xlsx`,quotationId,state:'validation-complete',observedAt:Date.now()-10000,registered:false};
  const key=`result:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`,original={...identity,company,includedOptions:3},records=new Map([[key,saved],['attempt:123',original]]);
  const rows=Array.from({length:3},(_,index)=>['상품 '+index,'2026-10-03','합성 폼','','file.xlsx',quotationId,'sku-'+index,'상품 검수중','가격/정책']);
  const oldRows=rows.map(row=>row.map((value,index)=>index===6?'old-'+value:value));
  const h=harness({companyCode:company.code,resultMode,resultRows:rows,initialRows:oldRows}),scripts=[],tabs=[{id:123,windowId:17,url:'https://supplier.coupang.com/qvt/registration',status:'complete'}];
  const store=async(action,name,value)=>{if(action==='put')records.set(name,value);return records.get(name);};
  const api={tabs:{query:async()=>tabs,get:async id=>tabs.find(tab=>tab.id===id),create:async value=>{const tab={id:124,status:'complete',...value};tabs.push(tab);return tab;}},scripting:{executeScript:async({func,args})=>{
   scripts.push(func.name);const result=h.script(func,args);
   if(func===searchSupplierHubRegistration){for(let i=0;i<4;i++)await Promise.resolve();h.tick(350);h.tick(8000);}
   return [{result:await result}];
  }}};
  const pending=refreshSupplierHubRegistration({...identity,type:'YOOFAM_REFRESH_REGISTRATION'},{frameId:0,url:identity.origin+'/',tab:{id:7,windowId:17}},api,store);
  if(resultMode==='unrelated-wrapper'){
   await assert.rejects(pending,/갱신/);assert.equal(scripts.includes('readSupplierHubRegistration'),false);assert.equal(records.get(key),saved);assert.equal(h.timers.size,0);continue;
  }
  const result=await pending;
  assert.deepEqual(Array.from(result.registration.rows,row=>row.skuId),['sku-0','sku-1','sku-2']);assert.equal(result.registration.includedOptions,3);assert.equal(result.quotationId,quotationId);assert.equal(result.registered,false);
  assert.equal(result.observedAt,saved.observedAt);assert.ok(result.registration.observedAt>saved.observedAt);assert.equal(h.clicks(),1);assert.equal(h.timers.size,0);
  assert.equal(tabs.length,2);assert.equal(tabs[1].windowId,17);assert.equal(tabs[1].active,false);assert.deepEqual(records.get('attempt:123'),original);
  assert.equal(scripts.some(name=>/attach|requestSupplierHubValidation/.test(name)),false);assert.equal(records.has(`transmission:${identity.origin}:${identity.productId}:${identity.categoryId}:${identity.fingerprint}`),false);
 }
});
