import type { MemberConnectionProfile } from '@/app/member-connections';
import { supplierHubCompany, type SupplierHubCompany } from '@/app/supplier-hub-company';
import type { SingleConsentChallenge } from '@/app/supplier-hub-single-client';

export const MEMBER_REGISTRATION_CONSENT_TERMS_VERSION = 'supplier-hub-displayed-terms-v1' as const;
export const memberRegistrationConsentKinds = ['price-data', 'label-contact'] as const;
export type MemberRegistrationConsentKind = typeof memberRegistrationConsentKinds[number];
export type MemberRegistrationConsentTerms = { stage: 'productPage' | 'imagePage'; key: string; id: string; title: string; text: string; termsText: string };
export type MemberRegistrationConsentActor = { email: string; role: 'admin' | 'member'; credentialVersion: number | null };
export type MemberRegistrationConsentScope = { ownerId: string; company: SupplierHubCompany; actor: MemberRegistrationConsentActor };
export type MemberRegistrationConsentPolicy = { kind: MemberRegistrationConsentKind; connectionId: string; connectionRevision: number;
  revision: number; enabled: boolean; termsVersion: typeof MEMBER_REGISTRATION_CONSENT_TERMS_VERSION; termsSha256: string;
  terms: MemberRegistrationConsentTerms; acceptedAt: string; updatedAt: string; actor: MemberRegistrationConsentActor };
export type MemberRegistrationConsentsView = { format: 'yoofam-member-registration-consents-v1'; ownerId: string; company: SupplierHubCompany;
  actor: MemberRegistrationConsentActor; connections: MemberConnectionProfile[]; policies: MemberRegistrationConsentPolicy[] };
type InputScope = { kind: MemberRegistrationConsentKind; connectionId: string; expectedConnectionRevision: number; expectedRevision: number };
export type MemberRegistrationConsentSave = InputScope & { action: 'save'; enabled: true; accepted: true;
  termsVersion: typeof MEMBER_REGISTRATION_CONSENT_TERMS_VERSION; termsSha256: string; terms: MemberRegistrationConsentTerms };
export type MemberRegistrationConsentState = InputScope & { action: 'set-enabled'; enabled: boolean };
export type MemberRegistrationConsentInput = MemberRegistrationConsentSave | MemberRegistrationConsentState;
export class MemberRegistrationConsentsError extends Error {
  constructor(public status: 400 | 401 | 403 | 409 | 503, public code: string, message: string) { super(message); }
}

