/** Synthetic stored translation/adoption evidence for a NEW isolated product.
 * This is fixture setup, never a claim of provider execution or supplier facts. */
export function seedSeoOptionOriginals(api) {
  const { sqlite, id, version } = api;
  const product = sqlite.prepare('SELECT * FROM products WHERE id=?').get(id), owner = product.owner_id;
  const stored = sqlite.prepare('SELECT * FROM product_options WHERE product_id=? AND owner_id=?').get(id, owner);
  const options = JSON.parse(stored.payload), finished = new Date(Date.parse(version) - 2).toISOString();
  for (const row of options.rows) {
    row.originalName = '黑色 / 均码'; row.color = '검정'; row.size = '프리';
    row.provenance.color = 'translated'; row.provenance.size = 'translated';
    row.updatedAt = version;
  }
  sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=? AND owner_id=?').run(JSON.stringify(options), id, owner);
  const jobId = 'synthetic-caption-source-778', offerId = new URL(product.source_url).pathname.split('/').at(-1).replace('.html', '');
  sqlite.prepare('INSERT INTO collection_jobs(id,owner_id,offer_id,source_url,goal,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(jobId, owner, offerId, product.source_url, 'collect', 'awaiting_connector', finished, finished);
  // Keep the helper usable with SQLite schemas whose columns are ordered
  // independently of this fixture. No source receipt is fabricated or fetched.
  sqlite.prepare('INSERT INTO collection_products(job_id,owner_id,product_id,created_at) VALUES(?,?,?,?)').run(jobId, owner, id, finished);
  const attributes = options.rows.flatMap(row => [
    { name: `option:${row.id}`, value: row.originalName }, { name: `option-color:${row.id}`, value: '黑色' }, { name: `option-size:${row.id}`, value: '均码' },
  ]);
  const review = { model: 'synthetic-only', maxOutputTokens: 0, source: { title: '합성 검수 상품', description: '', attributes, provenance: 'manual',
    reference: `수집 요청 ${jobId} (${product.source_url})의 저장 원문` }, instructionsVersion: 'sourceflow-translation-v6', fingerprint: 'synthetic-only', expiresAt: version };
  const result = { draft: { title: '합성 검수 상품', keywords: [], description: '', warnings: [], attributes: attributes.map((source, sourceIndex) => ({
    sourceIndex, name: source.name, value: source.name.startsWith('option-color:') ? '검정' : source.name.startsWith('option-size:') ? '프리' : '별도 완성 옵션명',
  })) }, generatedAt: finished, provenance: 'generated', appliedToContent: false, responseId: 'synthetic-only', model: 'synthetic-only', usage: null };
  const translationId = 'synthetic-caption-translation-778';
  const columns = ['id', 'owner_id', 'product_id', 'idempotency_key', 'request_fingerprint', 'product_version', 'content_revision', 'status', 'review_fingerprint', 'review', 'expires_at', 'result', 'error', 'claim_token', 'created_at', 'approved_at', 'started_at', 'finished_at'];
  const values = [translationId, owner, id, 'synthetic-caption-778', 'synthetic-only', finished, 1, 'completed', 'synthetic-only', JSON.stringify(review), version, JSON.stringify(result), null, null, finished, finished, finished, finished];
  sqlite.prepare(`INSERT INTO translation_jobs(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...values);
  return { options, jobId, translationId, review, result, owner,
    setReview(value) { sqlite.prepare('UPDATE translation_jobs SET review=? WHERE id=?').run(JSON.stringify(value), translationId); },
    setResult(value) { sqlite.prepare('UPDATE translation_jobs SET result=? WHERE id=?').run(JSON.stringify(value), translationId); },
    setOptions(value) { sqlite.prepare('UPDATE product_options SET payload=? WHERE product_id=? AND owner_id=?').run(JSON.stringify(value), id, owner); },
  };
}
