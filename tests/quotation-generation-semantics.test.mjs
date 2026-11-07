import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { aiModule } from './helpers/quotation-ai.mjs';
import { providedOptionModule as load } from './helpers/provided-option-quotation.mjs';
const policy = 'option-notice-material-evidence-v1';
import { curtain, provider, colors } from './helpers/quotation-generation-semantics.mjs';
function current(f) { const m = aiModule(); return { m, plan: m.buildQuotationAiPlan(f.saved, f.scope, undefined, policy) }; }

test('new quotation generation copies verified option sizes and omits unresolved size fields', async () => {
  const f = curtain(), m = aiModule();
  const sizes = ['均码', 'L', '해당사항없음', '', 'Free', 'M'];
  f.options.rows.forEach((row, i) => {
    row.size = sizes[i]; row.provenance.size = i === 4 ? 'unverified' : i === 5 ? 'manual' : 'collected';
  });
  f.raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push({
    contains: { type: 'object', properties: {
      attributeName: { type: 'string', enum: ['패션의류/잡화 사이즈'], requirement: '필수' },
      attributeValue: { type: 'string', enum: ['FREE', 'L', 'M', '해당사항없음'] },
    } },
  });
  f.syncSchema();
  const plan = m.buildQuotationAiPlan(f.saved, f.scope, undefined, 'couplus-common-legal-saved-size-v5');
  const size = plan.fields.find(field => field.label === '패션의류/잡화 사이즈');
  const p = provider({ commonColor: '블랙' }), result = await m.executeQuotationAi(plan, p);
  assert.ok(p.requests.every(request => request.fields.every(field => field.id !== size.id)));
  assert.deepEqual(JSON.parse(JSON.stringify(result.changes.filter(change => change.fieldKey === size.id))), [
    { optionId: f.options.rows[0].id, fieldKey: size.id, value: 'FREE' },
    { optionId: f.options.rows[1].id, fieldKey: size.id, value: 'L' },
    { optionId: f.options.rows[5].id, fieldKey: size.id, value: 'M' },
  ]);
  assert.ok(result.warnings.some(warning => warning.includes('실제 사이즈')));
  assert.throws(() => m.validateCurrentQuotationResult(plan, [{ optionId: f.options.rows[2].id, fieldKey: size.id, value: 'FREE' }]), /실제 사이즈/);
  assert.throws(() => m.validateCurrentQuotationResult(plan, [{ optionId: f.options.rows[1].id, fieldKey: size.id, value: '해당사항없음' }]), /실제 사이즈/);
});

test('new policy differentiates full legal color wires for six raw Chinese colors even when classifier omits notices', async () => {
  const f = curtain(), { m, plan } = current(f), p = provider(), result = await m.executeQuotationAi(plan, p);
  const color = plan.fields.find(field => field.group === 'notice' && field.label === '색상');
  assert.ok(p.requests.filter(r => r.task.startsWith('GET_DIFFERENTIATED')).every(r => r.fields.some(field => field.id === color.id)));
  assert.ok(p.requests.filter(r => r.task.startsWith('GET_COMMON')).every(r => r.fields.every(field => field.id !== color.id)));
  for (let i = 0; i < 6; i++) assert.equal(result.changes.find(change => change.optionId === f.options.rows[i].id && change.fieldKey === color.id)?.value, colors[i]);
  const material = plan.fields.find(field => field.label === '제품 소재');
  assert.ok(result.changes.every(change => change.fieldKey !== material.id));
  assert.ok(result.warnings.some(warning => warning.includes('제품 소재') && warning.includes('적용하지')));
});

test('no-evidence material and aggregate legal colors are omitted rather than replacing current references', async () => {
  const { m, plan } = current(curtain()), result = await m.executeQuotationAi(plan, provider({ aggregate: true }));
  const legal = new Set(plan.fields.filter(field => field.group === 'notice').map(field => field.id));
  assert.ok(result.changes.every(change => !legal.has(change.fieldKey)));
});

for (const [source, proposal] of [['材质: 硅胶', '실리콘']]) test(`explicit detail material without attributes supports ${proposal}`, async () => {
  const f = curtain(); f.content.detail = { description: { value: source, provenance: 'collected', updatedAt: null } };
  const { m, plan } = current(f), result = await m.executeQuotationAi(plan, provider({ material: proposal }));
  const field = plan.fields.find(field => field.label === '제품 소재');
  assert.equal(result.changes.filter(change => change.fieldKey === field.id).length, 6, JSON.stringify(result.warnings));
  assert.ok(result.changes.filter(change => change.fieldKey === field.id).every(change => change.value === proposal));
});

