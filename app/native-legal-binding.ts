import {projectSupplierHubSingleDocument,type SingleProjectionInput} from '@/app/supplier-hub-single-projection';
import {readLegalDocuments,readNativeLegalBinding,type LegalDocument,type LegalDocuments} from '@/app/legal-documents';
import {compileHubQuotationSchema,type HubWireField} from '@/app/supplier-hub-schema';

export type NativeLegalType='certificate'|'msds'|'additional'|'import_type'|'categoryCert'|'adCert';
type Primitive=string|number|boolean|null;
export type NativeLegalBinding={format:'supplier-hub-native-legal-binding-v1';schemaSha256:string;categoryId:string;nativeType:NativeLegalType;
 certificate?:{schemaIndex:number;fieldId:string;path:['legalPage','certificates'];nameKey:string;valueKey:string;name:string;value:Primitive}};
export type NativeLegalIssue={code:string;message:string;key?:string;fieldId?:string};
export type NativeLegalTarget={id:string;label:string;binding:NativeLegalBinding};
export type NativeLegalContext={schemaSha256:string;categoryId:string;company:SingleProjectionInput['company'];targets:NativeLegalTarget[];issues:NativeLegalIssue[];
 files:LegalDocument[];registered:false;remoteWrites:false;submissionReady:false};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
function ordered(value:unknown):unknown{return value&&typeof value==='object'?Array.isArray(value)?value.map(ordered):Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered((value as Record<string,unknown>)[key])])):value;}
const same=(left:unknown,right:unknown)=>JSON.stringify(ordered(left))===JSON.stringify(ordered(right));
const wireKey=(wire:HubWireField)=>JSON.stringify([wire.path,wire.nameKey??null,wire.valueKey??null,wire.name??null]);
const primitive=(value:unknown):value is Primitive=>value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);
const bucketTypes:Exclude<NativeLegalType,'certificate'>[]=['msds','additional','import_type','categoryCert','adCert'];
function documents(input:LegalDocuments|undefined):LegalDocument[]{
 if(input===undefined)return [];
 // The pure context does not choose an owner/product from caller metadata.
 // Extract their exact structural path, then use the existing original reader.
 const first=input.files?.[0],parts=typeof first?.key==='string'?first.key.split('/'):[];
 if(!first)return readLegalDocuments(input,'','').files;
 if(parts.length!==4||parts[1]!=='legal'||!parts[0]||!parts[2])throw Error('저장된 원본 서류 경로를 확인해주세요.');
 return readLegalDocuments(input,parts[0],parts[2]).files;
}
/** Local metadata plan only. A target is compiled from the exact current
 * schema and all included saved option documents, never the first option or a
 * guessed certificate/NA name. It does not change any stage-seven value. */
