import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';

const fixturePath='tests/option-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath),fixtureText=fs.readFileSync(fixtureURL,'utf8');
const ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let source=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','imageUI','dragTransfer','dragEvent'].includes(node.name?.text)).map(node=>{
 let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return value;
}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
source=source.replace('confirmImage=()=>true,onTranslate,onEdit}={})','confirmImage=()=>true,onTranslate,onEdit,sidebarActions,uploadControl}={})').replace('disabled,onTranslate,onEdit,onSaved(){','disabled,onTranslate,onEdit,sidebarActions,uploadControl,onSaved(){');
source=source.replaceAll('(type,props)=>({type,props})','(type,props,key)=>({type,props,key})');
source+='\nexport {fixture,imageUI,nodes,text,deferred,plain};';
const {fixture,imageUI,nodes,text,deferred,plain}=await import('data:text/javascript,'+encodeURIComponent(source));
const exposed=value=>Array.isArray(value)?value.flatMap(exposed):value&&typeof value==='object'&&!value.props?.hidden?[value,...exposed(value.type==='details'&&!value.props.open?(Array.isArray(value.props.children)?value.props.children:[value.props.children]).filter(child=>child?.type==='summary'):value.props?.children)]:[];
const gallery=h=>nodes(h.render()).find(node=>node.props?.className==='image-asset-grid option-additional-gallery');
const captions=h=>exposed(gallery(h)).filter(node=>node.type==='span').map(text);
const writes=h=>h.calls.filter(call=>call.init?.method&&call.init.method!=='GET');
function withLibrary(f){
 const field={id:'mainImage',label:'대표 이미지',type:'images',section:'image',required:false,visibility:'common',maxItems:1};
 f.view.resolved.schema.fields.push(field);f.view.automatic.schema.fields=f.view.resolved.schema.fields;
 for(const part of ['resolved','automatic']){
  for(const row of f.view[part].rows)row.fields.mainImage={value:f.keys[0],source:'content',validationIssues:[]};
  f.view[part].rows.unshift({optionId:null,optionLabel:'공통',included:true,fields:{mainImage:{value:f.keys[0],source:'content',validationIssues:[]}}});
 }
 const content={content:{schemaVersion:1,productId:'p',revision:f.view.contentRevision,assets:{}}};
 const options={productVersion:f.view.productVersion,options:{schemaVersion:1,productId:'p',revision:f.view.optionRevision,rows:[{id:'red',imageKey:f.keys[0]},{id:'blue',imageKey:f.keys[1]}]},imageLibrary:{format:'main-image-library-evidence-v1',productId:'p',productVersion:f.view.productVersion,optionRevision:f.view.optionRevision,company:{code:'A01526306',name:'유앤채'},source:{jobId:'source-fixture',receivedAt:f.view.productVersion,fingerprint:'b'.repeat(64)},work:[],main:f.keys.slice(0,3),options:[f.keys[0]],detail:[f.keys[3]]}};
 return {content,options,reply:(url,init)=>url.endsWith('/content')?Response.json(content):url.endsWith('/options')?Response.json(options):f.reply(url,init)};
}

test('additional sidebar uses authenticated original and saved role groups without changing image choices',async()=>{
 const f=fixture(),library=withLibrary(f),before=plain(f.view),slot={type:'button',props:{children:'batch fixture',onClick(){throw Error('mount cannot invoke sidebar action');}}};
 const h=imageUI(library.reply,{saveOnChange:true,sidebarActions:slot});
 try{
  await h.idle();assert.deepEqual(captions(h),['메인 이미지','메인 이미지','추가 이미지']);
  assert.ok(exposed(h.render()).some(node=>node.type==='h4'&&text(node)==='이미지 대체'));
  const footer=nodes(h.render()).find(node=>node.props?.className==='option-additional-sidebar-actions');assert.ok(footer);
  assert.equal(nodes(footer).filter(node=>node.type==='button'&&text(node)==='batch fixture').length,1);
  assert.equal(nodes(footer).filter(node=>node.type==='button'&&node.props['aria-label']==='선택 옵션 이미지 저장').length,1);
  assert.equal(text(h.button('선택 옵션 이미지 저장')),'저장');assert.equal(h.button('선택 옵션 이미지 저장').props.disabled,true);
  const all=nodes(gallery(h)).find(node=>node.type==='details');assert.ok(all&&!all.props.open);assert.match(text(all),/전체 저장 이미지 · 4개/);
  assert.equal(text(h.render()).includes('텍스트 제거됨'),false);assert.deepEqual(h.ordered(),[f.keys[1]]);
  await h.click('상품 저장 이미지 3 크게 보기');assert.deepEqual(h.ordered(),[f.keys[1]]);assert.deepEqual(plain(f.view),before);assert.equal(writes(h).length,0);
  assert.equal(h.calls.filter(call=>call.url.endsWith('/content')).length,1);assert.equal(h.calls.filter(call=>call.url.endsWith('/options')).length,1);
 }finally{h.close();}
});

test('missing role evidence stays unclassified and an explicit blank is never populated on open',async()=>{
 const f=fixture();for(const row of f.view.resolved.rows)if(row.optionId==='red')for(const key of ['additionalImages','wire-additionalImages'])row.fields[key].value='';
 for(const key of ['additionalImages','wire-additionalImages'])f.view.overrides.options.red[key]='';
 const before=plain(f.view),h=imageUI((url,init)=>f.reply(url,init),{saveOnChange:true});
 try{await h.idle();assert.deepEqual(captions(h),Array(4).fill('저장 이미지'));assert.deepEqual(h.ordered(),[]);assert.equal(writes(h).length,0);assert.deepEqual(plain(f.view),before);}finally{h.close();}
});

