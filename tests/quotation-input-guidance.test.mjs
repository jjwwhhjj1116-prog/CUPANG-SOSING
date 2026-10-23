import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationTitleLoader,quotationTitleUI,titleNodes,titleText,visibleText,plain} from './helpers/quotation-form-presentation.mjs';

const editor=quotationTitleLoader()('app/components/quotation-fields-editor.tsx');
const field=(id,extra={})=>({id,label:id,section:'product',type:'text',required:false,visibility:'common',...extra});
const cell=(value='',source='content',validationIssues=[],reviewMessages=[])=>({value,source,validationIssues,reviewMessages,issues:[...validationIssues,...reviewMessages],needsReview:reviewMessages.length>0});
function fixture(fields,values,globalErrors=[]){
 const schema={version:1,categoryId:'guidance',categoryPath:['합성 검수'],status:'observed',evidence:'합성 양식 근거',fields,submissionReady:false};
 const rows=[null,'red','blue'].map(optionId=>({optionId,optionLabel:optionId??'상품 공통값',included:optionId!==null,fields:plain(values)}));
 const resolved={schema,rows,issues:[...globalErrors,'합성 양식 근거'],validationIssues:globalErrors,reviewMessages:['합성 양식 근거']};
 return{revision:1,inputFingerprint:'a'.repeat(64),overrides:{common:{},options:{}},resolved,automatic:plain(resolved),imageKeys:['image/owned.jpg'],submissionReady:false,
  categoryContext:{source:'collection',profileId:null,categoryId:'guidance',categoryPath:schema.categoryPath},productVersion:'synthetic-v1',contentRevision:1,optionRevision:1,updatedAt:null};
}
const summary=ui=>ui.nodes().find(node=>node.props?.['aria-label']==='현재 입력 확인');
const references=ui=>ui.nodes().find(node=>node.type==='details'&&titleText(node.props.children).startsWith('검토·참고 안내'));
const mutations=ui=>ui.calls.filter(call=>call.init?.method&&call.init.method!=='GET');
const dimensions=field('packagedDimensionsMm',{label:'포장 크기',section:'logistics',required:true,unit:'mm'});