const configs = {
  'price-data': { stage: 'productPage', key: 'msrpAgree', id: 'agreeMSRPTerm' },
  'label-contact': { stage: 'imagePage', key: 'labelContactAgreed', id: 'agreeLabelContact' },
} as const;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => object(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const integer = (value: unknown, minimum: number): value is number => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) < Number.MAX_SAFE_INTEGER;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const text = (value: unknown, limit: number): value is string => typeof value === 'string' && Boolean(value.trim())
  && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
}
const fail = (message: string): never => { throw new MemberRegistrationConsentsError(400, 'REGISTRATION_CONSENTS_INPUT', message); };
export function memberRegistrationConsentKind(value: unknown): MemberRegistrationConsentKind {
  if (!memberRegistrationConsentKinds.includes(value as MemberRegistrationConsentKind)) return fail('자동 적용할 약관 종류를 확인해주세요.');
  return value as MemberRegistrationConsentKind;
}
function actor(value: unknown): MemberRegistrationConsentActor {
  if (!exact(value, ['email', 'role', 'credentialVersion']) || !text(value.email, 254) || value.email !== value.email.trim().toLowerCase()
    || !['admin', 'member'].includes(String(value.role)) || value.credentialVersion !== null && !integer(value.credentialVersion, 0))
    return fail('현재 회원의 동의 설정 연결을 확인해주세요.');
  return { email: value.email, role: value.role as MemberRegistrationConsentActor['role'], credentialVersion: value.credentialVersion as number | null };
}
export function validateMemberRegistrationConsentTerms(value: unknown, expectedKind?: MemberRegistrationConsentKind): MemberRegistrationConsentTerms {
  if (!exact(value, ['stage', 'key', 'id', 'title', 'text', 'termsText']) || !text(value.title, 500) || !text(value.text, 10000)
    || !text(value.termsText, 50000)) return fail('화면에서 확인한 약관 제목·안내·전문이 필요합니다.');
  const matched = memberRegistrationConsentKinds.find(kind => {
    const config = configs[kind]; return value.stage === config.stage && value.key === config.key && value.id === config.id;
  });
  if (!matched || expectedKind !== undefined && matched !== expectedKind) return fail('현재 단계와 약관 종류가 다릅니다.');
  return { stage: value.stage as MemberRegistrationConsentTerms['stage'], key: value.key as string, id: value.id as string,
    title: value.title, text: value.text, termsText: value.termsText };
}
export async function memberRegistrationConsentTermsSha256(value: MemberRegistrationConsentTerms): Promise<string> {
  const terms = validateMemberRegistrationConsentTerms(value), bytes = new TextEncoder().encode(canonical({ format: MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, terms }));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
/** A current displayed challenge supplies text, never a preselected agreement. */
export function memberRegistrationConsentFromChallenge(value: SingleConsentChallenge, time = Date.now()): MemberRegistrationConsentTerms | null {
  try {
    if (!object(value) || !hash(value.id) || !hash(value.packetDigest) || !integer(value.issuedAt, 1) || value.issuedAt > time + 5000
      || value.expiresAt !== value.issuedAt + 120000 || time < value.issuedAt || time >= value.expiresAt
      || !Array.isArray(value.items) || value.items.length !== 1 || value.items[0].required !== true) return null;
    const item = value.items[0];
    return validateMemberRegistrationConsentTerms({ stage: value.stage, key: item.key, id: item.id, title: item.title, text: item.text, termsText: item.termsText });
  } catch { return null; }
}
/** Scope and explicit opt-in are checked before the store applies its CAS and
 * enabled-connection/member predicates. No account credentials are accepted. */
export async function memberRegistrationConsentInput(value: unknown, scope: MemberRegistrationConsentScope): Promise<MemberRegistrationConsentInput> {
  const common = ['action', 'expectedOwnerId', 'expectedCompany', 'kind', 'connectionId', 'expectedConnectionRevision', 'expectedRevision', 'enabled'];
  const extra = object(value) && value.action === 'save' ? ['accepted', 'termsVersion', 'termsSha256', 'terms'] : [];
  if (!object(value) || !['save', 'set-enabled'].includes(String(value.action)) || !exact(value, [...common, ...extra])) return fail('동의 설정 요청 항목을 확인해주세요.');
  if (value.expectedOwnerId !== scope.ownerId || !exact(value.expectedCompany, ['code', 'name']) || !same(value.expectedCompany, scope.company))
    throw new MemberRegistrationConsentsError(409, 'REGISTRATION_CONSENTS_SCOPE', '로그인 회원·회사가 변경되었습니다. 설정을 다시 불러와주세요.');
  const kind = memberRegistrationConsentKind(value.kind);
  if (!uuid(value.connectionId) || !integer(value.expectedConnectionRevision, 1) || !integer(value.expectedRevision, value.action === 'save' ? 0 : 1)
    || typeof value.enabled !== 'boolean') return fail('연동 계정과 동의 설정의 저장 버전을 확인해주세요.');
  const base = { kind, connectionId: value.connectionId, expectedConnectionRevision: value.expectedConnectionRevision, expectedRevision: value.expectedRevision };
  if (value.action === 'set-enabled') return { ...base, action: 'set-enabled', enabled: value.enabled };
  if (value.accepted !== true || value.enabled !== true || value.termsVersion !== MEMBER_REGISTRATION_CONSENT_TERMS_VERSION || !hash(value.termsSha256))
    return fail('약관 전문을 확인하고 이 회원·회사 계정에 자동 적용하도록 직접 선택해주세요.');
  const terms = validateMemberRegistrationConsentTerms(value.terms, kind);
  if (await memberRegistrationConsentTermsSha256(terms) !== value.termsSha256) return fail('확인한 약관 원문과 저장할 약관이 다릅니다.');
  return { ...base, action: 'save', enabled: true, accepted: true, termsVersion: MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, termsSha256: value.termsSha256, terms };
}
function connection(value: unknown): MemberConnectionProfile {
  if (!exact(value, ['id', 'service', 'alias', 'loginId', 'hasPassword', 'enabled', 'revision', 'createdAt', 'updatedAt']) || !uuid(value.id)
    || !['supplier-hub', '1688'].includes(String(value.service)) || !text(value.alias, 60) || !text(value.loginId, 254)
    || typeof value.enabled !== 'boolean' || typeof value.hasPassword !== 'boolean' || !integer(value.revision, 1) || !date(value.createdAt) || !date(value.updatedAt))
    return fail('동의 설정에 연결된 계정 정보를 확인하지 못했습니다.');
  return { ...value } as MemberConnectionProfile;
}
export async function validateMemberRegistrationConsentsView(value: unknown, scope: Pick<MemberRegistrationConsentScope, 'ownerId' | 'company'> & { actor?: MemberRegistrationConsentActor }): Promise<MemberRegistrationConsentsView> {
  if (!exact(value, ['format', 'ownerId', 'company', 'actor', 'connections', 'policies']) || value.format !== 'yoofam-member-registration-consents-v1'
    || !id(value.ownerId) || value.ownerId !== scope.ownerId || !exact(value.company, ['code', 'name']) || !supplierHubCompany(value.company.code, value.company.name)
    || !same(value.company, scope.company) || !Array.isArray(value.connections) || value.connections.length > 20 || !Array.isArray(value.policies) || value.policies.length > 40)
    return fail('현재 회원·회사의 동의 설정 응답을 확인하지 못했습니다.');
  const currentActor = actor(value.actor); if (scope.actor && !same(currentActor, scope.actor)) return fail('동의 설정을 불러오는 동안 회원 정보가 변경됐습니다.');
  const connections = value.connections.map(connection); if (new Set(connections.map(row => row.id)).size !== connections.length) return fail('연동 계정이 중복되었습니다.');
  const policies: MemberRegistrationConsentPolicy[] = [];
  for (const raw of value.policies) {
    if (!exact(raw, ['kind', 'connectionId', 'connectionRevision', 'revision', 'enabled', 'termsVersion', 'termsSha256', 'terms', 'acceptedAt', 'updatedAt', 'actor'])
      || !uuid(raw.connectionId) || !integer(raw.connectionRevision, 1) || !integer(raw.revision, 1) || typeof raw.enabled !== 'boolean'
      || raw.termsVersion !== MEMBER_REGISTRATION_CONSENT_TERMS_VERSION || !hash(raw.termsSha256) || !date(raw.acceptedAt) || !date(raw.updatedAt)
      || Date.parse(raw.updatedAt) < Date.parse(raw.acceptedAt)) return fail('저장된 약관 동의 이력을 확인하지 못했습니다.');
    const kind = memberRegistrationConsentKind(raw.kind), terms = validateMemberRegistrationConsentTerms(raw.terms, kind), acceptedActor = actor(raw.actor);
    if (await memberRegistrationConsentTermsSha256(terms) !== raw.termsSha256) return fail('저장된 약관 전문과 식별값이 다릅니다.');
    policies.push({ kind, connectionId: raw.connectionId, connectionRevision: raw.connectionRevision, revision: raw.revision, enabled: raw.enabled,
      termsVersion: MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, termsSha256: raw.termsSha256, terms, acceptedAt: raw.acceptedAt, updatedAt: raw.updatedAt, actor: acceptedActor });
  }
  if (new Set(policies.map(row => row.connectionId + ':' + row.kind)).size !== policies.length) return fail('같은 계정의 약관 설정이 중복되었습니다.');
  return { format: 'yoofam-member-registration-consents-v1', ownerId: value.ownerId, company: { ...scope.company }, actor: currentActor, connections, policies };
}
/** Re-enabling a record may never rebind it to a changed connection or actor. */
export function memberRegistrationConsentBindingCurrent(policy: MemberRegistrationConsentPolicy, view: MemberRegistrationConsentsView): boolean {
  const rows = view.connections.filter(row => row.id === policy.connectionId);
  return rows.length === 1 && rows[0].service === 'supplier-hub' && rows[0].enabled && rows[0].hasPassword && rows[0].revision === policy.connectionRevision
    && same(policy.actor, view.actor) && policy.termsVersion === MEMBER_REGISTRATION_CONSENT_TERMS_VERSION;
}
export function memberRegistrationConsentCurrent(policy: MemberRegistrationConsentPolicy, view: MemberRegistrationConsentsView): boolean {
  return policy.enabled && memberRegistrationConsentBindingCurrent(policy, view);
}
