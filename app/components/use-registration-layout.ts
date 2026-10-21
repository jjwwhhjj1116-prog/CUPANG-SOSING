'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readRegistrationLayout, type RegistrationLayout } from '@/app/registration-layout';

/** A category's raw official schema decides whether the size step is required.
 * A render epoch prevents even an A→B→A late response from supplying B's layout. */
export function useRegistrationLayout(ownerId: string | null | undefined, productId?: string, productVersion?: string, profileId?: string) {
  const identity = JSON.stringify([ownerId, productId, profileId]);
  const [scopeClock, setScopeClock] = useState({ identity, token: {} });
  if (scopeClock.identity !== identity) setScopeClock({ identity, token: {} });
  const scopeToken = scopeClock.identity === identity ? scopeClock.token : null;
  const context = JSON.stringify([ownerId, productId, productVersion, profileId]);
  const [clock, setClock] = useState({ context, token: {} });
  if (clock.context !== context) setClock({ context, token: {} });
  const token = clock.context === context ? clock.token : null;
  const current = useRef<object | null>(null);
  const [result, setResult] = useState<{ token: object; scopeToken: object; layout: RegistrationLayout | null; error: string } | null>(null);
  const [verified, setVerified] = useState<{ scopeToken: object; layout: RegistrationLayout } | null>(null);
  useLayoutEffect(() => { current.current = token; return () => { current.current = null; }; }, [token]);
  const retry = useCallback(() => {
    if (!token || !scopeToken || !ownerId || !productId || !productVersion || current.current !== token) return false;
    // Revoke the previous request immediately, including two clicks before the
    // next render and a response that settles before its effect is cleaned up.
    current.current = null;
    setClock({ context, token: {} });
    return true;
  }, [token, scopeToken, ownerId, productId, productVersion, context]);
  useEffect(() => {
    if (!token || !scopeToken || !ownerId || !productId || !productVersion) return;
    const controller = new AbortController();
    const valid = () => !controller.signal.aborted && current.current === token;
    void (async () => {
      try {
        const response = await fetch(`/api/products/${encodeURIComponent(productId)}/registration-layout${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`, { cache: 'no-store', signal: controller.signal });
        const body: unknown = await response.json();
        if (!valid()) return;
        if (!response.ok) throw Error('카테고리의 등록 단계를 확인하지 못했습니다.');
        const layout = readRegistrationLayout(body, productId, productVersion, profileId);
        if (valid()) {
          setVerified({ scopeToken, layout });
          setResult({ token, scopeToken, layout, error: '' });
        }
      } catch (cause) {
        if (valid()) setResult({ token, scopeToken, layout: null, error: cause instanceof Error ? cause.message : '등록 단계 조회 실패' });
      }
    })();
    return () => controller.abort();
  }, [token, scopeToken, ownerId, productId, productVersion, profileId]);
  const visible = token && result?.token === token ? result : null;
  // Keep only the last verified step labels during a same-category clock read
  // or a failed read. An error never turns that presentation into fresh data.
  // They are presentation-only; navigation remains disabled until fresh. A
  // product/company/profile transition never carries these labels across.
  const loading = !!ownerId && !!productId && !!productVersion && !visible;
  const pendingLayout = !!ownerId && !!productId && !!productVersion && !visible?.layout && verified?.scopeToken === scopeToken ? verified.layout : null;
  return { layout: visible?.layout ?? null, pendingLayout, loading, error: visible?.error ?? '', retry };
}