export async function buildNativeLegalContext(input:SingleProjectionInput&{documents?:LegalDocuments}):Promise<NativeLegalContext>{
 const projection=await projectSupplierHubSingleDocument(input),compiled=compileHubQuotationSchema(input.snapshot),raw=JSON.parse(input.snapshot.schemaString);
 const files=documents(input.documents),issues:NativeLegalIssue[]=[],targets:NativeLegalTarget[]=[];
 const add=(code:string,message:string,fieldId?:string,key?:string)=>issues.push({code,message,...(fieldId?{fieldId}:{}),...(key?{key}:{})});
 const legalPage=object(raw.properties)&&object(raw.properties.legalPage)?raw.properties.legalPage:{};
 const legal=object(legalPage.properties)?legalPage.properties:{};
 const included=input.resolved.rows.filter(row=>row.included),docs=projection.payload.jsonDocument;
 const base={format:'supplier-hub-native-legal-binding-v1' as const,schemaSha256:projection.schemaSha256,categoryId:input.categoryId};
 const shared=(fieldId:string,values:unknown[]):values is Primitive[]=>{
  const cells=included.map(row=>row.fields[fieldId]);
  const label=compiled.fields.find(field=>field.id===fieldId)?.label??'법적 정보';
  // The quotation's generic "check actual evidence" review flag is retained
  // in stage seven. Choosing a file target never clears or proves that review.
  if(values.length!==included.length||values.some(value=>!primitive(value))||cells.some(cell=>!cell||cell.validationIssues?.length)){
   add('NATIVE_LEGAL_VALUE_UNCONFIRMED',`${label}: 원문 양식에 맞게 저장하고 검토한 법적 정보가 필요합니다.`,fieldId);return false;
  }
  if(values.some(value=>!same(value,values[0]))){add('NATIVE_LEGAL_OPTION_DISAGREEMENT',`${label}: 포함 옵션별 법적 정보가 달라 공유 원본 서류에 연결할 수 없습니다.`,fieldId);return false;}
  return true;
 };
 const certificates=object(legal.certificates)&&Array.isArray(legal.certificates.allOf)?legal.certificates.allOf:[];
 for(const [schemaIndex,entry] of certificates.entries()){
  const properties=object(entry)&&object(entry.contains)&&object(entry.contains.properties)?entry.contains.properties:null;
  if(!properties)throw Error('인증 행의 원문 양식을 확인해주세요.');
  const fields=compiled.fields.filter(field=>{
   const wire=field.hubWire,name=wire.nameKey&&properties[wire.nameKey];
   return same(wire.path,['legalPage','certificates'])&&wire.nameKey&&wire.valueKey&&object(name)&&Array.isArray(name.enum)&&name.enum.length===1&&name.enum[0]===wire.name&&Object.hasOwn(properties,wire.valueKey);
  });
  if(fields.length!==1)throw Error('인증 행의 원문 연결이 중복되었거나 모호합니다.');
  const field=fields[0],wire=field.hubWire;
  const values=docs.map(document=>{const page=document.legalPage;const rows=object(page)&&Array.isArray(page.certificates)?page.certificates:[];const row=rows[schemaIndex];
   return object(row)&&row[wire.nameKey!]===wire.name?row[wire.valueKey!]:undefined;});
  if(!shared(field.id,values))continue;
  const binding=readNativeLegalBinding({...base,nativeType:'certificate',certificate:{schemaIndex,fieldId:field.id,path:['legalPage','certificates'],nameKey:wire.nameKey,valueKey:wire.valueKey,name:wire.name,value:values[0]}});
  targets.push({id:'certificate:'+field.id,label:`인증서 ${schemaIndex+1} · ${wire.name}`,binding});
 }
 for(const nativeType of bucketTypes){
  // Only an exact schema property is offered. The retained native file store
  // has more buckets than any one category; absence is never applicability.
  if(!Object.hasOwn(legal,nativeType))continue;
  const fields=compiled.fields.filter(field=>wireKey(field.hubWire)===wireKey({path:['legalPage',nativeType]}));
  if(fields.length!==1){add('NATIVE_LEGAL_BUCKET_UNVERIFIED','이 서류 영역의 현재 원문 항목 연결을 확인하지 못했습니다.');continue;}
  const field=fields[0],values=docs.map(document=>object(document.legalPage)?document.legalPage[nativeType]:undefined);
  // An untouched optional property may legitimately be absent from every
  // saved option document. That absence offers no file target and says
  // nothing about applicability. Never discard an existing file binding.
  if(!(Array.isArray(legalPage.required)&&legalPage.required.includes(nativeType))
   &&included.length>0&&docs.length===included.length
   &&docs.every(document=>object(document.legalPage)&&!Object.hasOwn(document.legalPage,nativeType))
   &&included.every(row=>{const cell=row.fields[field.id];return cell?.source==='empty'&&cell.value===''&&!cell.validationIssues?.length;})
   &&!projection.review.issues.some(issue=>issue.level==='error'&&issue.fieldId===field.id)
   &&!files.some(file=>file.nativeBinding?.nativeType===nativeType))continue;
  if(!shared(field.id,values))continue;
  targets.push({id:'bucket:'+nativeType,label:nativeType,binding:readNativeLegalBinding({...base,nativeType})});
 }
 const seen=new Map<string,string>();
 for(const file of files){
  if(!file.nativeBinding){add('NATIVE_LEGAL_UNBOUND','기존 원본 서류는 자동 연결하지 않습니다. 현재 양식의 서류 영역을 직접 선택해주세요.',undefined,file.key);continue;}
  const target=targets.find(target=>same(target.binding,file.nativeBinding));
  if(!target){add('NATIVE_LEGAL_STALE_BINDING','서류 연결 당시 양식·분류·인증 행·저장값이 현재 견적서와 다릅니다. 연결을 다시 확인해주세요.',file.nativeBinding.certificate?.fieldId,file.key);continue;}
  if(seen.has(target.id))add('NATIVE_LEGAL_DUPLICATE_TARGET','같은 공유 서류 영역에 여러 원본이 연결되어 있습니다. 한 개를 명시적으로 선택해주세요.',target.binding.certificate?.fieldId,file.key);
  else seen.set(target.id,file.key);
 }
 if(input.documents?.applicability==='required'&&!files.length)add('NATIVE_LEGAL_FILE_MISSING','서류 해당함으로 저장했지만 원본 서류가 없습니다.');
 if(input.documents?.applicability!=='required'&&files.some(file=>file.nativeBinding))add('NATIVE_LEGAL_APPLICABILITY_UNCONFIRMED','원본 연결과 별도로 서류 해당 여부를 직접 확인해주세요.');
 return {schemaSha256:projection.schemaSha256,categoryId:input.categoryId,company:{...input.company},targets,issues,files,
  registered:false,remoteWrites:false,submissionReady:false};
}
/** Resolve a server-derived target for the exact saved original. Returning
 * metadata does not verify PDF contents or unlock any native upload gate. */
export function resolveNativeLegalBinding(context:NativeLegalContext,fileKey:string,targetId:string,expectedSchemaSha256:string):NativeLegalBinding{
 if(context.schemaSha256!==expectedSchemaSha256||!/^[a-f0-9]{64}$/.test(expectedSchemaSha256))throw Error('서류 연결 중 원문 양식이 변경되었습니다. 다시 불러와주세요.');
 const files=context.files.filter(file=>file.key===fileKey),targets=context.targets.filter(target=>target.id===targetId);
 if(files.length!==1||files[0].type!=='pdf'||targets.length!==1)throw Error('이 상품에 저장한 PDF 원본과 현재 서류 연결 항목을 확인해주세요.');
 const target=targets[0],binding=readNativeLegalBinding(target.binding);
 if(binding.schemaSha256!==context.schemaSha256||binding.categoryId!==context.categoryId||context.files.some(file=>file.key!==fileKey&&file.nativeBinding&&same(file.nativeBinding,binding)))throw Error('서류 연결 정보가 바뀌었거나 같은 영역에 다른 원본이 연결되어 있습니다.');
 return binding;
}
