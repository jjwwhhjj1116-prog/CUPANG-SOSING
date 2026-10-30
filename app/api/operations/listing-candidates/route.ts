import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext} from '@/app/managed-products';
import {readBoundedJson,RequestBodyError} from '@/app/request-body';
import {OperationsError} from '@/app/operations/engine';
import {readOperations,saveOperations} from '@/db/operations';
import {parseListingComparison,listingComparisonDigest,storedListingReceipt,prepareListingComparison} from '@/app/listing-comparison';
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request){
 const access=await managedProductAccess();if(!access)return json({ok:false,error:'로그인 회원의 승인된 회사정보가 필요합니다.',uncertain:false},403);
 let writeAttempted=false;
 try{
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)throw new OperationsError('같은 YOOFAM 사이트에서 담아주세요.',403);
  const input=parseListingComparison(await readBoundedJson(request,262144));
  if(input.expectedOwnerId!==access.ownerId||input.expectedCompany.code!==access.company.code||input.expectedCompany.name!==access.company.name)throw new OperationsError('담기 시작 당시의 회원·회사와 다릅니다.',409,'OPERATIONS_SCOPE_CHANGED');
  const scope={ownerId:access.ownerId,companyCode:access.company.code,companyName:access.company.name},account=await managedProductAccountContext(access.ownerId,access.company);
  const current=async()=>{const after=await managedProductAccess();if(!after||await managedProductAccountContext(after.ownerId,after.company)!==account)throw new OperationsError('담는 중 로그인 회원·회사가 변경되었습니다.',409,'OPERATIONS_SCOPE_CHANGED');};
  const hash=await listingComparisonDigest(input),before=await readOperations(scope);await current();
  const previous=storedListingReceipt(before.document,input,scope,hash,before.revision);if(previous)return json({ok:true,receipt:previous});
  const prepared=prepareListingComparison(before.document,input,scope,hash,before.revision);await current();writeAttempted=true;
  const saved=await saveOperations(scope,before.revision,prepared.document);await current();
  const receipt=storedListingReceipt(saved.document,input,scope,hash,saved.revision);if(!receipt)throw new OperationsError('담기 저장 결과를 확인하지 못했습니다.',503);
  return json({ok:true,receipt});
 }catch(error){const uncertain=writeAttempted&&!(error instanceof OperationsError&&error.code==='OPERATIONS_CONFLICT');return error instanceof OperationsError||error instanceof RequestBodyError?json({ok:false,error:error.message,...(error instanceof OperationsError?{code:error.code}:{}),uncertain},error.status):json({ok:false,error:'담기 저장 결과를 확인하지 못했습니다. 같은 요청을 다시 보내지 말고 저장 기록을 확인해주세요.',uncertain},503);}
}
