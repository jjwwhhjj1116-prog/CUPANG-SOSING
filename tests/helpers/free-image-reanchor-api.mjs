import { freeImageEditFixture } from './free-image-edit-api.mjs';

const json = async response => {
  if (response.status !== 200) throw Error(`Fixture response ${response.status}: ${await response.text()}`);
  return response.json();
};
export async function freeImageReanchorFixture(company) {
  const f = await freeImageEditFixture(company), route = f.h.load('app/api/products/[id]/image-text/route.ts');
  const target = input => f.h.load('app/quotation-seo-targets.ts').exactPrimaryQuotationTarget(f.before.resolved.schema.fields, input);
  const open = (key, { input = 'additionalImages', optionId = f.selected, slotIndex = input === 'mainImage' ? 0 : 1,
    policy = 'saved-current-target-v1', profileId = f.profile.id, productId = f.id, role = input === 'mainImage' ? 'main' : input === 'additionalImages' ? 'additional' : input === 'labelImages' ? 'label' : 'detail', fieldKey = target(input).primary } = {}) => {
    const query = new URLSearchParams({ sourceKey: key, role, target: 'quotation', profileId, optionId, fieldKey, slotIndex: String(slotIndex), ...(policy ? { editor: policy } : {}) });
    return route.GET(new Request(`https://app.test/api/products/${productId}/image-text?${query}`), { params: Promise.resolve({ id: productId }) });
  };
  const saveImages = async edits => {
    const view = await f.read(), changes = edits.flatMap(({ input, optionId = f.selected, value }) => target(input).linked.map(fieldKey => ({ optionId, fieldKey, value })));
    return json(await f.h.route(f.qurl, { method: 'PUT', body: { expectedRevision: view.revision, expectedInputFingerprint: view.inputFingerprint, changes } }));
  };
  const seed = async () => {
    const source = (await json(await f.source())).source, saved = await json(await f.applyEdit(source, f.doc()));
    return { source, saved };
  };
  return { ...f, target, open, saveImages, seed };
}
