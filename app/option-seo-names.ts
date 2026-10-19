import { OPTION_LIMIT, type BundleSource, type ProductOptions } from '@/app/product-options';

export type OptionNameChange = { optionId: string; value: string };
export function validateOptionNamesInput(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('옵션명 요청을 확인해주세요.');
  const body = input as Record<string,unknown>;
  if (Object.keys(body).sort().join(',') !== 'changes,expectedProductVersion,expectedRevision'
    || !Number.isSafeInteger(body.expectedRevision) || (body.expectedRevision as number)<0
    || typeof body.expectedProductVersion !== 'string' || !Number.isFinite(Date.parse(body.expectedProductVersion))
    || !Array.isArray(body.changes) || !body.changes.length || body.changes.length>OPTION_LIMIT) throw Error('옵션명·저장 버전을 확인해주세요.');
  const ids = new Set<string>();
  const changes = body.changes.map((value):OptionNameChange=>{
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',')!=='optionId,value'
      || typeof value.optionId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(value.optionId) || ids.has(value.optionId)
      || typeof value.value !== 'string' || value.value.length>500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value.value))
      throw Error('각 옵션의 한국어 이름을 500자 이내로 입력해주세요.');
    ids.add(value.optionId);return {optionId:value.optionId,value:value.value};
  });
  return {expectedRevision:body.expectedRevision as number,expectedProductVersion:body.expectedProductVersion,changes};
}
function nameBundleSources(current: ProductOptions): Record<string, BundleSource> {
  const sources = current.bundleSources;
  if (sources === undefined) return {};
  const invalid = () => { throw Error('번들 원본 연결을 확인한 뒤 옵션명을 저장해주세요.'); };
  if (!sources || typeof sources !== 'object' || Array.isArray(sources) || Object.keys(sources).length > 999) return invalid();
  const validId = (value: string) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  const pairs = new Set<string>();
  for (const [child, source] of Object.entries(sources)) {
    if (!validId(child) || !source || typeof source !== 'object' || Array.isArray(source)
      || Object.keys(source).sort().join(',') !== 'quantity,sourceOptionId' || !validId(source.sourceOptionId) || child === source.sourceOptionId
      || !Number.isInteger(source.quantity) || source.quantity < 2 || source.quantity > 1e6) return invalid();
    const pair = `${source.sourceOptionId}:${source.quantity}`;
    if (pairs.has(pair)) return invalid();
    pairs.add(pair);
    const visited = new Set([child]); let cursor = source.sourceOptionId;
    while (Object.hasOwn(sources, cursor)) {
      if (visited.has(cursor) || visited.size >= 32) return invalid();
      if (!sources[cursor] || typeof sources[cursor] !== 'object' || !validId(sources[cursor].sourceOptionId)) return invalid();
      visited.add(cursor); cursor = sources[cursor].sourceOptionId;
    }
  }
  return sources;
}

/** An explicit changed parent name restores its direct bundle names, as the
 * recorded SEO writer does. Its nonempty parent wins even over a child name
 * entered in the same request; child-only edits and deliberate blanks survive.
 * Creation lineage identifies the parent, while the current selling quantity
 * controls the suffix. Never rewrite cost, packaging, images or row order. */
export function applyOptionNameChanges(current:ProductOptions,changes:readonly OptionNameChange[],now:string):ProductOptions {
  const values=new Map(changes.map(change=>[change.optionId,change.value]));
  if(values.size!==changes.length||changes.some(change=>current.rows.filter(row=>row.id===change.optionId).length!==1))throw Error('선택한 옵션이 현재 저장본에 없거나 연결이 모호합니다.');
  const parents = new Map(changes.filter(change => change.value && current.rows.find(row => row.id === change.optionId)!.translatedName !== change.value)
    .map(change => [change.optionId, change.value]));
  if (parents.size) for (const [childId, source] of Object.entries(nameBundleSources(current))) {
    const parentName = parents.get(source.sourceOptionId);
    if (parentName === undefined) continue;
    const children = current.rows.filter(row => row.id === childId);
    if (!children.length) continue; // Append-only lineage can outlive removed rows.
    if (children.length !== 1) throw Error('번들 옵션 이름의 연결이 모호합니다. 저장본을 확인해주세요.');
    const quantity = children[0].unitsPerPack;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1e6) throw Error('번들의 현재 구성 수량을 확인한 뒤 옵션명을 저장해주세요.');
    if (quantity < 2) continue;
    const name = `${parentName.replace(/\s*\(\d+개묶음\)\s*$/u, '')} (${quantity}개묶음)`;
    if (name.length > 500) throw Error('번들 표시를 포함한 옵션 한글명은 500자 이하여야 합니다. 부모 옵션명을 줄여주세요.');
    // Read only the original explicit parent map, never a derived child value:
    // nested bundles are not implicitly renamed through an extra cascade.
    values.set(childId, name);
  }
  return {...current,revision:current.revision+1,updatedAt:now,rows:current.rows.map(row=>values.has(row.id)
    ? {...row,translatedName:values.get(row.id)!,provenance:{...row.provenance,translatedName:'manual'},updatedAt:now}
    : row)};
}