test('detail priority rejects conflicting material while manually saved blanks and values remain protected', async () => {
  const f = curtain(); f.content.detail = { description: { value: '재질: 硅胶', provenance: 'collected', updatedAt: null } };
  f.content.categoryAttributes = { categoryId: f.snapshot.categoryId, jobId: 'source-job', values: [{ name: '재질', value: '폴리에스테르', sourceName: '材质' }] };
  const before = current(f), material = before.plan.fields.find(field => field.label === '제품 소재');
  f.state.overrides.options[f.options.rows[0].id] = { [material.id]: '' };
  f.state.overrides.options[f.options.rows[1].id] = { [material.id]: '직접 확인' };
  const { m, plan } = current(f), result = await m.executeQuotationAi(plan, provider({ material: '폴리에스테르' }));
  assert.ok(result.changes.every(change => change.fieldKey !== material.id));
  assert.ok(plan.targets.slice(0, 2).every(target => target.protectedValues.some(value => value.fieldKey === material.id)));
});

test('omitted generation policy keeps frozen old plan and provider request bytes; unknown policies fail', async () => {
  const f = curtain(), m = aiModule();
  f.snapshot.observedAt = 1791244800000; f.saved.source.productVersion = f.product.updated_at = '2026-10-06T00:00:00.000Z';
  // Captured from the exact pre-policy module; timestamp fields are fixed above.
  const expected = [
    ['005ebfdb341bfb8cb367ed89be3386ec8f955dffb2ca109516bfc776632685cd', '81cf0c917a7b8d91e9158cf206c929d7caf73a837c4614e015cb8da1f281ad79'],
    ['9030e32bc3e27b0a21cb782c9c05e6268232ee061e985c8e0e70854188d7a1b3', 'd82a9f96c09b059d78b0adb628520d2c1eeda055c536bf7934a016780501a01f'],
  ];
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  for (const [i, resultPolicy] of [null, undefined].entries()) {
    const actual = m.buildQuotationAiPlan(f.saved, f.scope, resultPolicy), p = provider();
    assert.equal(hash({ ...actual, createdAt: null }), expected[i][0]);
    assert.equal(Object.hasOwn(actual, 'generationPolicy'), false);
    await m.executeQuotationAi(actual, p); assert.equal(hash(p.requests), expected[i][1]);
  }
  assert.throws(() => m.buildQuotationAiPlan(f.saved, f.scope, undefined, 'forged'), /규칙|정책/);
  const plan = m.buildQuotationAiPlan(f.saved, f.scope); plan.generationPolicy = 'forged';
  await assert.rejects(m.executeQuotationAi(plan, provider()), /규칙|정책/);
});

test('exact explicit Korean material remains an existing source and arbitrary generated material is not evidence', async () => {
  const f = curtain(); f.content.detail = { description: { value: '재질: 자작나무', provenance: 'collected', updatedAt: null } };
  const { m, plan } = current(f), field = plan.fields.find(field => field.label === '제품 소재');
  assert.ok(plan.targets.every(target => target.protectedValues.some(value => value.fieldKey === field.id && value.value === '자작나무')));
  const result = await m.executeQuotationAi(plan, provider()); assert.ok(result.changes.every(change => change.fieldKey !== field.id));
  const helpers = load('app/quotation-ai-client.ts');
  assert.equal(helpers.quotationAiGenerationIssue(field, plan.targets[0].optionId, '자작나무', helpers.quotationAiGenerationFacts(plan.facts)), null);
  f.content.detail.description.provenance = 'generated';
  const generated = current(f); assert.equal(helpers.quotationAiGenerationFacts(generated.plan.facts).material.length, 0);
});

test('color contamination guard permits same color sizes, common words, synonyms and an own multicolor option', () => {
  const { plan } = current(curtain()), field = plan.fields.find(field => field.group === 'notice' && field.label === '색상');
  const h = load('app/quotation-ai-client.ts'), facts = { material: [], options: [
    { optionId: 'black-small', color: '黑色', translatedName: '블랙 소형 커튼' },
    { optionId: 'black-large', color: '黑色', translatedName: '블랙 대형 커튼' },
    { optionId: 'mixed', color: '黑白', translatedName: '블랙 화이트 커튼' },
  ] };
  for (const [id, value] of [['black-small', '검정'], ['black-large', '블랙'], ['mixed', '블랙/화이트'], ['mixed', '흑백']])
    assert.equal(h.quotationAiGenerationIssue(field, id, value, facts), null);
  assert.match(h.quotationAiGenerationIssue(field, 'black-small', '블랙, 화이트', facts), /다른 옵션/);
  const lookalike = { ...field, hubWire: { ...field.hubWire, path: ['legalPage', 'certificates'] } };
  assert.equal(h.quotationAiOptionColorNotice(lookalike), false);
  assert.equal(h.quotationAiOptionColorNotice({ ...field, hubWire: { ...field.hubWire, nameKey: 'noticeName', valueKey: 'noticeValue' } }), false);
});

