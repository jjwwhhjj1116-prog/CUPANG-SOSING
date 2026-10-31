import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { providedOptionModule } from './helpers/provided-option-quotation.mjs';

const model = providedOptionModule('app/member-registration-consents.ts'), plain = value => JSON.parse(JSON.stringify(value));
const now = '2026-10-31T01:00:00.000Z', time = Date.parse(now), connectionId = '11111111-1111-4111-8111-111111111111';
const scope = { ownerId: 'member-a', company: { code: 'A01526306', name: '유앤채' }, actor: { email: 'member@example.test', role: 'member', credentialVersion: 3 } };
const terms = (kind = 'price-data') => ({ stage: kind === 'price-data' ? 'productPage' : 'imagePage', key: kind === 'price-data' ? 'msrpAgree' : 'labelContactAgreed',
  id: kind === 'price-data' ? 'agreeMSRPTerm' : 'agreeLabelContact', title: '직접 표시된 약관 제목', text: '직접 표시된 동의 안내', termsText: '첫 번째 전문\n마지막 문단도 보존합니다. ' });
const connection = (patch = {}) => ({ id: connectionId, service: 'supplier-hub', alias: '연동 계정', loginId: 'supplier@example.test', enabled: true, hasPassword: true, revision: 2, createdAt: now, updatedAt: now, ...patch });
async function policy(kind = 'price-data', patch = {}) { const text = terms(kind); return { kind, connectionId, connectionRevision: 2, revision: 1, enabled: true,
  termsVersion: model.MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, termsSha256: await model.memberRegistrationConsentTermsSha256(text), terms: text, acceptedAt: now, updatedAt: now, actor: plain(scope.actor), ...patch }; }
const view = policies => ({ format: 'yoofam-member-registration-consents-v1', ...plain(scope), connections: [connection()], policies });
async function save(kind = 'price-data') { const text = terms(kind); return { action: 'save', expectedOwnerId: scope.ownerId, expectedCompany: plain(scope.company), kind, connectionId,
  expectedConnectionRevision: 2, expectedRevision: 0, enabled: true, accepted: true, termsVersion: model.MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, termsSha256: await model.memberRegistrationConsentTermsSha256(text), terms: text }; }
const challenge = (kind = 'price-data') => { const text = terms(kind), { stage, ...item } = text; return { id: 'a'.repeat(64), docId: 12345, packetDigest: 'b'.repeat(64), issuedAt: time, expiresAt: time + 120000, stage, items: [{ ...item, required: true }] }; };

test('exact displayed terms use stable canonical SHA and preserve every character of both distinct agreements', async () => {
  for (const kind of ['price-data', 'label-contact']) {
    const input = terms(kind), before = JSON.stringify(input), digest = await model.memberRegistrationConsentTermsSha256(input);
    const canonicalTerms = Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key]])), expected = createHash('sha256').update(JSON.stringify({ format: model.MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, terms: canonicalTerms })).digest('hex');
    assert.equal(digest, expected); assert.equal(await model.memberRegistrationConsentTermsSha256(Object.fromEntries(Object.entries(input).reverse())), digest);
    assert.notEqual(await model.memberRegistrationConsentTermsSha256({ ...input, termsText: input.termsText.trim() }), digest, 'whitespace changes are not silently normalized');
    assert.equal(JSON.stringify(input), before); assert.deepEqual(plain(model.memberRegistrationConsentFromChallenge(challenge(kind), time + 1)), input);
  }
  assert.notEqual(await model.memberRegistrationConsentTermsSha256(terms()), await model.memberRegistrationConsentTermsSha256(terms('label-contact')));
});

test('no absent, expired, mismatched, empty or unknown challenge creates a stored-terms descriptor', () => {
  for (const patch of [value => { value.expiresAt++; }, value => { value.issuedAt = time + 5001; }, value => { value.items = []; }, value => { value.items[0].required = false; },
    value => { value.items[0].termsText = ''; }, value => { value.items[0].key = 'unknown'; }, value => { value.stage = 'imagePage'; }, value => { value.stage = 'logisticsPage'; },
    value => { value.items.push({ ...value.items[0] }); }]) { const value = challenge(); patch(value); assert.equal(model.memberRegistrationConsentFromChallenge(value, time), null); }
  assert.equal(model.memberRegistrationConsentFromChallenge(challenge(), time - 1), null); assert.equal(model.memberRegistrationConsentFromChallenge(challenge(), time + 120000), null);
  for (const value of [null, {}, { ...terms(), password: 'never accepted' }]) assert.throws(() => model.validateMemberRegistrationConsentTerms(value));
});

