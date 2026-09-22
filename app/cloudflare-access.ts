/** Server-only authentication primitive. No request-supplied identity is trusted before RSA signature verification. */
export type CloudflareAccessConfig = { teamDomain?: string; audience?: string };
export type AccessIdentity = {
  userId: string; subject: string; issuer: string; email: string; displayName: string; fullName: null;
};
export type AccessAuthenticationCode = 'not_configured' | 'missing_token' | 'invalid_token' | 'jwks_unavailable';
const messages: Record<AccessAuthenticationCode, string> = {
  not_configured: '운영용 Cloudflare Access 인증 설정이 연결되지 않았습니다.',
  missing_token: 'Cloudflare Access 로그인이 필요합니다.',
  invalid_token: 'Cloudflare Access 인증을 확인하지 못했습니다. 다시 로그인해주세요.',
  jwks_unavailable: 'Cloudflare Access 서명 키를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.',
};
export class AccessAuthenticationError extends Error {
  readonly status: 401 | 503;
  constructor(readonly code: AccessAuthenticationCode) { super(messages[code]); this.name = 'AccessAuthenticationError'; this.status = code === 'not_configured' || code === 'jwks_unavailable' ? 503 : 401; }
}
type AccessFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type AccessVerifierOptions = { fetcher?: AccessFetch; now?: () => number };
type Configuration = { issuer: string; audience: string; jwksUrl: string };
type KeyEntry = { keys: Map<string, CryptoKey>; expiresAt: number; lastAttemptAt: number; unavailableUntil: number; pending?: Promise<void> };
const encoder = new TextEncoder(); const decoder = new TextDecoder('utf-8', { fatal: true });
const CACHE_TTL = 5 * 60 * 1000;
const REFRESH_COOLDOWN = 30 * 1000;
const MAX_ISSUERS = 8;
const MAX_JWKS_BYTES = 128 * 1024;
function rejected(code: AccessAuthenticationCode): never { throw new AccessAuthenticationError(code); }
function configuration(config: CloudflareAccessConfig): Configuration {
  if (!config || typeof config.teamDomain !== 'string' || typeof config.audience !== 'string') rejected('not_configured');
  const domain = config.teamDomain.trim(); const audience = config.audience.trim();
  if (!domain || domain.length > 300 || !audience || audience.length > 256 || /[\s\u0000-\u001f\u007f]/.test(audience)) rejected('not_configured');
  let url: URL;
  try { url = new URL(domain.startsWith('https://') ? domain : `https://${domain}`); } catch { return rejected('not_configured'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(url.hostname)) rejected('not_configured');
  return { issuer: url.origin, audience, jwksUrl: `${url.origin}/cdn-cgi/access/certs` };
}
export function hasProductionAccessConfig(config: CloudflareAccessConfig): boolean {
  try { configuration(config); return true; } catch { return false; }
}
function base64url(value: string, maxBytes: number): Uint8Array<ArrayBuffer> {
  if (!value || value.length > Math.ceil(maxBytes * 4 / 3) + 2 || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) rejected('invalid_token');
  let binary: string;
  try { binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)); } catch { return rejected('invalid_token'); }
  if (binary.length > maxBytes) rejected('invalid_token');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  // Reject non-canonical encodings, including nonzero padding bits.
  if (btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== value) rejected('invalid_token');
  return bytes;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) rejected('invalid_token');
  return value as Record<string, unknown>;
}
function jsonSegment(segment: string, maxBytes: number) {
  try { return object(JSON.parse(decoder.decode(base64url(segment, maxBytes)))); }
  catch { return rejected('invalid_token'); }
}
function timestamp(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function claimsValid(claims: Record<string, unknown>, config: Configuration, now: number) {
  const audience = claims.aud;
  const acceptedAudience = typeof audience === 'string' ? audience === config.audience : Array.isArray(audience) && audience.length > 0 && audience.length <= 20 && audience.every(value => typeof value === 'string') && audience.includes(config.audience);
  if (claims.iss !== config.issuer || !acceptedAudience || claims.type !== 'app' || !timestamp(claims.exp) || claims.exp <= now || !timestamp(claims.iat) || claims.iat > now || claims.iat >= claims.exp) rejected('invalid_token');
  if (claims.nbf !== undefined && (!timestamp(claims.nbf) || claims.nbf > now || claims.nbf >= claims.exp)) rejected('invalid_token');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 256 || /[\u0000-\u001f\u007f]/.test(claims.sub)) rejected('invalid_token');
  if (typeof claims.email !== 'string' || claims.email.length > 254 || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+$/.test(claims.email)) rejected('invalid_token');
}
async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok || response.status !== 200 || Number(response.headers.get('content-length')) > MAX_JWKS_BYTES || !response.body) rejected('jwks_unavailable');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > MAX_JWKS_BYTES) { await reader.cancel(); rejected('jwks_unavailable'); } chunks.push(chunk.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(decoder.decode(bytes)); } catch { return rejected('jwks_unavailable'); }
}
async function importKeys(value: unknown): Promise<Map<string, CryptoKey>> {
  const data = object(value);
  if (!Array.isArray(data.keys) || data.keys.length < 1 || data.keys.length > 10) rejected('jwks_unavailable');
  const keys = new Map<string, CryptoKey>();
  for (const raw of data.keys) {
    const key = object(raw);
    if (typeof key.kid !== 'string' || !key.kid || key.kid.length > 128 || keys.has(key.kid) || /[\s\u0000-\u001f\u007f]/.test(key.kid)) rejected('jwks_unavailable');
    if (key.kty !== 'RSA' || (key.alg !== undefined && key.alg !== 'RS256') || (key.use !== undefined && key.use !== 'sig') || typeof key.n !== 'string' || typeof key.e !== 'string' || ['d', 'p', 'q', 'dp', 'dq', 'qi'].some(field => key[field] !== undefined)) rejected('jwks_unavailable');
    if (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify') || key.key_ops.some(operation => operation !== 'verify'))) rejected('jwks_unavailable');
    const modulus = base64url(key.n, 512); const exponent = base64url(key.e, 4);
    const bits = modulus.length * 8 - Math.clz32(modulus[0]) + 24;
    const exponentValue = exponent.reduce((value, byte) => value * 256 + byte, 0);
    if (bits < 2048 || bits > 4096 || modulus[0] === 0 || exponent[0] === 0 || exponentValue < 3 || exponentValue % 2 === 0) rejected('jwks_unavailable');
    const imported = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true, key_ops: ['verify'] }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    keys.set(key.kid, imported);
  }
  return keys;
}

