import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { companies, json } from './helpers/image-download-ui.mjs';
import { optionSplitFixture } from './helpers/product-option-splits-api.mjs';

const states = (f, id) => Object.fromEntries(['product_content', 'product_options', 'product_quotation_fields', 'product_labels'].map(table => [table,
  JSON.parse(f.api.sqlite.prepare(`SELECT payload FROM ${table} WHERE product_id=?`).get(id).payload)]));
const rawProduct = (f, id) => ({ ...f.api.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id) });
const rows = (f, table, where = '', args = []) => JSON.parse(JSON.stringify(f.api.sqlite.prepare('SELECT * FROM ' + table + where + ' ORDER BY rowid').all(...args)));
const blankSnapshot = (f, table) => JSON.stringify(rows(f, table));

for (const company of companies) test(`reviewed option partition atomically preserves every saved scope, fresh identities and frozen source (${company.companyCode})`, async () => {
  const f = await optionSplitFixture(company);
  try {
    const original = states(f, f.product.id), source = rawProduct(f, f.product.id), number = rows(f, 'product_registration_numbers')[0].registration_number;
    const immutable = Object.fromEntries(['collection_jobs', 'collection_context', 'collection_results', 'collection_source_supplements', 'collection_images', 'collection_products', 'collection_offer_claims']
      .map(table => [table, rows(f, table)]));
    const input = f.makeInput(), before = f.all(), network = f.api.network.length, ai = f.api.aiSources.length;
    const preview = await f.preview(input); assert.equal(f.all(), before); assert.equal(preview.sourceVersion, source.updated_at); assert.equal(preview.company.code, company.companyCode);
    assert.ok(preview.warnings.some(message => message.includes('수동'))); assert.equal(preview.groups.length, 2);
    const result = await json(await f.commit(input, preview)), receipt = result.receipt;
    assert.equal(result.current, true); assert.equal(receipt.fingerprint, preview.fingerprint); assert.equal(receipt.familyId, input.requestId);
    assert.equal(receipt.groups[0].registrationNumber, number); assert.notEqual(receipt.groups[1].registrationNumber, number);
    assert.match(receipt.groups[1].registrationNumber, /^\d{12}$/);
    const allActualIds = [];
    for (const [index, group] of receipt.groups.entries()) {
      const saved = states(f, group.productId), product = rawProduct(f, group.productId), request = input.groups[index];
      assert.deepEqual(saved.product_options.rows.map(row => row.id), group.optionIds);
      assert.equal(saved.product_content.revision, index ? 1 : original.product_content.revision + 1);
      assert.equal(saved.product_options.revision, index ? 1 : original.product_options.revision + 1);
      assert.equal(saved.product_quotation_fields.revision, index ? 1 : original.product_quotation_fields.revision + 1);
      assert.equal(saved.product_labels.revision, index ? 1 : original.product_labels.revision + 1);
      for (const state of Object.values(saved)) { assert.equal(state.productId, group.productId); assert.equal(state.updatedAt, receipt.committedAt); }
      assert.equal(product.title, source.title + ', ' + request.label); assert.equal(product.updated_at, receipt.committedAt); assert.equal(product.quote_status, '대기');
      assert.equal(product.image_keys, source.image_keys); assert.equal(product.source_url, source.source_url);
      assert.equal(product.created_at, index ? receipt.committedAt : source.created_at);
      assert.deepEqual(saved.product_quotation_fields.categoryOverrides['category:80719'].common, original.product_quotation_fields.categoryOverrides['category:80719'].common);
      assert.deepEqual(saved.product_quotation_fields.categoryOverrides['category:991234'].common, original.product_quotation_fields.categoryOverrides['category:991234'].common);
      assert.deepEqual(saved.product_labels.overrides.common, original.product_labels.overrides.common);
      for (const [position, sourceId] of request.optionIds.entries()) {
        const newId = request.optionIdMap[sourceId], old = original.product_options.rows.find(row => row.id === sourceId);
        assert.deepEqual(saved.product_options.rows[position], { ...old, id: newId }); allActualIds.push(newId);
        for (const scope of Object.keys(original.product_quotation_fields.categoryOverrides))
          assert.deepEqual(saved.product_quotation_fields.categoryOverrides[scope].options[newId], original.product_quotation_fields.categoryOverrides[scope].options[sourceId]);
        assert.deepEqual(saved.product_labels.overrides.options[newId], original.product_labels.overrides.options[sourceId]);
      }
      assert.equal(saved.product_content.seo.title.value, original.product_content.seo.title.value + ', ' + request.label);
      const childView = await json(await f.api.route('/api/products/' + group.productId + '/quotation-fields?profileId=' + f.view.categoryContext.profileId));
      assert.equal(childView.categoryContext.categoryId, f.view.categoryContext.categoryId);
      assert.equal(childView.categoryContext.source, 'profile');
      const job = rows(f, 'collection_jobs', ' WHERE id=?', [group.jobId])[0];
      assert.equal(job.source_url, immutable.collection_jobs[0].source_url); assert.equal(job.offer_id, immutable.collection_jobs[0].offer_id);
      assert.equal(rows(f, 'collection_context', ' WHERE job_id=?', [group.jobId])[0].payload, immutable.collection_context[0].payload);
      assert.equal(rows(f, 'collection_results', ' WHERE job_id=?', [group.jobId])[0].payload, immutable.collection_results[0].payload);
      assert.equal(rows(f, 'collection_results', ' WHERE job_id=?', [group.jobId])[0].received_at, immutable.collection_results[0].received_at);
      assert.equal(rows(f, 'collection_images', ' WHERE job_id=?', [group.jobId]).length, immutable.collection_images.length);
      if (index) {
        assert.equal(saved.product_quotation_fields.detailSaveBackups, undefined);
        assert.equal(saved.product_content.intakeKeywordSeed, undefined);
        assert.ok(!f.api.sqlite.prepare('SELECT * FROM supplier_hub_receipts WHERE product_id=?').get(group.productId));
      }
    }
    assert.equal(new Set(allActualIds).size, f.ids.length); assert.equal(rows(f, 'products').length, 2);
    assert.deepEqual(rows(f, 'collection_offer_claims'), immutable.collection_offer_claims, 'splits never claim/move the original offer');
    for (const [table, originalRows] of Object.entries(immutable)) if (table !== 'collection_offer_claims') {
      const sourceRows = rows(f, table).filter(row => table === 'collection_jobs' ? row.id === 'job' : row.job_id === 'job');
      assert.deepEqual(sourceRows, originalRows);
    }
    const operation = f.api.sqlite.prepare('SELECT * FROM product_option_split_operations').get();
    const archive = JSON.parse(operation.before_payload).source;
    assert.deepEqual(JSON.parse(archive.options[0].payload), original.product_options); assert.equal(operation.before_payload.includes('fixture-not-a-password'), false);
    const members = rows(f, 'product_option_split_members'); assert.equal(members.length, 2); assert.ok(members.every(row => row.root_product_id === source.id && row.family_id === input.requestId));
    assert.equal(members.find(row => row.product_id === source.id).parent_product_id, null);
    assert.equal(members.find(row => row.product_id !== source.id).parent_product_id, source.id);
    assert.equal(f.api.network.length, network); assert.equal(f.api.aiSources.length, ai);
  } finally { f.api.close(); }
});

