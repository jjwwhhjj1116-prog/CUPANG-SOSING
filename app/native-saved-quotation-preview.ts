import type {NativeAssetSourcePlan} from '@/app/native-asset-source-plan';
import type {QuotationField,QuotationFieldsView} from '@/app/quotation-schema';
import {isOwnedImageKey} from '@/app/image-files';

type Value={id:string;label:string;value:string;primary:boolean};
type Image={key:string;role:string;filename:string;href:string|null};
export type NativeSavedOptionPreview={optionId:string;optionLabel:string;title:string;values:Value[];images:Image[]};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const scalar=(value:unknown)=>typeof value==='string'||typeof value==='number'||typeof value==='boolean'?String(value):'';
const roles={MAIN:'대표',ADDITIONAL:'추가',SIZECHART:'사이즈표',LABEL:'표시사항',DETAIL:'상세'};
function readWire(document:unknown,field:QuotationField):unknown{
 const wire=field.hubWire;if(!wire)return undefined;
 let value=document;
 for(const key of wire.path){if(!object(value)||!Object.hasOwn(value,key))return undefined;value=value[key];}
 if(wire.name!==undefined){
  if(!Array.isArray(value)||!wire.nameKey||!wire.valueKey)return undefined;
  const matches=value.filter(row=>object(row)&&Object.hasOwn(row,wire.nameKey!)&&row[wire.nameKey!]===wire.name);
  return matches.length===1&&Object.hasOwn(matches[0],wire.valueKey)?matches[0][wire.valueKey]:undefined;
 }
 return value;
}
function displayed(value:unknown,field:QuotationField):string{
 if(value===undefined)return '미입력';
 if(value===null||value==='')return '빈 값';
 const literal=scalar(value);if(!literal)return '값 확인 필요';
 const label=field.choices?.find(choice=>choice.value===literal)?.label??literal;
 return field.unit?`${label} ${field.unit}`:label;
}
/** This display reads the current candidate body even when submission is blocked.
 * It never compiles a transport review or fills absent values from defaults. */
export function nativeSavedQuotationPreview(plan:NativeAssetSourcePlan,view:QuotationFieldsView):NativeSavedOptionPreview[]{
 const identity=plan.identity,body=plan.body;
 if(!identity||!body||!Array.isArray(body.jsonDocument)||identity.inputFingerprint!==view.inputFingerprint
  ||identity.categoryId!==view.categoryContext.categoryId||identity.source.productVersion!==view.productVersion
  ||identity.source.contentRevision!==view.contentRevision||identity.source.optionRevision!==view.optionRevision
  ||identity.source.quotationRevision!==view.revision)return [];
 const included=view.resolved.rows.filter(row=>row.included);
 if(identity.members.length!==included.length||identity.members.some((member,index)=>member.optionId!==included[index].optionId||member.documentIndex!==index))return [];
 const fields=view.resolved.schema.fields.filter(field=>field.hubWire&&field.section!=='image'&&field.hubWire.path.join('.')!=='startPage.categoryPath'&&field.hubWire.path.join('.')!=='startPage.productName');
 return identity.members.flatMap(member=>{
  const document=body.jsonDocument[member.documentIndex];if(!object(document))return [];
  const title=object(document.startPage)?scalar(document.startPage.productName):'';
  const values=fields.map(field=>({id:field.id,label:field.label,value:displayed(readWire(document,field),field),
   primary:['model','brand','supplyPrice','salePrice','msrp','packagedWeightG','packagedDimensionsMm'].includes(field.hubInput??field.id)
    ||field.visibility==='exposed'||/제조국|원산지/u.test(field.label)}));
  const images=plan.images.filter(file=>file.references.some(ref=>ref.optionId===member.optionId&&ref.documentIndex===member.documentIndex)).map(file=>({
   key:file.key,role:roles[file.imageType],filename:file.transportName,
   href:view.imageKeys.includes(file.key)&&isOwnedImageKey(identity.ownerId,file.key)?`/api/files/${file.key.split('/').map(encodeURIComponent).join('/')}`:null,
  }));
  return [{optionId:member.optionId,optionLabel:member.optionLabel,title:title||'상품명 미입력',values,images}];
 });
}
