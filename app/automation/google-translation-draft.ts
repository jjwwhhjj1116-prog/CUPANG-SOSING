import {translateGoogleFree,type GoogleFreeTranslationFailure} from '@/app/automation/google-free-translation';
import {QUOTATION_TAG_ITEM_LIMIT,QUOTATION_TAG_TOTAL_LIMIT} from '@/app/quotation-keywords';
import type {TranslationDraft,TranslationSource} from '@/app/automation/translation';
import {translationAttributeIssue,untranslatedChineseTranslation} from '@/app/translation-attribute-evidence';
import {planGoogleTranslationRequests,parseGoogleTranslationBlock,type GoogleTranslationRequest} from '@/app/automation/google-translation-batch';

const hasHan=(text:string)=>/\p{Script=Han}/u.test(text);
const retainedLiteral=(text:string)=>!hasHan(text)&&(/[가-힣]/u.test(text)||/^(?:[A-Z]{1,6}\d*|\d+(?:[.,]\d+)*(?:\s*(?:cm|mm|kg|g|m|ml|L|%))?)$/u.test(text));
const optionBinding=(name:string)=>/^option(?:-(?:color|size))?:[A-Za-z0-9_-]{1,80}$/u.test(name);

/** Direct text translation preserves source indexes and option IDs. It does
 * not send a prompt or ask the service to invent listing facts. */
export async function buildGoogleTranslationDraft(source:TranslationSource,fetcher:typeof fetch=fetch,scope:'all'|'options'='all'){
  // A server-proved option retry retains SEO as local review context only.
  // An already translated title/description must not consume its free quota.
  const title=scope==='options'?'':source.title.trim(),description=scope==='options'?'':source.description.trim();
  const fields=source.attributes.map(pair=>({name:pair.name.replace(/^상품속성: /u,'').trim(),value:pair.value.trim(),bound:optionBinding(pair.name)}));
  if(scope==='options'&&fields.some(pair=>!pair.bound))throw Error('옵션 전용 번역에 상품 속성을 보낼 수 없습니다.');
  const originals=[title,description,...fields.filter(pair=>pair.bound).map(pair=>pair.value),...fields.filter(pair=>!pair.bound).flatMap(pair=>[pair.name,pair.value])];
  const unique=[...new Set(originals.filter(Boolean))],translated=new Map<string,string>();
  const languages=new Set<string>();
  const failures=new Map<string,GoogleFreeTranslationFailure>();
  let requests=0,consecutiveFailures=0,invalidBlocks=0,stopStatus:number|null=null;
  const pending=unique.filter(text=>{if(retainedLiteral(text)){translated.set(text,text);return false;}return true;});
  // Stay within Workers Free's subrequest budget. Missing entries are returned
  // as partial coverage, never copied into a completed translation.
  const acceptText=(original:string,value:string)=>{
    value=value.trim();
    if(!value||untranslatedChineseTranslation(original,value)||hasHan(original)&&!/[가-힣]/u.test(value))return false;
    translated.set(original,value);return true;
  };
  const translateRequest=async(request:GoogleTranslationRequest)=>{
    if(request.text.length>5000)return false;
    requests++;
    const result=await translateGoogleFree(request.text,{fetcher,onFailure:failure=>{
      for(const original of request.kind==='block'?request.entries.map(entry=>entry.original):[request.text])failures.set(original,failure);
      // A quota or service error applies to the endpoint, not just this text.
      // Other in-flight successes must not reopen the remaining queue.
      if(failure.reason==='http'&&(failure.status===429||(failure.status??0)>=500))stopStatus??=failure.status!;
    }});
    if(!result||!result.translatedText.trim())return false;
    let accepted=false;
    if(request.kind==='single')accepted=acceptText(request.text,result.translatedText);
    else{
      const values=parseGoogleTranslationBlock(result.translatedText,request);
      if(!values){invalidBlocks++;return false;}
      for(const [original,value]of values)accepted=acceptText(original,value)||accepted;
    }
    if(result.detectedSourceLanguage)languages.add(result.detectedSourceLanguage);
    return accepted;
  };
  // Check the essential product name first. A blocked service must not cause
  // dozens of follow-on requests or a draft which silently keeps a Chinese name.
  if(title&&!translated.has(title)&&!await translateRequest({kind:'single',text:title}))return {draft:{title:'',description:'',keywords:[],attributes:[],warnings:[]},requests,detectedSourceLanguages:[...languages],stoppedHttpStatus:stopStatus,failure:failures.get(title)??null};
  const planned=planGoogleTranslationRequests(pending.filter(text=>text!==title));
  let budgetReached=false;
  for(const request of planned){
    if(stopStatus!==null||consecutiveFailures>=3)break;
    if(request.text.length>5000)continue;
    if(requests>=49){budgetReached=true;break;}
    if(await translateRequest(request))consecutiveFailures=0;else consecutiveFailures++;
  }
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
  const warnings=[scope==='options'?'Google 옵션 텍스트 번역 초안입니다. 옵션 의미를 확인하고 수정해주세요. 상품명·설명·표시사항은 요청하거나 변경하지 않았습니다.':'Google 텍스트 번역 초안입니다. 판매자가 기재한 재질·인증·성능과 상품명·옵션 의미를 확인하고 수정해주세요.'];
  if(stopStatus!==null)warnings.push(`Google 번역 HTTP ${stopStatus} 응답으로 남은 요청을 중단했습니다. 이미 받은 번역은 초안으로 유지하고 요청하지 않은 항목은 원문에 보존했습니다. 자동 재시도하지 않았습니다.`);
  if(foreignNumbers)warnings.push(`같은 상품 속성·옵션 원문에 없는 숫자를 반환한 ${foreignNumbers}개는 적용하지 않고 원문에 보존했습니다.`);
  if(description&&!translatedDescription)warnings.push('상품 설명 번역을 받지 못했습니다. 원문은 유지했으며 설명 초안을 비워 두었습니다.');
  if(budgetReached)warnings.push('한 번의 번역 요청 묶음 한도를 넘은 텍스트는 원문에 보존했습니다. 자동으로 추가 요청하지 않았습니다.');
  if(invalidBlocks)warnings.push(`항목 식별자를 확인하지 못한 Google 번역 묶음 ${invalidBlocks}개는 적용하지 않고 원문에 보존했습니다. 개별 재요청하지 않았습니다.`);
  if(consecutiveFailures>=3)warnings.push('연속된 번역 응답 실패로 남은 요청을 중단했습니다. 실패한 항목은 원문에 보존했습니다.');
  const failedStatuses=[...new Set([...failures.values()].map(failure=>failure.status).filter((status):status is number=>typeof status==='number'))];
  if(failedStatuses.length)warnings.push(`일부 텍스트의 Google 번역 HTTP 응답: ${failedStatuses.join(', ')}. 실패한 텍스트는 원문에 보존했습니다.`);
  if(source.guidance&&scope!=='options')warnings.push('SEO 참고 메모는 별도 상품 사실로 번역에 추가하지 않았습니다. 검색어는 번역한 상품명에서만 구성했습니다.');
  return {draft:{title:translatedTitle,description:translatedDescription,keywords,attributes,warnings} satisfies TranslationDraft,requests,detectedSourceLanguages:[...languages],stoppedHttpStatus:stopStatus,failure:null};
}
