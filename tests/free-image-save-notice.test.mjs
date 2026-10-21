import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

// Actual panel/hooks with the existing adapter fixture. These replies stand
// for the client's already validated apply/recover ACK; client/API validation
// has its own tests. This suite tests only the subsequent parent refresh UX.
const fixtureUrl=new URL('./free-image-translation-panel.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){
 if(ts.isImportDeclaration(statement))continue;
 if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
 parts.push(statement.getText(ast));
}
const {fixture,deferred,ApplyError,nodes,text,version}=vm.runInNewContext(parts.join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href))+'\n({fixture,deferred,ApplyError,nodes,text,version})',
 {assert,fs,vm,ts,createRequire,URL,Blob,Error,Date,AbortController,console,setImmediate});
const next='2026-10-06T00:00:01.000Z',external='2026-10-06T00:00:02.000Z',resultKey='owner/generated.png';
const keys=['owner/original.png','owner/second.png'],sourceKey=keys[0];
const status=h=>nodes(h.render()).filter(node=>node.props?.role==='status').map(text).join(' ');
function props(role='detail'){
 const input=role==='main'?'mainImage':role==='additional'?'additionalImages':'detailImages';
 const quotationTarget={kind:'quotation',profileId:null,optionId:'sku-a',input,fieldKey:'wire-'+input,slotIndex:role==='main'?0:1,
  revision:7,inputFingerprint:'c'.repeat(64),optionRevision:3,value:role==='main'?sourceKey:keys[1]+'\n'+sourceKey};
 return {focusedOptionId:'sku-a',quotationContext:{profileId:null,optionId:'sku-a',input},translationTarget:{sourceKey,sequence:101,role,intent:'manual',quotationTarget}};
}
const applied=image=>({source:image.source,key:resultKey,applied:true,productVersion:next,contentRevision:3,quotationRevision:8,quotationInputFingerprint:'d'.repeat(64)});
async function prepared(initial={}){
 const h=fixture({...props(),...initial});await h.settle();
 await h.click('문구 영역 직접 추가');await h.change('문구 1 원문','직접 검토한 원문');await h.change('문구 1 한국어','보존할 수동 편집');await h.click('번역 이미지 미리보기');
 h.setApply(async image=>applied(image));return h;
}

for(const role of ['main','additional','detail'])test(`${role}: exact verified own-save refresh retains success once while preserving normal abort/reset and no repeated apply`,async()=>{
 let h,changed=0;h=await prepared({...props(role),onProductChanged(){changed++;h.setProps({version:next,imageKeys:[...keys,resultKey]});}});
 try{
  await h.click('검토한 번역 이미지 적용');assert.equal(changed,1);assert.match(status(h),/번역 이미지를 적용했습니다/);assert.doesNotMatch(status(h),/상품 저장본이 변경/);
  assert.equal(h.calls.filter(call=>call.action==='apply').length,1);assert.equal(h.calls.find(call=>call.action==='apply').signal.aborted,true,'the normal own-version effect still aborts old work');
  assert.equal(h.render().props['data-workspace-dirty'],undefined);assert.equal(h.button('검토한 번역 이미지 적용'),undefined);assert.equal(h.field('문구 1 한국어'),undefined);
  h.setProps({version:external});await h.settle();assert.match(status(h),/상품 저장본이 변경/);
  h.setProps({version:next});await h.settle();assert.match(status(h),/상품 저장본이 변경/,'returning to the same version cannot reuse the consumed ACK notice');
  assert.equal(h.calls.filter(call=>call.action==='apply').length,1);
 }finally{h.close();}
});

test('another version or missing acknowledged result key keeps the original changed-version warning and consumes the marker',async()=>{
 for(const mode of ['version','key']){const h=await prepared();try{
   await h.click('검토한 번역 이미지 적용');assert.match(status(h),/번역 이미지를 적용했습니다/);
   h.setProps({version:mode==='version'?external:next,imageKeys:mode==='key'?keys:[...keys,resultKey]});await h.settle();assert.match(status(h),/상품 저장본이 변경/);
   h.setProps({imageKeys:[...keys,resultKey]});await h.settle();assert.match(status(h),/상품 저장본이 변경/,'late key membership cannot restore an already rejected notice');
   h.setProps({version});await h.settle();h.setProps({version:next});await h.settle();assert.match(status(h),/상품 저장본이 변경/);
   assert.equal(h.calls.filter(call=>call.action==='apply').length,1);
  }finally{h.close();}}
});

