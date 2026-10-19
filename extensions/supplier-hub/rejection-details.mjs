// Retained native Hub K4 remark.errors rendering: columnName/message.
// Diagnostics never establish receipt identity, acceptance or permission to retry.
const FORMAT='yoofam-hub-rejection-details-v1',MAX_ERRORS=32,MAX_BYTES=32768;
const dataRecord=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value))
  &&Reflect.ownKeys(value).every(key=>typeof key==='string')
  &&Object.values(Object.getOwnPropertyDescriptors(value)).every(field=>Object.hasOwn(field,'value'));
const exact=(value,keys)=>dataRecord(value)&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const dense=value=>Array.isArray(value)&&value.length<=MAX_ERRORS&&Reflect.ownKeys(value).length===value.length+1
  &&Object.keys(value).every((key,index)=>key===String(index))&&Object.keys(value).length===value.length
  &&Object.values(Object.getOwnPropertyDescriptors(value)).every(field=>Object.hasOwn(field,'value'));
const text=(value,limit)=>typeof value==='string'&&value.trim().length>0&&value.length<=limit&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const errorValid=value=>exact(value,['columnName','message'])&&text(value.columnName,200)&&text(value.message,2000);
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
const unavailable=()=>Object.freeze({format:FORMAT,status:'unavailable',errors:Object.freeze([])});

/** Validate only an optional, bounded diagnostic. Legacy receipts may omit it. */
export function isRejectionDetails(value){
  if(!exact(value,['format','status','errors'])||value.format!==FORMAT||!dense(value.errors)||!value.errors.every(errorValid))return false;
  if(value.status==='unavailable')return value.errors.length===0;
  return value.status==='available'&&value.errors.length>0&&bytes(value)<=MAX_BYTES
    &&new Set(value.errors.map(error=>JSON.stringify([error.columnName,error.message]))).size===value.errors.length;
}
export function receiptRejectionDetailsValid(receipt){
  return dataRecord(receipt)&&(!Object.hasOwn(receipt,'rejectionDetails')
    ||receipt.sourceStatus==='REJECTED'&&receipt.state==='rejected'&&isRejectionDetails(receipt.rejectionDetails));
}

/** Called only after the normalizer has matched the exact native document row.
 * Bad/missing remark data must not invalidate a separately confirmed rejection. */
export function normalizeRejectionDetails(remark){
  if(typeof remark!=='string'||remark.length>262144)return unavailable();
  try{
    const parsed=JSON.parse(remark);
    if(!dataRecord(parsed)||!dense(parsed.errors)||parsed.errors.length===0)return unavailable();
    const seen=new Set(),errors=[];
    for(const item of parsed.errors){
      if(!dataRecord(item)||!text(item.columnName,200)||!text(item.message,2000))return unavailable();
      const key=JSON.stringify([item.columnName,item.message]);
      if(!seen.has(key)){seen.add(key);errors.push(Object.freeze({columnName:item.columnName,message:item.message}));}
    }
    const result={format:FORMAT,status:'available',errors:Object.freeze(errors)};
    return bytes(result)<=MAX_BYTES?Object.freeze(result):unavailable();
  }catch{return unavailable();}
}
