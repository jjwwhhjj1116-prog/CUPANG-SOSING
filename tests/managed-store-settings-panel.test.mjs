import test from 'node:test';
import assert from 'node:assert/strict';
import {storeCompanies,storeFixture,storeUI,deferred,nodes,text,plain} from './helpers/managed-store-settings-ui.mjs';

const puts=panel=>panel.requests.filter(request=>request.init.method==='PUT'),saving=panel=>nodes(panel.render()).find(node=>node.props?.['aria-label']==='허용 스토어 설정').props['data-workspace-saving'];
async function untilCommitted(panel,condition){for(let i=0;i<1000;i++){await panel.settlePending();if(condition())return;await new Promise(resolve=>setTimeout(resolve,2));}throw Error('Synthetic pending preference commit did not arrive');}

for(const company of storeCompanies)test(`explicit owner/company store save preserves order/case/duplicates and every product/price/draft (${company.code})`,async()=>{
 const f=await storeFixture(company),panel=storeUI(f);try{const before=f.source();await panel.idle();assert.equal(panel.field().props.value,'');assert.equal(puts(panel).length,0);panel.edit('허용 스토어 목록','  와이홉 , , 곰곰, 탐사, 곰곰, AbC, abc  ');assert.equal(f.preferences().length,0);
  await panel.click('저장');const latest=await f.get();assert.equal(latest.revision,1);assert.deepEqual(latest.allowedVendorNames,['와이홉','곰곰','탐사','곰곰','AbC','abc']);assert.ok(latest.updatedAt);assert.equal(puts(panel).length,1);assert.equal(panel.saved.length,1);assert.equal(panel.closes.length,1);assert.equal(panel.locks.at(-1),false);assert.equal(f.source(),before);
  const reopened=storeUI(f);try{await reopened.idle();assert.equal(reopened.field().props.value,latest.allowedVendorNames.join(', '));const current=nodes(reopened.render()).find(node=>node.props?.className==='managed-store-current');assert.deepEqual(nodes(current).filter(node=>node.type==='span').map(text),latest.allowedVendorNames);assert.equal(puts(reopened).length,0);assert.equal(f.source(),before);}finally{reopened.close();}
 }finally{panel.close();f.close();}
});

test('revision-zero empty names need explicit creation while an existing identical list keeps revision/time/fingerprint',async()=>{
 for(const company of storeCompanies){const f=await storeFixture(company),panel=storeUI(f);try{const before=f.source();await panel.idle();await panel.click('저장');const first=await f.get();assert.equal(first.revision,1);assert.deepEqual(first.allowedVendorNames,[]);assert.equal(panel.saved.length,1);
  const noop=storeUI(f);try{await noop.idle();await noop.click('저장');assert.deepEqual(await f.get(),first);assert.equal(puts(noop).length,1);assert.equal(noop.saved.length,1);assert.equal(noop.closes.length,1);assert.equal(f.source(),before);}finally{noop.close();}
 }finally{panel.close();f.close();}}
});

test('cancel writes nothing, same-tick edits reject old save/reload/close callbacks, and invalid names retain raw input',async()=>{
 const f=await storeFixture(),panel=storeUI(f);try{await panel.idle();const before=f.source(),oldSave=panel.button('저장').props.onClick,oldReload=panel.button('다시 조회').props.onClick,oldClose=panel.button('취소').props.onClick;
  panel.field().props.onChange({target:{value:'새 이름, 곰곰'}});oldSave();oldReload();oldClose();await panel.idle();assert.equal(panel.field().props.value,'새 이름, 곰곰');assert.equal(puts(panel).length,0);assert.equal(panel.closes.length,0);
  for(const raw of ['이름'.repeat(101),Array.from({length:101},(_,i)=>'스토어'+i).join(','),'이름\u0000']){panel.edit('허용 스토어 목록',raw);await panel.click('저장');assert.equal(panel.field().props.value,raw);assert.equal(puts(panel).length,0);assert.ok(nodes(panel.render()).some(node=>node.props?.role==='alert'));}
  await panel.click('취소');assert.equal(panel.closes.length,1);assert.equal(panel.saved.length,0);assert.deepEqual(f.preferences(),[]);assert.equal(f.source(),before);
 }finally{panel.close();f.close();}
});