test('single and same-color size options keep legal color in a valid common generation path', async () => {
  for (const count of [1, 3]) {
    const f = curtain(); f.options.rows = f.options.rows.slice(0, count);
    f.options.rows.forEach((row, i) => { row.color = '黑色'; row.translatedName = '블랙 ' + (i + 1) + '사이즈'; });
    const { m, plan } = current(f), p = provider({ commonColor: '블랙' }), result = await m.executeQuotationAi(plan, p);
    const field = plan.fields.find(field => field.label === '색상' && field.group === 'notice');
    assert.equal(result.changes.filter(change => change.fieldKey === field.id && change.value === '블랙').length, count);
    assert.ok(p.requests.some(r => r.task.startsWith('GET_COMMON') && r.fields.some(item => item.id === field.id)));
  }
});

test('new evidence policy cannot satisfy an unresolved mandatory hidden material or relax numeric units', async () => {
  const f = curtain(); f.raw.properties.productPage.properties.unexposedAttributes = { type: 'array', allOf: [{ contains: { type: 'object', properties: {
    attributeName: { type: 'string', enum: ['소재'], mandatory: true, requirement: '필수' }, attributeValue: { type: 'string' },
  } } }] }; f.syncSchema(); f.saved.settings.hiddenAttributes = false;
  const { m, plan } = current(f);
  await assert.rejects(m.executeQuotationAi(plan, provider()), error => error.code === 'AI_MANDATORY_UNEXPOSED');
  const numeric = curtain();
  numeric.raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push({ contains: { type: 'object', properties: {
    attributeName: { type: 'string', enum: ['수량'], attributeDataType: 'NUMBER', attributeUnitGroup: 'QUANTITY', requirement: '필수' }, attributeValue: { type: 'string' },
  } } }); numeric.syncSchema(); const n = current(numeric), field = n.plan.fields.find(field => field.label === '수량');
  assert.throws(() => n.m.validateCurrentQuotationResult(n.plan, [{ optionId: n.plan.targets[0].optionId, fieldKey: field.id, value: '2파섹' }]), error => error.code === 'AI_ATTRIBUTE_UNIT');
});

test('explicit named material pairs remain eligible while unrelated purpose and placeholders never become material evidence', async () => {
  const f = curtain(); f.content.categoryAttributes = { categoryId: f.snapshot.categoryId, jobId: 'source-job', values: [{ name: '제품 소재', value: '자작나무', sourceName: '材质' }] };
  let built = current(f), result = await built.m.executeQuotationAi(built.plan, provider({ material: '자작나무' }));
  const field = built.plan.fields.find(field => field.label === '제품 소재');
  assert.equal(result.changes.filter(change => change.fieldKey === field.id).length, 6);
  for (const pair of [{ name: '用途', value: '실내용' }, { name: '재질', value: '상세정보참조' }]) {
    f.content.categoryAttributes.values = [pair]; built = current(f);
    result = await built.m.executeQuotationAi(built.plan, provider({ material: pair.value }));
    assert.ok(result.changes.every(change => change.fieldKey !== field.id));
  }
});

test('P2 own raw black supports black synonyms despite a mixed foreign option using different Korean words', () => {
  const { plan } = current(curtain()), field = plan.fields.find(field => field.group === 'notice' && field.label === '색상');
  const h = load('app/quotation-ai-client.ts'), facts = { material: [], options: [
    { optionId: 'own', color: '黑色', translatedName: '검정 커튼' },
    { optionId: 'other', color: '黑白', translatedName: '블랙 화이트 커튼' },
  ] };
  for (const value of ['검정', '블랙', '검정색']) assert.equal(h.quotationAiGenerationIssue(field, 'own', value, facts), null, value);
  assert.match(h.quotationAiGenerationIssue(field, 'own', '블랙 화이트', facts), /다른 옵션/);
});

test('P3 full own-supported multiword aliases exempt only their bounded phrase, never a standalone foreign component', () => {
  const { plan } = current(curtain()), field = plan.fields.find(field => field.group === 'notice' && field.label === '색상');
  const h = load('app/quotation-ai-client.ts'), facts = { material: [], options: [
    { optionId: 'own', color: '玫瑰金', translatedName: '장미금 커튼' },
    { optionId: 'other', color: '金色', translatedName: '골드 커튼' },
  ] };
  for (const value of ['로즈골드', '로즈 골드', '로즈  골드']) assert.equal(h.quotationAiGenerationIssue(field, 'own', value, facts), null, value);
  for (const value of ['골드', '로즈 골드 골드', '골드 로즈 골드', '로즈골드 골드']) assert.match(h.quotationAiGenerationIssue(field, 'own', value, facts), /다른 옵션/, value);
});

