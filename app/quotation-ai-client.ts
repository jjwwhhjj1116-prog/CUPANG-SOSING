import {CURRENT_QUOTATION_RESULT_POLICY} from '@/app/current-quotation-attribute-rules';
import { quotationValueIssues, quotationGeneratedSourceWritable, type QuotationField, type QuotationFieldsView } from '@/app/quotation-schema';
import { quotationKnownNoticeTarget, quotationSavedQuantityText, type QuotationSavedNoticeChange } from '@/app/quotation-known-notice-proposals';
import { isCouplusNotApplicableValue } from '@/app/couplus-quotation-defaults';
import {quotationTextModel,validQuotationTextExecution,type QuotationTextExecution} from '@/app/quotation-text-execution';

import { unsupportedProductMaterial } from '@/app/product-material-evidence';
import { productFactKey, productFactPriorityIssue, productFactQuantityTokens, canonicalProductMaterialLiteral } from '@/app/product-fact-priority';
import { currentLabelNoticeNames } from '@/app/current-label-attribute-literals';
import { seoCurrentLiterals } from '@/app/seo-current-literals';
import type { QuotationAiPlan } from '@/app/quotation-ai';

export const LEGACY_QUOTATION_GENERATION_POLICY = 'option-notice-material-evidence-v1' as const;
export const RECEIPT_QUOTATION_GENERATION_POLICY = 'option-notice-material-evidence-v2' as const;
export const CANONICAL_QUOTATION_GENERATION_POLICY = 'option-notice-material-evidence-v3' as const;
export const QUOTATION_GENERATION_POLICY = 'couplus-common-legal-material-evidence-v4' as const;
export type QuotationGenerationPolicy=typeof QUOTATION_GENERATION_POLICY|typeof CANONICAL_QUOTATION_GENERATION_POLICY|typeof RECEIPT_QUOTATION_GENERATION_POLICY|typeof LEGACY_QUOTATION_GENERATION_POLICY;
export const validQuotationGenerationPolicy=(value:unknown):value is QuotationGenerationPolicy=>value===QUOTATION_GENERATION_POLICY||value===CANONICAL_QUOTATION_GENERATION_POLICY||value===RECEIPT_QUOTATION_GENERATION_POLICY||value===LEGACY_QUOTATION_GENERATION_POLICY;
export type QuotationGenerationFacts = {
  material: { name: string; value: string; provenance?: string }[];
  options: { optionId: string | null; color: string; translatedName: string; originalName?:string }[];
};
/** Project only independent material evidence and option distinctions, never SEO copy. */
export function quotationAiGenerationFacts(facts: QuotationAiPlan['facts']): QuotationGenerationFacts {
  const material = (facts.preferredAttributes ?? facts.attributes)
    .filter(pair => (productFactKey(pair.name) === 'material' || currentLabelNoticeNames.material.includes(pair.name as typeof currentLabelNoticeNames.material[number])) && !['generated', 'unverified'].includes(pair.provenance ?? '')
      && (pair.value.trim() || pair.provenance === 'detail-conflict') && !isCouplusNotApplicableValue(pair.value) && !/상세.*(?:참조|확인)|확인\s*필요|알\s*수\s*없음|정보\s*없음/u.test(pair.value));
  const manual = material.filter(pair => pair.provenance === 'manual');
  return { material: (manual.length ? manual : material).map(({value, provenance}) => ({name:'material', value, provenance})),
    options: facts.options.map(({optionId, color, translatedName, originalName}) => ({optionId, color, translatedName, originalName})) };
}
/** Complete color-axis parts are dispatch references, never saved option-color facts. */
export function quotationAiColorReference(option: QuotationGenerationFacts['options'][number]): { key:string; aliases:string[] } | undefined {
  const rules=seoCurrentLiterals.modules['7d6a'];
  const parse=(part:string):{key:string;aliases:string[]}|undefined=>{
    let rest=part.trim();const keys:string[]=[],aliases:string[]=[];
    while(rest){
      const choices=[...rules.oe.flatMap(rule=>{const match=new RegExp(`^(?:${rule.zh.pattern})`,rule.zh.flags).exec(rest);return match&&rule.words.length?[{source:match[0],aliases:[...rule.words]}]:[];}),
        ...Object.entries(rules.Ke).filter(([source])=>rest.startsWith(source)).map(([source,value])=>({source,aliases:[value]}))].sort((left,right)=>right.source.length-left.source.length);
      const match=choices[0];if(!match)return;
      keys.push(match.aliases[0]);aliases.push(...match.aliases);rest=rest.slice(match.source.length).replace(/^色/u,'').trim();
    }
    return keys.length?{key:[...new Set(keys)].sort().join('|'),aliases:[...new Set(aliases)]}:undefined;
  };
  if(option.color.trim()){
    const parsed=parse(option.color);
    return {key:parsed?.key??option.color.trim(),aliases:[...new Set([...(parsed?.aliases??[]),...rules.oe.filter(rule=>new RegExp(rule.zh.pattern,rule.zh.flags).test(option.color)).flatMap(rule=>[...rule.words])])]};
  }
  const name=(option.originalName??'').replace(/&amp;/giu,'&').replace(/&(?:gt|#0*62|#x0*3e);/giu,'>');
  const parts=name.split(/[>＞|｜\/／;；]/u).flatMap(part=>{const parsed=parse(part);return parsed?[parsed]:[];});
  return parts.length?{key:[...new Set(parts.map(part=>part.key))].sort().join('|'),aliases:[...new Set(parts.flatMap(part=>part.aliases))]}:undefined;
}
export function quotationAiOptionColorNotice(field: QuotationField): boolean {
  return quotationKnownNoticeTarget(field, true) === 'color';
}
export function quotationAiMaterialField(field: QuotationField): boolean {
  const wire = field.hubWire;
  return Boolean(writableAiField(field) && (productFactKey(wire!.name!) === 'material'
    || field.section === 'legal' && field.visibility === 'common' && wire!.path.join('.') === 'legalPage.notices'
      && wire!.name === field.label && currentLabelNoticeNames.material.includes(field.label as typeof currentLabelNoticeNames.material[number])));
}
/** Source normalization is available only for whole, agreeing independent material evidence. */
export function quotationAiCanonicalMaterial(field:QuotationField,facts:QuotationGenerationFacts):string|undefined{
  if(!quotationAiMaterialField(field)||!facts.material.length)return;
  const values=facts.material.map(pair=>canonicalProductMaterialLiteral(pair.value));
  if(values.some(value=>value===null)||new Set(values).size!==1)return;
  const value=values[0]!;return quotationValueIssues(field,value).length?undefined:value;
}
/** Only the captured legal notice wire is common across selected options. */
export function quotationAiCommonLegalField(field:QuotationField):boolean{
  const wire=field.hubWire;
  return field.section==='legal'&&field.visibility==='common'&&wire?.path.join('.')==='legalPage.notices'
    &&wire.nameKey==='noticeItemName'&&['noticeItemValue','noticeContent'].includes(wire.valueKey??'')&&wire.name===field.label;
}
export function quotationAiLegalMaterialReference(field: QuotationField, facts: QuotationGenerationFacts, generationPolicy?: string): string | undefined {
  const reference = '상세설명 참조';
  if (generationPolicy === QUOTATION_GENERATION_POLICY && facts.material.length === 0 && field.label === '제품 소재'
    && quotationAiCommonLegalField(field) && field.hubWire?.valueKey === 'noticeItemValue' && writableAiField(field)
    && (field.type === 'text' || field.type === 'textarea') && !field.choices && !field.numericText && !field.numericValue
    && !quotationValueIssues(field, reference).length) return reference;
}
// Existing shipped color translations provide negative evidence even when that color is not selected.
const legalColorTranslations=Object.entries(seoCurrentLiterals.removeChineseDictionary).flatMap(([raw,word])=>{
  const reference=quotationAiColorReference({optionId:null,color:raw,translatedName:''});
  return reference?.aliases.length?[{key:reference.key,word}]:[];
});
const legalColorWords=[...new Set([...seoCurrentLiterals.modules['7d6a'].oe.flatMap(rule=>[...rule.words]),...Object.values(seoCurrentLiterals.modules['7d6a'].Ke),...legalColorTranslations.map(item=>item.word)])];
function commonLegalColorSupported(field:QuotationField,value:string,facts:QuotationGenerationFacts):boolean{
  const normalize=(text:string)=>text.trim().replace(/\s+/gu,' ').toLowerCase();
  const candidate=normalize(value);
  if(!candidate||/[\d,，、;/／|｜>＞+&㐀-䶿一-鿿豈-﫿]/u.test(candidate))return false;
  const axes=(text:string)=>text.replace(/&amp;/giu,'&').replace(/&(?:gt|#0*62|#x0*3e);/giu,'>').split(/[>＞|｜/／;；]/u).map(part=>part.trim());
  return facts.options.some(option=>{
    const reference=quotationAiColorReference(option);if(!reference)return false;
    if(reference.aliases.some(alias=>normalize(alias)===candidate)||normalize(option.color)===candidate)return true;
    // A saved translated axis may supply a synonym, but an entire option name may not.
    const raw=axes(option.originalName??''),translated=axes(option.translatedName);
    if(raw.length<2||raw.length!==translated.length)return false;
    return raw.some((part,index)=>{
      const color=option.color.trim();
      const axis=quotationAiColorReference({optionId:option.optionId,color:'',translatedName:'',originalName:part});
      if(!(color&&normalize(part)===normalize(color))&&(!axis||axis.key!==reference.key))return false;
      if(normalize(translated[index])!==candidate)return false;
      const phrase=(alias:string)=>new RegExp(`(?<![가-힣A-Za-z])${normalize(alias).split(/\s+/u).map(word=>word.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('\\s+')}(?![가-힣A-Za-z])`,'gu');
      const ownAliases=[...reference.aliases,...legalColorTranslations.filter(item=>item.key===reference.key).map(item=>item.word)];
      let remaining=candidate;for(const alias of ownAliases.sort((a,b)=>b.length-a.length))remaining=remaining.replace(phrase(alias),' ');
      if(legalColorWords.some(alias=>phrase(alias).test(remaining)))return false;
      return !quotationAiGenerationIssue(field,option.optionId,value,facts,CANONICAL_QUOTATION_GENERATION_POLICY);
    });
  });
}
export function quotationAiCommonLegalIssue(fields:readonly QuotationField[],changes:readonly QuotationAiProposal[]):string|null{
  for(const field of fields.filter(quotationAiCommonLegalField)){
    if(new Set(changes.filter(change=>change.fieldKey===field.id).map(change=>change.value)).size>1)return '공통 상품정보고시의 값이 옵션마다 다릅니다.';
  }
  return null;
}
/** Negative evidence checks do not certify translated names as actual product facts. */
export function quotationAiGenerationIssue(field: QuotationField, optionId: string | null, value: string, facts: QuotationGenerationFacts, generationPolicy?:string): string | null {
  if (quotationAiMaterialField(field)) {
    if (value === quotationAiLegalMaterialReference(field, facts, generationPolicy)) return null;
    const expected = generationPolicy === QUOTATION_GENERATION_POLICY || generationPolicy === CANONICAL_QUOTATION_GENERATION_POLICY
      ? quotationAiCanonicalMaterial(field, facts) : undefined;
    if (expected !== undefined && value !== expected) return '원문 재질의 정규화 값과 제안값이 다릅니다.';
    const priority = productFactPriorityIssue(value, 'material', '', facts.material);
    if (priority || unsupportedProductMaterial(value, facts.material.map(pair => pair.value).join('\n'), true)) return priority ?? '상품 원문의 명시된 재질 근거를 확인해주세요.';
    if(facts.material.some(pair=>pair.provenance==='collection-source')){
      const source=facts.material.map(pair=>pair.value).join('\n');
      // The v4 canonical value already proves that every whole material value agrees.
      const explicit = generationPolicy === QUOTATION_GENERATION_POLICY && expected !== undefined
        ? `material: ${expected}` : facts.material.map(pair => `material: ${pair.value}`).join('\n');
      const issue=productFactPriorityIssue(value,'material',explicit);
      const percents=(text:string)=>Array.from(text.matchAll(/(\d+(?:[.,]\d+)*)\s*[%％]/gu),match=>'%:'+match[1]);
      const units=new Set([...productFactQuantityTokens(source),...percents(source)]);
      if(issue||[...productFactQuantityTokens(value),...percents(value)].some(token=>!units.has(token)))return issue??'원문 재질의 수치·단위 근거를 확인해주세요.';
    }
  }
  if (quotationAiOptionColorNotice(field)) {
    if(generationPolicy===QUOTATION_GENERATION_POLICY&&quotationAiCommonLegalField(field))return commonLegalColorSupported(field,value,facts)?null:'공통 색상은 선택 원문 옵션에 연결된 대표값 하나만 사용할 수 있습니다.';
    const own = facts.options.find(option => option.optionId === optionId);
    if (!own) return '선택 옵션의 색상 연결을 확인해주세요.';
    const words = (text: string) => text.match(/[가-힣A-Za-z]{2,}/gu) ?? [];
    const ownReference=quotationAiColorReference(own);if(!ownReference)return null;
    let ownText = (own.color + ' ' + own.translatedName).toLowerCase();
    // Existing source-color aliases exempt only bounded full phrases from this negative check.
    const ownAliases = new Set(ownReference.aliases.map(word => word.toLowerCase()));
    let foreignText = value.toLowerCase();
    for (const alias of [...ownAliases].sort((left, right) => right.length - left.length)) {
      const phrase = alias.trim().split(/\s+/u).map(word => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('\\s+');
      foreignText = foreignText.replace(new RegExp(`(?<![가-힣A-Za-z])${phrase}(?![가-힣A-Za-z])`, 'gu'), ' ');
      ownText = ownText.replace(new RegExp(`(?<![가-힣A-Za-z])${phrase}(?![가-힣A-Za-z])`, 'gu'), ' ');
    }
    const ownWords = new Set(words(ownText)), proposed = new Set(words(foreignText));
    for (const other of facts.options) {
      const otherReference=quotationAiColorReference(other);
      if (other.optionId === optionId || !otherReference || otherReference.key === ownReference.key) continue;
      if (words((other.color + ' ' + other.translatedName + ' ' + otherReference.aliases.join(' ')).toLowerCase()).some(word => !ownWords.has(word) && proposed.has(word)))
        return '다른 옵션의 색상을 선택 옵션에 합치지 마세요.';
    }
  }
  return null;
}

export type QuotationAiProposal = { optionId: string | null; fieldKey: string; value: string };
export type QuotationAiJobView = { id: string; status: 'prepared' | 'running' | 'completed' | 'failed' | 'uncertain'; startedAt?: string | null; canClose?: boolean;
  fingerprint: string; quotationRevision: number; profileId: string | null;
  resultPolicy?:string;model?:string;executionPolicy?:QuotationTextExecution; generationPolicy?:string; generationFacts?:QuotationGenerationFacts;
  scope: { optionId: string | null; applyToAllOptions: boolean };
  result: { changes: QuotationAiProposal[]; warnings: string[]; model: string; generatedAt: string;resultPolicy?:string } | null;
  error: { code: string; message: string; uncertain: boolean } | null };
export type QuotationAiView = { configuration: { configured: boolean; provider: string; model: string; freeOnly: boolean; notice: string };
  fingerprint: string; productId: string; productVersion: string; contentRevision: number; optionRevision: number;
  quotationRevision: number; profileId: string | null; jobs: QuotationAiJobView[]; idempotencyKey?: string; knownChanges?: (QuotationAiProposal & Pick<QuotationSavedNoticeChange, 'savedLabel'>)[] };
/** These are deterministic copies from saved manual/collected sources, returned
 * separately from model output. AI's sensitive-field allowlist remains closed. */
export function quotationSavedSourceChanges(state: QuotationAiView, view: QuotationFieldsView, productId: string, optionId: string | null, all: boolean): QuotationAiProposal[] {
  if (!quotationAiViewCurrent(state, view, productId) || !all && optionId === null) throw Error('저장 정보의 상품·옵션 범위를 다시 확인해주세요.');
  if (optionId !== null && !view.resolved.rows.some(row => row.optionId === optionId && row.included)) throw Error('저장 정보를 적용할 포함 옵션을 확인해주세요.');
  const changes = state.knownChanges ?? [], seen = new Set<string>();
  if (!Array.isArray(changes) || changes.length > 2000) throw Error('저장 정보의 항목을 다시 확인해주세요.');
  for (const change of changes) {
    const field = view.resolved.schema.fields.find(item => item.id === change?.fieldKey), row = view.resolved.rows.find(item => item.optionId === change?.optionId);
    const cell = field && row?.fields[field.id], key = JSON.stringify([change?.optionId, change?.fieldKey]);
    const target = field && quotationKnownNoticeTarget(field, true);
    const savedLabel = change?.savedLabel;
    const savedLabelMatches = savedLabel !== null && typeof savedLabel === 'object' && !Array.isArray(savedLabel)
      && Object.keys(savedLabel).length === 2 && Object.hasOwn(savedLabel, 'revision') && Object.hasOwn(savedLabel, 'previousValue')
      && Number.isSafeInteger(savedLabel.revision) && savedLabel.revision > 0 && typeof savedLabel.previousValue === 'string'
      && savedLabel.previousValue.trim() !== '' && !isCouplusNotApplicableValue(savedLabel.previousValue)
      && view.resolved.schema.status === 'observed' && Boolean(view.resolved.schema.categoryId)
      && view.resolved.schema.categoryId === view.categoryContext.categoryId
      && JSON.stringify(view.resolved.schema.categoryPath) === JSON.stringify(view.categoryContext.categoryPath)
      && target !== 'quantity' && target !== 'color' && cell?.source === 'content' && cell.value === savedLabel.previousValue && change.value !== cell.value;
    if (Object.hasOwn(change ?? {}, 'savedLabel') && !savedLabelMatches) throw Error('저장 표시사항의 이전 자동값을 다시 확인해주세요.');
    const replaceable = cell && (target === 'quantity' ? cell.source === 'option' && /^\d+$/u.test(cell.value)
      && typeof change?.value === 'string' && quotationSavedQuantityText(change.value, Number(cell.value))
      : cell.source === 'couplus-default' && isCouplusNotApplicableValue(cell.value) || savedLabelMatches);
    if (!field || !target || !row?.included || !replaceable || typeof change.value !== 'string' || !change.value.trim() || isCouplusNotApplicableValue(change.value)
      || Object.hasOwn(view.overrides.common, field.id) || row.optionId !== null && Object.hasOwn(view.overrides.options[row.optionId] ?? {}, field.id)
      || seen.has(key) || quotationValueIssues(field, change.value).length) throw Error('저장 정보의 카테고리·옵션·수동 입력을 다시 확인해주세요.');
    seen.add(key);
  }
  // The prior-value proof is for review only. Ordinary quotation saves receive
  // the same three-field changes as before, under their existing CAS guards.
  return changes.filter(change => all || change.optionId === optionId).map(change => ({ optionId: change.optionId, fieldKey: change.fieldKey, value: change.value }));
}
export function quotationReviewedProposalChanges(state: QuotationAiView, view: QuotationFieldsView, productId: string, job: QuotationAiJobView | null, optionId: string | null, all: boolean) {
  if (!quotationAiViewCurrent(state, view, productId)) throw Error('현재 견적 자료를 다시 확인해주세요.');
  if (!job) return [];
  const changes = quotationAiScopedProposalChanges(view, job, state.fingerprint, optionId, all);
  const currentRows = new Map(view.resolved.rows.map(row => [row.optionId, row.fields] as const));
  // The completed job retains its raw receipt. Existing N/A defaults need no adoption.
  return changes.filter(change => {
    const cell = currentRows.get(change.optionId)?.[change.fieldKey];
    return !(cell && (cell.source === 'couplus-default' || cell.source === 'schema')
      && cell.value === change.value && isCouplusNotApplicableValue(change.value));
  });
}
export function quotationAiViewCurrent(value: QuotationAiView, view: QuotationFieldsView, productId: string) {
  return value.productId === productId && /^[a-f0-9]{64}$/.test(value.fingerprint)
    && value.productVersion === view.productVersion && value.contentRevision === view.contentRevision
    && value.optionRevision === view.optionRevision && value.quotationRevision === view.revision
    && value.profileId === view.categoryContext.profileId;
}
/** Reuse one completed whole-product draft across option editors. An unresolved
 * execution remains visible for recovery even after its source was edited. */
export function quotationAiJobForScope(value: QuotationAiView, view: QuotationFieldsView, productId: string, optionId: string | null, all: boolean) {
  if (!quotationAiViewCurrent(value, view, productId)) return null;
  const jobs = value.jobs.filter(job => job.profileId === value.profileId);
  const unsettled = jobs.find(job => job.status === 'running' || job.status === 'uncertain');
  if (unsettled) return unsettled;
  const current = jobs.filter(job => job.fingerprint === value.fingerprint && job.quotationRevision === view.revision);
  if (all) return current.find(job => job.scope.applyToAllOptions) ?? null;
  if (optionId === null) return null;
  return current.find(job => !job.scope.applyToAllOptions && job.scope.optionId === optionId)
    ?? current.find(job => job.scope.applyToAllOptions) ?? null;
}
export function quotationAiScopedProposalChanges(view: QuotationFieldsView, job: QuotationAiJobView, fingerprint: string, optionId: string | null, all: boolean) {
  if (all && !job.scope.applyToAllOptions || !all && optionId === null) throw Error('AI 초안을 적용할 옵션 범위를 확인해주세요.');
  const changes = quotationAiProposalChanges(view, job, fingerprint);
  return all ? changes : changes.filter(change => change.optionId === optionId);
}
function writableAiField(field: QuotationField) {
  const wire = field.hubWire;
  return !field.readOnly && wire?.name && wire.nameKey && wire.valueKey && !field.hubInput
    && !/인증|허가|신고|제조국|원산지|제조자|제조사|수입자|수입신고|책임자|전화번호|품질보증|출시|제조년|유통|소비기한|바코드|GTIN|Global Trade|Manufacturer Part Number|모델명|품번|포장|가격|원가|단가|판매가|공급가|MSRP|OSRP|Price|동의|약관/iu.test(wire.name)
    && (['productPage.commonAttributes.exposedAttributes', 'productPage.unexposedAttributes'].includes(wire.path.join('.'))
      && wire.nameKey === 'attributeName' && wire.valueKey === 'attributeValue'
      || wire.path.join('.') === 'legalPage.notices' && wire.nameKey === 'noticeItemName' && ['noticeItemValue', 'noticeContent'].includes(wire.valueKey))
    && field.type !== 'images' && !['image', 'logistics'].includes(field.section)
    && !/cert|agree|barcode/i.test(field.id) && !/cert|agree|barcode/i.test(JSON.stringify(wire.path))
    && !['supplyPrice', 'salePrice', 'msrp', 'osrp'].includes(field.hubInput ?? '');
}
/** Recheck every proposed target before placing anything in an unsaved editor. */
export function quotationAiProposalChanges(view: QuotationFieldsView, job: QuotationAiJobView, fingerprint: string) {
  if(job.generationPolicy!==undefined&&(!validQuotationGenerationPolicy(job.generationPolicy)||!job.generationFacts))throw Error('견적 생성 정책과 근거를 확인해주세요.');
  if(job.resultPolicy!==undefined&&(job.resultPolicy!==CURRENT_QUOTATION_RESULT_POLICY||job.result?.resultPolicy!==job.resultPolicy))throw Error('견적 결과 규칙이 다릅니다.');
  if(job.executionPolicy!==undefined&&!validQuotationTextExecution(job.executionPolicy))throw Error('견적 AI 실행 정책을 확인해주세요.');
  if(job.result&&job.result.model!==quotationTextModel(job.executionPolicy)||job.model!==undefined&&job.model!==quotationTextModel(job.executionPolicy))throw Error('견적 AI의 검토 모델과 결과 모델이 다릅니다.');
  if (job.status !== 'completed' || job.fingerprint !== fingerprint || job.quotationRevision !== view.revision
    || job.profileId !== view.categoryContext.profileId || !job.result || !Array.isArray(job.result.changes))
    throw Error('현재 견적서에 연결된 완료 초안을 확인해주세요.');
  // Match the persisted result's byte bound and the generator's 300-field bound.
  const fields = new Set(view.resolved.schema.fields.filter(writableAiField).map(field => field.id));
  const rows = new Set(view.resolved.rows.filter(row => row.included && (job.scope.applyToAllOptions || row.optionId === job.scope.optionId)).map(row => row.optionId));
  if (job.result.changes.length > Math.min(fields.size, 300) * rows.size || new TextEncoder().encode(JSON.stringify(job.result)).length > 256 * 1024)
    throw Error('AI 초안의 항목 수 또는 응답 크기가 현재 양식·옵션 처리 범위를 초과했습니다.');
  if(job.generationPolicy===QUOTATION_GENERATION_POLICY){const issue=quotationAiCommonLegalIssue(view.resolved.schema.fields,job.result.changes);if(issue)throw Error(issue);}
  const seen = new Set<string>(), proposedFields = new Set<string>();
  return job.result.changes.map(change => {
    if (!change || typeof change.fieldKey !== 'string' || typeof change.value !== 'string') throw Error('AI 초안의 입력 자료형을 확인해주세요.');
    const field = view.resolved.schema.fields.find(item => item.id === change.fieldKey), row = view.resolved.rows.find(item => item.optionId === change.optionId);
    const key = JSON.stringify([change.optionId, change.fieldKey]);
    proposedFields.add(change.fieldKey);
    if (seen.has(key) || proposedFields.size > 300 || !field || !writableAiField(field) || !row || !row.included || !quotationGeneratedSourceWritable(row.fields[field.id]?.source)
      || !job.scope.applyToAllOptions && change.optionId !== job.scope.optionId
      || quotationValueIssues(field, change.value).length)
      throw Error('AI 초안의 카테고리·옵션·수동 입력 또는 허용값을 다시 확인해주세요.');
    if(job.generationPolicy){const issue=quotationAiGenerationIssue(field,change.optionId,change.value,job.generationFacts!,job.generationPolicy);if(issue)throw Error(issue);}
    seen.add(key); return { optionId: change.optionId, fieldKey: change.fieldKey, value: change.value };
  });
}

export type QuotationGeneratedDraft = { jobId: string; proposals: QuotationAiProposal[] };
/** Only untouched proposals retain the owned-job proof; edits are manual deltas. */
export function quotationGeneratedSave(changes: readonly {optionId:string|null;fieldKey:string;value:string|null}[], draft?: QuotationGeneratedDraft | null) {
  const untouched = draft ? changes.filter(change => draft.proposals.some(proposal => proposal.optionId === change.optionId && proposal.fieldKey === change.fieldKey && proposal.value === change.value)) : [];
  return { changes: changes.filter(change => !untouched.includes(change)), ...(draft && untouched.length ? { generatedAdoption: { jobId: draft.jobId,
    targets: untouched.map(({optionId,fieldKey})=>({optionId,fieldKey})) } } : {}) };
}