test('strict initial GET response refuses wrong scope, damaged revision/provenance and unnormalized names without editable defaults',async()=>{
 const f=await storeFixture();try{const original=await f.get(),before=f.source(),changes=[view=>{view.company.code='A01526306';},view=>{view.company.name='잘못된 회사';},view=>{view.accountContext='f'.repeat(64);},view=>{view.revision=-1;},view=>{view.revision=0;view.updatedAt='2026-10-01T00:00:00.000Z';},view=>{view.inputFingerprint='bad';},view=>{view.allowedVendorNames=[''];},view=>{view.allowedVendorNames=['공백 '];},view=>{view.extra='unverified';}];
  for(const change of changes){const value=plain(original);change(value);const panel=storeUI(f,{fetcher:async()=>Response.json(value)});try{await panel.idle();assert.equal(panel.field().props.disabled,true);assert.equal(panel.button('저장').props.disabled,true);assert.equal(panel.field().props.value,'');assert.equal(panel.saved.length,0);assert.equal(panel.closes.length,0);assert.ok(nodes(panel.render()).some(node=>node.props?.role==='alert'));}finally{panel.close();}}
  assert.equal(f.source(),before);assert.deepEqual(f.preferences(),[]);
 }finally{f.close();}
});

test('late initial success/failure cannot expose old company/account names or close another dialog',async()=>{
 const f=await storeFixture(storeCompanies[0],{names:['원래 회사 이름']});try{const body=await f.get(),before=f.source();for(const outcome of ['success','failure'])for(const boundary of ['code','name','account','unmount']){
  const wait=deferred();let first=true;const panel=storeUI(f,{fetcher:async(url,init)=>first?(first=false,wait.promise):f.request(url,init)});await panel.settlePending();const originalSignal=panel.requests[0].init.signal;
  if(boundary==='code')panel.props({company:storeCompanies[1]});if(boundary==='name')panel.props({company:{...f.company,name:'다른 회사명'}});if(boundary==='account')panel.props({accountContext:'f'.repeat(64)});if(boundary==='unmount')panel.close();
  assert.equal(originalSignal.aborted,true);if(outcome==='success')wait.resolve(Response.json(body));else wait.reject(Error('late read'));await panel.settlePending();assert.equal(panel.saved.length,0);assert.equal(panel.closes.length,0);if(boundary!=='unmount')assert.ok(!text(panel.render()).includes('원래 회사 이름'));panel.close();
 }assert.equal(f.source(),before);}finally{f.close();}
});

test('pending PUT freezes input, refresh, close and duplicate save until verified readback releases the parent lock',async()=>{
 const f=await storeFixture(),wait=deferred();let held=true;const panel=storeUI(f,{fetcher:async(url,init)=>init?.method==='PUT'&&held?(held=false,wait.promise):f.request(url,init)});try{
  await panel.idle();const before=f.source();panel.edit('허용 스토어 목록','곰곰, 탐사');const save=panel.button('저장').props.onClick,input=panel.field().props.onChange,close=panel.button('취소').props.onClick,reload=panel.button('다시 조회').props.onClick;save();save();input({target:{value:'늦은 이름'}});close();reload();await panel.settlePending();assert.equal(puts(panel).length,1);assert.equal(panel.field().props.value,'곰곰, 탐사');assert.equal(panel.field().props.disabled,true);assert.equal(panel.closes.length,0);assert.equal(panel.locks.at(-1),true);assert.equal(saving(panel),true);
  const put=puts(panel)[0];wait.resolve(await f.request(put.url,put.init));await panel.idle();assert.equal(panel.saved.length,1);assert.equal(panel.closes.length,1);assert.equal(panel.locks.at(-1),false);assert.equal(f.source(),before);
 }finally{panel.close();f.close();}
});

test('lost committed ACK recovers the exact desired list by explicit GET without a second PUT, including initial empty and existing noop',async()=>{
 for(const mode of ['changed','initial-empty','existing-noop']){const f=await storeFixture(storeCompanies[0],mode==='existing-noop'?{names:['곰곰']}:{});let lost=true;const panel=storeUI(f,{fetcher:async(url,init)=>{const response=await f.request(url,init);if(init?.method==='PUT'&&lost){lost=false;await response.clone().json();throw Error('synthetic ACK lost');}return response;}});try{
  await panel.idle();const before=f.source();if(mode==='changed')panel.edit('허용 스토어 목록',' 곰곰, 탐사, 곰곰 ');const oldSave=panel.button('저장').props.onClick;await panel.click('저장');assert.equal(panel.saved.length,0);assert.equal(panel.closes.length,0);assert.equal(panel.field().props.disabled,true);assert.equal(panel.locks.at(-1),true);const reads=panel.requests.length;oldSave();await panel.settlePending();assert.equal(panel.requests.length,reads);
  await panel.click('저장 결과 확인');assert.equal(puts(panel).length,1);assert.equal(panel.saved.length,1);assert.equal(panel.closes.length,1);assert.equal(panel.locks.at(-1),false);assert.equal(f.source(),before);
 }finally{panel.close();f.close();}}
});

