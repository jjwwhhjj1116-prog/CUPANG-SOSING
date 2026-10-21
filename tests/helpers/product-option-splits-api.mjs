import { randomUUID } from 'node:crypto';
import { detailSaveFixture } from './detail-save-fixture.mjs';
import { companies, json } from './image-download-ui.mjs';

export async function optionSplitFixture(company = companies[0]) {
  const f = await detailSaveFixture(company);
  try {
    const now = new Date().toISOString(), email = company.companyCode === 'A01526306' ? 'jwhj1116@kakao.com' : 'unari8484@gmail.com';
    f.api.sqlite.prepare('INSERT INTO members VALUES(?,?,?,?,?,?,?,?,?,?)').run('owner', email, 'fixture-not-a-password', company.companyCode === 'A01526306' ? 'admin' : 'member', 'approved', company.companyCode, company.companyName, now, now, null);
    const ids = f.view.resolved.rows.flatMap(row => row.optionId ? [row.optionId] : []);
    f.view = await json(await f.api.route(f.qurl, { method: 'PUT', body: { expectedRevision: f.view.revision, expectedInputFingerprint: f.view.inputFingerprint,
      changes: [{ fieldKey: 'title', optionId: null, value: '직접 작성한 공통 견적 제목' }, { fieldKey: 'title', optionId: ids[0], value: '' },
        { fieldKey: 'brand', optionId: ids[3], value: '옵션별 수동 브랜드' }] } }));
    const state = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_quotation_fields').get().payload);
    state.categoryOverrides['category:991234'] = { common: { title: '', brand: '다른 카테고리 원문' }, options: {
      [ids[0]]: { title: '그룹1 다른 양식 제목' }, [ids[3]]: { title: '', detailHtml: '<p>그룹2 다른 양식 HTML</p>' },
    } };
    f.api.sqlite.prepare('UPDATE product_quotation_fields SET payload=?').run(JSON.stringify(state));
    const labels = { schemaVersion: 1, productId: f.product.id, revision: 1, updatedAt: f.view.productVersion,
      overrides: { common: { productName: '', material: '공통 재질' }, options: { [ids[0]]: { productName: '' }, [ids[3]]: { material: '옵션 재질' } } } };
    // Explicitly model the saved legacy state below, independently of the new
    // product initializer. Never overwrite a competing production record.
    f.api.sqlite.prepare('DELETE FROM product_labels WHERE product_id=?').run(f.product.id);
    f.api.sqlite.prepare('INSERT INTO product_labels VALUES(?,?,?,?,?)').run(f.product.id, 'owner', 1, JSON.stringify(labels), labels.updatedAt);
    await f.refresh();
    const endpoint = f.base + '/option-splits?profileId=' + f.view.categoryContext.profileId;
    const splitGroups = (buckets = [ids.slice(0, 3), ids.slice(3)]) => buckets.map((optionIds, index) => ({ label: index ? `  두 번째 그룹${index}  ` : '첫 번째 그룹',
      productId: index ? randomUUID() : f.product.id, optionIds: [...optionIds], optionIdMap: Object.fromEntries(optionIds.map(id => [id, index ? randomUUID() : id])) }));
    const makeInput = (groups = splitGroups()) => ({ requestId: randomUUID(), expectedInputFingerprint: f.view.inputFingerprint, groups });
    const post = body => f.api.route(endpoint, { method: 'POST', body });
    const preview = async input => json(await post({ action: 'preview', ...input }));
    const commit = (input, reviewed) => post({ action: 'commit', ...input, previewFingerprint: reviewed.fingerprint });
    const recover = requestId => f.api.route(endpoint + '&requestId=' + requestId);
    const all = () => JSON.stringify(f.api.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map(({ name }) => [name, f.api.sqlite.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]));
    const sql = new WeakMap(), prepare = f.api.db.prepare;
    f.api.db.prepare = text => { const statement = prepare(text); sql.set(statement, text); return statement; };
    const isCommitBatch = statements => statements.some(statement => sql.get(statement)?.startsWith('INSERT INTO product_option_split_operations('));
    return { ...f, ids, company, endpoint, splitGroups, makeInput, post, preview, commit, recover, all, isCommitBatch };
  } catch (error) { f.api.close(); throw error; }
}
