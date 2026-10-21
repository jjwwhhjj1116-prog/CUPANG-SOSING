import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {intakeOwnerScopeHarness,intakeScopeCompanies} from './helpers/intake-owner-scope.mjs';

const sourceUrl='https://detail.1688.com/offer/770000000002.html';
const capture={sourceUrl,format:'yoofam-saved-page-capture-v1',captureId:'77000000-0000-4000-8000-000000000002',fingerprint:'a'.repeat(64),revision:3};
const plain=value=>JSON.parse(JSON.stringify(value));
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
function fixture(company,options={}){
 const item={id:capture.captureId,ownerId:company.owner,fingerprint:capture.fingerprint,revision:capture.revision,snapshot:{sourceUrl,title:'합성 수집 상품'},issues:[]};
 const source=fs.readFileSync(new URL('../app/components/intake-queue-panel.tsx',import.meta.url),'utf8').replace('sourceItems=[]','sourceItems='+JSON.stringify(options.items??[item]));
 const h=intakeOwnerScopeHarness(company,{...options,componentSource:source});
 if(!options.sourceSeed)h.setRows([{...h.rows[0],url:'잘못된 이전 URL',message:'이전 입력 보관'},
  {...h.newRow(),id:'collected-row',url:sourceUrl,sourceCapture:{...capture},profile:{...h.profile,revision:7,categoryId:'81452',categoryPath:['합성 선택 카테고리']},features:'새 수집 상품 특징',keywords:'새 상품 키워드'}]);
 return h;
}
async function complete(h,id='only-new-product'){
 const collection=h.collections[0];assert.ok(collection);
 collection.callbacks.onJob({...collection.job,product_id:id});collection.resolve('새 상품 초안 저장됨');await h.settle();
}

