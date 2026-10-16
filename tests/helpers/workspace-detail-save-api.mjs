import sharp from 'sharp';
import { workspaceImageEditFixture, json, sha } from './workspace-image-edit-api.mjs';
export { json, sha };

/** Real workspace/image/files/detail-save APIs and temporary SQLite. The
 * independent compositor deliberately consumes the saved workspace, never a
 * fabricated quotation selection. It keeps the final 800px full-bleed policy. */
export async function workspaceDetailSaveFixture(company, { edited = true, blankQuote = false } = {}) {
  const f = await workspaceImageEditFixture(company);
  let imageEdit;
  if (edited) {
    const source = (await json(await f.openImage())).source, document = f.editDocument();
    document.crop = { sourceWidth: 800, sourceHeight: 1, x: 10, y: 0, width: 400, height: 1 };
    imageEdit = await json(await f.applyImage(source, document, await f.png('#abcdef', 400, 1)));
  }
  if (blankQuote) await f.set(f.targets.detailImages.linked.map(fieldKey => ({ optionId: f.optionId, fieldKey, value: '' })));
  const prepareWorkspace = async () => {
    const saved = await json(await f.read()), { workspace, view } = saved, sources = [], layers = []; let height = 0;
    for (const photo of workspace.document.photos) {
      const bytes = f.api.objects.get(photo.key), metadata = await sharp(bytes).metadata(), scaled = Math.max(1, Math.round(metadata.height * 800 / metadata.width));
      sources.push({ key: photo.key, sha256: sha(bytes), width: metadata.width, height: metadata.height });
      layers.push({ input: await sharp(bytes).resize(800, scaled).png().toBuffer(), left: 0, top: height }); height += scaled;
    }
    const bytes = new Uint8Array(await sharp({ create: { width: 800, height, channels: 4, background: '#ffffff' } }).composite(layers).png().toBuffer()), sha256 = sha(bytes),
      proof = { revision: workspace.revision, digest: workspace.digest }, uploadId = sha(JSON.stringify({ kind: 'workspace-detail-composite-v1', productId: f.product.id,
        optionId: f.optionId, category: view.categoryContext, fingerprint: view.inputFingerprint, workspace: proof, sources, width: 800, height, sha256 }));
    return { view, workspace, sources, width: 800, height, sha256, uploadId, output: new Blob([bytes], { type: 'image/png' }), optionId: f.optionId };
  };
  const uploadWorkspace = async prepared => ({ ...await f.upload(prepared), textPolicy: 'couplus-detail-alt-v1', editorPolicy: 'ordered-inputs-html-v1',
    workspace: { revision: prepared.workspace.revision, digest: prepared.workspace.digest } });
  const saveWorkspace = async () => { const prepared = await prepareWorkspace(), body = await uploadWorkspace(prepared); return { prepared, body, response: await f.post(body) }; };
  return { ...f, imageEdit, prepareWorkspace, uploadWorkspace, saveWorkspace };
}
