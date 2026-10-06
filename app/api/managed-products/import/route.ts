import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {MANAGED_PRODUCT_FILE_LIMIT,parseManagedProductWorkbook,managedProductAccountContext,ManagedProductContextChanged,type ManagedProductImport} from '@/app/managed-products';
import {importManagedProducts} from '@/db/managed-products';
import {readBoundedBytes,RequestBodyError} from '@/app/request-body';
const headers={'cache-control':'no-store'};
export async function POST(request:Request){
 const access=await managedProductAccess();if(!access)return NextResponse.json({error:'로그인 회원의 승인된 회사정보가 필요합니다.'},{status:403,headers});
 let source:ManagedProductImport,name:string,preview:boolean,accountContext:string;
 try{
  const type=request.headers.get('content-type')??'';if(type.split(';')[0].trim().toLowerCase()!=='multipart/form-data')throw Error('상품 DB XLSX 파일을 선택해주세요.');
  const bytes=await readBoundedBytes(request,MANAGED_PRODUCT_FILE_LIMIT+20000),form=await new Response(bytes.buffer as ArrayBuffer,{headers:{'content-type':type}}).formData();
  const allowed=['file','action','companyCode','expectedSha256','confirmedCompany','expectedAccountContext'];
  if([...form.keys()].some(key=>!allowed.includes(key)||form.getAll(key).length!==1))throw Error('상품 DB 파일 한 개와 가져오기 조건만 보내주세요.');
  const action=form.get('action');if(action!=='preview'&&action!=='import')throw Error('상품 DB 가져오기 단계를 확인해주세요.');preview=action==='preview';
  accountContext=await managedProductAccountContext(access.ownerId,access.company);
  if(!preview&&form.get('expectedAccountContext')!==accountContext)throw new ManagedProductContextChanged('로그인 계정 또는 회사정보가 변경되었습니다. 선택한 파일을 다시 미리보기해주세요.');
  if(form.get('companyCode')!==access.company.code)throw Error('선택한 원본 회사와 로그인한 회사가 다릅니다.');
  const file=form.get('file');if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx')||file.name.length>240||/[\u0000-\u001f]/.test(file.name))throw Error('원본 XLSX 파일을 선택해주세요.');
  if(file.size>MANAGED_PRODUCT_FILE_LIMIT)throw new RequestBodyError(413,'상품 DB 파일은 5MB 이하만 지원합니다.');
  source=await parseManagedProductWorkbook(await file.arrayBuffer(),access.company);name=file.name;
  if(!preview&&(form.get('expectedSha256')!==source.sha256||form.get('confirmedCompany')!=='true'))throw Error('파일 미리보기와 원본 회사 확인을 마친 뒤 가져와주세요.');
  const current=await managedProductAccess();
  if(!current||await managedProductAccountContext(current.ownerId,current.company)!==accountContext)throw new ManagedProductContextChanged('로그인 계정 또는 회사정보가 변경되었습니다. 선택한 파일을 다시 미리보기해주세요.');
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'상품 DB 파일을 확인해주세요.'},{status:error instanceof ManagedProductContextChanged?409:error instanceof RequestBodyError?error.status:400,headers});}
 try{
  const counts=await importManagedProducts(access.ownerId,source,name,preview);
  return NextResponse.json({company:access.company,accountContext,sha256:source.sha256,counts,...(preview?{preview:true,headers:source.headers,sample:source.rows.slice(0,5)}:{preview:false}),message:preview?'원본 회사와 상품 수를 확인한 후 가져와주세요.':'상품관리 DB에 저장했습니다. Supplier Hub 전송 상태는 변경하지 않았습니다.'},{status:preview?200:201,headers});
 }catch(error){return NextResponse.json({error:error instanceof ManagedProductContextChanged?error.message:preview?'상품 DB 미리보기를 읽지 못했습니다. 다시 확인해주세요.':'저장 응답을 확인하지 못했습니다. 같은 파일로 다시 가져오면 SKU 중복 없이 확인할 수 있습니다.'},{status:error instanceof ManagedProductContextChanged?409:503,headers});}
}
