import {getChatGPTUser,getWorkspaceOwnerId} from '@/app/chatgpt-auth';
import {stableQuotationFieldsView,QuotationFieldsSnapshotError} from '@/app/quotation-fields-snapshot';

export function quotationFieldsProfileSelection(request:Request){
 const value=new URL(request.url).searchParams.get('profileId');
 if(value!==null&&!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new QuotationFieldsSnapshotError('카테고리 프로필 선택을 확인해주세요.',400);
 return value;
}

/** The public GET and internal readers use the same authenticated, stable
 * resolver. Internal callers must not serialize the complete quotation view
 * into an HTTP response only to parse it again in this same request. */
export async function readQuotationFieldsForRequest(request:Request,context:{params:Promise<{id:string}>}){
 if(process.env.NODE_ENV==='production'&&!(await getChatGPTUser())?.verifiedAccess)
  throw new QuotationFieldsSnapshotError('운영 인증 연결 후 견적서를 편집할 수 있습니다.',503);
 const owner=await getWorkspaceOwnerId(),{id}=await context.params;
 return(await stableQuotationFieldsView(owner,id,quotationFieldsProfileSelection(request))).view;
}