for (const company of companies) test(`lost ACK recovery and exact commit replay are read-only even after a later edit (${company.companyCode})`, async () => {
  const f = await optionSplitFixture(company);
  try {
    const input = f.makeInput(), preview = await f.preview(input), committed = await json(await f.commit(input, preview)), before = f.all();
    const batch = f.api.db.batch; let writes = 0;
    f.api.db.batch = statements => { if (f.isCommitBatch(statements)) writes++; return batch(statements); };
    assert.deepEqual(await json(await f.recover(input.requestId)), committed); assert.deepEqual(await json(await f.commit(input, preview)), committed);
    assert.equal(writes, 0); assert.equal(f.all(), before);
    f.api.sqlite.prepare('UPDATE products SET title=? WHERE id=?').run('분할 저장 이후 수동 수정한 제목', committed.receipt.groups[1].productId);
    const changed = f.all(), historical = await json(await f.recover(input.requestId)); assert.equal(historical.current, false); assert.deepEqual(historical.receipt, committed.receipt);
    assert.deepEqual(await json(await f.commit(input, preview)), historical); assert.equal(writes, 0); assert.equal(f.all(), changed);
    const altered = structuredClone(input); altered.groups[1].label += '다른 요청'; assert.equal((await f.commit(altered, preview)).status, 409); assert.equal(f.all(), changed);
    const missing = await f.recover(randomUUID()); assert.equal(missing.status, 404); assert.deepEqual(Object.keys(await missing.json()).sort(), ['code', 'current', 'error', 'receipt']);
  } finally { f.api.close(); }
});

