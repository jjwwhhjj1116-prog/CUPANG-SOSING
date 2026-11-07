import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createHash, webcrypto } from 'node:crypto';

// Real component and rewrite/CAS clients; only PNG receipts and rendering are
// replaced by isolated fixture responses. No provider or production writes.
const fixtureURL=new URL('./product-label-editor.test.mjs',import.meta.url),fixtureText=fs.readFileSync(fixtureURL,'utf8');
const ast=ts.createSourceFile(fixtureURL.pathname,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){
 if(ts.isImportDeclaration(statement))continue;
 if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
 parts.push(statement.getText(ast));
}
let source=parts.join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
for(const[before,after]of[
 ['renderer,attach}={}','renderer,attach,assess,resultFirst=true,active=true,disabled=false}={}'],
 ['JSON.stringify(slots[i].deps)!==JSON.stringify(deps)','deps===undefined||slots[i].deps===undefined||slots[i].deps.length!==deps.length||deps.some((dep,index)=>!Object.is(dep,slots[i].deps[index]))'],
 ['{exports,Error,AbortController','{exports,window:browserWindow,document:browserDocument,crypto:webcrypto,setTimeout,Error,AbortController'],
 ['URL:localURL,fetch:request','URL:Object.assign(class extends URL {},localURL),fetch:request'],
 ["if(name==='react')return react;","if(name==='@/app/product-label-result')return{readCurrentProductLabelResult:assess};if(name==='react')return react;"],
 ['version,profileId,refreshToken,onSaved()','version,profileId,refreshToken,resultFirst,active,disabled,onSaved()'],
 ['get saved(){return saved;}','setActive(value){active=value;render();},setDisabled(value){disabled=value;render();},get saved(){return saved;}'],
]){assert.ok(source.includes(before),before);source=source.replace(before,after);}
let confirmed=true;const confirmations=[],browserWindow={confirm(message){confirmations.push(message);return confirmed;}};
const downloads=[],browserDocument={createElement(tag){assert.equal(tag,'a');return{click(){downloads.push([this.href,this.download]);}};}};
const{fixture,editor,nodes,text,definitions}=vm.runInNewContext(source+'\n({fixture,editor,nodes,text,definitions})',{
 assert,fs,vm,path,ts,createRequire,webcrypto,browserWindow,browserDocument,Response,Blob,JSON,URL,Date,AbortController,structuredClone,TextEncoder,setImmediate,setTimeout,clearTimeout,
});
const plain=value=>JSON.parse(JSON.stringify(value)),hash=value=>createHash('sha256').update(value).digest('hex');
const key=`owner/quotation-label-${'a'.repeat(64)}.png`;
const writes=h=>h.calls.filter(call=>['PUT','POST','PATCH'].includes(call.init?.method));
const resultImage=h=>nodes(h.render()).find(node=>node.type==='img'&&node.props['data-current-label-result']!==undefined);
const child=h=>nodes(h.render()).find(node=>typeof node.type==='function'&&node.type.name==='ProductLabelReferenceEditor');
function setup({current=false,reason,intercept,assess,draft=false}={}){
 const f=fixture();if(current)f.view.imageKeys.push(key);const epoch=f.view.renderEpoch;
 if(draft)f.view.structure=definitions.map(([id,label])=>({id,label,required:id==='productName'}));
 function reply(url,init){
  if(init?.method==='POST'){
   const body=JSON.parse(init.body);assert.equal(body.expectedRevision,f.view.revision);assert.equal(body.expectedInputFingerprint,f.view.inputFingerprint);
   f.view.revision++;f.view.renderEpoch=(f.view.renderEpoch??0)+1;f.view.productVersion=new Date(Date.parse(f.view.productVersion)+1).toISOString();f.view.updatedAt=f.view.productVersion;
   f.view.inputFingerprint=hash(JSON.stringify([f.view.revision,f.view.renderEpoch]));f.view.quotationInputFingerprint=hash(f.view.productVersion);return Response.json(f.view);
  }return f.reply(url,init);
 }
 confirmed=true;confirmations.length=0;
 const h=editor((url,init)=>intercept?intercept(url,init,reply,f):reply(url,init),{assess:async()=>{
  if(assess)return assess(f);const view=plain(f.view),valid=current&&epoch===view.renderEpoch&&!reason;
  return{references:{view,quotation:{},keys:[key]},result:valid?{key}:null,reason:valid?null:reason??'stale'};
 }});return{f,h,reply};
}

test('no verified current PNG opens the actual form directly without a fake result or write',async()=>{
 for(const reason of[undefined,'manual','missing','stale','ambiguous','unconfirmed']){
  const{f,h}=setup({current:!!reason,reason});try{
   const before=plain(f.view);await h.idle();assert.equal(h.input('선택 옵션 제품명').props.value,'검정 수정 제품명');assert.equal(resultImage(h),undefined);
   assert.equal(nodes(h.render()).some(node=>node.props?.className?.includes('product-label-completed')),false);assert.doesNotMatch(text(h.render()),/저장 전 미리보기|표시 정보 결과/);
   assert.ok(nodes(h.render()).some(node=>node.type==='h3'&&text(node)==='한글 표시사항 작업'));
   assert.ok(nodes(h.render()).some(node=>node.props?.className==='btn ghost product-label-delete'&&text(node)==='×'));
   assert.equal(writes(h).length,0);assert.deepEqual(plain(f.view),before);
  }finally{h.close();}
 }
});

