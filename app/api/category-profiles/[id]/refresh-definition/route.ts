import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {validateHubSchemaSnapshot,type HubSchemaSnapshot} from '@/app/supplier-hub-schema';
import {CategoryProfileConflictError,CATEGORY_PROFILE_BODY_LIMIT,CATEGORY_TEMPLATE_FILE_LIMIT,validateCategoryProfile,parseTemplateText,type CategoryProfileInput,type TemplateDefinition} from '@/app/category-profiles';
import {carryCategoryDefinitionMappings,sameCategoryFormDefinition} from '@/app/category-definition-refresh';
import {validateCategoryIdentity} from '@/app/category-identity';
import {connectOfficialWorkbookTemplate} from '@/app/official-hub-template';
import {templateKey,TemplateValidationError} from '@/db/category-templates';
import {inspectXlsx,xlsxHeaders} from '@/app/xlsx-template';
import {getCategoryProfile,forkCategoryProfileDefinition} from '@/db/category-profiles';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';

const headers={'cache-control':'no-store'};
const failure=(error:string,status:number)=>NextResponse.json({error},{status,headers});
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function invalid(message:string):never{throw new TemplateValidationError(message);}
function noticeIdentity(snapshot:HubSchemaSnapshot):string|undefined{
 const meta=snapshot.metadata;
 if(meta.noticeNumber!==undefined&&meta.productNoticeNumber!==undefined&&String(meta.noticeNumber)!==String(meta.productNoticeNumber))invalid('상세 양식의 상품 고시 식별값이 서로 다릅니다.');
 const value=meta.productNoticeNumber??meta.noticeNumber;return value===undefined?undefined:String(value);
}

