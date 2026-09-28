import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../extensions/supplier-hub/registration-search.mjs',import.meta.url),'utf8').replace('export async function','async function');
function harness(options={}){
 let clicks=0,resets=0;const events=[];
 const filters=new Map(['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].map(selector=>[selector,{value:'old-filter',type:selector.endsWith('isReplyNeeded')?'checkbox':'text',checked:true,getClientRects:()=>[{}]}]));
 class Input {get value(){return this.current||'';}set value(v){this.current=v;}}
 const input=new Input();Object.assign(input,{value:options.value||'',disabled:!!options.disabled,readOnly:false,isConnected:true,getClientRects:()=>[{}],dispatchEvent:e=>{events.push(e.type);if(options.replace)input.isConnected=false;}});
 const button={innerText:'검색',isConnected:true,disabled:!!options.buttonDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{clicks++;}};
 const label={innerText:'견적서 ID',getClientRects:()=>[{}]};
 const reset={innerText:' 재설정',disabled:!!options.resetDisabled,getClientRects:()=>[{}],getAttribute:()=>null,click:()=>{resets++;if(!options.resetFails)input.value='';if(options.resetReplaces)input.isConnected=false;for(const [key,filter]of filters){if(options.staleFilter!==key){filter.value='';filter.checked=false;}}}};
 const context=vm.createContext({HTMLInputElement:Input,Event:class{constructor(type){this.type=type;}},location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims',...options.location},document:{querySelectorAll(selector){if(filters.has(selector))return options.missingFilter===selector?[]:[filters.get(selector)];if(selector.startsWith('input'))return options.duplicate?[input,input]:[input];if(selector.startsWith('label'))return [label];return options.missingReset?[button]:[button,reset];}}});
 vm.runInContext(source,context);
 return {run:id=>context.searchSupplierHubRegistration(id),input,events,filters,resets:()=>resets,clicks:()=>clicks};
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
