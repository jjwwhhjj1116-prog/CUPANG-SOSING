import {translateGoogleFree} from '@/app/automation/google-free-translation';
import {planGoogleTranslationRequests,parseGoogleTranslationBlock} from '@/app/automation/google-translation-batch';
import {translationAttributeIssue,translationNumbers} from '@/app/translation-attribute-evidence';
import {validateImageTextRegions,type ImageTextRegion,type ImageTextTranslation} from '@/app/free-image-translation';

/** OCR text remains untrusted plain text. A result belongs only to its exact
 * source region, never to a positional neighbour or a model-generated field. */
export async function translateImageRegions(input:ImageTextRegion[],language:'zh'|'en',fetcher:typeof fetch=fetch,signal?:AbortSignal){
 const regions=validateImageTextRegions(input);
 if(language!=='zh'&&language!=='en')throw Error('중국어 또는 영어를 선택해주세요.');
 const eligible=(text:string)=>language==='zh'?/\p{Script=Han}/u.test(text):! /\p{Script=Han}/u.test(text)&&/[a-z]{2}/iu.test(text);
 const pending=regions.filter(row=>eligible(row.text));
 const values=new Map<string,string>(),issues=new Map<string,string>();
 let requests=0,stoppedHttpStatus:number|null=null;
 for(const request of planGoogleTranslationRequests(pending.map(row=>row.text))){
  if(signal?.aborted||stoppedHttpStatus!==null)break;
  if(requests>=20)break;
  requests++;
  const originals=request.kind==='block'?request.entries.map(row=>row.original):[request.text];
  let issue='번역 응답을 받지 못했습니다.';
  const result=await translateGoogleFree(request.text,{sourceLanguage:language==='zh'?'zh-CN':'en',fetcher,signal,onFailure:failure=>{
   if(failure.reason==='http'){issue=`Google 번역 HTTP ${failure.status??'오류'}`;if(failure.status===429||(failure.status??0)>=500)stoppedHttpStatus=failure.status!;}
  }});
  if(signal?.aborted)break;
  if(!result){for(const original of originals)issues.set(original,issue);continue;}
  const translated=request.kind==='block'?parseGoogleTranslationBlock(result.translatedText,request):new Map([[request.text,result.translatedText.trim()]]);
  if(!translated){for(const original of originals)issues.set(original,'번역 영역 식별자가 달라 적용하지 않았습니다.');continue;}
  for(const [original,value]of translated){
   const numbers=translationNumbers(original).sort(),returned=translationNumbers(value).sort();
   if(!/[가-힣]/u.test(value)||translationAttributeIssue({name:'',value:original},{name:'',value})
    ||JSON.stringify(numbers)!==JSON.stringify(returned)){issues.set(original,'원문 문구·숫자와 번역 결과를 확인해주세요.');continue;}
   values.set(original,value);
  }
 }
 const result:ImageTextTranslation[]=regions.map(row=>({id:row.id,original:row.text,translated:values.get(row.text)??null,issue:values.has(row.text)?null:issues.get(row.text)??(eligible(row.text)?'번역하지 못한 영역입니다. 원문을 유지했습니다.':'선택한 언어의 문구가 아닙니다. 원문을 유지했습니다.')}));
 const warnings=['이미지에서 읽은 문구와 한국어 번역을 원본과 비교하고, 교체할 영역만 선택해주세요.'];
 if(stoppedHttpStatus!==null)warnings.push(`Google HTTP ${stoppedHttpStatus} 이후 요청을 중단했습니다. 원문과 이미 받은 결과를 유지하며 자동 재시도하지 않습니다.`);
 return{regions:result,requests,stoppedHttpStatus,warnings};
}
