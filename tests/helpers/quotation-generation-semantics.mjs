import { aiFixture } from './quotation-ai.mjs';
// Sanitized option colors/names recorded in the six-SKU 78255 curtain review.
const colors = ['연보라', '샴페인', '은회', '검정', '흰색', '금색'];
const rawColors = ['浅紫', '香槟', '银灰', '黑色', '白色', '金色'];
function curtain() {
  const f = aiFixture({ count: 6 });
  f.content.seo.description.value = ''; f.content.label.material.value = ''; f.content.label.material.provenance = 'unverified';
  const legal = f.raw.properties.legalPage.properties;
  legal.notices.allOf = ['제품 소재', '색상'].map(name => ({ contains: { type: 'object', properties: { noticeItemName: { type: 'string', enum: [name] }, noticeItemValue: { type: 'string' } } } }));
  delete f.raw.properties.productPage.properties.unexposedAttributes;
  f.raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf = [{ contains: { type: 'object', properties: { attributeName: { type: 'string', enum: ['색상'] }, attributeValue: { type: 'string' } } } }];
  f.options.rows.forEach((row, i) => { row.originalName = rawColors[i] + '窗帘'; row.translatedName = colors[i] + ' / 100*200cm'; row.color = rawColors[i]; row.provenance.color = 'collected'; });
  f.syncSchema(); return f;
}
function provider({ material = '실내용', aggregate = false, commonColor = colors.join(', ') } = {}) {
  const requests = [];
  return { requests, async run(_model, input) {
    const r = JSON.parse(input.messages[1].content); requests.push(r);
    const value = (field, optionId) => field.label === '제품 소재' ? material : aggregate ? colors.join(', ') : colors[Number(optionId) - 1];
    const out = r.task === 'ANALYZE_SCHEMA_ATTRIBUTES' ? { differentiatedFieldIds: r.fields.filter(field => field.group === 'exposed').map(field => field.id) }
      : r.task.startsWith('GET_DIFFERENTIATED') ? { options: r.targets.map(target => ({ optionId: target.optionId, changes: r.fields.filter(field => target.writableFieldIds.includes(field.id)).map(field => ({ fieldKey: field.id, value: value(field, target.optionId) })) })) }
      : { changes: r.fields.map(field => ({ fieldKey: field.id, value: field.label === '제품 소재' ? material : commonColor })) };
    return { response: JSON.stringify(out) };
  } };
}
export { curtain, provider, colors, rawColors };
