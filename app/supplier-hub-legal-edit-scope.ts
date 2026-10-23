import type {QuotationFieldsView} from '@/app/quotation-schema';
import {readSingleCatalogContext} from '@/app/supplier-hub-single-client';
import {validOptionRegistrationNumbers} from '@/app/product-registration';
import {productRemovalDecision} from '@/app/product-removal-policy';
import {getSupplierHubProductHistory} from '@/app/supplier-hub-handoff';
import {productDocumentPendingKey,readProductDocumentPending,readProductDocumentRejections} from '@/app/supplier-hub-product-pending';

export type SupplierHubLegalSource={productId:string;profileId?:string;expectedCategoryId?:string};
const identifier=/^[A-Za-z0-9_-]{1,100}$/,hash=/^[a-f0-9]{64}$/;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
function active(signal:AbortSignal){if(signal.aborted)throw Error('현재 상품 견적 확인을 취소했습니다.');}
async function readJson(path:string,signal:AbortSignal,request:typeof fetch):Promise<unknown>{
  active(signal);
  const response=await request(path,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',signal});active(signal);
  if(!response.ok||response.redirected||!response.headers.get('content-type')?.includes('application/json')
    ||response.url&&response.url!==window.location.origin+path)throw Error('현재 상품의 저장 자료를 확인하지 못했습니다.');
  const reader=response.body?.getReader();if(!reader)throw Error('현재 상품의 저장 자료가 비어 있습니다.');
  const chunks:Uint8Array[]=[];let length=0;const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{
    for(;;){active(signal);const part=await reader.read();active(signal);if(part.done)break;length+=part.value.byteLength;if(length>6*1024*1024)throw Error('현재 견적 자료가 처리 한도를 초과했습니다.');chunks.push(part.value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function productVersion(value:unknown,productId:string,ownerId:string):string{
  const product=object(value)&&object(value.product)?value.product:null;
  if(!product||product.id!==productId||product.owner_id!==ownerId||typeof product.updated_at!=='string'||!product.updated_at.trim())throw Error('현재 로그인한 회원의 상품 자료를 확인해주세요.');
  return product.updated_at;
}
function fields(value:unknown,props:Pick<SupplierHubLegalSource,'profileId'|'expectedCategoryId'>,version:string):QuotationFieldsView{
  const view=value as QuotationFieldsView;
  const context=view?.categoryContext,rows=view?.resolved?.rows,schema=view?.resolved?.schema;
  if(!object(value)||!Number.isSafeInteger(view.revision)||view.revision<0||!hash.test(view.inputFingerprint)||view.productVersion!==version
    ||!Number.isSafeInteger(view.contentRevision)||view.contentRevision<0||!Number.isSafeInteger(view.optionRevision)||view.optionRevision<0||view.submissionReady!==false
    ||!context||!['profile','collection','unknown'].includes(context.source)||context.profileId!==null&&!identifier.test(context.profileId)
    ||typeof context.categoryId!=='string'||!context.categoryId||!Array.isArray(context.categoryPath)||!context.categoryPath.every(part=>typeof part==='string')
    ||props.profileId!==undefined&&context.profileId!==props.profileId||props.expectedCategoryId!==undefined&&context.categoryId!==props.expectedCategoryId
    ||!schema||schema.categoryId!==context.categoryId||JSON.stringify(schema.categoryPath)!==JSON.stringify(context.categoryPath)||schema.submissionReady!==false
    ||!view.automatic||view.automatic.schema?.categoryId!==context.categoryId||!object(view.overrides)||!object(view.overrides.common)||!object(view.overrides.options)
    ||!Array.isArray(view.imageKeys)||!view.imageKeys.every(key=>typeof key==='string')||!Array.isArray(rows)||!rows.length
    ||rows.some(row=>!object(row)||row.optionId!==null&&(typeof row.optionId!=='string'||!identifier.test(row.optionId))||typeof row.optionLabel!=='string'||typeof row.included!=='boolean'||!object(row.fields)
      ||Object.values(row.fields).some(field=>!object(field)||typeof field.value!=='string'))
    ||new Set(rows.map(row=>row.optionId)).size!==rows.length
    ||!validOptionRegistrationNumbers(view.optionRegistrationNumbers,rows.flatMap(row=>row.optionId===null?[]:[{id:row.optionId}])))throw Error('현재 상품의 카테고리·옵션·견적 연결을 다시 확인해주세요.');
  return view;
}
/** Read-only entry for the primary whole-product review. A captured category
 * stays queryless; a live saved profile is never silently substituted. */
export async function readSupplierHubProductSubmissionView(props:SupplierHubLegalSource,signal:AbortSignal,request:typeof fetch=fetch):Promise<QuotationFieldsView>{
  if(!identifier.test(props.productId)||props.profileId!==undefined&&!identifier.test(props.profileId)||props.expectedCategoryId!==undefined&&!props.expectedCategoryId)throw Error('확인할 상품과 카테고리를 다시 선택해주세요.');
  const productPath=`/api/products/${encodeURIComponent(props.productId)}`,path=productPath+'/quotation-fields'+(props.profileId?`?profileId=${encodeURIComponent(props.profileId)}`:'');
  active(signal);const before=await readSingleCatalogContext(signal,request);active(signal);
  const version=productVersion(await readJson(productPath,signal,request),props.productId,before.ownerId);
  const first=fields(await readJson(path,signal,request),props,version),snapshot=JSON.stringify(first);
  const next=fields(await readJson(path,signal,request),props,version);
  if(JSON.stringify(next)!==snapshot||productVersion(await readJson(productPath,signal,request),props.productId,before.ownerId)!==version)throw Error('확인 중 상품·옵션 또는 견적 저장값이 변경됐습니다. 최신 자료를 다시 확인해주세요.');
  const after=await readSingleCatalogContext(signal,request);active(signal);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('확인 중 로그인한 회원 회사가 변경됐습니다. 최신 자료를 다시 확인해주세요.');
  return next;
}

/** Legal edits share the native product lock. Unknown/active history is never
 * permission to change the source of an already requested document. */
export async function readSupplierHubLegalEditScope(props:SupplierHubLegalSource,view:QuotationFieldsView,signal:AbortSignal,request:typeof fetch=fetch,history=getSupplierHubProductHistory){
  const actor=await readSingleCatalogContext(signal,request);active(signal);
  const value=await readJson(`/api/products/${encodeURIComponent(props.productId)}`,signal,request);
  productVersion(value,props.productId,actor.ownerId);
  if(!object(value)||!object(value.product)||productRemovalDecision(value.product).blocked)throw Error('전송 이력이 없거나 반려된 상품인지 확인한 뒤 서류를 수정해주세요. 처리 중·완료·미확인 전송의 원본은 유지합니다.');
  const scope={identity:{ownerId:actor.ownerId,company:actor.company,productId:props.productId}};
  const pending=()=>{readProductDocumentRejections(scope);if(readProductDocumentPending(scope))throw Error('이 상품의 원래 문서 전송 요청이 있습니다. 저장 결과를 확인하기 전에는 서류를 수정하지 않습니다.');};
  pending();
  const local=await history({productId:props.productId,categoryId:view.categoryContext.categoryId!,fingerprint:view.inputFingerprint},signal);active(signal);
  if(local.blocked)throw Error('Chrome에 이 상품의 전송 또는 미확정 시도가 있습니다. 원래 전송 결과를 먼저 확인해주세요.');
  const latest=await readSupplierHubProductSubmissionView(props,signal,request);
  const after=await readSingleCatalogContext(signal,request);active(signal);pending();
  if(JSON.stringify(actor)!==JSON.stringify(after)||JSON.stringify(latest)!==JSON.stringify(view))throw Error('회원 회사 또는 상품 견적이 변경되었습니다. 전체 상품 견적을 다시 확인해주세요.');
  return scope;
}

/** Both legal editor entry points use the same immutable source and native Web Lock. */
export async function guardSupplierHubLegalWrite(props:SupplierHubLegalSource,view:QuotationFieldsView,run:()=>Promise<Response>,signal:AbortSignal,allowed:()=>boolean){
  if(!allowed())throw Error('현재 견적 전송 작업을 마친 뒤 서류를 수정해주세요.');
  const scope=await readSupplierHubLegalEditScope(props,view,signal);
  const locks=window.navigator?.locks;if(!locks||typeof locks.request!=='function')throw Error('원본 서류 편집 잠금을 확인하지 못했습니다.');
  return locks.request(productDocumentPendingKey(scope),{mode:'exclusive',signal},async()=>{
    if(!allowed())throw Error('현재 상품의 서류 편집이 변경되었습니다.');
    await readSupplierHubLegalEditScope(props,view,signal);
    active(signal);if(!allowed())throw Error('현재 상품의 서류 편집이 변경되었습니다.');
    return run();
  });
}
