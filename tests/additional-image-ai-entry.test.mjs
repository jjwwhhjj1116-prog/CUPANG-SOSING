import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';

// Reuse the existing real component hook renderer and isolated quotation
// fixture without registering its broader image-editor test suite.
const fixturePath='tests/option-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath);
const fixtureText=fs.readFileSync(fixtureURL,'utf8'),ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const statements=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','imageUI','dragTransfer','dragEvent'].includes(node.name?.text));
let source=statements.map(node=>{
 let value=node.getFullText(ast);
 if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}
 return value;
}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
function replaceOnce(before,after){assert.equal(source.split(before).length-1,1,'existing image hook fixture contract: '+before);source=source.replace(before,after);}
replaceOnce('confirmImage=()=>true,onTranslate,onEdit}={})','confirmImage=()=>true,onTranslate,onEdit,onProcess,processingConfigured=null}={})');
replaceOnce('disabled,onTranslate,onEdit,onSaved(){','disabled,onTranslate,onEdit,onProcess,processingConfigured,onSaved(){');
replaceOnce('close(){closed=true;','configured(value){processingConfigured=value;render();},close(){closed=true;');
source+='\nexport {fixture,imageUI,nodes,text,deferred,plain};';
const {fixture,imageUI,nodes,text,deferred,plain}=await import('data:text/javascript,'+encodeURIComponent(source));
const writes=h=>h.calls.filter(call=>call.init?.method&&call.init.method!=='GET');
function seed(f,keys=f.keys.slice(0,3)){
 f.reply('',{method:'PUT',body:JSON.stringify({expectedRevision:f.view.revision,changes:['additionalImages','wire-additionalImages'].map(fieldKey=>({optionId:'red',fieldKey,value:keys.join('\n')}))})});
 return f;
}
function ai(h,index=2){return h.button(`추가 이미지 ${index} AI 처리`);}
async function chooseMiddle(h){await h.click('추가 이미지 2 크게 보기');}

test('selected additional AI entry pins one saved middle slot and cloned quote view without saving or calling a provider',async()=>{
 const f=seed(fixture()),processed=[];f.view.categoryContext.profileId='selected-profile';
 const h=imageUI((url,init)=>f.reply(url,init),{version:f.view.productVersion,profileId:'selected-profile',saveOnChange:true,processingConfigured:true,onProcess:(...args)=>processed.push(args)});
 try{
  await h.idle();await chooseMiddle(h);const before=plain(f.view);
  assert.equal(processed.length,0);assert.equal(writes(h).length,0);assert.equal(ai(h).props.disabled,false);assert.equal(text(ai(h)),'AI 처리');
  await h.click('추가 이미지 2 AI 처리');assert.equal(processed.length,1);
  assert.deepEqual(plain(processed[0].slice(0,3)),[f.keys[1],'additional',{kind:'quotation',profileId:'selected-profile',optionId:'red',input:'additionalImages',fieldKey:'wire-additionalImages',slotIndex:1,revision:before.revision,inputFingerprint:before.inputFingerprint,optionRevision:before.optionRevision,value:f.keys.slice(0,3).join('\n')}]);
  assert.deepEqual(plain(processed[0][3]),before);
  processed[0][3].overrides.common.additionalImages='a parent cannot mutate the card basis';
  assert.deepEqual(plain(f.view),before);assert.equal(writes(h).length,0);assert.equal(h.saved,0);
  await h.click('추가 이미지 2 AI 처리');assert.equal(processed.length,2);assert.deepEqual(plain(processed[1][3]),before);
  assert.ok(h.calls.every(call=>call.url.includes('/quotation-fields')&&(!call.init?.method||call.init.method==='GET')));
 }finally{h.close();}
});

test('unknown or missing provider disables only additional AI; free edit and both translations keep their exact saved slot',async()=>{
 for(const configured of [null,false]){
  const f=seed(fixture()),processed=[],edited=[],translated=[],h=imageUI((url,init)=>f.reply(url,init),{version:f.view.productVersion,saveOnChange:true,processingConfigured:configured,onProcess:(...args)=>processed.push(args),onEdit:(...args)=>edited.push(args),onTranslate:(...args)=>translated.push(args)});
  try{
   await h.idle();await chooseMiddle(h);assert.equal(ai(h).props.disabled,true);assert.equal(text(ai(h)),configured===false?'AI 서버 설정 필요':'AI 설정 확인 중');ai(h).props.onClick();
   await h.click('추가 이미지 2 편집하기');await h.click('추가 이미지 2 중국어 한국어 번역');await h.click('추가 이미지 2 영어 한국어 번역');
   assert.equal(processed.length,0);assert.equal(edited.length,1);assert.equal(translated.length,2);
   assert.equal(edited[0][0],f.keys[1]);assert.equal(edited[0][2].slotIndex,1);assert.equal(edited[0][2].input,'additionalImages');
   for(const entry of translated){assert.equal(entry[0],f.keys[1]);assert.equal(entry[3].slotIndex,1);assert.equal(entry[3].value,f.keys.slice(0,3).join('\n'));}
   assert.deepEqual(translated.map(entry=>entry[2]),['zh','en']);assert.equal(writes(h).length,0);
  }finally{h.close();}
 }
});

