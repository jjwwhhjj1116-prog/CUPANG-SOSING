import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { apiFixture, companies } from './supplier-hub-single-projection.mjs';
import { aiFixture, mockProvider } from './quotation-ai.mjs';
export { companies };
export const plain = value => JSON.parse(JSON.stringify(value));
export const endpointFile = 'app/api/products/[id]/quotation-ai/route.ts';

/** Actual saved-source/route/store/SQLite and actual sessionMember lookup.
 * Only provider outputs and authentication cookie bytes are synthetic; no
 * external model, supplier or original working product is accessed. */
export async function quotationAiApiFixture(company = companies[0]) {
  const f = await apiFixture(company, aiFixture({ company }).snapshot), { h } = f;
  h.bindings.SOURCEFLOW_QUOTATION_AI_PROVIDER = 'workers-ai'; h.bindings.SOURCEFLOW_QUOTATION_AI_FREE_ONLY = 'true';
  await h.load('db/queries.ts').saveSettings('owner', JSON.stringify({ ...h.settings, hiddenAttributes: true }));
  const now = new Date().toISOString(), email = company.code === 'A01526306' ? 'jwhj1116@kakao.com' : 'unari8484@gmail.com', role = company.code === 'A01526306' ? 'admin' : 'member';
  h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('owner', email, 'synthetic-unused-password-hash', role, 'approved', company.code, company.name, now, now);
  const cookie = 'yoofam_session=' + 'a'.repeat(64), members = h.load('db/members.ts'), memberModel = h.load('app/workspace-members.ts');
  h.sqlite.prepare('INSERT INTO member_sessions(token_hash,member_id,expires_at) VALUES(?,?,?)').run(await memberModel.tokenHash('a'.repeat(64)), 'owner', Date.now() + 3600_000);
  h.bindings.YOOFAM_AUTH_ENABLED = 'true';
  const authReads = [], controls = { beforeRun: null, beforeFirst: null }, queries = [];
  let ownerOverride = null;
  const user = async () => { const membership = await members.sessionMember(cookie); authReads.push(membership ? plain(membership) : null);
    return membership ? { userId: membership.id, email: membership.email, verifiedAccess: true, membership } : null; };
  const auth = { getChatGPTUser: user, getWorkspaceOwnerId: async () => ownerOverride ?? 'owner' };
  const prepare = h.db.prepare;
  h.db.prepare = function (sql) { const q = prepare.call(this, sql), first = q.first, run = q.run; queries.push(sql);
    q.first = async function (...args) { if (controls.beforeFirst) await controls.beforeFirst(sql); return first.apply(this, args); };
    q.run = async function (...args) { if (controls.beforeRun) await controls.beforeRun(sql); return run.apply(this, args); }; return q; };
  const exports = {}, output = ts.transpileModule(fs.readFileSync(new URL('../../' + endpointFile, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, Error, URL, Date, Request, Response, Headers, TextEncoder, structuredClone, crypto: webcrypto,
    require(name) { if (name === 'next/server') return { NextResponse: Response }; if (name === 'cloudflare:workers') return { env: h.bindings };
      if (name === '@/app/chatgpt-auth') return auth; if (name.startsWith('@/')) return h.load(name.slice(2) + '.ts'); throw Error('Forbidden API dependency ' + name); },
  }, { filename: endpointFile });
  let provider = mockProvider(); h.bindings.AI.run = (...args) => provider.run(...args);
  const request = (body, method = 'POST', query = f.query) => exports[method](new Request('https://app.test' + f.base + '/quotation-ai' + query, {
    method, headers: { 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), { params: Promise.resolve({ id: f.id }) });
  const member = () => h.sqlite.prepare('SELECT * FROM members WHERE id=?').get('owner');
  const mutateMember = kind => {
    if (kind === 'status') h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
    else if (kind === 'company') { const other = companies.find(value => value.code !== company.code); h.sqlite.prepare('UPDATE members SET company_code=?,company_name=? WHERE id=?').run(other.code, other.name, 'owner'); h.setCompany(other); }
    else if (kind === 'role') h.sqlite.prepare('UPDATE members SET role=? WHERE id=?').run(role === 'admin' ? 'member' : 'admin', 'owner');
    else if (kind === 'email') h.sqlite.prepare("UPDATE members SET email='synthetic-foreign@example.test' WHERE id='owner'").run();
    else throw Error('Unknown scope mutation');
  };
  const jobs = () => h.sqlite.prepare('SELECT * FROM quotation_ai_jobs ORDER BY created_at,id').all();
  const requestBody = view => ({ action: 'generate', profileId: f.profile.id, expectedFingerprint: view.fingerprint,
    expectedQuotationRevision: view.quotationRevision, optionId: null, applyToAllOptions: true, idempotencyKey: webcrypto.randomUUID() });
  return { ...f, route: exports, request, requestBody, authReads, controls, queries, user, member, mutateMember, jobs,
    setOwner(value) { ownerOverride = value; }, setProvider(value) { provider = value; }, get provider() { return provider; } };
}
