import test from 'node:test';
import assert from 'node:assert/strict';
import {readSupplierHubRegistration} from '../extensions/supplier-hub/registration-result.mjs';
import {querySupplierHubCompanyRegistrations} from '../extensions/supplier-hub/company-registration-page.mjs';
import {collectSupplierHubRegistrationPages} from '../extensions/supplier-hub/registration-pages.mjs';
import {company,query,quotationId,css,nativeMarkup,retainedPager,qvtHarness} from './helpers/qvt-native-pagination.mjs';

for(const account of [company,{code:'A01464742',name:'와이홉'}])test(`${account.code}: the retained current QVT pager exposes page one and numeric two without treating a disabled group arrow as next`,()=>{
 const h=qvtHarness({company:account,pager:retainedPager()}),value=h.run(readSupplierHubRegistration,quotationId,{company:account});
 assert.equal(value.page.current,1);assert.equal(value.page.hasNext,true);assert.equal(value.registered,false);assert.equal(value.rows[0].skuId,'synthetic-sku-1');assert.equal(h.actions.length,0);
});

test('serialized exact-quotation lookup reads all six native pages, waits for each fresh table, and never claims receipt approval',async()=>{
 const h=qvtHarness();
 const value=await h.settle(collectSupplierHubRegistrationPages(quotationId,6,{check:async()=>{},now:()=>0,
  read:async()=>h.run(readSupplierHubRegistration,quotationId,{company}),
  advance:async page=>h.run(readSupplierHubRegistration,quotationId,{company,advanceFrom:page})}));
 assert.equal(value.pagesRead,6);assert.equal(value.hasMore,false);assert.equal(value.registered,false);assert.deepEqual(Array.from(value.rows,row=>row.skuId),Array.from({length:6},(_,i)=>'synthetic-sku-'+(i+1)));
 assert.deepEqual(h.actions.map(action=>action.label),['2','3','4','5','6']);assert.equal(h.timers.size,0);
});

for(const account of [company,{code:'A01464742',name:'와이홉'}])test(`${account.code}: serialized company status query reads native pages using unchanged dates/company and full IDs`,async()=>{
 const h=qvtHarness({mode:'company',company:account}),value=await h.settle(h.run(querySupplierHubCompanyRegistrations,query,account));
 assert.equal(value.total,6);assert.equal(value.pagesRead,6);assert.equal(value.mutated,false);assert.equal(value.scope,'queried-pages');assert.equal(value.rows.length,6);assert.equal(value.company.code,account.code);
 assert.deepEqual(h.actions.filter(action=>action.kind==='page').map(action=>action.target),[2,3,4,5,6]);assert.equal(h.searches,1);assert.equal(h.timers.size,0);
});

test('a native page-group transition uses eleven only when the rendered enabled control is exactly sequential',async()=>{
 const h=qvtHarness({start:10,end:12}),before=h.run(readSupplierHubRegistration,quotationId,{company});
 assert.equal(before.page.current,10);const value=await h.settle(h.run(readSupplierHubRegistration,quotationId,{company,advanceFrom:before.page}));
 assert.equal(value.page.current,11);assert.equal(value.page.hasNext,true);assert.deepEqual(h.actions,[{kind:'page',label:'>',target:11}]);assert.equal(h.timers.size,0);
});

test('the original eleven-page boundary with disabled group/end controls stops without forcing a click or skipping a page',()=>{
 const h=qvtHarness({start:10,end:11});assert.throws(()=>h.run(readSupplierHubRegistration,quotationId,{company}),/연속된 다음/);assert.equal(h.actions.length,0);
 const last=qvtHarness({start:6,end:6}),value=last.run(readSupplierHubRegistration,quotationId,{company});assert.equal(value.page.current,6);assert.equal(value.page.hasNext,false);assert.equal(last.actions.length,0);
});

test('unknown, conflicting, duplicate or malformed native page identity cannot become a trusted next page',()=>{
 const changes=[
  pager=>pager.querySelector('li.'+css.active).setAttribute('class',css.item),
  pager=>pager.querySelector('a[data-page="2"]').parentElement.setAttribute('class',css.item+' '+css.active),
  pager=>pager.querySelector('a[data-page="2"]').setAttribute('data-page','3'),
  pager=>pager.querySelector('a[data-page="2"]').parentElement.setAttribute('class',css.item+' '+css.disabled),
  pager=>pager.querySelector('a[data-page="2"]').setAttribute('aria-current','page'),
  pager=>pager.querySelector('li.'+css.last+' a').setAttribute('data-page','5'),
  pager=>pager.querySelector('li.'+css.first).setAttribute('class',css.first),
 ];
 for(const mutate of changes){const h=qvtHarness({mutate});assert.throws(()=>h.run(readSupplierHubRegistration,quotationId,{company}));assert.equal(h.actions.length,0);}
 const unknown=qvtHarness({pager:nativeMarkup().replace(css.root,'unknown-native-pager')});assert.equal(unknown.run(readSupplierHubRegistration,quotationId,{company}).page.current,null);assert.equal(unknown.actions.length,0);
});

test('native pagination retains stale-result, changed-company/filter and cross-origin movement guards',async()=>{
 for(const options of [{skip:true},{changedCompany:true},{changedFilter:true},{unrelated:true}]){
  const h=qvtHarness(options),before=h.run(readSupplierHubRegistration,quotationId,{company});
  await assert.rejects(h.settle(h.run(readSupplierHubRegistration,quotationId,{company,advanceFrom:before.page})));assert.equal(h.timers.size,0);
 }
 for(const href of ['https://external.test/','/sr/registration','javascript:void(0)']){const h=qvtHarness({href}),before=h.run(readSupplierHubRegistration,quotationId,{company});assert.throws(()=>h.run(readSupplierHubRegistration,quotationId,{company,advanceFrom:before.page}),/페이지 이동/);assert.equal(h.actions.length,0);}
 const h=qvtHarness(),before=h.run(readSupplierHubRegistration,quotationId,{company});assert.throws(()=>h.run(readSupplierHubRegistration,quotationId,{company,advanceFrom:{...before.page,signature:'changed'}}));assert.equal(h.actions.length,0);
});
