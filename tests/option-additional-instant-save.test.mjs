import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';

// Reuse the actual component renderer and private fixture backend without
// registering the standalone/manual and detailed-page regression tests.
const fixturePath='tests/option-image-editor.test.mjs',fixtureURL=pathToFileURL(process.cwd()+'/'+fixturePath),fixtureText=fs.readFileSync(fixtureURL,'utf8'),ast=ts.createSourceFile(fixturePath,fixtureText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const statements=ast.statements.filter(node=>ts.isImportDeclaration(node)||ts.isVariableStatement(node)||ts.isFunctionDeclaration(node)&&['fixture','imageUI','dragTransfer','dragEvent'].includes(node.name?.text));
const source=statements.map(node=>{let value=node.getFullText(ast);if(ts.isImportDeclaration(node)){const name=node.moduleSpecifier.text;if(!name.startsWith('node:'))value=value.replace("'"+name+"'",JSON.stringify(name.startsWith('.')?new URL(name,fixtureURL).href:import.meta.resolve(name)));}return value;}).join('\n').replaceAll('import.meta.url',JSON.stringify(fixtureURL.href))+'\nexport {fixture,imageUI,nodes,text,deferred,plain,json,mobileIntakeHarness};';
const {fixture,imageUI,nodes,text,deferred,plain,json,mobileIntakeHarness}=await import('data:text/javascript,'+encodeURIComponent(source));
const writes=h=>h.calls.filter(call=>call.init?.method==='PUT');
const currentImage=h=>nodes(h.render()).find(node=>node.type==='img'&&node.props.alt==='선택 옵션 추가 이미지 큰 미리보기')?.props.src;
function seed(f,keys=f.keys.slice(0,3)){
 f.reply('',{method:'PUT',body:JSON.stringify({expectedRevision:f.view.revision,changes:['additionalImages','wire-additionalImages'].map(fieldKey=>({optionId:'red',fieldKey,value:keys.join('\n')}))})});
 return f;
}

async function apiFixture(company){
 const api=mobileIntakeHarness(company);try{
  const live={format:'supplier-hub-schema-v1',categoryId:'80719',categoryPath:api.context.category.categoryPath,company:{code:company.companyCode,name:company.companyName},observedAt:Date.now(),inputBindings:'couplus-paths-v1',metadata:{kanCategoryId:80719,noticeNumber:1,scopeType:'Retail_Categorized_Single',version:1},schemaString:JSON.stringify({type:'object',properties:{startPage:{type:'object',properties:{productName:{type:'string',title:'상품명'}}},productPage:{type:'object',properties:{}},imagePage:{type:'object',properties:{images:{type:'object',properties:{additionalImage:{type:'string',title:'추가 이미지'}}},details:{type:'object',properties:{detailedImage:{type:'string',title:'상세 이미지'},htmlProductDetailContent:{type:'string',title:'HTML 상세 내용'}}}}},legalPage:{type:'object',properties:{}}}})};
  const profile=await api.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'추가 이미지 즉시 저장 시험',categoryId:'80719',categoryPath:live.categoryPath,hubSchema:live,template:null,mappings:[]},'cat-instant');api.context.category=profile;api.sqlite.prepare('UPDATE collection_context SET payload=? WHERE job_id=?').run(JSON.stringify(api.context),'job');await api.intake();
  const product=api.sqlite.prepare('SELECT * FROM products').get(),endpoint='/api/products/'+product.id+'/quotation-fields',keys=JSON.parse(product.image_keys),view=await json(await api.route(endpoint)),optionId=view.resolved.rows.find(row=>row.optionId).optionId,model=api.load('app/quotation-image-targets.ts');
  const saved=await json(await api.route(endpoint,{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes:model.optionImageChanges(view,optionId,{additionalImages:keys.slice(0,3).join('\n')})}}));
  return{api,product,endpoint,keys,optionId,model,view:saved,read:()=>api.route(endpoint).then(json),fetch:(url,init)=>api.route(url,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}),protectedSource:()=>JSON.stringify({tables:['product_content','product_options','product_price_policy','collection_results','collection_context'].map(table=>[table,api.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]),objects:[...api.objects].map(([key,value])=>[key,Buffer.from(value).toString('base64')])})};
 }catch(cause){api.close();throw cause;}
}

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`additional wizard previews read only; explicit add, move, drop and confirmed removal save one exact selected-SKU change (${company.companyCode})`,async()=>{
 const f=await apiFixture(company),prompts=[],targets=[];let accepted=false;const h=imageUI(f.fetch,{productId:f.product.id,optionId:f.optionId,version:f.view.productVersion,saveOnChange:true,confirmImage:message=>{prompts.push(message);return accepted;},onEdit:(...args)=>targets.push(args)});try{
  await h.idle();const before=await f.read(),protectedSource=f.protectedSource(),network=[...f.api.network],other=plain(before.overrides),index=f.keys.indexOf(f.keys[3])+1;
  assert.doesNotMatch(text(h.render()),/선택을 변경한 뒤 선택 옵션 이미지 저장/,'immediate mode must not instruct a second save before any change');
  assert.equal(writes(h).length,0);assert.equal(h.control(`선택 옵션 추가 이미지 후보 ${index}`),undefined);await h.click(`상품 저장 이미지 ${index} 크게 보기`);assert.equal(writes(h).length,0);assert.equal(currentImage(h),'/api/files/'+f.keys[3]);assert.equal(h.button('추가 이미지 4 편집하기'),undefined);
  await h.click(`추가 이미지 후보 ${index} 추가`);assert.equal(writes(h).length,1);assert.deepEqual(plain(JSON.parse(writes(h)[0].init.body)),{expectedRevision:before.revision,expectedInputFingerprint:before.inputFingerprint,changes:plain(f.model.optionImageChanges(before,f.optionId,{additionalImages:f.keys.slice(0,4).join('\n')}))});assert.deepEqual(h.ordered(),f.keys.slice(0,4));assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.saved,1);
  await h.click('추가 이미지 4 편집하기');assert.equal(targets.length,1);assert.equal(targets[0][2].optionId,f.optionId);assert.equal(targets[0][2].input,'additionalImages');assert.equal(targets[0][2].slotIndex,3);assert.equal(targets[0][0],f.keys[3]);assert.equal(writes(h).length,1,'editing entry alone adds no mutation');
  await h.click('추가 이미지 1 아래로 이동');assert.equal(writes(h).length,2);assert.deepEqual(h.ordered(),[f.keys[1],f.keys[0],f.keys[2],f.keys[3]]);
  await h.drag(f.keys[3],f.keys[1]);assert.equal(writes(h).length,3);assert.deepEqual(h.ordered(),[f.keys[3],f.keys[1],f.keys[0],f.keys[2]]);
  const ordered=h.ordered();await h.click('추가 이미지 2 선택 제거');assert.equal(prompts.length,1);assert.equal(writes(h).length,3);assert.deepEqual(h.ordered(),ordered);accepted=true;await h.click('추가 이미지 2 선택 제거');assert.equal(prompts.length,2);assert.equal(writes(h).length,4);assert.deepEqual(h.ordered(),[f.keys[3],f.keys[0],f.keys[2]]);assert.equal(h.saved,4);
  const saved=await f.read();assert.deepEqual(plain(saved.overrides.common),other.common);for(const [id,row]of Object.entries(other.options))if(id!==f.optionId)assert.deepEqual(plain(saved.overrides.options[id]),row);assert.equal(f.protectedSource(),protectedSource);assert.deepEqual(f.api.network,network);assert.ok(h.calls.every(call=>!call.init?.method||call.init.method==='PUT'));
 }finally{h.close();f.api.close();}
});