test('uncommitted failure recovers only the exact original and requires a further explicit save; HTTP 409/429/503 never auto-retry',async()=>{
 for(const status of ['lost',409,429,503]){const f=await storeFixture();let fail=true;const panel=storeUI(f,{fetcher:async(url,init)=>{if(init?.method==='PUT'&&fail){fail=false;if(status==='lost')throw Error('before synthetic write');return Response.json({error:'synthetic rejected save'},{status});}return f.request(url,init);}});try{
  await panel.idle();const before=f.source();panel.edit('허용 스토어 목록',' 곰곰, 탐사 ');await panel.click('저장');assert.equal(puts(panel).length,1);assert.equal(panel.saved.length,0);assert.equal(panel.closes.length,0);assert.equal(panel.locks.at(-1),true);assert.deepEqual(f.preferences(),[]);
  await panel.click('저장 결과 확인');assert.equal(puts(panel).length,1);assert.equal(panel.field().props.value,' 곰곰, 탐사 ');assert.equal(panel.field().props.disabled,false);assert.equal(panel.saved.length,0);assert.equal(panel.locks.at(-1),false);await panel.click('저장');assert.equal(puts(panel).length,2);assert.equal(panel.saved.length,1);assert.equal(panel.closes.length,1);assert.equal(f.source(),before);
 }finally{panel.close();f.close();}}
});

test('a changed post-ACK projection or another committed preference keeps the original draft and cannot report save success',async()=>{
 const f=await storeFixture();let changed=false;const panel=storeUI(f,{fetcher:async(url,init)=>{const response=await f.request(url,init);if(init?.method==='PUT'&&!changed){changed=true;await f.put(await f.get(),['동시 변경 이름']);}return response;}});try{
  await panel.idle();const before=f.source();panel.edit('허용 스토어 목록','내가 검토한 이름');await panel.click('저장');assert.equal(puts(panel).length,1);assert.equal(panel.saved.length,0);assert.equal(panel.closes.length,0);assert.equal(panel.field().props.value,'내가 검토한 이름');assert.equal(panel.field().props.disabled,true);assert.equal(panel.locks.at(-1),true);
  await panel.click('저장 결과 확인');assert.equal(puts(panel).length,1);assert.equal(panel.saved.length,0);assert.equal(panel.closes.length,0);assert.deepEqual((await f.get()).allowedVendorNames,['동시 변경 이름']);await panel.click('닫기');assert.equal(panel.closes.length,1);assert.equal(panel.locks.at(-1),false);assert.equal(f.source(),before);
 }finally{panel.close();f.close();}
});

test('owner/company switch or unmount during a committed pending response cannot adopt old names or notify a later dialog',async()=>{
 for(const boundary of ['company','name','account','unmount']){const f=await storeFixture(),wait=deferred();let originalResponse;const panel=storeUI(f,{fetcher:async(url,init)=>{const response=await f.request(url,init);if(init?.method==='PUT'){originalResponse=response;return wait.promise;}return response;}});try{
  await panel.idle();const before=f.source();panel.edit('허용 스토어 목록','이전 계정 이름');panel.button('저장').props.onClick();await untilCommitted(panel,()=>!!originalResponse);assert.ok(originalResponse);const signal=puts(panel)[0].init.signal;
  if(boundary==='company')panel.props({company:storeCompanies[1]});if(boundary==='name')panel.props({company:{...f.company,name:'다른 회사명'}});if(boundary==='account')panel.props({accountContext:'f'.repeat(64)});if(boundary==='unmount')panel.close();assert.equal(signal.aborted,true);wait.resolve(originalResponse);await panel.settlePending();assert.equal(panel.saved.length,0);assert.equal(panel.closes.length,0);if(boundary!=='unmount')assert.ok(!text(panel.render()).includes('이전 계정 이름'));assert.equal(f.source(),before);
 }finally{panel.close();f.close();}}
});
