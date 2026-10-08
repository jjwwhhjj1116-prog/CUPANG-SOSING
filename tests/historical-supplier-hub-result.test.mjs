import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[],settle=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));};
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}],fingerprint='a'.repeat(64);
function harness(company,{hold=false,postFailure=false}={}){
 const original={schemaVersion:1,evidence:'chrome-observation',profileId:'original-profile',categoryId:'69900',fingerprint,productVersion:'2026-10-01T00:00:00.000Z',recordedAt:'2026-10-01T00:00:01.000Z',result:{filename:`YOOFAM-${fingerprint}.xlsx`,company,includedOptions:6,state:'validation-pending',registered:false,observedAt:Date.now()}};
 const slots=[],calls=[];let cursor=0,resume,saved=0,cleanup;
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(effect){const i=cursor++;if(!(i in slots)){slots[i]=true;cleanup=effect();}}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/historical-supplier-hub-result.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,fetch:async(url,init)=>{calls.push({action:'post',url,body:JSON.parse(init.body)});return Response.json(postFailure?{error:'보관 응답 유실'}:{saved:true,fingerprint},{status:postFailure?503:200});},require(name){if(name==='react')return hooks;if(name==='@/app/supplier-hub-handoff')return {getHistoricalSupplierHubResult:async(productId,receipt,signal,registration)=>{calls.push({action:'read',productId,receipt:structuredClone(receipt),signal,registration});if(hold)await new Promise(resolve=>resume=resolve);return {...receipt.result,state:'validation-complete',quotationId:'original-full-id',observedAt:Date.now(),...(registration?{registration:{quotationId:'original-full-id',scope:'visible-page',includedOptions:6,registered:false,observedAt:Date.now(),rows:Array.from({length:6},(_,i)=>({title:'원래 옵션 '+i,skuId:'sku-'+i,status:'검수 중',stage:'상품 확인'}))}}:{})};}};return require(name);}});
 const render=()=>{cursor=0;return exports.HistoricalSupplierHubResult({productId:'product',receipt:original,onSaved(){saved++;}});},button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
 return {calls,original,render,button,release(){hold=false;resume?.();},allowStore(){postFailure=false;},unmount(){cleanup?.();},get saved(){return saved;}};
}
for(const company of companies)test(`old A lookup stores original metadata and exposes all six original SKUs while draft B remains unchanged (${company.code})`,async()=>{
 const h=harness(company),before=JSON.stringify(h.original),draftB={title:'수정한 B 상품명',price:'',fingerprint:'b'.repeat(64),version:'2026-10-07T00:00:00.000Z'},unchanged=structuredClone(draftB);
 h.button('원래 견적서 검증 결과 조회').props.onClick();await settle();assert.equal(h.saved,1);
 h.button('원래 견적서 상품별 상태 조회').props.onClick();await settle();assert.equal(h.saved,2);
 const reads=h.calls.filter(call=>call.action==='read');assert.deepEqual(reads.map(call=>call.registration),[false,true]);assert.ok(reads.every(call=>call.productId==='product'&&call.receipt.fingerprint===fingerprint&&call.receipt.profileId==='original-profile'));
 const posts=h.calls.filter(call=>call.action==='post');assert.equal(posts.length,2);for(const {body} of posts){assert.equal(body.action,'observe-history');assert.equal(body.fingerprint,fingerprint);assert.equal(body.profileId,'original-profile');assert.equal(body.categoryId,'69900');assert.equal(body.result.company.code,company.code);assert.equal(body.result.includedOptions,6);assert.equal(body.result.quotationId,'original-full-id');}
 assert.equal(nodes(h.render()).filter(node=>node.type==='tbody').flatMap(node=>nodes(node).filter(child=>child.type==='tr')).length,6);assert.equal(JSON.stringify(h.original),before);assert.deepEqual(draftB,unchanged);
 assert.ok(h.calls.every(call=>['read','post'].includes(call.action)));assert.equal(posts[1].body.result.registration.rows.length,6);
});
test('duplicate clicks and unmount during historical lookup cannot send a second query or record a stale reply',async()=>{
 const h=harness(companies[0],{hold:true}),old=h.button('원래 견적서 검증 결과 조회');old.props.onClick();old.props.onClick();assert.equal(h.calls.length,1);assert.equal(h.render().props['aria-busy'],true);
 h.unmount();assert.equal(h.calls[0].signal.aborted,true);h.release();await settle();assert.equal(h.calls.length,1);assert.equal(h.saved,0);
});
test('a historical save acknowledgement failure preserves the Chrome result for explicit read-only retry',async()=>{
 const h=harness(companies[0],{postFailure:true});h.button('원래 견적서 검증 결과 조회').props.onClick();await settle();assert.equal(h.saved,0);assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'));assert.equal(h.button('원래 견적서 상품별 상태 조회').props.disabled,false);
 h.allowStore();h.button('원래 견적서 검증 결과 조회').props.onClick();await settle();assert.equal(h.saved,1);assert.equal(h.calls.filter(call=>call.action==='read').length,2);assert.equal(h.calls.filter(call=>call.action==='post').length,2);assert.ok(h.calls.every(call=>call.action!=='post'||call.body.fingerprint===fingerprint));
});
