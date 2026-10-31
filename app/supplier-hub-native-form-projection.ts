/** The observed Hub form round trip, opt-in for newly captured schemas only.
 * This is a deterministic subset of requiredOnly + Uf + the native model. It
 * never guesses a faker choice or silently discards a meaningful false/zero. */
export const NATIVE_FORM_SERIALIZATION_POLICY = 'supplier-hub-native-required-form-v1' as const;
type Node = Record<string, unknown>;
const object = (value: unknown): value is Node => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const clone = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function fail(): never { throw Error('공식 등록 폼의 저장 구조를 정확히 결정할 수 없습니다. 저장한 견적값과 원문은 변경하지 않았습니다.'); }
const safeKey = (key: string) => /^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key) && !['__proto__', 'prototype', 'constructor'].includes(key);
function supported(schema: Node) {
  if (['$ref', '$defs', 'definitions', 'oneOf', 'anyOf', 'if', 'then', 'else', 'not', 'const', 'dependentRequired', 'dependencies', 'patternProperties', 'propertyNames', 'prefixItems', 'additionalItems', 'uniqueItems', 'minItems', 'maxItems'].some(key => Object.hasOwn(schema, key))
    || Object.hasOwn(schema, 'allOf') && schema.type !== 'array') fail();
}
const pick = (value: Node, keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, clone(value[key])]));
function merge(base: unknown, value: unknown): unknown {
  if (!object(base) || !object(value)) return clone(value);
  const out = clone(base);
  for (const [key, item] of Object.entries(value)) { if (!safeKey(key)) fail(); out[key] = object(item) && object(out[key]) ? merge(out[key], item) : clone(item); }
  return out;
}
function scalarSeed(schema: Node): unknown {
  supported(schema);
  const examples = schema.examples;
  if (examples !== undefined && (!Array.isArray(examples) || examples.length !== 1)) fail();
  if (examples === undefined && Object.hasOwn(schema, 'default')) fail();
  const candidates = [...(Array.isArray(examples) ? examples : []), ...(Object.hasOwn(schema, 'default') ? [schema.default] : [])];
  if (candidates.length) { if (candidates.some(value => !same(value, candidates[0])) || candidates.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) fail(); return clone(candidates[0]); }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length !== 1) fail();
  if (types[0] === 'string') return '';
  if (types[0] === 'null') return null;
  // A generated numeric/boolean value could survive Uf in one of its groups.
  // There is no deterministic fallback for an unrecorded random selection.
  fail();
}
function clearedScalar(schema: Node, seed: unknown, group: boolean, named: boolean): unknown {
  if (typeof seed === 'string') {
    if (group) return ' ';
    const choices = named ? schema.enum : schema.dropdown;
    if (choices === undefined || Array.isArray(choices) && choices.length === 0) return '';
    if (!Array.isArray(choices) || choices.some(value => value !== null && !['string', 'number', 'boolean'].includes(typeof value))) fail();
    return choices.includes(null) ? null : clone(choices[0]);
  }
  return group && (typeof seed === 'number' || typeof seed === 'boolean') ? seed : null;
}
type NamedRows = {nameKey: string; valueKey: string; name: string; fallback: unknown}[];
function namedRows(schema: Node): NamedRows {
  supported(schema);
  if (!Array.isArray(schema.allOf) || schema.allOf.length > 400 || Object.hasOwn(schema, 'default')) fail();
  if (!Array.isArray(schema.examples) || schema.examples.length !== 1 || !Array.isArray(schema.examples[0])) fail();
  const examples = Array.isArray(schema.examples) ? schema.examples[0] as unknown[] : null;
  if (examples && examples.length !== schema.allOf.length) fail();
  const names = new Set<string>();
  return schema.allOf.map((entry, index) => {
    if (!object(entry) || !object(entry.contains) || !object(entry.contains.properties)) return fail();
    const properties = entry.contains.properties, keys = Object.keys(properties);
    if (keys.length !== 2 || keys.some(key => !safeKey(key))) return fail();
    const [nameKey, valueKey] = keys, nameNode = properties[nameKey], valueNode = properties[valueKey];
    if (!object(nameNode) || !Array.isArray(nameNode.enum) || nameNode.enum.length !== 1 || typeof nameNode.enum[0] !== 'string' || !object(valueNode)) return fail();
    supported(nameNode); supported(valueNode);
    const name = nameNode.enum[0]; if (names.has(name)) return fail(); names.add(name);
    const sample = examples?.[index];
    if (examples && (!object(sample) || Object.keys(sample).length !== 2 || sample[nameKey] !== name || !Object.hasOwn(sample, valueKey))) return fail();
    const seed = object(sample) ? sample[valueKey] : scalarSeed(valueNode);
    if (seed !== null && !['string', 'number', 'boolean'].includes(typeof seed)) return fail();
    return {nameKey, valueKey, name, fallback: clearedScalar(valueNode, seed, false, true)};
  });
}
function template(schema: Node, parent = '', depth = 0, scalarGroup = false): unknown {
  supported(schema);
  if (depth > 10) fail();
  if (object(schema.properties)) {
    if (Object.hasOwn(schema, 'default') || Object.hasOwn(schema, 'examples')) fail();
    const required = schema.required ?? [];
    if (!Array.isArray(required) || required.length > 400 || required.some(key => typeof key !== 'string' || !safeKey(key) || !Object.hasOwn(schema.properties as Node, key)) || new Set(required).size !== required.length) fail();
    return Object.fromEntries(required.map(key => {
      const child = (schema.properties as Node)[key as string]; if (!object(child)) return fail();
      return [key, template(child, key as string, depth + 1, ['commonAttributes', 'images', 'details'].includes(parent))];
    }));
  }
  if (schema.type === 'array') return namedRows(schema).map(row => ({[row.nameKey]: row.name, [row.valueKey]: row.fallback}));
  return clearedScalar(schema, scalarSeed(schema), scalarGroup, false);
}
function sortedRows(schema: Node, actual: unknown, exposed = false): unknown[] {
  if (!Array.isArray(actual)) fail();
  const rows = namedRows(schema); if (rows.length !== actual.length) fail();
  return rows.map(row => {
    const matches = actual.filter(item => object(item) && Object.values(item).includes(row.name));
    if (matches.length !== 1 || !object(matches[0]) || Object.keys(matches[0]).length !== 2 || matches[0][row.nameKey] !== row.name || !Object.hasOwn(matches[0], row.valueKey)) return fail();
    const value = matches[0][row.valueKey]; if (value === false || value === 0) return fail();
    return {[row.nameKey]: row.name, [row.valueKey]: value || (!exposed && row.fallback === null ? null : '')};
  });
}
const nodeAt = (schema: Node, path: string[]): Node => {
  let node: unknown = schema;
  for (const key of path) { if (!object(node) || !object(node.properties) || !object(node.properties[key])) return fail(); node = node.properties[key]; }
  return object(node) ? node : fail();
};
export function projectNativeRequiredForm(schema: Node, payload: Node): Node {
  const model = template(schema); if (!object(model) || !Array.isArray(payload.jsonDocument) || !payload.jsonDocument.length || payload.jsonDocument.length > 200) fail();
  const members = payload.jsonDocument; if (members.some(member => !object(member))) fail();
  const first = members[0] as Node, shared: Node = {};
  for (const [page, value] of Object.entries(first)) {
    if (!safeKey(page) || !object(value) || !object(model[page])) fail();
    shared[page] = pick(value, Object.keys(model[page]));
  }
  const product = shared.productPage, image = shared.imagePage;
  if (!object(product) || !object(image) || !object(model.productPage) || !object(model.productPage.commonAttributes) || !object(model.imagePage) || !object(model.imagePage.images) || !object(model.imagePage.details)) fail();
  for (const [page, key] of [['productPage', 'unexposedAttributes'], ['legalPage', 'certificates'], ['legalPage', 'notices']]) {
    const value = shared[page];
    if (object(value) && Object.hasOwn(value, key)) value[key] = sortedRows(nodeAt(schema, [page, key]), value[key]);
  }
  const documents = members.map((member, index) => {
    if (!object(member) || !object(member.productPage) || !object(member.productPage.commonAttributes) || !object(member.imagePage) || !object(member.imagePage.images) || !object(member.imagePage.details)) return fail();
    // Native form shares every other page/input from the first member. Reject
    // a meaningful per-option divergence rather than overwrite it silently.
    for (const [page, value] of Object.entries(shared)) {
      if (!object(value) || !object(member[page])) return fail();
      const ignored = page === 'productPage' ? ['commonAttributes'] : page === 'imagePage' ? ['images', 'details'] : page === 'sourcingPage' ? ['sourcingChannelId', 'sourcingChannelType'] : [];
      if (Object.keys(value).some(key => !ignored.includes(key) && !same((first[page] as Node)[key], (member[page] as Node)[key]))) return fail();
    }
    const doc = merge(model, shared) as Node, common: Node = {}, wantedCommon = member.productPage.commonAttributes;
    for (const key of Object.keys((model.productPage as Node).commonAttributes as Node)) {
      const value = wantedCommon[key];
      if (key === 'exposedAttributes') { common[key] = sortedRows(nodeAt(schema, ['productPage', 'commonAttributes', key]), value, true); continue; }
      if (value === false || value === 0) return fail();
      const field = nodeAt(schema, ['productPage', 'commonAttributes', key]);
      const nullable = Array.isArray(field.type) && field.type.includes('null');
      const numeric = ['purchasePrice', 'coupangSalePrice', 'msrp', 'osrp'].includes(key) || (Array.isArray(field.type) ? field.type.some(type => type === 'number' || type === 'integer') : field.type === 'number' || field.type === 'integer');
      common[key] = numeric && nullable && (value === null || value === '') ? null : typeof value === 'string' ? value.trim() : value || '';
    }
    (doc.productPage as Node).commonAttributes = merge((model.productPage as Node).commonAttributes, common);
    const images: Node = {};
    for (const key of ['mainImage', 'additionalImage', 'sizeChartImage']) if (Object.hasOwn(member.imagePage.images, key)) {
      const value = member.imagePage.images[key]; if (value === false || value === 0 || value !== null && typeof value !== 'string') return fail(); images[key] = typeof value === 'string' ? value.trim() : value || null;
    }
    const imageSchema = nodeAt(schema, ['imagePage', 'images']);
    if (object(imageSchema.properties) && Object.hasOwn(imageSchema.properties, 'sizeChartImage') && (images.sizeChartImage === undefined || images.sizeChartImage === null)) images.sizeChartImage = '';
    if (object(imageSchema.properties) && object(imageSchema.properties.labelImages)) {
      const labels = namedRows(imageSchema.properties.labelImages), actual = member.imagePage.images.labelImages;
      if (!Array.isArray(actual) || actual.length !== labels.length) return fail();
      images.labelImages = labels.map(row => { const hits = actual.filter(item => object(item) && item[row.nameKey] === row.name); if (hits.length !== 1 || !object(hits[0]) || hits[0][row.valueKey] !== undefined && typeof hits[0][row.valueKey] !== 'string') return fail(); return {[row.nameKey]: row.name, [row.valueKey]: hits[0][row.valueKey] || ''}; });
    }
    const details: Node = {};
    for (const [key, value] of Object.entries(member.imagePage.details)) { if (!safeKey(key) || value !== null && typeof value !== 'string') return fail(); details[key] = typeof value === 'string' ? value.trim() || null : null; }
    (doc.imagePage as Node).images = merge((model.imagePage as Node).images, images);
    (doc.imagePage as Node).details = merge((model.imagePage as Node).details, details);
    // Preserve the exact saved boolean in the reviewed original. The separate
    // prepared-body hash defers these flags to false; only the action-time
    // challenge can confirm human agreement. A stored true is not consent.
    for (const key of ['msrpAgree', 'labelContactAgreed']) {
      if (typeof member.imagePage[key] !== 'boolean' || member.imagePage[key] !== (first.imagePage as Node)[key]) return fail();
      (doc.imagePage as Node)[key] = member.imagePage[key];
    }
    if (index > 0) doc.sourcingPage = {sourcingChannelId: '', sourcingChannelType: ''};
    return doc;
  });
  return {...clone(payload), jsonDocument: documents};
}
