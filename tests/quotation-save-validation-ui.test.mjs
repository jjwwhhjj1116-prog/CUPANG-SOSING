import test from 'node:test';
import assert from 'node:assert/strict';
import {quotationTitleUI,quotationTitleLoader,titleText} from './helpers/quotation-seo-title-ui.mjs';
import {quotationValidationFixture,companies,plain} from './helpers/quotation-save-validation.mjs';
const status=ui=>ui.nodes().find(node=>node.props?.['aria-label']==='저장본 입력 검사 상태');
const writes=ui=>ui.calls.filter(call=>call.init?.method&&call.init.method!=='GET');
const loadBoard=quotationTitleLoader();
async function settle(ui){const deadline=Date.now()+5000;do{await ui.idle();if(!ui.nodes().some(node=>node.type==='section'&&node.props.className==='quotation-fields'&&node.props['aria-busy']))return;}while(Date.now()<deadline);assert.fail('quotation form did not finish its request');}

for(const company of companies)test(company.code+': current saved validation reaches editor and exact option/global board stages, while an unsaved draft cannot claim completion',async()=>{
 const f=await quotationValidationFixture(company,{captured:true});let ui;try{
  const view=await f.save();ui=quotationTitleUI({view,request:f.request,props:{productId:f.id}});await settle(ui);
  assert.equal(status(ui),undefined,'normal quotation editing omits the diagnostic status');
  ui.render({adminTools:'visible'});assert.ok(status(ui),'administrator diagnostics show the verified saved form status');assert.match(titleText(status(ui)),/검사.*통과|작성.*완료/);
  const board=loadBoard('app/components/product-option-board.tsx'),data=await board.readOptionBoard(f.id,new AbortController().signal,f.request);
  assert.equal(data.optionStages['synthetic-one'].quotation.state,'complete');assert.equal(data.optionStages['synthetic-two'].quotation.state,'complete');assert.equal(data.registrationStages.quotation.state,'complete');
  ui.field('model').props.onChange({target:{value:'아직 저장하지 않은 모델'}});ui.render();assert.equal(status(ui),undefined);assert.equal(writes(ui).length,0);
  ui.button('견적 입력 저장').props.onClick();await settle(ui);assert.equal(writes(ui).filter(call=>call.init.method==='PUT').length,1);assert.ok(status(ui));assert.equal(ui.changes.length,0);assert.deepEqual(f.h.network,[]);
  const pending=await f.save([{fieldKey:'taxType',optionId:'synthetic-two',value:''}]);assert.ok(pending.savedValidation);const partial=await board.readOptionBoard(f.id,new AbortController().signal,f.request);
  assert.equal(partial.optionStages['synthetic-one'].quotation.state,'complete');assert.equal(partial.optionStages['synthetic-two'].quotation.state,'pending');assert.equal(partial.registrationStages.quotation.state,'pending');
 }finally{ui?.close();f.close();}
});

test('explicit saved-input recheck uses POST once, keeps all values and clocks, and ignores a retained dirty/locked/unmounted action',async()=>{
 const f=await quotationValidationFixture();let ui;try{
  await f.save();const row=f.h.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get('owner'),settings=JSON.parse(row.payload);settings.brand='합성 변경 브랜드';f.h.sqlite.prepare('UPDATE workspace_settings SET payload=? WHERE owner_id=?').run(JSON.stringify(settings),'owner');
  const view=await f.read();assert.equal(view.savedValidation,undefined);ui=quotationTitleUI({view,request:f.request,props:{productId:f.id,profileId:f.profile.id,adminTools:'visible'}});await settle(ui);const action=ui.button('저장본 입력 검사');assert.ok(action);
  const before=JSON.stringify(view.overrides);action.props.onClick();action.props.onClick();await settle(ui);assert.equal(writes(ui).length,1);assert.equal(writes(ui)[0].init.method,'POST');assert.equal(JSON.parse(writes(ui)[0].init.body).action,'validate-saved');assert.ok(status(ui));assert.equal(ui.changes.length,0);assert.equal(JSON.stringify((await f.read()).overrides),before);assert.equal((await f.read()).revision,view.revision);assert.equal((await f.read()).productVersion,view.productVersion);
  const retained=ui.button('저장본 입력 검사').props.onClick;ui.field('model').props.onChange({target:{value:'동일 tick 새 입력'}});retained();await ui.idle();assert.equal(writes(ui).length,1,'current draft invalidates the old recheck before rerender');
  ui.close();ui=quotationTitleUI({view:await f.read(),request:f.request,props:{productId:f.id,profileId:f.profile.id,adminTools:'visible'}});await settle(ui);const current=ui.button('저장본 입력 검사').props.onClick,native=ui.nodes().find(node=>node.type?.name==='SupplierHubSingleReview');assert.ok(native);native.props.onLockChange(true,false);current();await ui.idle();assert.equal(writes(ui).length,0,'native source lock is synchronous');
  native.props.onLockChange(false,false);await ui.idle();const closed=ui.button('저장본 입력 검사').props.onClick;ui.close();closed();await ui.idle();assert.equal(writes(ui).length,0,'unmounted action cannot create metadata writes');ui=null;assert.deepEqual(f.h.network,[]);
 }finally{ui?.close();f.close();}
});

