import {translateGoogleFree,type GoogleFreeTranslationFailure} from '@/app/automation/google-free-translation';
import {QUOTATION_TAG_ITEM_LIMIT,QUOTATION_TAG_TOTAL_LIMIT} from '@/app/quotation-keywords';
import type {TranslationDraft,TranslationSource} from '@/app/automation/translation';
import {translationAttributeIssue,untranslatedChineseTranslation} from '@/app/translation-attribute-evidence';

const hasHan=(text:string)=>/\p{Script=Han}/u.test(text);
const retainedLiteral=(text:string)=>!hasHan(text)&&(/[가-힣]/u.test(text)||/^(?:[A-Z]{1,6}\d*|\d+(?:[.,]\d+)*(?:\s*(?:cm|mm|kg|g|m|ml|L|%))?)$/u.test(text));
const optionBinding=(name:string)=>/^option(?:-(?:color|size))?:[A-Za-z0-9_-]{1,80}$/u.test(name);

/** Direct text translation preserves source indexes and option IDs. It does
 * not send a prompt or ask the service to invent listing facts. */
export async function buildGoogleTranslationDraft(source:TranslationSource,fetcher:typeof fetch=fetch){
  const title=source.title.trim(),description=source.description.trim();
  const fields=source.attributes.map(pair=>({name:pair.name.replace(/^상품속성: /u,'').trim(),value:pair.value.trim(),bound:optionBinding(pair.name)}));
  const originals=[title,description,...fields.filter(pair=>pair.bound).map(pair=>pair.value),...fields.filter(pair=>!pair.bound).flatMap(pair=>[pair.name,pair.value])];
  const unique=[...new Set(originals.filter(Boolean))],translated=new Map<string,string>();
  const languages=new Set<string>();
  const failures=new Map<string,GoogleFreeTranslationFailure>();
  let requests=0,cursor=0,consecutiveFailures=0;
  const pending=unique.filter(text=>{if(retainedLiteral(text)){translated.set(text,text);return false;}return true;});
  // Stay within Workers Free's subrequest budget. Missing entries are returned
  // as partial coverage, never copied into a completed translation.
  const translateOne=async(original:string)=>{
    if(original.length>5000)return false;
    requests++;
    const result=await translateGoogleFree(original,{fetcher,onFailure:failure=>failures.set(original,failure)});
    if(!result||!result.translatedText.trim())return false;
    const value=result.translatedText.trim();
    if(untranslatedChineseTranslation(original,value))return false;
    if(hasHan(original)&&!/[가-힣]/u.test(value))return false;
    translated.set(original,value);
    if(result.detectedSourceLanguage)languages.add(result.detectedSourceLanguage);
    return true;
  };
  // Check the essential product name first. A blocked service must not cause
  // dozens of follow-on requests or a draft which silently keeps a Chinese name.
  if(title&&!translated.has(title)&&!await translateOne(title))return {draft:{title:'',description:'',keywords:[],attributes:[],warnings:[]},requests,detectedSourceLanguages:[...languages],failure:failures.get(title)??null};
  const limited=pending.filter(text=>text!==title).slice(0,49-requests);
  await Promise.all(Array.from({length:Math.min(3,limited.length)},async()=>{
    for(;;){const index=cursor++;if(index>=limited.length||consecutiveFailures>=3)return;const original=limited[index];
      if(await translateOne(original))consecutiveFailures=0;else consecutiveFailures++;
    }
  }));
  const translatedTitle=translated.get(title)??'',translatedDescription=description?translated.get(description)??'':'';
  // Search terms come only from the translated title; seller guidance is not
  // additional evidence and cannot introduce claims or category attributes.
  const keywords:string[]=[];
  for(const token of translatedTitle.split(/[\s,，、;；]+/u).filter(Boolean)){
    if(token.length>QUOTATION_TAG_ITEM_LIMIT||keywords.includes(token)||/[\r\n]/u.test(token))continue;
    if([...keywords,token].join(', ').length>QUOTATION_TAG_TOTAL_LIMIT||keywords.length>=30)break;
    keywords.push(token);
  }
  const attributes:TranslationDraft['attributes']=[];
  let foreignNumbers=0;
  fields.forEach((pair,sourceIndex)=>{
    const name=pair.bound?source.attributes[sourceIndex].name:translated.get(pair.name),value=translated.get(pair.value);
    if(name&&name.length<=200&&value&&value.length<=2000){
      const attribute={sourceIndex,name,value},issue=translationAttributeIssue(source.attributes[sourceIndex],attribute);
      if(issue==='foreign-number')foreignNumbers++;
      if(!issue)attributes.push(attribute);
    }
  });
  const warnings=['Google 텍스트 번역 초안입니다. 판매자가 기재한 재질·인증·성능과 상품명·옵션 의미를 확인하고 수정해주세요.'];
  if(foreignNumbers)warnings.push(`같은 상품 속성·옵션 원문에 없는 숫자를 반환한 ${foreignNumbers}개는 적용하지 않고 원문에 보존했습니다.`);
  if(description&&!translatedDescription)warnings.push('상품 설명 번역을 받지 못했습니다. 원문은 유지했으며 설명 초안을 비워 두었습니다.');
  if(pending.filter(text=>text!==title).length>limited.length)warnings.push('한 번의 번역 요청 묶음 한도를 넘은 텍스트는 원문에 보존했습니다. 자동으로 추가 요청하지 않았습니다.');
  if(consecutiveFailures>=3)warnings.push('연속된 번역 응답 실패로 남은 요청을 중단했습니다. 실패한 항목은 원문에 보존했습니다.');
  const failedStatuses=[...new Set([...failures.values()].map(failure=>failure.status).filter((status):status is number=>typeof status==='number'))];
  if(failedStatuses.length)warnings.push(`일부 텍스트의 Google 번역 HTTP 응답: ${failedStatuses.join(', ')}. 실패한 텍스트는 원문에 보존했습니다.`);
  if(source.guidance)warnings.push('SEO 참고 메모는 별도 상품 사실로 번역에 추가하지 않았습니다. 검색어는 번역한 상품명에서만 구성했습니다.');
  return {draft:{title:translatedTitle,description:translatedDescription,keywords,attributes,warnings} satisfies TranslationDraft,requests,detectedSourceLanguages:[...languages],failure:null};
}
