import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const review=providedOptionModule('app/quotation-workbook-review.ts'),model=providedOptionModule('app/quotation-schema.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const oldSha='a'.repeat(64),newSha='b'.repeat(64),category='81452';
const oldId=column=>`workbook_${category}_${oldSha}_${column}`,newId=column=>`workbook_${category}_${newSha}_${column}`;
const sourceKey=(optionId,column)=>JSON.stringify([optionId,oldId(column)]);
const change=(optionId,fieldKey,value)=>({optionId,fieldKey,value});
function fixture(){
 const fields=[{id:newId(5),label:'설치 서비스',section:'product',type:'text',visibility:'common',required:true,maxLength:12,
  workbookWire:{sha256:newSha,sheetName:'새 양식',column:5,requirement:'required'}},
 {id:newId(6),label:'방식',section:'product',type:'select',visibility:'common',required:false,maxLength:12,choices:[{value:'가능',label:'가능'},{value:'불가',label:'불가'}],
  workbookWire:{sha256:newSha,sheetName:'새 양식',column:6,requirement:'optional'}},
 {id:'brand',label:'일반 항목',section:'product',type:'text',visibility:'common',required:false,maxLength:100}];
 const rows=[{optionId:null,optionLabel:'공통',included:false},{optionId:'red',optionLabel:'빨강',included:true},{optionId:'excluded',optionLabel:'제외 옵션',included:false}].map(row=>({...row,fields:Object.fromEntries(fields.map(field=>[field.id,{value:'자동 '+(row.optionId??'공통'),source:'content',issues:[],needsReview:false}]))}));
 const resolved={schema:{version:1,categoryId:category,categoryPath:['합성 카테고리'],status:'observed',evidence:'local synthetic',fields,submissionReady:false},rows,issues:[]};
 return{revision:4,inputFingerprint:'c'.repeat(64),productVersion:'2026-10-18T00:00:00.000Z',contentRevision:1,optionRevision:1,updatedAt:null,
  categoryContext:{source:'profile',profileId:'local-only',categoryId:category,categoryPath:['합성 카테고리']},imageKeys:[],submissionReady:false,
  retainedWorkbook:{name:'이전 합성 양식',sha256:oldSha,fields:[{id:oldId(5),column:5,label:'설치 서비스*',type:'text',requirement:'required',help:'이전 규칙'},
   {id:oldId(6),column:6,label:'방식',type:'select',choices:['가능','옛 방식'],requirement:'optional',help:''}]},
  overrides:{common:{[oldId(5)]:'공통 이전 입력',[newId(5)]:'저장 공통'},options:{red:{[oldId(5)]:'',[oldId(6)]:'옛 방식',[newId(5)]:'저장 빨강'},excluded:{[oldId(5)]:'  '},deleted:{[oldId(5)]:'삭제된 옵션'}}},
  automatic:plain(resolved),resolved};
}
const apply=(view,changes,selections)=>review.importQuotationWorkbookDraft(view,changes,selections,review.quotationWorkbookReviewBasis(view,changes));

test('candidates re-read captured metadata and actual manual literals, including excluded and common scopes, without touching old data',()=>{
 const view=fixture(),before=JSON.stringify(view),rows=review.quotationWorkbookReviewCandidates(view);
 assert.equal(rows.length,4);assert.deepEqual(plain(rows.map(row=>[row.optionId,row.source.column,row.value])),[[null,5,'공통 이전 입력'],['red',5,''],['excluded',5,'  '],['red',6,'옛 방식']]);
 assert.ok(rows.every(row=>row.suggestedTarget===newId(row.source.column)));assert.match(rows[2].optionLabel,/견적 제외/);
 assert.equal(JSON.stringify(view),before);assert.deepEqual(plain(review.quotationWorkbookReviewTargets(view).map(field=>field.id)),[newId(5),newId(6)]);
 delete view.retainedWorkbook;assert.deepEqual(plain(review.quotationWorkbookReviewCandidates(view)),[]);
});

test('explicit imports preserve blank and whitespace, overwrite only selected targets and leave all old overrides and other pending edits intact',()=>{
 const view=fixture(),changes=[change('red',newId(5),'현재 미저장 값'),change('red','brand','미저장 브랜드')],before=JSON.stringify({view,changes});
 assert.equal(review.quotationWorkbookReviewBefore(view,changes,'red',newId(5)),'현재 미저장 값');
 const draft=apply(view,changes,[{sourceKey:sourceKey('red',5),targetFieldKey:newId(5)},{sourceKey:sourceKey('excluded',5),targetFieldKey:newId(5)}]);
 assert.deepEqual(plain(draft),[change('red','brand','미저장 브랜드'),change('red',newId(5),''),change('excluded',newId(5),'  ')]);
 const saved=model.applyQuotationChanges(view.overrides,draft);
 assert.equal(saved.common[oldId(5)],'공통 이전 입력');assert.equal(saved.options.red[oldId(5)],'');assert.equal(saved.options.excluded[oldId(5)],'  ');
 assert.equal(saved.options.red[newId(5)],'');assert.equal(saved.options.excluded[newId(5)],'  ');assert.equal(saved.common[newId(5)],'저장 공통');
 assert.equal(saved.options.deleted[oldId(5)],'삭제된 옵션');assert.equal(JSON.stringify({view,changes}),before);
});

test('common import stays common and its preview respects option overrides, pending removal and automatic fallback',()=>{
 const view=fixture(),changes=[change(null,newId(5),'대기 공통'),change('red',newId(5),null)];
 assert.equal(review.quotationWorkbookReviewBefore(view,changes,'red',newId(5)),'대기 공통');
 assert.equal(review.quotationWorkbookReviewBefore(view,[],'red',newId(5)),'저장 빨강');
 const draft=apply(view,changes,[{sourceKey:sourceKey(null,5),targetFieldKey:newId(5)}]);
 assert.deepEqual(plain(draft),[change('red',newId(5),null),change(null,newId(5),'공통 이전 입력')]);
 assert.equal(review.quotationWorkbookReviewBefore(view,draft,'red',newId(5)),'공통 이전 입력');
 assert.equal(review.quotationWorkbookReviewBefore(view,[],'excluded',newId(5)),'저장 공통');
 delete view.overrides.common[newId(5)];assert.equal(review.quotationWorkbookReviewBefore(view,[],'excluded',newId(5)),'자동 excluded');
});

test('mapping validates current choices and length rather than trusting old labels or select rules',()=>{
 const view=fixture(),candidate=review.quotationWorkbookReviewCandidates(view).find(row=>row.source.column===6);
 assert.match(review.quotationWorkbookReviewIssues(view,candidate,newId(6)).join(),/선택|허용|입력/);
 assert.throws(()=>apply(view,[],[{sourceKey:candidate.sourceKey,targetFieldKey:newId(6)}]));
 view.overrides.options.red[oldId(6)]='가능';assert.deepEqual(plain(review.quotationWorkbookReviewIssues(view,review.quotationWorkbookReviewCandidates(view).find(row=>row.source.column===6),newId(6))),[]);
 view.overrides.common[oldId(5)]='가'.repeat(13);assert.throws(()=>apply(view,[],[{sourceKey:sourceKey(null,5),targetFieldKey:newId(5)}]));
 view.overrides.common[oldId(5)]='';assert.equal(apply(view,[],[{sourceKey:sourceKey(null,5),targetFieldKey:newId(5)}])[0].value,'','required blank is reviewable, never replaced by a guessed value');
});

test('forged source values, deleted options, unsupported target fields and source/target collisions are rejected',()=>{
 for(const selection of [{sourceKey:sourceKey('deleted',5),targetFieldKey:newId(5)},{sourceKey:sourceKey('foreign-company',5),targetFieldKey:newId(5)},
  {sourceKey:sourceKey('red',5),targetFieldKey:oldId(5)},{sourceKey:sourceKey('red',5),targetFieldKey:'brand'},
  {sourceKey:sourceKey('red',5),targetFieldKey:newId(5),value:'forged'},
  {sourceKey:'not a source key',targetFieldKey:newId(5)}])assert.throws(()=>apply(fixture(),[],[selection]));
 const selected={sourceKey:sourceKey('red',5),targetFieldKey:newId(5)};
 assert.throws(()=>apply(fixture(),[],[selected,selected]));
 assert.throws(()=>apply(fixture(),[],[selected,{sourceKey:sourceKey('red',6),targetFieldKey:newId(5)}]),/중복/);
 const view=fixture();view.resolved.schema.fields[0].readOnly=true;assert.throws(()=>apply(view,[],[selected]));
});

test('descriptor corruption, wrong category/SHA and active old IDs cannot be used as retained sources',()=>{
 const mutations=[v=>v.retainedWorkbook.fields[0].id=oldId(5).replace(category,'999'),v=>v.retainedWorkbook.sha256='d'.repeat(64),
  v=>v.categoryContext.categoryId='999',v=>v.retainedWorkbook.fields.push({...v.retainedWorkbook.fields[0]}),v=>v.retainedWorkbook.fields[0].column=200,
  v=>v.retainedWorkbook.fields[0].label='\u0000',v=>v.retainedWorkbook.fields[1].choices=['重複','重複'],
  v=>v.resolved.schema.fields.push({...v.resolved.schema.fields[0],id:oldId(5)})];
 for(const mutate of mutations){const view=fixture();mutate(view);assert.throws(()=>review.quotationWorkbookReviewCandidates(view));}
});

test('revision, company fingerprint, category, source version and unsaved draft changes retire a captured review basis',()=>{
 const view=fixture(),changes=[],basis=review.quotationWorkbookReviewBasis(view,changes),selection=[{sourceKey:sourceKey('red',5),targetFieldKey:newId(5)}];
 for(const mutate of [v=>v.revision++,v=>v.inputFingerprint='e'.repeat(64),v=>v.productVersion+='new',v=>v.categoryContext.profileId='other']){
  const current=plain(view);mutate(current);assert.throws(()=>review.importQuotationWorkbookDraft(current,changes,selection,basis),/바뀌었습니다/);
 }
 assert.throws(()=>review.importQuotationWorkbookDraft(view,[change('red','brand','new')],selection,basis),/바뀌었습니다/);
 assert.deepEqual(plain(apply(view,[change('red',newId(5),'temporary')],[{sourceKey:sourceKey('red',5),targetFieldKey:newId(5)}])),[change('red',newId(5),'')]);
 assert.throws(()=>apply(view,[],[]));assert.throws(()=>apply(view,[],Array.from({length:1001},()=>selection[0])));
});

test('a literal equal to the saved target removes its superseded pending edit rather than adding a no-op',()=>{
 const view=fixture();view.overrides.options.red[oldId(5)]='저장 빨강';
 assert.deepEqual(plain(apply(view,[change('red',newId(5),'temporary')],[{sourceKey:sourceKey('red',5),targetFieldKey:newId(5)}])),[]);
});
