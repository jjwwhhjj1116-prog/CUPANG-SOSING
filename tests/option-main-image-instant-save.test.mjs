import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';

// Exercise the real mounted editor and private API/SQLite fixtures without
// registering the separate explicit-save regression file's tests.
const fixturePath='tests/option-main-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath),fixtureText=fs.readFileSync(fixtureURL,'utf8'),ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const statements=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','editor'].includes(node.name?.text));
const source=statements.map(node=>{let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return value;}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href))+'\nexport {fixture,editor,visible,text};';
const {fixture,editor,visible,text}=await import('data:text/javascript,'+encodeURIComponent(source));
const plain=value=>JSON.parse(JSON.stringify(value));
const section=h=>visible(h.render()).find(node=>node.props?.['aria-label']==='옵션 최종 견적 대표이미지 편집');
const image=h=>visible(section(h)).find(node=>node.type==='img'&&node.props.alt==='최종 견적 대표이미지')?.props.src;
const protectedSource=f=>JSON.stringify({tables:['product_options','product_content','product_price_policy','collection_results','collection_jobs','collection_context'].map(table=>[table,f.backend.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]),files:[...f.backend.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')])});
const candidate=(h,view,key)=>h.button(`최종 대표이미지 ${view.imageKeys.indexOf(key)+1} 선택`);
const puts=f=>f.calls.filter(call=>call.method==='PUT');

for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}])test(`wizard selection, blank and reset immediately save only the exact final SKU image (${company.code})`,async()=>{
 const f=await fixture(company),h=editor(f,{wrapper:true});try{
  await h.idle();const before=await f.read(),unchanged=protectedSource(f),network=[...f.backend.network],model=f.backend.load('app/quotation-main-image.ts');
  assert.equal(puts(f).length,0);assert.equal(h.button('최종 견적 대표이미지 저장'),undefined);assert.match(text(section(h)),/선택·비우기·복원하면 바로 저장/);
  await h.click(candidate(h,before,f.nextKey).props['aria-label']);assert.equal(puts(f).length,1);assert.deepEqual(plain(puts(f)[0].body),{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:plain(model.mainImageChanges(before,f.id,f.nextKey))});
  let saved=await f.read();assert.equal(saved.resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.nextKey);assert.equal(section(h).props['data-workspace-dirty'],false);assert.equal(h.saved.length,1);
  for(const row of before.resolved.rows.filter(row=>row.optionId!==f.id))assert.deepEqual(plain(saved.resolved.rows.find(value=>value.optionId===row.optionId)),plain(row));
  await h.click(candidate(h,saved,f.nextKey).props['aria-label']);assert.equal(puts(f).length,1,'reselecting the already saved exact override is a no-op');
  await h.click('최종 대표이미지 비우기');assert.equal(puts(f).length,2);saved=await f.read();assert.equal(saved.resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,'');assert.equal(image(h),undefined);
  await h.click('공통·원본 대표이미지 복원');assert.equal(puts(f).length,3);saved=await f.read();const target=model.verifyMainImageView(saved);assert.ok(target.linked.every(field=>!Object.hasOwn(saved.overrides.options[f.id]??{},field)));assert.equal(saved.resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,model.mainImageValue(saved,f.id,null));assert.equal(h.saved.length,3);
  assert.equal(protectedSource(f),unchanged);assert.ok(f.calls.every(call=>['GET','PUT'].includes(call.method)));assert.equal(f.backend.sqlite.prepare('SELECT supplier_hub_status FROM products WHERE id=?').get(f.product.id).supplier_hub_status,'미전송');assert.deepEqual(f.backend.network,network,'image selection adds no source or native requests to the synthetic intake fixture');
 }finally{h.close();f.close();}
});

test('the default standalone mode still requires an explicit save',async()=>{
 const f=await fixture(),h=editor(f);try{await h.idle();const before=await f.read();await h.click(candidate(h,before,f.nextKey).props['aria-label']);assert.equal(puts(f).length,0);assert.equal(section(h).props['data-workspace-dirty'],true);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.key);await h.click('최종 견적 대표이미지 저장');assert.equal(puts(f).length,1);}finally{h.close();f.close();}
});

test('same-tick and in-flight wizard candidate/blank callbacks produce one PUT and keep the first exact choice',async()=>{
 const f=await fixture(),original=f.request;let hold=false,release;f.request=async(url,init={})=>{if(hold&&url===f.endpoint&&(init.method??'GET')==='GET'){hold=false;await new Promise(resolve=>{release=resolve;});}return original(url,init);};
 const h=editor(f,{wrapper:true});try{
  await h.idle();const before=await f.read(),choose=candidate(h,before,f.nextKey).props.onClick,other=candidate(h,before,f.source).props.onClick,blank=h.button('최종 대표이미지 비우기').props.onClick;
  hold=true;choose();choose();other();blank();await h.idle();assert.ok(release);assert.equal(section(h).props['data-workspace-saving'],true);assert.equal(image(h),'/api/files/'+f.nextKey);assert.equal(puts(f).length,0);other();blank();await h.idle();assert.equal(puts(f).length,0);
  release();await h.idle();assert.equal(puts(f).length,1);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.nextKey);assert.equal(h.saved.length,1);
 }finally{release?.();h.close();f.close();}
});

