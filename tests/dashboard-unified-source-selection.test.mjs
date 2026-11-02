import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {reviewSourceFixture,sourceReviewModule} from './helpers/source-review-intake.mjs';

// Execute the actual parent and board with local state and synthetic GETs only.
const fixtureUrl=new URL('./dashboard-account-actions.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(statement=>ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement)).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
const {harness,nodes,text}=vm.runInNewContext(declarations+'\n({harness,nodes,text})',{assert,fs,vm,ts,createRequire,reviewSourceFixture,URL,Response,Request,File,Blob,FormData,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,crypto,structuredClone,setImmediate,setTimeout,clearTimeout});
const company={code:'A01526306',name:'유앤채'},otherCompany={code:'A01464742',name:'와이홉'};
const sourceItem=()=>reviewSourceFixture('test-owner',company).saved;
const checkbox=(h,item)=>nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===sourceReviewModule('app/source-inbox-title.ts').sourceInboxDisplayTitle(item)+' 선택');
async function setup({items,products=true}={}){
 const item=items?.[0]??sourceItem(),state={items:items??[item],reload(){},acceptReviewed(){return false;}},h=harness({sourceRegistrationsState:state,realRegistrationBoard:true});
 if(!products)h.products.splice(0);await h.settle();
 nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='전체 작업').props.onChange({target:{checked:false}});
 nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='가격 작업').props.onChange({target:{checked:true}});await h.settle();
 return{h,item,state};
}
const queryItem=()=>({id:'33333333-3333-4333-8333-333333333333',ownerId:'test-owner',company,fingerprint:'c'.repeat(64),revision:1,captureVersion:2,receivedAt:'2026-11-02T00:00:00.000Z',archivedAt:null,sourceUrl:'https://detail.1688.com/offer/700000000799.html',offerId:'700000000799',title:'URL로 보관한 원문 상품',optionCount:2,thumbnailUrl:'https://cbu01.alicdn.com/synthetic-main.jpg'});

test('a stored URL capture shares the main board and selected category-to-work continuation without pretending to be a page capture',async()=>{
 const query=queryItem(),state={items:[],queryItems:[query],reload(){},acceptReviewed(){return false;}},h=harness({sourceRegistrationsState:state,realRegistrationBoard:true});try{
  h.products.splice(0);await h.settle();assert.match(text(h.render()),/URL로 보관한 원문 상품/);
  const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===query.title+' 선택');assert.ok(checkbox);assert.equal(checkbox.props.disabled,false);
  nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='전체 작업').props.onChange({target:{checked:false}});
  nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='가격 작업').props.onChange({target:{checked:true}});await h.settle();
  await h.click('최근 상품 전체 선택');await h.click('작업 개시');const queue=h.component('intake-queue-panel');assert.ok(queue);assert.equal(queue.autoStartSource,true);
  assert.equal(queue.sourceSeed.sourceCapture.format,'yoofam-saved-query-capture-v1');assert.equal(queue.sourceSeed.sourceCapture.captureId,query.id);assert.equal(queue.sourceSeed.title,query.title);
  const created={id:'new-query-product',owner_id:'test-owner',source_url:query.sourceUrl,title:query.title,updated_at:'2026-11-02T00:00:01.000Z',created_at:query.receivedAt,image_keys:'[]',options_count:2};
  h.setProductReply(()=>Response.json({product:created}));await queue.onOpenProduct(created.id,new AbortController().signal);await h.settle();
  assert.deepEqual(Array.from(h.component('batch-work-panel').products,value=>value.id),[created.id]);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('query main-board rows keep exact version/company guards and existing-product duplicate protection',async()=>{
 for(const mode of ['version','company','existing-product']){
  const query=queryItem(),state={items:[],queryItems:[query],reload(){},acceptReviewed(){return false;}},h=harness({sourceRegistrationsState:state,realRegistrationBoard:true});try{
   if(mode==='existing-product')h.products[0].source_url=query.sourceUrl;else h.products.splice(0);await h.settle();await h.click('최근 상품 전체 선택');
   assert.equal(nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===query.title+' 선택').props.checked,true);
   if(mode==='version')state.queryItems=[{...query,revision:2}];
   if(mode==='company'){h.setSettingsBody({settings:{},scope:{ownerId:'test-owner',company:otherCompany}});await h.click('새로고침');}
   await h.settle();await h.click('작업 개시');assert.equal(h.component('intake-queue-panel'),undefined,mode);assert.equal(h.component('batch-work-panel'),undefined,mode);assert.ok(h.requests.every(call=>call.method==='GET'));
  }finally{h.close();}
 }
});

