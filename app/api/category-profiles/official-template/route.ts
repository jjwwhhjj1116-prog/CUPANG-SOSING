import {NextResponse} from 'next/server';
import {env} from 'cloudflare:workers';
import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {approvedSupplierHubCompany} from '@/app/supplier-hub-company';
import {validateHubSchemaSnapshot,type HubSchemaSnapshot} from '@/app/supplier-hub-schema';
import {CATEGORY_TEMPLATE_FILE_LIMIT} from '@/app/category-profiles';
import {readBoundedBytes,RequestBodyError} from '@/app/request-body';
import {connectOfficialHubTemplate} from '@/app/official-hub-template';
import {templateKey} from '@/db/category-templates';

const headers={'cache-control':'no-store'},mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export async function POST(request:Request){
 const user=await getChatGPTUser(),company=user?.verifiedAccess?approvedSupplierHubCompany(user.membership):null;
 if(!company)return NextResponse.json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},{status:403,headers});
 let file:File,bytes:ArrayBuffer,snapshot:HubSchemaSnapshot,connection:Awaited<ReturnType<typeof connectOfficialHubTemplate>>;
 try{
  const type=request.headers.get('content-type')??'';if(type.split(';')[0].trim().toLowerCase()!=='multipart/form-data')throw Error('공식 견적서 원본과 상세 양식을 파일 형식으로 보내주세요.');
  const bounded=await readBoundedBytes(request,CATEGORY_TEMPLATE_FILE_LIMIT+400000),form=await new Response(bounded.buffer as ArrayBuffer,{headers:{'content-type':type}}).formData();
  if([...form.keys()].some(key=>!['file','schema'].includes(key))||form.getAll('file').length!==1||form.getAll('schema').length!==1)throw Error('공식 Excel 한 개와 상세 양식 한 개만 보내주세요.');
  const candidate=form.get('file'),raw=form.get('schema');
  if(!(candidate instanceof File)||!candidate.name.endsWith('.xlsx')||candidate.name.length>240||/[\u0000-\u001f]/.test(candidate.name)||candidate.size<22)throw Error('공식 XLSX 원본을 확인해주세요.');
  if(candidate.size>CATEGORY_TEMPLATE_FILE_LIMIT)throw new RequestBodyError(413,'공식 Excel은 5MB 이하만 지원합니다.');
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>300000)throw Error('상세 양식 원문 크기를 확인해주세요.');
  const parsed=JSON.parse(raw);snapshot=validateHubSchemaSnapshot(parsed,parsed?.categoryId,parsed?.categoryPath);
  if(snapshot.company.code!==company.code||snapshot.company.name!==company.name)throw Error('회원 회사와 상세 양식 회사가 다릅니다.');
  file=candidate;bytes=await file.arrayBuffer();connection=await connectOfficialHubTemplate(bytes,snapshot);
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'공식 양식을 확인해주세요.'},{status:error instanceof RequestBodyError?error.status:400,headers});}
 try{
  if(!env.FILES)throw Error('저장소 없음');
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),value=>value.toString(16).padStart(2,'0')).join(''),storageKey=templateKey(await getWorkspaceOwnerId(),sha256,'xlsx');
  await env.FILES.put(storageKey,bytes,{httpMetadata:{contentType:mime},customMetadata:{sha256,format:'xlsx',name:file.name,companyCode:company.code,categoryId:snapshot.categoryId,kanCategoryId:connection.report.kanCategoryId,version:connection.report.version,noticeNumber:connection.report.noticeNumber}});
  return NextResponse.json({...connection,template:{...connection.template,name:file.name,sha256,storageKey}},{status:201,headers});
 }catch{return NextResponse.json({error:'공식 견적서 원본 저장을 확인하지 못했습니다.'},{status:503,headers});}
}
