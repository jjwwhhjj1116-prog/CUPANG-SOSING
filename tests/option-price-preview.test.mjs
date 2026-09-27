import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const policy={exchangeRate:100,supplyMargin:0,coupangMargin:0,minimumMargin:0,msrpMultiple:1,roundingUnit:10};
const rows=[{id:'a',originalName:'3개 번들',translatedName:'',provenance:{},unitCostCny:0.1,unitsPerPack:3,included:true},{id:'b',originalName:'제외 옵션',translatedName:'',provenance:{},unitCostCny:5,unitsPerPack:1,included:false}];
function harness(fetcher){
 const slots=[],effects=[],calls=[];let index=0,closed=false,late=0;
 const hooks={useState(initial){const i=index++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{if(closed)late++;slots[i]=typeof value==='function'?value(slots[i]):value;}];},useEffect(fn,deps){const i=index++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){slots[i]?.cleanup?.();effects.push(()=>{slots[i]={deps,cleanup:fn()};});}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,fetch:(url,init)=>{calls.push({url,init});return fetcher(url,init);},require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;}
 const Component=load('app/components/option-price-preview.tsx').OptionPricePreview;
 const render=(p=policy,version='v')=>{index=0;const tree=Component({productId:'p',version,policy:p});effects.splice(0).forEach(fn=>fn());return JSON.stringify(tree);};
 render();return{render,calls,close(){closed=true;slots.forEach(v=>v?.cleanup?.());},get late(){return late;}};
}
test('option previews use decimal bundle cost, refresh policy locally and exclude unchecked rows',async()=>{
 const h=harness(async()=>Response.json({productVersion:'v',options:{productId:'p',rows}}));await settle();let text=h.render();assert.match(text,/30원/);assert.match(text,/0.3/);assert.match(text,/견적 제외/);
 text=h.render({...policy,exchangeRate:200});assert.match(text,/60원/);assert.equal(h.calls.length,1);assert.equal(h.calls[0].init.method,undefined);assert.equal(h.calls[0].init.cache,'no-store');
 assert.match(h.render({...policy,exchangeRate:NaN}),/가격 설정은 유효한 숫자/);
});
test('failed and mismatched option responses cannot display prices; changing product version hides old prices immediately',async()=>{
 for(const body of [{productVersion:'old',options:{productId:'p',rows}},{productVersion:'v',options:{productId:'other',rows}},{error:'조회 실패'}]){
  const h=harness(async()=>Response.json(body,{status:body.error?503:200}));await settle();assert.doesNotMatch(h.render(),/30원/);assert.match(h.render(),/alert/);
 }
 const h=harness(async()=>Response.json({productVersion:'v',options:{productId:'p',rows}}));await settle();assert.match(h.render(),/30원/);assert.doesNotMatch(h.render(policy,'new'),/30원/);await settle();
});
test('closing option preview aborts and ignores late reads',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const h=harness(()=>pending);h.close();assert.equal(h.calls[0].init.signal.aborted,true);resolve(Response.json({productVersion:'v',options:{productId:'p',rows}}));await settle();assert.equal(h.late,0);
});

test('observed option margins use rounded prices and preserve fractional costs with minimum toggle',async()=>{
 const observed={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'};
 const h=harness(async()=>Response.json({productVersion:'v',options:{productId:'p',rows:[{...rows[0],unitCostCny:5.23,unitsPerPack:1}]}}));
 await settle();
 const enabled=h.render(observed);
 for(const amount of ['1,830.5원','4,830원','2,999.5원','8,050원','3,220원','10,470원'])assert.ok(enabled.includes(amount),amount);
 assert.match(enabled,/62.10/);assert.match(enabled,/40.00/);
 const disabled=h.render({...observed,minimumMargin:0});
 for(const amount of ['3,660원','1,829.5원','6,100원','2,440원'])assert.ok(disabled.includes(amount),amount);
 assert.doesNotMatch(disabled,/2,999.5원/);assert.equal(h.calls.length,1);
});
