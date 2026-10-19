import type {CollectionResult} from '@/app/collection-result';

export type CollectionSourceGallery={format:'1688-openapi-gallery-v1';imageIndices:number[]};

/** New OpenAPI results retain their original gallery before adding SKU files.
 * A source supplement appends files and preserves that original prefix. Older
 * receipts have no marker: never infer provenance from option references. */
export function validateCollectionSourceGallery(value:unknown,provider:string,images:readonly {role:string}[]):CollectionSourceGallery{
  const fail=():never=>{throw Error('수집 원문의 갤러리 이미지 연결을 확인해주세요.');};
  if(!['1688-openapi-candidate-v1','chrome-public-mobile-supplement-v1'].includes(provider)||!value||typeof value!=='object'||Array.isArray(value))return fail();
  if(Reflect.ownKeys(value).length!==2||!['format','imageIndices'].every(key=>Object.hasOwn(value,key))
    ||Object.values(Object.getOwnPropertyDescriptors(value)).some(field=>!Object.hasOwn(field,'value')))return fail();
  const gallery=value as Record<string,unknown>,indices=gallery.imageIndices;
  if(gallery.format!=='1688-openapi-gallery-v1'||!Array.isArray(indices)||indices.length<1||indices.length>200
    ||Reflect.ownKeys(indices).length!==indices.length+1||Object.keys(indices).length!==indices.length
    ||!Object.keys(indices).every((key,index)=>key===String(index))
    ||Object.values(Object.getOwnPropertyDescriptors(indices)).some(field=>!Object.hasOwn(field,'value'))
    ||!indices.every((index,position)=>Number.isInteger(index)&&index===position&&images[index]?.role===(position===0?'main':'additional')))return fail();
  return {format:'1688-openapi-gallery-v1',imageIndices:[...indices]};
}

/** Common-stage eligibility is independent of SKU image binding and storage. */
export function collectionCommonImageCandidate(receipt:Pick<CollectionResult,'images'|'sourceGallery'>,index:number):boolean{
  const image=receipt.images[index];
  return !!image&&(image.role!=='additional'||receipt.sourceGallery===undefined||receipt.sourceGallery.imageIndices.includes(index));
}
