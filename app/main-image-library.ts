import type {QuotationFieldsView} from '@/app/quotation-schema';
import {verifyMainImageView} from '@/app/quotation-main-image';
import {PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-pool-limit';
import {supplierHubCompany,type SupplierHubCompany} from '@/app/supplier-hub-company';

export type MainImageLibraryTab='work'|'main'|'options'|'detail';
export type MainImageLibraryEvidence={format:'main-image-library-evidence-v1';productId:string;productVersion:string;optionRevision:number;company:SupplierHubCompany;
 source:{jobId:string;receivedAt:string;fingerprint:string}|null;work:string[];main:string[];options:string[];detail:string[]};
export type MainImageLibrary={productId:string;productVersion:string;contentRevision:number;optionRevision:number;imageKeys:string[];work:string[];main:string[];options:string[];detail:string[]};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>new Error('원문·처리 이미지 종류를 현재 상품·옵션 버전과 연결하지 못했습니다. 저장 이미지는 유지됩니다.');
function keys(value:unknown,limit=PRODUCT_IMAGE_POOL_LIMIT):string[]{
 if(!Array.isArray(value)||value.length>limit||value.some(key=>typeof key!=='string'||!key||key.length>4096))throw invalid();
 return value as string[];
}
/** Source galleries and completed processing results are response-only evidence.
 * Editable stage assignments never redefine the immutable original gallery.
 * Missing provenance stays unclassified; no file outside the owned pool returns. */
export function classifyMainImageLibrary(productId:string,view:QuotationFieldsView,contentBody:unknown,optionsBody:unknown):MainImageLibrary{
 const binding=verifyMainImageView(view);
 if(!record(contentBody)||!record(contentBody.content)||!record(optionsBody)||!record(optionsBody.options))throw invalid();
 const content=contentBody.content,options=optionsBody.options;
 if(content.productId!==productId||content.schemaVersion!==1||content.revision!==view.contentRevision||!record(content.assets)
  ||options.productId!==productId||options.schemaVersion!==1||options.revision!==view.optionRevision||optionsBody.productVersion!==view.productVersion
  ||!Array.isArray(options.rows)||options.rows.length>200)throw invalid();
 const evidence=optionsBody.imageLibrary;
 if(!record(evidence)||evidence.format!=='main-image-library-evidence-v1'||evidence.productId!==productId||evidence.productVersion!==view.productVersion||evidence.optionRevision!==view.optionRevision
  ||!record(evidence.company)||!supplierHubCompany(evidence.company.code,evidence.company.name))throw invalid();
 if(evidence.source!==null&&(!record(evidence.source)||typeof evidence.source.jobId!=='string'||!/^\w[\w-]{0,99}$/.test(evidence.source.jobId)
  ||typeof evidence.source.receivedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(evidence.source.receivedAt)||!Number.isFinite(Date.parse(evidence.source.receivedAt))
  ||typeof evidence.source.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(evidence.source.fingerprint)))throw invalid();
 const work=keys(evidence.work),main=keys(evidence.main),detail=keys(evidence.detail),originalOptions=keys(evidence.options);
 if(evidence.source===null&&(main.length||detail.length||originalOptions.length))throw invalid();
 const optionIds=new Set<string>(),optionImages:string[]=[...originalOptions];
 for(const value of options.rows){
  if(!record(value)||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value.id)||optionIds.has(value.id)
   ||value.imageKey!==null&&(typeof value.imageKey!=='string'||!value.imageKey||value.imageKey.length>4096))throw invalid();
  optionIds.add(value.id);if(typeof value.imageKey==='string')optionImages.push(value.imageKey);
 }
 const resolvedIds=view.resolved.rows.flatMap(row=>row.optionId?[row.optionId]:[]);
 if(resolvedIds.length!==optionIds.size||resolvedIds.some(id=>!optionIds.has(id)))throw invalid();
 if(optionsBody.sourceImageKeys!==undefined){
  if(!record(optionsBody.sourceImageKeys)||Object.keys(optionsBody.sourceImageKeys).length>200)throw invalid();
  for(const [id,key]of Object.entries(optionsBody.sourceImageKeys)){if(!optionIds.has(id)||typeof key!=='string'||!key||key.length>4096)throw invalid();optionImages.push(key);}
 }
 // Final per-option quotation choices can differ from product_options.imageKey.
 // Include those actual saved choices without calling them raw source images.
 for(const row of view.resolved.rows){const value=row.fields[binding.primary]?.value;if(row.optionId&&typeof value==='string')optionImages.push(...value.split('\n').map(key=>key.trim()).filter(Boolean));}
 const pool=new Set(view.imageKeys),saved=(values:string[])=>[...new Set(values)].filter(key=>pool.has(key));
 return {productId,productVersion:view.productVersion,contentRevision:view.contentRevision,optionRevision:view.optionRevision,imageKeys:[...view.imageKeys],work:saved(work),main:saved(main),options:saved(optionImages),detail:saved(detail)};
}
export function mainImageLibraryCurrent(library:MainImageLibrary,productId:string,view:QuotationFieldsView):boolean{
 return library.productId===productId&&library.productVersion===view.productVersion&&library.contentRevision===view.contentRevision
  &&library.optionRevision===view.optionRevision&&JSON.stringify(library.imageKeys)===JSON.stringify(view.imageKeys);
}
export function mainImageLibraryKeys(tab:MainImageLibraryTab,view:QuotationFieldsView,library:MainImageLibrary|null):string[]{
 return library&&mainImageLibraryCurrent(library,library.productId,view)?[...library[tab]]:[];
}
/** Two existing read-only endpoints. The content revision and the options
 * product clock both have to match the already verified quotation snapshot. */
export async function readMainImageLibrary(productId:string,view:QuotationFieldsView,request:typeof fetch=fetch):Promise<MainImageLibrary>{
 const base=`/api/products/${encodeURIComponent(productId)}`;
 const responses=await Promise.all([request(base+'/content',{cache:'no-store'}),request(base+'/options',{cache:'no-store'})]);
 const bodies=await Promise.all(responses.map(response=>response.json()));
 if(responses.some(response=>!response.ok))throw invalid();
 return classifyMainImageLibrary(productId,view,bodies[0],bodies[1]);
}
