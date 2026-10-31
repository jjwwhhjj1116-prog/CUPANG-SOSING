'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SingleConsentChallenge } from '@/app/supplier-hub-single-client';
import { MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, memberRegistrationConsentKinds, memberRegistrationConsentFromChallenge,
  memberRegistrationConsentTermsSha256, memberRegistrationConsentBindingCurrent, validateMemberRegistrationConsentsView,
  type MemberRegistrationConsentKind, type MemberRegistrationConsentPolicy, type MemberRegistrationConsentTerms,
  type MemberRegistrationConsentsView } from '@/app/member-registration-consents';
import './member-registration-consents-panel.css';

type Props = { ownerId: string; company: { code: string; name: string }; challenge?: SingleConsentChallenge; connectionId?: string; onSaved?: () => void };
const endpoint = '/api/supplier-hub/registration-consents';
const labels: Record<MemberRegistrationConsentKind, string> = { 'price-data': '가격 정보 데이터 이용 약관', 'label-contact': '상품 라벨 연락처 제공·공개 동의' };
type TermsProof = { token: object; terms: MemberRegistrationConsentTerms; sha256: string };
class RequestFailure extends Error { constructor(message: string, readonly known: boolean) { super(message); } }
async function responseView(response: Response, scope: Props): Promise<MemberRegistrationConsentsView> {
  if (response.redirected || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw new RequestFailure('설정 응답을 확인하지 못했습니다. 새로고침해서 저장 결과를 확인해주세요.', false);
  let body: unknown; try { body = await response.json(); } catch { throw new RequestFailure('설정 응답을 읽지 못했습니다. 저장 결과를 확인해주세요.', false); }
  if (!response.ok) throw new RequestFailure(response.status === 409 ? '회원·연동 계정 또는 설정이 변경됐습니다. 새로고침한 뒤 확인해주세요.'
    : response.status === 401 || response.status === 403 ? '현재 승인된 회원과 회사로 다시 로그인해주세요.' : '동의 설정을 처리하지 못했습니다. 저장 결과를 확인해주세요.', response.status >= 400 && response.status < 500);
  try { return await validateMemberRegistrationConsentsView(body, scope); }
  catch { throw new RequestFailure('동의 설정의 회원·회사·약관 원문을 확인하지 못했습니다. 새로고침해주세요.', false); }
}
export function MemberRegistrationConsentsPanel(props: Props) {
  return <MemberRegistrationConsentsScope key={JSON.stringify([props.ownerId, props.company.code, props.company.name])} {...props} />;
}
function MemberRegistrationConsentsScope(props: Props) {
  const { ownerId, company: { code: companyCode, name: companyName }, challenge } = props;
  const [view, setView] = useState<MemberRegistrationConsentsView | null>(null), [selection, setSelection] = useState(props.connectionId ?? '');
  const [proof, setProof] = useState<TermsProof | null>(null), [expiry, setExpiry] = useState<object | null>(null);
  const [checked, setChecked] = useState<{ token: object; connectionId: string; value: boolean } | null>(null);
  const [busy, setBusy] = useState(true), [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const token = useMemo(() => ({ challenge }), [challenge]), epoch = useRef<object | null>(token), mounted = useRef(false), request = useRef<AbortController | null>(null), unknownWrite = useRef(false);
  const latest = useRef({ props, view, selection, proof, checked, token });
  useLayoutEffect(() => { latest.current = { props, view, selection, proof, checked, token }; epoch.current = token; return () => { if (epoch.current === token) epoch.current = null; }; });
  const active = (controller: AbortController) => mounted.current && request.current === controller && !controller.signal.aborted;
  const finish = (controller: AbortController) => { if (request.current === controller) { request.current = null; if (mounted.current) setBusy(false); } };
  function adopt(saved: MemberRegistrationConsentsView) {
    latest.current.view = saved; setView(saved);
    const current = latest.current.selection, candidates = saved.connections.filter(row => row.service === 'supplier-hub' && row.enabled && row.hasPassword);
    const selected = candidates.some(row => row.id === current) ? current : candidates.length === 1 ? candidates[0].id : '';
    latest.current.selection = selected; setSelection(selected); setChecked(null); latest.current.checked = null;
  }
  async function reload() {
    if (!mounted.current || request.current) return; const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    try {
      const saved = await responseView(await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal }), props);
      if (!active(controller)) return; adopt(saved); unknownWrite.current = false; setUncertain(false); setMessage('설정을 불러왔습니다.');
    } catch (cause) { if (active(controller)) setError(cause instanceof Error ? cause.message : '동의 설정을 불러오지 못했습니다.'); }
    finally { finish(controller); }
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController(); request.current = controller;
    void fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal }).then(response => responseView(response, { ownerId, company: { code: companyCode, name: companyName } })).then(saved => {
      if (active(controller)) adopt(saved);
    }).catch(cause => { if (active(controller)) setError(cause instanceof Error ? cause.message : '동의 설정을 불러오지 못했습니다.'); }).finally(() => finish(controller));
    return () => { mounted.current = false; controller.abort(); request.current?.abort(); request.current = null; };
  }, [ownerId, companyCode, companyName]);
  useEffect(() => {
    let cancelled = false; const terms = challenge ? memberRegistrationConsentFromChallenge(challenge) : null;
    if (terms) void memberRegistrationConsentTermsSha256(terms).then(sha256 => { if (!cancelled) setProof({ token, terms, sha256 }); })
      .catch(() => { if (!cancelled) setError('약관 원문을 확인하지 못했습니다. 현재 약관을 다시 열어주세요.'); });
    const timer = challenge ? setTimeout(() => { if (!cancelled) { setExpiry(token); setChecked(null); } }, Math.max(0, challenge.expiresAt - Date.now())) : undefined;
    return () => { cancelled = true; clearTimeout(timer); };
  }, [challenge, token]);
  const currentProof = proof?.token === token && expiry !== token && challenge && memberRegistrationConsentFromChallenge(challenge) ? proof : null;
  const enabledConnections = view?.connections.filter(row => row.service === 'supplier-hub' && row.enabled && row.hasPassword) ?? [];
  const selectedConnection = enabledConnections.find(row => row.id === selection);
  const approved = checked?.token === token && checked.connectionId === selection && checked.value;
  const disabled = busy || uncertain || !view;
  function changeSelection(id: string) {
    if (!mounted.current || request.current || unknownWrite.current || !latest.current.view) return;
    latest.current.selection = id; latest.current.checked = null; setSelection(id); setChecked(null); setMessage('');
  }
  async function write(body: Record<string, unknown>, expected: { kind: MemberRegistrationConsentKind; connectionId: string; connectionRevision: number; revision: number; enabled: boolean; hash: string;
    retainedPolicy?: MemberRegistrationConsentPolicy }, admittedProof?: TermsProof) {
    const current = latest.current; if (!mounted.current || request.current || unknownWrite.current || !current.view || current.token !== token || epoch.current !== token) return;
    const connection = current.view.connections.find(row => row.id === expected.connectionId);
    if (!connection || connection.service !== 'supplier-hub' || connection.revision !== expected.connectionRevision || expected.enabled && (!connection.enabled || !connection.hasPassword)) return;
    if (admittedProof && (current.proof !== admittedProof || admittedProof.token !== token || current.checked?.token !== token || current.checked.connectionId !== expected.connectionId || !current.checked.value
      || !challenge || !memberRegistrationConsentFromChallenge(challenge))) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError(''); setMessage('');
    try {
      const saved = await responseView(await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, expectedOwnerId: ownerId, expectedCompany: { code: companyCode, name: companyName } }) }), props);
      if (!active(controller)) return;
      const policy = saved.policies.find(row => row.kind === expected.kind && row.connectionId === expected.connectionId);
      if (!policy || policy.revision !== expected.revision + 1 || policy.enabled !== expected.enabled || policy.connectionRevision !== (expected.retainedPolicy?.connectionRevision ?? expected.connectionRevision) || policy.termsSha256 !== expected.hash
        || expected.retainedPolicy && (policy.acceptedAt !== expected.retainedPolicy.acceptedAt || JSON.stringify(policy.actor) !== JSON.stringify(expected.retainedPolicy.actor))
        || expected.enabled && !memberRegistrationConsentBindingCurrent(policy, saved)) throw new RequestFailure('저장 응답이 요청한 계정·약관과 다릅니다. 다시 저장하지 말고 새로고침해주세요.', false);
      adopt(saved); unknownWrite.current = false; setUncertain(false); setMessage('동의 설정을 저장했습니다.');
      if (epoch.current === token && latest.current.token === token && (!admittedProof || challenge && memberRegistrationConsentFromChallenge(challenge))) latest.current.props.onSaved?.();
    } catch (cause) {
      if (active(controller)) { if (!(cause instanceof RequestFailure) || !cause.known) { unknownWrite.current = true; setUncertain(true); }
        setError(cause instanceof Error ? cause.message : '저장 결과를 확인하지 못했습니다. 새로고침해주세요.'); }
    } finally { finish(controller); }
  }
  function saveDisplayedTerms() {
    if (!view || !selectedConnection || !currentProof || !approved) return;
    const kind = currentProof.terms.stage === 'productPage' ? 'price-data' : 'label-contact', previous = view.policies.find(row => row.kind === kind && row.connectionId === selectedConnection.id);
    void write({ action: 'save', kind, connectionId: selectedConnection.id, expectedConnectionRevision: selectedConnection.revision, expectedRevision: previous?.revision ?? 0,
      enabled: true, accepted: true, termsVersion: MEMBER_REGISTRATION_CONSENT_TERMS_VERSION, termsSha256: currentProof.sha256, terms: currentProof.terms },
    { kind, connectionId: selectedConnection.id, connectionRevision: selectedConnection.revision, revision: previous?.revision ?? 0, enabled: true, hash: currentProof.sha256 }, currentProof);
  }
  function toggle(policy: MemberRegistrationConsentPolicy) {
    if (!view || !view.policies.includes(policy)) return; const connection = view.connections.find(row => row.id === policy.connectionId);
    if (!connection || connection.service !== 'supplier-hub' || !policy.enabled && !memberRegistrationConsentBindingCurrent(policy, view)) return;
    void write({ action: 'set-enabled', kind: policy.kind, connectionId: policy.connectionId, expectedConnectionRevision: connection.revision, expectedRevision: policy.revision, enabled: !policy.enabled },
      { kind: policy.kind, connectionId: policy.connectionId, connectionRevision: connection.revision, revision: policy.revision, enabled: !policy.enabled, hash: policy.termsSha256, retainedPolicy: policy });
  }
  return <section id="registration-consent-settings" className="membership-card member-registration-consents" aria-label="등록전송 동의 설정" aria-busy={busy}>
    <div className="membership-header"><h2>등록전송 동의 설정</h2><button type="button" className="btn ghost" disabled={busy} onClick={() => void reload()}>설정 새로고침</button></div>
    <p>{companyName} · {companyCode}의 연동 계정별로, 직접 확인한 동일 약관만 자동 적용합니다.</p>
    {busy && <p role="status">불러오는 중…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {uncertain && <p role="status">이전 저장 결과를 확인해야 합니다. 자동으로 다시 저장하지 않습니다.</p>}
    {view && <>
      <div className="member-registration-consent-policies">{memberRegistrationConsentKinds.map(kind => {
        const policies = view.policies.filter(row => row.kind === kind);
        return <article key={kind}><h3>{labels[kind]}</h3>{!policies.length && <p>사용 안 함 · 아직 확인하여 저장한 약관이 없습니다.</p>}
          {policies.map(policy => { const connection = view.connections.find(row => row.id === policy.connectionId), current = memberRegistrationConsentBindingCurrent(policy, view);
            return <div className="member-registration-consent-policy" key={policy.connectionId}>
              <div className="member-registration-consent-heading"><strong>{connection ? connection.alias + ' · ' + connection.loginId : '기존 연동 계정'}</strong><span>{!current ? '계정 변경 · 다시 확인 필요' : policy.enabled ? '자동 적용 사용' : '사용 안 함'}</span>
                <button type="button" className="btn ghost" disabled={disabled || (policy.enabled ? connection?.service !== 'supplier-hub' : !current)} onClick={() => toggle(policy)}>{policy.enabled ? '사용 중지' : '자동 적용 사용'}</button></div>
              <details><summary>저장한 약관 전문</summary><h4>{policy.terms.title}</h4><p>{policy.terms.text}</p><div className="member-registration-consent-terms">{policy.terms.termsText}</div><small>확인일 {new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(policy.acceptedAt))}</small></details>
            </div>;
          })}</article>;
      })}</div>
      {currentProof && <div className="member-registration-consent-optin">
        <h3>현재 확인한 약관 자동 적용</h3><h4>{currentProof.terms.title}</h4><p>{currentProof.terms.text}</p><div className="member-registration-consent-terms">{currentProof.terms.termsText}</div>
        <label>Supplier Hub 연동 계정<select aria-label="약관 자동 적용 계정" value={selection} disabled={disabled} onChange={event => changeSelection(event.target.value)}><option value="">계정을 선택해주세요</option>{enabledConnections.map(row => <option key={row.id} value={row.id}>{row.alias} · {row.loginId}</option>)}</select></label>
        {!enabledConnections.length && <p>멀티 계정 설정에서 사용할 Supplier Hub 계정을 먼저 등록해주세요.</p>}
        <label className="member-registration-consent-choice"><input type="checkbox" checked={Boolean(approved)} disabled={disabled || !selectedConnection} onChange={event => {
          if (!mounted.current || request.current || unknownWrite.current || epoch.current !== token || latest.current.token !== token || latest.current.proof !== currentProof || !selectedConnection) return;
          const next = { token, connectionId: selection, value: event.target.checked }; latest.current.checked = next; setChecked(next);
        }} />위 약관 전문을 확인했으며, 이 회원·회사·연동 계정에서 같은 내용의 약관을 자동 적용하도록 설정합니다.</label>
        <button type="button" className="btn primary" disabled={disabled || !selectedConnection || !approved} onClick={saveDisplayedTerms}>확인한 약관 자동 적용 저장</button>
      </div>}
      {challenge && !currentProof && <p>현재 약관 확인 시간이 만료됐거나 원문을 확인하지 못했습니다. 등록전송 화면에서 약관을 다시 확인해주세요.</p>}
      {!challenge && <p>새 약관은 등록전송 화면에서 전문을 확인한 뒤 계정별로 저장할 수 있습니다.</p>}
    </>}
  </section>;
}
