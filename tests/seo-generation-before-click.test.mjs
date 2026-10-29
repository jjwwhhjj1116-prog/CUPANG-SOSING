import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const fixtureUrl=new URL('./dashboard-account-actions.test.mjs',import.meta.url),source=fs.readFileSync(fixtureUrl,'utf8'),ast=ts.createSourceFile(fixtureUrl.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declarations=ast.statements.filter(statement=>ts.isVariableStatement(statement)||ts.isFunctionDeclaration(statement)).map(statement=>statement.getText(ast)).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureUrl.href));
const {harness,nodes,text,seoConfiguration,deferred,scope}=vm.runInNewContext(declarations+'\n({harness,nodes,text,seoConfiguration,deferred,scope})',{assert,fs,vm,ts,createRequire,URL,Response,Request,File,Blob,FormData,URLSearchParams,TextEncoder,TextDecoder,AbortController,AbortSignal,crypto,structuredClone,setImmediate,setTimeout,clearTimeout});
const plain=value=>JSON.parse(JSON.stringify(value));
const configurationReply=(configuration=seoConfiguration(),ownerId='test-owner',company=scope().company)=>Response.json({purpose:'seo-generation',ownerId,company,configuration});
const select=h=>h.component('registration-board').onSelected(new Set([h.products[0].id]));
const check=(h,label,checked)=>nodes(h.render()).find(node=>node.type==='input'&&node.props['aria-label']===label).props.onChange({target:{checked}});

