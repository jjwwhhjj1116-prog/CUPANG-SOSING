import { getQuotationSchema, type QuotationField, type ResolvedQuotation, type ResolvedQuotationField } from '@/app/quotation-schema';
import { compileHubQuotationSchema, validateHubSchemaSnapshot, type HubSchemaSnapshot, type HubWireField } from '@/app/supplier-hub-schema';
import { SUPPLIER_HUB_COMPANIES, type SupplierHubCompany } from '@/app/supplier-hub-company';
import { isQuotationDecimalMultiple, quotationScalarValueIssues } from '@/app/quotation-scalar-constraints';
import { quotationPackagedWeightPeer } from '@/app/quotation-packaged-weight';

export const SINGLE_PROJECTION_FORMAT = 'yoofam-supplier-hub-single-document-preview-v1';
export const SINGLE_PROJECTION_OUTPUT_LIMIT = 6 * 1024 * 1024;
export class SingleProjectionError extends Error {
  constructor(message: string, public code: string, public status = 409) { super(message); }
}
type Node = Record<string, unknown>;
type Primitive = string | number | boolean | null;
export type SingleProjectionIssue = { code: string; level: 'error' | 'review'; message: string; optionId?: string | null; fieldId?: string; path?: string[] };
export type SingleProjectionInput = { snapshot: HubSchemaSnapshot; company: SupplierHubCompany; categoryId: string; categoryPath: readonly string[]; resolved: ResolvedQuotation };
const object = (value: unknown): value is Node => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const wireKey = (wire: HubWireField) => JSON.stringify([wire.path, wire.nameKey ?? null, wire.valueKey ?? null, wire.name ?? null]);
function conflict(message: string, code: string): never { throw new SingleProjectionError(message, code); }
const numericId = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 || typeof value === 'string' && /^\d{1,20}$/.test(value);
const annotations = new Set(['$id', '$schema', 'name', 'level', 'parent', 'title', 'description', 'example', 'examples', 'requirement', 'hidden', 'prefilled', 'hint', 'metadata',
  'attributeUnit', 'attributeTypeId', 'attributeUnitEnum', 'exposed', 'mandatory', 'attributeDataType', 'attributeInputType', 'attributeUnitGroup', 'inputGuide', 'inputHint', 'bundleGroup',
  'noticeName', 'noticeCategoryId', 'noticeCategoryTemplateId']);
const scalarRules = new Set(['type', 'enum', 'dropdown', 'default', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'readOnly']);

function identity(snapshot: HubSchemaSnapshot, raw: Node) {
  const read = (keys: string[], kind: 'id' | 'scope'): string | number => {
    const values = keys.filter(key => Object.hasOwn(snapshot.metadata, key)).map(key => snapshot.metadata[key]);
    if (!values.length || values.some(value => String(value) !== String(values[0])) || (kind === 'id' ? !numericId(values[0]) : values[0] !== 'Retail_Categorized_Single'))
      return conflict('Single 양식의 분류·고시·버전·scope 식별값을 확인해주세요.', 'SINGLE_IDENTITY');
    return values[0];
  };
  const scope = read(['scopeType', 'scope'], 'scope'), kan = read(['kanCategoryId', 'categoryId'], 'id');
  const notice = read(['noticeNumber', 'productNoticeNumber'], 'id'), version = read(['version'], 'id');
  if (String(kan) === '0' || typeof raw.metadata !== 'string') conflict('Single 원문 양식의 분류 식별정보가 없습니다.', 'SINGLE_METADATA');
  const metadata = new Map<string, string>();
  for (const part of (raw.metadata as string).split(';')) {
    const colon = part.indexOf(':'), key = part.slice(0, colon);
    if (colon <= 0 || !/^\w+$/.test(key) || metadata.has(key)) conflict('Single 원문 양식의 메타데이터를 확인해주세요.', 'SINGLE_METADATA');
    metadata.set(key, part.slice(colon + 1));
  }
  if (metadata.get('scope') !== scope || metadata.get('categoryId') !== String(kan)
    || metadata.get('productNoticeCategoryId') !== String(notice) || metadata.get('version') !== String(version))
    conflict('저장한 Single 식별값과 원문 양식의 분류·고시·버전이 다릅니다.', 'SINGLE_METADATA');
  return { scope: 'Retail_Categorized_Single' as const, kan, notice, version };
}