test('a rejected immediate PUT keeps its draft, does not retry on render, and offers guarded explicit recovery',async()=>{
 const f=await fixture(),route=f.backend.route;let reject=true;f.backend.route=async(url,options)=>{if(reject&&options?.method==='PUT'){reject=false;return Response.json({error:'synthetic write rejection'},{status:503});}return route(url,options);};const h=editor(f,{wrapper:true});try{
  await h.idle();const before=await f.read();await h.click(candidate(h,before,f.nextKey).props['aria-label']);assert.equal(puts(f).length,1);assert.equal(h.saved.length,0);assert.equal(section(h).props['data-workspace-dirty'],true);assert.equal(image(h),'/api/files/'+f.nextKey);assert.equal((await f.read()).resolved.rows.find(row=>row.optionId===f.id).fields.mainImage.value,f.key);assert.match(text(section(h)),/synthetic write rejection/);
  await h.idle();assert.equal(puts(f).length,1);const retry=h.button('선택한 대표이미지 다시 저장').props.onClick;h.props.imageProcessingBusy=true;await h.idle();retry();await h.idle();assert.equal(puts(f).length,1);assert.equal(section(h).props['data-workspace-dirty'],true);
  h.props.imageProcessingBusy=false;await h.idle();await h.click('선택한 대표이미지 다시 저장');assert.equal(puts(f).length,2);assert.equal(h.saved.length,1);assert.equal(section(h).props['data-workspace-dirty'],false);
 }finally{h.close();f.close();}
});

test('an uncertain committed immediate save blocks retained choices and only explicit recovery confirms without a second PUT',async()=>{
 const f=await fixture(),h=editor(f,{wrapper:true});try{
  await h.idle();const before=await f.read(),oldCandidate=candidate(h,before,f.source).props.onClick,oldBlank=h.button('최종 대표이미지 비우기').props.onClick;f.lost();await h.click(candidate(h,before,f.nextKey).props['aria-label']);
  assert.equal(puts(f).length,1);assert.equal(h.saved.length,0);assert.equal(section(h).props['data-workspace-dirty'],true);assert.equal(h.button('최종 대표이미지 비우기').props.disabled,true);oldCandidate();oldBlank();await h.idle();assert.equal(image(h),'/api/files/'+f.nextKey);assert.equal(puts(f).length,1);
  f.recover();await h.idle();assert.equal(puts(f).length,1);assert.equal(section(h).props['data-workspace-dirty'],true);await h.click('대표이미지 저장 결과 확인·재시도');assert.equal(puts(f).length,1);assert.equal(h.saved.length,1);assert.equal(section(h).props['data-workspace-dirty'],false);
 }finally{h.close();f.close();}
});

test('stale source clocks preserve the immediate choice without a PUT, and stale option callbacks never edit another SKU',async()=>{
 const f=await fixture(),h=editor(f);h.props.saveOnSelect=true;try{
  await h.idle();const before=await f.read(),old=candidate(h,before,f.nextKey).props.onClick,other=before.resolved.rows.filter(row=>row.optionId&&row.optionId!==f.id)[0].optionId;
  h.props.focusedOptionId=other;await h.idle();old();await h.idle();assert.equal(puts(f).length,0);assert.equal(section(h).props['data-workspace-dirty'],false);
  h.props.version=new Date(Date.parse(f.product.updated_at)+1).toISOString();await h.idle();await h.click(candidate(h,before,f.nextKey).props['aria-label']);assert.equal(puts(f).length,0);assert.equal(section(h).props['data-workspace-dirty'],true);assert.equal(image(h),'/api/files/'+f.nextKey);assert.match(text(section(h)),/최신 자료를 조회/);assert.deepEqual(plain(await f.read()),plain(before));
 }finally{h.close();f.close();}
});

for(const change of ['stage','lock'])test(`a ${change} change during the save preflight keeps the draft and prevents the automatic PUT`,async()=>{
 const f=await fixture(),original=f.request;let hold=false,release;f.request=async(url,init={})=>{if(hold&&url===f.endpoint&&(init.method??'GET')==='GET'){hold=false;await new Promise(resolve=>{release=resolve;});}return original(url,init);};const h=editor(f,{wrapper:true});try{
  await h.idle();const before=await f.read(),choose=candidate(h,before,f.nextKey).props.onClick;hold=true;choose();await h.idle();assert.ok(release);
  if(change==='stage')h.props.imageView=false;else h.props.imageProcessingBusy=true;await h.idle();release();await h.idle();assert.equal(puts(f).length,0);assert.equal(h.saved.length,0);
  if(change==='stage')h.props.imageView=true;else h.props.imageProcessingBusy=false;await h.idle();assert.equal(section(h).props['data-workspace-dirty'],true);assert.equal(image(h),'/api/files/'+f.nextKey);choose();await h.idle();assert.equal(puts(f).length,0,'an interrupted draft does not become an automatic retry');
  await h.click(change==='stage'?'대표이미지 저장 결과 확인·재시도':'선택한 대표이미지 다시 저장');assert.equal(puts(f).length,1);assert.equal(h.saved.length,1);
 }finally{release?.();h.close();f.close();}
});