test('verified result has the selected option caption/download; cancelled rewrite preserves its image and values',async()=>{
 const{f,h}=setup({current:true});try{
  const before=plain(f.view);await h.idle();assert.equal(h.input('선택 옵션 제품명'),undefined);assert.ok(resultImage(h));
  assert.ok(nodes(h.render()).some(node=>node.type==='h4'&&text(node)==='한글 표시사항 정보'));assert.match(text(h.render()),/표시 정보 결과 \(red\)/);
  const download=nodes(h.render()).find(node=>node.type==='a'&&text(node)==='이미지 다운로드');assert.equal(download.props.href,'/api/files/'+key);
  confirmed=false;await h.click('재작성');assert.equal(confirmations.length,1);assert.equal(writes(h).length,0);assert.ok(resultImage(h));assert.equal(h.input('선택 옵션 제품명'),undefined);assert.deepEqual(plain(f.view),before);
 }finally{h.close();}
});

test('a current structured label opens a nine-row read-only preview with edit and local download',async()=>{
 const{f,h}=setup({draft:true});try{
  await h.idle();const before=plain(f.view),tree=h.render();
  const table=nodes(tree).find(node=>node.props?.['aria-label']==='선택 옵션 표시사항 미리보기');
  assert.equal(h.input('선택 옵션 제품명'),undefined);
  assert.ok(table);assert.equal(nodes(table).filter(node=>node.type==='tr').length,9);
  assert.match(text(tree),/표시 정보 결과 \(red\)/);assert.ok(h.button('이미지 다운로드'));
  assert.equal(resultImage(h),undefined);assert.equal(writes(h).length,0);
  downloads.length=0;await h.click('이미지 다운로드');
  assert.deepEqual(downloads,[[h.urls[0],'yoofam-product-label.png']]);
  assert.equal(h.plans[0].rows.length,9);assert.equal(h.attachments.length,0);
  await h.click('편집');assert.equal(h.input('선택 옵션 제품명').props.value,'검정 수정 제품명');
  assert.deepEqual(plain(f.view),before);assert.equal(writes(h).length,0);
 }finally{h.close();}
});

test('an unrelated PNG candidate does not hide the selected structured draft after receipt inspection',async()=>{
 const{h}=setup({draft:true,current:true,reason:'missing'});try{
  await h.idle();assert.equal(h.input('선택 옵션 제품명'),undefined);assert.ok(h.button('편집'));
  assert.equal(resultImage(h),undefined);assert.equal(writes(h).length,0);
 }finally{h.close();}
});

test('result rewrite performs the confirmed exact CAS once then opens preserved values and manual blanks',async()=>{
 const{f,h}=setup({current:true});try{
  const before=plain(f.view);await h.idle();await h.click('재작성');assert.equal(confirmations.length,1);assert.equal(writes(h).length,1);assert.equal(writes(h)[0].init.method,'POST');
  assert.deepEqual(Object.keys(JSON.parse(writes(h)[0].init.body)).sort(),['expectedInputFingerprint','expectedRevision']);assert.equal(f.view.renderEpoch,1);
  assert.equal(h.input('선택 옵션 제품명').props.value,'검정 수정 제품명');assert.equal(h.input('선택 옵션 내용량').props.value,'');assert.equal(resultImage(h),undefined);assert.equal(h.saved,1);
  for(const field of['rows','overrides','imageKeys'])assert.deepEqual(plain(f.view[field]),before[field]);assert.equal(h.attachments.length,0);assert.equal(h.plans.length,0);
 }finally{h.close();}
});

test('uncertain rewrite never opens result inputs; explicit GET recovery opens them only after a confirmed rewrite',async()=>{
 for(const committed of[false,true]){
  let offline=false;const{f,h}=setup({current:true,intercept(url,init,reply){
   if(offline&&init?.method!=='POST')return Response.json({error:'읽기 실패'},{status:503});
   if(init?.method==='POST'){if(committed)reply(url,init);offline=true;throw Error('응답 유실');}return reply(url,init);
  }});try{
   await h.idle();await h.click('재작성');assert.equal(h.input('선택 옵션 제품명'),undefined);assert.ok(h.button('재작성 결과 확인'));assert.equal(child(h).props.disabled,true);assert.equal(h.render().props['data-workspace-dirty'],true);
   const count=writes(h).length;offline=false;await h.click('재작성 결과 확인');assert.equal(writes(h).length,count,'GET recovery does not repeat POST');
   if(committed){assert.ok(h.input('선택 옵션 제품명'));assert.equal(f.view.renderEpoch,1);assert.equal(h.saved,1);}else{assert.equal(h.input('선택 옵션 제품명'),undefined);assert.ok(resultImage(h));assert.equal(h.saved,0);}
  }finally{h.close();}
 }
});

