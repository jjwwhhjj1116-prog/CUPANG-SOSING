import type {NativeAssetSourceIssue,NativeAssetSourcePlan} from '@/app/native-asset-source-plan';
import type {QuotationFieldsView} from '@/app/quotation-schema';

export type NativeSourceIssueGroup={key:string;level:NativeAssetSourceIssue['level'];message:string;context:string;count:number};
const label=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null;
/** Presentation only: retain every occurrence and its severity. Never use a
 * grouped count or a display label to decide whether transmission is allowed. */
export function nativeSourceIssueGroups(issues:readonly NativeAssetSourceIssue[],view:QuotationFieldsView,identity:NativeAssetSourcePlan['identity']):NativeSourceIssueGroup[]{
 const fields=Array.isArray(view.resolved?.schema?.fields)?view.resolved.schema.fields:[],members=Array.isArray(identity?.members)?identity.members:[];
 const fieldLabels=new Map<string,string|null>(),optionLabels=new Map<string,string|null>();
 for(const field of fields)fieldLabels.set(field.id,fieldLabels.has(field.id)?null:label(field.label));
 for(const member of members)optionLabels.set(member.optionId,optionLabels.has(member.optionId)?null:label(member.optionLabel));
 const groups=new Map<string,{group:NativeSourceIssueGroup;options:Map<string,string>;fieldLabel:string|null}>();
 for(const issue of issues){
  // Distinct unknown fields/files stay separate even if their safe fallback
  // labels happen to match. No private key or raw field/option ID is displayed.
  const fieldId=typeof issue.fieldId==='string'&&issue.fieldId?issue.fieldId:null;
  const fieldLabel=fieldId?(fieldLabels.get(fieldId)??'항목 확인 필요'):null;
  const optionId=typeof issue.optionId==='string'&&issue.optionId?issue.optionId:null;
  const optionKey=optionId?JSON.stringify(['option',optionId]):issue.optionId===null?'common':'document';
  const optionLabel=optionId?(optionLabels.get(optionId)??'옵션 확인 필요'):issue.optionId===null?'상품 공통':'전송 자료 전체';
  const key=JSON.stringify([issue.level,issue.code,fieldId,issue.key??null,issue.message]);
  let saved=groups.get(key);
  if(!saved){saved={group:{key,level:issue.level,message:issue.message,context:'',count:0},options:new Map(),fieldLabel};groups.set(key,saved);}
  saved.group.count++;saved.options.set(optionKey,optionLabel);
 }
 return [...groups.values()].map(({group,options,fieldLabel})=>({...group,context:[...options.values()].join(', ')+(fieldLabel?' · '+fieldLabel:'')}));
}
