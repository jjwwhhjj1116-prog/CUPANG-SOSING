import type {SubmissionIssue} from '@/app/submission-review';

export const LEGAL_DOCUMENT_LIMIT=5*1024*1024;
export const LEGAL_DOCUMENT_TOTAL_LIMIT=8*1024*1024;
export type LegalDocument={key:string;name:string;byteLength:number;sha256:string;type:'pdf'|'png'|'jpg'};
export type LegalDocuments={applicability:'unconfirmed'|'required'|'not-applicable';files:LegalDocument[]};
/** A saved required choice needs at least one original; presence is not content verification. */
export function legalDocumentSubmissionIssues(applicability:LegalDocuments['applicability'],fileCount:number):SubmissionIssue[]{
 return applicability==='required'&&fileCount===0?[{kind:'error',code:'LEGAL_DOCUMENT_MISSING',optionId:null,optionLabel:'법적 필수서류',fieldId:null,message:'서류 해당함을 선택했습니다. 원본 서류를 첨부해주세요.'}]:[];
}
export function legalDocumentType(bytes:Uint8Array):LegalDocument['type']{
 if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'jpg';
 if(bytes.length>=12&&new TextDecoder().decode(bytes.subarray(0,5))==='%PDF-'&&new TextDecoder().decode(bytes.subarray(Math.max(0,bytes.length-1024))).includes('%%EOF'))return 'pdf';
 throw Error('PDF·PNG·JPEG 원본 서류만 지원합니다.');
}
export function readLegalDocuments(value:LegalDocuments|undefined,owner:string,productId:string):LegalDocuments{
 if(value===undefined)return {applicability:'unconfirmed',files:[]};
 if(!value||!['unconfirmed','required','not-applicable'].includes(value.applicability)||!Array.isArray(value.files)||value.files.length>10)throw Error('저장된 법적 서류 목록을 확인해주세요.');
 const seen=new Set<string>(),prefix=`${owner}/legal/${productId}/`;let total=0;
 for(const file of value.files){
  if(!file||typeof file.key!=='string'||!file.key.startsWith(prefix)||!/^legal-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(pdf|png|jpg)$/.test(file.key.slice(prefix.length))||seen.has(file.key)||typeof file.name!=='string'||!file.name.trim()||file.name.length>180||/[\u0000-\u001f\\/]/.test(file.name)||!['pdf','png','jpg'].includes(file.type)||!file.key.endsWith('.'+file.type)||!Number.isSafeInteger(file.byteLength)||file.byteLength<1||file.byteLength>LEGAL_DOCUMENT_LIMIT||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('법적 서류의 소유자와 파일 정보를 확인해주세요.');
  seen.add(file.key);total+=file.byteLength;
 }
 if(total>LEGAL_DOCUMENT_TOTAL_LIMIT)throw Error('법적 서류 합계는 8MB 이하이어야 합니다.');
 return structuredClone(value);
}