test('unchanged failed rewrite and failed receipt lookup keep a closed editor with read-only recovery',async()=>{
 let lookupFailed=false;const{h}=setup({current:true,intercept(url,init,reply){if(init?.method==='POST'){lookupFailed=true;return Response.json({error:'요청 거절'},{status:409});}return reply(url,init);},assess(f){
  if(lookupFailed)throw Error('결과 조회 실패');return{references:{view:plain(f.view),quotation:{},keys:[key]},result:{key},reason:null};
 }});try{
  await h.idle();await h.click('재작성');assert.equal(h.input('선택 옵션 제품명'),undefined);assert.equal(resultImage(h),undefined);assert.ok(h.button('표시사항 다시 불러오기'));
  const count=writes(h).length;lookupFailed=false;await h.click('표시사항 다시 불러오기');assert.ok(resultImage(h));assert.equal(writes(h).length,count);
 }finally{h.close();}
});

test('input save keeps exact option values and reference child mount position through inactive and failed source transitions',async()=>{
 const{f,h}=setup();function locate(tree,path='root'){
  if(Array.isArray(tree))return tree.flatMap((value,index)=>locate(value,`${path}/${index}`));if(!tree||typeof tree!=='object')return[];
  return typeof tree.type==='function'&&tree.type.name==='ProductLabelReferenceEditor'?[path]:locate(tree.props?.children,path+'/children');
 }try{
  await h.idle();const original=locate(h.render()),type=child(h).type;assert.equal(original.length,1);
  h.edit('선택 옵션 제품명','검토한 라벨');h.edit('선택 옵션 원료명 및 성분명(재질)','');await h.click('정보 저장하기');
  assert.deepEqual(JSON.parse(writes(h)[0].init.body).changes,[{optionId:'red',fieldKey:'productName',value:'검토한 라벨'},{optionId:'red',fieldKey:'material',value:''}]);assert.equal(f.view.overrides.options.red.material,'');assert.equal(f.view.overrides.options.blue.productName,'다른 옵션 제품명');
  for(const active of[false,true]){h.setActive(active);await h.idle();assert.deepEqual(locate(h.render()),original);assert.equal(child(h).type,type);}
  h.select('missing-option');assert.deepEqual(locate(h.render()),original);await h.idle();assert.deepEqual(locate(h.render()),original);
  h.select('red');await h.idle();assert.deepEqual(locate(h.render()),original);assert.equal(writes(h).length,1);
 }finally{h.close();}
});

test('failed dirty saves retain edits without exposing a discard-style result retry',async()=>{
 const{h}=setup({intercept(url,init,reply){return init?.method==='PUT'?Response.json({error:'저장 거절'},{status:409}):reply(url,init);}});try{
  await h.idle();h.edit('선택 옵션 제품명','보존할 수동 입력');h.edit('선택 옵션 원료명 및 성분명(재질)','');await h.click('정보 저장하기');
  assert.equal(h.input('선택 옵션 제품명').props.value,'보존할 수동 입력');assert.equal(h.input('선택 옵션 원료명 및 성분명(재질)').props.value,'');
  assert.equal(h.button('표시사항 다시 불러오기'),undefined);assert.ok(h.button('입력 유지·최신 표시사항 조회'));assert.equal(h.render().props['data-workspace-dirty'],true);
 }finally{h.close();}
});

test('failed PNG attachment retains its local preview and does not expose generic reload',async()=>{
 const{h}=setup();try{
  await h.idle();await h.click('저장한 표시사항 PNG 미리보기');const url=h.urls[0];await h.click('PNG 업로드·견적에 연결');
  assert.equal(h.button('표시사항 다시 불러오기'),undefined);assert.ok(nodes(h.render()).some(node=>node.type==='img'&&node.props.src===url));
  assert.ok(h.button('PNG 업로드·견적에 연결'));assert.equal(writes(h).length,0);
 }finally{h.close();}
});

test('a retained read-retry callback cannot discard later manual input',async()=>{
 let unavailable=true;const{h}=setup({intercept(url,init,reply){return unavailable?Response.json({error:'초기 조회 실패'},{status:503}):reply(url,init);}});try{
  await h.idle();const retry=h.button('표시사항 다시 불러오기').props.onClick;unavailable=false;retry();await h.idle();
  h.edit('선택 옵션 제품명','늦은 조회로 버리지 않을 값');const calls=h.calls.length;retry();await h.idle();
  assert.equal(h.calls.length,calls);assert.equal(h.input('선택 옵션 제품명').props.value,'늦은 조회로 버리지 않을 값');assert.equal(writes(h).length,0);
 }finally{h.close();}
});

test('retained result rewrite callbacks reject hidden, disabled and switched-option contexts',async()=>{
 const{h}=setup({current:true});try{
  await h.idle();const rewrite=h.button('재작성').props.onClick;h.setDisabled(true);rewrite();await h.idle();h.setDisabled(false);h.setActive(false);rewrite();await h.idle();h.setActive(true);await h.idle();
  h.select('blue');rewrite();await h.idle();assert.equal(writes(h).length,0);assert.equal(confirmations.length,0);
 }finally{h.close();}
});
