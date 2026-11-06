import {currentAttributeLiterals as literals} from '@/app/current-label-attribute-literals';
import type {QuotationField} from '@/app/quotation-schema';
import type {HubSchemaSnapshot} from '@/app/supplier-hub-schema';
export const CURRENT_QUOTATION_RESULT_POLICY='couplus-current-attributes-2026-11-v1' as const;
export const currentQuantityUnits=literals.c.QUANTITY;
export type AttributeRule={fieldKey:string;name:string;hidden:boolean;generationMandatory:boolean;applyRequired:boolean;group?:string;unit?:unknown;mandatory:boolean};
export function currentAttributeRules(snapshot:HubSchemaSnapshot,fields:readonly QuotationField[]):AttributeRule[]{
 const raw=JSON.parse(snapshot.schemaString);return fields.flatMap(field=>{
  const wire=field.hubWire,path=wire?.path.join('.');if(!wire||wire.nameKey!=='attributeName'||wire.valueKey!=='attributeValue'||wire.name!==field.label||!['productPage.commonAttributes.exposedAttributes','productPage.unexposedAttributes'].includes(path??''))return[];
  let node=raw;for(const key of wire.path)node=node?.properties?.[key];
  const item=node?.allOf?.find((item:{contains?:{properties?:Record<string,{enum?:unknown[]}>}})=>item.contains?.properties?.attributeName?.enum?.[0]===wire.name),name=item?.contains?.properties?.attributeName;
  if(!name)return[];return[{fieldKey:field.id,name:wire.name!,hidden:path==='productPage.unexposedAttributes',generationMandatory:Boolean(name.mandatory),applyRequired:name.requirement==='필수',mandatory:name.mandatory===true||name.requirement==='필수',...(name.attributeDataType==='NUMBER'?{group:String(name.attributeUnitGroup??''),...(name.attributeUnit===undefined?{}:{unit:name.attributeUnit})}: {})}];
 });
}
export function normalizeCurrentAttributeNumber(input:string|null|undefined,rule:Pick<AttributeRule,'group'|'mandatory'>):{value:string|null|undefined;extra?:string;note?:string;error?:string}{
 if(!rule.group||input==null||!input.trim())return{value:input};let value=input.trim();
 value=value.replace(/^(?:약|대략|최대)\s*(?=\d)/u,'');
 if(rule.group==='QUANTITY'&&value.includes('+')){const [primary,...extra]=value.split('+'),result=normalizeCurrentAttributeNumber(primary.trim(),rule);return result.error?result:{...result,...(extra.join('+').trim()?{extra:extra.join('+').trim()}: {})};}
 const match=/^(\d[\d.,]*)\s*(.*)$/u.exec(value);
 if(!match)return !rule.mandatory&&!/\d/u.test(value)?{value:null,note:'숫자 없는 선택 속성은 null로 표시했습니다.'}:{value:input,error:'숫자로 시작하는 속성 단위를 확인해주세요.'};
 const allowed:readonly string[]=(literals.c as Record<string,readonly string[]>)[rule.group]??[],numeric=match[1],unit=match[2].trim();if(!allowed.length||!unit)return{value:numeric+unit};
 const resolve=(unit:string):string|undefined=>{if(allowed.includes(unit))return unit;const alias=(literals.l as Record<string,string>)[unit];if(alias&&allowed.includes(alias))return alias;const matches=allowed.filter(item=>item.toLowerCase()===unit.toLowerCase());return matches.length===1?matches[0]:undefined;};
 let normalized=resolve(unit);
 if(!normalized)for(const suffix of literals.u){const trimmed=unit.replace(new RegExp('\\s*'+suffix+'$','iu'),'').trim();if(trimmed!==unit&&(normalized=resolve(trimmed)))break;}
 return normalized?{value:numeric+normalized,...(numeric+normalized!==input?{note:'속성 단위 표기를 정규화했습니다.'}: {})}:{value:input,error:'속성 단위 오류(쿠팡이 받지 않는 단위)'};
}
export function mandatoryHiddenProblems(rules:readonly AttributeRule[],read:(id:string)=>string|undefined,fields:readonly QuotationField[],mode:'generation'|'application'):string[]{
 return rules.filter(rule=>rule.hidden&&(mode==='generation'?rule.generationMandatory:rule.applyRequired)).flatMap(rule=>{const value=read(rule.fieldKey),field=fields.find(field=>field.id===rule.fieldKey);return value===undefined||!value.trim()||/[㐀-䶿一-鿿豈-﫿]/u.test(value)||Boolean(field?.choices&&!field.choices.some(choice=>choice.value===value))?[rule.name]:[];});
}
