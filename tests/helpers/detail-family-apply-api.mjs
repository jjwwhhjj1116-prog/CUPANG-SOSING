import { randomUUID } from 'node:crypto';
import { optionSplitFixture } from './product-option-splits-api.mjs';
import { companies, json } from './image-download-ui.mjs';

export async function detailFamilyFixture(company = companies[0], { groups = 3, leanCapture = false } = {}) {
  const f = await optionSplitFixture(company);
  try {
    let ids = f.ids;
    if (groups > ids.length) {
      const options = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload), rows = options.rows;
      options.rows = Array.from({ length: groups }, (_, index) => ({ ...structuredClone(rows[index % rows.length]), id: 'family-source-' + index, supplierSku: '' }));
      f.api.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(options)); await f.refresh(); ids = options.rows.map(row => row.id);
    }
    if (leanCapture) {
      // A valid historical capture can predate its later mapped workbook.
      // Keep the current official profile/template and exact live schema intact.
      const context = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM collection_context').get().payload);
      context.category.template = null; context.category.mappings = [];
      f.api.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(context)); await f.refresh();
    }
    const buckets = Array.from({ length: groups }, (_, i) => ids.filter((_, index) => Math.min(groups - 1, Math.floor(index * groups / ids.length)) === i));
    const splitInput = f.makeInput(f.splitGroups(buckets)), split = await json(await f.commit(splitInput, await f.preview(splitInput)));
    const profileId = f.view.categoryContext.profileId, sourceView = await json(await f.api.route(f.qurl)), optionId = sourceView.resolved.rows.find(row => row.optionId).optionId;
    const prepared = await f.runtime.helper.prepareDetailComposite({ productId: f.product.id, optionId, profileId, view: sourceView }, new AbortController().signal, f.request);
    const upload = await f.upload(prepared), sourceSaved = await json(await f.api.route(f.base + '/detail-save?profileId=' + profileId, { method: 'POST', body: upload }));
    const view = sourceSaved.quotation, endpoint = f.base + '/detail-family?profileId=' + profileId, targetIds = split.receipt.groups.slice(1).map(group => group.productId);
    const makeFamilyInput = (selected = targetIds) => ({ requestId: randomUUID(), expectedInputFingerprint: view.inputFingerprint, targetIds: [...selected] });
    const catalog = () => f.api.route(endpoint);
    const postFamily = body => f.api.route(endpoint, { method: 'POST', body });
    const previewFamily = async input => json(await postFamily({ action: 'preview', ...input }));
    const commitFamily = (input, preview) => postFamily({ action: 'commit', ...input, previewFingerprint: preview.fingerprint });
    const recoverFamily = requestId => f.api.route(endpoint + '&requestId=' + requestId);
    const sql = new WeakMap(), metrics = new WeakMap(), prepare = f.api.db.prepare;
    f.api.db.prepare = text => {
      const statement = prepare(text), bind = statement.bind;
      sql.set(statement, text); metrics.set(statement, { sqlBytes: Buffer.byteLength(text), bindings: 0 });
      statement.bind = (...args) => { metrics.set(statement, { sqlBytes: Buffer.byteLength(text), bindings: args.length }); return bind(...args); };
      return statement;
    };
    const isFamilyBatch = statements => statements.some(statement => sql.get(statement)?.startsWith('INSERT INTO detail_family_apply_operations('));
    return { ...f, view, sourceView: view, sourceId: f.product.id, sourceImage: { key: sourceSaved.receipt.key, sha256: prepared.sha256, bytes: prepared.output.size },
      sourceDetailReceipt: sourceSaved.receipt, prepared, split, targetIds, endpoint, makeFamilyInput, catalog, postFamily, previewFamily, commitFamily, recoverFamily, isFamilyBatch,
      statementMetrics: statements => statements.map(statement => metrics.get(statement)) };
  } catch (error) { f.api.close(); throw error; }
}
