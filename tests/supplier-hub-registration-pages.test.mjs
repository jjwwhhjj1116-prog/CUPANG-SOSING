import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {collectSupplierHubRegistrationPages} from '../extensions/supplier-hub/registration-pages.mjs';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';

const company={code:'A01464742',name:'와이홉'},id='quote-123';
const row=skuId=>({title:'상품',submittedAt:'date',category:'cat',barcode:'',sourceQuotation:'file.xlsx',skuId,status:'상품 검수중',stage:'가격/정책'});
const page=(current,hasNext,skus)=>{const rows=skus.map(row);return {quotationId:id,scope:'visible-page',registered:false,rows,page:{current,hasNext,signature:JSON.stringify(rows)}};};
function collect(pages,includedOptions=4,options={}){
 let index=0;const calls=[];
 return {calls,run:()=>collectSupplierHubRegistrationPages(id,includedOptions,{
  check:async()=>{calls.push('check');await options.check?.(calls);},now:options.now??(()=>0),
  read:async()=>{calls.push('read');return pages[index++];},
  advance:async previous=>{calls.push(['advance',previous.current]);return pages[index++];},
 })};
}

test('all pages are read in order with guards on both sides of every operation, without changing approval',async()=>{
 const h=collect([page(1,true,['sku-1','sku-2']),page(2,false,['sku-3','sku-4'])]);
 const result=await h.run();assert.deepEqual(result.rows.map(row=>row.skuId),['sku-1','sku-2','sku-3','sku-4']);
 assert.equal(result.scope,'queried-pages');assert.equal(result.pagesRead,2);assert.equal(result.hasMore,false);assert.equal(result.registered,false);
 assert.deepEqual(h.calls,['check','read','check','check',['advance',1],'check']);
});

test('matching the expected count does not hide an extra row on the next page',async()=>{
 const h=collect([page(1,true,['1','2','3','4']),page(2,false,['5'])]);
 await assert.rejects(h.run(),/옵션 수보다 많/);assert.ok(h.calls.some(value=>Array.isArray(value)&&value[0]==='advance'));
 const duplicate=collect([page(1,true,['1','2']),page(2,false,['2','3'])]);await assert.rejects(duplicate.run(),/중복/);
 const pending=collect([page(1,true,['','']),page(2,false,['',''])]);assert.equal((await pending.run()).rows.length,4,'unissued rows are retained, not merged');
});

test('unknown pagination and bounded partial scans report their actual coverage',async()=>{
 const unsupported=collect([page(null,null,['1'])]);const first=await unsupported.run();assert.equal(first.scope,'visible-page');assert.equal(unsupported.calls.length,3);
 const unknown=await collect([page(1,null,['1'])]).run();assert.equal(unknown.scope,'queried-pages');assert.equal(unknown.hasMore,null);
 let ticks=0;const bounded=collect([page(1,true,['1','2'])],4,{now:()=>ticks++?60000:0});
 const partial=await bounded.run();assert.equal(partial.hasMore,true);assert.equal(partial.pagesRead,1);assert.equal(partial.rows.length,2);
});

test('changed IDs, skipped pages, malformed coverage and changed company never yield partial saved success',async()=>{
 for(const pages of [[page(2,false,['1'])],[page(1,true,['1']),page(3,false,['2'])],
  [{...page(1,false,['1']),quotationId:'other'}],[{...page(1,false,['1']),page:{current:1,hasNext:false,signature:'old'}}],
  [{...page(1,false,['1']),page:{current:1,hasNext:'false',signature:JSON.stringify([row('1')])}}]])await assert.rejects(collect(pages).run());
 const h=collect([page(1,true,['1']),page(2,false,['2'])],4,{check:calls=>{if(calls.length===6)throw Error('company changed');}});
 await assert.rejects(h.run(),/company changed/);
});

