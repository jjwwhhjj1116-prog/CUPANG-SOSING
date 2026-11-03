import test from 'node:test';
import assert from 'node:assert/strict';
import { runtime, nodes, text, deferred } from './helpers/detail-workspace.mjs';
const settle = async () => { for (let index = 0; index < 15; index++) await new Promise(resolve => setImmediate(resolve)); };
function panel({ heldPrepare, lost = false, echoBusy = false,visionUnknown=false,failed=false,mixed=false } = {}) {
 let cursor = 0, closed = false, props, published, busy = [], saved = [], pending = [], calls = [], slots = [], effects = [], layouts = [];
 const view = { revision: 3, productVersion: '2026-11-01T00:00:00Z', categoryContext: { profileId: 'profile' } };
 const stored = { view, roles: { top: ['owner/top'], bottom: ['owner/bottom'] }, workspace: { revision: 1, digest: 'a'.repeat(64), document: { photos: [{ id: 'top', role: 'top' }, { id: 'one', role: 'body', key: 'owner/one' }, { id: 'two', role: 'body', key: 'owner/two' }, { id: 'bottom', role: 'bottom' }] } } };
 props = { selection: { productId: 'product', optionId: 'red', profileId: 'profile', view }, saved: stored, active: true, onToolbarActionsChange(next, retired) { if (next) published = next; else if (published === retired) published = null; },
  beforeApply: () => true, onBusyChange(value) { busy.push(value); if (echoBusy) props = { ...props, disabled: value }; }, onPendingChange(value) { pending.push(value); }, onSaved(reply) { saved.push(reply); props = { ...props, saved: { view: reply.view, workspace: reply.workspace, roles: reply.roles } }; } };
 const enqueue = (queue, fn, deps) => { const index = cursor++, old = slots[index]; if (!old || !deps || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) { const next = { deps }; slots[index] = next; queue.push(() => { old?.cleanup?.(); next.cleanup = fn(); }); } };
 const react = { useRef(value) { const index = cursor++; return slots[index] ?? (slots[index] = { current: value }); }, useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = { value: typeof value === 'function' ? value() : value }; return [slots[index].value, next => { assert.equal(closed, false, 'no late state write'); slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; }, useEffect(fn, deps) { enqueue(effects, fn, deps); }, useLayoutEffect(fn, deps) { enqueue(layouts, fn, deps); } };
 const helpers = {
  prepareDetailWorkspaceImageBatch: async (input, signal, progress) => { calls.push(['prepare', input.language]); const batch = { ...input, items: input.saved.workspace.document.photos.flatMap((photo, position) => photo.role === 'body' ? [{ photoId: photo.id, position, sourceKey: photo.key, status: 'ready', message: '', texts: [], rendered: { output: new Blob(['preview']) } }] : []) }; progress(batch, '준비 중'); await heldPrepare?.promise;
   if(visionUnknown){const retained={...batch,items:batch.items.map((item,index)=>index===0?{...item,status:'uncertain',visionAttempt:{request:{requestId:'original-vision'}},message:'원래 Vision 요청 확인 필요'}:{...item,status:'pending',rendered:undefined})};progress(retained,'원래 요청 확인 필요');return retained;}
   signal.throwIfAborted(); return failed ? {...batch,items:batch.items.map((row,index)=>mixed&&index===1?row:{...row,status:'failed',message:'VISION_TEXT_FIT',rendered:undefined})} : batch; },
  applyDetailWorkspaceBatchResult: async (batch, id, signal, progress) => { calls.push(['apply', id]); signal.throwIfAborted(); const item = batch.items.find(row => row.photoId === id); if (lost) { const next = { ...batch, items: batch.items.map(row => row === item ? { ...row, status: 'uncertain', attempt: {} } : row) }; progress(next); throw Error('ACK lost'); }
   const reply = { ...batch.saved, source: {}, key: 'owner/result-' + id, applied: true, workspace: { ...batch.saved.workspace, revision: batch.saved.workspace.revision + 1, digest: String(batch.saved.workspace.revision + 1), document: { ...batch.saved.workspace.document, photos: batch.saved.workspace.document.photos.map(photo => photo.id === id ? { ...photo, key: 'owner/result-' + id } : photo) } } };
   const next = { ...batch, saved: { view: reply.view, workspace: reply.workspace, roles: reply.roles }, lastReply: reply, items: batch.items.map(row => row === item ? { ...row, status: 'applied' } : row) }; progress(next); return next; },
  recoverDetailWorkspaceBatchResult: async batch => { calls.push(['recover']); return { ...batch, items: batch.items.map(row => row.status === 'uncertain' ? { ...row, status: 'ready', attempt: undefined } : row) }; }
 };
 const r = runtime(async () => { throw Error('no fetch'); }, { react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, '@/app/detail-workspace-image-batch': helpers }), Component = r.load('app/components/detail-workspace-image-batch-panel.tsx').DetailWorkspaceImageBatchPanel;
 function render() { cursor = 0; const tree = Component(props); layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); return tree; }
 const control = label => nodes(render()).find(node => node.props?.['aria-label'] === label);
 const button = label => nodes(render()).find(node => node.type === 'button' && text(node) === label);
 return { render, control, button, calls, busy, saved, pending, get toolbar() { render(); return published; }, props: () => props, update(next) { props = { ...props, ...next }; render(); render(); }, async prepare(language = 'zh') { render(); render(); published.prepare(language); await settle(); render(); render(); }, review(id) { const checkbox = control(`작업 본문 사진 ${id} 번역 결과 검토 완료`); assert.ok(checkbox && !checkbox.props.disabled, id); checkbox.props.onChange({ target: { checked: true } }); render(); }, async click(label) { const node = button(label); assert.ok(node && !node.props.disabled, label + text(render())); node.props.onClick(); await settle(); render(); render(); }, close() { slots.forEach(slot => slot?.cleanup?.()); closed = true; } };
}
 test('toolbar preparation uses explicit language and only reviewed BODY rows apply across own parent busy echoes', async () => { const h = panel({ echoBusy: true }); try {
  await h.prepare('en'); assert.deepEqual(h.calls, [['prepare', 'en']]); h.review('one'); h.review('two'); await h.click('검토한 본문 사진 2개 적용'); assert.deepEqual(h.calls, [['prepare', 'en'], ['apply', 'one'], ['apply', 'two']]); assert.equal(h.saved.length, 2);
 } finally { h.close(); } });
 test('retired toolbar and ABA source callbacks cannot prepare or apply old previews', async () => { const h = panel(); try {
  h.render(); const old = h.toolbar, original = h.props(); h.update({ active: false }); h.update({ active: true }); old.prepare(); await settle(); assert.equal(h.calls.length, 0);
  await h.prepare(); h.review('one'); const retained = h.button('검토한 본문 사진 1개 적용'); h.update({ saved: { ...original.saved, workspace: { ...original.saved.workspace, digest: 'different' } } }); h.update({ saved: original.saved }); retained.props.onClick(); await settle(); assert.equal(h.calls.filter(row => row[0] === 'apply').length, 0); assert.equal(h.control('작업 본문 사진 one 번역 결과 검토 완료').props.disabled, true);
 } finally { h.close(); } });
 test('unknown save stops later rows and survives stage changes for explicit recovery without replay', async () => { const h = panel({ lost: true }); try {
  await h.prepare(); h.review('one'); h.review('two'); await h.click('검토한 본문 사진 2개 적용'); assert.deepEqual(h.calls.filter(row => row[0] === 'apply'), [['apply', 'one']]); h.update({ active: false }); h.update({ active: true }); await h.click('같은 작업 사진 저장 상태 확인'); assert.deepEqual(h.calls.filter(row => row[0] !== 'prepare'), [['apply', 'one'], ['recover']]); assert.equal(h.button('검토한 본문 사진 0개 적용').props.disabled, true); assert.equal(h.control('작업 본문 사진 two 번역 결과 검토 완료').props.disabled, true, 'recovering one unknown attempt must not renew other retired results');
 } finally { h.close(); } });
 test('active/source/configuration changes during OCR retire late completion and callback, while unmount leaves no late state write', async () => { const held = deferred(), h = panel({ heldPrepare: held }); try {
  const toolbar = h.toolbar; toolbar.prepare(); await settle(); h.update({ active: false }); h.update({ active: true }); held.resolve(); await settle(); h.render(); assert.equal(h.calls.filter(row => row[0] === 'apply').length, 0); assert.equal(h.control('작업 본문 사진 one 번역 결과 검토 완료').props.disabled, true);
 } finally { h.close(); } });

