import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Reuse the real component scheduler and isolated saved-label fixture. Completion
// remains mocked at the existing image boundary; these cases verify the new
// result/form controls, exact text CAS and absence of implicit write operations.
const fixtureURL=new URL('./product-label-editor.test.mjs',import.meta.url),fixtureText=fs.readFileSync(fixtureURL,'utf8');
const ast=ts.createSourceFile(fixtureURL.pathname,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),parts=[];
for(const statement of ast.statements){
 if(ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.expression.getText(ast)==='test')break;
 let value=statement.getFullText(ast);
 if(ts.isImportDeclaration(statement)){const name=statement.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}
 parts.push(value);
}
let source=parts.join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
for(const [before,after] of [
 ['renderer,attach}={}','renderer,attach,resultFirst=true,active=true,disabled=false}={}'],
 ['version,profileId,refreshToken,onSaved()','version,profileId,refreshToken,resultFirst,active,disabled,onSaved()'],
 ['get saved(){return saved;}','setActive(value){active=value;render();},setDisabled(value){disabled=value;render();},get saved(){return saved;}'],
]){assert.ok(source.includes(before),before);source=source.replace(before,after);}
const {fixture,editor,nodes,text}=await import('data:text/javascript,'+encodeURIComponent(source+'\nexport {fixture,editor,nodes,text};'));
const writes=h=>h.calls.filter(call=>['PUT','POST','PATCH'].includes(call.init?.method));

test('result-first label opens an honest readonly preview and local rewrite never mutates a saved label',async()=>{
 const f=fixture(),before=structuredClone(f.view),h=editor((url,init)=>f.reply(url,init));
 try{
  await h.idle();assert.equal(h.input('선택 옵션 제품명'),undefined);
  assert.ok(nodes(h.render()).some(node=>node.props?.['aria-label']==='선택 옵션 표시사항 저장 전 미리보기'));
  assert.equal(nodes(h.render()).some(node=>node.type==='img'&&node.props['data-current-label-result']!==undefined),false);
  assert.equal(h.button('이미지 다운로드').props.disabled,true);assert.match(text(h.render()),/저장 전 미리보기/);
  assert.equal(writes(h).length,0);await h.click('재작성');
  assert.equal(h.input('선택 옵션 제품명').props.value,'검정 수정 제품명');assert.equal(writes(h).length,0);
  await h.click('결과 보기');assert.equal(h.input('선택 옵션 제품명'),undefined);assert.deepEqual(f.view,before);
 }finally{h.close();}
});

test('result-first editing saves exact option values and keeps manual blanks, other options and common values',async()=>{
 const f=fixture(),before=structuredClone(f.view),h=editor((url,init)=>f.reply(url,init));
 try{
  await h.idle();await h.click('재작성');h.edit('선택 옵션 제품명','검토한 라벨');h.edit('선택 옵션 원료명 및 성분명(재질)','');
  assert.equal(h.button('결과 보기').props.disabled,true);assert.equal(writes(h).length,0);
  await h.click('정보 저장하기');assert.equal(h.saved,1);assert.equal(writes(h).length,1);
  assert.deepEqual(JSON.parse(writes(h)[0].init.body).changes,[{optionId:'red',fieldKey:'productName',value:'검토한 라벨'},{optionId:'red',fieldKey:'material',value:''}]);
  assert.deepEqual(f.view.overrides.common,before.overrides.common);assert.deepEqual(f.view.overrides.options.blue,before.overrides.options.blue);
  assert.equal(f.view.overrides.options.red.material,'');assert.deepEqual(f.view.imageKeys,before.imageKeys);
  await h.click('결과 보기');assert.equal(h.input('선택 옵션 제품명'),undefined);assert.match(text(h.render()),/검토한 라벨/);
 }finally{h.close();}
});

test('result-first rewrite control respects disabled and hidden stages without exposing another option form',async()=>{
 const f=fixture(),h=editor((url,init)=>f.reply(url,init));
 try{
  await h.idle();const open=h.button('재작성').props.onClick;
  h.setDisabled(true);open();await h.idle();assert.equal(h.input('선택 옵션 제품명'),undefined);
  h.setDisabled(false);h.setActive(false);open();await h.idle();assert.equal(h.input('선택 옵션 제품명'),undefined);
  h.setActive(true);await h.click('재작성');assert.ok(h.input('선택 옵션 제품명'));
  const close=h.button('결과 보기').props.onClick;h.setDisabled(true);close();assert.ok(h.input('선택 옵션 제품명'));
  h.setDisabled(false);h.setActive(false);close();assert.ok(h.input('선택 옵션 제품명'));h.setActive(true);
  h.select('blue');await h.idle();assert.equal(h.input('선택 옵션 제품명'),undefined);assert.match(text(h.render()),/다른 옵션 제품명/);assert.equal(writes(h).length,0);
 }finally{h.close();}
});


test('result-first failed initial read offers a readonly retry before exposing the editor',async()=>{
 const f=fixture();let unavailable=true;
 const h=editor((url,init)=>unavailable?Response.json({error:'일시 조회 실패'},{status:503}):f.reply(url,init));
 try{
  await h.idle();assert.match(text(h.render()),/일시 조회 실패/);assert.equal(h.input('선택 옵션 제품명'),undefined);
  unavailable=false;await h.click('표시사항 다시 불러오기');assert.match(text(h.render()),/검정 수정 제품명/);
  assert.equal(h.input('선택 옵션 제품명'),undefined);assert.equal(writes(h).length,0);
  await h.click('재작성');assert.equal(h.input('선택 옵션 제품명').props.value,'검정 수정 제품명');
 }finally{h.close();}
});