test('delayed old-source library replies cannot relabel a new scope or publish after unmount',async()=>{
 for(const mode of ['scope','unmount']){
  const f=fixture(),library=withLibrary(f),pending=deferred();let held;
  const h=imageUI(async(url,init)=>{const response=library.reply(url,init);if(url.endsWith('/content')){held=init.signal;await pending.promise;}return response;},{saveOnChange:true});
  try{await h.idle();assert.ok(held);if(mode==='scope')h.source('2026-10-08T00:00:00.000Z');else h.close();pending.resolve();await new Promise(resolve=>setImmediate(resolve));if(mode==='scope'){await h.idle();assert.ok(!captions(h).includes('메인 이미지'));}assert.equal(held.aborted,true);assert.equal(h.lateWrites,0);assert.equal(writes(h).length,0);}finally{pending.resolve();h.close();}
 }
});

test('the sidebar batch child keeps its mounted recovery instance while loading, navigating away and returning through an error',async()=>{
 const f=fixture(),hold=deferred(),Batch=()=>null,slot={type:Batch,key:'retained-batch',props:{}};
 let releaseRead=false,treeInstance=null,mounts=0,unmounts=0;
 const h=imageUI(async(url,init)=>{if(!releaseRead)await hold.promise;return f.reply(url,init);},{saveOnChange:true,sidebarActions:slot});
 const locate=(node,path='root')=>{if(Array.isArray(node))return node.flatMap((child,index)=>locate(child,path+'/'+index));if(!node||typeof node!=='object')return[];if(node.type===Batch)return[path];return locate(node.props?.children,path+'/'+String(node.type));};
 function reconcile(){const paths=locate(h.render());assert.equal(paths.length,1,'the original batch component must remain mounted even without a quotation view');const path=paths[0];if(treeInstance?.path!==path){if(treeInstance)unmounts++;treeInstance={path,recovery:{pending:'unknown-ACK'}};mounts++;}return treeInstance;}
 try{
  const original=reconcile();releaseRead=true;hold.resolve();await h.idle();assert.equal(reconcile(),original);
  h.active(false);assert.equal(reconcile(),original);h.saveMode(false);assert.equal(reconcile(),original);h.disabled(true);assert.equal(reconcile(),original);
  h.select('missing-option');assert.equal(reconcile(),original);await h.idle();assert.equal(reconcile(),original,'a failed read keeps recovery state mounted');
  h.select('red');h.disabled(false);h.saveMode(true);h.active(true);await h.idle();assert.equal(reconcile(),original);
  assert.equal(treeInstance.recovery.pending,'unknown-ACK');assert.equal(mounts,1);assert.equal(unmounts,0);assert.equal(writes(h).length,0);
 }finally{hold.resolve();h.close();}
});

test('repeated saved slots retain their exact strip while the candidate gallery has unique role keys',async()=>{
 const f=fixture();for(const row of f.view.resolved.rows)if(row.optionId==='red')for(const key of ['additionalImages','wire-additionalImages'])row.fields[key].value=[f.keys[1],f.keys[1]].join('\n');
 for(const key of ['additionalImages','wire-additionalImages'])f.view.overrides.options.red[key]=[f.keys[1],f.keys[1]].join('\n');
 const library=withLibrary(f),before=plain(f.view),h=imageUI(library.reply,{saveOnChange:true});
 try{await h.idle();const cards=gallery(h).props.children[0],keys=cards.map(card=>card.key);assert.equal(new Set(keys).size,keys.length,'candidate siblings need unique role/key identities');assert.deepEqual(captions(h),['메인 이미지','메인 이미지','추가 이미지']);assert.deepEqual(h.ordered(),[f.keys[1],f.keys[1]]);assert.deepEqual(plain(f.view),before);assert.equal(writes(h).length,0);}finally{h.close();}
});

test('the upload queue keeps its mounted pending attachment state while inactive, loading and recovering a failed source read',async()=>{
 const f=fixture(),hold=deferred(),Upload=()=>null,slot={type:Upload,key:'retained-upload',props:{}};let releaseRead=false,instance;
 const h=imageUI(async(url,init)=>{if(!releaseRead)await hold.promise;return f.reply(url,init);},{saveOnChange:true,uploadControl:slot});
 const locate=(node,path='root')=>{if(Array.isArray(node))return node.flatMap((child,index)=>locate(child,path+'/'+index));if(!node||typeof node!=='object')return[];if(node.type===Upload)return[path];return locate(node.props?.children,path+'/'+String(node.type));};
 function reconcile(){const paths=locate(h.render());assert.equal(paths.length,1);const path=paths[0];if(!instance)instance={path,pending:'uncertain-attachment'};assert.equal(path,instance.path,'tab presentation cannot move/remount the upload queue');assert.equal(instance.pending,'uncertain-attachment');}
 try{reconcile();releaseRead=true;hold.resolve();await h.idle();reconcile();h.active(false);reconcile();h.saveMode(false);reconcile();h.select('missing-option');reconcile();await h.idle();reconcile();h.select('red');h.saveMode(true);h.active(true);await h.idle();reconcile();assert.equal(writes(h).length,0);}finally{hold.resolve();h.close();}
});
