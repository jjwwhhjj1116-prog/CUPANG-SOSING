import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Reuse actual private-image API/SQLite and its component renderer without
// registering the source file's separate tests or changing its fixtures.
const fixturePath='tests/option-main-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath),fixtureText=fs.readFileSync(fixtureURL,'utf8'),ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const statements=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','editor'].includes(node.name?.text));
const source=statements.map(node=>{let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return value;}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href))+'\nexport {fixture,editor,visible,text};';
const {fixture,editor,visible}=await import('data:text/javascript,'+encodeURIComponent(source));
const companies=[{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}];
const modal=h=>visible(h.render()).find(node=>node.props?.role==='dialog'&&node.props['aria-label']==='최종 대표이미지 전체 화면 미리보기');
const fullImage=h=>visible(modal(h)).find(node=>node.type==='img');
const savedImage=h=>visible(h.render()).find(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지');
const snapshot=f=>JSON.stringify({tables:['products','product_content','product_options','product_price_policy','product_quotation_fields','collection_jobs','collection_context','collection_results'].map(table=>[table,f.backend.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]),objects:[...f.backend.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])});
const url=key=>'/api/files/'+key.split('/').map(encodeURIComponent).join('/');
function bubbleClick(h,target){
 const path=[];
 function find(node){if(Array.isArray(node))return node.some(find);if(!node||typeof node!=='object')return false;path.push(node);if(node.type===target.type&&node.props?.alt===target.props?.alt&&node.props?.src===target.props?.src)return true;if(find(node.props?.children))return true;path.pop();return false;}
 // Use a single render tree so event ancestors retain their real handlers.
 const tree=h.render(),matching=visible(tree).find(node=>node.type===target.type&&node.props?.alt===target.props?.alt&&node.props?.src===target.props?.src);assert.ok(matching);assert.equal(find(tree),true);let stopped=false;
 const event={target:matching,stopPropagation(){stopped=true;},preventDefault(){}};for(const node of path.reverse()){node.props?.onClick?.(event);if(stopped)break;}
}

