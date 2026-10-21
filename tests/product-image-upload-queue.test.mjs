import test from 'node:test';import assert from 'node:assert/strict';
import {productImageUploadFixture,priceTableCompanies,imageFile,png,text,nodes} from './helpers/product-image-upload.mjs';
const writes=f=>f.calls.filter(call=>call.method==='POST'),pool=f=>JSON.parse(f.product().image_keys);
for(const company of priceTableCompanies){
 test(`Stage4 multiple selection waits for explicit start, local removal writes nothing and upload preserves selected order (${company.code})`,async()=>{
  const f=await productImageUploadFixture(company),ui=f.ui();try{
   await ui.select([imageFile('one.png'),imageFile('remove.png'),imageFile('two.png')]);assert.equal(f.calls.length,0);assert.match(text(ui.render()),/one.png/);await ui.click('remove.png 대기 목록에서 제외');assert.equal(f.calls.length,0);assert.doesNotMatch(text(ui.render()),/remove.png/);
   await ui.click('업로드 시작 (2)');assert.equal(ui.saved,1);assert.deepEqual(writes(f).map(call=>call.name??call.url.split('/').at(-1)),['one.png','attachments','two.png','attachments']);assert.equal(pool(f).length,3);assert.equal(pool(f)[0],f.originalKey);assert.match(pool(f)[1],/-one.png$/);assert.match(pool(f)[2],/-two.png$/);assert.equal(f.protectedSnapshot(),f.before);assert.deepEqual(Buffer.from(f.objects.get(f.originalKey)),png);assert.equal(ui.render().props['data-workspace-dirty'],false);
  }finally{ui.close();f.close();}
 });
 test(`Stage5 multiple selection immediately processes sequentially while still preserving pending errors (${company.code})`,async()=>{
  const f=await productImageUploadFixture(company),ui=f.ui({stage:'detail',immediate:true});try{
   await ui.select([imageFile('detail-one.png'),imageFile('detail-two.png')]);assert.equal(ui.saved,1);assert.equal(writes(f).length,4);assert.equal(pool(f).length,3);assert.match(pool(f)[1],/-detail-one.png$/);assert.match(pool(f)[2],/-detail-two.png$/);assert.ok(!nodes(ui.render()).some(node=>node.type==='button'&&text(node).startsWith('업로드 시작')));assert.equal(f.protectedSnapshot(),f.before);
  }finally{ui.close();f.close();}
 });
 test(`known upload rejection retains failed file and continues next; unknown upload ACK is never automatically replayed (${company.code})`,async()=>{
  const f=await productImageUploadFixture(company),ui=f.ui();try{
   let fail=true;f.controls.response=(call,response)=>{if(fail&&call.url==='/api/files'){fail=false;return Response.json({error:'synthetic upload ACK lost'},{status:503});}return response;};await ui.select([imageFile('unknown.png'),imageFile('success.png')]);await ui.click('업로드 시작 (2)');assert.equal(writes(f).length,3);assert.equal(pool(f).length,2);assert.match(text(ui.render()),/unknown.png.*업로드 결과 확인 불가/);assert.equal(f.objects.size,3);const count=writes(f).length;
   await ui.select([imageFile('unknown.png')]);assert.equal(writes(f).length,count);assert.match(text(ui.render()),/이미 대기하거나 처리/);assert.equal(ui.render().props['data-workspace-dirty'],true);const dismiss=nodes(ui.render()).find(node=>node.type==='button'&&text(node)==='확인·대기에서 제외');dismiss.props.onClick();await ui.idle();assert.equal(ui.render().props['data-workspace-dirty'],false);assert.equal(writes(f).length,count);assert.equal(f.objects.size,3);assert.equal(f.protectedSnapshot(),f.before);
  }finally{ui.close();f.close();}
 });
 test(`attachment committed ACK loss stops remaining files; GET recovery confirms and never repeats either write (${company.code})`,async()=>{
  const f=await productImageUploadFixture(company),ui=f.ui();try{
   let lost=true;f.controls.response=(call,response)=>{if(lost&&call.url.endsWith('/attachments')){lost=false;return Response.json({error:'synthetic attachment ACK lost'},{status:503});}return response;};await ui.select([imageFile('held.png'),imageFile('later.png')]);await ui.click('업로드 시작 (2)');assert.equal(pool(f).length,2);assert.equal(writes(f).length,2);assert.equal(ui.saved,0);assert.match(text(ui.render()),/연결 결과 확인 필요/);
   const before=f.calls.length;await ui.click('held.png 저장 결과 확인');assert.ok(f.calls.slice(before).every(call=>call.method==='GET'));assert.equal(writes(f).length,2);assert.equal(ui.saved,1);await ui.click('업로드 시작 (1)');assert.equal(pool(f).length,3);assert.equal(writes(f).length,4);assert.equal(ui.saved,2);assert.equal(f.protectedSnapshot(),f.before);
  }finally{ui.close();f.close();}
 });
 test(`uncommitted attachment failure reads exact unchanged basis before explicit key-only retry (${company.code})`,async()=>{
  const f=await productImageUploadFixture(company),ui=f.ui();try{
   let fail=true;f.controls.before=call=>{if(fail&&call.url.endsWith('/attachments')){fail=false;throw Error('synthetic network interruption before commit');}};await ui.select([imageFile('stored.png')]);await ui.click('업로드 시작 (1)');assert.equal(pool(f).length,1);assert.equal(f.objects.size,2);assert.equal(writes(f).length,2);
   await ui.click('stored.png 저장 결과 확인');assert.equal(writes(f).length,2);assert.match(text(ui.render()),/연결되지 않은 상태/);await ui.click('저장된 파일 연결');assert.equal(pool(f).length,2);assert.equal(f.objects.size,2);assert.equal(writes(f).filter(call=>call.url==='/api/files').length,1);assert.equal(writes(f).length,3);assert.equal(ui.saved,1);assert.equal(f.protectedSnapshot(),f.before);
  }finally{ui.close();f.close();}
 });
}
test('file header/type/size and total pool preflight reject before any request, preserving previously selected files',async()=>{
 const f=await productImageUploadFixture(),ui=f.ui();try{
  await ui.select([imageFile('keep.png')]);for(const file of [new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'}),new File([],'empty.png',{type:'image/png'}),new File([new Uint8Array(10*1024*1024+1)],'huge.png',{type:'image/png'}),new File([png],'wrong.jpg',{type:'image/jpeg'})]){await ui.select([file]);assert.equal(f.calls.length,0);assert.match(text(ui.render()),/keep.png/);}
  ui.render({storedCount:150});await ui.select([imageFile('overflow.png')]);assert.equal(f.calls.length,0);assert.match(text(ui.render()),/150/);assert.equal(f.objects.size,1);
 }finally{ui.close();f.close();}
});
test('changed source version stops before upload, scope hiding during upload retains uncertainty and no late attachment can occur',async()=>{
 const f=await productImageUploadFixture(),ui=f.ui();try{
  await ui.select([imageFile('source.png')]);f.api.sqlite.prepare('UPDATE products SET updated_at=? WHERE id=?').run('2026-10-20T02:00:00.000Z',f.id);await ui.click('업로드 시작 (1)');assert.equal(writes(f).length,0);assert.match(text(ui.render()),/상품 저장본이 변경/);
  ui.render({version:f.product().updated_at});let arrive,release;const arrived=new Promise(resolve=>{arrive=resolve;}),hold=new Promise(resolve=>{release=resolve;});f.controls.before=async call=>{if(call.url==='/api/files'){arrive();await hold;}};ui.button('업로드 시작 (1)').props.onClick();await arrived;await ui.settle();ui.render({active:false});release();await ui.idle();ui.render({active:true});await ui.idle();assert.equal(writes(f).length,1);assert.equal(writes(f).filter(call=>call.url.endsWith('/attachments')).length,0);assert.equal(pool(f).length,1);assert.equal(ui.saved,0);assert.match(text(ui.render()),/업로드 결과 확인 불가/);assert.equal(f.protectedSnapshot(),f.before);
 }finally{ui.close();f.close();}
});
test('known rejected file is retained while later files proceed; forged upload owner cannot attach to the product',async()=>{
 for(const scenario of ['rejected','foreign-owner']){
  const f=await productImageUploadFixture(),ui=f.ui();try{
   let changed=true;f.controls.response=async(call,response)=>{if(changed&&call.url==='/api/files'){changed=false;if(scenario==='rejected')return Response.json({error:'synthetic request rejected'},{status:415});const body=await response.json();return Response.json({...body,key:'different-owner/foreign.png'},{status:201});}return response;};
   await ui.select([imageFile('first.png'),imageFile('next.png')]);await ui.click('업로드 시작 (2)');assert.equal(pool(f).length,2);assert.match(pool(f)[1],/-next.png$/);assert.equal(writes(f).length,3);assert.match(text(ui.render()),scenario==='rejected'?/확인 필요/:/업로드 결과 확인 불가/);assert.ok(!writes(f).some(call=>call.body?.key==='different-owner/foreign.png'));assert.equal(f.protectedSnapshot(),f.before);
  }finally{ui.close();f.close();}
 }
});
test('a changed pool after ambiguous attachment is never treated as the exact requested receipt',async()=>{
 const f=await productImageUploadFixture(),ui=f.ui();try{
  let lost=true;f.controls.response=(call,response)=>{if(lost&&call.url.endsWith('/attachments')){lost=false;return Response.json({error:'lost'},{status:503});}return response;};await ui.select([imageFile('uncertain.png')]);await ui.click('업로드 시작 (1)');const count=writes(f).length,current=pool(f);f.api.sqlite.prepare('UPDATE products SET image_keys=?,updated_at=? WHERE id=?').run(JSON.stringify([...current,f.owner+'/other.png']),'2026-10-21T01:00:00.000Z',f.id);const offset=f.calls.length;await ui.click('uncertain.png 저장 결과 확인');assert.ok(f.calls.slice(offset).every(call=>call.method==='GET'));assert.equal(ui.saved,0);assert.equal(writes(f).length,count);assert.match(text(ui.render()),/저장 상태가 변경/);assert.match(text(ui.render()),/연결 결과 확인 필요/);assert.equal(f.protectedSnapshot(),f.before);
 }finally{ui.close();f.close();}
});
test('disabled or hidden stage rejects retained start callbacks without clearing selected names',async()=>{
 const f=await productImageUploadFixture(),ui=f.ui();try{
  await ui.select([imageFile('pending.png')]);const start=ui.button('업로드 시작 (1)').props.onClick;ui.render({disabled:true});start();await ui.idle();assert.equal(f.calls.length,0);assert.match(text(ui.render()),/pending.png/);ui.render({disabled:false,active:false});start();await ui.idle();assert.equal(f.calls.length,0);ui.render({active:true});await ui.click('업로드 시작 (1)');assert.equal(ui.saved,1);assert.equal(pool(f).length,2);
 }finally{ui.close();f.close();}
});
