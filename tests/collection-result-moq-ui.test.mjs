import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const nativeRequire=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
function fixture(){
 const states=[],refs=[],cleanups=[],calls=[];let stateIndex=0,refIndex=0,first=true;
 const react={useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},
  useRef(initial){const index=refIndex++;return refs[index]??(refs[index]={current:initial});},useEffect(effect){if(first)cleanups.push(effect());}};
 const result={schemaVersion:1,offerId:'754123',title:'합성 MOQ 원문',provider:'synthetic',collectedAt:'2026-01-01T00:00:00Z',sourceUrl:'https://detail.1688.com/offer/754123.html',description:'판매자 설명',
  options:[{sku:'unknown',name:'미확인 옵션',unitPriceCny:2,minimumOrder:null,stock:null},{sku:'known',name:'확인 옵션',unitPriceCny:3,minimumOrder:12,stock:4}],images:[]};
 const fetcher=async(path,init)=>{calls.push({path,init});return Response.json(path.endsWith('/result')?{jobId:'job',offerId:'754123',receipt:{result},message:'수신됨'}:{capacity:{usedSlots:0,totalImages:0,reusableIndices:[]}});};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,Error,URL,AbortController,setTimeout,clearTimeout,fetch:fetcher,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return nativeRequire(name);
   if(name==='@/app/collection-import')return{runCollectionImport:()=>assert.fail('reading source facts never imports a product')};return load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts'));}});return exports;}
 const component=load('app/components/collection-result-panel.tsx');
 const render=()=>{stateIndex=0;refIndex=0;const root=component.CollectionResultPanel({jobId:'job',offerId:'754123',onSaved:()=>assert.fail('reading source facts never saves a product')});const tree=root.type(root.props);first=false;return tree;};
 return{render,calls,close:()=>cleanups.forEach(cleanup=>cleanup?.())};
}
test('receipt renders unknown MOQ as 미확인 and preserves a known quantity without importing or submitting',async()=>{
 const h=fixture();
 try{
  const button=nodes(h.render()).find(node=>node.type==='button'&&text(node)==='수신 결과 조회');button.props.onClick();
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  const tbody=nodes(h.render()).find(node=>node.type==='tbody');assert.ok(tbody);
  const rows=nodes(tbody).filter(node=>node.type==='tr').map(row=>nodes(row).filter(node=>node.type==='td').map(text));
  assert.equal(rows.length,2);assert.equal(rows[0][5],'미확인');assert.equal(rows[1][5],'12');assert.equal(rows[0][4],'2');assert.equal(rows[1][4],'3');
  assert.deepEqual(h.calls.map(call=>[call.path,call.init?.method??'GET']),[['/api/collection-jobs/job/result','GET'],['/api/collection-jobs/job/capacity','GET']]);
 }finally{h.close();}
});
