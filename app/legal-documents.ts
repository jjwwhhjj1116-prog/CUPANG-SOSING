import type {SubmissionIssue} from '@/app/submission-review';
import type {NativeLegalBinding} from '@/app/native-legal-binding';

export const LEGAL_DOCUMENT_LIMIT=5*1024*1024;
export const LEGAL_DOCUMENT_TOTAL_LIMIT=8*1024*1024;
export type LegalDocument={key:string;name:string;byteLength:number;sha256:string;type:'pdf'|'png'|'jpg';nativeBinding?:NativeLegalBinding};
export type LegalDocuments={applicability:'unconfirmed'|'required'|'not-applicable';files:LegalDocument[]};
function storedObject(value:unknown,required:readonly string[],optional:readonly string[]=[]):value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 return keys.every(key=>typeof key==='string'&&[...required,...optional].includes(key)&&Object.hasOwn(descriptors[key],'value'))&&required.every(key=>Object.hasOwn(descriptors,key));
}
/** Shape validation only. A stored binding is not evidence that its old schema,
 * certificate value, original bytes or remote attachment are still current. */
export function readNativeLegalBinding(value:unknown):NativeLegalBinding{
 const invalid=()=>Error('저장된 Supplier Hub 서류 연결 정보를 확인해주세요.');
 if(!storedObject(value,['format','schemaSha256','categoryId','nativeType'],['certificate'])||value.format!=='supplier-hub-native-legal-binding-v1'
  ||typeof value.schemaSha256!=='string'||!/^[a-f0-9]{64}$/.test(value.schemaSha256)||typeof value.categoryId!=='string'||!/^[1-9]\d{0,19}$/.test(value.categoryId)
  ||!['certificate','msds','additional','import_type','categoryCert','adCert'].includes(value.nativeType as string))throw invalid();
 if(value.nativeType==='certificate'){
  const row=value.certificate;
  if(!storedObject(row,['schemaIndex','fieldId','path','nameKey','valueKey','name','value'])||!Number.isSafeInteger(row.schemaIndex)||Number(row.schemaIndex)<0||Number(row.schemaIndex)>=400
   ||typeof row.fieldId!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(row.fieldId)||!Array.isArray(row.path)||row.path.length!==2||Object.keys(row.path).length!==2||row.path[0]!=='legalPage'||row.path[1]!=='certificates'
   ||typeof row.nameKey!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(row.nameKey)||typeof row.valueKey!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(row.valueKey)||row.nameKey===row.valueKey
   ||typeof row.name!=='string'||!row.name.trim()||row.name!==row.name.trim()||row.name.length>500||/[\u0000-\u001f]/.test(row.name)
   ||!(row.value===null||typeof row.value==='string'&&row.value.length<=2000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row.value)||typeof row.value==='number'&&Number.isFinite(row.value)||typeof row.value==='boolean'))throw invalid();
 }else if(Object.hasOwn(value,'certificate'))throw invalid();
 return structuredClone(value) as NativeLegalBinding;
}
/** A saved required choice needs at least one original; presence is not content verification. */
export function legalDocumentSubmissionIssues(applicability:LegalDocuments['applicability'],fileCount:number):SubmissionIssue[]{
 return applicability==='required'&&fileCount===0?[{kind:'error',code:'LEGAL_DOCUMENT_MISSING',optionId:null,optionLabel:'법적 필수서류',fieldId:null,message:'서류 해당함을 선택했습니다. 원본 서류를 첨부해주세요.'}]:[];
}
type LegalDocumentObject={size:number;httpMetadata?:{contentType?:string};customMetadata?:Record<string,string>};
/** Check saved originals early without downloading them. Export still verifies actual bytes. */
export async function inspectLegalDocumentStorage(documents:LegalDocuments,productId:string,head?:(key:string)=>Promise<LegalDocumentObject|null>):Promise<SubmissionIssue[]>{
 if(documents.applicability!=='required')return [];
 const missing=legalDocumentSubmissionIssues(documents.applicability,documents.files.length);
 if(missing.length)return missing;
 const results:SubmissionIssue[][]=Array.from({length:documents.files.length},()=>[]);let next=0;
 const issue=(file:LegalDocument,kind:SubmissionIssue['kind'],code:string,message:string):SubmissionIssue=>({kind,code,optionId:null,optionLabel:'법적 필수서류',fieldId:null,message:`${file.name}: ${message}`});
 const inspect=async()=>{
  while(next<documents.files.length){
   const index=next++,file=documents.files[index];let object:LegalDocumentObject|null;
   try{
    if(!head)throw Error('storage unavailable');
    object=await head(file.key);
   }catch{
    results[index].push(issue(file,'error','LEGAL_DOCUMENT_STORAGE_UNAVAILABLE','원본 서류를 확인하지 못했습니다. 잠시 후 다시 검사해주세요.'));continue;
   }
   if(!object){results[index].push(issue(file,'error','LEGAL_DOCUMENT_NOT_FOUND','저장된 원본 서류가 없습니다. 원본을 다시 첨부해주세요.'));continue;}
   const expectedType={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg'}[file.type];
   const contentType=object.httpMetadata?.contentType,sha256=object.customMetadata?.sha256,savedProductId=object.customMetadata?.productId;
   if(object.size!==file.byteLength||(contentType!==undefined&&contentType.split(';')[0].trim().toLowerCase()!==expectedType)||(sha256!==undefined&&sha256!==file.sha256)||(savedProductId!==undefined&&savedProductId!==productId)){
    results[index].push(issue(file,'error','LEGAL_DOCUMENT_STORAGE_MISMATCH','저장된 원본 서류 정보가 첨부 목록과 다릅니다. 원본을 확인하고 다시 첨부해주세요.'));continue;
   }
   if(contentType===undefined||sha256===undefined||savedProductId===undefined)results[index].push(issue(file,'review','LEGAL_DOCUMENT_METADATA_UNCONFIRMED','이전 원본의 확인 기록이 부족합니다. 견적서 준비 시 원본 내용과 크기를 다시 검사합니다.'));
  }
 };
 await Promise.all(Array.from({length:Math.min(3,documents.files.length)},()=>inspect()));
 return results.flat();
}
export function legalDocumentType(bytes:Uint8Array):LegalDocument['type']{
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
 if(bytes.length>=12&&new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-'&&new TextDecoder().decode(bytes.subarray(Math.max(0,bytes.length-1024))).includes('%%EOF'))return 'pdf';
 throw Error('PDF·PNG·JPEG 원본 서류만 지원합니다.');
}
export function readLegalDocuments(value:LegalDocuments|undefined,owner:string,productId:string):LegalDocuments{
 if(value===undefined)return {applicability:'unconfirmed',files:[]};
 if(!storedObject(value,['applicability','files'])||!['unconfirmed','required','not-applicable'].includes(value.applicability)||!Array.isArray(value.files)||value.files.length>10||Object.keys(value.files).length!==value.files.length)throw Error('저장된 법적 서류 목록을 확인해주세요.');
 const seen=new Set<string>(),prefix=`${owner}/legal/${productId}/`;let total=0;
 for(const file of value.files){
  if(!storedObject(file,['key','name','byteLength','sha256','type'],['nativeBinding'])||typeof file.key!=='string'||!file.key.startsWith(prefix)||!/^legal-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(pdf|png|jpg)$/.test(file.key.slice(prefix.length))||seen.has(file.key)||typeof file.name!=='string'||!file.name.trim()||file.name.length>180||/[\u0000-\u001f\\/]/.test(file.name)||!['pdf','png','jpg'].includes(file.type)||!file.key.endsWith('.'+file.type)||!Number.isSafeInteger(file.byteLength)||file.byteLength<1||file.byteLength>LEGAL_DOCUMENT_LIMIT||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('법적 서류의 소유자와 파일 정보를 확인해주세요.');
  if(Object.hasOwn(file,'nativeBinding')){if(file.type!=='pdf')throw Error('Supplier Hub 원본 서류 연결은 PDF만 지원합니다.');readNativeLegalBinding(file.nativeBinding);}
  seen.add(file.key);total+=file.byteLength;
 }
 if(total>LEGAL_DOCUMENT_TOTAL_LIMIT)throw Error('법적 서류 합계는 8MB 이하이어야 합니다.');
 return structuredClone(value);
}
