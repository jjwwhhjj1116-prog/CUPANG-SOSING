import {unsupportedTranslatedProductClaim} from '@/app/product-translation-quality';
import {unsupportedProductMaterial} from '@/app/product-material-evidence';
import {translationNumbers} from '@/app/translation-attribute-evidence';
import type {SeoCompositionContext} from '@/app/seo-composition-context';
import {seoCurrentLiterals} from '@/app/seo-current-literals';
import type {TranslationSource,TranslationDraft} from '@/app/automation/translation';
export class SeoFactEmptyError extends Error{code='SEO_FACT_EMPTY';}
export const SEO_COMPOSITION_VERSION='couplus-current-composition-v1';
export const SEO_KEYWORD_CAPABILITY='couplus-consumer-keywords-v1';
/** Generated acceptance only: replay identity checks must still reach closure. */
export function assertGeneratedSeoTitle(title:string,brand:string){
 const prefix=brand.split(',')[0].replace(/[^가-힣A-Za-z0-9]/gu,'').toLowerCase();let product=title.replace(/[^가-힣A-Za-z0-9]/gu,' ').toLowerCase();
 const withoutBrand=(value:string)=>prefix?value.replace(new RegExp(prefix.split('').join('\\s*'),'gu'),''):value;
 const measurements='밀리미터|센티미터|킬로미터|미터|밀리그램|킬로그램|그램|밀리리터|리터|mm|cm|km|kg|mg|ml|g|m|l';
 const counters=seoCurrentLiterals.modules['7d6a'].V.map(group=>group.re).join('|')+'|쌍|켤레|묶음|롤|봉지|봉|병|통|박스|캔';
 product=withoutBrand(product).replace(new RegExp('\\d+\\s*(?:'+measurements+'|'+counters+')(?![a-z])','gu'),' ');
 product=product.replace(new RegExp('(?<![가-힣a-z])(?:'+measurements+'|'+counters+')(?![가-힣a-z])','gu'),' ');
 product=withoutBrand(product.replace(/\s/gu,''));
 if(!/[가-힣A-Za-z]/u.test(product))throw new SeoFactEmptyError('SEO_FACT_EMPTY: 생성 상품명에 브랜드 외의 품목명이 남지 않았습니다. 원문과 직접 입력을 유지했습니다.');
}
export type SeoRelatedPreferences={source:'provided'|'consumer'|'unavailable'|'none';query:string;keywords:string[];warnings:string[];observedAt?:string};
export type SeoCompositionPolicy={version:typeof SEO_COMPOSITION_VERSION;memo:{brand:string;features:string;keywords:string};related:SeoRelatedPreferences};
const exact=(value:unknown,keys:string):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const bounded=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export function validateSeoCompositionPolicy(value:unknown):SeoCompositionPolicy{
 if(!exact(value,'memo,related,version')||value.version!==SEO_COMPOSITION_VERSION||!exact(value.memo,'brand,features,keywords')||!bounded(value.memo.brand,500)||!bounded(value.memo.features,2000)||!bounded(value.memo.keywords,2000)||(!exact(value.related,'keywords,query,source,warnings')&&!exact(value.related,'keywords,observedAt,query,source,warnings'))||!['provided','consumer','unavailable','none'].includes(String(value.related.source))||!bounded(value.related.query,200)||!Array.isArray(value.related.keywords)||value.related.keywords.length>1000||value.related.keywords.some(word=>!bounded(word,200)||!word.trim())||!Array.isArray(value.related.warnings)||value.related.warnings.length>4||value.related.warnings.some(word=>!bounded(word,300))||JSON.stringify(value).length>64000)throw Error('SEO 구성 입력 정책을 확인해주세요.');
 if(value.related.observedAt!==undefined&&(typeof value.related.observedAt!=='string'||value.related.observedAt.length>40||!Number.isFinite(Date.parse(value.related.observedAt))))throw Error('SEO 관련어 조회 시간을 확인해주세요.');
 const query=value.memo.keywords.trim();if(value.related.query!==(query.length<=200?query:''))throw Error('SEO 현재 메모와 관련어 조회가 다릅니다.');
 return {version:SEO_COMPOSITION_VERSION,memo:{brand:value.memo.brand,features:value.memo.features,keywords:value.memo.keywords},related:{source:value.related.source as SeoRelatedPreferences['source'],query:value.related.query,keywords:[...new Set(value.related.keywords as string[])],warnings:value.related.warnings as string[],...(typeof value.related.observedAt==='string'?{observedAt:value.related.observedAt}:{})}};
}
export const currentSeoInstructions='\n현재 SEO 구성 정책: 상품명은 자연스러운 한국어 핵심 품목으로 최대70자를 목표로 작성하세요. 일부 색상·사이즈·옵션값을 열거하지 마세요. 브랜드는 앱이 쉼표 첫 항목을 접두어로 한 번 붙입니다. 모델 상품명에 브랜드를 붙이거나 반복하지 마세요. 특징·타겟·관련어를 뒤에 기계적으로 붙이지 마세요. related는 검색 선호이며 상품 사실의 증거가 아닙니다. 실제 상품과 맞는 많은 관련 검색어를 쉼표 포함150자 안으로 요청하지만 반환된 전체 후보는 보존합니다. 금지 특징은 타겟·원제목보다 우선합니다. 선택 옵션이나 특징이 있으면 원제목의 개수·색·형태를 사실로 간주하지 말고 선택 옵션과 특징을 우선하세요. 전체옵션요약은 첫 배치가 전체옵션이 아님을 나타냅니다. 중국 国产/国内를 한국산으로 옮기지 마세요.';
type LiteralRegex={pattern:string;flags:string};
export function normalizeSeoQuantityNumbers(text:string){const map=seoCurrentLiterals.modules['7d6a'].W;return text.replace(/([一两二三四五六七八九十])(?=\s*(?:个|只|件|套|包|装))/gu,(_,value:keyof typeof map)=>String(map[value]));}
const re=(value:LiteralRegex)=>new RegExp(value.pattern,value.flags);
const rules=seoCurrentLiterals.modules['7d6a'],origin=seoCurrentLiterals.modules['06c4'],medical=seoCurrentLiterals.modules['27c2'];
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
const countSourceForCapacity=(text:string,pattern:RegExp)=>Array.from(text.matchAll(pattern),match=>match[1]);
const tidy=(value:string)=>value.replace(/\s+/gu,' ').replace(/^[\s,/·|\-]+|[\s,/·|\-]+$/gu,'').trim();
export function seoBannedTerms(features:string,target=''){
 const terms:string[]=[];
 for(const sentence of features.split(/[\n.!?;]/u)){
  const match=re(rules.be).exec(sentence)||re(rules.ye).exec(sentence);
  if(match)for(let term of match[1].split(/[,/·|]/u)){term=term.replace(new RegExp(rules.ke.pattern,'g'),'').replace(re(rules.we),'').replace(re(rules.Ie),'').replace(/(?:은|는|을|를|이|가|도)$/u,'').trim();if(term.length>=2&&!re(rules.Ae).test(term))terms.push(term);}
  for(const found of sentence.matchAll(re(rules.Se)))if(found[1].length>=2&&!re(rules.Ne).test(found[1]))terms.push(found[1]);
 }
 const compact=target.replace(/\s/gu,'');if(compact&&terms.some(term=>compact.includes(term.replace(/\s/gu,''))))terms.push(target);
 return [...new Set(terms)].sort((a,b)=>b.length-a.length);
}
export function currentSeoInput(source:TranslationSource,policy:SeoCompositionPolicy,context?:SeoCompositionContext){
 const options=source.attributes.filter(pair=>/^option(?:-(?:color|size))?:/u.test(pair.name));
 const compactTarget=policy.memo.keywords.replace(/\s/gu,''),forbiddenTarget=Boolean(compactTarget&&seoBannedTerms(policy.memo.features,policy.memo.keywords).some(term=>{const compact=term.replace(/\s/gu,'');return compactTarget.includes(compact)||compact.includes(compactTarget);})),effectiveTarget=forbiddenTarget?'none — seller forbade it':policy.memo.keywords;
 return {composition:{...policy,memo:{...policy.memo,keywords:effectiveTarget}},currentMemo:policy.memo,effectiveTargetKeyword:effectiveTarget,categoryLabel:(source.category?.path.join(' > ')??'').replace(/\(\d+\)\s*$/u,'').trim(),sourceTitleAuthority:context?.selectedOptions.length||policy.memo.features.trim()?'reference':'source',materialAndShapeFacts:source.attributes.filter(pair=>/材质|材料|面料|产品类别|类别|造型|形状|款式|소재|재질|원단|카테고리|품목명|종류|모양|형태|material|fabric|category|shape/iu.test(pair.name)&&pair.value&&pair.value!=='/').slice(0,6),...(context?{selectedOptions:context.selectedOptions.slice(0,20),bundleQuantity:context.bundleQuantity}:{}),fullOptionSummary:{optionCount:context?.selectedOptions.length??options.filter(pair=>pair.name.startsWith('option:')).length,dimensions:['option:','option-color:','option-size:'].map(prefix=>{const values=[...new Set(context?context.selectedOptions.map(row=>prefix==='option:'?row.nameTrans||row.name:prefix==='option-color:'?row.color:row.size).filter(Boolean):options.filter(pair=>pair.name.startsWith(prefix)).map(pair=>pair.value))];return {dimension:prefix,values:values.slice(0,60),remaining:Math.max(0,values.length-60)};})}};
}
/** Apply only to the separately signed policy. Historical validators never enter. */
export function guardCurrentSeoDraft(draft:TranslationDraft,source:TranslationSource,policy:SeoCompositionPolicy,context?:SeoCompositionContext,optionsOnly=false):TranslationDraft{
 const warnings=[...draft.warnings,...policy.related.warnings],banned=seoBannedTerms(policy.memo.features,policy.memo.keywords);
 const featureFacts=policy.memo.features.split(/[\n.!?;]/u).filter(value=>!re(rules.be).test(value)&&!re(rules.ye).test(value)&&!re(origin.i).test(value)).join(' ');
 const options=context?context.selectedOptions.map(row=>({name:'option:'+row.id,value:[row.name,row.nameTrans,row.color,row.size].join(' ')})):source.attributes.filter(pair=>/^option(?:-(?:color|size))?:/u.test(pair.name)),optionFacts=options.map(pair=>pair.value).join(' ');
 const countryFacts=source.attributes.filter(pair=>re(origin.r).test(pair.name)).map(pair=>pair.value).join(' ');
 const evidence=[...source.attributes.filter(pair=>!/^option/u.test(pair.name)).map(pair=>pair.value),optionFacts,featureFacts].join(' '),target=policy.memo.keywords,category=source.category?.path.join(' ')??'';
 const warning=(kind:string,words:string[])=>{if(words.length)warnings.push(kind+': '+words.join(', '));};
 const replace=(text:string,pattern:RegExp,kind:string,keep=false)=>{const found=text.match(pattern)??[];if(!found.length)return text;const next=tidy(text.replace(pattern,' '));warning(kind,found);return keep&&!next?text:next;};
 const chinese=(text:string)=>{if(!/[㐀-䶿一-鿿豈-﫿]/u.test(text))return text;for(const [key,value]of Object.entries(seoCurrentLiterals.removeChineseDictionary).sort(([a],[b])=>b.length-a.length))text=text.split(key).join(value);warning('han',['한자 정리']);return tidy(text.replace(re(rules.pe),' '));};
 const claimRules: {kind:string;re:LiteralRegex;src?:LiteralRegex;blend?:boolean}[]=[...rules.Me.flatMap(value=>'re'in value&&value.re?[{kind:value.kind!,re:value.re,src:'src'in value?value.src:undefined,blend:'ok'in value}]:[]),...rules.je.flatMap(value=>'claim'in value&&value.claim?[{kind:'material',re:value.claim,src:'src'in value?value.src:value.re}]:[])];
 const materialFacts=source.attributes.filter(pair=>re(rules.Ue).test(pair.name)).map(pair=>pair.value).join(' '),materialCount=rules.je.filter(value=>re(value.re).test(materialFacts)).length;
 const supported=(text:string,isTag=false,sourceEvidence=evidence,sourceTarget=target)=>{
  let result=text;
  if(!isTag)result=replace(result,/\([^)]*%[^)]*\)/gu,'unsupportedClaim');
  for(const rule of claimRules){const basis=rule.src&&re(rule.src);if(rule.blend?materialCount>=2:basis?.test(sourceEvidence))continue;if(basis?.test(sourceTarget)){if(rule.kind==='material'&&re(rule.re).test(result))warning('keywordMaterial',[result]);continue;}result=replace(result,re(rule.re),'unsupportedClaim');}
  const extraClaim=unsupportedTranslatedProductClaim(result,sourceEvidence+' '+sourceTarget);if(extraClaim&&extraClaim!=='통증 완화')result=replace(result,new RegExp(escape(extraClaim).replace(/\s+/gu,'\\s*'),'giu'),'unsupportedClaim');
  const extraMaterial=unsupportedProductMaterial(result,sourceEvidence+' '+sourceTarget);if(extraMaterial)result=replace(result,new RegExp(escape(extraMaterial),'giu'),'unsupportedClaim');
  return result;
 };
 const audience=(text:string)=>{const context=featureFacts+' '+target,adult=re(rules.F).test(context),child=re(rules.M).test(context);if(adult&&!child)text=replace(text,new RegExp(rules.C+'|'+rules._,'gi'),'audience',true);else if(child&&!adult)text=replace(text,new RegExp(rules.B,'g'),'audience',true);if(category&&!re(rules.R).test(category))text=replace(text,new RegExp(rules.j+rules.C,'gi'),'kidsWords');return text;};
 const forbidden=(text:string)=>{for(const term of banned)text=replace(text,new RegExp(escape(term).replace(/\s+/gu,'\\s*'),'giu'),'bannedByFeature');if(banned.some(term=>re(rules.Ee).test(term)))for(const [ko,foreign]of rules.Te){if(!new RegExp(ko+'|'+foreign,'i').test(countryFacts))text=replace(text,new RegExp('(?:'+ko+')\\s*(?:산|생산|제조|제작)?','g'),'originClaim');}return text;};
 let title=chinese(draft.title),keywords=draft.keywords.map(chinese).filter(Boolean);
 // Selected specifications, then partial-option brackets.
 const beforeSpecs=title;
 const specKey=(value:string)=>value.replace(/\s/gu,'').replace(/[x×*]/giu,'x');
 for(const unit of rules.n){const pattern=new RegExp(rules.a+rules.s+'\\s*'+unit.re,'gi'),allowed=[...new Set([...optionFacts.matchAll(pattern)].map(match=>specKey(match[1])))];if(!allowed.length)continue;title=title.replace(pattern,(whole,value:string)=>{const numbers=value.split(/\s*(?:-|~|–|\/)\s*/u);if(numbers.every(number=>allowed.includes(specKey(number)))&&(!options.length||allowed.length<=1||numbers.length>1))return whole;warning('spec',[whole]);return ' ';});}
 if(!tidy(title))title=beforeSpecs;
 const optionMatches=(value:string,term:string)=>/^[A-Za-z0-9]+$/u.test(term)?new RegExp('(?<![A-Za-z0-9])'+escape(term)+'(?![A-Za-z0-9])','i').test(value):value.includes(term);
 if(options.length>=2)title=title.replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】/gu,whole=>{const terms=whole.slice(1,-1).split(/[/,·|]/u).map(value=>value.trim()).filter(Boolean),covered=options.filter(option=>terms.some(term=>optionMatches(option.value,term)));if(covered.length&&covered.length<options.length&&terms.every(term=>options.some(option=>optionMatches(option.value,term)))){warning('partialOptions',[whole]);return ' ';}return whole;});
 title=audience(title);
 // Source claims use attributes/options/features, never the old supplier title.
 const capacities=new Set(rules.Z.flatMap(pattern=>[...countSourceForCapacity(optionFacts+' '+featureFacts,re(pattern))]));
 title=title.replace(/(\d+)\s*(?:매|장)(?!\s*(?:수납|보관))/gu,(whole,n:string)=>capacities.has(n)?n+'매 수납':whole);
 title=supported(title);title=forbidden(title);if(!optionsOnly&&!tidy(title))throw new SeoFactEmptyError('SEO_FACT_EMPTY: 상품명 사실이 남지 않았습니다.');
 keywords=keywords.filter(word=>{const next=forbidden(supported(audience(word),true));const valid=tidy(next)===tidy(word);if(!valid)warning('tags',[word]);return valid;});
 if(!re(medical.i).test(category)){const pattern=new RegExp(medical.p.join.join('|'),'g'),before=title;title=title.replace(/[^\s,/·()[\]+&]+/gu,token=>{const match=new RegExp(medical.p.join.join('|')).exec(token);if(!match)return token;warning('efficacyClaim',[match[0]]);const prefix=token.slice(0,match.index);if(prefix&&!re(medical.l).test(prefix))return ' ';const tail=token.slice(match.index).replace(pattern,'').replace(/^(?:걱정없는|효과용|없는|없이|걱정|예방|방지|효과|에도|성|용|적|엔|에)/u,'');return prefix+tail;});if(!tidy(title))title=before;keywords=keywords.filter(word=>{if(new RegExp(medical.p.join.join('|')).test(word)){warning('tags',[word]);return false;}return true;});}
 for(const item of rules.he)if(re(item.item).test(target+' '+category)&&!re(item.words).test(target+' '+category))title=replace(title,re(item.words),'itemType',true);
 const skus=[...optionFacts.matchAll(/[A-Za-z]{1,3}-?\d{3,}/gu)].map(match=>match[0]);for(const sku of skus)title=replace(title,new RegExp('(?<![A-Za-z0-9])'+escape(sku)+'(?![A-Za-z0-9])','gi'),'supplierSku',true);
 for(const shape of rules.ee)if(re(shape.title).test(source.title)&&!re(shape.title).test(optionFacts)&&re(shape.other).test(optionFacts))for(const [pattern,replacement]of shape.words){const rx=re(pattern as LiteralRegex);if(rx.test(title)){warning('shape',[title]);title=title.replace(rx,replacement as string);}}
 if(rules.oe.some(color=>re(color.zh).test(optionFacts)))for(const color of rules.oe)if(re(color.zh).test(source.title)&&!re(color.zh).test(optionFacts)){const notAfter='notAfter'in color?color.notAfter:[];for(const word of color.words){const before=title;title=title.replace(new RegExp('(?<![가-힣A-Za-z])'+escape(word)+'(?![가-힣A-Za-z])','g'),(whole,offset:number,text:string)=>{if(notAfter?.some(prefix=>text.slice(0,offset).endsWith(prefix)))return whole;warning('color',[whole]);return ' ';});if(!tidy(title))title=before;}keywords=keywords.filter(word=>!color.kwWords.some(value=>{let index=word.indexOf(value);while(index>=0){if(!notAfter?.some(prefix=>word.slice(0,index).endsWith(prefix))&&!(value==='금'&&/^속/u.test(word.slice(index+1))))return true;index=word.indexOf(value,index+value.length);}return false;}));}
 if(re(rules.ie).test(source.title)&&!re(rules.ie).test(optionFacts)&&re(rules.ce).test(optionFacts)){title=replace(title,re(rules.le),'layer',true);keywords=keywords.filter(word=>!re(rules.le).test(word));}
 const countSource=optionFacts+' '+featureFacts,normalizeCounts=(text:string)=>text.replace(/([一两二三四五六七八九十])(?=\s*(?:个|只|件|套|包|装))/gu,(_,value:keyof typeof rules.W)=>String(rules.W[value]));
 const countSets=rules.V.map(group=>new Set([...normalizeCounts(countSource).matchAll(new RegExp('(\\d+)\\s*'+group.re,'gi'))].map(match=>match[1]))),pieces=new Set([...countSets[0],...countSets[1]]);const fallback=context?.selectedOptions.length&&context.selectedOptions.every(row=>row.bundleQuantity===context.selectedOptions[0].bundleQuantity)?context.selectedOptions[0].bundleQuantity:null;if(!pieces.size&&fallback&&Number.isInteger(fallback)&&fallback>=1)pieces.add(String(fallback));
 for(const [index,group] of rules.V.entries()){const pattern=new RegExp('(\\d+)\\s*'+group.re,'gi'),allowed=index<2?pieces:countSets[index];if(!allowed.size)continue;const next=title.replace(pattern,(whole,n:string)=>{if(allowed.has(n))return whole;warning('counts',[whole]);return ' ';});if(tidy(next))title=next;}
 const bundle=context?.bundleQuantity;if(!optionsOnly&&bundle&&!new RegExp('(?<!\\d)'+bundle+'\\s*'+rules.V[0].re,'i').test(title)&&title.length+String(bundle).length+2<=70)title=tidy(title)+' '+bundle+'개';
 const originFacts=countryFacts,koreanOriginAllowed=re(origin.a).test(originFacts)||!/中国|중국|china|国产|国内/iu.test(originFacts)&&re(origin.a).test(featureFacts),chinaCandidate=/[一-鿿]/u.test(source.title)||/1688|alibaba|taobao|tmall/iu.test(source.reference)||!source.title&&!source.reference;
 if(chinaCandidate&&!koreanOriginAllowed){title=replace(title,re(origin.n),'originClaim');keywords=keywords.map(word=>replace(word,re(origin.n),'originClaim')).filter(Boolean);}
 const allowedNumbers=new Set(translationNumbers([source.title,source.description,...source.attributes.map(pair=>pair.value),normalizeSeoQuantityNumbers(optionFacts),policy.memo.brand,context?.bundleQuantity??''].join(' ')));
 keywords=keywords.filter(word=>{if(translationNumbers(word).some(number=>!allowedNumbers.has(number))){warning('tags',[word]);return false;}return true;});
 if(!optionsOnly&&!tidy(title))throw new SeoFactEmptyError('SEO_FACT_EMPTY: 상품명 사실이 남지 않았습니다.');
 return {...draft,title:tidy(title),keywords:[...new Set(keywords)],attributes:draft.attributes.flatMap((value,index)=>{const original=source.attributes[value.sourceIndex];if(!/^option(?:-(?:color|size))?:/u.test(original?.name??''))return [value];const id=original.name.replace(/^option(?:-(?:color|size))?:/u,''),saved=context?.selectedOptions.find(row=>row.id===id);if(saved?.manualName&&original.name.startsWith('option:')){warning('userKept',[id]);return [];}let guarded=forbidden(supported(chinese(value.value),true,original.value+' '+featureFacts,''));if(chinaCandidate&&!koreanOriginAllowed)guarded=replace(guarded,re(origin.n),'originClaim');if(!tidy(guarded)){guarded=forbidden(supported(chinese(saved?.nameTrans??''),true,original.value+' '+featureFacts,''));if(!guarded)throw new SeoFactEmptyError('SEO_FACT_EMPTY: 옵션 '+(index+1));}return [{...value,value:tidy(guarded)}];}),warnings:[...new Set(warnings)].slice(0,50)};
}