for(const company of companies){
 test(`selected final-image fullscreen uses the same owned URL and every close path changes no draft/quotation (${company.code})`,async()=>{
  const f=await fixture(company),h=editor(f);try{
   await h.idle();const frozen=snapshot(f),before=await f.read(),network=f.backend.network.length,calls=f.calls.length;assert.notEqual(f.key,f.source,'saved final image differs from source-option image');
   assert.equal(visible(h.render()).find(node=>node.type==='img'&&node.props.alt==='현재 메인 이미지 작은 미리보기').props.src,savedImage(h).props.src);
   for(const trigger of ['최종 대표이미지 크게 보기','현재 메인 이미지 크게 보기'])for(const close of ['image','background','button','Escape']){
    await h.click(trigger);assert.ok(modal(h));assert.equal(fullImage(h).props.src,savedImage(h).props.src);assert.equal(fullImage(h).props.src,url(f.key));assert.equal(modal(h).props['aria-modal'],'true');assert.equal(h.render().props['data-workspace-dirty'],false);
    if(close==='image')bubbleClick(h,fullImage(h));else if(close==='background')modal(h).props.onClick({target:modal(h)});else if(close==='button'){let stopped=false;h.button('최종 대표이미지 전체 화면 닫기').props.onClick({stopPropagation(){stopped=true;}});assert.equal(stopped,true);}else{let prevented=false,stopped=false;modal(h).props.onKeyDown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});assert.equal(prevented,true);assert.equal(stopped,true,'Escape must not reach the registration drawer');}
    await h.idle();assert.equal(modal(h),undefined);assert.equal(savedImage(h).props.src,url(f.key));assert.equal(h.render().props['data-workspace-dirty'],false);
   }
   assert.equal(f.calls.length,calls,'view-only actions perform no JS API request');assert.equal(f.backend.network.length,network);assert.equal(h.saved.length,0);assert.equal(snapshot(f),frozen);assert.deepEqual(await f.read(),before);
  }finally{h.close();f.close();}
 });
 test(`zoom preserves a deliberate unsaved main-image choice and its later exact explicit save (${company.code})`,async()=>{
  const f=await fixture(company),h=editor(f);try{
   await h.idle();const view=await f.read(),frozen=snapshot(f),old=h.button('최종 대표이미지 크게 보기').props.onClick;
   await h.click('최종 대표이미지 크게 보기');const candidate=h.button(`최종 대표이미지 ${view.imageKeys.indexOf(f.nextKey)+1} 선택`);candidate.props.onClick();old();await h.idle();assert.equal(modal(h),undefined,'same-tick old image trigger cannot reopen the previous key');assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(savedImage(h).props.src,url(f.nextKey));
   const calls=f.calls.length;await h.click('최종 대표이미지 크게 보기');assert.equal(fullImage(h).props.src,url(f.nextKey));modal(h).props.onClick({});await h.idle();assert.equal(f.calls.length,calls);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(snapshot(f),frozen);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.key);
   await h.click('최종 견적 대표이미지 저장');assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);assert.equal(f.calls.filter(call=>call.method==='PATCH'||call.method==='POST').length,0);assert.equal(h.saved.length,1);assert.equal(modal(h),undefined);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.nextKey);
  }finally{h.close();f.close();}
 });
 test(`product/profile/version/option/stage/lock transitions hide old zoom immediately and cannot reopen it on return (${company.code})`,async()=>{
  const f=await fixture(company),h=editor(f);try{
   await h.idle();const view=await f.read(),frozen=snapshot(f),other=view.resolved.rows.find(row=>row.optionId&&row.optionId!==f.id).optionId;
   for(const [name,temporary]of[['productId','foreign-owner-product'],['profileId','missing-profile'],['version',new Date(Date.parse(f.product.updated_at)+1).toISOString()],['focusedOptionId',other],['refreshToken','new-source-clock'],['translationEnabled',false],['disabled',true]]){
    const before=h.props[name];await h.click('최종 대표이미지 크게 보기');const old=h.button('최종 대표이미지 크게 보기').props.onClick;
    h.props[name]=temporary;h.render();assert.equal(modal(h),undefined,name+' synchronously hides the old image');old();await h.idle();assert.equal(modal(h),undefined,name+' retained handler cannot open old image');h.props[name]=before;h.render();await h.idle();assert.equal(modal(h),undefined,name+' returning to a prior scope must not reopen preview');
   }
   assert.equal(h.saved.length,0);assert.equal(f.calls.some(call=>call.method!=='GET'),false);assert.equal(snapshot(f),frozen);
  }finally{h.close();f.close();}
 });
 test(`returning from a hidden stage cannot revive old zoom or let its old handlers close a fresh preview (${company.code})`,async()=>{
  const f=await fixture(company),h=editor(f);try{
   await h.idle();const frozen=snapshot(f),calls=f.calls.length;await h.click('최종 대표이미지 크게 보기');const oldOpen=h.button('최종 대표이미지 크게 보기').props.onClick,oldClose=modal(h).props.onClick;
   h.props.translationEnabled=false;h.render();assert.equal(modal(h),undefined);h.props.translationEnabled=true;h.render();await h.idle();assert.equal(modal(h),undefined,'true → false → true stage transition never reopens old zoom');oldOpen();await h.idle();assert.equal(modal(h),undefined,'retained hidden-stage opener has no current generation');
   await h.click('최종 대표이미지 크게 보기');oldClose({});await h.idle();assert.ok(modal(h),'old close callback cannot close the newly opened preview');assert.equal(fullImage(h).props.src,url(f.key));modal(h).props.onClick({});await h.idle();assert.equal(modal(h),undefined);
   assert.equal(f.calls.length,calls);assert.equal(h.saved.length,0);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(snapshot(f),frozen);
  }finally{h.close();f.close();}
 });
 test(`read-only zoom works with image translation disabled without enabling editing or writing (${company.code})`,async()=>{
  const f=await fixture(company),targets=[],h=editor(f,{onTranslate(...args){targets.push(args);},onEdit(...args){targets.push(args);}});try{
   h.props.translationEnabled=false;await h.idle();const frozen=snapshot(f),calls=f.calls.length;
   assert.equal(h.button('최종 대표이미지 중국어 한국어 번역').props.disabled,true);assert.equal(h.button('최종 대표이미지 영어 한국어 번역').props.disabled,true);assert.equal(h.button('최종 대표이미지 편집하기').props.disabled,true);
   await h.click('최종 대표이미지 크게 보기');assert.equal(fullImage(h).props.src,url(f.key));modal(h).props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});await h.idle();assert.equal(modal(h),undefined);
   assert.equal(f.calls.length,calls);assert.equal(targets.length,0);assert.equal(h.saved.length,0);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(snapshot(f),frozen);
  }finally{h.close();f.close();}
 });
 test(`clearing and restoring the selected main image never revives a previous fullscreen preview (${company.code})`,async()=>{
  const f=await fixture(company),h=editor(f);try{
   await h.idle();const frozen=snapshot(f);await h.click('최종 대표이미지 크게 보기');const old=h.button('최종 대표이미지 크게 보기').props.onClick;await h.click('최종 대표이미지 비우기');old();await h.idle();assert.equal(modal(h),undefined);assert.equal(h.button('최종 대표이미지 크게 보기'),undefined);assert.equal(h.render().props['data-workspace-dirty'],true);
   await h.click('선택 취소·저장 대표이미지 조회');assert.equal(modal(h),undefined);assert.equal(savedImage(h).props.src,url(f.key));assert.equal(snapshot(f),frozen);assert.equal(h.saved.length,0);assert.equal(f.calls.some(call=>call.method!=='GET'),false);
  }finally{h.close();f.close();}
 });
}

