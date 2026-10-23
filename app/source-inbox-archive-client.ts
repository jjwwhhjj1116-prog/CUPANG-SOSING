import type {SourceInboxItem} from '@/app/source-inbox';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export type SourceArchiveReference={ownerId:string;company:SupplierHubCompany;id:string;fingerprint:string;sourceUrl:string;revision:number};
export type SourceArchiveReceipt=SourceArchiveReference&{previousRevision:number;archived:true;archivedAt:string};
const companies:Record<string,string>={A01526306:'유앤채',A01464742:'와이홉'};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export function sourceArchiveReference(item:SourceInboxItem,ownerId?:string,company?:SupplierHubCompany|null):SourceArchiveReference|null{
 if(!ownerId||!item||item.ownerId!==ownerId||item.archivedAt!==null||!company||companies[company.code]!==company.name
  ||item.company?.code!==company.code||item.company?.name!==company.name||!/^[a-f0-9-]{36}$/u.test(item.id)||!/^[a-f0-9]{64}$/u.test(item.fingerprint)
  ||!Number.isSafeInteger(item.revision)||item.revision<1)return null;
 const sourceUrl=item.snapshot?.sourceUrl;
 try{const url=new URL(sourceUrl);if(url.href!==sourceUrl||url.protocol!=='https:'||url.hostname!=='detail.1688.com'||url.port||url.username||url.password||url.search||url.hash||!/^\/offer\/\d{1,24}\.html$/u.test(url.pathname))return null;}catch{return null;}
 return {ownerId,company:{code:company.code,name:company.name},id:item.id,fingerprint:item.fingerprint,sourceUrl,revision:item.revision};
}
export const sameSourceArchiveReference=(first:SourceArchiveReference|null|undefined,second:SourceArchiveReference|null|undefined)=>!!first&&!!second
 &&first.ownerId===second.ownerId&&first.company.code===second.company.code&&first.company.name===second.company.name&&first.id===second.id
 &&first.fingerprint===second.fingerprint&&first.sourceUrl===second.sourceUrl&&first.revision===second.revision;
export function readSourceArchiveReceipt(value:unknown,before:SourceArchiveReference):SourceArchiveReceipt{
 if(!object(value)||Object.keys(value).sort().join(',')!=='archived,archivedAt,company,fingerprint,id,ownerId,previousRevision,revision,sourceUrl'
  ||!object(value.company)||Object.keys(value.company).sort().join(',')!=='code,name'||value.ownerId!==before.ownerId||value.company.code!==before.company.code||value.company.name!==before.company.name
  ||value.id!==before.id||value.fingerprint!==before.fingerprint||value.sourceUrl!==before.sourceUrl||value.previousRevision!==before.revision||value.revision!==before.revision+1
  ||value.archived!==true||typeof value.archivedAt!=='string'||value.archivedAt.length>30||!Number.isFinite(Date.parse(value.archivedAt)))throw Error('수집 상품 삭제 결과가 선택한 원문과 일치하지 않습니다. 목록을 다시 불러와 확인해주세요.');
 return {ownerId:before.ownerId,company:{...before.company},id:before.id,fingerprint:before.fingerprint,sourceUrl:before.sourceUrl,
  previousRevision:before.revision,revision:value.revision as number,archived:true,archivedAt:value.archivedAt};
}
/** A single explicit archive request. Unknown acknowledgement never retries. */
export async function archiveSourceInboxItem(item:SourceInboxItem,input:{ownerId:string;company:SupplierHubCompany;signal:AbortSignal;assertCurrent:()=>void;fetcher?:typeof fetch}):Promise<SourceArchiveReceipt>{
 const before=sourceArchiveReference(item,input.ownerId,input.company);if(!before)throw Error('현재 회원·회사에서 선택한 수집 원문을 확인해주세요.');
 input.assertCurrent();if(input.signal.aborted)throw Error('수집 상품 삭제를 취소했습니다.');
 const response=await(input.fetcher??fetch)('/api/source-inbox',{method:'DELETE',credentials:'same-origin',cache:'no-store',redirect:'error',signal:input.signal,headers:{'content-type':'application/json'},
  body:JSON.stringify({expectedOwnerId:before.ownerId,id:before.id,expectedRevision:before.revision,expectedCompany:before.company,expectedFingerprint:before.fingerprint,expectedSourceUrl:before.sourceUrl})});
 const value:unknown=await response.json();input.assertCurrent();if(input.signal.aborted)throw Error('수집 상품 삭제를 취소했습니다.');
 if(!response.ok)throw Error(object(value)&&typeof value.error==='string'?value.error:'수집 상품 삭제 결과를 확인하지 못했습니다. 목록을 다시 불러와 확인해주세요.');
 return readSourceArchiveReceipt(value,before);
}
