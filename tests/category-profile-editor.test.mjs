import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto,createHash} from 'node:crypto';
const nativeRequire=createRequire(import.meta.url);
function load(file,dependencies={},cache=new Map()){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  const output=ts.transpileModule(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(output,{exports,Error,structuredClone,TextEncoder,TextDecoder,FormData,crypto:webcrypto,fetch:dependencies.fetch,require(name){
    if(name in dependencies)return dependencies[name];if(name==='react/jsx-runtime')return nativeRequire(name);
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts',dependencies,cache);if(name.startsWith('./'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts',dependencies,cache);throw Error(name);
  }});return exports;
}
const stamp='2026-09-22T00:00:00.000Z';
const profile={id:'profile',revision:1,name:'시험 분류',categoryId:'80719',categoryPath:['주방용품'],verification:'draft',createdAt:stamp,updatedAt:stamp,
  template:{name:'saved.csv',format:'csv',sha256:'a'.repeat(64),sheetName:'',headerRow:1,headers:['상품명','뚜껑 포함여부','공급가'],storageKey:'owner/category-templates/saved.csv'},
  mappings:[{column:0,field:'constant',required:true,constant:'수동 연결'},{column:2,field:'supplyPrice',required:false}]};
function nodes(tree){if(Array.isArray(tree))return tree.flatMap(nodes);if(!tree||typeof tree!=='object')return[];return[tree,...nodes(tree.props?.children)];}
function harness(value=profile,getSaved=async()=>new Response('상품명,뚜껑 포함여부,공급가\n')){
  const states=[],refs=[],effects=[],saved=[];let index=0,refIndex=0,first=true;const hooks={
    useState(initial){const slot=index++;if(slot>=states.length)states.push(typeof initial==='function'?initial():initial);return[states[slot],next=>{states[slot]=typeof next==='function'?next(states[slot]):next;}];},
    useRef(initial){const slot=refIndex++;if(slot>=refs.length)refs.push({current:initial});return refs[slot];},useEffect(effect){if(first)effects.push(effect);},
  };
  const editor=load('app/components/category-profile-editor.tsx',{react:hooks,
    '@/app/xlsx-template':{inspectXlsx:async()=>({sheets:[{name:'old-sheet',rows:[{rowNumber:1}]}],warnings:[]}),xlsxHeaders:()=>['옛 필드']},
    fetch:async(url,options)=>{
      if(url.startsWith('/api/category-profiles/template?'))return getSaved();
      if(url==='/api/category-profiles/template'&&options?.method==='POST'){
        const file=options.body.get('file');const bytes=new Uint8Array(await file.arrayBuffer());const hash=createHash('sha256').update(bytes).digest('hex');
        return Response.json({template:{sha256:hash,storageKey:`owner/category-templates/${hash}.csv`}});
      }
      if(url==='/api/category-profiles'){const body=JSON.parse(options.body);saved.push(body.profile);return Response.json({profile:{...value,...body.profile}});}
      throw Error(url);
    }});
  const render=()=>{index=0;refIndex=0;const tree=editor.CategoryProfileEditor({value,onSave(){},onClose(){}});first=false;return tree;};render();
  const find=predicate=>{const node=nodes(render()).find(predicate);assert.ok(node,'Expected editor element');return node;};
  return{render,find,saved,startEffects:()=>effects.forEach(effect=>effect()),async upload(text){find(node=>node.type==='input'&&node.props.type==='file').props.onChange({target:{files:[new File([text],'replacement.csv',{type:'text/csv'})],value:'chosen'}});for(let i=0;i<200;i++){await new Promise(resolve=>setTimeout(resolve,1));if(!find(node=>node.type==='input'&&node.props.type==='file').props.disabled)return;}throw Error('upload did not complete');},async save(){await render().props.onSubmit({preventDefault(){}});assert.equal(saved.length,1);return saved[0];}};
}

test('auto-fill preserves existing manual columns while a new template discards stale positions',async()=>{
  const h=harness();h.find(node=>node.type==='button'&&node.props.children==='미연결 열 자동 연결').props.onClick();
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.value,'constant');
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='2열 연결').props.value,'lidIncluded');
  assert.equal(h.find(node=>node.type==='input'&&node.props['aria-label']==='1열 고정값').props.value,'수동 연결');
  await h.upload('상품명\n');const saved=await h.save();
  assert.equal(saved.template.headers.length,1);assert.deepEqual(saved.mappings,[{column:0,field:'title',required:true}]);
});

test('changing a CSV header row reparses the actual source and leaves unchanged row manual mappings intact',async()=>{
  const h=harness();await h.upload('원본 안내,값\n상품명,공급가\n');
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.value,'title');
  assert.equal(h.find(node=>node.type==='select'&&node.props['aria-label']==='2열 연결').props.value,'supplyPrice');
  h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.onChange({target:{value:'constant'}});
  h.find(node=>node.type==='input'&&node.props['aria-label']==='1열 고정값').props.onChange({target:{value:'보존'}});
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  const saved=await h.save();assert.equal(saved.template.headerRow,2);assert.deepEqual(saved.template.headers,['상품명','공급가']);assert.equal(saved.mappings[0].constant,'보존');
});

test('a late saved-XLSX fetch cannot replace a newly uploaded CSV source or reintroduce old columns',async()=>{
  let finish;const pending=new Promise(resolve=>{finish=resolve;});
  const h=harness({...profile,template:{...profile.template,format:'xlsx',name:'old.xlsx',sheetName:'old-sheet'}},()=>pending);h.startEffects();
  await h.upload('안내\n상품명,공급가\n');finish(new Response(new Uint8Array([1,2,3])));await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(nodes(h.render()).filter(node=>node.type==='option'&&node.props.value==='old-sheet').length,0);
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  const saved=await h.save();assert.equal(saved.template.name,'replacement.csv');assert.equal(saved.template.format,'csv');assert.equal(saved.template.sheetName,'');assert.deepEqual(saved.template.headers,['상품명','공급가']);
});

test('changing actual header rows keeps manual constants and explicit disconnections at their new positions',async()=>{
  const h=harness();await h.upload('상품명,공급가,판매가\n판매가,상품명,공급가\n');
  h.find(node=>node.type==='select'&&node.props['aria-label']==='1열 연결').props.onChange({target:{value:'constant'}});
  h.find(node=>node.type==='input'&&node.props['aria-label']==='1열 고정값').props.onChange({target:{value:'그대로 저장'}});
  h.find(node=>node.type==='select'&&node.props['aria-label']==='3열 연결').props.onChange({target:{value:''}});
  h.find(node=>node.type==='input'&&node.props.type==='number').props.onChange({target:{value:'2'}});
  const saved=await h.save();
  assert.deepEqual(saved.mappings,[{column:1,field:'constant',required:true,constant:'그대로 저장'},{column:2,field:'supplyPrice',required:true}]);
  assert.equal(saved.template.headerRow,2);
});
