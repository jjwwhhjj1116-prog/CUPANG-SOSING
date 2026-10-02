import {env} from 'cloudflare:workers';
import {readLegalDocuments,legalDocumentType,type LegalDocuments} from '@/app/legal-documents';
import {AttachmentError} from '@/app/exports/attachments';
export type LegalDocumentAttachment={archivePath:string;filename:string;originalName:string;byteLength:number;sha256:string};
export async function loadLegalDocumentAttachments(value:LegalDocuments|undefined,owner:string,productId:string){
 const documents=readLegalDocuments(value,owner,productId),files:{name:string;data:Uint8Array}[]=[],attachments:LegalDocumentAttachment[]=[];
 if(documents.applicability==='required')for(const [index,file] of documents.files.entries()){
  const object=await env.FILES.get(file.key);if(!object||object.size!==file.byteLength)throw new AttachmentError('첨부 서류 원본을 찾을 수 없습니다.',409);
  const data=new Uint8Array(await object.arrayBuffer()),sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),value=>value.toString(16).padStart(2,'0')).join('');
  if(sha256!==file.sha256||legalDocumentType(data)!==file.type)throw new AttachmentError('첨부 서류 원본이 변경되었습니다.',409);
  const filename=`legal-${String(index+1).padStart(3,'0')}.${file.type}`,archivePath=`documents/${filename}`;
  files.push({name:archivePath,data});attachments.push({archivePath,filename,originalName:file.name,byteLength:data.byteLength,sha256});
 }
 return {applicability:documents.applicability,files,attachments};
}
