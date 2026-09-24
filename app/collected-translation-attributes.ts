/** Namespace seller attribute names so they cannot impersonate editable option bindings. */
export function collectedTranslationAttributes(attributes: readonly { name: string; value: string }[]) {
  if (attributes.length > 50) throw new Error('상품 속성 원문은 최대 50개입니다.');
  return attributes.map(pair => {
    if (typeof pair.name !== 'string' || !pair.name.trim() || pair.name.length > 190 || typeof pair.value !== 'string' || !pair.value.trim() || pair.value.length > 1000) throw new Error('상품 속성 원문을 확인해주세요.');
    return { name: `상품속성: ${pair.name}`, value: pair.value };
  });
}
