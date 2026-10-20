import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {findProduct} from '@/db/queries';
import {readProductContent,saveProductContent,type ProductContentSourceCommit} from '@/db/product-content';
import {readLegalDocuments,legalDocumentType,LEGAL_DOCUMENT_LIMIT,LEGAL_DOCUMENT_TOTAL_LIMIT} from '@/app/legal-documents';
import {readBoundedBytes,readBoundedJson,RequestBodyError} from '@/app/request-body';
import {readMappedQuotationSource,readQuotationExportSource,resolveQuotationExport} from '@/app/exports/quotation-source';
import {buildNativeLegalContext,resolveNativeLegalBinding} from '@/app/native-legal-binding';
import {sourceGuard} from '@/db/quotation-fields';
type Context={params:Promise<{id:string}>};
const reply=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'cache-control':'no-store'}});
class LegalDocumentStorageError extends Error {}
class LegalDocumentConflict extends Error {}
async function source(context:Context){
 const user=await getChatGPTUser();if(!user?.verifiedAccess||!approvedSupplierHubCompany(user.membership))return null;
 const owner=await getWorkspaceOwnerId(),{id}=await context.params;
 if(owner!==user.userId)return null;
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)||!await findProduct(owner,id))return {error:reply({error:'상품을 찾을 수 없습니다.'},404)};
 const content=await readProductContent(owner,id),documents=readLegalDocuments(content.legalDocuments,owner,id);
 return {owner,id,content,documents,member:{email:user.membership!.email,role:user.membership!.role,companyCode:user.membership!.companyCode,companyName:user.membership!.companyName}};
}
type Saved=Exclude<NonNullable<Awaited<ReturnType<typeof source>>>,{error:unknown}>;
async function nativeContext(saved:Saved){
 const quotation=await readMappedQuotationSource(saved.owner,saved.id,null);
 if(quotation.content.revision!==saved.content.revision||!quotation.hubSchema||!quotation.company||!quotation.categoryContext.categoryId)throw new LegalDocumentConflict('현재 상품의 회사·카테고리 견적 양식을 먼저 확인해주세요.');
 const native=await buildNativeLegalContext({snapshot:quotation.hubSchema,company:quotation.company,categoryId:quotation.categoryContext.categoryId,
  categoryPath:quotation.categoryContext.categoryPath,resolved:resolveQuotationExport(quotation),documents:saved.documents});
 return {native,quotation};
}
async function listView(saved:Saved){
 try{return {revision:saved.content.revision,documents:saved.documents,native:(await nativeContext(saved)).native};}
 catch{return {revision:saved.content.revision,documents:saved.documents,native:null,nativeError:'카테고리 견적 양식을 확인한 뒤 원본 서류의 제출 항목을 연결하세요.'};}
}
async function active(saved:Saved){
 const user=await getChatGPTUser(),company=user?.verifiedAccess&&user.userId===saved.owner?approvedSupplierHubCompany(user.membership):null;
 if(!user||!company||!user.membership||JSON.stringify({email:user.membership.email,role:user.membership.role,companyCode:company.code,companyName:company.name})!==JSON.stringify(saved.member))
  throw new LegalDocumentConflict('로그인 회사가 변경되었습니다. 원본 서류는 변경하지 않았습니다.');
}
export async function GET(request:Request,context:Context){
 try{
  const saved=await source(context).catch(()=>{throw new LegalDocumentStorageError();});if(!saved)return reply({error:'승인된 회사 회원으로 로그인해주세요.'},403);if('error' in saved)return saved.error;
  const key=new URL(request.url).searchParams.get('key');if(!key){const view=await listView(saved);await active(saved);return reply(view);}
  const file=saved.documents.files.find(file=>file.key===key);if(!file)return reply({error:'이 상품의 서류를 찾을 수 없습니다.'},404);
  const object=await env.FILES.get(key);if(!object||object.size!==file.byteLength)return reply({error:'저장된 서류를 확인하지 못했습니다.'},409);
  const bytes=await object.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
  if(digest!==file.sha256)return reply({error:'서류 원본이 변경되었습니다.'},409);
  await active(saved);return new Response(bytes,{headers:{'content-type':file.type==='pdf'?'application/pdf':file.type==='png'?'image/png':'image/jpeg','content-disposition':`attachment; filename="document.${file.type}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 }catch{return reply({error:'법적 서류를 불러오지 못했습니다.'},503);}
}
export async function POST(request:Request,context:Context){return change(request,context,true);}
export async function PATCH(request:Request,context:Context){return change(request,context,false);}
async function change(request:Request,context:Context,upload:boolean){
 let storedKey:string|undefined;
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'현재 앱에서 요청해주세요.'},403);
  const saved=await source(context).catch(()=>{throw new LegalDocumentStorageError();});if(!saved)return reply({error:'승인된 회사 회원으로 로그인해주세요.'},403);if('error' in saved)return saved.error;
  let revision:number,sealed:ProductContentSourceCommit|undefined;const documents=saved.documents;
  if(upload){
   const type=request.headers.get('content-type')??'';if(type.split(';')[0].trim()!=='multipart/form-data')throw Error('원본 서류 파일로 보내주세요.');
   const bounded=await readBoundedBytes(request,LEGAL_DOCUMENT_LIMIT+16384),form=await new Response(bounded.buffer as ArrayBuffer,{headers:{'content-type':type}}).formData();
   if([...form.keys()].some(key=>!['file','expectedRevision'].includes(key))||form.getAll('file').length!==1||form.getAll('expectedRevision').length!==1)throw Error('서류 한 개와 저장 버전을 보내주세요.');
   const file=form.get('file'),version=form.get('expectedRevision');if(typeof version!=='string'||!/^\d+$/.test(version))throw Error('저장 버전을 확인해주세요.');revision=Number(version);
   if(!(file instanceof File)||file.size<1||file.size>LEGAL_DOCUMENT_LIMIT||!file.name.trim()||file.name.length>180||/[\u0000-\u001f\\/]/.test(file.name))throw Error('서류는 파일당 5MB 이하만 지원합니다.');
   if(revision!==saved.content.revision)return reply({error:'다른 편집이 저장되었습니다. 서류 목록을 다시 불러와주세요.'},409);
   if(documents.files.length>=10||documents.files.reduce((total,item)=>total+item.byteLength,0)+file.size>LEGAL_DOCUMENT_TOTAL_LIMIT)throw Error('서류는 최대 10개, 합계 8MB 이하입니다.');
   const bytes=await file.arrayBuffer(),kind=legalDocumentType(new Uint8Array(bytes));
   if(!new RegExp(kind==='jpg'?'\\.jpe?g$':'\\.'+kind+'$','i').test(file.name))throw Error('서류 확장자와 원본 형식이 다릅니다.');
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join('');
   storedKey=`${saved.owner}/legal/${saved.id}/legal-${crypto.randomUUID()}.${kind}`;
   if(!env.FILES)throw new LegalDocumentStorageError();
   await env.FILES.put(storedKey,bytes,{httpMetadata:{contentType:kind==='pdf'?'application/pdf':kind==='png'?'image/png':'image/jpeg'},customMetadata:{sha256,productId:saved.id}}).catch(()=>{throw new LegalDocumentStorageError();});
   documents.files.push({key:storedKey,name:file.name,byteLength:file.size,sha256,type:kind});documents.applicability='required';
  }else{
   const input=await readBoundedJson(request,4096) as {expectedRevision:number;applicability?:string;removeKey?:string;binding?:{key:string;targetId:string|null;expectedSchemaSha256:string}};
   if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['expectedRevision','applicability','removeKey','binding'].includes(key))||['applicability','removeKey','binding'].filter(key=>Object.hasOwn(input,key)).length!==1)throw Error('서류 선택·제출 항목 연결·첨부 제외 중 한 가지를 요청해주세요.');revision=input.expectedRevision;
   if(!Number.isSafeInteger(revision)||revision<0)throw Error('저장 버전을 확인해주세요.');
   if(revision!==saved.content.revision)throw new LegalDocumentConflict('다른 편집이 저장되었습니다. 서류 목록을 다시 불러와주세요.');
   if('applicability' in input){if(!['unconfirmed','required','not-applicable'].includes(input.applicability??''))throw Error('서류 해당 여부를 선택해주세요.');documents.applicability=input.applicability as typeof documents.applicability;}
   else if('removeKey' in input){if(!documents.files.some(file=>file.key===input.removeKey))return reply({error:'이 상품의 서류를 찾을 수 없습니다.'},404);documents.files=documents.files.filter(file=>file.key!==input.removeKey);}
   else {
    const change=input.binding;
    if(!change||typeof change!=='object'||Array.isArray(change)||Object.keys(change).some(key=>!['key','targetId','expectedSchemaSha256'].includes(key))
     ||typeof change.key!=='string'||!(change.targetId===null||typeof change.targetId==='string'&&change.targetId.length>0&&change.targetId.length<=200)||typeof change.expectedSchemaSha256!=='string'||!/^[a-f0-9]{64}$/.test(change.expectedSchemaSha256))throw Error('원본 서류와 현재 제출 항목을 선택해주세요.');
    const file=documents.files.find(file=>file.key===change.key);if(!file)return reply({error:'이 상품의 서류를 찾을 수 없습니다.'},404);
    let quotation;
    if(change.targetId===null){
     if(!file.nativeBinding||file.nativeBinding.schemaSha256!==change.expectedSchemaSha256)throw new LegalDocumentConflict('서류 연결이 변경되었습니다. 목록을 다시 불러와주세요.');
     quotation=await readQuotationExportSource(saved.owner,saved.id,null);delete file.nativeBinding;
    }else{
     const current=await nativeContext(saved).catch(()=>{throw new LegalDocumentConflict('현재 카테고리와 견적값의 제출 항목을 다시 확인해주세요.');});
     if(current.native.schemaSha256!==change.expectedSchemaSha256)throw new LegalDocumentConflict('카테고리 양식이 변경되었습니다. 제출 항목을 다시 선택해주세요.');
     file.nativeBinding=resolveNativeLegalBinding(current.native,change.key,change.targetId,change.expectedSchemaSha256);quotation=current.quotation;
    }
    if(quotation.content.revision!==revision)throw new LegalDocumentConflict('서류를 연결하는 동안 상품이 변경되었습니다. 목록을 다시 불러와주세요.');
    sealed={sourcePredicate:sourceGuard(saved.owner,saved.id,quotation.source),quotationRevision:quotation.state.revision,quotationPayload:JSON.stringify(quotation.savedScopes??quotation.state),member:saved.member};
   }
  }
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('저장 버전을 확인해주세요.');
  if(revision!==saved.content.revision)return reply({error:'다른 편집이 저장되었습니다. 서류 목록을 다시 불러와주세요.'},409);
  const content={...saved.content,legalDocuments:readLegalDocuments(documents,saved.owner,saved.id),revision:revision+1,updatedAt:new Date().toISOString()};
  await active(saved);
  const result=await saveProductContent(saved.owner,content,revision,undefined,sealed).catch(()=>{throw new LegalDocumentStorageError();});
  if(!result){if(storedKey)await env.FILES.delete(storedKey).catch(()=>undefined);return reply({error:'동시에 변경되었습니다. 서류 목록을 다시 불러와주세요.'},409);}
  // Removing a reference never deletes another saved quotation's evidence bytes.
  const view=await listView({...saved,content:result,documents:readLegalDocuments(result.legalDocuments,saved.owner,saved.id)});await active(saved);
  return reply(view,upload?201:200);
 // A failed database acknowledgement may follow a committed write. Preserve
 // immutable bytes in that case; only a proven CAS conflict cleans up its key.
 }catch(error){return reply({error:error instanceof LegalDocumentStorageError?'법적 서류 저장을 확인하지 못했습니다.':error instanceof Error?error.message:'법적 서류 저장을 확인하지 못했습니다.'},error instanceof RequestBodyError?error.status:error instanceof LegalDocumentConflict?409:error instanceof LegalDocumentStorageError?503:400);}
}
