import { workspaceDetailSaveFixture, json, sha } from './workspace-detail-save-api.mjs';
import { companies } from './image-download-ui.mjs';
export const policy = 'automatic-stage5-v1';
export async function currentDetailPublicationFixture() {
  const f = await workspaceDetailSaveFixture(companies[0], { edited: false });
  const contentRow = f.api.sqlite.prepare('SELECT payload FROM product_content WHERE product_id=?').get(f.product.id), content = JSON.parse(contentRow.payload);
  content.assets.detail.provenance = 'collected';
  f.api.sqlite.prepare('UPDATE product_content SET payload=? WHERE product_id=?').run(JSON.stringify(content), f.product.id);
  const settings = f.api.load('app/workspace-settings.ts').newWorkspaceSettings;
  f.api.sqlite.prepare('INSERT INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run('owner', JSON.stringify(settings), new Date().toISOString());
  for (const [index, photo] of f.openedWorkspace.workspace.document.photos.filter(photo => photo.role === 'body').entries()) {
    const source = (await json(await f.openImage(photo.id))).source, document = f.editDocument();
    document.regions = [{ ...document.regions[0], translated: '검증된 본문 ' + index, translationProvenance: 'generated' }];
    await json(await f.applyImage(source, document, await f.png(index ? '#116644' : '#661144')));
  }
  const plan = f.api.load('app/detail-save-plan.ts'), model = f.api.load('app/detail-workspace.ts'), scope = await model.detailWorkspaceScope(f.initialView.categoryContext),
    row = id => f.api.sqlite.prepare('SELECT * FROM product_detail_workspaces WHERE owner_id=? AND product_id=? AND category_scope=? AND option_id=?').get('owner', f.product.id, scope, id);
  const prepare = async () => {
    const prepared = await f.prepareWorkspace(), peers = plan.detailSaveOptionIds(prepared.view).map(optionId => {
      const raw = row(optionId), workspace = raw ? JSON.parse(raw.payload) : null;
      return { optionId, workspace: workspace ? { revision: workspace.revision, digest: workspace.digest } : null };
    }), peerDigest = sha(JSON.stringify(peers)), publishedBodyImages = plan.detailSavePublishedBodyImages(prepared.workspace, 'owner');
    prepared.uploadId = sha(JSON.stringify({ kind: 'workspace-detail-composite-v1', productId: f.product.id, optionId: f.optionId, category: prepared.view.categoryContext,
      fingerprint: prepared.view.inputFingerprint, workspace: { revision: prepared.workspace.revision, digest: prepared.workspace.digest }, sources: prepared.sources,
      width: 800, height: prepared.height, sha256: prepared.sha256, peerDigest, publicationPolicy: 'shared-body-pixels-v1', publishedBodyImages }));
    return { prepared, body: { ...await f.uploadWorkspace(prepared), peerDigest, publicationPolicy: 'shared-body-pixels-v1' } };
  };
  const current = () => f.request(f.base + '/detail-save?profileId=' + f.initialView.categoryContext.profileId + '&current=' + policy), read = f.read, calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET' });
    if (url === '/api/settings') return Response.json({ scope: { ownerId: 'owner', company: f.openedWorkspace.workspace.company }, settings: JSON.parse(f.api.sqlite.prepare('SELECT payload FROM workspace_settings WHERE owner_id=?').get('owner').payload) });
    if (url.includes('/detail-save?')) return f.request(url, init);
    return f.api.route(url.endsWith('/quotation-fields') ? f.qurl : url, { ...init, ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) } : {}) });
  };
  return { ...f, settings, row, scope, prepare, current, request, calls, read, model };
}
