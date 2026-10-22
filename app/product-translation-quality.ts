import type {TranslationDraft,TranslationJob,TranslationReview,TranslationSource} from '@/app/automation/translation';

export class TranslationQualityError extends Error{
 constructor(public code:string,message:string){super(message);}
}
const claims=[
 {name:'방수',output:/방수|water[\s-]?proof/iu,evidence:/防水|water[\s-]?proof|방수/iu,negative:/不(?:具备)?防水|非防水|not\s+waterproof|비방수|방수[^。.!?\n]{0,12}(?:아님|없)/iu},
 {name:'방습',output:/방습|moisture[\s-]?proof/iu,evidence:/防潮|moisture[\s-]?proof|방습/iu,negative:/不防潮|非防潮|not\s+moisture[\s-]?proof|방습[^。.!?\n]{0,12}(?:아님|없)/iu},
 {name:'항균',output:/항균|anti[\s-]?bacterial/iu,evidence:/抗菌|抑菌|anti[\s-]?bacterial|항균/iu,negative:/不抗菌|非抗菌|항균[^。.!?\n]{0,12}(?:아님|없)/iu},
 {name:'살균',output:/살균|steriliz/iu,evidence:/杀菌|除菌|steriliz|살균/iu,negative:/不杀菌|살균[^。.!?\n]{0,12}(?:아님|없)/iu},
 {name:'무독성',output:/무독성|non[\s-]?toxic/iu,evidence:/无毒|non[\s-]?toxic|무독성/iu,negative:/非无毒|무독성[^。.!?\n]{0,12}(?:아님|없)/iu},
 {name:'통증 완화',output:/통증\s*(?:완화|치료)|진통|pain\s*relief/iu,evidence:/缓解疼痛|镇痛|止痛|pain\s*relief|통증\s*완화|진통/iu,negative:/不止痛|不能缓解疼痛|통증[^。.!?\n]{0,16}(?:완화|치료)[^。.!?\n]{0,8}(?:아님|없)/iu},
];
/** Explicit facts only; category/preferences never prove a performance claim. */
export function unsupportedTranslatedProductClaim(output:string,source:string):string|null{
 for(const claim of claims)if(claim.output.test(output)&&(!claim.evidence.test(source)||claim.negative.test(source)))return claim.name;
 return null;
}
const han=(value:string)=>/\p{Script=Han}/u.test(value);
function inspectText(value:string,source:string,location:string){
 if(han(value))throw new TranslationQualityError('RECOVERY_UNTRANSLATED_TEXT',`한국어 초안에 번역되지 않은 한자가 포함되었습니다. 위치 ${location}. 이 결과는 적용할 수 없으며 원문과 기존 수정값을 유지했습니다. 자동 재시도하지 않습니다.`);
 const claim=unsupportedTranslatedProductClaim(value,source);
 if(claim)throw new TranslationQualityError('RECOVERY_UNSUPPORTED_CLAIM',`수집 원문에서 확인하지 못한 ${claim} 성능 표현이 포함되었습니다. 위치 ${location}. 이 결과는 적용할 수 없으며 원문과 기존 수정값을 유지했습니다. 자동 재시도하지 않습니다.`);
}
/** Original source routing identities supply display metadata only. Option
 * adoption routes by that original identity and consumes the translated value;
 * translationAttributeFactText excludes these names from product evidence. */
export function workersRecoveryOptionMetadataLabel(sourceName:string):'옵션명'|'색상'|'사이즈'|null{
 const match=/^option(?:-(color|size))?:[A-Za-z0-9_-]{1,80}$/u.exec(sourceName);return match?match[1]==='color'?'색상':match[1]==='size'?'사이즈':'옵션명':null;
}
/** New v5 requests canonicalize display-only option labels by exact source
 * index, never model wording or option values. Raw and old histories stay put. */
export function canonicalizeWorkersRecoveryOptionMetadata(review:TranslationReview,input:unknown):unknown{
 if(Number(review.workersRecovery?.version)!==5||!input||typeof input!=='object'||Array.isArray(input))return input;
 const value=input as Record<string,unknown>;if(!Array.isArray(value.attributes))return input;
 return {...value,attributes:value.attributes.map(attribute=>{
  if(!attribute||typeof attribute!=='object'||Array.isArray(attribute)||!Number.isSafeInteger(attribute.sourceIndex)||typeof attribute.name!=='string'||!attribute.name.trim()||attribute.name.length>200||/[\u0000-\u001f]/u.test(attribute.name))return attribute;
  const original=review.source.attributes[attribute.sourceIndex],label=original?workersRecoveryOptionMetadataLabel(original.name):null;
  return label?{...attribute,name:label}:attribute;
 })};
}
export function assertWorkersRecoveryDraftQuality(review:TranslationReview,draft:TranslationDraft){
 if(!Object.hasOwn(review,'workersRecovery'))return;
 const source:TranslationSource=review.source;
 const facts=[source.title,source.description,...source.attributes.flatMap(pair=>[pair.name,pair.value])].join('\n');
 inspectText(draft.title,facts,'title');inspectText(draft.description,facts,'description');
 draft.keywords.forEach((value,index)=>inspectText(value,facts,`keywords[${index}]`));
 for(const [index,attribute] of draft.attributes.entries()){
  const sourceIndex=Number.isSafeInteger(attribute.sourceIndex)&&attribute.sourceIndex>=0?attribute.sourceIndex:null,original=sourceIndex===null?undefined:source.attributes[sourceIndex];
  if(!original)throw new TranslationQualityError('RECOVERY_INVALID_SOURCE',`별도 초안의 속성 원문 연결이 다릅니다. 위치 attributes[${index}].sourceIndex. 결과를 적용하지 않았습니다.`);
  const fact=[original.name,original.value].join('\n');
  inspectText(attribute.name,fact,`attributes[${index}].name · sourceIndex ${sourceIndex}`);inspectText(attribute.value,fact,`attributes[${index}].value · sourceIndex ${sourceIndex}`);
 }
}
/** Revalidate archived completions at every adoption boundary without editing history. */
export function assertWorkersRecoveryJobQuality(job:TranslationJob){
 if(!job.review||!Object.hasOwn(job.review,'workersRecovery')||!job.result)return;
 if(job.result.model!==job.review.model)throw new TranslationQualityError('RECOVERY_INVALID_MODEL','검토한 모델과 저장된 초안의 모델이 다릅니다. 결과를 적용하지 않았습니다.');
 assertWorkersRecoveryDraftQuality(job.review,job.result.draft);
}
