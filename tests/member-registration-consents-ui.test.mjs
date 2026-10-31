import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { providedOptionModule } from './helpers/provided-option-quotation.mjs';

const native = createRequire(import.meta.url), model = providedOptionModule('app/member-registration-consents.ts'), plain = value => JSON.parse(JSON.stringify(value));
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const company = { code: 'A01526306', name: '유앤채' }, now = Date.parse('2026-10-31T01:00:00.000Z');
const actor = { email: 'member@example.test', role: 'member', credentialVersion: 2 }, connectionId = '11111111-1111-4111-8111-111111111111';
const connection = () => ({ id: connectionId, service: 'supplier-hub', alias: '개인 연동', loginId: 'supplier@example.test', hasPassword: true, enabled: true, revision: 3, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() });
function challenge(kind = 'price-data', id = 'a'.repeat(64)) { return { id, docId: 12345, packetDigest: 'b'.repeat(64), issuedAt: now, expiresAt: now + 120000,
  stage: kind === 'price-data' ? 'productPage' : 'imagePage', items: [{ key: kind === 'price-data' ? 'msrpAgree' : 'labelContactAgreed', id: kind === 'price-data' ? 'agreeMSRPTerm' : 'agreeLabelContact',
    title: '화면의 실제 약관 제목', text: '화면의 실제 동의 안내', termsText: '약관 첫 문단\n반드시 보존할 마지막 문단', required: true }] }; }
async function policy(kind = 'price-data', patch = {}) { const terms = model.memberRegistrationConsentFromChallenge(challenge(kind), now + 1); return { kind, connectionId, connectionRevision: 3,
  revision: 1, enabled: true, termsVersion: model.MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, termsSha256: await model.memberRegistrationConsentTermsSha256(terms), terms,
  acceptedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), actor: plain(actor), ...patch }; }

async function fixture(options = {}) {
  const calls = [], effects = [], layout = [], timers = new Map(); let active, tree, closed = false, lateWrites = 0, reply = null, clock = now + 1, nextTimer = 0, savedCallbacks = 0;
  let props = { ownerId: 'member-a', company: plain(company), ...(options.challenge ? { challenge: options.challenge } : {}), onSaved() { savedCallbacks++; } };
  const currentActor = options.actor ?? actor, connections = options.connections ?? [connection()], policies = options.policies ?? [], view = () => ({ format: 'yoofam-member-registration-consents-v1', ownerId: props.ownerId, company: plain(props.company), actor: plain(currentActor), connections: plain(connections), policies: plain(policies) });
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const clean = instance => { if (!instance) return; for (const slot of instance.slots) slot?.cleanup?.(); instance.mounted = false; };
  const effectHook = queue => (effect, deps) => { const owner = active, index = owner.cursor++, old = owner.slots[index];
    if (!old || deps === undefined || deps.some((value, i) => !Object.is(value, old.deps?.[i]))) { owner.slots[index] = { deps, cleanup: old?.cleanup };
      queue.push(() => { if (!owner.mounted) return; old?.cleanup?.(); owner.slots[index].cleanup = effect(); }); } };
  const hooks = {
    useState(initial) { const owner = active, index = owner.cursor++; if (!(index in owner.slots)) owner.slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [owner.slots[index].value, value => { if (!owner.mounted) { lateWrites++; return; } owner.slots[index].value = typeof value === 'function' ? value(owner.slots[index].value) : value; }]; },
    useRef(initial) { const index = active.cursor++; return active.slots[index] ?? (active.slots[index] = { current: initial }); },
    useMemo(fn, deps) { const index = active.cursor++, old = active.slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) active.slots[index] = { deps, value: fn() }; return active.slots[index].value; },
    useEffect: effectHook(effects), useLayoutEffect: effectHook(layout),
  };
  const fetcher = async (url, init = {}) => {
    assert.equal(url, '/api/supplier-hub/registration-consents'); assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    const call = { method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined, signal: init.signal }; calls.push(call);
    if (reply) return reply(call, defaultReply); return defaultReply(call);
  };
  function defaultReply(call) {
    if (call.method === 'GET') return Response.json(view()); const body = call.body;
    assert.equal(body.expectedOwnerId, props.ownerId); assert.deepEqual(body.expectedCompany, props.company);
    let row = policies.find(item => item.connectionId === body.connectionId && item.kind === body.kind);
    if (body.action === 'save') { const next = { kind: body.kind, connectionId: body.connectionId, connectionRevision: body.expectedConnectionRevision, revision: body.expectedRevision + 1,
      enabled: true, termsVersion: body.termsVersion, termsSha256: body.termsSha256, terms: body.terms, acceptedAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString(), actor: plain(currentActor) };
      if (row) Object.assign(row, next); else { row = next; policies.push(row); }
    } else { assert.equal(body.action, 'set-enabled'); row.enabled = body.enabled; row.revision++; row.updatedAt = new Date(clock).toISOString(); }
    return Response.json(view());
  }
  const exports = {}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/components/member-registration-consents-panel.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
  { exports, Error, Date: ClockDate, Intl, AbortController, fetch: fetcher, setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { at: clock + delay, fn }); return id; }, clearTimeout(id) { timers.delete(id); },
    require: name => name === 'react' ? hooks : name === '@/app/member-registration-consents' ? { ...model, memberRegistrationConsentFromChallenge: (value, time = clock) => model.memberRegistrationConsentFromChallenge(value, time) } : name.endsWith('.css') ? {} : native(name) });
  const Component = exports.MemberRegistrationConsentsPanel;
  function render(next = props) { if (closed) return null; props = next; const wrapper = Component(props);
    if (!active || active.key !== wrapper.key) { clean(active); active = { key: wrapper.key, slots: [], cursor: 0, mounted: true }; }
    active.cursor = 0; tree = wrapper.type(wrapper.props); layout.splice(0).forEach(effect => effect()); effects.splice(0).forEach(effect => effect()); return tree; }
  const h = { calls, connections, policies, view, render, text: () => text(render()), get savedCallbacks() { return savedCallbacks; }, get lateWrites() { return lateWrites; }, get props() { return props; },
    setReply(fn) { reply = fn; }, button(label) { return nodes(render()).find(node => node.type === 'button' && text(node) === label); },
    checkbox() { return nodes(render()).find(node => node.type === 'input' && node.props.type === 'checkbox'); },
    check() { const input = h.checkbox(); assert.ok(input); assert.equal(Boolean(input.props.disabled), false); input.props.onChange({ target: { checked: true } }); render(); },
    async settle() { for (let count = 0; count < 14; count++) { render(); await new Promise(resolve => setImmediate(resolve)); } },
    async click(label) { const button = h.button(label); assert.ok(button, label); assert.equal(Boolean(button.props.disabled), false, label); button.props.onClick(); await h.settle(); },
    advance(ms) { clock += ms; for (const [id, value] of [...timers]) if (value.at <= clock) { timers.delete(id); value.fn(); } render(); },
    close() { if (closed) return; clean(active); closed = true; },
  };
  return h;
}

