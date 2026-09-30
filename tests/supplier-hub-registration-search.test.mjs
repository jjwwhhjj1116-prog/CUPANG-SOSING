import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/registration-search.mjs',import.meta.url),'utf8').replace('export async function','async function');
function harness(options={}){
 let clicks=0,resets=0,observerCallback;const events=[],timers=new Map();
 const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const tableBody={};const table={getClientRects:()=>[{}],querySelectorAll:()=>headings.map(innerText=>({innerText})),contains:node=>node===tableBody};
 const filters=new Map(['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].map(selector=>[selector,{value:'old-filter',type:selector.endsWith('isReplyNeeded')?'checkbox':'text',checked:true,getClientRects:()=>[{}]}]));
 class Input {get value(){return this.current||'';}set value(v){this.current=v;}}
 const input=new Input();Object.assign(input,{value:options.value||'',disabled:!!options.disabled,readOnly:false,isConnected:true,getClientRects:()=>[{}],dispatchEvent:e=>{events.push(e.type);if(options.replace)input.isConnected=false;}});
 const button={innerText:'검색',isConnected:true,disabled:!!options.buttonDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{clicks++;if(options.resultMode){if(options.resultMode==='switch')input.value='other';observerCallback?.([{type:options.resultMode==='attribute'?'attributes':'childList',target:options.resultMode==='unrelated'?{}:tableBody,addedNodes:[]}]);}}};
 const label={innerText:'견적서 ID',getClientRects:()=>[{}]};
 const reset={innerText:' 재설정',disabled:!!options.resetDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{resets++;if(!options.resetFails)input.value='';if(options.resetReplaces)input.isConnected=false;for(const [key,filter]of filters){if(options.staleFilter!==key){filter.value='';filter.checked=false;}}}};
 const context=vm.createContext({HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}disconnect(){observerCallback=undefined;}},setTimeout:(callback,ms)=>{timers.set(callback,ms);return callback;},clearTimeout:callback=>timers.delete(callback),location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims',...options.location},document:{body:{},querySelectorAll(selector){if(selector==='table')return options.missingTable?[]:[table];if(filters.has(selector))return options.missingFilter===selector?[]:[filters.get(selector)];if(selector.startsWith('input'))return options.duplicate?[input,input]:[input];if(selector.startsWith('label'))return [label];return options.missingReset?[button]:[button,reset];}}});
 vm.runInContext(source,context);
 return {run:(id,wait=false)=>context.searchSupplierHubRegistration(id,wait),input,events,filters,resets:()=>resets,clicks:()=>clicks,button,timers,tick(ms){for(const [callback,duration]of [...timers])if(duration===ms){timers.delete(callback);callback();}},changed(){observerCallback?.([{type:'childList',target:tableBody,addedNodes:[]}]);}};
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
