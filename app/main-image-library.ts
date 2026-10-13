import type {QuotationFieldsView} from '@/app/quotation-schema';
import {verifyMainImageView} from '@/app/quotation-main-image';
import {PRODUCT_IMAGE_POOL_LIMIT} from '@/app/image-pool-limit';

export type MainImageLibraryTab='work'|'main'|'options'|'detail';
export type MainImageLibrary={productId:string;productVersion:string;contentRevision:number;optionRevision:number;imageKeys:string[];main:string[];options:string[];detail:string[]};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>new Error('저장된 이미지 종류를 현재 상품·옵션 버전과 연결하지 못했습니다. 전체 작업 이미지에서 선택할 수 있습니다.');
function keys(value:unknown,limit=PRODUCT_IMAGE_POOL_LIMIT):string[]{
 if(!Array.isArray(value)||value.length>limit||value.some(key=>typeof key!=='string'||!key||key.length>4096))throw invalid();
 return value as string[];
}
/** Library grouping is display-only evidence from the same saved revisions.
 * It is not a claim to classify every original 1688 gallery image. Missing or
 * removed references never resurrect files outside the quotation's owned pool. */
export function classifyMainImageLibrary(productId:string,view:QuotationFieldsView,contentBody:unknown,optionsBody:unknown):MainImageLibrary{
 verifyMainImageView(view);
 if(!record(contentBody)||!record(contentBody.content)||!record(optionsBody)||!record(optionsBody.options))throw invalid();
 const content=contentBody.content,options=optionsBody.options;
 if(content.productId!==productId||content.schemaVersion!==1||content.revision!==view.contentRevision||!record(content.assets)
  ||options.productId!==productId||options.schemaVersion!==1||options.revision!==view.optionRevision||optionsBody.productVersion!==view.productVersion
  ||!Array.isArray(options.rows)||options.rows.length>200)throw invalid();
 const assets=content.assets,readRole=(name:string)=>{const field=assets[name];if(!record(field))throw invalid();return keys(field.value);};
 const main=readRole('main'),detail=[...readRole('detailTop'),...readRole('detail'),...readRole('detailBottom')];
 const optionIds=new Set<string>(),optionImages:string[]=[];
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
 const pool=new Set(view.imageKeys),saved=(values:string[])=>[...new Set(values)].filter(key=>pool.has(key));
 return {productId,productVersion:view.productVersion,contentRevision:view.contentRevision,optionRevision:view.optionRevision,imageKeys:[...view.imageKeys],main:saved(main),options:saved(optionImages),detail:saved(detail)};
}
export function mainImageLibraryCurrent(library:MainImageLibrary,productId:string,view:QuotationFieldsView):boolean{
 return library.productId===productId&&library.productVersion===view.productVersion&&library.contentRevision===view.contentRevision
  &&library.optionRevision===view.optionRevision&&JSON.stringify(library.imageKeys)===JSON.stringify(view.imageKeys);
}
export function mainImageLibraryKeys(tab:MainImageLibraryTab,view:QuotationFieldsView,library:MainImageLibrary|null):string[]{
 if(tab==='work')return [...view.imageKeys];
 return library?library[tab]:[];
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
