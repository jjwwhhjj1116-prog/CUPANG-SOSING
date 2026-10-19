import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readAppCompanyRegistrations} from '../extensions/supplier-hub/company-registration.mjs';
import {querySupplierHubCompanyRegistrations} from '../extensions/supplier-hub/company-registration-page.mjs';
const plain=value=>JSON.parse(JSON.stringify(value)),companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const query={startDate:'2026-06-14',endDate:'2026-10-12',status:'전체',title:''},headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
const row=index=>({title:'합성 등록 상품 '+index,submittedAt:'2026/10/12 12:00:00',category:'합성 분류 (80719)',barcode:'바코드 없음(쿠팡 바코드 생성 요청)',sourceQuotation:'—',quotationId:'quotation-'+index,skuId:'sku-'+index,status:'상품 검수중',stage:'가격/정책 상품이 쿠팡 매입정책에 부합하는지 검수중입니다. 상품 정보 해당 검수 진행전입니다. 발주서 발행 해당 검수 진행전입니다.'});
function pageHarness(company,options={}){
 let callback,current=1,searched=false,rows=options.rows??[row(1),row(2)],clicks=0,resets=0;const timers=new Map(),events=[];
 class Input{get value(){return this.current??'';}set value(value){this.current=value;}}
 class Select extends Input{get value(){return this.current??'';}set value(value){this.current=value;}}
 const node=()=>({getClientRects:()=>[{}],disabled:false,readOnly:false,getAttribute:()=>null});
 const make=(tag,value,type='text')=>Object.assign(new(tag==='SELECT'?Select:Input),node(),{tagName:tag,value,type,checked:false,dispatchEvent:e=>{events.push([tag,e.type]);}});
 const controls=new Map(['input#productName','input#quotationFile','input#barcode','input#skuId','input#sourcingChannelId','input#isReplyNeeded','select#state','select#progress'].map(selector=>[selector,make(selector.startsWith('select')?'SELECT':'INPUT','',selector.endsWith('isReplyNeeded')?'checkbox':'text')])),dates=[make('INPUT','2026-06-12'),make('INPUT','2026-10-12')];
 const tbody={},table={...node(),contains:n=>n===tbody,querySelectorAll(selector){if(selector==='thead th')return headings.map(innerText=>({innerText}));if(selector==='tbody tr'){const shown=rows.slice((current-1)*2,current*2);return shown.map(record=>({...node(),querySelectorAll:()=>Object.entries(record).map(([name,innerText])=>({innerText,...node(),querySelectorAll(){if(name!=='quotationId'&&name!=='skuId')return [];if(options.prefixOnly)return [];return[{...node(),getAttribute:key=>key==='data-clipboard-text'?innerText:null}];}}))}));}return [];}};
 const change=()=>callback?.([{type:options.mutation==='attributes'?'attributes':'childList',target:options.mutation==='unrelated'?{}:tbody,addedNodes:[]}]);
 const buttons=[{...node(),innerText:'\uf021 재설정',click(){resets++;if(options.resetFails)return;for(const control of controls.values()){control.value='';control.checked=false;}current=1;}},{...node(),innerText:'검색',click(){clicks++;searched=true;current=1;if(options.afterSearch)options.afterSearch({controls,dates,document});if(options.mutation!=='none')change();}},{...node(),innerText:company.name}];
 const pager={...node(),querySelectorAll(selector){if(selector==='[aria-current="page"],.active')return[{...node(),innerText:String(current)}];const pageCount=Math.ceil(rows.length/2);return Array.from({length:pageCount},(_,i)=>({...node(),innerText:String(i+1),closest:()=>null,click(){current=i+1;change();}}));}};
 const document={body:{get innerText(){return 'Company Code: '+(options.companyCode??company.code)+'\n'+(searched?rows.length:1)+'개 검색됨';}},querySelectorAll(selector){if(selector==='button')return buttons;if(selector==='table')return options.missingTable?[]:[table];if(selector==='input[type="text"][placeholder="date"]')return options.missingDate?[dates[0]]:dates;if(selector==='.pagination')return rows.length>2?[pager]:[];if(controls.has(selector))return options.missingControl===selector?[]:[controls.get(selector)];return [];}};
 const context={location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims',href:'https://supplier.coupang.com/qvt/wims',...options.location},document,HTMLInputElement:Input,HTMLSelectElement:Select,Event:class{constructor(type){this.type=type;}},MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){callback=null;}},setTimeout(fn,ms){timers.set(fn,ms);return fn;},clearTimeout(fn){timers.delete(fn);},Date,URL,TextEncoder};
 return {events,timers,clicks:()=>clicks,resets:()=>resets,run:()=>vm.runInNewContext(`(${querySupplierHubCompanyRegistrations.toString()})(query,company)`,{...context,query:options.query??query,company}),async settle(pending){let done=false,value,error;pending.then(v=>{done=true;value=v;},e=>{done=true;error=e;});for(let i=0;i<100&&!done;i++){await Promise.resolve();for(const [fn,ms]of [...timers])if(ms===350){timers.delete(fn);fn();}}if(!done){for(const [fn,ms]of [...timers])if(ms===10000){timers.delete(fn);fn();}await Promise.resolve();}if(error)throw error;if(!done)throw Error('Fixture did not settle');return value;}};
}
test('serialized company query reads every fresh page for both companies and preserves full quotation/SKU IDs',async()=>{
 for(const company of companies){const h=pageHarness(company,{rows:Array.from({length:5},(_,i)=>row(i))}),result=await h.settle(h.run());assert.equal(result.total,5);assert.equal(result.pagesRead,3);assert.deepEqual(plain(result.rows),Array.from({length:5},(_,i)=>row(i)));assert.equal(result.mutated,false);assert.equal(result.scope,'queried-pages');assert.equal(h.clicks(),1);assert.equal(h.resets(),1);assert.equal(h.timers.size,0);assert.ok(h.events.some(([,type])=>type==='blur'));}
});
test('current table data, unrelated/attribute mutations and absent date controls never become fresh results',async()=>{
 for(const options of [{mutation:'none'},{mutation:'unrelated'},{mutation:'attributes'},{missingDate:true},{missingTable:true},{companyCode:'A99999999'},{location:{pathname:'/dashboard/KR'}}]){const h=pageHarness(companies[0],options);await assert.rejects(h.settle(h.run()));assert.equal(h.timers.size,0);}
});
test('changed form, status, registration date, result limits and truncated identity reject without partial observation',async()=>{
 const options=[{afterSearch:({controls})=>{controls.get('input#productName').value='다른 검색';}},{query:{...query,status:'상품 검수 완료'}},{query:{...query,title:'일치하지 않는 검색'}},{rows:[{...row(1),submittedAt:'2026/06/13 10:00:00'}]},{rows:[{...row(1),quotationId:'quote...'}],prefixOnly:true},{rows:Array.from({length:2001},(_,i)=>row(i))}];
 for(const option of options){const h=pageHarness(companies[0],option);await assert.rejects(h.settle(h.run()));assert.equal(h.timers.size,0);}
});
test('empty freshly rendered query completes honestly with zero rows',async()=>{const h=pageHarness(companies[0],{rows:[]});const result=await h.settle(h.run());assert.deepEqual(plain(result.rows),[]);assert.equal(result.total,0);assert.equal(result.pagesRead,1);});
test('a repeated issued quotation/SKU across page boundaries is rejected while unissued options remain distinct rows',async()=>{
 const duplicate=pageHarness(companies[0],{rows:[row(1),row(2),row(2),row(3)]});await assert.rejects(duplicate.settle(duplicate.run()),/중복/);assert.equal(duplicate.timers.size,0);
 const pending=pageHarness(companies[0],{rows:Array.from({length:4},(_,index)=>({...row(index),quotationId:'one-quotation',skuId:'-'}))});assert.equal((await pending.settle(pending.run())).rows.length,4);
 const h=client(),result={...h.result,rows:[row(1),row(1)],total:2,pagesRead:1};assert.throws(()=>h.api.validateCompanyRegistrationStatus(result,query,h.context),/중복/);
});
function dispatcher(company,options={}){
 const calls=[],sender={frameId:0,url:'http://localhost:3000/',tab:{id:1,windowId:7}},tabs=new Map([[1,{id:1,windowId:7,url:sender.url}],[2,{id:2,windowId:7,url:'https://supplier.coupang.com/qvt/wims'}]]);let reads=0;
 const api={tabs:{async get(id){calls.push(['get',id]);return options.changeTab?.(id)??tabs.get(id);},async query(value){calls.push(['query',value]);return options.tabs??[tabs.get(2)];},async sendMessage(id,message){calls.push(['context',id,message.type]);reads++;return options.contexts?.[reads-1]??{ok:true,ownerId:'owner',company};},async create(value){calls.push(['create',value]);const tab={id:3,status:'complete',...value};tabs.set(3,tab);return tab;},async remove(id){calls.push(['remove',id]);tabs.delete(id);}},scripting:{async executeScript({target,func,args}){calls.push(['script',target.tabId,func.name]);if(func.name==='supplierHubStatusReady')return[{result:true}];if(func.name==='verifySupplierHubCompany')return[{result:{code:options.observedCode??company.code}}];const h=pageHarness(args[1],{rows:options.rows??[row(1)],query:args[0]}),result=await h.settle(h.run());return[{result:options.result?.(result)??result}];}}};
 return{sender,calls,tabs,run:value=>readAppCompanyRegistrations({type:'YOOFAM_QUERY_COMPANY_REGISTRATIONS',query:value??query},sender,api)};
}
test('company lookup uses only this Chrome window, verifies owner/company at both ends and closes only its own background query tab',async()=>{
 for(const company of companies){const h=dispatcher(company),result=await h.run();assert.equal(result.ownerId,'owner');assert.equal(result.company.code,company.code);assert.equal(h.tabs.has(2),true);assert.equal(h.tabs.has(3),false);assert.deepEqual(h.calls.find(c=>c[0]==='create')[1],{windowId:7,url:'https://supplier.coupang.com/qvt/wims',active:false});assert.equal(h.calls.filter(c=>c[0]==='script'&&c[2]==='querySupplierHubCompanyRegistrations').length,1);assert.equal(h.calls.some(c=>c[0]==='script'&&/attach|validation|transmit/i.test(c[2])),false);}
});
test('invalid query or app frame is rejected before any Hub access',async()=>{
 for(const value of [{...query,startDate:'2026-02-30'},{...query,startDate:'2026-10-13'},{...query,title:' x'},{...query,status:'완료'},{...query,ownerId:'other'},null]){const h=dispatcher(companies[0]);await assert.rejects(h.run(value===null?{}:value));assert.equal(h.calls.length,0);}
 const h=dispatcher(companies[0]);h.sender.frameId=1;await assert.rejects(h.run());assert.equal(h.calls.length,0);
});
test('wrong company/window, changed account or result query cannot yield another company observation',async()=>{
 for(const options of [{observedCode:companies[1].code},{tabs:[{id:2,windowId:8,url:'https://supplier.coupang.com/qvt/wims'}]},{contexts:[{ok:true,ownerId:'owner',company:companies[0]},{ok:true,ownerId:'next',company:companies[0]}]},{contexts:[{ok:true,ownerId:'owner',company:companies[0]},{ok:true,ownerId:'owner',company:companies[0]},{ok:true,ownerId:'next',company:companies[0]}]},{result:r=>({...r,query:{...r.query,title:'different'}})}]){const h=dispatcher(companies[0],options);await assert.rejects(h.run());assert.equal(h.tabs.has(2),true);}
 const reordered=dispatcher(companies[0],{result:r=>({...r,query:Object.fromEntries(Object.entries(r.query).reverse())})});assert.equal((await reordered.run()).total,1);
});
function client(options={}){
 let contexts=0;const calls=[],exports={};const companyModule={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/supplier-hub-company.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:companyModule});
 const context={ownerId:'owner',company:companies[0]},result={source:'supplier-hub-company-registration-v1',scope:'queried-pages',mutated:false,...context,query,rows:[row(1)],total:1,pagesRead:1,observedAt:Date.now()};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/company-registration-status.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,AbortController,TextEncoder,fetch:async()=>{calls.push('context');return Response.json(options.contexts?.[contexts++]??context);},require(name){return name.includes('supplier-hub-company')?companyModule:{exchange:async(type,payload)=>{calls.push(type);if(type==='COMPANY_REGISTRATIONS')assert.deepEqual(plain(payload),{query});return type==='PING'?{companyRegistrationStatus:options.capability??true}:{observation:options.result?.(result)??result};}};}});return{api:exports,calls,result,context};
}
test('client query matches KST120-day default, rejects invalid fields, and ties returned results to unchanged owner/company',async()=>{
 const h=client();assert.deepEqual(plain(h.api.defaultCompanyRegistrationQuery(Date.parse('2026-10-11T16:00:00Z'))),query);assert.equal((await h.api.loadCompanyRegistrationStatus(query,new AbortController().signal)).rows[0].quotationId,'quotation-1');assert.deepEqual(h.calls,['context','PING','COMPANY_REGISTRATIONS','context']);
 for(const options of [{capability:false},{contexts:[h.context,{...h.context,ownerId:'other'}]},{result:r=>({...r,mutated:true})},{result:r=>({...r,total:2})},{result:r=>({...r,company:companies[1]})},{result:r=>({...r,rows:[{...row(1),skuId:'abc...'}]})},{result:r=>({...r,query:{...query,startDate:'2026-06-13'}})}])await assert.rejects(client(options).api.loadCompanyRegistrationStatus(query,new AbortController().signal));
 const summary=h.api.registrationStageSummary(row(1));assert.equal(summary.stage,'가격/정책');assert.match(summary.reason,/검수중/);assert.doesNotMatch(summary.reason,/진행전/);
});

