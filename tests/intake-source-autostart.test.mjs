import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {reviewSourceFixture,sourceReviewModule} from './helpers/source-review-intake.mjs';

// Reuse the real panel/submit fixture with the two new public props wired. Its
// existing contract tests retain their original explicit-start defaults.
const helperUrl=new URL('./helpers/intake-owner-scope.mjs',import.meta.url);
let helper=fs.readFileSync(helperUrl,'utf8').replaceAll('import.meta.url',JSON.stringify(helperUrl.href));
helper=helper.replace('sourceSeed,rowCount=1}={})','sourceSeed,rowCount=1,autoStartSource=false}={})')
 .replace('seed=sourceSeed;','seed=sourceSeed,sourceItemsOverride;')
 .replace('sourceSeed:seed,onSourceConsumed','sourceSeed:seed,autoStartSource,sourceItems:sourceItemsOverride??(seed?.sourceItem?[seed.sourceItem]:[]),onSourceConsumed')
 .replace('setSeed(value){seed=value;render();}','setSourceItems(value){sourceItemsOverride=value;render();},setSeed(value){seed=value;render();}')
 .replace("goal:'work',onGoal(){}","goal:autoStartSource?'collect':'work',onGoal(){}");
const exports={};vm.runInNewContext(ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
 {exports,require:createRequire(helperUrl),URL,URLSearchParams,Response,Request,Headers,File,Blob,FormData,AbortController,AbortSignal,TextEncoder,TextDecoder,structuredClone,crypto,queueMicrotask,setTimeout,clearTimeout,setImmediate});
const {intakeOwnerScopeHarness:harness,intakeScopeCompanies:companies}=exports;
const plain=value=>JSON.parse(JSON.stringify(value)),nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const picker=h=>nodes(h.render()).find(node=>typeof node.type==='function'&&node.type.name==='CategoryPicker');
function seed(company,index=1){
 const {saved}=reviewSourceFixture(company.owner,company),id='76400000-0000-4000-8000-'+String(index).padStart(12,'0');
 saved.id=id;saved.snapshot.sourceUrl='https://detail.1688.com/offer/'+String(764000000000+index)+'.html';saved.snapshot.offerId=String(764000000000+index);saved.reviewed.sourceUrl=saved.snapshot.sourceUrl;saved.reviewed.offerId=saved.snapshot.offerId;
 return{id:'76400000-0000-4000-8001-'+String(index).padStart(12,'0'),sourceUrl:saved.snapshot.sourceUrl,title:saved.reviewed.title,sourceCapture:sourceReviewModule('app/source-capture-selection.ts').sourceCaptureSelection(saved),sourceItem:saved};
}
async function finish(h,index,id){const work=h.collections[index];assert.ok(work);work.callbacks.onJob({...work.job,product_id:id});work.resolve('수집 초안 완료');await h.settle();}

for(const company of companies)test(`source category confirmation starts exactly one collect request with its exact capture and category (${company.code})`,async()=>{
 const selected=seed(company),h=harness(company,{sourceSeed:selected,rowCount:0,autoStartSource:true});try{
  await h.settle();assert.equal(h.posts.length,0);const choose=picker(h).props.onSelected;choose(h.profile);choose(h.profile);await h.settle();
  assert.equal(h.posts.length,1);assert.equal(h.collections.length,1);assert.equal(h.rows.length,1);assert.equal(h.posts[0].body.goal,'collect');assert.equal(h.posts[0].body.profileId,h.profile.id);assert.equal(h.posts[0].body.expectedProfileRevision,h.profile.revision);assert.deepEqual(plain(h.posts[0].body.urls),[selected.sourceUrl]);assert.deepEqual(plain(h.collections[0].callbacks.selectedCapture),plain(selected.sourceCapture));
  await finish(h,0,'new-captured-product');assert.equal(h.opened.length,1);assert.equal(h.opened[0].id,'new-captured-product');assert.equal(h.posts.length,1);assert.equal(h.rows[0].status,'saved');
 }finally{h.close();}
});

test('a second source seed opens a new category session on the same mounted panel and submits once per source',async()=>{
 const company=companies[0],h=harness(company,{sourceSeed:seed(company),rowCount:0,autoStartSource:true});try{
  await h.settle();picker(h).props.onSelected(h.profile);await h.settle();await finish(h,0,'new-first');assert.equal(h.posts.length,1);
  const next=seed(company,2);h.setSeed(next);await h.settle();assert.ok(picker(h),'second source must open its own category picker');const choose=picker(h).props.onSelected;choose(h.profile);choose(h.profile);await h.settle();assert.equal(h.posts.length,2);assert.equal(h.rows.length,2);assert.equal(h.posts[1].body.urls[0],next.sourceUrl);await finish(h,1,'new-second');assert.deepEqual(plain(h.opened.map(value=>value.id)),['new-first','new-second']);assert.equal(h.posts.length,2);
 }finally{h.close();}
});

test('an exact already queued capture reuses its row after category confirmation and preserves manual guidance',async()=>{
 const company=companies[0],selected={...seed(company),targetRowId:'stable-row'},h=harness(company,{sourceSeed:selected,autoStartSource:true});try{
  const row={...h.rows[0],url:selected.sourceUrl,sourceCapture:selected.sourceCapture,features:'직접 특징 유지',keywords:'직접 검색어 유지'};h.setRows([row]);await h.settle();picker(h).props.onSelected(h.profile);await h.settle();
  assert.equal(h.posts.length,1);assert.equal(h.rows.length,1);assert.equal(h.rows[0].id,row.id);assert.equal(h.posts[0].body.features,row.features);assert.equal(h.posts[0].body.keywords,row.keywords);await finish(h,0,'new-queued-capture');assert.equal(h.opened.length,1);
 }finally{h.close();}
});