test('malformed or differently bound saved status never makes option rows complete',async()=>{
 const f=await quotationValidationFixture(companies[0],{captured:true});try{
  const view=await f.save(),board=loadBoard('app/components/product-option-board.tsx');
  for(const mutate of [proof=>{proof.registered=true;},proof=>{proof.revision++;},proof=>{proof.rows[0].optionId='different-option';},proof=>{proof.rows[0].included=false;},proof=>{proof.inputFingerprint='0'.repeat(64);},proof=>{proof.rows.push(plain(proof.rows[0]));},null]){
   const bad=plain(view);if(mutate)mutate(bad.savedValidation);else delete bad.savedValidation;
   const request=async(url,init)=>String(url).includes('/quotation-fields')?Response.json(bad):f.request(url,init),data=await board.readOptionBoard(f.id,new AbortController().signal,request);assert.equal(data.optionStages['synthetic-one'].quotation.state,'pending');assert.equal(data.registrationStages.quotation.state,'pending');
  }
 }finally{f.close();}
});

test('lost metadata response never guesses completion or replays PUT, and reopening reads the server result',async()=>{
 const f=await quotationValidationFixture();let ui;try{
  const view=await f.save();let notified=0;
  ui=quotationTitleUI({view,props:{productId:f.id,profileId:f.profile.id,adminTools:'visible',onSaved:()=>notified++},request:async(url,init)=>{const result=await f.request(url,init);if(init?.method==='POST')return{ok:true,status:200,json:async()=>{throw Error('synthetic response lost');}};return result;}});await settle(ui);
  ui.button('저장본 입력 검사').props.onClick();await settle(ui);assert.equal(notified,0);assert.equal(writes(ui).length,1);assert.equal(writes(ui)[0].init.method,'POST');assert.match(titleText(ui.nodes().filter(node=>node.props?.role==='alert')),/응답.*확인하지 못/);assert.match(titleText(status(ui)),/검사 대기/);assert.ok((await f.read()).savedValidation);
  ui.close();ui=quotationTitleUI({view:await f.read(),request:f.request,props:{productId:f.id,profileId:f.profile.id,adminTools:'visible'}});await settle(ui);assert.match(titleText(status(ui)),/작성 완료/);assert.equal(writes(ui).length,0);assert.deepEqual(f.h.network,[]);
 }finally{ui?.close();f.close();}
});

test('in-flight metadata response after unmount cannot notify or complete a retired editor',async()=>{
 const f=await quotationValidationFixture();let ui,release;try{
  const view=await f.save();let notified=0,ready;const received=new Promise(resolve=>{ready=resolve;}),hold=new Promise(resolve=>{release=resolve;});
  ui=quotationTitleUI({view,props:{productId:f.id,profileId:f.profile.id,adminTools:'visible',onSaved:()=>notified++},request:async(url,init)=>{const result=await f.request(url,init);if(init?.method==='POST'){ready();await hold;}return result;}});await settle(ui);ui.button('저장본 입력 검사').props.onClick();await received;ui.close();release();await ui.idle();assert.equal(notified,0);assert.equal(writes(ui).length,1);assert.equal(writes(ui)[0].init.signal.aborted,true);assert.ok((await f.read()).savedValidation);assert.deepEqual(f.h.network,[]);ui=null;
 }finally{release?.();ui?.close();f.close();}
});

test('failed input save preserves a dirty draft and cannot display the preceding saved completion',async()=>{
 const f=await quotationValidationFixture();let ui;try{
  const view=await f.save();ui=quotationTitleUI({view,props:{productId:f.id,profileId:f.profile.id},request:(url,init)=>init?.method==='PUT'?Response.json({error:'합성 입력 저장 실패'},{status:503}):f.request(url,init)});await settle(ui);
  assert.equal(ui.button('저장 상태 확인'),undefined);
  ui.field('model').props.onChange({target:{value:'실패해도 보존할 모델'}});ui.render();ui.button('견적 입력 저장').props.onClick();await settle(ui);
  assert.equal(status(ui),undefined);assert.equal(ui.changes[0].value,'실패해도 보존할 모델');assert.match(titleText(ui.nodes().filter(node=>node.props?.role==='alert')),/합성 입력 저장 실패/);assert.equal((await f.read()).revision,view.revision);assert.equal(writes(ui).length,1);
  assert.equal(ui.button('견적 입력 저장').props.disabled,true,'confirm the saved version before retrying the uncertain PUT');
  const readback=ui.button('저장 상태 확인');assert.ok(readback);
  const reads=ui.calls.filter(call=>!call.init?.method||call.init.method==='GET').length;
  readback.props.onClick();await settle(ui);
  assert.equal(ui.calls.filter(call=>!call.init?.method||call.init.method==='GET').length,reads+1);assert.equal(writes(ui).length,1);
  assert.equal(ui.changes[0].value,'실패해도 보존할 모델');assert.equal(ui.button('저장 상태 확인'),undefined);assert.equal(ui.button('견적 입력 저장').props.disabled,false);assert.deepEqual(f.h.network,[]);
 }finally{ui?.close();f.close();}
});
