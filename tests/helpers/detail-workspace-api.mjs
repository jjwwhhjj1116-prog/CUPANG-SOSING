import { detailEditorCompositionFixture, json } from './detail-editor-composition-api.mjs';

export { json };
export async function detailWorkspaceFixture(company, options = {}) {
  const f = await detailEditorCompositionFixture(company, options), now = new Date().toISOString(), email = company.companyCode === 'A01526306' ? 'jwhj1116@kakao.com' : 'unari8484@gmail.com', role = company.companyCode === 'A01526306' ? 'admin' : 'member';
  f.api.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at,reviewed_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner', email, 'fixture-not-a-password', role, 'approved', company.companyCode, company.companyName, now, now, null);
  const endpoint = f.base + '/detail-workspace?profileId=' + f.initialView.categoryContext.profileId, context = { params: Promise.resolve({ id: f.product.id }) }, route = f.api.load('app/api/products/[id]/detail-workspace/route.ts'), model = f.api.load('app/detail-workspace.ts');
  const read = (optionId = f.optionId, suffix = '') => route.GET(new Request('https://app.test' + endpoint + '&optionId=' + encodeURIComponent(optionId) + suffix), context);
  const put = body => route.PUT(new Request('https://app.test' + endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), context);
  const document = (value, margin = 0) => {
    const photos = value ?? f.selectedKeys.map((key, index) => ({ id: 'photo-' + index, originKey: key, key, role: index === 0 ? 'top' : index === f.selectedKeys.length - 1 ? 'bottom' : 'body' }));
    return { format: 'detail-workspace-v1', photos, imageMargin: margin, generatedHtml: model.generateDetailWorkspaceHtml(photos, margin) };
  };
  const body = async (doc = document(), current) => {
    const before = current ?? await json(await read()), expectedRevision = before.workspace?.revision ?? 0, expectedView = model.detailWorkspaceExpectedView(before.view);
    return { optionId: f.optionId, expectedRevision, expectedView, requestId: await model.detailWorkspaceRequestId(f.product.id, f.optionId, expectedRevision, expectedView, doc), document: doc };
  };
  const tables = () => Object.fromEntries(f.api.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, f.api.sqlite.prepare('SELECT * FROM ' + name + ' ORDER BY rowid').all()]));
  return { ...f, endpoint, route, context, model, read, put, document, body, tables };
}