test('actual fullscreen dialog traps focus, stops Escape before parent drawers and restores only connected triggers',()=>{
 const document={activeElement:null},effects=[],refs=[];let cursor=0,closed=0,parentEscapes=0;const native=createRequire(import.meta.url);
 class Element{constructor(name){this.name=name;this.tabIndex=0;this.isConnected=true;}focus(){document.activeElement=this;}hasAttribute(){return false;}}
 const trigger=new Element('trigger'),button=new Element('close'),root=new Element('dialog');root.querySelectorAll=()=>[button];document.activeElement=trigger;
 const hooks={useRef(initial){const index=cursor++;return refs[index]??(refs[index]={current:initial});},useLayoutEffect:effect=>effects.push(effect)},exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/image-fullscreen-preview.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,document,HTMLElement:Element,require:name=>name==='react'?hooks:name==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:native(name)});
 const tree=exports.ImageFullscreenPreview({src:'/api/files/owned/selected.png',alt:'선택한 이미지',onClose(){closed++;}});tree.props.ref.current=root;visible(tree).find(node=>node.type==='button').props.ref.current=button;const cleanup=effects.shift()();assert.equal(document.activeElement,button);
 for(const shiftKey of [false,true]){let prevented=false;tree.props.onKeyDown({key:'Tab',shiftKey,preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(document.activeElement,button);}
 document.activeElement=trigger;tree.props.onKeyDown({key:'Tab',preventDefault(){}});assert.equal(document.activeElement,button);
 let stopped=false,prevented=false;tree.props.onKeyDown({key:'Escape',preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});if(!stopped)parentEscapes++;assert.equal(prevented,true);assert.equal(closed,1);assert.equal(parentEscapes,0);cleanup();assert.equal(document.activeElement,trigger);
 trigger.isConnected=false;document.activeElement=button;cleanup();assert.equal(document.activeElement,button,'stale/unmounted owner trigger is not focused');assert.equal(visible(tree).find(node=>node.type==='img').props.src,'/api/files/owned/selected.png');
});
