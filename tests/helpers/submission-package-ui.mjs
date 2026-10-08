import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {prepareAttachments} from '../../extensions/supplier-hub/package.mjs';
import {verifyAppQuotationSource} from '../../extensions/supplier-hub/source-check.mjs';

const native=createRequire(import.meta.url);
const origin='https://sourceflow.jjwwhhjj1116.workers.dev';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

/** Actual component, API, ZIP parser and source verifier. The final Hub transport
 * is captured locally: these tests never upload synthetic data to Supplier Hub. */
export function submissionPackageUI({route,productId,profileId='cat',categoryId='80719',observations=[],lookupResults=[],requestTimeoutMs=5000}){
 const slots=[],modules=new Map(),calls=[],savedSubmissions=new Map();let cursor=0;
 const submissionKey=identity=>JSON.stringify([identity.productId,identity.categoryId,identity.fingerprint]);
 const fetcher=async(path,init)=>{const body=init?.body?JSON.parse(init.body):undefined;calls.push({action:body?.action??'receipt-read'});return route(path,{method:init?.method??'GET',body});};
 const content={window:{addEventListener(){}},location:{origin},chrome:{runtime:{id:'extension',onMessage:{addListener(){}}}},URL,Date,AbortController,setTimeout,clearTimeout,
  fetch:async(path,init)=>{const response=await fetcher(path,init);Object.defineProperty(response,'url',{value:origin+path});return response;}};
 vm.runInNewContext(fs.readFileSync(new URL('../../extensions/supplier-hub/handoff-content.js',import.meta.url),'utf8'),content);
 const api={tabs:{get:async()=>({id:7,windowId:17,url:origin+'/'}),sendMessage:async(_id,message)=>content.verifyCurrentQuotationSource(message.expected)}};
 async function connect(action,blob,identity,agreements){
  const files=await prepareAttachments(new Uint8Array(await blob.arrayBuffer()));
  await verifyAppQuotationSource({...identity,origin},files,{appTabId:7,windowId:17},api);
  if(action==='transmit')savedSubmissions.set(submissionKey(identity),{attempt:{state:'validation-requested',company:files.company,includedOptions:files.includedOptions,startedAt:Date.now(),registered:false},result:null});
  calls.push({action,files,agreements});return {state:'validation-requested',registered:false};
 }
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=typeof value==='function'?value(slots[i]):value];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(){cursor++;}};
 let lookupError=false;
 const bridge={getSupplierHubProductHistory:async identity=>({records:[],blocked:[...savedSubmissions].some(([key,value])=>JSON.parse(key)[0]===identity.productId&&Boolean(value.attempt||value.result))}),
  getSupplierHubSubmission:async identity=>{calls.push({action:'chrome-recover'});return savedSubmissions.get(submissionKey(identity))||{attempt:null,result:null};},
  getSupplierHubResult:async(identity,_signal,mode)=>{calls.push({action:'lookup',mode});if(lookupError)throw Error('SKU 조회 응답 유실');return lookupResults.length?lookupResults.shift():savedSubmissions.get(submissionKey(identity))?.result??null;},
  checkSupplierHubExtension:async()=>{},prepareSupplierHubHandoff:(blob,identity)=>connect('prepare',blob,identity),
  transmitSupplierHubPackage:(blob,identity,agreements)=>connect('transmit',blob,identity,agreements)};
 function load(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,AbortController,URL,TextEncoder,setTimeout,fetch:fetcher,require(name){
    if(name==='react')return hooks;if(name==='@/app/supplier-hub-handoff')return bridge;
    if(name==='@/app/supplier-hub-tracking')return observations.length?trackingBridge:{followSupplierHubRegistration:async()=>({phase:'validation-pending',timedOut:true,registered:false})};
    if(name==='@/app/components/quotation-review-issues')return {QuotationReviewIssues:'issues'};
    if(name==='@/app/components/legal-documents-editor')return {LegalDocumentsEditor:'legal-documents'};
    if(name==='@/app/components/historical-supplier-hub-result')return {HistoricalSupplierHubResult:'historical-result'};
    return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
   }});return exports;
 }
 bridge.validateSupplierHubResultForSource=load('app/supplier-hub-handoff.ts').validateSupplierHubResultForSource;
 bridge.SupplierHubResultInvalid=load('app/supplier-hub-handoff.ts').SupplierHubResultInvalid;
 bridge.SupplierHubLookupUnavailable=load('app/supplier-hub-handoff.ts').SupplierHubLookupUnavailable;
 bridge.supplierHubRegistrationEvidence=load('app/supplier-hub-handoff.ts').supplierHubRegistrationEvidence;
 bridge.validateRegistrationResult=load('app/supplier-hub-handoff.ts').validateRegistrationResult;
 const tracker=load('app/supplier-hub-tracking.ts');let observationIndex=0;
 const trackingBridge={...tracker,followSupplierHubRegistration:(source,options)=>tracker.followSupplierHubRegistration(source,{...options,
  read:async(identity,_signal,mode)=>{calls.push({action:'lookup',mode});if(lookupError)throw Error('SKU 조회 응답 유실');const result=observations[Math.min(observationIndex++,observations.length-1)];const saved=savedSubmissions.get(submissionKey(identity));if(saved)savedSubmissions.set(submissionKey(identity),{...saved,result});return result;},maxDurationMs:1000,wait:async()=>{}})};
 const Component=load('app/components/submission-package.tsx').SubmissionPackage;
 const render=()=>{cursor=0;return Component({productId,profileId,categoryId,onInspect(){}});};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&node.props.children===label);
 async function click(label){
  const target=button(label);if(!target||target.props.disabled)throw Error('Button unavailable: '+label);target.props.onClick();
  const deadline=Date.now()+requestTimeoutMs;while(render().props['aria-busy']){if(Date.now()>deadline)throw Error('UI request timeout');await new Promise(resolve=>setTimeout(resolve,1));}
 }
 return {calls,button,click,render,remount(){slots.length=0;},setLookupError(value){lookupError=value;},choose(){for(const input of nodes(render()).filter(node=>node.type==='input'))input.props.onChange({target:{checked:true}});},
  alerts:()=>nodes(render()).filter(node=>node.props?.role==='alert').map(node=>node.props.children)};
}
