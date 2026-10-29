import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {intakeOwnerScopeHarness,intakeScopeCompanies} from './helpers/intake-owner-scope.mjs';
import {reviewSourceFixture,sourceReviewModule} from './helpers/source-review-intake.mjs';

const componentSource=fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8');
const nodes=value=>Array.isArray(value)?value.flatMap(nodes):value&&typeof value==='object'?[value,...nodes(value.props?.children)]:[];
const picker=h=>nodes(h.render()).find(node=>node.type?.name==='CategoryPicker');
const entryId='d8045000-0000-4000-8000-000000000001';
function withEntry(entry){
 // Supply the real public props at the existing isolated parent boundary. The
 // inline callback is deliberately recreated on every render, as in Dashboard.
 return componentSource.replace('initialCategorySelection,onInitialCategorySelectionConsumed,',
  'initialCategorySelection='+JSON.stringify(entry)+',onInitialCategorySelectionConsumed=()=>onRows(previous=>previous),');
}

for(const company of intakeScopeCompanies){
 const other=intakeScopeCompanies.find(value=>value!==company);
 test(company.code+': category-first entry opens once, preserves manual rows and needs an explicit start',async()=>{
  const h=intakeOwnerScopeHarness(company,{componentSource:withEntry({id:entryId,ownerId:company.owner})});
  try{
   const original=JSON.stringify(h.rows),first=picker(h);assert.ok(first);assert.equal(first.props.sourceTitle,undefined);
   await h.settle();assert.equal(h.rowsPublished.length,1,'changing the inline consumer cannot consume the entry twice');assert.equal(JSON.stringify(h.rows),original);
   first.props.onSelected(h.profile);first.props.onSelected(h.profile);await h.settle();
   assert.equal(h.rows.length,2);assert.equal(JSON.stringify(h.rows.slice(0,1)),original);assert.equal(h.rows[1].url,'');assert.equal(picker(h),undefined);
   assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);assert.equal(h.profilesPublished.length,1);
   const input=nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='2번째 1688 링크');
   input.props.onChange({target:{value:'https://detail.1688.com/offer/647000000002.html'}});await h.settle();
   assert.equal(h.rows[1].url,'https://detail.1688.com/offer/647000000002.html');assert.equal(picker(h),undefined);
   h.button('＋ 상품 추가').props.onClick();assert.ok(picker(h),'the existing manual add action remains usable');
   assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);
  }finally{h.close();}
 });
 test(company.code+': cancellation and owner A/B/A invalidate the category entry without re-opening it',async()=>{
  for(const mode of ['cancel','owner']){
   const h=intakeOwnerScopeHarness(company,{rowCount:0,componentSource:withEntry({id:entryId,ownerId:company.owner})});
   try{
    const old=picker(h);assert.ok(old);
    if(mode==='cancel')h.button('취소 · 상품 대기열로 돌아가기').props.onClick();
    else{h.switchOwner(other.owner);h.switchOwner(company.owner);}
    const before=JSON.stringify(h.rows);old.props.onSelected(h.profile);await h.settle();
    assert.equal(JSON.stringify(h.rows),before);assert.equal(picker(h),undefined);assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);
    h.button('＋ 상품 추가').props.onClick();assert.ok(picker(h));
   }finally{h.close();}
  }
 });
 test(company.code+': advanced category editing consumes the entry and stale completion cannot add a row',async()=>{
  const h=intakeOwnerScopeHarness(company,{rowCount:0,componentSource:withEntry({id:entryId,ownerId:company.owner})});
  try{
   const old=picker(h);old.props.onAdvanced({categoryId:h.profile.categoryId,categoryPath:h.profile.categoryPath});await h.settle();
   assert.equal(picker(h),undefined);old.props.onSelected(h.profile);await h.settle();assert.equal(h.rows.length,0);assert.equal(h.rowsPublished.length,1);
   assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);
  }finally{h.close();}
 });
 test(company.code+': capture-first seed wins over category entry and retains its immutable capture',async()=>{
  const {saved}=reviewSourceFixture(company.owner,company),capture=sourceReviewModule('app/source-capture-selection.ts').sourceCaptureSelection(saved);
  const seed={id:'capture-entry',sourceUrl:saved.snapshot.sourceUrl,title:saved.reviewed.title,sourceCapture:capture};
  const h=intakeOwnerScopeHarness(company,{rowCount:0,sourceSeed:seed,componentSource:withEntry({id:entryId,ownerId:company.owner})});
  try{
   const selected=picker(h);assert.equal(selected.props.sourceTitle,seed.title);selected.props.onSelected(h.profile);await h.settle();
   assert.equal(h.rows.length,1);assert.equal(h.rows[0].url,seed.sourceUrl);assert.deepEqual(JSON.parse(JSON.stringify(h.rows[0].sourceCapture)),JSON.parse(JSON.stringify(capture)));
   assert.equal(h.rowsPublished.length,1,'capture selection adds one row without consuming the independent category entry');assert.deepEqual(h.consumed,[seed.id]);
   assert.equal(picker(h),undefined);assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);
  }finally{h.close();}
 });
}

for(const entry of [{id:entryId,ownerId:'other-owner'},{id:'not-an-entry',ownerId:intakeScopeCompanies[0].owner}])test('untrusted category entry cannot open or change the queue: '+JSON.stringify(entry),()=>{
 const h=intakeOwnerScopeHarness(intakeScopeCompanies[0],{rowCount:0,componentSource:withEntry(entry)});
 try{assert.equal(picker(h),undefined);assert.equal(h.rows.length,0);assert.equal(h.rowsPublished.length,0);h.button('＋ 상품 추가').props.onClick();assert.ok(picker(h));assert.equal(h.posts.length,0);}finally{h.close();}
});

test('category-first entry reaches the existing collection request only after explicit start',async()=>{
 const company=intakeScopeCompanies[0],h=intakeOwnerScopeHarness(company,{rowCount:0,componentSource:withEntry({id:entryId,ownerId:company.owner})});
 try{
  picker(h).props.onSelected(h.profile);await h.settle();
  const url='https://detail.1688.com/offer/647000000003.html';nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']==='1번째 1688 링크').props.onChange({target:{value:url}});await h.settle();
  assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);h.button('시작 (1건)').props.onClick();await h.settle();
  assert.equal(h.posts.length,1);assert.equal(h.posts[0].url,'/api/collection-jobs');assert.equal(h.posts[0].body.urls[0],url);assert.equal(h.posts[0].body.profileId,h.profile.id);assert.equal(h.posts[0].body.goal,'work');assert.equal(h.collections.length,1);
 }finally{h.close();}
});