test('account settings start disabled, display saved exact terms, and cannot create unseen terms', async () => {
  for (const policies of [[], [await policy(), await policy('label-contact', { enabled: false })]]) {
    const h = await fixture({ policies }); try { await h.settle(); assert.match(h.text(), /등록전송 동의 설정/); assert.equal(h.checkbox(), undefined); assert.equal(h.button('확인한 약관 자동 적용 저장'), undefined);
      if (policies.length) { assert.match(h.text(), /반드시 보존할 마지막 문단/); await h.click('사용 중지'); assert.equal(h.policies[0].enabled, false); await h.click('자동 적용 사용'); assert.equal(h.policies[0].enabled, true); }
      else { assert.match(h.text(), /아직 확인하여 저장한 약관이 없습니다/); assert.equal(h.calls.length, 1); }
      assert.ok(h.calls.filter(call => call.method === 'POST').every(call => call.body.action === 'set-enabled' && !Object.hasOwn(call.body, 'terms')));
    } finally { h.close(); }
  }
});

for (const kind of ['price-data', 'label-contact']) test(`${kind}: first opt-in requires the current displayed complete terms and an unchecked explicit choice`, async () => {
  const h = await fixture({ challenge: challenge(kind) }); try {
    await h.settle(); assert.match(h.text(), /반드시 보존할 마지막 문단/); assert.equal(h.checkbox().props.checked, false); const stale = h.button('확인한 약관 자동 적용 저장').props.onClick;
    stale(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 0); h.check();
    const save = h.button('확인한 약관 자동 적용 저장').props.onClick; save(); save(); await h.settle();
    const posts = h.calls.filter(call => call.method === 'POST'); assert.equal(posts.length, 1); assert.equal(posts[0].body.kind, kind); assert.equal(posts[0].body.expectedOwnerId, 'member-a');
    assert.equal(posts[0].body.expectedConnectionRevision, 3); assert.equal(posts[0].body.accepted, true); assert.equal(posts[0].body.enabled, true);
    assert.deepEqual(posts[0].body.terms, plain(model.memberRegistrationConsentFromChallenge(challenge(kind), now + 1))); assert.equal(h.savedCallbacks, 1); assert.equal(h.checkbox().props.checked, false);
    save(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1, 'retained checkbox handler cannot save again');
  } finally { h.close(); }
});

