import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';
const fixturePath='tests/option-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath),fixtureText=fs.readFileSync(fixtureURL,'utf8');
const ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let source=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','imageUI','dragTransfer','dragEvent'].includes(node.name?.text)).map(node=>{let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return value;}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
source=source.replace('confirmImage=()=>true,onTranslate,onEdit}={})','confirmImage=()=>true,onTranslate,onEdit,primaryDetailTools=true,uploadControl,detailToolbarActions}={})').replace('disabled,onTranslate,onEdit,onSaved(){','disabled,onTranslate,onEdit,primaryDetailTools,uploadControl,detailToolbarActions,onSaved(){');
source+='\nexport {fixture,imageUI,nodes,text,deferred};';
const {fixture,imageUI,nodes,deferred}=await import('data:text/javascript,'+encodeURIComponent(source));
const header=h=>nodes(h.render()).find(node=>node.props?.className==='option-detail-primary-header');
const locate=(node,type,path='root')=>Array.isArray(node)?node.flatMap((child,index)=>locate(child,type,path+'/'+index)):node&&typeof node==='object'?node.type===type?[path]:locate(node.props?.children,type,path+'/'+String(node.type)):[];

test('one detail toolbar retains upload and batch instances before the view loads, through inactive navigation and failed source reads',async()=>{
 const f=fixture(),hold=deferred(),Upload=()=>null,Batch=()=>null,upload={type:Upload,props:{}},batch={type:Batch,props:{}};let ready=false;
 const h=imageUI(async(url,init)=>{if(!ready)await hold.promise;return f.reply(url,init);},{stage:'detail',uploadControl:upload,detailToolbarActions:batch});
 const stable=new Map();function check(){assert.ok(header(h));for(const type of [Upload,Batch]){const paths=locate(h.render(),type);assert.equal(paths.length,1,'one mounted '+type.name);if(!stable.has(type))stable.set(type,paths[0]);assert.equal(paths[0],stable.get(type),'same React parent path for '+type.name);}}
 try{check();ready=true;hold.resolve();await h.idle();check();h.active(false);check();h.select('invalid');check();await h.idle();check();h.select('red');h.active(true);await h.idle();check();assert.equal(h.calls.some(call=>call.init?.method==='PUT'),false);}finally{hold.resolve();h.close();}
});

test('detail header routes final save to review preparation and exact download actions; retired cleanup cannot clear a newer capability',async()=>{
 const f=fixture(),h=imageUI((url,init)=>f.reply(url,init),{stage:'detail'}),events=[];
 try{await h.idle();const workspace=nodes(h.render()).find(node=>node.type?.name==='DetailWorkspacePanel');assert.ok(workspace);
  const first={prepareSave:()=>events.push('prepare1'),saveDisabled:false,download:()=>events.push('download1'),downloadDisabled:false};
  workspace.props.onCompositeToolbarActionsChange(first);h.render();await h.click('상세 이미지 저장 검토');await h.click('상세 이미지 다운로드');assert.deepEqual(events,['prepare1','download1']);
  const staleSave=h.button('상세 이미지 저장 검토').props.onClick,second={...first,prepareSave:()=>events.push('prepare2')};workspace.props.onCompositeToolbarActionsChange(second);workspace.props.onCompositeToolbarActionsChange(null,first);h.render();staleSave();assert.deepEqual(events,['prepare1','download1']);await h.click('상세 이미지 저장 검토');assert.equal(events.at(-1),'prepare2');
  h.active(false);assert.equal(h.button('상세 이미지 저장 검토').props.disabled,true);assert.equal(h.button('상세 이미지 다운로드').props.disabled,true);
  workspace.props.onCompositeToolbarActionsChange(null,second);h.render();assert.equal(h.button('상세 이미지 저장 검토').props.disabled,true);assert.equal(h.calls.some(call=>call.init?.method==='PUT'),false);
 }finally{h.close();}
});