test('active, disabled, focus, target and source ABA changes retire a saved notice before its matching parent clock arrives',async()=>{
 for(const mode of ['active','disabled','focus','target','source']){const base=props(),h=await prepared(base);try{
   await h.click('검토한 번역 이미지 적용');
   if(mode==='active'){h.setProps({active:false});h.setProps({active:true});}
   if(mode==='disabled'){h.setProps({disabled:true});h.setProps({disabled:false});}
   if(mode==='focus'){h.setProps({focusedOptionId:'sku-b',quotationContext:{...base.quotationContext,optionId:'sku-b'}});h.setProps({focusedOptionId:base.focusedOptionId,quotationContext:base.quotationContext});}
   if(mode==='target'){h.setProps({translationTarget:{...base.translationTarget,sequence:102}});h.setProps({translationTarget:base.translationTarget});}
   if(mode==='source'){h.setProps({translationTarget:{...base.translationTarget,sequence:102,sourceKey:keys[1],quotationTarget:{...base.translationTarget.quotationTarget,slotIndex:0}}});h.setProps({translationTarget:base.translationTarget});}
   await h.settle();h.setProps({version:next,imageKeys:[...keys,resultKey]});await h.settle();assert.match(status(h),/상품 저장본이 변경/,mode);
   assert.equal(h.calls.filter(call=>call.action==='apply').length,1,mode);
  }finally{h.close();}}
});

test('starting a new source read, failing it or cancelling it cannot reuse an earlier save notice',async()=>{
 for(const mode of ['read','failure','cancel']){const h=await prepared();let waiting;try{
   await h.click('검토한 번역 이미지 적용');
   if(mode==='failure')h.setSource(async()=>{throw Error('LOCAL next-source failure');});
   if(mode==='cancel'){waiting=deferred();h.setSource(()=>waiting.promise);h.button('원본 불러오기 · 수동 편집').props.onClick();await h.settle();await h.click('이미지 작업 취소');}
   else await h.click('원본 불러오기 · 수동 편집');
   h.setProps({version:next,imageKeys:[...keys,resultKey]});await h.settle();assert.match(status(h),/상품 저장본이 변경/);assert.equal(h.calls.filter(call=>call.action==='apply').length,1);
  }finally{waiting?.resolve();h.close();}}
});

test('unconfirmed apply keeps its exact preview and version warning; only a verified applied recovery creates the success notice',async()=>{
 const h=await prepared();try{
  h.setApply(async()=>{throw new ApplyError('LOCAL ACK lost',true);});
  await h.click('검토한 번역 이미지 적용');const image=h.calls.find(call=>call.action==='apply').image;
  assert.equal(h.saved,0);assert.match(text(h.render()),/LOCAL ACK lost/);assert.equal(h.field('문구 1 한국어').props.value,'보존할 수동 편집');
  h.setProps({version:external,imageKeys:[...keys,resultKey]});await h.settle();assert.match(status(h),/응답을 확인하지 못한 미리보기/);assert.ok(h.button('같은 결과의 저장 상태 다시 확인'));
  h.setRecover(async value=>({...applied(value),productVersion:'2026-10-06T00:00:03.000Z',replayed:true}));
  await h.click('같은 결과의 저장 상태 다시 확인');assert.equal(h.saved,1);assert.match(status(h),/번역 이미지를 적용했습니다/);
  h.setProps({version:'2026-10-06T00:00:03.000Z'});await h.settle();assert.match(status(h),/번역 이미지를 적용했습니다/);assert.doesNotMatch(status(h),/상품 저장본이 변경/);
  assert.equal(h.calls.filter(call=>call.action==='apply').length,1);assert.equal(h.calls.filter(call=>call.action==='recover').length,1);assert.equal(h.calls.find(call=>call.action==='recover').image,image);
 }finally{h.close();}
});

test('an external version before any confirmed save retains manual wording and the ordinary conflict controls',async()=>{
 const h=await prepared();try{
  const count=h.calls.length;h.setProps({version:external});await h.settle();assert.match(status(h),/상품 저장본이 변경/);
  assert.equal(h.field('문구 1 한국어').props.value,'보존할 수동 편집');assert.equal(h.button('번역 이미지 미리보기').props.disabled,true);assert.equal(h.button('검토한 번역 이미지 적용'),undefined);assert.equal(h.calls.length,count);assert.equal(h.saved,0);
 }finally{h.close();}
});