export function createCloudflareAccessVerifier(options: AccessVerifierOptions = {}) {
  const fetcher: AccessFetch = options.fetcher ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const cache = new Map<string, KeyEntry>();
  async function keyFor(config: Configuration, kid: string): Promise<CryptoKey> {
    let entry = cache.get(config.issuer);
    if (!entry) {
      if (cache.size >= MAX_ISSUERS) { const eviction = [...cache].find(([, value]) => !value.pending); if (!eviction) rejected('jwks_unavailable'); cache.delete(eviction[0]); }
      entry = { keys: new Map(), expiresAt: 0, lastAttemptAt: -Infinity, unavailableUntil: 0 }; cache.set(config.issuer, entry);
    } else { cache.delete(config.issuer); cache.set(config.issuer, entry); }
    const current = entry;
    const cached = current.keys.get(kid);
    if (cached && current.expiresAt > now()) return cached;
    if (current.unavailableUntil > now()) rejected('jwks_unavailable');
    if (!current.pending) {
      if (current.expiresAt > now() && now() - current.lastAttemptAt < REFRESH_COOLDOWN) rejected('invalid_token');
      current.lastAttemptAt = now();
      current.pending = (async () => {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetcher(config.jwksUrl, { method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal: controller.signal });
          const keys = await importKeys(await responseJson(response));
          current.keys = keys; current.expiresAt = now() + CACHE_TTL; current.unavailableUntil = 0;
        } catch { current.unavailableUntil = now() + REFRESH_COOLDOWN; rejected('jwks_unavailable'); }
        finally { clearTimeout(timer); }
      })();
    }
    const pending = current.pending;
    try { await pending; } finally { if (current.pending === pending) current.pending = undefined; }
    const key = current.keys.get(kid); if (!key || current.expiresAt <= now()) rejected('invalid_token');
    return key;
  }
  return {
    async authenticate(headers: { get(name: string): string | null }, input: CloudflareAccessConfig): Promise<AccessIdentity> {
      const config = configuration(input);
      const token = headers.get('cf-access-jwt-assertion');
      if (!token) rejected('missing_token');
      if (token.length > 16384 || /\s/.test(token)) rejected('invalid_token');
      const parts = token.split('.'); if (parts.length !== 3) rejected('invalid_token');
      const header = jsonSegment(parts[0], 1024); const claims = jsonSegment(parts[1], 10 * 1024);
      if (header.alg !== 'RS256' || (header.typ !== undefined && header.typ !== 'JWT') || typeof header.kid !== 'string' || !header.kid || header.kid.length > 128 || /[\s\u0000-\u001f\u007f]/.test(header.kid) || ['crit', 'jku', 'jwk', 'x5u', 'b64'].some(field => header[field] !== undefined)) rejected('invalid_token');
      claimsValid(claims, config, Math.floor(now() / 1000));
      const signature = base64url(parts[2], 512); if (signature.length < 256) rejected('invalid_token');
      const key = await keyFor(config, header.kid);
      let verified = false;
      try { verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, encoder.encode(`${parts[0]}.${parts[1]}`)); } catch { rejected('invalid_token'); }
      if (!verified) rejected('invalid_token');
      // Key retrieval can take time; a token expiring during verification is rejected.
      claimsValid(claims, config, Math.floor(now() / 1000));
      const subject = claims.sub as string; const email = claims.email as string;
      const ownerHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${config.issuer}\n${subject}`)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
      return { userId: `cf:${ownerHash}`, subject, issuer: config.issuer, email, displayName: email, fullName: null };
    },
  };
}
const verifier = createCloudflareAccessVerifier();
export const authenticateCloudflareAccess = verifier.authenticate;
