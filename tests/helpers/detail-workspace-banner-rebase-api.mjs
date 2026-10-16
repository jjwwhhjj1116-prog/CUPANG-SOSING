import { workspaceImageEditFixture, json } from './workspace-image-edit-api.mjs';
export { json };
export async function detailWorkspaceBannerRebaseFixture(company, { edited = true } = {}) {
  const f = await workspaceImageEditFixture(company); let imageEdit;
  if (edited) imageEdit = await json(await f.applyImage((await json(await f.openImage())).source));
  const oldWorkspace = (await json(await f.read())).workspace, newTop = 'owner/banner-rebase-new-top.png', newBottom = 'owner/banner-rebase-new-bottom.png';
  await f.api.bindings.FILES.put(newTop, await f.png('#ff3344'), { httpMetadata: { contentType: 'image/png' } });
  await f.api.bindings.FILES.put(newBottom, await f.png('#3355ff'), { httpMetadata: { contentType: 'image/png' } });
  const savedProduct = f.api.sqlite.prepare('SELECT image_keys FROM products WHERE id=?').get(f.product.id);
  f.api.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([...JSON.parse(savedProduct.image_keys), newTop, newBottom]), f.product.id);
  const setRoles = async (top, bottom) => {
    const content = await json(await f.api.route(f.base + '/content'));
    return json(await f.api.route(f.base + '/content', { method: 'PATCH', body: { expectedRevision: content.content.revision, patch: { assets: { detailTop: top, detailBottom: bottom } } } }));
  };
  await setRoles([newTop], [newBottom]);
  const view = await f.view(), selection = { productId: f.product.id, profileId: view.categoryContext.profileId, optionId: f.optionId, view },
    route = f.api.load('app/api/products/[id]/detail-workspace/banner-rebase/route.ts'), endpoint = f.base + '/detail-workspace/banner-rebase' + (selection.profileId ? '?profileId=' + selection.profileId : '');
  const preview = (optionId = f.optionId) => route.GET(new Request('https://app.test' + endpoint + (endpoint.includes('?') ? '&' : '?') + 'optionId=' + encodeURIComponent(optionId)), f.context);
  const put = body => route.PUT(new Request('https://app.test' + endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), f.context);
  const body = saved => ({ optionId: f.optionId, expectedRevision: saved.workspace.revision, expectedDigest: saved.workspace.digest,
    expectedView: f.model.detailWorkspaceExpectedView(saved.view), requestId: saved.requestId });
  const originalRequest = f.request;
  const request = (url, init = {}) => url.includes('/detail-workspace/banner-rebase')
    ? route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context)
    : url.includes('/detail-workspace') && !url.includes('/attach')
      ? f.route[init.method ?? 'GET'](new Request('https://app.test' + url, init), f.context) : originalRequest(url, init);
  return { ...f, imageEdit, oldWorkspace, newTop, newBottom, setRoles, selection, rebaseRoute: route, rebaseEndpoint: endpoint, preview, rebasePut: put, rebaseBody: body, request };
}