test('N1 original-name-only recorded color parts differentiate without creating saved color facts', async () => {
  const f = curtain(); f.options.rows = f.options.rows.slice(0, 2);
  f.options.rows.forEach((row, i) => Object.assign(row, { color: '', originalName: ['玫红&gt;100*200cm', '黑色>100*200cm'][i], translatedName: ['로즈레드 / 100*200cm', '검정 / 100*200cm'][i] }));
  const before = JSON.stringify(f.options), { m, plan } = current(f), base = provider({ commonColor: '로즈레드, 검정' });
  const p = { requests: base.requests, async run(model, input) { const r = JSON.parse(input.messages[1].content);
    if (!r.task.startsWith('GET_DIFFERENTIATED')) return base.run(model, input);
    base.requests.push(r); return { response: JSON.stringify({ options: r.targets.map(target => ({ optionId: target.optionId, changes: r.fields.filter(field => target.writableFieldIds.includes(field.id)).map(field => ({ fieldKey: field.id, value: target.optionId === f.options.rows[0].id ? '로즈레드' : '검정' })) })) }) };
  } };
  const result = await m.executeQuotationAi(plan, p), field = plan.fields.find(field => field.group === 'notice' && field.label === '색상');
  assert.deepEqual(Array.from(result.changes.filter(change => change.fieldKey === field.id), change => change.value), ['로즈레드', '검정']);
  assert.ok(p.requests.some(r => r.task.startsWith('GET_DIFFERENTIATED') && r.fields.some(item => item.id === field.id)));
  assert.equal(JSON.stringify(f.options), before);
});

test('N1 original-name color fallback requires whole axis parts and preserves longest aliases and metal exceptions', () => {
  const h = load('app/quotation-ai-client.ts'), ref = originalName => h.quotationAiColorReference({ optionId: 'x', color: '', translatedName: '', originalName });
  for (const name of ['100*200cm', '金属>100*200cm', '玫瑰金属>100*200cm', '黑眼圈>100*200cm', '未知>100*200cm']) assert.equal(ref(name), undefined, name);
  assert.ok(ref('玫红&gt;100*200cm')); assert.ok(ref('黑色&#62;100*200cm')); assert.ok(ref('黑色&amp;gt;100*200cm'));
  assert.equal(ref('玫红>100*200cm').aliases.includes('레드'), false, 'longest rose red does not grant plain red');
  assert.equal(ref('玫瑰金>100*200cm').aliases.includes('골드'), false, 'rose gold does not grant plain gold');
  assert.ok(ref('金属>黑色>100*200cm').aliases.includes('블랙'));
  const own = { optionId: 'own', color: '', translatedName: '장미금 커튼', originalName: '玫瑰金>100*200cm' };
  const other = { optionId: 'other', color: '', translatedName: '골드 커튼', originalName: '金色>100*200cm' };
  const { plan } = current(curtain()), field = plan.fields.find(field => field.group === 'notice' && field.label === '색상'), facts = { material: [], options: [own, other] };
  assert.equal(h.quotationAiGenerationIssue(field, 'own', '로즈 골드', facts), null);
  for (const value of ['골드', '로즈 골드 골드']) assert.match(h.quotationAiGenerationIssue(field, 'own', value, facts), /다른 옵션/);
  assert.equal(h.quotationAiColorReference({ ...own, color: '黑色' }).aliases.includes('로즈 골드'), false, 'explicit color takes priority over original name');
});

test('P3 alias words inside the own translated full alias do not exempt a standalone foreign component', () => {
  const h = load('app/quotation-ai-client.ts'), { plan } = current(curtain()), field = plan.fields.find(field => field.group === 'notice' && field.label === '색상');
  for (const translatedName of ['장미금 커튼', '로즈골드 커튼', '로즈 골드 커튼']) {
    const facts = { material: [], options: [{ optionId: 'own', color: '玫瑰金', translatedName }, { optionId: 'other', color: '金色', translatedName: '골드 커튼' }] };
    assert.equal(h.quotationAiGenerationIssue(field, 'own', '로즈 골드', facts), null);
    for (const value of ['골드', '로즈 골드 골드']) assert.match(h.quotationAiGenerationIssue(field, 'own', value, facts), /다른 옵션/, translatedName + ' / ' + value);
  }
});
