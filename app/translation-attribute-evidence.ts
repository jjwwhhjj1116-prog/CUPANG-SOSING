/** A copied CJK source is still untranslated, including a Korean prefix or
 * an unchanged mixed-language value. Korean, codes and units keep their
 * normal literal contract; short proper names may accompany Korean. */
export function untranslatedChineseTranslation(original:string,translated:string):boolean {
  if(!/\p{Script=Han}/u.test(original))return false;
  const compact=(value:string)=>value.replace(/[\s\p{P}\p{S}]/gu,'');
  const source=compact(original),value=compact(translated);
  return source===value || /\p{Script=Han}/u.test(translated)&&!/[가-힣]/u.test(translated)
    || !/[가-힣]/u.test(original)&&(original.match(/\p{Script=Han}/gu)?.length??0)>=4&&value.includes(source);
}

// Preserve the deployed extraction contract for decimals and code literals.
export const translationNumbers=(value:string)=>value.match(/\d+(?:[.,]\d+)*/g)??[];

/** A source index binds both name and value. Numbers from another source
 * attribute, title or description cannot substantiate this attribute. */
export function translationAttributeIssue(source:{name:string;value:string}|undefined,translated:{name:string;value:string}):'invalid-source'|'chinese-copy'|'foreign-number'|null {
  if(!source)return 'invalid-source';
  if(untranslatedChineseTranslation(source.value,translated.value)
    || untranslatedChineseTranslation(source.name.replace(/^상품속성: /u,''),translated.name.replace(/^상품속성: /u,'')))return 'chinese-copy';
  const numbers=new Set(translationNumbers(`${source.name} ${source.value}`));
  return translationNumbers(`${translated.name} ${translated.value}`).some(number=>!numbers.has(number))?'foreign-number':null;
}