test('standalone additional and detailed-page editing keep explicit save even when detail receives saveOnChange',async()=>{
 for(const stage of ['additional','detail']){const f=fixture(),h=imageUI((url,init)=>f.reply(url,init),{stage,saveOnChange:stage==='detail'});try{
  await h.idle();h.choose(`선택 옵션 ${stage==='detail'?'상세 이미지':'추가 이미지'} 후보 4`);await h.idle();assert.equal(writes(h).length,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.match(text(h.render()),/선택을 변경한 뒤 선택 옵션 이미지 저장/);await h.click('선택 옵션 이미지 저장');assert.equal(writes(h).length,1);assert.equal(h.saved,1);
 }finally{h.close();}}
});

test('same-tick repeated add, reorder and removal callbacks cannot send a second in-flight PUT or replace the first draft',async()=>{
 const f=seed(fixture()),pending=deferred();let held;const h=imageUI((url,init)=>{if(init?.method==='PUT'){held={url,init};return pending.promise;}return f.reply(url,init);},{version:f.view.productVersion,saveOnChange:true});try{
  await h.idle();const add=h.button('추가 이미지 후보 4 추가').props.onClick,move=h.button('추가 이미지 1 아래로 이동').props.onClick,remove=h.button('추가 이미지 1 선택 제거').props.onClick;add();add();move();remove();h.render();assert.equal(writes(h).length,1);assert.deepEqual(h.ordered(),f.keys);assert.equal(h.render().props['data-workspace-saving'],true);add();move();remove();assert.equal(writes(h).length,1);
  assert.match(text(h.render()),/이미지 저장 상태를 확인하고 있습니다/);assert.doesNotMatch(text(h.render()),/이미지 저장 결과 확인을 눌러/,'a pending save must not ask for a disabled recovery action');
  pending.resolve(f.reply(held.url,held.init));await h.idle();assert.equal(writes(h).length,1);assert.equal(h.saved,1);assert.deepEqual(h.ordered(),f.keys);assert.equal(h.button('추가 이미지 후보 4 추가').props.disabled,true);
 }finally{pending.resolve(Response.json(f.view));h.close();}
});

test('delete confirmation is revalidated after cancel or option, profile, clock, active, mode and lock changes',async()=>{
 for(const mode of ['cancel','option','profile','clock','active','mode','lock']){const f=seed(fixture());let h;h=imageUI((url,init)=>f.reply(url,init),{version:f.view.productVersion,saveOnChange:true,confirmImage:()=>{if(mode==='option')h.select('blue');if(mode==='profile')h.profile('other-profile');if(mode==='clock')h.source('2026-10-08T00:00:00.000Z');if(mode==='active')h.active(false);if(mode==='mode')h.saveMode(false);if(mode==='lock')h.disabled(true);return mode!=='cancel';}});try{
  await h.idle();const before=plain(f.view);h.button('추가 이미지 1 선택 제거').props.onClick();await h.idle();assert.equal(writes(h).length,0,mode);assert.deepEqual(plain(f.view),before,mode);assert.equal(h.render().props['data-workspace-dirty'],false,mode);
 }finally{h.close();}}
});

test('rejected and unknown immediate saves preserve one choice and require explicit read-first recovery',async()=>{
 for(const committed of [false,true]){const f=seed(fixture());let fail=true;const h=imageUI((url,init)=>{if(init?.method==='PUT'&&fail){fail=false;if(committed){f.reply(url,init);throw Error('synthetic committed ACK lost');}return Response.json({error:'synthetic rejected save'},{status:503});}return f.reply(url,init);},{version:f.view.productVersion,saveOnChange:true});try{
  await h.idle();const add=h.button('추가 이미지 후보 4 추가').props.onClick,move=h.button('추가 이미지 1 아래로 이동').props.onClick;add();await h.idle();assert.equal(writes(h).length,1);assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.deepEqual(h.ordered(),f.keys);add();move();await h.idle();assert.equal(writes(h).length,1);assert.deepEqual(h.ordered(),f.keys);
  assert.match(text(h.render()),/이미지 저장 결과 확인을 눌러 반영 여부를 확인/);
  await h.click('이미지 저장 결과 확인');assert.equal(writes(h).length,1);if(committed){assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);}else{assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.button('추가 이미지 후보 4 추가').props.disabled,true);await h.click('선택 옵션 이미지 저장');assert.equal(writes(h).length,2);assert.equal(h.saved,1);}
 }finally{h.close();}}
});