test('compact dashboard moves the server notice into the work dialog while one-click work retains its free-only snapshot',async()=>{
 const expected=seoConfiguration(),h=harness({seoConfigurationReply:async()=>configurationReply(expected)});
 try{
  await h.settle();assert.equal(nodes(h.render()).some(node=>node.props?.['aria-label']==='SEO 실행 전 안내'),false);assert.ok(!text(h.render()).includes(expected.notice));
  const read=h.requests.find(request=>request.url==='/api/seo-generation/configuration');assert.equal(read.method,'GET');assert.equal(read.init.cache,'no-store');assert.equal(read.init.credentials,'same-origin');assert.equal(read.init.redirect,'error');assert.ok(read.init.signal instanceof AbortSignal);
  select(h);const before=JSON.stringify(h.products);await h.click('작업 개시');const first=h.component('batch-work-panel').runRequest;
  assert.deepEqual(plain(first.seoGenerationConsent),plain(expected));assert.notEqual(first.seoGenerationConsent,expected);assert.equal(first.seoGenerationConsent.freeOnly,true);assert.equal(JSON.stringify(h.products),before);
  const notice=nodes(h.render()).find(node=>node.props?.['aria-label']==='SEO 실행 전 안내');assert.equal(notice.type,'details');assert.notEqual(notice.props.open,true);assert.equal(text(notice.props.children[0]),'SEO 실행 안내');assert.ok(text(notice).includes(expected.notice));assert.match(text(notice),/Cloudflare Workers AI.*2048.*무료 사용만 허용/s);await h.toggleDetails('SEO 실행 전 안내');assert.equal(h.component('batch-work-panel').runRequest.id,first.id);
  assert.deepEqual(JSON.parse(first.keys.get('batch-owner:test-owner')),{ownerId:'test-owner',company:plain(scope().company)},'the runner must compare its first account read with the exact company shown before click');
  await h.click('작업 개시');assert.equal(h.component('batch-work-panel').runRequest.id,first.id);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('unknown configuration blocks SEO consent, while excluding SEO preserves the usual explicit partial start',async()=>{
 const pending=deferred(),h=harness({seoConfigurationReply:async()=>pending.promise});
 try{
  await h.settle();select(h);assert.equal(h.button('작업 개시').props.disabled,true);await h.click('작업 개시');assert.equal(h.component('batch-work-panel'),undefined);
  check(h,'전체 작업',false);check(h,'가격 작업',true);assert.equal(h.button('작업 개시').props.disabled,false);await h.click('작업 개시');
  const request=h.component('batch-work-panel').runRequest;assert.deepEqual(plain(request.stages),['pricing']);assert.equal(request.seoGenerationConsent,undefined);assert.ok(h.requests.every(request=>request.method==='GET'));
  pending.resolve(configurationReply());await h.settle();assert.equal(h.component('batch-work-panel').runRequest.id,request.id);
 }finally{h.close();}
});

for(const invalid of ['owner','company','freeOnly','provider','missing','failure'])test('unverified '+invalid+' configuration never authorizes SEO and an explicit notice retry may recover',async()=>{
 const h=harness({seoConfigurationReply:async()=>{
  const config=seoConfiguration();if(invalid==='freeOnly')config.freeOnly=false;if(invalid==='provider')config.destination='Paid provider';
  if(invalid==='failure')return Response.json({error:'합성 설정 조회 실패'},{status:503});
  if(invalid==='missing')return Response.json({purpose:'seo-generation',ownerId:'test-owner',company:scope().company});
  return configurationReply(config,invalid==='owner'?'foreign-owner':'test-owner',invalid==='company'?scope('test-owner','A01464742').company:scope().company);
 }});
 try{
  await h.settle();select(h);assert.equal(h.button('작업 개시').props.disabled,true);await h.click('작업 개시');assert.equal(h.component('batch-work-panel'),undefined);
  await h.click('선택 상품 일괄 작업');assert.ok(nodes(h.render()).some(node=>node.props?.['aria-label']==='SEO 실행 전 안내'));h.setSeoConfigurationReply(async()=>configurationReply());await h.toggleDetails('SEO 실행 전 안내');await h.click('SEO 실행 안내 다시 확인');assert.equal(h.button('작업 개시').props.disabled,false);await h.click('작업 개시');assert.equal(h.component('batch-work-panel').runRequest.seoGenerationConsent.freeOnly,true);assert.ok(h.requests.every(request=>request.method==='GET'));
 }finally{h.close();}
});

test('configured false is honestly displayed and carries no permission for a paid fallback',async()=>{
 const config={...seoConfiguration(),configured:false,issues:['무료 AI 바인딩을 확인해주세요.']},h=harness({seoConfigurationReply:async()=>configurationReply(config)});
 try{await h.settle();select(h);assert.doesNotMatch(text(h.render()),/SEO 생성 사용 불가: 무료 AI 바인딩/);assert.equal(h.button('작업 개시').props.disabled,false);await h.click('작업 개시');assert.match(text(h.render()),/SEO 생성 사용 불가: 무료 AI 바인딩/);assert.deepEqual(plain(h.component('batch-work-panel').runRequest.seoGenerationConsent),plain(config));}finally{h.close();}
});

test('owner A/B/A revokes old consent and drops late configuration responses before a fresh one-click start',async()=>{
 const h=harness(),pending=[];
 try{
  await h.settle();select(h);const oldStart=h.button('작업 개시').props.onClick;
  h.setSeoConfigurationReply(async(_url,init)=>{const request={...deferred(),signal:init.signal};pending.push(request);return request.promise;});
  for(const owner of ['other-owner','test-owner']){for(const product of h.products)product.owner_id=owner;h.setSettingsBody({settings:{brand:owner},scope:scope(owner)});h.switchOwner(owner);await h.settle();}
  assert.equal(pending.length,2);assert.equal(pending[0].signal.aborted,true);assert.equal(h.button('작업 개시').props.disabled,true);oldStart();assert.equal(h.component('batch-work-panel'),undefined);
  pending[0].resolve(configurationReply({...seoConfiguration(),notice:'이전 계정 안내'},'other-owner'));await h.settle();assert.equal(h.button('작업 개시').props.disabled,true);assert.doesNotMatch(text(h.render()),/이전 계정 안내/);
  pending[1].resolve(configurationReply());await h.settle();oldStart();assert.equal(h.component('batch-work-panel'),undefined);await h.click('작업 개시');assert.equal(h.component('batch-work-panel').runRequest.ownerId,'test-owner');
 }finally{h.close();}
});

test('settings and same-owner company A/B/A changes revoke displayed consent until the new server notice is verified',async()=>{
 const h=harness(),pending=[];
 try{
  await h.settle();select(h);const oldStart=h.button('작업 개시').props.onClick;
  h.setSeoConfigurationReply(async(_url,init)=>{const request={...deferred(),signal:init.signal};pending.push(request);return request.promise;});
  for(const code of ['A01464742','A01526306']){h.setSettingsBody({settings:{brand:'현재 '+code},scope:scope('test-owner',code)});h.component('collection-batch-panel').onSaved();await h.settle();}
  assert.equal(pending.length,2);assert.equal(pending[0].signal.aborted,true);assert.equal(h.button('작업 개시').props.disabled,true);oldStart();assert.equal(h.component('batch-work-panel'),undefined);
  pending[0].resolve(configurationReply({...seoConfiguration(),notice:'이전 회사 안내'},'test-owner',scope('test-owner','A01464742').company));await h.settle();assert.equal(h.button('작업 개시').props.disabled,true);assert.doesNotMatch(text(h.render()),/이전 회사 안내/);
  const current={...seoConfiguration(),notice:'현재 회사·설정의 무료 SEO 실행 안내'};pending[1].resolve(configurationReply(current));await h.settle();oldStart();assert.equal(h.component('batch-work-panel'),undefined);await h.click('작업 개시');assert.equal(h.component('batch-work-panel').runRequest.seoGenerationConsent.notice,current.notice);
 }finally{h.close();}
});

test('a settings epoch change and unmount revoke consent before any stale callback can start',async()=>{
 const h=harness();await h.settle();select(h);const old=h.button('작업 개시').props.onClick;
 await h.click('＋ 상품 추가');h.component('intake-queue-panel').onSettingsReloadStarted();old();await h.settle();assert.equal(h.component('batch-work-panel'),undefined);assert.equal(h.button('작업 개시').props.disabled,true);
 h.close();old();assert.equal(h.lateWrites,0);assert.ok(h.requests.every(request=>request.method==='GET'));
});
