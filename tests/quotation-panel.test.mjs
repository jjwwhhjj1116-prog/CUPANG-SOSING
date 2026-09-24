import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file,dependencies){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,Error,fetch:dependencies.fetch,require(name){if(name in dependencies)return dependencies[name];return require(name);}});return exports;}
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}

test('deleted inspection profile keeps quotation editor and explicit replacement available without writes',async()=>{
 const states=[],effects=[],calls=[];let index=0,first=true;
 const Editor=()=>null;
 const profiles=[{id:'saved',name:'수집 설정',categoryId:'80719',categoryPath:['바스켓'],template:{name:'원본',headerRow:1}},{id:'replacement',name:'대체 설정',categoryId:'80719',categoryPath:['바스켓'],template:{name:'새 원본',headerRow:2}}];
 const selector=load('app/quotation-profile-selection.ts',{});
 const panel=load('app/components/quotation-panel.tsx',{
  react:{useState(initial){const slot=index++;if(slot>=states.length)states.push(initial);return[states[slot],next=>{states[slot]=typeof next==='function'?next(states[slot]):next;}];},useRef(){return{current:null};},useEffect(fn){if(first)effects.push(fn);}},
  '@/app/category-profiles':{quotationStartRow:template=>(template?.headerRow??1)+1},
  '@/app/quotation-profile-selection':selector,
  '@/app/components/quotation-fields-editor':{QuotationFieldsEditor:Editor},
  '@/app/components/quotation-preview-review':{QuotationPreviewReview:()=>null},
  '@/app/components/quotation-mapping-review':{QuotationMappingReview:()=>null},
  fetch:async(url,init)=>{calls.push([url,init?.method??'GET']);return Response.json(url==='/api/category-profiles'?{profiles}:{categoryContext:{profileId:'saved',categoryId:'80719',categoryPath:['수집 당시']}});},
 });
 const render=()=>{index=0;const outer=panel.QuotationPanel({productId:'p',preferredProfileId:'deleted',onManageCategories(){}});const tree=outer.type(outer.props);first=false;return tree;};
 render();effects.forEach(fn=>fn());for(let i=0;i<10;i++)await new Promise(resolve=>setImmediate(resolve));
 let tree=render();assert.match(JSON.stringify(tree),/삭제되었습니다/);
 assert.equal(nodes(tree).find(n=>n.type===Editor).props.profileId,undefined);
 const select=nodes(tree).find(n=>n.type==='select');assert.equal(select.props.value,'');assert.equal(select.props.disabled,false);
 assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.children==='견적 자료 검토').props.disabled,true);
 select.props.onChange({target:{value:'replacement'}});tree=render();
 assert.equal(nodes(tree).find(n=>n.type===Editor).props.profileId,'replacement');
 assert.equal(nodes(tree).find(n=>n.type==='button'&&n.props.children==='견적 자료 검토').props.disabled,false);
 assert.match(nodes(tree).find(n=>n.type==='a'&&String(n.props.href).includes('/bundle')).props.href,/profileId=replacement/);
 assert.doesNotMatch(JSON.stringify(tree),/삭제되었습니다/);
 assert.deepEqual(calls.map(([,method])=>method),['GET','GET']);
});

