import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,submissionScopeFixture,nodes,text} from './helpers/submission-owner-scope.mjs';

for(const company of companies)test(`prepared company quotation disappears immediately on owner change and old callbacks never revive through ABA (${company.code})`,async()=>{
 const f=await submissionScopeFixture(company);try{
  await f.ready();await f.open();const before=f.snapshot(),review=f.h.component('submission-review-panel'),packageMount=f.h.instance('SubmissionPackage');
  const oldClose=nodes(nodes(f.h.render()).find(node=>node.props?.['aria-label']==='Supplier Hub 등록 전송')).find(node=>node.type==='button'&&node.props.className==='icon-close').props.onClick;
  const oldSend=nodes(f.h.render()).filter(node=>node.type==='button'&&text(node)==='등록 전송').at(-1).props.onClick;
  const changed=f.switchOwner();assert.equal(nodes(changed).some(node=>node.props?.['aria-label']==='Supplier Hub 등록 전송'),false);assert.equal(f.h.instance('SubmissionPackage'),undefined);assert.equal(packageMount.mounted,false);
  await f.h.settle();const start=f.h.requests.length;review.onReceiptSaved();review.onEdit(f.originalProduct.id,f.flow.profile.id);oldSend();assert.equal(f.h.requests.length,start);assert.equal(f.snapshot(),before);
  f.switchOwner('owner');await f.h.settle();assert.equal(f.h.component('submission-review-panel'),undefined,'the same owner and product ID never restore the old intent');
  const abaStart=f.h.requests.length;review.onReceiptSaved();review.onEdit(f.originalProduct.id,f.flow.profile.id);oldSend();assert.equal(f.h.requests.length,abaStart);assert.equal(f.h.component('submission-review-panel'),undefined);
  f.h.component('registration-board').onOpen(f.h.products[0],'견적서');await f.h.settle();await f.open();const reopened=f.h.instance('SubmissionPackage');assert.notEqual(reopened,packageMount);oldClose();await f.h.settle();assert.equal(f.h.instance('SubmissionPackage'),reopened,'an earlier modal callback cannot close the fresh session');
  assert.equal(f.flow.events.filter(event=>event.type==='TRANSMIT').length,0);assert.equal(f.snapshot(),before);assert.equal(f.h.lateWrites,0);
 }finally{f.close();}
});

for(const company of companies)test(`owner change aborts one pending package request before its late response can publish or save (${company.code})`,async()=>{
 const f=await submissionScopeFixture(company);try{
  await f.ready();await f.open({prepare:false});const before=f.snapshot(),gate=f.defer((_url,_init,body)=>body?.action==='preview');
  f.h.button('견적서 + 첨부 파일 준비').props.onClick();await gate.arrived;const mount=f.h.instance('SubmissionPackage');assert.equal(gate.signal.aborted,false);
  f.switchOwner();assert.equal(gate.signal.aborted,true);assert.equal(gate.aborts,1);assert.equal(mount.mounted,false);gate.release();await f.h.settle();assert.equal(f.h.instance('SubmissionPackage'),undefined);assert.equal(f.h.lateWrites,0);
  f.switchOwner('owner');await f.h.settle();assert.equal(f.h.instance('SubmissionPackage'),undefined);assert.equal(f.snapshot(),before);assert.equal(f.flow.events.filter(event=>event.type==='TRANSMIT').length,0);
 }finally{f.close();}
});

for(const company of companies)test(`owner transition cancels the review fetch in layout cleanup without exposing a late saved package (${company.code})`,async()=>{
 const f=await submissionScopeFixture(company);try{
  await f.ready();const before=f.snapshot(),gate=f.defer(url=>url.includes('/submission-review'));const opening=f.h.click('저장한 견적 전송 준비');await gate.arrived;
  assert.equal(gate.signal.aborted,false);f.switchOwner();assert.equal(gate.signal.aborted,true);assert.equal(gate.aborts,1);gate.release();await opening;await f.h.settle();
  assert.equal(f.h.component('submission-review-panel'),undefined);assert.equal(f.h.instance('SubmissionPackage'),undefined);assert.equal(f.h.lateWrites,0);assert.equal(f.snapshot(),before);assert.equal(f.flow.events.filter(event=>event.type==='TRANSMIT').length,0);
 }finally{f.close();}
});

for(const company of companies)test(`an old tracking pause cannot update a disposed owner package or interrupt a reopened session (${company.code})`,async()=>{
 const f=await submissionScopeFixture(company);try{
  await f.ready();await f.open();for(const input of nodes(f.h.render()).filter(node=>node.type==='input'&&node.props.type==='checkbox'))input.props.onChange({target:{checked:true}});
  nodes(f.h.render()).filter(node=>node.type==='button'&&text(node)==='등록 전송').at(-1).props.onClick();
  const deadline=Date.now()+10000;while(!f.h.button('결과 확인 일시정지')||!f.flow.signal){assert.ok(Date.now()<deadline,'actual synthetic tracker did not start');await f.h.settle();}
  const oldPause=f.h.button('결과 확인 일시정지').props.onClick;assert.equal(f.flow.signal.aborted,false);f.switchOwner();assert.equal(f.flow.signal.aborted,true);
  const before=f.snapshot(),start=f.h.requests.length;oldPause();await f.h.settle();assert.equal(f.h.lateWrites,0);assert.equal(f.h.instance('SubmissionPackage'),undefined);
  f.switchOwner('owner');await f.h.settle();oldPause();assert.equal(f.h.instance('SubmissionPackage'),undefined);assert.equal(f.h.lateWrites,0);assert.equal(f.snapshot(),before);
  assert.equal(f.flow.events.filter(event=>event.type==='TRANSMIT').length,1,'only the explicitly reviewed synthetic delivery occurred');assert.ok(f.h.requests.slice(start).every(row=>row.method==='GET'));assert.ok(!f.flow.api.network.includes('supplier.coupang.com'));
 }finally{f.close();}
});
