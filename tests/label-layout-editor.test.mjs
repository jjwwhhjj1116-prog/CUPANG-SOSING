import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];

test('label editor saves order and hidden state, restores layout and preserves unsaved SEO text',async()=>{
 const slots=[],effects=[],cache=new Map();let index=0,first=true,saved,posted;
 const hooks={useState(initial){const slot=index++;if(!(slot in slots))slots[slot]=typeof initial==='function'?initial():initial;return[slots[slot],next=>{slots[slot]=typeof next==='function'?next(slots[slot]):next;}];},useRef(initial){const slot=index++;return slots[slot]??(slots[slot]={current:initial});},useCallback:fn=>fn,useEffect(fn){if(first)effects.push(fn);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,AbortController,structuredClone,TextEncoder,Error,fetch:async(_url,init)=>{if(init?.method==='PATCH'){posted=JSON.parse(init.body);saved=model.applyContentPatch(saved,posted.patch,'now');}return Response.json({content:saved});},require(name){if(name==='react')return hooks;if(name.startsWith('@/'))return load(name.slice(2)+(/components\//.test(name)?'.tsx':'.ts'));return require(name);}});return exports;}
 const model=load('app/product-content.ts');saved=model.emptyProductContent('p');saved.label.material.value='면';
 const {ProductContentEditor}=load('app/components/product-content-editor.tsx');
 const render=(section='표시사항')=>{index=0;const outer=ProductContentEditor({product:{id:'p',title:'상품',image_keys:'[]'},section});const tree=outer.type(outer.props);first=false;return tree;};
 const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
 render();effects.forEach(fn=>fn());await settle();
 let tree=render('SEO');nodes(tree).find(n=>n.type==='input'&&n.props.maxLength===500).props.onChange({target:{value:'저장 전 SEO'}});
 tree=render();nodes(tree).find(n=>n.props?.['aria-label']==='재질 위로').props.onClick();
 tree=render();const material=nodes(tree).find(n=>n.type==='div'&&n.key==='material');nodes(material).find(n=>n.type==='input').props.onChange({target:{checked:false}});
 tree=render();const save=nodes(tree).find(n=>n.type==='button'&&n.props.children==='표시사항 저장');assert.equal(save.props.disabled,false);save.props.onClick();await settle();
 assert.equal(posted.patch.labelLayout.order[1],'material');assert.deepEqual(posted.patch.labelLayout.hidden,['material']);assert.equal(saved.label.material.value,'면');assert.equal(posted.patch.seo,undefined);
 assert.equal(nodes(render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.value,'저장 전 SEO');
 tree=render();nodes(tree).find(n=>n.type==='button'&&n.props.children==='기본 순서·전체 표시로 복원').props.onClick();
 nodes(render()).find(n=>n.type==='button'&&n.props.children==='표시사항 저장').props.onClick();await settle();assert.deepEqual(posted.patch.labelLayout.hidden,[]);assert.equal(saved.label.material.value,'면');
 const custom=nodes(render()).find(n=>n.type?.name==='CustomLabelEditor');custom.props.onChange([{id:'custom-a',name:'추가 항목',value:'보관 내용',visible:false}]);
 assert.equal(nodes(render()).find(n=>n.type==='button'&&n.props.children==='표시사항 저장').props.disabled,false);
 nodes(render()).find(n=>n.type==='button'&&n.props.children==='표시사항 저장').props.onClick();await settle();assert.equal(saved.customLabels[0].value,'보관 내용');assert.equal(saved.customLabels[0].visible,false);
 assert.equal(nodes(render('SEO')).find(n=>n.type==='input'&&n.props.maxLength===500).props.value,'저장 전 SEO');
 nodes(render()).find(n=>n.type?.name==='CustomLabelEditor').props.onChange([]);nodes(render()).find(n=>n.type==='button'&&n.props.children==='표시사항 저장').props.onClick();await settle();assert.deepEqual(posted.patch.customLabels,[]);
});
