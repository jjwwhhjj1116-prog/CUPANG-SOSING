import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewFixture,plain} from './helpers/native-source-review.mjs';
import {quotationAiUI,nodes} from './helpers/quotation-ai-ui.mjs';

const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value==null?'':String(value);
test('native source review shows grouped option/field context and original counts without weakening the blocking guard',async()=>{
 const f=await nativeReviewFixture();let ui;
 try{
  const before=f.state(),files=f.objectState(),plan=plain(f.sourcePlan),members=plan.identity.members,field=f.quotationView.resolved.schema.fields.find(row=>row.id==='title');assert.ok(field);
  plan.metadataValid=false;plan.sourcePlanSha256=null;
  const issue=(optionId,level,message)=>({code:level==='error'?'EXACT_ERROR':'EXACT_REVIEW',level,message,optionId,fieldId:field.id});
  plan.issues=[issue(members[0].optionId,'error','필수 입력을 확인해주세요.'),issue(members[1].optionId,'error','필수 입력을 확인해주세요.'),issue(members[0].optionId,'error','필수 입력을 확인해주세요.'),issue(members[0].optionId,'review','원본과 비교해주세요.'),issue(members[1].optionId,'review','원본과 비교해주세요.')];
  ui=quotationAiUI({productId:f.id,profileId:f.profile.id,view:f.quotationView,disabled:false},async(path,init)=>path===f.sourcePath?Response.json(plan):f.request(path,init),'app/components/supplier-hub-native-source-review.tsx','SupplierHubNativeSourceReview');await ui.idle();
  const tree=ui.render(),items=nodes(tree).filter(row=>row.type==='li').map(text),context=`${members[0].optionLabel}, ${members[1].optionLabel} · ${field.label}`;
  assert.deepEqual(items,[`${context}: 필수 입력을 확인해주세요. (3건)`,`${context}: 원본과 비교해주세요. (2건)`]);
  assert.match(text(tree),/전송 전 확인 필요 3건 · 같은 안내 1개로 묶음/);assert.match(text(tree),/견적서 검토 안내 2건 · 같은 안내 1개로 묶음/);
  assert.equal(ui.button('견적서·첨부 파일 확인').props.disabled,true);ui.button('견적서·첨부 파일 확인').props.onClick();await ui.idle();assert.equal(nodes(ui.render()).some(row=>row.props?.review),false);
  assert.ok(items.every(value=>members.every(member=>!value.includes(member.optionId))));assert.ok(ui.calls.every(call=>call.method==='GET'));assert.equal(f.state(),before);assert.equal(f.objectState(),files);assert.deepEqual(f.h.network,[]);
 }finally{ui?.unmount();f.close();}
});