function primitive(value: string, node: Node, explicitNull = false): { value?: Primitive; error?: string; constraint?: 'string-length' } {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return { error: '지원하지 않는 제어 문자가 저장값에 있습니다.' };
  // A type-less dropdown is the compiler's exact primitive choice control.
  // Declared string suggestions (brand/barcode) remain free-text annotations.
  const enums = node.enum ?? (node.type === undefined ? node.dropdown : undefined);
  const declared = Array.isArray(node.type) ? node.type : node.type === undefined ? [] : [node.type];
  const inferred = Array.isArray(enums) ? [...new Set(enums.map(item => item === null ? 'null' : typeof item))] : ['string'];
  const types = declared.length ? declared : inferred;
  const concrete = types.filter(type => type !== 'null');
  if (new Set(types).size !== types.length || concrete.length > 1 || types.some(type => !['string', 'number', 'integer', 'boolean', 'null'].includes(String(type))))
    return { error: '단일 자료형으로 변환할 수 없는 원문 양식입니다.' };
  let result: Primitive;
  if (Array.isArray(enums)) {
    const matches = enums.filter(item => explicitNull ? item === null : item === null ? value === '' : String(item) === value);
    if (matches.length !== 1) return { error: '원문 양식의 정확한 선택값과 일치하지 않습니다.' };
    result = matches[0] as Primitive;
  } else if (explicitNull || value === '' && !types.includes('string') && types.includes('null')) result = null;
  else if (types.includes('string')) result = value;
  else if (types.includes('boolean') && ['true', 'false'].includes(value)) result = value === 'true';
  else if (types.includes('number') || types.includes('integer')) {
    if (!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return { error: '원문 숫자 자료형을 확인해주세요.' };
    result = Number(value);
    if (!Number.isFinite(result) || result === 0 && /[1-9]/.test(value.split(/[eE]/)[0]) || types.includes('integer') && !Number.isSafeInteger(result))
      return { error: '원문 숫자 범위 또는 정수값을 확인해주세요.' };
  } else return { error: '원문 자료형에 맞는 값을 확인해주세요.' };
  if (result === null && !types.includes('null') || result !== null && !(typeof result === 'number' ? types.includes('number') || types.includes('integer') : types.includes(typeof result)))
    return { error: '선택값과 원문 자료형이 다릅니다.' };
  if (typeof result === 'string') {
    const length = Array.from(result).length;
    if (typeof node.minLength === 'number' && length < node.minLength || typeof node.maxLength === 'number' && length > node.maxLength)
      return { value: result, error: '원문 문자열 길이 제한을 확인해주세요.', constraint: 'string-length' };
  }
  if (typeof result === 'number' && (typeof node.minimum === 'number' && result < node.minimum || typeof node.maximum === 'number' && result > node.maximum
    || typeof node.exclusiveMinimum === 'number' && result <= node.exclusiveMinimum || typeof node.exclusiveMaximum === 'number' && result >= node.exclusiveMaximum
    || typeof node.multipleOf === 'number' && !isQuotationDecimalMultiple(result, node.multipleOf))) return { value: result, error: '원문 숫자 범위 제한을 확인해주세요.' };
  return { value: result };
}
function imageWire(field: QuotationField) {
  const wire = field.hubWire;
  return field.type === 'images' || Boolean(wire && (wire.path[0] === 'imagePage' && wire.path[1] === 'images'
    && (wire.path.length === 3 && ['mainImage', 'additionalImage', 'sizeChartImage'].includes(wire.path[2]) || wire.path[2] === 'labelImages')
    || JSON.stringify(wire.path) === JSON.stringify(['imagePage', 'details', 'detailedImage'])));
}

/** Clean-room, saved-value-only preview. It never creates a remote document,
 * publishes an image, fills a blank, or acknowledges a human agreement. */
export async function projectSupplierHubSingleDocument(input: SingleProjectionInput) {
  let snapshot: HubSchemaSnapshot;
  try { snapshot = validateHubSchemaSnapshot(input.snapshot, input.categoryId, input.categoryPath); }
  catch { return conflict('선택한 카테고리의 검증된 Single 원문 양식이 필요합니다.', 'SINGLE_SCHEMA'); }
  if (!SUPPLIER_HUB_COMPANIES.some(company => company.code === input.company?.code && company.name === input.company.name)
    || snapshot.company.code !== input.company.code || snapshot.company.name !== input.company.name)
    conflict('현재 회원 회사와 저장한 Single 양식 회사가 다릅니다.', 'SINGLE_COMPANY');
  const raw = JSON.parse(snapshot.schemaString) as Node, meta = identity(snapshot, raw);
  const compilation = compileHubQuotationSchema(snapshot), expected = getQuotationSchema(input.categoryId, input.categoryPath, snapshot);
  if (compilation.unsupported.length || expected.status !== 'observed') conflict('지원하지 않는 Single 양식 규칙이 있습니다. 원문 양식을 검토해주세요.', 'SINGLE_UNSUPPORTED');
  if (input.resolved.schema.categoryId !== input.categoryId || JSON.stringify(input.resolved.schema.categoryPath) !== JSON.stringify(input.categoryPath)
    || input.resolved.schema.status !== 'observed' || input.resolved.schema.unsupportedFields?.length) conflict('최종 견적값과 Single 분류·양식 연결이 다릅니다.', 'SINGLE_RESOLVED_SCHEMA');
  const expectedByWire = new Map<string, QuotationField>(), actualByWire = new Map<string, QuotationField>();
  for (const field of expected.fields.filter(field => field.hubWire)) {
    const key = wireKey(field.hubWire!); if (expectedByWire.has(key)) conflict('Single 항목 연결이 중복되었습니다.', 'SINGLE_DUPLICATE_WIRE'); expectedByWire.set(key, field);
  }
  for (const field of input.resolved.schema.fields.filter(field => field.hubWire)) {
    const key = wireKey(field.hubWire!), original = expectedByWire.get(key);
    if (actualByWire.has(key)) conflict('최종 견적서 항목 연결이 중복되었습니다.', 'SINGLE_DUPLICATE_WIRE');
    if (!original || original.id !== field.id || original.type !== field.type) conflict('최종 견적서의 원문 항목 연결을 확인해주세요.', 'SINGLE_WIRE');
    actualByWire.set(key, original);
  }
  if (actualByWire.size !== expectedByWire.size) conflict('최종 견적서의 Single 항목 연결이 누락되었습니다.', 'SINGLE_WIRE');
  const included = input.resolved.rows.filter(row => row.included);
  if (!included.length || included.length > (expected.maxIncludedOptions ?? 100) || new Set(included.map(row => row.optionId)).size !== included.length)
    conflict('Single 문서에 포함할 저장 옵션을 확인해주세요.', 'SINGLE_OPTIONS');
  const issues: SingleProjectionIssue[] = [];
  const fields: { optionId: string | null; fieldId: string; path: string[]; name?: string; source: ResolvedQuotationField['source']; savedValue: string; projected: boolean }[] = [];
  const unresolvedImages: { optionId: string | null; fieldId: string; wire?: HubWireField; savedValue: string; keys: string[] }[] = [];
  const issue = (code: string, level: 'error' | 'review', message: string, optionId?: string | null, field?: QuotationField) => issues.push({ code, level, message, ...(optionId !== undefined ? { optionId } : {}), ...(field ? { fieldId: field.id, path: [...field.hubWire?.path ?? []] } : {}) });
  const categoryPath = `${input.categoryPath.join('>').replaceAll(' ', '')} (${input.categoryId})`;
  const quotationCategory = `${input.categoryPath.join(' > ')} (${input.categoryId})`;
  const schemaKeys = (node: Node, allowed: Set<string>) => {
    if (Object.keys(node).some(key => !annotations.has(key) && !allowed.has(key))) conflict('복원하지 못한 Single 원문 규칙이 있습니다.', 'SINGLE_UNSUPPORTED');
  };
  const objectRules = new Set(['type', 'required', 'properties', 'additionalProperties']);
  const arrayRules = new Set(['type', 'allOf', 'items']);
  const imagePageSchema = object(raw.properties) ? raw.properties.imagePage : undefined;
  const nativeImagePage = snapshot.draftInitialization === 'couplus-required-v1' && object(imagePageSchema) && imagePageSchema.type === 'object'
    && object(imagePageSchema.properties) && ['images', 'details'].every(key => {
      const child = (imagePageSchema.properties as Node)[key];
      return object(child) && child.type === 'object' && object(child.properties);
    });
  const jsonDocument = included.map(row => {
    const scalar = (node: Node, wire: HubWireField, optionalObjectProperty = false): Primitive | undefined => {
      schemaKeys(node, scalarRules);
      const field = actualByWire.get(wireKey(wire));
      if (!field) return conflict('Single 원문 항목을 최종 견적값에 연결하지 못했습니다.', 'SINGLE_WIRE');
      const cell = row.fields[field.id];
      if (!cell || typeof cell.value !== 'string') { issue('VALUE_MISSING', 'error', '저장한 최종 항목값이 없습니다.', row.optionId, field); return undefined; }
      const entry = { optionId: row.optionId, fieldId: field.id, path: [...wire.path], ...(wire.name ? { name: wire.name } : {}), source: cell.source, savedValue: cell.value, projected: false };
      fields.push(entry);
      if (cell.needsReview || cell.reviewMessages?.length) issue('VALUE_REVIEW', 'review', '저장한 기본값·상품정보의 검토가 필요합니다.', row.optionId, field);
      for (const message of cell.validationIssues ?? []) issue('VALUE_INVALID', 'error', message, row.optionId, field);
      // The original initializer creates only required object properties. An
      // absent editable placeholder must not become an invalid enum selection.
      // Named arrays, saved clears, actual empty/null choices and initial values
      // are supplied values and must retain their existing validation.
      const choices = node.enum ?? (node.type === undefined ? node.dropdown : undefined);
      if (optionalObjectProperty && !field.readOnly && cell.source === 'empty' && cell.value === ''
        && field.draftDefault === undefined && field.schemaDefault === undefined && !Object.hasOwn(node, 'default')
        && !(Array.isArray(choices) && choices.some(value => value === '' || value === null))) return undefined;
      if (imageWire(field) && cell.value !== '') {
        unresolvedImages.push({ optionId: row.optionId, fieldId: field.id, wire: structuredClone(wire), savedValue: cell.value, keys: cell.value.split('\n') });
        issue('IMAGE_UNRESOLVED', 'error', '비공개 이미지 참조의 Single 업로드·공개 주소가 검증되지 않았습니다.', row.optionId, field); return undefined;
      }
      const isCategory = JSON.stringify(wire.path) === JSON.stringify(['startPage', 'categoryPath']) && wire.name === undefined;
      if (isCategory && (cell.source !== 'schema' || cell.value !== quotationCategory)) conflict('변경할 수 없는 카테고리 최종값이 원문 분류와 다릅니다.', 'SINGLE_READONLY_CATEGORY');
      // The named hidden-attribute initializer uses null. Its editable text
      // placeholder is not an explicit user-cleared string or a general nullable
      // scalar; preserve that distinction only for the exact free-text wire.
      const hiddenDefaultNull = field.section === 'product' && field.visibility === 'hidden' && ['text', 'textarea'].includes(field.type)
        && wire.path.length === 2 && wire.path[0] === 'productPage' && wire.path[1] === 'unexposedAttributes'
        && wire.name !== undefined && Boolean(wire.nameKey && wire.valueKey) && cell.source === 'couplus-default' && cell.value === ''
        && Array.isArray(node.type) && node.type.length === 2 && node.type.includes('string') && node.type.includes('null')
        && !Object.hasOwn(node, 'enum') && !Object.hasOwn(node, 'dropdown');
      // A raw null schema default has separate provenance from an explicitly
      // saved empty string. Still validate its declared type and exact enum.
      const schemaDefaultNull = cell.source === 'schema' && cell.value === '' && node.default === null;
      const value: ReturnType<typeof primitive> = hiddenDefaultNull ? { value: null } : primitive(isCategory ? categoryPath : cell.value, node, schemaDefaultNull);
      // The resolver already reports this missing required value above. Keep
      // that blocker once; optional clears, empty choices and unvalidated
      // blanks must still receive their own exact raw constraint error.
      const requiredBlankLength = field.required && cell.value === '' && value.value === '' && value.constraint === 'string-length'
        && cell.validationIssues?.includes('필수 값이 비어 있습니다.');
      if (value.error && !requiredBlankLength) issue('TYPE_OR_CONSTRAINT', 'error', value.error, row.optionId, field);
      if (JSON.stringify(wire.path) === JSON.stringify(['imagePage', 'details', 'htmlProductDetailContent']) && cell.value)
        issue('DETAIL_HTML_UNVERIFIED', 'review', '저장한 HTML과 이미지 공개 주소는 별도 검증이 필요합니다.', row.optionId, field);
      if (wire.path[0] === 'imagePage' && ['msrpAgree', 'labelContactAgreed'].includes(wire.path.at(-1) ?? ''))
        issue('AGREEMENT_UNCONFIRMED', 'review', '양식에 저장된 동의값은 사용자의 제출 시 동의 확인을 대신하지 않습니다.', row.optionId, field);
      entry.projected = value.value !== undefined;
      return value.value;
    };
    const visit = (node: unknown, path: string[], optionalObjectProperty = false): unknown => {
      if (!object(node)) return conflict('Single 원문 항목 구조를 확인해주세요.', 'SINGLE_UNSUPPORTED');
      if (object(node.properties)) {
        schemaKeys(node, objectRules);
        const result: Node = {};
        for (const [name, child] of Object.entries(node.properties)) {
          if (path.length === 1 && path[0] === 'sourcingPage') {
            if (!['sourcingChannelType', 'sourcingChannelId'].includes(name) || !object(child) || child.hidden !== true
              || !Array.isArray(child.type) || child.type.length !== 2 || !child.type.includes('string') || !child.type.includes('null'))
              return conflict('숨김 소싱 항목의 정확한 초기 구조를 확인해주세요.', 'SINGLE_UNSUPPORTED');
            result[name] = null;
          } else {
            const value = visit(child, [...path, name], !Array.isArray(node.required) || !node.required.includes(name)); if (value !== undefined) result[name] = value;
          }
        }
        return result;
      }
      if (node.type === 'array' && Array.isArray(node.allOf)) {
        schemaKeys(node, arrayRules);
        return node.allOf.map(entry => {
          if (!object(entry) || Object.keys(entry).some(key => key !== 'contains') || !object(entry.contains) || !object(entry.contains.properties))
            return conflict('Single 이름 배열의 정확한 원문 구조를 확인해주세요.', 'SINGLE_UNSUPPORTED');
          schemaKeys(entry.contains, objectRules);
          const properties = entry.contains.properties, candidates = [...actualByWire.values()].filter(field => {
            const wire = field.hubWire!;
            const nameNode = wire.nameKey ? properties[wire.nameKey] : null;
            return JSON.stringify(wire.path) === JSON.stringify(path) && wire.nameKey && wire.valueKey && Object.keys(properties).length === 2
              && object(nameNode) && Array.isArray(nameNode.enum) && nameNode.enum.length === 1
              && nameNode.enum[0] === wire.name && object(properties[wire.valueKey]);
          });
          if (candidates.length !== 1) return conflict('Single 배열 항목의 이름·값 연결이 모호합니다.', 'SINGLE_DUPLICATE_WIRE');
          const wire = candidates[0].hubWire!, result: Node = { [wire.nameKey!]: wire.name };
          schemaKeys(properties[wire.nameKey!] as Node, scalarRules);
          const nameValue = primitive(wire.name!, properties[wire.nameKey!] as Node);
          if (nameValue.error || nameValue.value !== wire.name) return conflict('Single 배열의 이름 선택값과 자료형이 다릅니다.', 'SINGLE_UNSUPPORTED');
          const value = scalar(properties[wire.valueKey!] as Node, wire); if (value !== undefined) result[wire.valueKey!] = value;
          return result;
        });
      }
      return scalar(node, { path }, optionalObjectProperty);
    };
    const document = visit(raw, []) as Node;
    // The recorded native initializer adds these transport controls even when
    // the category JSON schema omits them. They are not fabricated schema
    // fields or human consent: only the action-time stage review may set true.
    if (nativeImagePage) {
      if (!object(document.imagePage)) conflict('Single 이미지 페이지의 기본 문서 구조를 확인해주세요.', 'SINGLE_NATIVE_AGREEMENT');
      const image = document.imagePage as Node, properties = (imagePageSchema as Node).properties as Node;
      for (const key of ['msrpAgree', 'labelContactAgreed']) {
        if (Object.hasOwn(properties, key)) {
          if (!object(properties[key]) || properties[key].type !== 'boolean') conflict('Single 동의 항목의 원문 불리언 형식을 확인해주세요.', 'SINGLE_NATIVE_AGREEMENT');
          continue;
        }
        image[key] = false;
        issues.push({ code: 'AGREEMENT_UNCONFIRMED', level: 'review', message: '제출 단계의 정확한 약관을 확인한 뒤 직접 동의해야 합니다.', optionId: row.optionId, path: ['imagePage', key] });
      }
    }
    for (const field of input.resolved.schema.fields.filter(field => !field.hubWire)) {
      const cell = row.fields[field.id];
      if (!cell || !cell.value && !['manual-common', 'manual-option'].includes(cell.source)) continue;
      fields.push({ optionId: row.optionId, fieldId: field.id, path: [], source: cell.source, savedValue: cell.value, projected: false });
      // The saved legacy g input has an exact native string-wire peer. Keep
      // its record, but do not call it unbound after that same option's equal,
      // valid value was actually projected. Conflicts and blanks stay visible.
      const weightPeer = field.id === 'packagedWeightG' ? quotationPackagedWeightPeer(expected.fields, field.id) : null;
      const peerField = weightPeer ? input.resolved.schema.fields.find(item => item.id === weightPeer) : undefined;
      const peerCell = weightPeer ? row.fields[weightPeer] : undefined;
      if (weightPeer && quotationPackagedWeightPeer(input.resolved.schema.fields, field.id) === weightPeer && peerField && peerCell
        && cell.value !== '' && cell.value === peerCell.value && !cell.validationIssues?.length && !peerCell.validationIssues?.length
        && !quotationScalarValueIssues(field, cell.value).length && !quotationScalarValueIssues(peerField, peerCell.value).length
        && fields.some(entry => entry.optionId === row.optionId && entry.fieldId === weightPeer && entry.projected)
        && !issues.some(item => item.optionId === row.optionId && item.fieldId === weightPeer && item.level === 'error')) continue;
      issue('UNBOUND_SAVED_FIELD', field.required ? 'error' : 'review', '이 저장값에는 확인된 Single 원문 항목 연결이 없습니다.', row.optionId, field);
      if (field.type === 'images' && cell.value) {
        unresolvedImages.push({ optionId: row.optionId, fieldId: field.id, savedValue: cell.value, keys: cell.value.split('\n') });
        issue('IMAGE_UNRESOLVED', 'error', '이 이미지 역할의 Single 원문 연결이 없습니다.', row.optionId, field);
      }
    }
    return document;
  });
  for (const message of input.resolved.validationIssues ?? []) issue('QUOTATION_INVALID', 'error', message);
  for (const message of input.resolved.reviewMessages ?? []) issue('QUOTATION_REVIEW', 'review', message);
  const firstStart = jsonDocument[0].startPage as Node | undefined;
  const schemaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot.schemaString))), byte => byte.toString(16).padStart(2, '0')).join('');
  const result = { format: SINGLE_PROJECTION_FORMAT, registered: false as const, remoteWrites: false as const, submissionReady: false as const,
    humanAgreementsConfirmed: false as const, company: { ...input.company }, schemaSha256,
    payload: { docId: null, productName: typeof firstStart?.productName === 'string' ? firstStart.productName : '', categoryPath, categoryId: meta.kan,
      displayCategoryCode: input.categoryId, jsonDocument, scope: meta.scope, productNoticeNumber: meta.notice, version: meta.version },
    review: { documentShapeComplete: !issues.some(item => item.level === 'error'), issues, fields, unresolvedImages,
      notice: '저장한 최종값으로 만든 내부 검토용 Single 문서입니다. 이미지 공개·동의 확인·Supplier Hub 문서 생성·등록 전송은 실행하지 않았습니다.' } };
  if (new TextEncoder().encode(JSON.stringify(result)).length > SINGLE_PROJECTION_OUTPUT_LIMIT) throw new SingleProjectionError('Single 검토 문서가 6MB를 초과했습니다. 포함 옵션이나 저장 내용을 줄여주세요.', 'SINGLE_SIZE', 413);
  return result;
}
