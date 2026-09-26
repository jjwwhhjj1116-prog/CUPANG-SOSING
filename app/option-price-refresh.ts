import { optionInputs, optionFieldNames, type OptionField, type OptionInput, type ProductOptionsResponse } from '@/app/product-options';

/** Merge only disjoint field edits; never infer how structural conflicts should resolve. */
export function mergeOptionDraft(base: ProductOptionsResponse, latest: ProductOptionsResponse, draft: readonly OptionInput[]) {
  if (base.options.productId !== latest.options.productId) throw new Error('다른 상품의 옵션을 적용할 수 없습니다.');
  if (!Number.isFinite(Date.parse(latest.productVersion)) || Date.parse(latest.productVersion) < Date.parse(base.productVersion)
    || latest.options.revision < base.options.revision) throw new Error('최신 상품 버전을 확인하지 못했습니다.');
  const before = optionInputs(base.options), after = optionInputs(latest.options);
  if (JSON.stringify(before.map(row=>row.id)) !== JSON.stringify(after.map(row=>row.id)))
    throw new Error('서버에서 옵션 추가·삭제·순서가 변경되었습니다. 현재 입력은 유지했습니다. 저장본과 비교해주세요.');
  if (base.options.revision === latest.options.revision && JSON.stringify(before) !== JSON.stringify(after))
    throw new Error('서버의 옵션 버전과 내용이 일치하지 않습니다. 다시 불러와주세요.');
  const fields = Object.keys(optionFieldNames) as OptionField[];
  for (let index = 0; index < before.length; index++) {
    if (!draft.some(row=>row.id===before[index].id) && fields.some(key=>!Object.is(before[index][key],after[index][key])))
      throw new Error(`삭제한 옵션 ${before[index].id}이 서버에서 수정되었습니다. 입력을 유지했습니다.`);
  }
  const rows = draft.map(row=>{
    const index = before.findIndex(item=>item.id===row.id);
    if(index<0)return {...row};
    const merged = {...row};
    for(const key of fields){
      const remoteChanged = !Object.is(before[index][key],after[index][key]);
      const localChanged = !Object.is(before[index][key],row[key]);
      if(remoteChanged && localChanged && !Object.is(row[key],after[index][key]))
        throw new Error(`옵션 ${row.id} · ${optionFieldNames[key]}이 양쪽에서 변경되었습니다. 현재 입력은 유지했습니다.`);
      if(remoteChanged && !localChanged)Object.assign(merged,{[key]:after[index][key]});
    }
    return merged;
  });
  return {saved:latest,rows};
}

// A product version can change without changing its options (for example pricing).
// Only advance the editing base when the server options are exactly unchanged.
export function refreshOptionPriceBase(base: ProductOptionsResponse, latest: ProductOptionsResponse, draft: readonly OptionInput[]) {
  if (base.options.productId !== latest.options.productId) throw new Error('다른 상품의 옵션을 적용할 수 없습니다.');
  if (base.options.revision !== latest.options.revision || JSON.stringify(optionInputs(base.options)) !== JSON.stringify(optionInputs(latest.options))) {
    throw new Error('서버의 옵션도 변경되었습니다. 현재 입력은 유지했습니다. 저장본과 비교한 뒤 다시 편집해주세요.');
  }
  if (!Number.isFinite(Date.parse(latest.productVersion)) || Date.parse(latest.productVersion) < Date.parse(base.productVersion)) {
    throw new Error('최신 상품 버전을 확인하지 못했습니다. 다시 확인해주세요.');
  }
  return { saved: latest, rows: draft.map(row => ({ ...row })) };
}
