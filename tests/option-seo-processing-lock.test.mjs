import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import pathTools from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

// Reuse the real component harness without registering its original tests.
const fixtureUrl=new URL('./option-seo-editor.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8');
const ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){if(ts.isImportDeclaration(statement))continue;if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;parts.push(statement.getText(ast));}
let helpers=parts.join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
for(const [before,after] of [
 ['profileId,refreshToken=\'0\'}={})','profileId,refreshToken=\'0\',disabled=false}={})'],
 ['saveAckVersion;','saveAckVersion,commonNavigations=0;'],
 ['version,profileId,refreshToken,onSaved()','version,profileId,refreshToken,disabled,onCommonDescription(){commonNavigations++;},onSaved()'],
 ['get saved(){return saved;}','setDisabled(value,flush=true){disabled=value;return render(flush);},get commonNavigations(){return commonNavigations;},get saved(){return saved;}'],
]){assert.ok(helpers.includes(before),before);helpers=helpers.replace(before,after);}
const {seoUI,fixture,nodes,deferred}=vm.runInNewContext(helpers+'\n({seoUI,fixture,nodes,deferred})',{assert,fs,vm,ts,pathTools,createRequire,Response,JSON,URL,Date,AbortController,structuredClone,TextEncoder,setImmediate,setTimeout});
const plain=value=>JSON.parse(JSON.stringify(value)),cases=[];
const files=['app/components/option-seo-editor.tsx','tests/option-seo-processing-lock.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')])),frozen=hashes();
after(()=>{assert.deepEqual(hashes(),frozen);fs.writeFileSync(new URL('../outputs/step713-option-seo-lock-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases,boundary:'Actual selected-option SEO component callbacks with synthetic source, network and hook scheduler. No browser, external request, real product write or Supplier Hub acceptance.',externalRequests:0,browserActions:0,realProductWrites:0,supplierHubWrites:0},null,2)+'\n');});
const calls=h=>h.calls.length,writes=h=>h.calls.filter(call=>call.init?.method==='PUT').length;
const invoke=callback=>callback();

test('committed processing lock blocks all captured edit, restore, save, read, cancel and navigation callbacks without losing manual blanks',async()=>{
 const f=fixture(),before=plain(f.view),h=seoUI((url,init)=>f.reply(url,init));try{
  await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'직접 확인할 상품명'}});h.input('선택 옵션 검색태그').props.onChange({target:{value:''}});
  const edit=h.input('선택 옵션 상품명').props.onChange,restore=h.button('상품명 공통·자동값 복원').props.onClick,save=h.button('선택 옵션 SEO 저장').props.onClick,read=h.button('입력 유지·최신 SEO 조회').props.onClick,cancel=h.button('입력 취소·저장 SEO 다시 조회').props.onClick,nav=h.button('상품 공통 SEO·설명 편집').props.onClick,count=calls(h);
  const locked=h.setDisabled(true,false);assert.ok(nodes(locked).filter(node=>node.type==='button'||node.type==='textarea').every(node=>node.props.disabled===true));
  edit({target:{value:'늦은 수정'}});[restore,save,read,cancel,nav].forEach(invoke);await h.idle();
  assert.equal(calls(h),count);assert.equal(writes(h),0);assert.equal(h.commonNavigations,0);assert.equal(h.input('선택 옵션 상품명').props.value,'직접 확인할 상품명');assert.equal(h.input('선택 옵션 검색태그').props.value,'');assert.equal(h.render().props['data-workspace-dirty'],true);assert.deepEqual(plain(f.view),before);
  h.setDisabled(false,false);save();await h.idle();assert.equal(writes(h),1);assert.equal(h.saved,1);assert.equal(f.view.overrides.options.red['wire-title'],'직접 확인할 상품명');assert.equal(f.view.overrides.options.red['wire-tags'],'');assert.deepEqual(plain(f.view.overrides.common),before.overrides.common);assert.deepEqual(plain(f.view.overrides.options.blue),before.overrides.options.blue);
  cases.push({name:'live commit lock',capturedCallbacks:6,disabledBeforePassiveEffects:true,manualBlankPreserved:true,reenabledExplicitWrites:1});
 }finally{h.close();}
});

test('clean explicit reload and common SEO navigation remain locked and resume only after processing ends',async()=>{
 const f=fixture(),h=seoUI((url,init)=>f.reply(url,init));try{
  await h.idle();const reload=h.button('저장 SEO 다시 조회').props.onClick,nav=h.button('상품 공통 SEO·설명 편집').props.onClick,count=calls(h);
  h.setDisabled(true,false);reload();nav();await h.idle();assert.equal(calls(h),count);assert.equal(h.commonNavigations,0);assert.equal(h.render().props['data-workspace-dirty'],false);
  h.setDisabled(false,false);nav();reload();await h.idle();assert.equal(h.commonNavigations,1);assert.equal(calls(h),count+1);assert.equal(writes(h),0);assert.equal(h.saved,0);
  cases.push({name:'clean reload and navigation',lockedRequests:0,reenabledReadOnlyRequests:1,navigationResumed:true});
 }finally{h.close();}
});

test('an uncertain committed save stays frozen during processing and recovers by reads without another PUT',async()=>{
 const f=fixture();let lose=true;const h=seoUI((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'&&lose){lose=false;throw Error('합성 저장 응답 유실');}return response;});try{
  await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'확인할 저장 상품명'}});h.input('선택 옵션 검색태그').props.onChange({target:{value:''}});await h.click('선택 옵션 SEO 저장');assert.equal(h.saved,0);assert.equal(writes(h),1);
  const recover=h.button('SEO 저장 결과 확인').props.onClick,read=h.button('입력 유지·최신 SEO 조회').props.onClick,cancel=h.button('입력 취소·저장 SEO 다시 조회').props.onClick,count=calls(h);
  h.setDisabled(true,false);[recover,read,cancel].forEach(invoke);await h.idle();assert.equal(calls(h),count);assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.input('선택 옵션 검색태그').props.value,'');assert.equal(h.input('선택 옵션 검색태그').props.disabled,true);
  h.setDisabled(false,false);recover();await h.idle();assert.equal(calls(h),count+2,'one recovery read followed by the normal host version refresh read');assert.ok(h.calls.slice(count).every(call=>!call.init?.method));assert.equal(writes(h),1);assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.input('선택 옵션 검색태그').props.value,'');
  cases.push({name:'uncertain save recovery',lockedRecoveryRequests:0,recoveryReads:1,hostRefreshReads:1,duplicatePuts:0,blankPreserved:true});
 }finally{h.close();}
});