test('retained additional AI callbacks cannot revive after preview, configuration or selected scope ABA changes',async()=>{
 for(const mode of ['preview','configuration','active','disabled','stage','mode','option','profile','version','refresh']){
  const f=seed(fixture()),processed=[],h=imageUI((url,init)=>f.reply(url,init),{version:f.view.productVersion,saveOnChange:true,processingConfigured:true,onProcess:(...args)=>processed.push(args)});
  try{
   await h.idle();await chooseMiddle(h);const old=ai(h).props.onClick;
   if(mode==='preview'){await h.click('추가 이미지 1 크게 보기');await chooseMiddle(h);}
   if(mode==='configuration'){h.configured(false);h.configured(true);}
   if(mode==='active'){h.active(false);h.active(true);}
   if(mode==='disabled'){h.disabled(true);h.disabled(false);}
   if(mode==='stage'){h.stage('detail');h.stage('additional');}
   if(mode==='mode'){h.saveMode(false);h.saveMode(true);}
   if(mode==='option'){h.select('blue');h.select('red');}
   if(mode==='profile'){h.profile('other-profile');h.profile(undefined);}
   if(mode==='version'){h.source('2026-10-08T00:00:00.000Z');h.source(f.view.productVersion);}
   if(mode==='refresh'){h.source(f.view.productVersion,'1');h.source(f.view.productVersion,'0');}
   await h.idle();old();await h.idle();assert.equal(processed.length,0,mode);assert.equal(writes(h).length,0,mode);
   await h.click('추가 이미지 2 AI 처리');assert.equal(processed.length,1,mode);assert.equal(processed[0][2].slotIndex,1,mode);
  }finally{h.close();}
 }
});

test('dirty, in-flight, unknown-ACK and stale saved additional lists never dispatch the retained AI entry',async()=>{
 for(const mode of ['dirty','busy','uncertain','stale']){
  const f=seed(fixture()),processed=[],held=deferred();let delayed;
  const h=imageUI((url,init)=>{
   if(init?.method==='PUT'&&mode==='busy'){delayed={url,init};return held.promise;}
   if(init?.method==='PUT'&&mode==='uncertain')throw Error('synthetic additional save acknowledgement unavailable');
   return f.reply(url,init);
  },{version:f.view.productVersion,saveOnChange:true,processingConfigured:true,onProcess:(...args)=>processed.push(args)});
  try{
   await h.idle();await chooseMiddle(h);const old=ai(h).props.onClick;
   if(mode==='dirty'){h.saveMode(false);h.choose('선택 옵션 추가 이미지 후보 4');h.saveMode(true);}
   if(mode==='busy'||mode==='uncertain'){h.button('추가 이미지 후보 4 추가').props.onClick();if(mode==='uncertain')await h.idle();}
   if(mode==='stale'){h.source('2026-10-08T00:00:00.000Z');await h.idle();}
   h.render();old();ai(h)?.props.onClick();assert.equal(processed.length,0,mode);
   if(mode==='busy'){held.resolve(f.reply(delayed.url,delayed.init));await h.idle();}
   assert.ok(h.calls.every(call=>call.url.includes('/quotation-fields')),'entry never calls the provider');
  }finally{held.resolve(Response.json(f.view));h.close();}
 }
});

test('unselected candidates, duplicate source slots and mismatched linked lists cannot become an additional AI target; detail stage stays unchanged',async()=>{
 for(const mode of ['candidate','duplicate','linked','detail']){
  const f=fixture(),processed=[];seed(f,mode==='duplicate'?[f.keys[0],f.keys[1],f.keys[1]]:undefined);
  if(mode==='linked')f.reply('',{method:'PUT',body:JSON.stringify({expectedRevision:f.view.revision,changes:[{optionId:'red',fieldKey:'additionalImages',value:f.keys.slice(1,3).join('\n')}]})});
  const h=imageUI((url,init)=>f.reply(url,init),{version:f.view.productVersion,stage:mode==='detail'?'detail':'additional',saveOnChange:true,processingConfigured:true,onProcess:(...args)=>processed.push(args)});
  try{
   await h.idle();if(mode==='detail'){assert.equal(nodes(h.render()).some(node=>node.type==='button'&&String(node.props['aria-label']).includes(' AI 처리')),false);continue;}
   if(mode==='candidate'){await h.click('상품 저장 이미지 4 크게 보기');assert.equal(ai(h,4),undefined);}
   else{await chooseMiddle(h);ai(h).props.onClick();}
   assert.equal(processed.length,0,mode);assert.equal(writes(h).length,0,mode);
  }finally{h.close();}
 }
});