test('changing the selected source language retires reviewed results and disabled ABA retires toolbar ownership', async () => {
 const h = panel(); try {
  await h.prepare(); h.review('one'); const oldApply = h.button('검토한 본문 사진 1개 적용'), toolbar = h.toolbar;
  const language = h.control('본문 사진 원문 언어'); language.props.onChange({ target: { value: 'en' } }); h.render(); oldApply.props.onClick(); await settle();
  assert.equal(h.calls.filter(row => row[0] === 'apply').length, 0); assert.equal(h.control('작업 본문 사진 one 번역 결과 검토 완료').props.disabled, true);
  h.update({ disabled: true }); h.update({ disabled: false }); toolbar.prepare(); await settle(); assert.equal(h.calls.filter(row => row[0] === 'prepare').length, 1);
 } finally { h.close(); }
});

test('explicitly closing confirmed unused previews releases the pending fence while unknown attempts cannot close', async () => {
 const h = panel(); try {
  await h.prepare(); assert.equal(h.pending.at(-1), true); const close = h.button('번역 미리보기 닫기'); assert.ok(close && !close.props.disabled); await h.click('번역 미리보기 닫기'); assert.equal(h.pending.at(-1), false); assert.equal(h.control('작업 본문 사진 one 번역 결과 검토 완료'), undefined);
 } finally { h.close(); }
 const unknown = panel({ lost: true }); try {
  await unknown.prepare(); unknown.review('one'); await unknown.click('검토한 본문 사진 1개 적용'); const close = unknown.button('번역 미리보기 닫기'); assert.ok(!close || close.props.disabled); assert.equal(unknown.pending.at(-1), true);
 } finally { unknown.close(); }
});

