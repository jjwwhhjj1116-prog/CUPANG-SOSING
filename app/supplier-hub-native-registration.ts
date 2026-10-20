import {exchange} from '@/app/supplier-hub-handoff';
import {readSingleCatalogContext} from '@/app/supplier-hub-single-client';
import {readNativeReceiptHistory} from '@/app/supplier-hub-product-client';
import {parseStoredProductReceipt,productReceiptCanonical,type ProductReceiptRecord} from '@/app/supplier-hub-product-receipt';

export type NativeRegistrationObservation={source:'supplier-hub-native-registration-v1';ownerId:string;company:ProductReceiptRecord['company'];
  productId:string;requestId:string;docId:string|number;qvtRequestId:string|number;categoryId:string;membersCount:number;identityDigest:string;preparedBodySha256:string;
  observedAt:number;rows:{quotationId:string;skuId:string|null;productName:string;status:'INSPECTION'|'INSPECTION_COMPLETE'|'REJECTION'}[];
  total:number;pagesRead:number;registered:false;mutated:false;optionMapping:'unverified'};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&value===value.trim()&&!/[\u0000-\u001f]/u.test(value);
const same=(a:unknown,b:unknown)=>productReceiptCanonical(a)===productReceiptCanonical(b);
function fail(message='원래 등록 문서와 상품별 접수 조회 결과의 연결을 확인하지 못했습니다.'):never{throw Error(message);}
function active(signal:AbortSignal){if(signal.aborted)fail('상품별 접수 상태 조회를 취소했습니다.');}

/** A native request ID is not a quotation UUID/estimation ID. Only the same
 * fresh WIMS item's explicit qvtRequestId can connect these identities. Rows
 * stay aggregate evidence; document order never assigns SKUs to option IDs. */
export function validateNativeRegistrationObservation(value:unknown,receipt:ProductReceiptRecord,now=Date.now()):NativeRegistrationObservation{
  const saved=parseStoredProductReceipt(receipt);productReceiptCanonical(value);
  const keys=['source','ownerId','company','productId','requestId','docId','qvtRequestId','categoryId','membersCount','identityDigest','preparedBodySha256',
    'observedAt','rows','total','pagesRead','registered','mutated','optionMapping'];
  if(!exact(value,keys)||value.source!=='supplier-hub-native-registration-v1'||value.ownerId!==saved.identity.ownerId||!same(value.company,saved.company)
    ||value.productId!==saved.productId||value.requestId!==saved.requestId||value.docId!==saved.docId||value.qvtRequestId!==saved.receipt.qvtRequestId
    ||value.categoryId!==saved.categoryId||value.membersCount!==saved.members.length||value.identityDigest!==saved.identityDigest||value.preparedBodySha256!==saved.preparedBodySha256
    ||value.registered!==false||value.mutated!==false||value.optionMapping!=='unverified'||!Number.isSafeInteger(now)||now<=0
    ||!Number.isSafeInteger(value.observedAt)||Number(value.observedAt)<saved.receipt.observedAt||Number(value.observedAt)>now+5000
    ||!Number.isSafeInteger(value.total)||Number(value.total)<0||Number(value.total)>saved.members.length
    ||!Number.isSafeInteger(value.pagesRead)||Number(value.pagesRead)<1||Number(value.pagesRead)>40
    ||!Array.isArray(value.rows)||value.rows.length!==value.total)fail();
  const seen=new Set<string>(),skus=new Set<string>();
  for(const row of value.rows){
    if(!exact(row,['quotationId','skuId','productName','status'])||!text(row.quotationId,36)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(row.quotationId)||!text(row.productName,2000)
      ||row.skuId!==null&&(!text(row.skuId,30)||!/^[1-9]\d{0,29}$/u.test(row.skuId))
      ||!['INSPECTION','INSPECTION_COMPLETE','REJECTION'].includes(row.status as string))fail();
    const key=JSON.stringify([row.quotationId,row.skuId,row.productName]);if(seen.has(key)||row.skuId!==null&&skus.has(row.skuId as string))fail();
    seen.add(key);if(row.skuId!==null)skus.add(row.skuId as string);
  }
  return Object.freeze({...value,company:Object.freeze({...value.company as ProductReceiptRecord['company']}),
    rows:Object.freeze(value.rows.map(row=>Object.freeze({...row})))}) as unknown as NativeRegistrationObservation;
}

/** Explicit read only. Re-read the authenticated immutable receipt and current
 * member before and after Chrome lookup. No export, new registration, source
 * refresh, agreement acceptance, or receipt update is performed here. */
export async function readSupplierHubNativeRegistration(receipt:ProductReceiptRecord,signal:AbortSignal,dependencies:{
  history?:typeof readNativeReceiptHistory;catalog?:typeof readSingleCatalogContext;bridge?:typeof exchange
}={}):Promise<NativeRegistrationObservation>{
  const saved=parseStoredProductReceipt(receipt),history=dependencies.history??readNativeReceiptHistory,catalog=dependencies.catalog??readSingleCatalogContext,bridge=dependencies.bridge??exchange;
  const controller=new AbortController(),abort=()=>controller.abort();if(signal.aborted)abort();signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,120000),scope={productId:saved.productId};
  try{
    active(controller.signal);const actor=await catalog(controller.signal);active(controller.signal);
    if(actor.ownerId!==saved.identity.ownerId||!same(actor.company,saved.company))fail('원래 견적서를 전송한 회원 회사에서 조회해주세요.');
    const stored=async()=>{const rows=await history(scope,controller.signal);active(controller.signal);
      const matching=rows.filter(row=>row.requestId===saved.requestId);if(matching.length!==1||!same(matching[0],saved))fail('보관된 문서 접수 결과가 변경됐습니다. 최신 이력을 다시 열어 조회해주세요.');};
    await stored();const info=await bridge('PING',null,controller.signal);active(controller.signal);
    if(info.nativeRegistrationStatus!==true)fail('상품별 문서 접수 조회를 지원하는 통합 확장 2.1.4로 새로고침해주세요.');
    const result=await bridge('NATIVE_REGISTRATIONS',{productId:saved.productId,requestId:saved.requestId,
      identityDigest:saved.identityDigest,preparedBodySha256:saved.preparedBodySha256},controller.signal);active(controller.signal);
    if(!exact(result,['ok','observation'])||result.ok!==true)fail();
    const observed=validateNativeRegistrationObservation(result.observation,saved);
    await stored();const after=await catalog(controller.signal);active(controller.signal);if(!same(actor,after))fail('조회 중 회원 회사가 변경되어 결과를 표시하지 않았습니다.');
    return observed;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
