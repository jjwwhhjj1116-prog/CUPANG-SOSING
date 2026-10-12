import {NextResponse} from 'next/server';
import {managedProductAccess} from '@/app/managed-product-access';
import {managedProductAccountContext} from '@/app/managed-products';
import {readBoundedBytes,RequestBodyError} from '@/app/request-body';
import {MANAGED_IMPORT_PRICE_FILE_LIMIT,parseManagedImportPrices,ManagedImportPriceConflict,ManagedImportPriceInputError} from '@/app/managed-import-prices';
import {planManagedImportPrices,commitManagedImportPrices,readManagedImportPrices} from '@/db/managed-import-prices';
const headers={'cache-control':'no-store'},fail=(error:string,status:number)=>NextResponse.json({error},{status,headers});
export async function GET(request:Request){
 const access=await managedProductAccess();if(!access)return fail('로그인 회원의 승인된 회사정보가 필요합니다.',403);
 const params=new URL(request.url).searchParams,page=Number(params.get('page')??1),pageSize=Number(params.get('pageSize')??10),skuId=params.get('skuId')??undefined,search=(params.get('search')??'').trim(),expected=params.get('expectedAccountContext');
 if(!Number.isSafeInteger(page)||page<1||page>10000||![10,25,50,100].includes(pageSize)||skuId!==undefined&&!/^\d{1,30}$/.test(skuId)||search.length>200||expected!==null&&!/^[a-f0-9]{64}$/.test(expected))return fail('매입내역의 검색·페이지·계정 조건을 확인해주세요.',400);
 try{const accountContext=await managedProductAccountContext(access.ownerId,access.company);if(expected!==null&&expected!==accountContext)return fail('현재 계정 또는 회사가 변경되었습니다. 다시 확인해주세요.',409);const data=await readManagedImportPrices(access.ownerId,access.company,{page,pageSize,skuId,search}),current=await managedProductAccess();if(!current||await managedProductAccountContext(current.ownerId,current.company)!==accountContext)return fail('조회 중 계정 또는 회사가 변경되었습니다. 다시 확인해주세요.',409);return NextResponse.json({...data,company:access.company,accountContext},{headers});}catch{return fail('현재 회사의 매입내역을 확인하지 못했습니다.',503);}
}
export async function POST(request:Request){
 const access=await managedProductAccess();if(!access)return fail('로그인 회원의 승인된 회사정보가 필요합니다.',403);
 let reading=false;
 try{
  const type=request.headers.get('content-type')??'';if(type.split(';')[0].trim().toLowerCase()!=='multipart/form-data')throw Error('매입정보 XLSX 파일을 선택해주세요.');
  const bytes=await readBoundedBytes(request,MANAGED_IMPORT_PRICE_FILE_LIMIT+20000),form=await new Response(bytes.buffer as ArrayBuffer,{headers:{'content-type':type}}).formData(),allowed=['file','action','matching','expectedSha256','expectedAccountContext','expectedSnapshot'];
  if([...form.keys()].some(key=>!allowed.includes(key)||form.getAll(key).length!==1))throw Error('매입정보 파일 한 개와 확인한 업로드 조건만 보내주세요.');
  const action=form.get('action'),matching=form.get('matching');if(action!=='preview'&&action!=='import'||matching!==null&&!['sku','barcode'].includes(String(matching)))throw Error('매입정보의 미리보기·업로드 단계를 확인해주세요.');
  const accountContext=await managedProductAccountContext(access.ownerId,access.company);if(action==='import'&&form.get('expectedAccountContext')!==accountContext)throw new ManagedImportPriceConflict('로그인 계정 또는 회사가 변경되었습니다. 다시 미리보기해주세요.');
  const file=form.get('file');if(!(file instanceof File)||!file.name.toLowerCase().endsWith('.xlsx')||file.name.length>240||/[\u0000-\u001f]/.test(file.name))throw Error('원본 매입정보 XLSX 파일을 선택해주세요.');if(file.size>MANAGED_IMPORT_PRICE_FILE_LIMIT)throw new RequestBodyError(413,'매입정보 파일은 5MB 이하만 지원합니다.');
  const parsed=await parseManagedImportPrices(await file.arrayBuffer());if(matching!==null&&matching!==parsed.matching)throw Error('선택한 매칭 방식과 파일 머리글이 다릅니다.');if(action==='import'&&form.get('expectedSha256')!==parsed.sha256)throw new ManagedImportPriceConflict('미리 본 파일과 업로드 파일이 다릅니다. 다시 미리보기해주세요.');
  reading=true;const plan=await planManagedImportPrices(access.ownerId,access.company,parsed,accountContext),current=await managedProductAccess();if(!current||await managedProductAccountContext(current.ownerId,current.company)!==accountContext)throw new ManagedImportPriceConflict('확인 중 계정 또는 회사가 변경되었습니다. 다시 미리보기해주세요.');
  const response={preview:action==='preview',matching:parsed.matching,company:access.company,accountContext,sha256:parsed.sha256,snapshot:plan.snapshot,counts:plan.counts,sample:plan.sample};
  if(action==='preview')return NextResponse.json(response,{headers});
  if(form.get('expectedSnapshot')!==plan.snapshot)throw new ManagedImportPriceConflict('원본 상품이나 매입내역이 변경되었습니다. 다시 미리보기해주세요.');
  await commitManagedImportPrices(access.ownerId,access.company,plan,parsed,file.name);return NextResponse.json(response,{headers,status:201});
 }catch(error){const known=error instanceof ManagedImportPriceConflict||error instanceof ManagedImportPriceInputError||error instanceof RequestBodyError||error instanceof RangeError;return fail(known||!reading?error instanceof Error?error.message:'매입정보 파일을 확인해주세요.':'현재 회사의 매입정보 저장·조회 결과를 확인하지 못했습니다.',error instanceof ManagedImportPriceConflict?409:error instanceof RequestBodyError?error.status:error instanceof RangeError?413:reading&&!known?503:400);}
}
