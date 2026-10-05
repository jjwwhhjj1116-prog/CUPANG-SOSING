import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const product={id:'p1',title:'상품',source_url:'https://example.com/product',updated_at:'v1'};
const profile=(id='a',revision=1,categoryId='80719')=>({id,revision,categoryId,name:id,categoryPath:['주방'],template:null,mappings:[]});
function harness(){
 const slots=[],effects=[],calls=[];let cursor=0,pending=[];
 let props={products:[product],profiles:[profile(),profile('b')],onEdit(){}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((value,n)=>!Object.is(value,effects[i].deps[n])))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,AbortController,fetch:(url,init)=>new Promise(resolve=>calls.push({url,signal:init.signal,resolve})),require(name){if(name==='react')return hooks;if(name==='@/app/components/submission-package')return{SubmissionPackage:'package'};if(name==='@/app/components/quotation-review-issues')return{QuotationReviewIssues:'issues'};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 const Component=load('app/components/submission-review-panel.tsx').SubmissionReviewPanel;
 function render(changes={}){props={...props,...changes};cursor=0;pending=[];const tree=Component(props);pending.forEach(fn=>fn());return tree;}
 function respond(index,categoryId='80719'){const call=calls[index],url=new URL(call.url,'https://example.com');call.resolve(Response.json({productId:'p1',requestedProfileId:url.searchParams.get('profileId'),title:'상품',sourceUrl:product.source_url,categoryId,categoryPath:['주방'],checkedAt:'2026-09-28T00:00:00Z',fingerprint:'a'.repeat(64),submissionReady:false,transport:'not-connected',includedOptions:1,errorCount:0,reviewCount:0,omittedIssueCount:0,issues:[],limits:[]}));}
 return{render,respond,calls,select(id){nodes(render()).find(node=>node.type==='select').props.onChange({target:{value:id}});return render();}};
}
const packages=tree=>nodes(tree).filter(node=>node.type==='package');

test('single-product preparation keeps the exact requested profile even when it is no longer listed',async()=>{
 for(const initialProfileId of ['b','missing']){
  const h=harness();h.render({initialProfileId});assert.equal(h.calls.length,1);
  assert.equal(new URL(h.calls[0].url,'https://example.com').searchParams.get('profileId'),initialProfileId);
  assert.equal(nodes(h.render()).find(node=>node.type==='select').props.value,initialProfileId);
  h.respond(0);await settle();assert.equal(packages(h.render())[0].props.profileId,initialProfileId);
 }
});

test('automatic category review invalidates the prepared package when a saved workbook revision changes',async()=>{
 const h=harness();h.render();h.respond(0);await settle();const before=packages(h.render())[0];assert.ok(before);
 const tree=h.render({profiles:[profile('a',2),profile('b')]});assert.equal(packages(tree).length,0);assert.equal(h.calls.length,2);assert.equal(h.calls[0].signal.aborted,true);
 h.respond(1);await settle();assert.notEqual(packages(h.render())[0].key,before.key);
});

test('late old-category responses cannot restore a package after the category code changes',async()=>{
 const h=harness();h.render();h.render({profiles:[profile('a',2,'999'),profile('b')]});
 h.respond(0);await settle();assert.equal(packages(h.render()).length,0);
 h.respond(1,'999');await settle();assert.equal(packages(h.render())[0].props.categoryId,'999');
});

test('explicit category ignores unrelated profile changes but invalidates on its removal',async()=>{
 const h=harness();h.render();h.select('a');h.respond(1);await settle();assert.equal(packages(h.render()).length,1);
 h.render({profiles:[profile('b',2),profile()]});assert.equal(h.calls.length,2);
 assert.equal(packages(h.render({profiles:[profile('b',2)]})).length,0);assert.equal(h.calls.length,3);assert.match(h.calls[2].url,/profileId=a/);
});

test('product save invalidates review; equivalent reordered profile lists do not restart requests',async()=>{
 const h=harness();h.render();h.respond(0);await settle();h.render({profiles:[profile('b'),profile()]});assert.equal(h.calls.length,1);
 assert.equal(packages(h.render({products:[{...product,updated_at:'v2'}]})).length,0);assert.equal(h.calls.length,2);
});
