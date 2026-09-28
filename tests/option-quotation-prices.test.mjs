import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const view=()=>({revision:1,inputFingerprint:'a'.repeat(64),productVersion:'v',imageKeys:[],categoryContext:{categoryId:'80719',categoryPath:['주방']},overrides:{common:{},options:{}},resolved:{schema:{fields:['supplyPrice','salePrice','msrp'].map(id=>({id,label:id,type:'number',min:1,integer:true}))},rows:[{optionId:'red',optionLabel:'빨강',included:true,fields:Object.fromEntries(['supplyPrice','salePrice','msrp'].map((id,i)=>[id,{value:String((i+1)*100),source:'pricing'}]))}]},automatic:{rows:[{optionId:'red',fields:{supplyPrice:{value:'100'},salePrice:{value:'200'},msrp:{value:'300'}}}]}});
function harness(fetcher){
 const slots=[],effects=[],calls=[];let cursor=0,saved=0,version='v',refreshToken='0',productId='p',profileId='profile';
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){const i=cursor++;if(!slots[i]||JSON.stringify(slots[i].deps)!==JSON.stringify(deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=fn());}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,structuredClone,TextEncoder,fetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init);},require(name){if(name==='react')return react;return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 const Component=load('app/components/option-quotation-prices.tsx').OptionQuotationPrices;
 const render=()=>{cursor=0;const tree=Component({productId,version,refreshToken,profileId,onSaved(){saved++;}});effects.splice(0).forEach(fn=>fn());return tree;};
 const button=text=>nodes(render()).find(n=>n.type==='button'&&n.props.children===text);
 const input=label=>nodes(render()).find(n=>n.props?.['aria-label']===label);
 render();return {render,button,input,calls,get saved(){return saved;},refresh(v){refreshToken=v;render();},setVersion(v){version=v;render();},select(p,c){productId=p;profileId=c;render();},close(){slots.forEach(s=>s?.cleanup?.());}};
}

test('stage-two direct price saves only the changed option field using the same quotation version',async()=>{
 const h=harness(async(url,init)=>Response.json(view()));await settle();
 h.input('빨강 공급가').props.onChange({target:{value:'150'}});
 const click=h.button('옵션 가격 저장').props.onClick;click();click();await settle();
 const writes=h.calls.filter(c=>c.init.method==='PUT');assert.equal(writes.length,1);
 const body=JSON.parse(writes[0].init.body);assert.deepEqual(body.changes,[{optionId:'red',fieldKey:'supplyPrice',value:'150'}]);assert.equal(body.expectedRevision,1);assert.equal(body.expectedInputFingerprint,'a'.repeat(64));assert.match(writes[0].url,/profileId=profile/);assert.equal(h.saved,1);
});

test('price conflicts preserve entered values and reload is explicit; invalid prices cannot save',async()=>{
 const h=harness(async(url,init)=>init.method==='PUT'?Response.json({error:'동시 수정'},{status:409}):Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'250'}});h.button('옵션 가격 저장').props.onClick();await settle();
 assert.equal(h.input('빨강 판매가').props.value,'250');assert.match(JSON.stringify(h.render()),/동시 수정/);assert.equal(h.saved,0);
 h.input('빨강 공급가').props.onChange({target:{value:'-1'}});assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 h.button('입력 취소·저장 가격 다시 조회').props.onClick();await settle();assert.equal(h.input('빨강 판매가').props.value,'200');
});

test('restoring an option price sends null and uses the common override before automatic calculation',async()=>{
 const initial=view();initial.overrides.common.salePrice='220';initial.resolved.rows[0].fields.salePrice.value='250';initial.overrides.options.red={salePrice:'250'};
 const h=harness(async()=>Response.json(initial));await settle();
 nodes(h.render()).filter(n=>n.type==='button'&&n.props.children==='복원')[1].props.onClick();assert.equal(h.input('빨강 판매가').props.value,'220');
 h.button('옵션 가격 저장').props.onClick();await settle();assert.equal(JSON.parse(h.calls.at(-1).init.body).changes[0].value,null);
});

test('version changes retain edits and unmount aborts an in-flight write',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const h=harness(async(url,init)=>init.method==='PUT'?pending:Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});h.setVersion('new');assert.equal(h.input('빨강 판매가').props.value,'270');assert.equal(h.calls.length,1);
 h.button('옵션 가격 저장').props.onClick();h.close();assert.equal(h.calls.at(-1).init.signal.aborted,true);finish(Response.json(view()));await settle();assert.equal(h.saved,0);
});

test('quotation saves refresh clean stage-two prices without changing product version and retain unsaved edits',async()=>{
 const latest=view();const h=harness(async()=>Response.json(latest));await settle();
 latest.resolved.rows[0].fields.salePrice.value='260';h.refresh('1');await settle();
 assert.equal(h.input('빨강 판매가').props.value,'260');assert.equal(h.calls.length,2);
 h.input('빨강 판매가').props.onChange({target:{value:'280'}});
 latest.resolved.rows[0].fields.salePrice.value='290';h.refresh('2');await settle();
 assert.equal(h.input('빨강 판매가').props.value,'280');assert.equal(h.calls.length,2);
});


test('changing category or product clears old prices even when the new lookup fails',async()=>{
 const h=harness(async(url)=>url.includes('profileId=other')?Response.json({error:'조회 실패'},{status:500}):Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});
 h.select('p','other');await settle();
 assert.equal(h.input('빨강 판매가'),undefined);assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 assert.equal(h.calls.filter(c=>c.init.method==='PUT').length,0);
 h.select('second','profile');await settle();assert.equal(h.input('빨강 판매가').props.value,'200');
 assert.match(h.calls.at(-1).url,/products\/second\//);
});

test('switching category aborts an old save and ignores its late response',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const h=harness(async(url,init)=>init.method==='PUT'?pending:Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});h.button('옵션 가격 저장').props.onClick();
 const write=h.calls.at(-1);h.select('p','other');await settle();assert.equal(write.init.signal.aborted,true);
 const stale=view();stale.resolved.rows[0].fields.salePrice.value='270';finish(Response.json(stale));await settle();
 assert.equal(h.saved,0);assert.equal(h.input('빨강 판매가').props.value,'200');
});
