import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const settle=async()=>{for(let index=0;index<8;index++)await new Promise(resolve=>setImmediate(resolve));};
const fingerprint='a'.repeat(64);
function harness({conflict=false,uncertain=false}={}){
 const slots=[],calls=[];let cursor=0;
 const preview={fingerprint,filename:`YOOFAM-${fingerprint}.xlsx`,headers:['상품명'],rows:[['상품']],report:{company:{code:'A01464742',name:'와이홉'},productId:'p',categoryId:'80719',profileId:'profile',rowCount:1,warnings:[],submissionReady:false},submissionReview:{productId:'p',categoryId:'80719',inputFingerprint:fingerprint,submissionReady:false,transport:'not-connected',errorCount:0,reviewCount:0,omittedIssueCount:0,issues:[]}};
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(){cursor++;}};
 const bridge={checkSupplierHubExtension:async(_signal,direct)=>calls.push(['check',direct]),transmitSupplierHubPackage:async(blob,identity,reviewed)=>{calls.push(['transmit',identity,reviewed,await blob.text()]);if(uncertain)throw Error('응답 확인 불가');return {state:'validation-requested',registered:false};},getSupplierHubResult:async(identity,_signal,refresh)=>{calls.push(['result',identity,refresh]);return {state:'validation-pending',filename:preview.filename,observedAt:Date.now(),registered:false};}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,URL,setTimeout,fetch:async(url,init)=>{
   const body=JSON.parse(init.body);calls.push(['fetch',url,body]);
   if(body.action==='preview')return Response.json(preview);
   if(conflict)return Response.json({error:'저장값이 변경되었습니다.'},{status:409});
   return new Response('ZIP bytes',{headers:{'content-type':'application/zip'}});
 },require(name){if(name==='react')return hooks;if(name==='@/app/supplier-hub-handoff')return bridge;if(name==='@/app/components/quotation-review-issues')return {QuotationReviewIssues:'issues'};return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 const Component=load('app/components/submission-package.tsx').SubmissionPackage;
 const render=()=>{cursor=0;return Component({productId:'p',profileId:'profile',categoryId:'80719',onInspect(){}});};
 const button=text=>nodes(render()).find(node=>node.type==='button'&&node.props.children===text);
 return {render,calls,button,choose(){for(const input of nodes(render()).filter(node=>node.type==='input'))input.props.onChange({target:{checked:true}});}};
}

test('reviewed registration sends the current export and choices, refreshes evidence and disables repeat transmission',async()=>{
 const h=harness();await h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();
 assert.equal(h.button('등록 전송').props.disabled,true);h.choose();assert.equal(h.button('등록 전송').props.disabled,false);
 h.button('등록 전송').props.onClick();await settle();
 const transmitted=h.calls.find(([name])=>name==='transmit');assert.deepEqual(JSON.parse(JSON.stringify(transmitted[1])),{productId:'p',categoryId:'80719',fingerprint});
 assert.deepEqual(JSON.parse(JSON.stringify(transmitted[2])),{priceData:true,labelBusinessContact:true,legalDocumentsNotApplicable:true});assert.equal(transmitted[3],'ZIP bytes');
 assert.equal(h.calls.find(([name])=>name==='result')[2],true);assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
 const exportRequest=h.calls.find(([name,,body])=>name==='fetch'&&body.action==='export');assert.equal(exportRequest[2].fingerprint,fingerprint);
 h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);
});

test('changed saved data never reaches Chrome; uncertain acknowledgement leaves transmission disabled',async()=>{
 for(const option of [{conflict:true},{uncertain:true}]){
   const h=harness(option);h.button('견적서 + 첨부 파일 준비').props.onClick();await settle();h.choose();h.button('등록 전송').props.onClick();await settle();
   if(option.conflict){assert.equal(h.calls.some(([name])=>name==='transmit'),false);assert.equal(h.button('등록 전송'),undefined);}
   else {assert.equal(h.calls.filter(([name])=>name==='transmit').length,1);assert.equal(h.button('전송 시도됨 · 검증 결과 확인').props.disabled,true);assert.equal(h.calls.some(([name])=>name==='result'),false);}
 }
});