test('category cancel or owner change fences retained confirmation callbacks before any collection request',async()=>{
 for(const mode of ['cancel','owner']){const company=companies[0],h=harness(company,{sourceSeed:seed(company),rowCount:0,autoStartSource:true});try{
  await h.settle();const choose=picker(h).props.onSelected;if(mode==='cancel')h.button('취소 · 상품 대기열').props.onClick();else h.switchOwner(companies[1].owner);const before=JSON.stringify(h.rows);choose(h.profile);await h.settle();assert.equal(h.posts.length,0,mode);assert.equal(h.collections.length,0,mode);assert.equal(JSON.stringify(h.rows),before,mode);
 }finally{h.close();}}
});

test('autostart waits for the category row commit instead of sending an old or missing queue snapshot',async()=>{
 const company=companies[0],h=harness(company,{sourceSeed:seed(company),rowCount:0,autoStartSource:true,deferRows:true});try{
  await h.settle();picker(h).props.onSelected(h.profile);await h.settle();assert.equal(h.posts.length,0);assert.equal(h.rows.length,0);assert.ok(h.flushRows()>0);await h.settle();assert.equal(h.posts.length,1);assert.equal(h.collections.length,1);await finish(h,0,'deferred-row-product');h.flushRows();await h.settle();assert.equal(h.posts.length,1);
 }finally{h.close();}
});

function pendingTitleSeed(company){
 const value=seed(company),item=value.sourceItem;item.snapshot.title='便携旅行收纳包';item.reviewed.title=item.snapshot.title;value.title=item.snapshot.title;
 item.titlePreparation={format:'yoofam-collected-title-v1',fingerprint:item.fingerprint,revision:item.revision,sourceTitle:item.snapshot.title,state:'running',translatedTitle:null,brand:company.name,attempts:1,retryable:false,message:'한국어 제목 준비 중'};
 return value;
}
function completedTitleItem(value){return {...value.sourceItem,titlePreparation:{...value.sourceItem.titlePreparation,state:'completed',translatedTitle:'휴대용 여행 수납 가방',message:'한국어 제목 준비 완료'}};}

test('a late title sidecar updates only the exact selected category source without recreating or submitting its seed',async()=>{
 const company=companies[0],selected=pendingTitleSeed(company),h=harness(company,{sourceSeed:selected,rowCount:0,autoStartSource:true});try{
  await h.settle();const first=picker(h).props,sourceBefore=JSON.stringify(selected.sourceItem),captureBefore=JSON.stringify(selected.sourceCapture);
  assert.equal(first.sourceTitle,selected.title);assert.equal(h.posts.length,0);
  const completed=completedTitleItem(selected);h.setSourceItems([completed]);await h.settle();const updated=picker(h).props;
  assert.equal(updated.sourceTitle,company.name+' 휴대용 여행 수납 가방');assert.equal(updated.sourceScope,first.sourceScope);assert.equal(JSON.stringify(selected.sourceItem),sourceBefore);assert.equal(JSON.stringify(selected.sourceCapture),captureBefore);assert.equal(h.posts.length,0);assert.equal(h.rows.length,0);
  const wrongRevision={...completed,revision:completed.revision+1},wrongOwner={...completed,ownerId:companies[1].owner},otherCapture={...completed,id:'76400000-0000-4000-8000-000000000099'};
  for(const item of [wrongRevision,wrongOwner,otherCapture]){h.setSourceItems([item]);await h.settle();assert.equal(picker(h).props.sourceTitle,selected.title,'another owner/capture/revision cannot replace the pinned title');assert.equal(h.posts.length,0);}
  h.setSourceItems([completed]);await h.settle();picker(h).props.onSelected(h.profile);await h.settle();assert.equal(h.posts.length,1);assert.deepEqual(plain(h.collections[0].callbacks.selectedCapture),plain(selected.sourceCapture));assert.equal(h.posts[0].body.urls[0],selected.sourceUrl);await finish(h,0,'late-title-product');
 }finally{h.close();}
});

test('queued-row category source uses its current exact title sidecar and keeps the row inputs unchanged',async()=>{
 const company=companies[0],selected=pendingTitleSeed(company),h=harness(company);try{
  const row={...h.rows[0],url:selected.sourceUrl,sourceCapture:selected.sourceCapture};h.setRows([row]);h.setSourceItems([completedTitleItem(selected)]);await h.settle();
  const before=JSON.stringify(h.rows),category=nodes(h.render()).find(node=>node.type==='button'&&node.props.className==='intake-category-button');category.props.onClick();await h.settle();
  assert.equal(picker(h).props.sourceTitle,company.name+' 휴대용 여행 수납 가방');assert.ok(picker(h).props.sourceScope.includes(row.id));assert.equal(JSON.stringify(h.rows),before);assert.equal(h.posts.length,0);
  h.setSourceItems([{...completedTitleItem(selected),revision:selected.sourceCapture.revision+1}]);await h.settle();assert.equal(picker(h).props.sourceTitle,undefined,'a newer capture revision is not the queued row selection');assert.equal(JSON.stringify(h.rows),before);
 }finally{h.close();}
});