test('mixed page and query selections keep distinct immutable seeds and run only after both fresh product reads',async()=>{
 const page=sourceItem(),query=queryItem(),state={items:[page],queryItems:[query],reload(){},acceptReviewed(){return false;}},h=harness({sourceRegistrationsState:state,realRegistrationBoard:true});try{
  h.products.splice(0);await h.settle();
  nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='전체 작업').props.onChange({target:{checked:false}});
  nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='가격 작업').props.onChange({target:{checked:true}});await h.settle();
  const formats=[];await h.click('최근 상품 전체 선택');await h.click('작업 개시');
  for(let index=0;index<2;index++){
   const queue=h.component('intake-queue-panel');assert.ok(queue);formats.push(queue.sourceSeed.sourceCapture.format);assert.equal(h.component('batch-work-panel'),undefined);
   const product={id:'fresh-mixed-'+index,owner_id:'test-owner',source_url:queue.sourceSeed.sourceUrl,title:queue.sourceSeed.title,updated_at:'2026-11-02T00:00:01.000Z',created_at:'2026-11-02T00:00:01.000Z',image_keys:'[]',options_count:1};
   h.setProductReply(()=>Response.json({product}));await queue.onOpenProduct(product.id,new AbortController().signal);await h.settle();
  }
  assert.deepEqual(new Set(formats),new Set(['yoofam-saved-query-capture-v1','yoofam-saved-page-capture-v1']));
  assert.deepEqual(Array.from(h.component('batch-work-panel').products,value=>value.id),['fresh-mixed-0','fresh-mixed-1']);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('top select-all includes captured sources when no working product exists and starts exact category review',async()=>{
 const {h,item}=await setup({products:false});try{
  await h.click('최근 상품 전체 선택');assert.equal(checkbox(h,item).props.checked,true);await h.click('작업 개시');
  const queue=h.component('intake-queue-panel');assert.ok(queue);assert.equal(queue.autoStartSource,true);assert.equal(queue.sourceSeed.sourceCapture.captureId,item.id);
  assert.doesNotMatch(text(h.render()),/작업할 상품을 선택해주세요/);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('top clear-selection clears both product and board-owned source selections before work start',async()=>{
 const {h,item}=await setup();try{
  await h.click('최근 상품 전체 선택');checkbox(h,item).props.onChange({target:{checked:true}});await h.settle();await h.click('선택 해제');
  assert.equal(h.component('registration-board').selected.size,0);assert.equal(checkbox(h,item).props.checked,false);await h.click('작업 개시');
  assert.equal(h.component('intake-queue-panel'),undefined);assert.match(text(h.render()),/작업할 상품을 선택해주세요/);assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});

test('top select-all keeps current-owner company eligibility and a company change resets source selection',async()=>{
 const item=sourceItem(),foreign={...sourceItem(),id:'22222222-2222-4222-8222-222222222222',company:otherCompany,reviewed:{...item.reviewed,title:'다른 회사 수집본'}};
 const {h}=await setup({items:[item,foreign]});try{
  await h.click('최근 상품 전체 선택');assert.equal(h.component('registration-board').selected.size,h.products.length);
  assert.equal(checkbox(h,item).props.checked,true);assert.equal(checkbox(h,foreign).props.checked,false);assert.equal(checkbox(h,foreign).props.disabled,true);
  h.setSettingsBody({settings:{},scope:{ownerId:'test-owner',company:otherCompany}});await h.click('새로고침');
  assert.equal(checkbox(h,item).props.checked,false);assert.equal(checkbox(h,item).props.disabled,true);assert.equal(checkbox(h,foreign).props.checked,false);
  assert.ok(h.requests.every(call=>call.method==='GET'));
 }finally{h.close();}
});