test('only an explicit matching opt-in yields a save input; defaults and extra credentials fail closed', async () => {
  for (const kind of ['price-data', 'label-contact']) {
    const input = await save(kind), parsed = await model.memberRegistrationConsentInput(input, scope); assert.equal(parsed.action, 'save'); assert.equal(parsed.accepted, true); assert.equal(parsed.enabled, true);
    assert.equal(parsed.expectedOwnerId, undefined); assert.equal(parsed.expectedCompany, undefined); assert.deepEqual(plain(parsed.terms), terms(kind));
  }
  const base = await save();
  for (const patch of [{ accepted: false }, { accepted: undefined }, { enabled: false }, { enabled: 'true' }, { termsVersion: 'other' }, { termsSha256: 'c'.repeat(64) },
    { expectedConnectionRevision: 0 }, { expectedRevision: -1 }, { connectionId: 'unknown' }, { password: 'never accepted' }, { actor: scope.actor }, { kind: 'all-terms' },
    { terms: { ...base.terms, termsText: base.terms.termsText + '변경' } }, { kind: 'label-contact' }]) await assert.rejects(model.memberRegistrationConsentInput({ ...base, ...patch }, scope));
  for (const patch of [{ expectedOwnerId: 'another-member' }, { expectedCompany: { code: 'A01464742', name: '와이홉' } }])
    await assert.rejects(model.memberRegistrationConsentInput({ ...base, ...patch }, scope), error => error.status === 409 && error.code === 'REGISTRATION_CONSENTS_SCOPE');
});

test('state changes carry exact existing revisions and never accept terms, credentials or an implicit enable', async () => {
  const input = { action: 'set-enabled', expectedOwnerId: scope.ownerId, expectedCompany: scope.company, kind: 'price-data', connectionId, expectedConnectionRevision: 2, expectedRevision: 1, enabled: false };
  const parsed = await model.memberRegistrationConsentInput(input, scope); assert.equal(parsed.enabled, false); assert.equal(parsed.expectedRevision, 1);
  for (const patch of [{ enabled: undefined }, { expectedRevision: 0 }, { terms: terms() }, { password: 'never' }, { action: 'delete' }]) await assert.rejects(model.memberRegistrationConsentInput({ ...input, ...patch }, scope));
});

test('view validation retains only exact own-company metadata and rejects hashes, duplicates and secret-bearing rows', async () => {
  const original = view([await policy(), await policy('label-contact')]), checked = await model.validateMemberRegistrationConsentsView(original, scope);
  assert.deepEqual(plain(checked), original); assert.equal(checked.connections[0].password, undefined); assert.equal(model.memberRegistrationConsentCurrent(checked.policies[0], checked), true);
  for (const patch of [value => { value.ownerId = 'other'; }, value => { value.company = { code: 'A01464742', name: '와이홉' }; }, value => { value.actor.credentialVersion++; },
    value => { value.connections[0].password = 'never'; }, value => { value.policies[0].termsSha256 = 'c'.repeat(64); }, value => { value.policies[0].terms.termsText += 'changed'; },
    value => { value.policies.push(value.policies[0]); }, value => { value.connections.push(value.connections[0]); }, value => { value.policies[0].enabled = 'true'; },
    value => { value.policies[0].acceptedAt = 'bad'; }, value => { value.policies[0].updatedAt = '2026-10-30T00:00:00.000Z'; }, value => { value.actor.credentialVersion = -1; }]) {
    const changed = plain(original); patch(changed); await assert.rejects(model.validateMemberRegistrationConsentsView(changed, scope));
  }
  assert.equal((await model.validateMemberRegistrationConsentsView(view([]), scope)).policies.length, 0, 'no record means no enabled default');
});

test('connection and actor changes invalidate prior policies instead of migrating permission to another account', async () => {
  const current = await model.validateMemberRegistrationConsentsView(view([await policy()]), scope), saved = current.policies[0];
  for (const change of [value => { value.connections[0].revision++; }, value => { value.connections[0].enabled = false; }, value => { value.connections[0].hasPassword = false; },
    value => { value.connections[0].service = '1688'; }, value => { value.connections = []; }, value => { value.actor.email = 'new@example.test'; },
    value => { value.actor.role = 'admin'; }, value => { value.actor.credentialVersion++; }, value => { value.actor.credentialVersion = null; }]) {
    const changed = plain(current); change(changed); assert.equal(model.memberRegistrationConsentBindingCurrent(saved, changed), false); assert.equal(model.memberRegistrationConsentCurrent(saved, changed), false);
  }
  assert.equal(model.memberRegistrationConsentBindingCurrent({ ...saved, enabled: false }, current), true); assert.equal(model.memberRegistrationConsentCurrent({ ...saved, enabled: false }, current), false);
});