for(const company of intakeScopeCompanies){
 test(`${company.code}: collected-row action starts only that capture and opens only its confirmed new draft`,async()=>{
  const h=fixture(company);try{
   const previous=JSON.stringify(h.rows[0]),selected=plain(h.rows[1]);
   assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);assert.equal(h.opened.length,0);
   assert.equal(h.button('전체 시작 (2건)').props.disabled,false);
   // An explicit item action is independent of the retained batch checkbox.
   nodes(h.render()).find(node=>node.props?.['aria-label']==='2번째 상품 선택').props.onChange({target:{checked:false}});
   assert.ok(h.button('선택 시작 (1건)'));
   h.button('이 상품 초안 작성').props.onClick();await h.settle();
   assert.equal(h.posts.length,1);assert.equal(h.posts[0].owner,company.owner);
   assert.deepEqual(h.posts[0].body.urls,[sourceUrl]);assert.equal(h.posts[0].body.profileId,selected.profile.id);
   assert.equal(h.posts[0].body.expectedProfileRevision,7);assert.equal(h.posts[0].body.features,selected.features);assert.equal(h.posts[0].body.keywords,selected.keywords);
   assert.equal(h.posts[0].body.expectedSettings.brand,company.name);assert.equal(h.posts[0].body.goal,'work');
   assert.equal(h.collections.length,1);assert.deepEqual(plain(h.collections[0].callbacks.selectedCapture),capture);
   assert.equal(Object.isFrozen(h.collections[0].callbacks.selectedCapture),true);assert.equal(h.collections[0].job.owner_id,company.owner);
   await complete(h);assert.equal(h.rows[1].status,'saved');assert.equal(h.rows[1].productId,'only-new-product');
   assert.equal(JSON.stringify(h.rows[0]),previous);assert.deepEqual(h.opened.map(value=>value.id),['only-new-product']);
   assert.equal(h.opened[0].owner,company.owner);assert.deepEqual(h.busy.map(value=>value.value),[true,false]);
   assert.equal(text(h.render()).includes('이 상품 초안 작성'),false);
  }finally{h.close();}
 });

 test(`${company.code}: category confirmation appends a collected row without starting work or replacing old input`,()=>{
  const h=fixture(company,{sourceSeed:{id:'selected-capture',sourceUrl,title:'합성 수집 상품',sourceCapture:capture}});try{
   const previous=JSON.stringify(h.rows),picker=nodes(h.render()).find(node=>node.type?.name==='CategoryPicker');
   assert.ok(picker);picker.props.onSelected(h.profile);h.render();
   assert.equal(h.rows.length,2);assert.equal(JSON.stringify(h.rows.slice(0,1)),previous);
   assert.deepEqual(plain(h.rows[1].sourceCapture),capture);assert.ok(h.button('이 상품 초안 작성'));
   assert.equal(h.posts.length,0);assert.equal(h.collections.length,0);assert.equal(h.opened.length,0);
  }finally{h.close();}
 });

 test(`${company.code}: older incomplete selected capture blocks the unchanged batch but cannot block the explicit new item`,async()=>{
  const oldUrl='https://detail.1688.com/offer/770000000001.html',old={...capture,sourceUrl:oldUrl,captureId:'77000000-0000-4000-8000-000000000001',fingerprint:'b'.repeat(64),revision:1};
  const items=[{id:old.captureId,ownerId:company.owner,fingerprint:old.fingerprint,revision:1,snapshot:{sourceUrl:oldUrl,title:'이전 미완성'},issues:['가격 확인']},
   {id:capture.captureId,ownerId:company.owner,fingerprint:capture.fingerprint,revision:3,snapshot:{sourceUrl,title:'새 상품'},issues:[]}];
  const h=fixture(company,{items});try{
   h.setRows([{...h.rows[0],url:oldUrl,sourceCapture:old},h.rows[1]]);const previous=JSON.stringify(h.rows[0]);
   h.button('전체 시작 (2건)').props.onClick();await h.settle();assert.equal(h.posts.length,0);assert.match(text(h.render()),/가격 확인/);
   h.button('이 상품 초안 작성').props.onClick();await h.settle();
   // The first visible row also has an action: select the new row's exact button.
   assert.equal(h.posts.length,0);assert.equal(JSON.stringify(h.rows[0]),previous);
   const action=nodes(h.render()).filter(node=>node.type==='button'&&text(node)==='이 상품 초안 작성')[1];action.props.onClick();await h.settle();
   assert.equal(h.posts.length,1);assert.equal(h.posts[0].body.urls[0],sourceUrl);await complete(h);
   assert.equal(JSON.stringify(h.rows[0]),previous);assert.deepEqual(h.opened.map(value=>value.id),['only-new-product']);
  }finally{h.close();}
 });

 test(`${company.code}: stale row callbacks, account changes and unmount never start retained item actions`,async()=>{
  for(const change of ['edit','remove','owner','owner-back','unmount']){
   const h=fixture(company);try{
    const click=h.button('이 상품 초안 작성').props.onClick;
    if(change==='edit')nodes(h.render()).find(node=>node.props?.['aria-label']==='2번째 특징').props.onChange({target:{value:'입력 변경'}});
    if(change==='remove')h.setRows(h.rows.filter(row=>row.id!=='collected-row'));
    if(change.startsWith('owner')){h.switchOwner('another-owner');if(change==='owner-back')h.switchOwner(company.owner);}
    if(change==='unmount')h.close();
    const before=JSON.stringify(h.rows);click();await h.settle();assert.equal(h.posts.length,0,change);assert.equal(h.collections.length,0,change);assert.equal(h.opened.length,0,change);assert.equal(JSON.stringify(h.rows),before,change);assert.equal(h.lateStateWrites,0,change);
   }finally{h.close();}
  }
 });

 test(`${company.code}: item and batch callbacks share one operation lock and a closed queue drops late collection results`,async()=>{
  const h=fixture(company);try{
   const item=h.button('이 상품 초안 작성').props.onClick,batch=h.button('전체 시작 (2건)').props.onClick;
   item();item();batch();await h.settle();assert.equal(h.posts.length,1);assert.equal(h.collections.length,1);
   assert.equal(h.button('이 상품 초안 작성').props.disabled,true);assert.deepEqual(h.busy.map(value=>value.value),[true]);
   h.close();assert.equal(h.collections[0].callbacks.signal.aborted,true);const before=JSON.stringify(h.rows);
   h.collections[0].callbacks.onJob({...h.collections[0].job,product_id:'late-product'});h.collections[0].resolve('late');await h.settle();
   assert.equal(JSON.stringify(h.rows),before);assert.equal(h.opened.length,0);assert.equal(h.lateStateWrites,0);assert.deepEqual(h.busy.map(value=>value.value),[true,false]);
  }finally{h.close();}
 });

 test(`${company.code}: exact capture revision and owner are required; same-URL alternatives never substitute`,async()=>{
  for(const mismatch of ['revision','owner','fingerprint','missing','archived']){
   const item={id:capture.captureId,ownerId:mismatch==='owner'?'another-owner':company.owner,fingerprint:mismatch==='fingerprint'?'c'.repeat(64):capture.fingerprint,revision:mismatch==='revision'?4:3,snapshot:{sourceUrl,title:'다른 수집본'},issues:[],...(mismatch==='archived'?{archivedAt:'2026-10-21T00:00:00.000Z'}:{})};
   const h=fixture(company,{items:mismatch==='missing'?[]:[item]});try{
    const before=JSON.stringify(h.rows);h.button('이 상품 초안 작성').props.onClick();await h.settle();assert.equal(h.posts.length,0,mismatch);assert.equal(h.collections.length,0,mismatch);assert.equal(h.opened.length,0,mismatch);assert.equal(JSON.stringify(h.rows),before,mismatch);assert.match(text(h.render()),/선택한 수집본을 다시 확인/);
   }finally{h.close();}
  }
 });

 test(`${company.code}: a server-reused received product is not automatically opened as a new draft`,async()=>{
  const h=fixture(company,{holdPost:true});try{
   const previous=JSON.stringify(h.rows[0]);h.button('이 상품 초안 작성').props.onClick();await h.settle();
   const response=await h.jobResponse(h.posts[0]).json();response.jobs[0].product_id='already-received-product';response.jobs[0].received_at='2026-10-20T00:00:00.000Z';
   h.posts[0].resolve(Response.json(response));await h.settle();assert.equal(h.collections.length,1);
   await complete(h,'already-received-product');assert.equal(h.rows[1].status,'saved');assert.equal(h.rows[1].productId,'already-received-product');
   assert.equal(h.opened.length,0);assert.equal(JSON.stringify(h.rows[0]),previous);assert.equal(h.button('초안 확인·수정').props.disabled,false);
  }finally{h.close();}
 });

 test(`${company.code}: a late reused product ACK blocks automatic opening even when the queued job initially has no product`,async()=>{
  const h=fixture(company);try{
   const previous=JSON.stringify(h.rows[0]);h.button('이 상품 초안 작성').props.onClick();await h.settle();
   assert.equal(h.collections[0].job.product_id,undefined);assert.equal(typeof h.collections[0].callbacks.onProductReused,'function');
   h.collections[0].callbacks.onProductReused('concurrently-created-product');
   await complete(h,'concurrently-created-product');assert.equal(h.rows[1].status,'saved');assert.equal(h.rows[1].productId,'concurrently-created-product');
   assert.equal(h.opened.length,0);assert.equal(JSON.stringify(h.rows[0]),previous);assert.equal(h.button('초안 확인·수정').props.disabled,false);
  }finally{h.close();}
 });

 test(`${company.code}: failed or uncertain saves and preserved existing work never auto-open an editor`,async()=>{
  for(const outcome of ['unknown-ack','existing-product','preserved-request','collection-failure']){
   const h=fixture(company,{holdPost:outcome!=='collection-failure'});try{
    const previous=JSON.stringify(h.rows[0]);h.button('이 상품 초안 작성').props.onClick();await h.settle();
    if(outcome==='collection-failure')h.collections[0].reject(Error('초안 작성 확인 실패'));
    else{
     const response=await h.jobResponse(h.posts[0]).json();
     if(outcome==='unknown-ack')response.jobs=[];
     if(outcome==='existing-product')response.jobs[0].product_id='protected-existing-product';
     if(outcome==='preserved-request')response.preservedRequests=[{differences:['category']}];
     h.posts[0].resolve(Response.json(response));
    }
    await h.settle();assert.equal(h.rows[1].status,'error',outcome);assert.equal(h.opened.length,0,outcome);assert.equal(JSON.stringify(h.rows[0]),previous,outcome);
    if(outcome!=='collection-failure')assert.equal(h.collections.length,0,outcome);
    assert.equal(text(h.render()).includes('이 상품 초안 작성'),outcome!=='existing-product'&&outcome!=='preserved-request');
   }finally{h.close();}
  }
 });
}