test('unknown Vision arriving after preparation abort retains the fence across stage changes and permits only original recovery',async()=>{
 const held=deferred(),h=panel({heldPrepare:held,visionUnknown:true});try{
  h.toolbar.prepare();await settle();h.update({active:false});h.update({active:true});held.resolve();await settle();h.render();h.render();
  assert.equal(h.toolbar.disabled,true);assert.equal(h.button('번역 미리보기 닫기').props.disabled,true);
  const before=h.calls.length;h.toolbar.prepare();await settle();assert.equal(h.calls.length,before);await h.click('같은 작업 사진 저장 상태 확인');assert.deepEqual(h.calls,[['prepare','zh'],['recover']]);
 }finally{h.close();}
});

test('a failed BODY row opens that exact photo for manual review without re-running preparation or losing results',async()=>{
 const h=panel({failed:true}),opened=[];try{
  h.update({onReviewPhoto:(id,language)=>opened.push([id,language])});await h.prepare('en');
  const review=h.control('작업 본문 사진 one 개별 편집');assert.ok(review&&!review.props.disabled);review.props.onClick();await settle();
  assert.deepEqual(opened,[['one','en']]);assert.deepEqual(h.calls,[['prepare','en']]);assert.equal(h.pending.at(-1),false);
  const retired=h.control('작업 본문 사진 two 개별 편집');h.update({active:false});h.update({active:true});retired.props.onClick();assert.equal(opened.length,1);
 }finally{h.close();}
});

test('manual failed-photo navigation stays blocked while another BODY preview awaits review or an unknown request remains',async()=>{
 for(const mode of [{failed:true,mixed:true},{visionUnknown:true}]){const h=panel(mode),opened=[];try{
  h.update({onReviewPhoto:id=>opened.push(id)});await h.prepare();
  const review=h.control('작업 본문 사진 one 개별 편집');assert.ok(!review||review.props.disabled);review?.props.onClick();assert.deepEqual(opened,[]);
 }finally{h.close();}}
});
