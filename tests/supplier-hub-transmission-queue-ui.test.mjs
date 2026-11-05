import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {quotationTitleLoader,titleNodes as nodes,titleText as text} from './helpers/quotation-seo-title-ui.mjs';
import {queueCandidate} from './helpers/transmission-queue.mjs';
import {SINGLE_COMPANIES} from './helpers/supplier-hub-single-document.mjs';
const file='app/components/supplier-hub-transmission-queue.tsx',turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(company=SINGLE_COMPANIES[0],options={}){
 assert.ok(fs.existsSync(new URL('../'+file,import.meta.url)),'sequential queue UI is implemented');
 const a=await queueCandidate(company),b=await queueCandidate(company,'synthetic-queue-second'),candidates=[a,b],slots=[],effects=[],locks=[],prepared=[],notified=[],edits=[];let cursor=0,closed=false;
 const hook=(fn,deps,layout)=>{const index=cursor++,old=slots[index];if(!old||!deps||deps.some((value,i)=>!Object.is(value,old.deps[i]))){old?.cleanup?.();slots[index]={deps};const run=()=>slots[index].cleanup=fn();layout?run():effects.push(run);}};
 const react={useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;return[slots[index],value=>slots[index]=typeof value==='function'?value(slots[index]):value];},useRef(value){const index=cursor++;return slots[index]??(slots[index]={current:value});},useMemo(fn,deps){const index=cursor++,old=slots[index];if(!old||deps.some((value,i)=>!Object.is(value,old.deps[i])))slots[index]={deps,value:fn()};return slots[index].value;},useEffect:(fn,deps)=>hook(fn,deps,false),useLayoutEffect:(fn,deps)=>hook(fn,deps,true)};
 react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
 const base=quotationTitleLoader()('app/supplier-hub-transmission-queue.ts');
 const load=quotationTitleLoader({react,'@/app/supplier-hub-transmission-queue':{...base,prepareTransmissionQueueCandidate:async(target,_profileId,signal)=>{prepared.push({id:target.id,signal});if(options.prepare)return options.prepare(target,signal,candidates);return candidates.find(row=>row.productId===target.id);},refreshTransmissionQueueCandidate:async candidate=>candidate.review},'@/app/components/supplier-hub-product-transport':{SupplierHubProductTransport:'transport'}});
 const Component=load(file).SupplierHubTransmissionQueue;let props={products:candidates.map(row=>({id:row.productId,title:row.title,updated_at:'v1'})),onLockChange:(source,close=source)=>locks.push([source,close]),onReceiptSaved:()=>notified.push(true),onInspect:id=>edits.push(id)};
 const render=updates=>{if(updates)props={...props,...updates};cursor=0;return Component(props);};
 const flush=()=>{if(closed)return;render();effects.splice(0).forEach(run=>run());};
 const idle=async()=>{for(let i=0;i<18;i++){flush();await turn();}};
 const button=label=>nodes(render()).find(node=>node.type==='button'&&text(node.props.children)===label);
 const transport=()=>nodes(render()).find(node=>node.type==='transport');
 const h={a,b,locks,prepared,notified,edits,render,flush,idle,button,transport,text:()=>text(render()),async click(label){const control=button(label);assert.ok(control&&!control.props.disabled,label);control.props.onClick();await idle();},close(){closed=true;slots.forEach(slot=>slot?.cleanup?.());}};
 await idle();return h;
}
for(const company of SINGLE_COMPANIES)test(company.code+': selected queue starts one request and advances once only after exact saved terminal receipt',async()=>{
 const h=await fixture(company);try{
  assert.equal(h.transport(),undefined);assert.equal(h.prepared.length,2);const start=h.button('선택 상품 등록전송 시작');assert.ok(start);start.props.onClick();start.props.onClick();await h.idle();
  const a=h.transport();assert.equal(a.props.review.identity.productId,h.a.productId);assert.equal(nodes(h.render()).filter(node=>node.type==='transport').length,1);
  a.props.onReceiptSaved(await h.a.record('SUBMITTED'));await h.idle();assert.equal(h.transport().props.review.identity.productId,h.a.productId);
  a.props.onReceiptSaved(await h.b.record('FINISHED'));await h.idle();assert.equal(h.transport().props.review.identity.productId,h.a.productId);
  a.props.onReceiptSaved(await h.a.record('FINISHED'));await h.idle();assert.equal(h.transport().props.review.identity.productId,h.b.productId);
  a.props.onReceiptSaved(await h.a.record('FINISHED'));await h.idle();assert.equal(h.transport().props.review.identity.productId,h.b.productId);
  h.transport().props.onReceiptSaved(await h.b.record('REJECTED'));await h.idle();assert.equal(h.transport(),undefined);assert.match(h.text(),/파일 처리 완료.*SKU 확인 전/);assert.match(h.text(),/파일 반려/);assert.equal(h.notified.length,3);
  const notifications=h.notified.length,locks=h.locks.length;start.props.onClick();await h.idle();assert.equal(h.transport(),undefined,'completed queue cannot restart from a retained start callback');assert.equal(h.notified.length,notifications);assert.equal(h.locks.length,locks);
 }finally{h.close();}
});
for(const company of SINGLE_COMPANIES)test(company.code+': stop retains active pending request, does not start another, and requires explicit reviewed resume',async()=>{
 const h=await fixture(company);try{
  await h.click('선택 상품 등록전송 시작');const current=h.transport();current.props.onLockChange(true,false);current.props.onReceiptSaved(await h.a.record('SUBMITTED'));await h.idle();
  const stop=h.button('다음 상품부터 중지');stop.props.onClick();await h.idle();assert.equal(h.transport().props.review.identity.productId,h.a.productId);assert.strictEqual(h.transport().props.queuedStart,current.props.queuedStart,'stop-next retains the original current handoff even before adoption');assert.deepEqual(h.locks.at(-1),[true,false]);
  current.props.onReceiptSaved(await h.a.record('FINISHED'));await h.idle();assert.equal(h.transport(),undefined);assert.ok(h.button('남은 상품 등록전송 시작'));
  const bindings=JSON.parse(h.button('남은 상품 등록전송 시작').props['data-supplier-hub-registration-items']);assert.deepEqual(bindings.map(row=>row.productId),[h.b.productId]);await h.click('남은 상품 등록전송 시작');assert.equal(h.transport().props.review.identity.productId,h.b.productId);assert.equal(h.transport().props.queuedStart.session.packet.requestId,h.b.session.packet.requestId);
 }finally{h.close();}
});
test('changed context and unmount retire old batch start and result callbacks without restarting work',async()=>{
 const h=await fixture();try{
  const oldStart=h.button('선택 상품 등록전송 시작');h.render({profileId:'different-profile'});await h.idle();oldStart.props.onClick();await h.idle();assert.equal(h.transport(),undefined);
  await h.click('선택 상품 등록전송 시작');const current=h.transport(),before=h.notified.length;h.close();current.props.onReceiptSaved(await h.a.record('FINISHED'));oldStart.props.onClick();assert.equal(h.notified.length,before);
 }finally{h.close();}
});
test('a failed candidate is excluded visibly while another reviewed new product can be sent',async()=>{
 const h=await fixture(undefined,{prepare:async(target,_signal,candidates)=>{if(target.id===candidates[0].productId)throw Error('원래 전송 이력이 있습니다.');return candidates[1];}});try{
  assert.match(h.text(),/원래 전송 이력/);await h.click('선택 상품 등록전송 시작');assert.equal(h.transport().props.review.identity.productId,h.b.productId);assert.equal(h.notified.length,0);
 }finally{h.close();}
});
