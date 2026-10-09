import { OPTION_LIMIT, type ProductOptions } from '@/app/product-options';

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
/** A name edit never rewrites cost, packaging, images, order or another field's provenance. */
export function applyOptionNameChanges(current:ProductOptions,changes:readonly OptionNameChange[],now:string):ProductOptions {
  const values=new Map(changes.map(change=>[change.optionId,change.value]));
  if(values.size!==changes.length||changes.some(change=>current.rows.filter(row=>row.id===change.optionId).length!==1))throw Error('선택한 옵션이 현재 저장본에 없거나 연결이 모호합니다.');
  return {...current,revision:current.revision+1,updatedAt:now,rows:current.rows.map(row=>values.has(row.id)
    ? {...row,translatedName:values.get(row.id)!,provenance:{...row.provenance,translatedName:'manual'},updatedAt:now}
    : row)};
}