test('initial read remains allowed while disabled and a lock toggle does not abort or restart its pending request',async()=>{
 const f=fixture(),pending=deferred(),h=seoUI(()=>pending.promise,{disabled:true});try{
  await Promise.resolve();const call=h.calls[0];assert.ok(call);assert.equal(call.init.signal.aborted,false);assert.equal(calls(h),1);
  const reload=h.button('저장 SEO 다시 조회').props.onClick;h.setDisabled(false,false);reload();h.setDisabled(true,false);reload();assert.equal(calls(h),1);assert.equal(call.init.signal.aborted,false);
  pending.resolve(Response.json(f.view));await h.idle();assert.equal(h.input('선택 옵션 상품명').props.value,'공통 Hub 상품명');assert.equal(h.input('선택 옵션 상품명').props.disabled,true);assert.equal(calls(h),1);assert.equal(writes(h),0);assert.equal(h.saved,0);
  h.setDisabled(false,false);assert.equal(h.input('선택 옵션 상품명').props.disabled,false);
  cases.push({name:'initial read continuity',initialDisabledReadAllowed:true,toggleAborts:0,restarts:0});
 }finally{h.close();}
});

test('a pending keep-input read finishes without cancellation when processing starts and preserves exact dirty input',async()=>{
 const f=fixture(),pending=deferred();let hold=false,held;const h=seoUI((url,init)=>{if(hold){hold=false;held={url,init};return pending.promise;}return f.reply(url,init);});try{
  await h.idle();h.input('선택 옵션 상품명').props.onChange({target:{value:'  공백 유지 상품명  '}});h.input('선택 옵션 검색태그').props.onChange({target:{value:''}});hold=true;h.button('입력 유지·최신 SEO 조회').props.onClick();assert.ok(held);
  const cancel=h.button('입력 취소·저장 SEO 다시 조회').props.onClick,nav=h.button('상품 공통 SEO·설명 편집').props.onClick,count=calls(h);h.setDisabled(true,false);cancel();nav();assert.equal(held.init.signal.aborted,false);assert.equal(calls(h),count);assert.equal(h.commonNavigations,0);
  pending.resolve(f.reply(held.url,held.init));await h.idle();assert.equal(h.input('선택 옵션 상품명').props.value,'  공백 유지 상품명  ');assert.equal(h.input('선택 옵션 검색태그').props.value,'');assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.render().props['data-workspace-saving'],false);assert.equal(writes(h),0);assert.equal(h.saved,0);
  h.setDisabled(false,false);await h.click('선택 옵션 SEO 저장');assert.equal(writes(h),1);assert.equal(f.view.overrides.options.red['wire-title'],'  공백 유지 상품명  ');assert.equal(f.view.overrides.options.red['wire-tags'],'');
  cases.push({name:'pending keep-input continuity',toggleAborts:0,preservedWhitespaceAndBlank:true,automaticWrites:0});
 }finally{h.close();}
});

test('scope change and unmount still reject old callbacks and abort pending reads regardless of processing lock changes',async()=>{
 const f=fixture(),pending=deferred();let hold=false,held;const h=seoUI((url,init)=>{if(hold){hold=false;held={url,init};return pending.promise;}return f.reply(url,init);});try{
  await h.idle();const edit=h.input('선택 옵션 상품명').props.onChange,save=h.button('선택 옵션 SEO 저장').props.onClick,read=h.button('저장 SEO 다시 조회').props.onClick,nav=h.button('상품 공통 SEO·설명 편집').props.onClick;
  hold=true;read();h.setDisabled(true,false);assert.equal(held.init.signal.aborted,false);h.select('blue');assert.equal(held.init.signal.aborted,true);h.setDisabled(false,false);await h.idle();const count=calls(h),title=h.input('선택 옵션 상품명').props.value;
  edit({target:{value:'이전 옵션 입력'}});[save,read,nav].forEach(invoke);pending.resolve(f.reply(held.url,held.init));await h.idle();assert.equal(calls(h),count);assert.equal(h.input('선택 옵션 상품명').props.value,title);assert.equal(h.commonNavigations,0);assert.equal(writes(h),0);
  const closedRead=h.button('저장 SEO 다시 조회').props.onClick,closedNav=h.button('상품 공통 SEO·설명 편집').props.onClick;hold=true;closedRead();const closing=held.init.signal,closingCount=calls(h);h.close();assert.equal(closing.aborted,true);closedRead();closedNav();edit({target:{value:'닫힌 편집'}});await new Promise(done=>setImmediate(done));assert.equal(calls(h),closingCount);assert.equal(h.commonNavigations,0);assert.equal(h.lateWrites,0);
  cases.push({name:'scope and lifecycle',scopeAbort:true,unmountAbort:true,staleNavigationAndWrites:0,lateStateWrites:0});
 }finally{h.close();}
});
