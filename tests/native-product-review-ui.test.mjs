import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,companies,plain} from './helpers/native-source-review.mjs';
import {quotationAiUI,nodes} from './helpers/quotation-ai-ui.mjs';
const file='app/components/supplier-hub-native-source-review.tsx',name='SupplierHubNativeSourceReview';
const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
for(const company of companies)test(`${company.code}: primary file-native review reads current originals and exposes exact whole-product transport without public preparation or source collection`,async()=>{
 const f=await nativeReviewFixture(company);let ui;try{
  const before=f.state(),images=f.objectState();ui=quotationAiUI({productId:f.id,profileId:f.profile.id,view:f.quotationView,disabled:false},f.request,file,name);await ui.idle();
  assert.equal(ui.button('견적서·첨부 파일 확인').props.disabled,false);assert.match(text(ui.render()),/대표 1개 · 추가 2개 · 표시사항 1개 · 상세 3개/);
  await ui.click('견적서·첨부 파일 확인');assert.match(text(ui.render()),/포함 옵션 2개 · 견적 문서 1개/);
  const transport=nodes(ui.render()).find(node=>node.props?.review&&typeof node.props.refresh==='function');assert.ok(transport);assert.equal(transport.props.review.identity.fingerprint,f.sourcePlan.sourcePlanSha256);
  const latest=await transport.props.refresh(new AbortController().signal);assert.equal(latest.reviewDigest,transport.props.review.reviewDigest);assert.deepEqual(ui.alerts(),[]);
  assert.ok(ui.calls.every(call=>call.method==='GET'));assert.ok(ui.calls.every(call=>!call.url.includes('single-package')));assert.equal(f.state(),before);assert.equal(f.objectState(),images);assert.deepEqual(f.h.network,[]);
  await ui.click('전체 문서 확인 닫기');assert.equal(nodes(ui.render()).some(node=>node.props?.review),false);
 }finally{ui?.unmount();f.close();}
});
test('blocked file plans remain visible but never open product transport, and malformed images become an error instead of a broken render',async()=>{
 const f=await nativeReviewFixture();try{
  for(const bad of [false,true]){const blocked=plain(f.sourcePlan);blocked.metadataValid=false;blocked.sourcePlanSha256=null;blocked.issues=[{code:'SOURCE_GAP',level:'error',message:'확인한 상품 원문이 필요합니다.'}];if(bad)blocked.images={};
   const ui=quotationAiUI({productId:f.id,profileId:f.profile.id,view:f.quotationView,disabled:false},async(path,init)=>path===f.sourcePath?Response.json(blocked):f.request(path,init),file,name);try{await ui.idle();assert.equal(ui.button('견적서·첨부 파일 확인').props.disabled,true);assert.equal(nodes(ui.render()).some(node=>node.props?.review),false);if(bad)assert.ok(ui.alerts().some(message=>message.includes('첨부 파일 목록')));else assert.match(text(ui.render()),/확인한 상품 원문이 필요합니다/);assert.ok(ui.calls.every(call=>call.method==='GET'));}finally{ui.unmount();}
  }
 }finally{f.close();}
});
test('disabled review makes no read; a source edit rejects a retained transport refresh and never dispatches',async()=>{
 const f=await nativeReviewFixture();let ui;try{
  const props={productId:f.id,profileId:f.profile.id,view:f.quotationView,disabled:true};ui=quotationAiUI(props,f.request,file,name);await ui.idle();assert.equal(ui.calls.length,0);
  ui.render({...props,disabled:false});await ui.idle();await ui.click('견적서·첨부 파일 확인');const transport=nodes(ui.render()).find(node=>node.props?.review);
  f.h.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-21T00:00:00.000Z',f.id);await assert.rejects(transport.props.refresh(new AbortController().signal));
  ui.unmount();await assert.rejects(transport.props.refresh(new AbortController().signal));assert.ok(ui.calls.every(call=>call.method==='GET'));assert.deepEqual(f.h.network,[]);
 }finally{ui?.unmount();f.close();}
});