test('completed review is never presented as a blocked or historical stage and does not rewrite the Hub observation',()=>{
 const h=client();
 for(const stage of [
  '가격/정책 해당 검수가 완료되었습니다. 상품 정보 해당 검수가 완료되었습니다. 발주서 발행 해당 검수 진행전입니다.',
  '가격/정책 과거 반려 사유 상품 정보 해당 검수가 완료되었습니다.',
  '',
 ]){
  const completed={...row(1),status:'상품 검수 완료',stage},before=plain(completed);
  assert.deepEqual(plain(h.api.registrationStageSummary(completed)),{stage:'검수 완료',reason:'—'});
  assert.deepEqual(completed,before);
 }
});

test('current rejection takes priority over another stage still reviewing and pending stages remain visible',()=>{
 const h=client(),rejected={...row(1),status:'상품 검수 반려',stage:'가격/정책 검수중입니다. 상품 정보 상품 이미지 사유로 반려되었습니다. 발주서 발행 해당 검수 진행전입니다.'};
 assert.deepEqual(plain(h.api.registrationStageSummary(rejected)),{stage:'상품 정보',reason:'상품 이미지 사유로 반려되었습니다.'});
 const pending={...row(1),stage:'가격/정책 해당 검수가 완료되었습니다. 상품 정보 검수중입니다. 발주서 발행 해당 검수 진행전입니다.'};
 assert.deepEqual(plain(h.api.registrationStageSummary(pending)),{stage:'상품 정보',reason:'검수중입니다.'});
 assert.deepEqual(plain(h.api.registrationStageSummary({...row(1),status:'기타',stage:'별도 안내'})),{stage:'별도 안내',reason:'—'});
});