test('expired, changed and ABA-returned challenge callbacks cannot reuse a previous checkbox', async () => {
  const h = await fixture({ challenge: challenge() }); try {
    await h.settle(); h.check(); const save = h.button('확인한 약관 자동 적용 저장').props.onClick, original = h.props;
    h.render({ ...original, challenge: challenge('label-contact', 'c'.repeat(64)) }); await h.settle(); assert.equal(h.checkbox().props.checked, false); save(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
    h.render(original); await h.settle(); assert.equal(h.checkbox().props.checked, false); save(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 0);
    h.check(); const fresh = h.button('확인한 약관 자동 적용 저장').props.onClick; h.advance(120000); fresh(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 0); assert.equal(h.checkbox(), undefined);
  } finally { h.close(); }
});

test('disabled, changed, wrong-service and missing credentials cannot implicitly enable a policy or opt into new terms', async () => {
  for (const patch of [{ enabled: false }, { revision: 4 }, { service: '1688' }, { hasPassword: false }]) {
    const h = await fixture({ policies: [await policy()], connections: [{ ...connection(), ...patch }], challenge: challenge() });
    try { await h.settle(); assert.equal(h.button('사용 중지').props.disabled, patch.service === '1688'); assert.match(h.text(), /다시 확인 필요/); if (patch.revision === undefined) assert.equal(h.button('확인한 약관 자동 적용 저장').props.disabled, true); }
    finally { h.close(); }
  }
});

test('withdrawal of a stale connection or actor policy uses the current connection revision while preserving the original accepted binding', async () => {
  for (const mode of ['connection-revision', 'disabled-connection', 'missing-credentials', 'actor-credential']) {
    const original = await policy(), changedConnection = { ...connection(), ...(mode === 'connection-revision' ? { revision: 4 } : mode === 'disabled-connection' ? { enabled: false } : mode === 'missing-credentials' ? { hasPassword: false } : {}) },
      h = await fixture({ policies: [original], connections: [changedConnection], actor: mode === 'actor-credential' ? { ...actor, credentialVersion: 3 } : actor });
    try {
      await h.settle(); assert.match(h.text(), /다시 확인 필요/); await h.click('사용 중지');
      const post = h.calls.find(call => call.method === 'POST'); assert.equal(post.body.action, 'set-enabled'); assert.equal(post.body.enabled, false); assert.equal(post.body.expectedConnectionRevision, changedConnection.revision);
      assert.equal(h.policies[0].connectionRevision, 3); assert.equal(h.policies[0].acceptedAt, original.acceptedAt); assert.deepEqual(h.policies[0].actor, actor);
      assert.equal(h.button('자동 적용 사용').props.disabled, true, mode); const enable = h.button('자동 적용 사용').props.onClick; enable(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1, mode);
      assert.doesNotMatch(h.text(), /이전 저장 결과를 확인/);
    } finally { h.close(); }
  }
});

test('unknown save acknowledgement blocks replay and explicit readback discovers the same record', async () => {
  const h = await fixture({ challenge: challenge() }); try {
    await h.settle(); h.check(); h.setReply((call, normal) => { const response = normal(call); if (call.method === 'POST') throw Error('lost acknowledgement'); return response; });
    const save = h.button('확인한 약관 자동 적용 저장').props.onClick; save(); await h.settle(); assert.equal(h.policies.length, 1); assert.equal(h.savedCallbacks, 0); assert.match(h.text(), /이전 저장 결과/);
    save(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1); await h.click('설정 새로고침'); assert.equal(h.policies.length, 1); assert.match(h.text(), /자동 적용 사용/); assert.equal(h.checkbox().props.checked, false);
  } finally { h.close(); }
});

test('foreign/secret-bearing views and owner/company scope changes reject late replies without forwarding a save callback', async () => {
  for (const mutate of [body => { body.ownerId = 'other'; }, body => { body.connections[0].password = 'never-display'; }, body => { body.company = { code: 'A01464742', name: '와이홉' }; }]) {
    const h = await fixture({ challenge: challenge() }); try { h.setReply(() => { const body = h.view(); mutate(body); return Response.json(body); }); await h.settle(); assert.equal(h.checkbox(), undefined); assert.doesNotMatch(h.text(), /never-display/); } finally { h.close(); }
  }
  const h = await fixture({ challenge: challenge() }), held = deferred(); try {
    await h.settle(); h.check(); h.setReply(call => call.method === 'POST' ? held.promise : Response.json(h.view())); const save = h.button('확인한 약관 자동 적용 저장').props.onClick; save(); await h.settle();
    const original = h.props; h.render({ ...original, ownerId: 'member-b', company: { code: 'A01464742', name: '와이홉' } }); await h.settle(); h.render(original); await h.settle();
    held.resolve(Response.json({ ...h.view(), policies: [await policy()] })); await h.settle(); save(); await h.settle(); assert.equal(h.calls.filter(call => call.method === 'POST').length, 1); assert.equal(h.savedCallbacks, 0); assert.equal(h.lateWrites, 0);
  } finally { held.resolve(); h.close(); }
});
