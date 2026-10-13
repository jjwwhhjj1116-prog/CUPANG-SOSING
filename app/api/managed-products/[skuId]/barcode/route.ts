import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext} from '@/app/managed-products';
import {ManagedProductBarcodeError,encodeManagedProductBarcode} from '@/app/managed-product-barcode';
import {readManagedProductBarcode,managedProductBarcodeSourcesCurrent} from '@/db/managed-product-barcode';

type Context={params:Promise<{skuId:string}>};
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'cache-control':'no-store'}});
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const conflict=()=>new ManagedProductBarcodeError('계정·회사·원본 상품 또는 표시사항이 변경되었습니다. 현재 저장본을 다시 확인해주세요.',409,'MANAGED_PRODUCT_BARCODE_CONFLICT');
async function accessCurrent(expected:string){const access=await managedProductAccess();if(!access||await managedProductAccountContext(access.ownerId,access.company)!==expected)throw conflict();}
export async function GET(request:Request,context:Context){
 const access=await managedProductAccess();if(!access)return json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},403);
 try {
  const params=new URL(request.url).searchParams,expected=params.get('expectedAccountContext'),sourceVersion=params.get('expectedSourceVersion');
  if([...params.keys()].some(key=>!['expectedAccountContext','expectedSourceVersion'].includes(key))||params.getAll('expectedAccountContext').length!==1||params.getAll('expectedSourceVersion').length>1||!digest(expected)||sourceVersion!==null&&!digest(sourceVersion))throw new ManagedProductBarcodeError('바코드를 조회할 계정과 원본 버전을 확인해주세요.');
  const account=await managedProductAccountContext(access.ownerId,access.company);if(account!==expected)throw conflict();
  const {skuId}=await context.params;if(!/^\d{1,30}$/u.test(skuId))throw new ManagedProductBarcodeError('저장된 상품 SKU를 확인해주세요.');
  const snapshot=await readManagedProductBarcode(access.ownerId,access.company,skuId);if(sourceVersion!==null&&sourceVersion!==snapshot.view.sourceVersion)throw conflict();
  encodeManagedProductBarcode(snapshot.view.product.barcode);await accessCurrent(account);if(!await managedProductBarcodeSourcesCurrent(access.ownerId,access.company,snapshot))throw conflict();await accessCurrent(account);
  return json(snapshot.view);
 }catch(error){return error instanceof ManagedProductBarcodeError?json({error:error.message,code:error.code},error.status):json({error:'현재 회사의 저장된 바코드를 확인하지 못했습니다. 다시 조회해주세요.'},503);}
}
