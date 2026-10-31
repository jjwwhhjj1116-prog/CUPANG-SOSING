import { createHash } from 'node:crypto';
import { apiFixture, projectionFixture, syntheticSnapshot, companies, module, plain } from './supplier-hub-single-projection.mjs';
export { companies, module, plain };
export const labelName = '제품 한글 표시사항 라벨 또는 도안 이미지';
export const config = { origin: 'https://single-assets.example.test', secret: 'a'.repeat(64) };
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2RkcAAAAASUVORK5CYII=', 'base64');
export const imageBytes = index => new Uint8Array(Buffer.concat([png, Buffer.from([index])]));
export const keys = ['owner/edited-main.png', 'owner/add-2.png', 'owner/add-1.png', 'owner/detail-top.png', 'owner/detail-body.png', 'owner/detail-bottom.png', 'owner/label.png', 'owner/excluded.png'];
export function assetSnapshot(company = companies[0]) {
  const snapshot = syntheticSnapshot(company), raw = JSON.parse(snapshot.schemaString);
  raw.properties.imagePage.properties.images.properties.labelImages.allOf[0].contains.properties.labelImageType.enum = [labelName];
  Object.assign(raw.properties.productPage.properties, { manufacturer: { type: 'string', title: '제조사' },
    businessType: { type: 'string', title: '거래타입' }, importType: { type: 'string', title: '수입여부' } });
  snapshot.schemaString = JSON.stringify(raw); return snapshot;
}
export function assetProjectionFixture(company = companies[0]) {
  const f = projectionFixture(assetSnapshot(company));
  f.set(['productPage', 'commonAttributes', 'count'], undefined, '0');
  f.set(['productPage', 'commonAttributes', 'booleanValue'], undefined, 'false');
  f.set(['productPage', 'commonAttributes', 'exposedAttributes'], '색상', '검정');
  f.set(['logisticsPage', 'totalSKUsInBox'], undefined, '50');
  f.set(['imagePage', 'msrpAgree'], undefined, 'false'); f.set(['imagePage', 'labelContactAgreed'], undefined, 'false');
  f.set(['imagePage', 'images', 'mainImage'], undefined, keys[0]);
  f.set(['imagePage', 'images', 'additionalImage'], undefined, keys.slice(1, 3).join('\n'));
  f.set(['imagePage', 'details', 'detailedImage'], undefined, keys.slice(3, 6).join('\n'));
  f.set(['imagePage', 'images', 'labelImages'], labelName, keys[6]);
  f.set(['imagePage', 'details', 'htmlProductDetailContent'], undefined, '', 'manual-option');
  const assets = keys.slice(0, 7).map((key, index) => ({ key, name: 'assets/file-' + index + '.png', data: imageBytes(index), sha256: sha(imageBytes(index)) }));
  const metadata = new Map(assets.map(asset => [asset.key, { size: asset.data.byteLength, httpMetadata: { contentType: 'image/png' }, customMetadata: { sha256: asset.sha256 } }]));
  return { ...f, assets, metadata, planInput: async () => ({ projection: await module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument(f.input),
    owner: 'owner', productId: 'synthetic-package-653', ownedKeys: keys, assets, metadata, config }) };
}
export async function assetApiFixture(company = companies[0], snapshot = assetSnapshot(company), { twoOptions = true, populate = true, productId } = {}) {
  const f = await apiFixture(company, snapshot, { productId }), { h } = f;
  h.bindings.YOOFAM_DETAIL_IMAGE_SECRET = config.secret; h.bindings.YOOFAM_DETAIL_IMAGE_ORIGIN = config.origin;
  h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify(keys), f.id);
  const now = new Date().toISOString(), contentModel = h.load('app/product-content.ts'), contentDB = h.load('db/product-content.ts');
  const beforeContent = await contentDB.readProductContent('owner', f.id);
  const content = contentModel.applyContentPatch(beforeContent, { assets: { main: [keys[0]], additional: keys.slice(1, 3), detailTop: [keys[3]], detail: [keys[4]], detailBottom: [keys[5]], label: [keys[6]] } }, now);
  await contentDB.saveProductContent('owner', content, beforeContent.revision);
  if (twoOptions) {
    const optionDB = h.load('db/product-options.ts'), optionModel = h.load('app/product-options.ts'), current = await optionDB.readProductOptions('owner', f.id);
    const inputs = optionModel.optionInputs(current); inputs.push({ ...inputs[0], id: 'synthetic-two', translatedName: '흰색', color: '흰색', supplierSku: 'SYNTHETIC-653-TWO' },
      { ...inputs[0], id: 'synthetic-excluded', included: false, imageKey: keys[7], supplierSku: 'SYNTHETIC-653-EXCLUDED' });
    const latest = await h.load('db/queries.ts').findProduct('owner', f.id);
    await optionDB.saveProductOptions('owner', optionModel.applyOptionRows(current, inputs, now), current.revision, latest.updated_at);
  }
  const viewResponse = await h.route(f.base + '/quotation-fields' + f.query), view = await viewResponse.json();
  if (viewResponse.status !== 200) throw Error(JSON.stringify(view));
  const byWire = (path, name) => view.resolved.schema.fields.find(field => JSON.stringify(field.hubWire?.path) === JSON.stringify(path) && field.hubWire?.name === name)?.id;
  if (populate) {
    const wireChanges = [
      [['productPage', 'modelNumber'], undefined, ''], [['productPage', 'commonAttributes', 'purchasePrice'], undefined, '11960'],
      [['productPage', 'commonAttributes', 'coupangSalePrice'], undefined, '19930'], [['productPage', 'commonAttributes', 'msrp'], undefined, '25910'],
      [['imagePage', 'details', 'htmlProductDetailContent'], undefined, ''], [['imagePage', 'msrpAgree'], undefined, 'false'], [['imagePage', 'labelContactAgreed'], undefined, 'false'],
      [['productPage', 'commonAttributes', 'count'], undefined, '0'], [['productPage', 'commonAttributes', 'booleanValue'], undefined, 'false'],
      [['productPage', 'commonAttributes', 'exposedAttributes'], '색상', '검정'],
    ].flatMap(([path, name, value]) => byWire(path, name) ? [{ fieldKey: byWire(path, name), optionId: null, value }] : []);
    // Stage-two's explicit price edit writes both the primary exact Hub wire
    // and its canonical summary. Independent legacy mismatches are tested apart.
    const changes = [...wireChanges, ...[['supplyPrice', '11960'], ['salePrice', '19930'], ['msrp', '25910']]
      .filter(([fieldKey]) => !wireChanges.some(change => change.fieldKey === fieldKey))
      .map(([fieldKey, value]) => ({ fieldKey, optionId: null, value }))];
    const savedResponse = await h.route(f.base + '/quotation-fields' + f.query, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } });
    if (savedResponse.status !== 200) throw Error(await savedResponse.text());
  }
  const originalPut = h.bindings.FILES.put;
  h.bindings.FILES.put = async (...args) => { const existed = h.objects.has(args[0]), result = await originalPut(...args);
    return existed && args[2]?.onlyIf?.get('if-none-match') === '*' ? result : h.bindings.FILES.head(args[0]); };
  for (const [index, key] of keys.entries()) await h.bindings.FILES.put(key, imageBytes(index), { httpMetadata: { contentType: 'image/png' }, customMetadata: { sha256: sha(imageBytes(index)) } });
  const objectState = () => JSON.stringify([...h.objects].filter(([key]) => !key.startsWith('quotation-public-detail/')).map(([key, bytes]) => [key, sha(bytes)]));
  return { ...f, keys, byWire, objectState, endpoint: f.base + '/supplier-hub-single-package' + f.query,
    prepare: fingerprint => h.route(f.base + '/supplier-hub-single-package' + f.query, { method: 'POST', body: { action: 'prepare', expectedFingerprint: fingerprint } }) };
}
