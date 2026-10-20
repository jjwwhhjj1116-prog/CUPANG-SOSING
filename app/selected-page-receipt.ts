import {validateCollectionResult,type CollectionResult} from '@/app/collection-result';

/** A stored receipt may include a later source supplement. A selected inbox
 * version cannot acknowledge that different effective result as its own. */
export function selectedPageReceiptMatches(actual:CollectionResult,expected:CollectionResult|undefined,offerId:string):boolean{
 try{
  const normalized=(value:CollectionResult)=>{
   const {offerId:storedOfferId,...source}=value;
   if(storedOfferId!==offerId)throw Error('선택 상품번호가 다릅니다.');
   return JSON.stringify(validateCollectionResult(source,offerId));
  };
  return expected!==undefined&&normalized(actual)===normalized(expected);
 }catch{return false;}
}
