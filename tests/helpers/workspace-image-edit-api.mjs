import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { detailWorkspaceFixture, json } from './detail-workspace-api.mjs';
export { json };
export const sha = value => createHash('sha256').update(value).digest('hex');
export async function workspaceImageEditFixture(company) {
  const f = await detailWorkspaceFixture(company, { wire: true, excluded: true }), route = f.api.load('app/api/products/[id]/workspace-image-text/route.ts'),
    base = f.base + '/workspace-image-text', initial = await json(await f.put(await f.body())), photoId = initial.workspace.document.photos[1].id;
  const open = (id = photoId, profileId = f.initialView.categoryContext.profileId, optionId = f.optionId) => {
    const query = new URLSearchParams({ ...(profileId ? { profileId } : {}), optionId, photoId: id });
    return route.GET(new Request('https://app.test' + base + '?' + query), f.context);
  };
  const document = () => ({ format: 'free-image-edit-v1', width: 800, height: 1, sourceLanguage: 'zh', regions: [
    { id: 'manual-text', text: '原 文', translated: ' 수동 문구 ', box: { x: 0, y: 0, width: 20, height: 1 }, confidence: 100, selected: true, issue: null,
      translationProvenance: 'manual', background: '#ffffff', foreground: '#000000', fontSize: 1, fontFamily: 'mono', bold: true, italic: false, textAlign: 'center', lineHeight: 1 },
    { id: 'paint', text: '', translated: '', box: { x: 0, y: 0, width: 2, height: 1 }, confidence: 0, selected: true, issue: null, translationProvenance: 'empty',
      background: '#abcdef', foreground: '#000000', fontSize: 1, erase: true, brush: { size: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } },
  ] });
  const png = async (background = '#abcdef', width = 800, height = 1) => new Uint8Array(await sharp({ create: { width, height, channels: 4, background } }).png().toBuffer());
  const apply = async (source, editDocument = document(), bytes, extras = {}) => {
    bytes ??= await png(); const form = new FormData(); form.set('action', 'apply'); form.set('source', JSON.stringify(source)); form.set('file', new File([bytes], 'workspace.png', { type: 'image/png' }));
    form.set('editDocument', JSON.stringify(editDocument)); if (editDocument.crop) form.set('crop', JSON.stringify(editDocument.crop));
    for (const [key, value] of Object.entries(extras)) form.set(key, value);
    return route.POST(new Request('https://app.test' + base, { method: 'POST', body: form }), f.context);
  };
  const recover = async (source, editDocument = document(), bytes) => {
    bytes ??= await png(); return route.POST(new Request('https://app.test' + base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      action: 'recover', source, outputSha256: sha(bytes), outputBytes: bytes.length, editDocument, ...(editDocument.crop ? { crop: editDocument.crop } : {}),
    }) }), f.context);
  };
  return { ...f, imageRoute: route, imageBase: base, openedWorkspace: initial, photoId, openImage: open, editDocument: document, png, applyImage: apply, recoverImage: recover };
}
