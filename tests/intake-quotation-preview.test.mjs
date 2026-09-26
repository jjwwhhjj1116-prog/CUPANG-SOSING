import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const native=createRequire(import.meta.url),cache=new Map();
function load(file,overrides={}){
 if(!Object.keys(overrides).length&&cache.has(file))return cache.get(file);
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,structuredClone,require(name){
  if(name in overrides)return overrides[name];
  if(name.startsWith('@/')){const path=name.slice(2);return load(path+(fs.existsSync(new URL('../'+path+'.ts',import.meta.url))?'.ts':'.tsx'));}
  if(name.endsWith('.css'))return{};return native(name);
 }});if(!Object.keys(overrides).length)cache.set(file,exports);return exports;
}
const profile={id:'saved',name:'주방 설정',categoryId:'80719',categoryPath:['주방용품','바스켓'],revision:2,template:null,mappings:[]};
test('queue quotation preview shows actual mappings, missing columns and observed defaults without mutating settings',()=>{
 const {IntakeQuotationPreview}=load('app/components/intake-quotation-preview.tsx');
 const data={...profile,template:{name:'검토.xlsx',format:'xlsx',sheetName:'입력',headerRow:4,headers:['상품명','고정','미연결']},mappings:[{column:0,field:'title',required:true},{column:1,field:'constant',constant:'<script>내용</script>',required:false}]};
 const before=JSON.stringify(data);const html=renderToStaticMarkup(React.createElement(IntakeQuotationPreview,{profile:data}));
 assert.match(html,/검토.xlsx/);assert.match(html,/입력 시작 5행/);assert.match(html,/연결 없음/);assert.match(html,/해당사항없음/);assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('<script>'));assert.equal(JSON.stringify(data),before);
 const noTemplate=renderToStaticMarkup(React.createElement(IntakeQuotationPreview,{profile:{...profile,categoryId:'unknown'}}));assert.match(noTemplate,/원본 Excel 양식은 연결되지/);assert.match(noTemplate,/미확인 · 임의 기본값 없음/);
});
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
test('quotation preview filters required and observed defaults, searches choice labels and preserves the schema',()=>{
 const slots=[];let cursor=0;
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],value=>{slots[i]=value;}];}};
 const {CategoryQuotationPreview}=load('app/components/category-quotation-preview.tsx',{react:hooks});
 const schema=load('app/quotation-schema.ts').getQuotationSchema('80719');const before=JSON.stringify(schema);
 const render=()=>{cursor=0;return CategoryQuotationPreview({schema});};
 const rows=tree=>nodes(tree).filter(n=>n.type==='tr'&&n.key!==null);
 let tree=render();assert.equal(rows(tree).length,schema.fields.length);
 const filter=value=>{nodes(tree).find(n=>n.type==='select').props.onChange({target:{value}});tree=render();};
 filter('required');assert.equal(rows(tree).length,schema.fields.filter(f=>f.required).length);
 filter('linked');const {quotationInputLink}=load('app/quotation-input-links.ts');assert.equal(rows(tree).length,schema.fields.filter(f=>quotationInputLink(f)!==null).length);assert.match(JSON.stringify(tree),/1단계 SEO 상품명/);assert.match(JSON.stringify(tree),/6단계 재질/);
 filter('known');const known=rows(tree).length;assert.ok(known>0);
 filter('unknown');assert.equal(rows(tree).length,schema.fields.length-known);
 filter('all');nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:'뚜껑'}});tree=render();assert.ok(rows(tree).length>0);assert.ok(rows(tree).length<schema.fields.length);
 nodes(tree).find(n=>n.type==='input').props.onChange({target:{value:'__no_match__'}});tree=render();assert.equal(rows(tree).length,0);
 assert.match(JSON.stringify(tree),/일치하는 항목이 없습니다/);
 nodes(tree).find(n=>n.type==='button').props.onClick();tree=render();assert.equal(rows(tree).length,schema.fields.length);
 assert.equal(JSON.stringify(schema),before);
});
test('opening preview and changing category preserves row URL and notes and displays the newly selected profile',()=>{
 let rows=[{id:'row',profile,url:'https://detail.1688.com/offer/1.html',features:'특징',keywords:'검색어',status:'error',message:'이전 오류'}];
 const slots=[];let cursor=0;const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(){}};
 function Picker(){}function Preview(){}
 const {IntakeQueuePanel}=load('app/components/intake-queue-panel.tsx',{'react':hooks,'@/app/components/category-picker':{CategoryPicker:Picker},'@/app/components/intake-quotation-preview':{IntakeQuotationPreview:Preview}});
 const render=()=>{cursor=0;return IntakeQueuePanel({rows,onRows:update=>{rows=update(rows);},profiles:[profile],onProfile(){},onJobs(){},onBusy(){},goal:'price',onGoal(){}});};
 let tree=render();nodes(tree).find(n=>n.type==='button'&&n.props.children==='견적 항목·양식 확인').props.onClick();tree=render();assert.equal(nodes(tree).find(n=>n.type===Preview).props.profile,profile);
 nodes(tree).find(n=>n.props?.className==='intake-category-button').props.onClick();tree=render();const next={...profile,categoryId:'77442',revision:3};nodes(tree).find(n=>n.type===Picker).props.onSelected(next);
 tree=render();assert.equal(nodes(tree).find(n=>n.type===Preview).props.profile,next);assert.equal(rows[0].url,'https://detail.1688.com/offer/1.html');assert.equal(rows[0].features,'특징');assert.equal(rows[0].keywords,'검색어');assert.equal(rows[0].status,'draft');
});

