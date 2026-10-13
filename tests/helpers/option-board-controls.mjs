import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {workspaceRefreshFixture,workspaceRefreshUI,companies,json,nodes,text} from './workspace-product-refresh.mjs';

export {workspaceRefreshUI,companies,json,nodes,text};
const native=createRequire(import.meta.url),fixtureModuleUrl=new URL('../product-option-board.test.mjs',import.meta.url).href;
const source=fs.readFileSync(new URL(fixtureModuleUrl),'utf8'),ast=ts.createSourceFile('product-option-board.test.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const names=new Set(['load','boardFields','quotation','data','tree','nodes','byLabel','text']);
const declarations=ast.statements.filter(node=>ts.isFunctionDeclaration(node)?names.has(node.name?.text):ts.isVariableStatement(node)&&node.declarationList.declarations.some(item=>ts.isIdentifier(item.name)&&names.has(item.name.text))).map(node=>node.getText(ast).replaceAll('import.meta.url','fixtureModuleUrl')).join('\n');
// Use the real component and the prior test's fixture renderer only. Importing
// the test itself would also register unrelated tests and inflate this group.
const makeBoard=vm.runInNewContext('(function(){'+declarations+';return {tree,data,quotation};})()',
 {assert,fs,vm,ts,native,fixtureModuleUrl,URL,fetch,AbortController,renderToStaticMarkup});
export const byLabel=(tree,label)=>nodes(tree).find(node=>node.props?.['aria-label']===label);
export const optionRows=tree=>nodes(tree).filter(node=>node.type==='tr'&&node.props?.['data-option-id']);
export function boardControlsUI(count=123){
 const sourceRow=makeBoard.data.options.rows[0];
 const rows=Array.from({length:count},(_,index)=>({...sourceRow,id:'option-'+String(index).padStart(3,'0'),originalName:'Synthetic '+index,translatedName:'검토 옵션 '+index,supplierSku:'SKU-'+index}));
 const data={...makeBoard.data,options:{...makeBoard.data.options,rows},pricing:{rows:[]}};
 return {...makeBoard.tree('',undefined,data,[],undefined,0,{stage:true,manage:true}),data};
}
export async function optionBoardControlsFixture(company,{count=73}={}){
 const f=await workspaceRefreshFixture(company);
 try{
  const saved=(await json(await f.route(f.base+'/options'))).options;
  const rows=Array.from({length:count},(_,index)=>({...saved.rows[index%saved.rows.length],
   id:'control-'+String(index).padStart(3,'0'),supplierSku:'SYNTHETIC-649-'+index,
   originalName:'Synthetic table option '+String(index).padStart(3,'0'),translatedName:company.name+' 합성 옵션 '+index,
   provenance:{...saved.rows[index%saved.rows.length].provenance,translatedName:'manual'}}));
  // Seed owned SQLite fixtures before the immutable baseline. UI actions below
  // are strictly reads; no application write endpoint is enabled or exercised.
  f.sqlite.prepare('UPDATE product_options SET payload=?,revision=? WHERE product_id=? AND owner_id=?').run(JSON.stringify({...saved,revision:saved.revision+1,rows}),saved.revision+1,f.product.id,'owner');
  f.sqlite.prepare('UPDATE products SET options_count=? WHERE id=? AND owner_id=?').run(count,f.product.id,'owner');
  return {...f,controlRows:rows};
 }catch(error){f.close();throw error;}
}
export async function focusControlsUI(count=73){
 const base=boardControlsUI(count).data,slots=[],effects=[],focused=[],calls=[];
 let cursor=0,tree,loadedData=base,hidden=false,handled=0,refreshToken='initial',returnFocus;
 const content={productId:'p1',schemaVersion:1,revision:2,assets:{main:{value:[]}}};
 const fetcher=async(path,init)=>{calls.push({path,method:init?.method??'GET'});return Response.json(path.endsWith('/options')?loadedData:path.endsWith('/content')?{content}:makeBoard.quotation(2,[],content,loadedData));};
 const document={querySelectorAll(){return[{dataset:{productId:'p1'},closest(){return hidden?{}:null;},querySelectorAll(){return nodes(tree).filter(node=>node.type==='button').map(node=>({getAttribute:key=>node.props[key]??null,textContent:text(node),focus:()=>focused.push(node.props['aria-label']??text(node))}));}}];}};
 const hooks={useState(initial){const index=cursor++;if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};return[slots[index].value,value=>{slots[index].value=typeof value==='function'?value(slots[index].value):value;}];},useEffect(effect,deps){const index=cursor++,slot=slots[index],changed=!slot||deps.some((value,i)=>!Object.is(value,slot.deps[i]));if(changed){slots[index]={deps,cleanup:slot?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=effect();});}}};
 function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {exports,URL,fetch:fetcher,AbortController,document,require(name){if(name==='react')return hooks;if(name.endsWith('.css'))return{};if(name.startsWith('@/'))return load(name.slice(2)+'.ts');return native(name);}});return exports;}
 const Board=load('app/components/product-option-board.tsx').ProductOptionBoard;
 let onReturnFocusHandled=()=>{handled++;returnFocus=undefined;};
 const render=()=>{cursor=0;tree=Board({productId:'p1',sourceUrl:'',imageKeys:'[]',refreshToken,returnFocus,onReturnFocusHandled,onStage(){},onEdit(){},onQuotation(){}});return tree;};
 const settle=async()=>{for(let i=0;i<8;i++){render();effects.splice(0).forEach(effect=>effect());await new Promise(done=>setImmediate(done));}return tree;};
 await settle();
 return{render,settle,focused,calls,get handled(){return handled;},setReturnFocus(value){returnFocus=value;},setHidden(value){hidden=value;onReturnFocusHandled=()=>{handled++;returnFocus=undefined;};},
  refresh(rows){loadedData={...base,options:{...base.options,rows}};refreshToken+=':next';},rows:base.options.rows,
  close(){slots.forEach(slot=>slot?.cleanup?.());}};
}
