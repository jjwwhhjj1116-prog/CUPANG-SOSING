import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {bannerFixture,bannerCompanies} from './helpers/captured-settings-banners.mjs';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const settle=async()=>{for(let index=0;index<12;index++)await new Promise(resolve=>setImmediate(resolve));};
function factory(){
 const fixtureUrl=new URL('./detail-image-toolbar.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='componentHarness');assert.ok(fn);
 const exports={};vm.runInNewContext(ts.transpileModule('export '+fn.getText(ast).replaceAll('import.meta.url','fixtureUrl'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,fs,vm,ts,native:createRequire(import.meta.url),fixtureUrl,nodes,URL,AbortController,DOMException,TextEncoder,crypto,structuredClone});return exports.componentHarness;
}
const componentHarness=factory();
async function editor(f,{metadata=true}={}){
 let showMetadata=metadata;const calls=[],translations=[],sourceReads=[];
 const request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});const response=await f.h.route(url,{method:init.method??'GET',body:init.body}),body=await response.json();if(!showMetadata)delete body.capturedSettingsBanners;return Response.json(body,{status:response.status});};
 const h=componentHarness('app/components/product-content-editor.tsx','ProductContentEditor',{product:f.product(),section:'이미지',focusedAssetRole:'detail',onTranslateImage:(...args)=>translations.push(args)},request,{'@/app/local-image-resize':{readResizeSource:async(productId,key,revision)=>{assert.equal(productId,f.product().id);assert.ok(JSON.parse(f.product().image_keys).includes(key));assert.ok(revision>0);sourceReads.push(key);return{key,width:800,height:400,blob:new Blob()};},imageTransformPlan:source=>({width:source.width,height:source.height})}});
 await settle();h.render();await settle();h.render();
 const button=label=>nodes(h.render()).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));
 return{...h,calls,translations,sourceReads,button,setMetadata(value){showMetadata=value;},async idle(){await settle();h.render();await settle();h.render();}};
}
for(const company of bannerCompanies)test(`only captured settings banner controls are locked; view/download and direct top editing survive (${company.code})`,async()=>{
 const f=await bannerFixture(company);let ui;try{
  const before=f.stable(),initial=await f.read(),pool=JSON.parse(f.product().image_keys),topIndex=pool.indexOf(f.top)+1,body=initial.content.assets.detail.value[0],bodyIndex=pool.indexOf(body)+1;
  ui=await editor(f);assert.ok(text(ui.render()).includes('등록 시 기본설정에서 선택된 배너'));assert.equal(ui.button(`이미지 ${topIndex} 중국어→한국어 번역`),undefined);assert.equal(ui.button(`이미지 ${topIndex} 편집`),undefined);assert.equal(ui.button(`이미지 ${topIndex} 상세에서 제외`),undefined);
  const topRole=nodes(ui.render()).find(node=>node.type==='select'&&node.props['aria-label']===`이미지 ${topIndex} 역할`);assert.equal(topRole.props.disabled,true);topRole.props.onChange({target:{value:'detail'}});assert.equal(nodes(ui.render()).find(node=>node.type==='select'&&node.props['aria-label']===`이미지 ${topIndex} 역할`).props.value,'detailTop');
  assert.equal(ui.button(`이미지 ${topIndex} 위로`).props.disabled,true);assert.equal(ui.button(`이미지 ${topIndex} 아래로`).props.disabled,true);assert.ok(ui.button(`이미지 ${topIndex} 크게 보기`));assert.ok(ui.button('상세 이미지 ZIP 다운로드'));
  ui.button(`이미지 ${bodyIndex} 중국어→한국어 번역`).props.onClick();assert.deepEqual(ui.translations,[[body,'zh','detail']]);
  const bodyRole=nodes(ui.render()).find(node=>node.type==='select'&&node.props['aria-label']===`이미지 ${bodyIndex} 역할`);bodyRole.props.onChange({target:{value:'detailTop'}});assert.equal(nodes(ui.render()).find(node=>node.type==='select'&&node.props['aria-label']===`이미지 ${topIndex} 역할`).props.value,'detailTop');
  assert.equal(f.stable(),before);assert.equal(ui.calls.filter(call=>call.method!=='GET').length,0);ui.close();
  await f.save({assets:{detailTop:[body],detail:initial.content.assets.detail.value.slice(1)}});ui=await editor(f);
  const directIndex=pool.indexOf(body)+1;assert.equal(ui.button(`이미지 ${directIndex} 중국어→한국어 번역`).props.disabled,false);assert.equal(ui.button(`이미지 ${directIndex} 편집`).props.disabled,false);assert.equal(ui.button(`이미지 ${directIndex} 상세에서 제외`).props.disabled,false);
  ui.button(`이미지 ${directIndex} 영어→한국어 번역`).props.onClick();assert.deepEqual(ui.translations,[[body,'en','detailTop']]);ui.button(`이미지 ${directIndex} 편집`).props.onClick();await ui.idle();assert.deepEqual(ui.sourceReads,[body]);
 }finally{ui?.close();f.close();}
});
test('captured old handlers cannot edit, translate, remove, or overwrite a banner after exact metadata refresh',async()=>{
 const f=await bannerFixture();let ui;try{
  ui=await editor(f,{metadata:false});const pool=JSON.parse(f.product().image_keys),index=pool.indexOf(f.top)+1,oldTranslate=ui.button(`이미지 ${index} 중국어→한국어 번역`),oldEdit=ui.button(`이미지 ${index} 편집하기`),oldDelete=ui.button(`이미지 ${index} 상세에서 제외`),oldRole=nodes(ui.render()).find(node=>node.type==='select'&&node.props['aria-label']===`이미지 ${index} 역할`),body=(await f.read()).content.assets.detail.value[0],bodyIndex=pool.indexOf(body)+1,overwrite=nodes(ui.render()).find(node=>node.type==='select'&&node.props['aria-label']===`이미지 ${bodyIndex} 역할`);
  assert.ok(oldTranslate&&oldEdit&&oldDelete);ui.setMetadata(true);ui.update({product:{...f.product(),updated_at:'2099-01-01T00:00:00.000Z'}});await ui.idle();assert.equal(ui.button(`이미지 ${index} 편집하기`),undefined);
  oldTranslate.props.onClick();oldEdit.props.onClick();oldDelete.props.onClick();oldRole.props.onChange({target:{value:'detail'}});overwrite.props.onChange({target:{value:'detailTop'}});await ui.idle();
  assert.deepEqual(ui.translations,[]);assert.deepEqual(ui.sourceReads,[]);assert.equal(nodes(ui.render()).find(node=>node.type==='select'&&node.props['aria-label']===`이미지 ${index} 역할`).props.value,'detailTop');assert.equal(ui.calls.filter(call=>call.method!=='GET').length,0);
 }finally{ui?.close();f.close();}
});