// Accessible pagination variants are synthetic UI contracts, not a live Hub capture.
function rendered(options={}){
 let current=1,skus=['sku-1'],clicks=0,observerCallback;const timers=new Map();
 const body={innerText:'Company Code: A01464742'},input={value:id,getClientRects:()=>[{}]};
 const filters=new Map(['input#productName','input#barcode','input#skuId','input#sourcingChannelId','select#state','select#progress','input#isReplyNeeded'].map(key=>[key,{value:'',checked:false,type:key.endsWith('isReplyNeeded')?'checkbox':'text',getClientRects:()=>[{}]}]));
 const headings=['상품명','상품 등록일','카테고리','바코드','원본 견적서','견적서 ID','SKU ID','상태','등록 진행 단계'];
 const cell=innerText=>({innerText,querySelectorAll:()=>[]});
 const tableBody={};
 let table={getClientRects:()=>[{}],contains:node=>node===tableBody,querySelectorAll:selector=>selector==='thead th'?headings.map(cell):skus.map(sku=>({getClientRects:()=>[{}],querySelectorAll:()=>['상품','date','cat','','file.xlsx',id,sku,'상품 검수중','가격/정책'].map(cell)}))};
 const control=(text,disabled=false,href=null)=>({innerText:text,disabled,getClientRects:()=>[{}],getAttribute:name=>name==='href'?href:null,closest:()=>null,click(){
  clicks++;if(options.noMove)return;
  current+=options.skip?2:1;skus=['sku-2'];
  if(options.changeCompany)body.innerText='Company Code: A01526306';
  if(options.closeCompanyMenu)body.innerText='';
  if(options.changeFilter)filters.get('input#productName').value='other';
  if(options.changeId)input.value='other';
  if(options.replaceTable){table={...table,matches:selector=>selector==='table'};observerCallback?.([{type:'childList',target:{},addedNodes:[table]}]);}
  else observerCallback?.([{type:'childList',target:options.unrelated?{}:tableBody,addedNodes:[]}]);
 }});
 const pager={getClientRects:()=>[{}],matches:()=>true,getAttribute:()=>null,contains:()=>false,querySelectorAll:selector=>{
  if(selector.startsWith('[aria-current'))return [{innerText:String(current),getClientRects:()=>[{}]}];
  if(options.numeric)return [control(String(current+1),false,options.href??'#')];
  const next=control('다음 페이지',options.disabled||current===2,options.href??null);return options.duplicateNext?[next,next]:[next];
 }};
 const context=vm.createContext({URL,Error,Set,location:{origin:'https://supplier.coupang.com',pathname:'/qvt/wims',href:'https://supplier.coupang.com/qvt/wims'},
  document:{body,querySelectorAll:selector=>selector==='table'?[table]:selector.startsWith('input[id=')?[input]:filters.has(selector)?[filters.get(selector)]:selector==='button'?[control(options.changedName?'유앤채':'와이홉')]:selector.startsWith('.pagination')?options.noPager?[]:options.duplicatePager?[pager,pager]:[pager]:[]},
  MutationObserver:class{constructor(callback){observerCallback=callback;}observe(){}disconnect(){observerCallback=undefined;}},
  setTimeout:(callback,ms)=>{timers.set(callback,ms);return callback;},clearTimeout:callback=>timers.delete(callback)});
 const read=request=>vm.runInContext(`(${readSupplierHubRegistration.toString()})(id,request)`,Object.assign(context,{id,request}));
 return {read,clicks:()=>clicks,timers,tick:ms=>{for(const [callback,duration]of [...timers])if(duration===ms){timers.delete(callback);callback();}}};
}

test('rendered numbered and labelled successors wait for the actual table and next page',async()=>{
 for(const options of [{},{numeric:true},{closeCompanyMenu:true}]){
  const h=rendered(options),first=h.read({company});assert.equal(first.page.current,1);assert.equal(first.page.hasNext,true);
  const pending=h.read({company,advanceFrom:first.page});assert.equal(h.clicks(),1);h.tick(350);
  const second=await pending;assert.equal(second.page.current,2);assert.equal(second.rows[0].skuId,'sku-2');assert.equal(h.timers.size,0);
 }
 const last=rendered({disabled:true});assert.equal(last.read({company}).page.hasNext,false);assert.equal(last.clicks(),0);
});

test('no unique pager stays read-only; stale snapshot, ambiguous next and external links never click',()=>{
 for(const options of [{noPager:true},{duplicatePager:true}]){
  const h=rendered(options),snapshot=h.read({company});assert.equal(snapshot.page.current,null);assert.equal(snapshot.page.hasNext,null);
  assert.throws(()=>h.read({company,advanceFrom:snapshot.page}));assert.equal(h.clicks(),0);
 }
 const ambiguous=rendered({duplicateNext:true});assert.throws(()=>ambiguous.read({company}),/중복/);
 const changed=rendered();const before=changed.read({company});assert.throws(()=>changed.read({company,advanceFrom:{...before.page,signature:'old'}}),/변경/);assert.equal(changed.clicks(),0);
 for(const href of ['https://evil.test/','/qvt/registration','javascript:void(0)']){
  const h=rendered({href});assert.throws(()=>h.read({company,advanceFrom:h.read({company}).page}),/페이지 이동/);assert.equal(h.clicks(),0);
 }
});

test('replacing the whole table on a page change is observed before the new rows are accepted',async()=>{
 const h=rendered({replaceTable:true}),before=h.read({company});
 const pending=h.read({company,advanceFrom:before.page});h.tick(350);
 const result=await pending;assert.equal(result.page.current,2);assert.equal(result.rows[0].skuId,'sku-2');assert.equal(h.timers.size,0);
});

test('moving page, company, ID or filters during rendering rejects and releases observation',async()=>{
 for(const options of [{skip:true},{changeCompany:true},{changeId:true},{changeFilter:true},{closeCompanyMenu:true,changedName:true}]){
  const h=rendered(options),before=h.read({company});const pending=h.read({company,advanceFrom:before.page});h.tick(350);
  await assert.rejects(pending);assert.equal(h.timers.size,0);assert.equal(h.clicks(),1);
 }
 for(const options of [{noMove:true},{unrelated:true}]){
  const h=rendered(options),before=h.read({company});const pending=h.read({company,advanceFrom:before.page});h.tick(350);h.tick(8000);
  await assert.rejects(pending,/갱신/);assert.equal(h.timers.size,0);
 }
});