async function refreshedTemplate(ownerId:string,source:CategoryProfileInput,snapshot:HubSchemaSnapshot):Promise<TemplateDefinition|null>{
 const template=source.template;
 if(!template)return null;
 if(!template.storageKey||template.storageKey!==templateKey(ownerId,template.sha256,template.format))invalid('기존 견적서 원본의 소유권을 확인하지 못했습니다.');
 if(!env.FILES)throw Error('견적서 저장소를 사용할 수 없습니다.');
 const object=await env.FILES.get(template.storageKey!);
 if(!object||object.customMetadata?.sha256!==template.sha256||object.customMetadata?.format!==template.format)invalid('저장된 견적서 원본과 파일 정보가 일치하지 않습니다.');
 if(object.size!==undefined&&object.size>CATEGORY_TEMPLATE_FILE_LIMIT)invalid('견적서 원본은 5MB 이하만 지원합니다.');
 const bytes=await object.arrayBuffer();if(bytes.byteLength>CATEGORY_TEMPLATE_FILE_LIMIT)invalid('견적서 원본은 5MB 이하만 지원합니다.');
 const originalSha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(originalSha!==template.sha256)invalid('저장된 견적서 원본 파일의 지문이 변경되었습니다. 원본 연결을 먼저 확인해주세요.');
 if(!template.workbookEvidence){
  try{
   const actualHeaders=template.format==='xlsx'?xlsxHeaders(await inspectXlsx(bytes),template.sheetName,template.headerRow):parseTemplateText(new TextDecoder('utf-8',{fatal:true}).decode(bytes),template.format==='tsv'?'\t':',',template.headerRow);
   if(!equal(template.headers,actualHeaders.map(header=>header.trim())))invalid('견적서 머리글이 원본 파일과 일치하지 않습니다. 다시 연결해주세요.');
   return template;
  }catch(error){invalid(error instanceof Error?error.message:'견적서 원본의 머리글을 확인하지 못했습니다.');}
 }
 const oldSchemaSha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source.hubSchema!.schemaString))),byte=>byte.toString(16).padStart(2,'0')).join('');
 if(oldSchemaSha!==template.workbookEvidence.sourceSchemaSha256)invalid('기존 원본의 상세 양식 지문이 다릅니다. 원본 연결을 먼저 확인해주세요.');
 const oldNotice=noticeIdentity(source.hubSchema!),newNotice=noticeIdentity(snapshot);
 if(oldNotice!==newNotice)invalid('상품 고시 유형이 변경되었습니다. 새 카테고리 양식의 원본을 직접 연결해주세요.');
 try{
  const connection=await connectOfficialWorkbookTemplate(bytes,snapshot);
  if(connection.template.workbookEvidence!.templateSha256!==template.sha256||connection.report.ambiguousColumns.length
   ||template.sheetName!==connection.template.sheetName||template.headerRow!==connection.template.headerRow||template.dataStartRow!==connection.template.dataStartRow
   ||!equal(template.headers,connection.template.headers.map(header=>header.trim())))invalid('기존 원본의 지문·시트·열·작성 위치를 새 상세 양식에서 확인하지 못했습니다. 새 원본을 직접 연결해주세요.');
  return {...template,...connection.template};
 }catch(error){invalid(error instanceof Error?error.message:'공식 원본을 새 상세 양식에서 확인하지 못했습니다.');}
}

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
 const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 if(!company)return failure('로그인 회원의 승인된 회사정보가 필요합니다.',403);
 let id:string,expectedRevision:number,snapshot:HubSchemaSnapshot,requestId:string;
 try{
  id=(await context.params).id;if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('카테고리 설정 번호를 확인해주세요.');
  const key=request.headers.get('Idempotency-Key');if(!key||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))throw Error('양식 갱신 요청 번호를 확인해주세요.');requestId=key.toLowerCase();
  if(requestId===id)throw Error('기존 설정과 다른 양식 갱신 요청 번호가 필요합니다.');
  const raw=await readBoundedJson(request,CATEGORY_PROFILE_BODY_LIMIT);
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==2||!Object.hasOwn(raw,'expectedRevision')||!Object.hasOwn(raw,'hubSchema'))throw Error('기존 저장 버전과 새 상세 양식만 보내주세요.');
  const value=raw as Record<string,unknown>;
  if(!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<1)throw Error('기존 저장 버전을 확인해주세요.');expectedRevision=Number(value.expectedRevision);
  const schema=value.hubSchema as HubSchemaSnapshot;snapshot=validateHubSchemaSnapshot(schema,schema?.categoryId,schema?.categoryPath);
  if(snapshot.company.code!==company.code||snapshot.company.name!==company.name)throw Error('회원 회사와 상세 양식 회사가 다릅니다.');validateCategoryIdentity(snapshot);
  noticeIdentity(snapshot);
  if(snapshot.metadata.scope!==undefined&&snapshot.metadata.scopeType!==undefined&&snapshot.metadata.scope!==snapshot.metadata.scopeType)throw Error('상세 양식의 scope 식별값이 서로 다릅니다.');
  if((snapshot.metadata.scopeType??snapshot.metadata.scope)!=='Retail_Categorized_Single')throw Error('갱신할 화면용 Single 상세 양식이 필요합니다.');
 }catch(error){return failure(error instanceof SyntaxError?'올바른 JSON이 필요합니다.':error instanceof Error?error.message:'양식 갱신 입력을 확인해주세요.',error instanceof RequestBodyError?error.status:400);}
 try{
  const ownerId=await getWorkspaceOwnerId(),source=await getCategoryProfile(ownerId,id);
  if(!source)return failure('카테고리 설정을 찾을 수 없습니다.',404);
  if(source.revision!==expectedRevision)return failure('다른 화면에서 카테고리 설정이 변경되었습니다. 목록을 다시 불러와주세요.',409);
  if(!source.hubSchema||source.hubSchema.company.code!==company.code||source.hubSchema.company.name!==company.name
   ||source.categoryId!==snapshot.categoryId||!equal(source.categoryPath,snapshot.categoryPath))return failure('기존 회사·카테고리 코드·전체 경로가 새 상세 양식과 다릅니다.',400);
  if(sameCategoryFormDefinition(source.hubSchema,snapshot))return failure('같은 상세 양식은 별도 설정으로 갱신할 필요가 없습니다.',400);
  const template=await refreshedTemplate(ownerId,source,snapshot);
  const target={name:source.name,categoryId:source.categoryId,categoryPath:source.categoryPath,hubSchema:snapshot,template,mappings:[]};
  let input:CategoryProfileInput;
  try{input=validateCategoryProfile({...target,mappings:carryCategoryDefinitionMappings(source,target)});if(new TextEncoder().encode(JSON.stringify(input)).byteLength>CATEGORY_PROFILE_BODY_LIMIT)invalid('갱신된 카테고리·원본 연결 설정의 전체 크기가 너무 큽니다. 원본 항목 연결을 확인해주세요.');}catch(error){invalid(error instanceof Error?error.message:'견적서 열 연결을 확인해주세요.');}
  const profile=await forkCategoryProfileDefinition(ownerId,id,expectedRevision,input!,requestId);
  if(!profile)return failure('양식 갱신 중 기존 설정이 변경되었거나 요청 번호가 충돌했습니다. 목록을 다시 불러와주세요.',409);
  return NextResponse.json({profile,sourceProfileId:id,sourceRevision:expectedRevision},{status:201,headers});
 }catch(error){
  if(error instanceof CategoryProfileConflictError)return failure(error.message,409);
  if(error instanceof TemplateValidationError)return failure(error.message,400);
  return failure('새 상세 양식 저장을 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.',503);
 }
}