test('a missing package size stays one missing fact while generic/default/image reviews remain collapsed and navigable',async()=>{
 const choice=field('optionalChoice',{label:'선택 속성',type:'select',required:true,choices:[{value:'',label:'해당사항없음'},{value:'value',label:'선택값'}]}),review=field('reviewed',{label:'확인값',reviewRequired:true}),image=field('proof',{label:'상품 이미지',section:'image',type:'images'});
 const view=fixture([dimensions,choice,review,image],{packagedDimensionsMm:cell('','empty'),optionalChoice:cell('','couplus-default'),reviewed:cell('저장값'),proof:cell('image/owned.jpg')}),before=JSON.stringify(view),ui=quotationTitleUI({view});
 try{await ui.idle();assert.equal(titleText(summary(ui).props.children[0]),'상품 공통값 · 필수 미입력 1개 · 입력 오류 0개');
  assert.match(titleText(summary(ui)),/포장 크기 입력하기/);assert.doesNotMatch(titleText(summary(ui)),/실제 상품·증빙|쿠플러스 참조|첨부 이미지 파일명/);
  const notes=references(ui);assert.ok(notes);assert.ok(!notes.props.open);assert.doesNotMatch(visibleText(notes),/실제 상품·증빙|쿠플러스 참조|첨부 이미지 파일명/);
  for(const phrase of ['실제 상품·증빙','쿠플러스 참조','첨부 이미지 파일명','합성 양식 근거'])assert.ok(titleText(notes).includes(phrase),phrase);
  assert.doesNotMatch(titleText(notes),/필수 값이 비어 있습니다/);assert.doesNotMatch(visibleText(ui.render()),/입력·검토 안내/);
  const move=titleNodes(summary(ui)).find(node=>node.type==='button');assert.equal(move.props.disabled,false);move.props.onClick();ui.render();assert.ok(ui.field('packagedDimensionsMm'));assert.equal(ui.changes.length,0);
  const state=editor.quotationEditorGuidance(view,[],null);assert.deepEqual(plain(state.missing.map(item=>item.field.id)),['packagedDimensionsMm']);assert.equal(state.invalid.length,0);assert.equal(view.resolved.rows[0].fields.optionalChoice.value,'');assert.equal(view.resolved.rows[0].fields.optionalChoice.source,'couplus-default');
  assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('structured validation remains visible even when its message resembles a review, with global errors separate from references',async()=>{
 const reminder='실제 상품·증빙과 일치하는지 확인해주세요.',invalid=field('invalid',{label:'오류 항목'}),view=fixture([dimensions,invalid],{packagedDimensionsMm:cell('','empty'),invalid:cell('기존값','content',[reminder],[reminder,'별도 검토 메시지'])},['전체 입력 제약 오류']);
 const before=JSON.stringify(view),ui=quotationTitleUI({view});try{await ui.idle();assert.match(titleText(summary(ui)),/필수 미입력 1개 · 입력 오류 2개/);assert.match(titleText(summary(ui)),/전체 입력 제약 오류/);assert.match(titleText(summary(ui)),/오류 항목 확인하기/);assert.match(titleText(summary(ui)),/실제 상품·증빙/);
  assert.doesNotMatch(titleText(references(ui)),/전체 입력 제약 오류|실제 상품·증빙/);assert.match(titleText(references(ui)),/별도 검토 메시지/);assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('current common and option counts follow unsaved inputs without turning required blanks into a save restriction',async()=>{
 const note=field('note',{label:'메모'}),view=fixture([dimensions,note],{packagedDimensionsMm:cell('100*200*300'),note:cell('저장값')});
 for(const data of [view.resolved,view.automatic])data.rows.find(row=>row.optionId==='blue').fields.packagedDimensionsMm=cell('잘못된 크기');
 const before=JSON.stringify(view),ui=quotationTitleUI({view});try{await ui.idle();assert.match(titleText(summary(ui)),/상품 공통값 · 필수 미입력 0개 · 입력 오류 0개/);
  ui.select('red');ui.field('packagedDimensionsMm').props.onChange({target:{value:''}});ui.render();assert.match(titleText(summary(ui)),/현재 옵션 · 필수 미입력 1개 · 입력 오류 0개/);assert.equal(ui.button('견적 입력 저장').props.disabled,false,'a required blank can still be saved as a draft');assert.match(titleText(summary(ui)),/작성 중 상태로 저장할 수 있습니다/);
  ui.select('blue');assert.match(titleText(summary(ui)),/현재 옵션 · 필수 미입력 0개 · 입력 오류 1개/);assert.match(titleText(summary(ui)),/포장 크기 확인하기/);assert.match(titleText(summary(ui)),/양의 정수 3개/);
  ui.select(null);assert.match(titleText(summary(ui)),/상품 공통값 · 필수 미입력 0개 · 입력 오류 0개/);ui.select('red');assert.equal(ui.field('packagedDimensionsMm').props.value,'');assert.equal(ui.button('견적 입력 저장').props.disabled,false);
  assert.deepEqual(plain(ui.changes),[{fieldKey:'packagedDimensionsMm',optionId:'red',value:''}]);assert.equal(JSON.stringify(view),before);assert.equal(mutations(ui).length,0);
 }finally{ui.close();}
});

test('exact empty weight peers count once and retain their validation; hidden price aliases never inflate the display count',()=>{
 const weight=field('packagedWeightG',{type:'number',section:'logistics',required:true,unit:'g',integer:true,min:1}),wire=field('liveWeight',{section:'logistics',required:true,unit:'g',numericText:true,hubInput:'packagedWeightG',hubWire:{path:['logisticsPage','skuUnitBoxWeight']}});
 const fields=[weight,wire,dimensions,...['supplyPrice','salePrice','msrp'].map(id=>field(id,{type:'number'})),field('nativeSupply',{type:'number',hubInput:'supplyPrice',hubWire:{path:['productPage','commonAttributes','purchasePrice']}})];
 const values=Object.fromEntries(fields.map(item=>[item.id,cell('10')]));for(const item of [weight,wire,dimensions])values[item.id]=cell('','empty');values.supplyPrice=cell('retained hidden alias','content',['hidden alias validation']);values.nativeSupply=cell('bad');
 const view=fixture(fields,values),before=JSON.stringify(view),guidance=editor.quotationEditorGuidance(view,[],null);
 assert.deepEqual(plain(guidance.missing.map(entry=>entry.field.id)),['liveWeight','packagedDimensionsMm']);assert.deepEqual(plain(guidance.missing[0].fieldIds),['liveWeight','packagedWeightG']);assert.deepEqual(plain(guidance.missing[0].issues),['필수 값이 비어 있습니다.']);assert.deepEqual(plain(guidance.invalid.map(entry=>entry.field.id)),['nativeSupply']);assert.equal(JSON.stringify(view),before);
});

test('an additional validation error on a missing field remains attached to the missing item without double counting',()=>{
 const view=fixture([dimensions],{packagedDimensionsMm:cell('','empty',['원문 포장 정보 연결 오류'])}),before=JSON.stringify(view),guidance=editor.quotationEditorGuidance(view,[],null);
 assert.equal(guidance.missing.length,1);assert.equal(guidance.invalid.length,0);assert.ok(guidance.missing[0].issues.includes('원문 포장 정보 연결 오류'));assert.ok(guidance.missing[0].issues.includes('필수 값이 비어 있습니다.'));assert.equal(guidance.references.some(item=>item.issue==='원문 포장 정보 연결 오류'),false);assert.equal(JSON.stringify(view),before);
});