test('queue starts with add button and retains selection while filtering rows',()=>{
 let rows=[];const slots=[];let cursor=0;
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(){}};
 function Picker(){}function Preview(){}
 const {IntakeQueuePanel}=load('app/components/intake-queue-panel.tsx',{'react':hooks,'@/app/components/category-picker':{CategoryPicker:Picker},'@/app/components/intake-quotation-preview':{IntakeQuotationPreview:Preview}});
 const render=()=>{cursor=0;return IntakeQueuePanel({rows,onRows:update=>{rows=update(rows);},profiles:[profile],onProfile(){},onJobs(){},onBusy(){},goal:'price',onGoal(){}});};
 let tree=render();assert.ok(!nodes(tree).some(n=>n.type===Picker));
 nodes(tree).find(n=>n.type==='button'&&n.props.children==='＋ 상품 추가').props.onClick();tree=render();assert.ok(nodes(tree).some(n=>n.type===Picker));
 nodes(tree).find(n=>n.type==='button').props.onClick();
 rows=[{id:'a',profile,url:'https://detail.1688.com/offer/1.html',features:'red',keywords:'',status:'draft',message:''},{id:'b',profile,url:'https://detail.1688.com/offer/2.html',features:'blue',keywords:'',status:'draft',message:''}];tree=render();
 const get=(label)=>nodes(tree).find(n=>n.props?.['aria-label']===label);
 get('2번째 상품 선택').props.onChange({target:{checked:false}});tree=render();assert.equal(get('2번째 상품 선택').props.checked,false);
 get('상품 대기열 검색').props.onChange({target:{value:'blue'}});tree=render();assert.ok(!get('1번째 상품 선택'));assert.equal(get('2번째 상품 선택').props.checked,false);assert.match(JSON.stringify(tree),/검색으로 숨겨진 선택 상품/);
 get('검색 결과 전체 선택').props.onChange({target:{checked:true}});tree=render();assert.equal(get('2번째 상품 선택').props.checked,true);
 get('상품 대기열 검색').props.onChange({target:{value:''}});tree=render();assert.equal(get('1번째 상품 선택').props.checked,true);assert.equal(get('2번째 상품 선택').props.checked,true);
 assert.equal(rows[0].features,'red');assert.equal(rows[1].features,'blue');
});
