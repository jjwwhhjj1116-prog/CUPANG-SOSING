import {prioritizedContentLabelFields} from '@/app/product-fact-priority';
import {currentLabelCountLiterals,currentLabelNoticeNames} from '@/app/current-label-attribute-literals';
import type {ProductContent} from '@/app/product-content';
import type {ProductOptions} from '@/app/product-options';
import type {WorkspaceSettings} from '@/app/workspace-settings';
import type {QuotationOverrides,QuotationSchema} from '@/app/quotation-schema';
export const CURRENT_LABEL_POLICY='couplus-current-label-suggestion-v1' as const;
export const currentLabelHan=(value:string)=>/[㐀-䶿一-鿿]/u.test(value);
export function contentForCurrentBundle(content:string,q:number):string{
 q=Number(q)||1;if(q<=1)return content;if(!content.trim()||content.trim()==='상세정보참조')return `${q}개`;
 const bundle=/(\d+)\s*(개입|개|쌍|매|장|세트|팩|입|P|p)?\s*묶음/u;
 if(bundle.test(content))return content.replace(bundle,(_all,count,unit)=>`${Number(count)===q?count:q}${unit??''} 묶음`);
 if(/(^|[^0-9])1\s*(개|쌍|매|장|세트|팩|켤레|병|봉|박스|캔|포|족|권|롤|자루)$/u.test(content))return content.replace(/(^|[^0-9])1\s*(개|쌍|매|장|세트|팩|켤레|병|봉|박스|캔|포|족|권|롤|자루)$/u,`$1${q}$2`);
 return `${content} x ${q}개`;
}
export function normalizeCurrentLabelContent(content:string,q:number):string{
 q=Number(q)>0?Number(q):1;const value=contentForCurrentBundle(content.trim(),q);
 if(new RegExp(currentLabelCountLiterals.i.pattern,currentLabelCountLiterals.i.flags).test(value)||new RegExp(currentLabelCountLiterals.c.pattern,currentLabelCountLiterals.c.flags).test(value))return value;
 return !value||value==='상세정보참조'?`${q}개`:`${value} / ${q}개`;
}
export function cleanCurrentNotice(value:string):string|undefined{
 const clean=value.trim().replace(/\s*[（(][^()（）]*(?:공급처|표기|메모|견적)[^()（）]*[)）]\s*$/u,'').trim();
 return !clean||/해당\s*(사항)?\s*없음|상세.*(참조|확인)/u.test(clean)||currentLabelHan(clean)?undefined:clean;
}
/** Only genuine saved quote edits or independent content facts; never resolved label feedback. */
export function currentSavedLabelNotices(schema:QuotationSchema,overrides:QuotationOverrides,optionId:string|null,content:ProductContent,includeContent=true):{material?:string;netContents?:string}{
 const fields=schema.fields.filter(field=>field.section==='legal'&&field.visibility==='common'&&field.hubWire?.path.join('.')==='legalPage.notices'&&field.hubWire.name===field.label&&field.hubWire.nameKey==='noticeItemName'&&['noticeItemValue','noticeContent'].includes(field.hubWire.valueKey??''));
 const values=(names:readonly string[])=>{for(const name of names){const field=fields.find(field=>field.label.trim()===name);if(!field)continue;const own=optionId===null?undefined:overrides.options[optionId];const raw=own&&Object.hasOwn(own,field.id)?own[field.id]:Object.hasOwn(overrides.common,field.id)?overrides.common[field.id]:undefined;if(raw!==undefined){const value=cleanCurrentNotice(raw);if(value)return value;}}};
 const material=values(currentLabelNoticeNames.material),netContents=values(currentLabelNoticeNames.content);
 // Independent saved content can support a notice, but a generated or unverified draft cannot.
 const fact=(key:'material'|'components'|'netContents')=>{if(!includeContent)return;const field=prioritizedContentLabelFields(content)[key];return field&&['manual','collected','translated'].includes(field.provenance)?cleanCurrentNotice(field.value):undefined;};
 return{...(material??fact('material')?{material:material??fact('material')}:{}),...(netContents??fact('components')??fact('netContents')?{netContents:netContents??fact('components')??fact('netContents')}: {})};
}
export type LabelSuggestionKey='netContents'|'material'|'productType';
export type LabelSuggestionEntry={optionId:string|null;fieldKey:LabelSuggestionKey;value:string;classification:'suggestion'|'default'};
export type LabelAutomaticSuggestions={policy:typeof CURRENT_LABEL_POLICY;basis:string;entries:LabelSuggestionEntry[]};
export function labelSuggestionBasis(input:{content:ProductContent;options:ProductOptions;settings:WorkspaceSettings;categoryId:string|null;categoryPath:readonly string[];overrides:QuotationOverrides;schema?:QuotationSchema;settingsPayload?:string|null}):string{
 const field=(value:{value:unknown;provenance:string})=>({value:value.value,provenance:value.provenance});
 return JSON.stringify({policy:CURRENT_LABEL_POLICY,categoryId:input.categoryId,categoryPath:input.categoryPath,categoryAttributes:input.content.categoryAttributes,label:Object.fromEntries(Object.entries(input.content.label).map(([key,value])=>[key,field(value)])),detail:input.content.detail?.description?field(input.content.detail.description):field(input.content.seo.description),title:field(input.content.seo.title),options:input.options.rows.map(row=>({id:row.id,included:row.included,originalName:row.originalName,translatedName:row.translatedName,unitsPerPack:row.unitsPerPack,color:row.color,size:row.size,widthCm:row.widthCm,lengthCm:row.lengthCm,heightCm:row.heightCm,weightKg:row.weightKg})),bundles:input.options.bundleSources??{},schema:input.schema?.fields.map(field=>({id:field.id,wire:field.hubWire,type:field.type,choices:field.choices})),settings:Object.fromEntries(Object.entries(input.settingsPayload?JSON.parse(input.settingsPayload):input.settings).filter(([key])=>!/image|banner|logo|font/iu.test(key))),manualNotices:input.schema?Object.fromEntries(input.schema.fields.filter(field=>field.hubWire?.path.join('.')==='legalPage.notices'&&[...currentLabelNoticeNames.material,...currentLabelNoticeNames.content].includes(field.label as typeof currentLabelNoticeNames.material[number])).map(field=>[field.id,{wire:field.hubWire,common:input.overrides.common[field.id],options:Object.fromEntries(Object.entries(input.overrides.options).filter(([,values])=>Object.hasOwn(values,field.id)).map(([key,values])=>[key,values[field.id]]))}])):input.overrides});
}
/** Per-option drafts depend only on that option's facts; sibling/exclusion edits do not resend its PNG. */
export function labelSuggestionApplies(layer:LabelAutomaticSuggestions,optionId:string|null,basis:string):boolean{
 if(layer.basis===basis)return true;
 const project=(raw:string)=>{const value=JSON.parse(raw);value.options=value.options.filter((row:{id:string})=>row.id===optionId).map((row:Record<string,unknown>)=>{const copy={...row};delete copy.included;return copy;});value.bundles=optionId===null?{}:{[optionId]:value.bundles[optionId]};for(const notice of Object.values(value.manualNotices??{}) as {options:Record<string,unknown>}[])notice.options=optionId===null?{}:{[optionId]:notice.options[optionId]};return JSON.stringify(value);};
 try{return project(layer.basis)===project(basis);}catch{return false;}
}
export function currentLabelBundleQuantity(options:ProductOptions,optionId:string|null):number{
 const bundle=optionId===null?undefined:options.bundleSources?.[optionId];return bundle&&Number.isSafeInteger(bundle.quantity)&&bundle.quantity>1?bundle.quantity:1;
}

export function validateLabelSuggestions(input:unknown):LabelAutomaticSuggestions|undefined{
 if(input===undefined)return;if(!input||typeof input!=='object'||Array.isArray(input))throw Error('표시사항 초안 형식이 다릅니다.');const value=input as LabelAutomaticSuggestions;
 if(value.policy!==CURRENT_LABEL_POLICY||typeof value.basis!=='string'||value.basis.length>350000||!Array.isArray(value.entries)||value.entries.length>603)throw Error('표시사항 초안 범위를 확인해주세요.');
 const seen=new Set<string>();for(const entry of value.entries){const key=JSON.stringify([entry.optionId,entry.fieldKey]);if(!entry||!['netContents','material','productType'].includes(entry.fieldKey)||entry.optionId!==null&&(typeof entry.optionId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/u.test(entry.optionId))||typeof entry.value!=='string'||!entry.value||entry.value.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(entry.value)||!['suggestion','default'].includes(entry.classification)||seen.has(key))throw Error('표시사항 초안 항목을 확인해주세요.');seen.add(key);}return structuredClone(value);
}