test('a stale source keeps the intended add without writing, and retained callbacks never edit a changed scope',async()=>{
 const f=seed(fixture()),h=imageUI((url,init)=>f.reply(url,init),{version:f.view.productVersion,saveOnChange:true});try{
  await h.idle();const oldAdd=h.button('추가 이미지 후보 4 추가').props.onClick;h.select('blue');await h.idle();oldAdd();await h.idle();assert.equal(writes(h).length,0);assert.equal(h.render().props['data-workspace-dirty'],false);
  h.select('red');await h.idle();h.source('2026-10-08T00:00:00.000Z');await h.idle();await h.click('추가 이미지 후보 4 추가');assert.equal(writes(h).length,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.deepEqual(h.ordered(),f.keys);assert.match(text(h.render()),/최신 이미지를 조회/);
 }finally{h.close();}
});

test('confirmed clear and restore use exact empty/null changes and preserve explicit recovery controls',async()=>{
 const f=seed(fixture()),prompts=[],h=imageUI((url,init)=>f.reply(url,init),{version:f.view.productVersion,saveOnChange:true,confirmImage:message=>{prompts.push(message);return true;}});try{
  await h.idle();await h.click('추가 이미지 선택 비우기');assert.equal(writes(h).length,1);assert.equal(prompts.length,1);assert.match(prompts[0],/모두 삭제/);assert.ok(JSON.parse(writes(h)[0].init.body).changes.every(change=>change.optionId==='red'&&change.value===''));assert.deepEqual(h.ordered(),[]);
  await h.click('추가 이미지 공통·자동값 복원');assert.equal(writes(h).length,2);assert.ok(JSON.parse(writes(h)[1].init.body).changes.every(change=>change.optionId==='red'&&change.value===null));assert.equal(h.saved,2);assert.equal(h.render().props['data-workspace-dirty'],false);assert.deepEqual(h.ordered(),[f.keys[1]]);assert.ok(h.button('선택 옵션 이미지 저장'));
 }finally{h.close();}
});
