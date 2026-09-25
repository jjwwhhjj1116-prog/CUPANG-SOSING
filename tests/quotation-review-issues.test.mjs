import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
test('review filters intersect by kind, exact option ID and text while preserving navigation and report',()=>{
 const issues=[
  {kind:'error',optionId:'a',optionLabel:'같은 이름',fieldId:'title',message:'제목 누락',code:'MISSING'},
  {kind:'review',optionId:'b',optionLabel:'같은 이름',fieldId:'material',message:'재질 증빙',code:'EVIDENCE'},
  {kind:'error',optionId:null,optionLabel:'공통',fieldId:null,message:'양식 확인',code:'SCHEMA'},
 ];
 const before=JSON.stringify(issues),slots=[];let cursor=0,disabled=false;const moved=[];
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=v];}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/quotation-review-issues.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:n=>n==='react'?hooks:native(n)});
 const render=()=>{cursor=0;return exports.QuotationReviewIssues({issues,omittedIssueCount:9,disabled,onInspect:t=>moved.push(t)});};
 const change=(index,value)=>nodes(render()).filter(n=>n.type==='select')[index].props.onChange({target:{value}});
 const count=()=>nodes(render()).filter(n=>n.type==='li').length;
 assert.equal(count(),3);change(0,'error');assert.equal(count(),2);change(1,'option:b');assert.equal(count(),0);
 change(0,'review');assert.equal(count(),1);
 const search=value=>nodes(render()).find(n=>n.type==='input').props.onChange({target:{value}});
 search('EVIDENCE');assert.equal(count(),1);search('없는내용');assert.equal(count(),0);search('');
 let button=nodes(render()).filter(n=>n.type==='button').at(-1);button.props.onClick();assert.equal(moved[0].optionId,'b');assert.equal(moved[0].fieldId,'material');
 disabled=true;button=nodes(render()).filter(n=>n.type==='button').at(-1);assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(moved.length,1);
 nodes(render()).find(n=>n.type==='button').props.onClick();assert.equal(count(),3);change(1,'common');assert.equal(count(),1);
 assert.match(JSON.stringify(render()),/검색과 필터는 받은 항목에만/);assert.equal(JSON.stringify(issues),before);
});
