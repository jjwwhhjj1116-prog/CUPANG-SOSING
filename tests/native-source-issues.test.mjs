import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const {nativeSourceIssueGroups}=providedOptionModule('app/supplier-hub-native-source-issues.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
const view={resolved:{schema:{fields:[{id:'color',label:'색상'},{id:'size',label:'사이즈'}]}}};
const identity={members:[{optionId:'first-raw-id',optionLabel:'베이지'},{optionId:'second-raw-id',optionLabel:'핑크'}]};
const issue=(patch={})=>({level:'review',code:'CHECK',message:'저장한 값을 확인해주세요.',optionId:'first-raw-id',fieldId:'color',...patch});

test('matching issues group exact option targets and field labels while retaining every occurrence',()=>{
 const issues=[issue(),issue({optionId:'second-raw-id'}),issue(),issue({fieldId:'size'}),issue({level:'error'})],before=JSON.stringify({issues,view,identity});
 const groups=plain(nativeSourceIssueGroups(issues,view,identity));assert.equal(groups.length,3);assert.equal(groups[0].context,'베이지, 핑크 · 색상');assert.equal(groups[0].count,3);assert.equal(groups[0].message,issues[0].message);assert.equal(groups[1].context,'베이지 · 사이즈');assert.equal(groups[2].level,'error');assert.equal(groups.reduce((n,row)=>n+row.count,0),issues.length);assert.equal(JSON.stringify({issues,view,identity}),before);
});

test('missing or ambiguous metadata uses safe scope labels without merging distinct unknown fields or files',()=>{
 const groups=plain(nativeSourceIssueGroups([issue({optionId:null}),issue({optionId:undefined,fieldId:undefined}),issue({optionId:'foreign-option',fieldId:'foreign-field'}),issue({optionId:'foreign-option',fieldId:'other-field'}),issue({key:'private/file-a.png'}),issue({key:'private/file-b.png'})],view,null));
 assert.equal(groups.length,6);assert.equal(groups[0].context,'상품 공통 · 색상');assert.equal(groups[1].context,'전송 자료 전체');assert.equal(groups[2].context,'옵션 확인 필요 · 항목 확인 필요');assert.equal(groups[3].context,groups[2].context);assert.ok(groups.every(row=>!/(raw-id|foreign-|private\/|other-field)/.test(row.context)));
 const ambiguous=nativeSourceIssueGroups([issue()],{resolved:{schema:{fields:[...view.resolved.schema.fields,{id:'color',label:'다른 의미'}]}}},{members:[...identity.members,{optionId:'first-raw-id',optionLabel:'다른 옵션'}]});assert.equal(ambiguous[0].context,'옵션 확인 필요 · 항목 확인 필요');
});

test('the same visible option label keeps distinct identities and literal messages remain unchanged',()=>{
 const message='<strong>문구</strong> & 원문',groups=nativeSourceIssueGroups([issue({message}),issue({message,optionId:'second-raw-id'})],view,{members:identity.members.map(row=>({...row,optionLabel:'같은 이름'}))});
 assert.equal(groups[0].context,'같은 이름, 같은 이름 · 색상');assert.equal(groups[0].count,2);assert.equal(groups[0].message,message);
});

test('native issue navigation retains each exact current option and category without merging repeated labels',()=>{
 const current={resolved:{schema:{categoryId:'103689',fields:view.resolved.schema.fields},rows:[{optionId:null,optionLabel:'공통',included:false},...identity.members.map(row=>({optionId:row.optionId,optionLabel:'같은 이름',included:true}))]}},source={...identity,categoryId:'103689'};
 const groups=plain(nativeSourceIssueGroups([issue(),issue({optionId:'second-raw-id'}),issue(),issue({optionId:null})],current,source));
 assert.deepEqual(groups[0].targets,[{label:'베이지 · 색상 항목 확인',target:{optionId:'first-raw-id',fieldId:'color',categoryId:'103689'}},{label:'핑크 · 색상 항목 확인',target:{optionId:'second-raw-id',fieldId:'color',categoryId:'103689'}},{label:'상품 공통 · 색상 항목 확인',target:{optionId:null,fieldId:'color',categoryId:'103689'}}]);
 assert.equal(groups[0].count,4);
});

test('unknown, duplicate, excluded or mismatched native issue metadata never produces an edit destination',()=>{
 const current={resolved:{schema:{categoryId:'103689',fields:view.resolved.schema.fields},rows:[{optionId:'first-raw-id',included:true}]}},source={...identity,categoryId:'103689'};
 for(const [candidate,origin,problem]of [
  [current,source,issue({fieldId:'unknown'})],[current,source,issue({optionId:'unknown'})],[current,source,issue({optionId:undefined})],
  [current,null,issue()],[current,{...source,categoryId:'another'},issue()],
  [{resolved:{...current.resolved,rows:[{optionId:'first-raw-id',included:false}]}},source,issue()],
  [{resolved:{...current.resolved,rows:[...current.resolved.rows,...current.resolved.rows]}},source,issue()],
  [{resolved:{...current.resolved,schema:{...current.resolved.schema,fields:[...view.resolved.schema.fields,{id:'color',label:'other'}]}}},source,issue()],
  [current,{...source,members:[...identity.members,identity.members[0]]},issue()],
 ])assert.deepEqual(plain(nativeSourceIssueGroups([problem],candidate,origin))[0].targets,[]);
});