for (const company of companies) test(`same-revision source/member/category/job/result/image races leave zero partial split records (${company.companyCode})`, async () => {
  for (const race of ['member', 'product', 'content', 'options', 'quotation', 'labels', 'settings', 'profile', 'job', 'context', 'result', 'images', 'supplement', 'busy', 'hub-history', 'collision']) {
    const f = await optionSplitFixture(company);
    try {
      const input = f.makeInput(), preview = await f.preview(input), batch = f.api.db.batch; let raced = false, competing;
      f.api.db.batch = async statements => {
        if (!raced && f.isCommitBatch(statements)) {
          raced = true;
          if (race === 'member') f.api.sqlite.prepare("UPDATE members SET status='suspended'").run();
          if (race === 'product') f.api.sqlite.prepare("UPDATE products SET title='동일 시각의 경쟁 제목'").run();
          if (['content', 'options', 'quotation', 'labels'].includes(race)) {
            const table = { content: 'product_content', options: 'product_options', quotation: 'product_quotation_fields', labels: 'product_labels' }[race];
            const value = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM ' + table).get().payload);
            if (race === 'content') value.seo.description.value = '동일 revision 설명';
            if (race === 'options') value.rows[0].stock = 987654;
            if (race === 'quotation') value.categoryOverrides['category:80719'].common.brand = '경쟁 브랜드';
            if (race === 'labels') value.overrides.common.material = '경쟁 재질';
            f.api.sqlite.prepare('UPDATE ' + table + ' SET payload=?').run(JSON.stringify(value));
          }
          if (race === 'settings') f.api.sqlite.prepare('INSERT INTO workspace_settings VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload')
            .run('owner', JSON.stringify({ ...f.api.settings, brand: '경쟁 설정' }), new Date().toISOString());
          if (race === 'profile') { const value = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM category_profiles').get().payload); value.name = '동일 revision 다른 프로필'; f.api.sqlite.prepare('UPDATE category_profiles SET payload=?').run(JSON.stringify(value)); }
          if (race === 'job') f.api.sqlite.prepare("UPDATE collection_jobs SET goal='collect'").run();
          if (race === 'context') { const value = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM collection_context').get().payload); value.features = '경쟁 가이드'; f.api.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(value)); }
          if (race === 'result') { const value = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM collection_results').get().payload); value.description += '동일 시간 원문'; f.api.sqlite.prepare('UPDATE collection_results SET payload=?').run(JSON.stringify(value)); }
          if (race === 'images') f.api.sqlite.prepare("UPDATE collection_images SET operation_id='경쟁 이미지 연결'").run();
          if (race === 'supplement') { const value = f.api.sqlite.prepare('SELECT payload FROM collection_results').get().payload; f.api.sqlite.prepare('INSERT INTO collection_source_supplements VALUES(?,?,?,?,?,?)').run('job', 'owner', value, '{}', value, new Date().toISOString()); }
          if (race === 'busy') f.api.sqlite.prepare('INSERT INTO quotation_ai_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'owner', f.product.id, randomUUID(), 'a'.repeat(64), '{}', 'running', null, null, null, new Date().toISOString(), null, null);
          if (race === 'hub-history') f.api.sqlite.prepare('INSERT INTO supplier_hub_receipts VALUES(?,?,?,?,?,?)').run('owner', f.product.id, 'f'.repeat(64), 1, 1, '{}');
          if (race === 'collision') { const product = rawProduct(f, f.product.id); product.id = input.groups[1].productId; product.owner_id = 'different-owner'; const columns = Object.keys(product); f.api.sqlite.prepare('INSERT INTO products(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')').run(...Object.values(product)); }
          competing = f.all();
        }
        return batch(statements);
      };
      const response = await f.commit(input, preview); assert.equal(response.status, 409, race + ': ' + await response.clone().text()); assert.equal(raced, true, race);
      assert.equal(f.all(), competing, race); assert.equal(rows(f, 'product_option_split_operations').length, 0); assert.equal(rows(f, 'product_option_split_members').length, 0);
    } finally { f.api.close(); }
  }
});

test('trigger-ignored companions and number exhaustion roll back source, children, every payload, family and receipt', async () => {
  const cases = [['products', 'UPDATE'], ['products', 'INSERT'], ['product_content', 'INSERT'], ['product_options', 'INSERT'], ['product_quotation_fields', 'INSERT'],
    ['product_labels', 'INSERT'], ['product_price_policy', 'INSERT'], ['collection_jobs', 'INSERT'], ['collection_context', 'INSERT'], ['collection_results', 'INSERT'],
    ['collection_products', 'INSERT'], ['collection_images', 'INSERT'], ['product_option_split_members', 'INSERT'], ['product_registration_numbers', 'INSERT'],
    ['product_registration_options', 'INSERT'], ['product_option_split_operations', 'UPDATE']];
  for (const [table, operation] of cases) {
    const f = await optionSplitFixture(companies[0]);
    try {
      const input = f.makeInput(), preview = await f.preview(input);
      f.api.sqlite.exec(`CREATE TRIGGER ignore_split BEFORE ${operation} ON ${table} BEGIN SELECT RAISE(IGNORE); END`);
      const before = f.all(), response = await f.commit(input, preview);
      assert.equal(response.status, 409, table + '/' + operation + ': ' + await response.clone().text()); assert.equal(f.all(), before, table + '/' + operation);
    } finally { f.api.close(); }
  }
  const f = await optionSplitFixture(companies[0]);
  try {
    const input = f.makeInput(), preview = await f.preview(input); f.api.sqlite.prepare('UPDATE product_registration_counters SET last_sequence=999').run();
    const before = f.all(); assert.equal((await f.commit(input, preview)).status, 409); assert.equal(f.all(), before);
  } finally { f.api.close(); }
});

test('strict scope/input and immutable ID collisions reject before mutation, while no receipt404 is explicit', async () => {
  const f = await optionSplitFixture(companies[0]);
  try {
    const input = f.makeInput(), before = f.all();
    for (const body of [{ action: 'preview', ...input, extra: true }, { action: 'commit', ...input }, { action: 'preview', ...input, requestId: 'not-uuid' },
      { action: 'preview', ...input, groups: [{ ...input.groups[0], extra: true }, input.groups[1]] }, { action: 'preview', ...input, groups: [input.groups[0]] }])
      assert.equal((await f.post(body)).status, 400);
    assert.equal(f.all(), before);
    const missing = await f.recover(input.requestId); assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'OPTION_SPLIT_NOT_FOUND');
    const invalid = structuredClone(input); invalid.groups[1].optionIds.push(invalid.groups[0].optionIds[0]); invalid.groups[1].optionIdMap[invalid.groups[0].optionIds[0]] = randomUUID();
    assert.equal((await f.post({ action: 'preview', ...invalid })).status, 400);
    const wrong = await f.api.route(f.endpoint + '&profileId=other', { method: 'POST', body: { action: 'preview', ...input } }); assert.equal(wrong.status, 400);
    assert.equal(f.all(), before);
  } finally { f.api.close(); }
});

test('splitting a child retains the explicit family root and leaves an unrelated same-URL draft and earlier sources untouched', async () => {
  const f = await optionSplitFixture(companies[0]);
  try {
    const unrelated = rawProduct(f, f.product.id); unrelated.id = randomUUID(); unrelated.title = '동일 URL의 별개 작업 중인 상품';
    const columns = Object.keys(unrelated); f.api.sqlite.prepare('INSERT INTO products(' + columns.join(',') + ') VALUES(' + columns.map(() => '?').join(',') + ')').run(...Object.values(unrelated));
    const first = f.makeInput(), saved = await json(await f.commit(first, await f.preview(first))), child = saved.receipt.groups[1];
    const rootBefore = rawProduct(f, f.product.id), claims = blankSnapshot(f, 'collection_offer_claims');
    const view = await json(await f.api.route('/api/products/' + child.productId + '/quotation-fields?profileId=' + f.view.categoryContext.profileId));
    const groups = [child.optionIds.slice(0, 1), child.optionIds.slice(1)].map((optionIds, index) => ({ label: '자식 분할 ' + index,
      productId: index ? randomUUID() : child.productId, optionIds, optionIdMap: Object.fromEntries(optionIds.map(id => [id, index ? randomUUID() : id])) }));
    const input = { requestId: randomUUID(), expectedInputFingerprint: view.inputFingerprint, groups }, endpoint = '/api/products/' + child.productId + '/option-splits?profileId=' + f.view.categoryContext.profileId;
    const preview = await json(await f.api.route(endpoint, { method: 'POST', body: { action: 'preview', ...input } }));
    const nested = await json(await f.api.route(endpoint, { method: 'POST', body: { action: 'commit', ...input, previewFingerprint: preview.fingerprint } }));
    assert.equal(nested.current, true); assert.equal(nested.receipt.familyId, saved.receipt.familyId);
    const member = rows(f, 'product_option_split_members', ' WHERE product_id=?', [nested.receipt.groups[1].productId])[0];
    assert.equal(member.root_product_id, f.product.id); assert.equal(member.parent_product_id, child.productId);
    assert.deepEqual(rawProduct(f, f.product.id), rootBefore); assert.deepEqual(rawProduct(f, unrelated.id), unrelated); assert.equal(blankSnapshot(f, 'collection_offer_claims'), claims);
    const history = await json(await f.recover(first.requestId)); assert.equal(history.current, false); assert.deepEqual(history.receipt, saved.receipt);
  } finally { f.api.close(); }
});

test('a database transport failure after commit reports uncertain and GET recovers the durable receipt without a second write', async () => {
  const f = await optionSplitFixture(companies[0]);
  try {
    const input = f.makeInput(), preview = await f.preview(input), batch = f.api.db.batch; let committed = false;
    f.api.db.batch = async statements => { const value = await batch(statements); if (!committed && f.isCommitBatch(statements)) { committed = true; throw Error('database transport disconnected after commit'); } return value; };
    const response = await f.commit(input, preview); assert.equal(response.status, 503); assert.equal((await response.json()).code, 'OPTION_SPLIT_UNCERTAIN');
    const before = f.all(), recovered = await json(await f.recover(input.requestId)); assert.equal(recovered.current, true); assert.equal(recovered.receipt.groups.length, 2); assert.equal(f.all(), before);
    assert.deepEqual(await json(await f.commit(input, preview)), recovered); assert.equal(f.all(), before);
  } finally { f.api.close(); }
});

test('the actual maximum20-group commit stays below100 batch statements and confirms every actual row/number', async () => {
  const f = await optionSplitFixture(companies[0]);
  try {
    const source = JSON.parse(f.api.sqlite.prepare('SELECT payload FROM product_options').get().payload), original = source.rows;
    source.rows = Array.from({ length: 200 }, (_, index) => ({ ...structuredClone(original[index % original.length]), id: 'boundary-' + index, supplierSku: '' }));
    f.api.sqlite.prepare('UPDATE product_options SET payload=?').run(JSON.stringify(source)); await f.refresh();
    const groups = Array.from({ length: 20 }, (_, i) => source.rows.slice(i * 10, i * 10 + 10).map(row => row.id)), input = f.makeInput(f.splitGroups(groups)), preview = await f.preview(input);
    const batch = f.api.db.batch; let count = 0;
    f.api.db.batch = statements => { if (f.isCommitBatch(statements)) count = statements.length; return batch(statements); };
    const saved = await json(await f.commit(input, preview)); assert.equal(saved.current, true); assert.equal(saved.receipt.groups.length, 20); assert.ok(count < 100, String(count));
    assert.equal(rows(f, 'products').length, 20); assert.equal(rows(f, 'product_option_split_members').length, 20);
    assert.equal(rows(f, 'product_registration_numbers').length, 20); assert.equal(new Set(saved.receipt.groups.map(group => group.registrationNumber)).size, 20);
    for (const group of saved.receipt.groups.slice(1)) assert.equal(rows(f, 'product_registration_options', ' WHERE product_id=?', [group.productId]).length, 10);
  } finally { f.api.close(); }
});
