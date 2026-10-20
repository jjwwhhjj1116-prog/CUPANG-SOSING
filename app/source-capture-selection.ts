import {parseCollectionRequest} from '@/app/sourcing';
import type {SourceInboxItem} from '@/app/source-inbox';

export type SourceCaptureSelection={sourceUrl:string;format:'yoofam-saved-page-capture-v1';captureId:string;fingerprint:string;revision:number};
const keys=['sourceUrl','format','captureId','fingerprint','revision'];
export function validateSourceCaptureSelection(input:unknown,expectedUrl?:string):Readonly<SourceCaptureSelection>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('선택한 수집본 정보를 확인해주세요.');
  const descriptors=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(descriptors).length!==keys.length||keys.some(key=>!descriptors[key]||!Object.hasOwn(descriptors[key],'value')))
    throw Error('선택한 수집본 항목을 확인해주세요.');
  const value=Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
  if(value.format!=='yoofam-saved-page-capture-v1'||typeof value.sourceUrl!=='string'
    ||typeof value.captureId!=='string'||!/^[a-f0-9-]{36}$/u.test(value.captureId)||typeof value.fingerprint!=='string'||!/^[a-f0-9]{64}$/u.test(value.fingerprint)
    ||!Number.isSafeInteger(value.revision)||Number(value.revision)<1)throw Error('선택한 수집본의 버전 정보를 확인해주세요.');
  const canonical=parseCollectionRequest({urls:[value.sourceUrl]})[0].sourceUrl;
  if(canonical!==value.sourceUrl||expectedUrl!==undefined&&parseCollectionRequest({urls:[expectedUrl]})[0].sourceUrl!==canonical)
    throw Error('선택한 수집본과 상품 URL이 다릅니다. 수집본을 다시 선택해주세요.');
  return Object.freeze({sourceUrl:canonical,format:value.format,captureId:value.captureId,fingerprint:value.fingerprint,revision:Number(value.revision)});
}
export function sourceCaptureSelection(item:SourceInboxItem):Readonly<SourceCaptureSelection>{
  return validateSourceCaptureSelection({sourceUrl:item.snapshot.sourceUrl,format:'yoofam-saved-page-capture-v1',captureId:item.id,fingerprint:item.fingerprint,revision:item.revision});
}
export function sameSourceCaptureSelection(left:unknown,right:unknown):boolean{
  try{return JSON.stringify(validateSourceCaptureSelection(left))===JSON.stringify(validateSourceCaptureSelection(right));}catch{return false;}
}
/** Editing tracking parameters retains the exact selection. Another offer or
 * an unfinished URL releases it; category/guidance edits do not call this. */
export function sourceCaptureAfterUrlEdit(selection:SourceCaptureSelection|undefined,url:string):Readonly<SourceCaptureSelection>|undefined{
  if(selection===undefined)return undefined;
  const selected=validateSourceCaptureSelection(selection);
  try{return parseCollectionRequest({urls:[url]})[0].sourceUrl===selected.sourceUrl?selected:undefined;}catch{return undefined;}
}
export function selectedSourceInboxItem(items:readonly SourceInboxItem[],selection:SourceCaptureSelection):SourceInboxItem|undefined{
  const selected=validateSourceCaptureSelection(selection);
  return items.find(item=>item.id===selected.captureId&&item.fingerprint===selected.fingerprint&&item.revision===selected.revision&&item.snapshot.sourceUrl===selected.sourceUrl);
}
