import test from 'node:test';
import assert from 'node:assert/strict';
import {intakeOwnerScopeHarness,intakeScopeCompanies} from './helpers/intake-owner-scope.mjs';

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const node=(h,label)=>nodes(h.render()).find(value=>value.props?.['aria-label']===label);
const plain=value=>JSON.parse(JSON.stringify(value));
const company=intakeScopeCompanies[0],scope={code:company.code,name:company.name};

test('category-first intake focuses and selects only the new URL, preserving the old row',async()=>{
  const h=intakeOwnerScopeHarness(company,{panelProps:{goal:'price',initialCategorySelection:{
    id:'00000000-0000-4000-8000-000000000001',ownerId:company.owner
  }}});
  try{
    const saved=plain(h.rows[0]);
    nodes(h.render()).find(value=>value.type?.name==='CategoryPicker').props.onSelected(h.profile);
    const input=node(h,'2번째 1688 링크');
    assert.deepEqual(h.focused,['2번째 1688 링크']);assert.equal(input.props.value,'');
    assert.deepEqual(plain(h.rows[0]),saved);assert.equal(h.posts.length,0);
    assert.equal(node(h,'1번째 상품 선택').props.checked,false);
    input.props.onChange({target:{value:'https://detail.1688.com/offer/647000000002.html'}});
    assert.equal(node(h,'2번째 상품 선택').props.checked,true);
    h.button('선택 시작 (1건)').props.onClick();await h.settle();
    assert.equal(h.posts.length,1);assert.deepEqual(h.posts[0].body.urls,['https://detail.1688.com/offer/647000000002.html']);
    assert.equal(h.posts[0].body.goal,'price');assert.equal(h.collections[0].callbacks.initializeImageRoles,true);
    h.collections[0].callbacks.onJob({...h.collections[0].job,product_id:'new-price-product'});h.collections[0].resolve('초안 저장됨');
    await h.settle();
    assert.deepEqual(h.opened.map(value=>value.id),['new-price-product']);assert.deepEqual(plain(h.rows[0]),saved);
  }finally{h.close();}
});

for(const [goal,callback] of [['work','onOpenWorkReview'],['transmit','onOpenTransmissionReview']])test(`intake ${goal} review receives only checked freshly created products and never opens linked records`,async()=>{
  const reviews=[];
  const h=intakeOwnerScopeHarness(company,{panelProps:{goal,sourceCompany:scope,
    [callback]:async(targets,signal)=>{assert.equal(signal.aborted,false);reviews.push(plain(targets));}},
    jobPatch:job=>job.offer_id==='647000000002'?{product_id:'existing-product'}:{}});
  try{
    const profile={...h.profile,hubSchema:{metadata:{scopeType:'Retail_Categorized_Single'},company:scope}};
    h.setRows([1,2,3].map(index=>({...h.newRow(),id:'row-'+index,profile,url:`https://detail.1688.com/offer/64700000000${index}.html`})));
    node(h,'3번째 상품 선택').props.onChange({target:{checked:false}});
    h.button('선택 시작 (2건)').props.onClick();await h.settle();
    const first=h.collections[0];assert.ok(first);assert.equal(first.callbacks.initializeImageRoles,goal==='transmit'?true:undefined);assert.deepEqual(reviews,[]);
    assert.equal(first.job.goal,goal);
    const productId='new-'+goal+'-product';
    first.callbacks.onFreshProduct(productId);
    first.callbacks.onJob({...first.job,product_id:productId});first.resolve('초안 저장됨');
    await h.settle();
    assert.equal(h.posts.length,2);assert.equal(h.collections.length,1);
    assert.equal(h.rows[1].status,'error');assert.match(h.rows[1].message,/기존 상품/);assert.equal(h.rows[2].status,'draft');
    assert.deepEqual(reviews,[[{productId,sourceUrl:h.rows[0].url,profileId:h.profile.id}]]);
    assert.deepEqual(h.opened,[]);
  }finally{h.close();}
});
