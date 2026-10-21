import type {IntakeRow} from '@/app/intake-queue';
import type {SourceInboxItem} from '@/app/source-inbox';
import {sourceCaptureSelection,sameSourceCaptureSelection,validateSourceCaptureSelection,type SourceCaptureSelection} from '@/app/source-capture-selection';
import {supplierHubCompany} from '@/app/supplier-hub-company';
import {validatePageSource,pageSourceIssues} from '../extensions/supplier-hub/page-source.mjs';

export type ReviewedSourceTarget={rowId:string;sourceCapture:Readonly<SourceCaptureSelection>};

function sameData(left:unknown,right:unknown):boolean{
  if(Object.is(left,right))return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
  if(Object.getOwnPropertySymbols(left).length||Object.getOwnPropertySymbols(right).length)return false;
  const a=Object.getOwnPropertyDescriptors(left),b=Object.getOwnPropertyDescriptors(right),keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&Object.hasOwn(a[key],'value')&&Object.hasOwn(b[key],'value')&&sameData(a[key].value,b[key].value));
}

/** Only the acknowledgement of this exact review may advance a pinned capture.
 * A list refresh, recapture or a revision jump is never a review acknowledgement. */
export function validateReviewedSourceTransition(before:SourceInboxItem,saved:SourceInboxItem,expectedOwnerId?:string):boolean{
  try{
    const previous=sourceCaptureSelection(before),next=sourceCaptureSelection(saved);
    if(!before.ownerId||before.ownerId!==saved.ownerId||expectedOwnerId!==undefined&&before.ownerId!==expectedOwnerId
      ||previous.captureId!==next.captureId||previous.fingerprint!==next.fingerprint||previous.sourceUrl!==next.sourceUrl||next.revision!==previous.revision+1
      ||!supplierHubCompany(before.company.code,before.company.name)||before.company.code!==saved.company.code||before.company.name!==saved.company.name
      ||before.archivedAt!==null||saved.archivedAt!==null||before.receivedAt!==saved.receivedAt||!Number.isFinite(Date.parse(before.receivedAt))
      ||before.captureOriginId!==saved.captureOriginId||before.captureVersion!==saved.captureVersion||!sameData(before.snapshot,saved.snapshot)||!saved.reviewed)return false;
    const snapshot=validatePageSource(saved.snapshot),reviewed=validatePageSource(saved.reviewed);
    if(!sameData(snapshot,saved.snapshot)||!sameData(reviewed,saved.reviewed)||!reviewed.options.length
      ||!sameData({...snapshot,title:reviewed.title,options:reviewed.options},reviewed))return false;
    for(const option of reviewed.options){
      const original=snapshot.options.find(row=>row.key===option.key);
      if(!original||original.stock!==option.stock||original.imageUrl!==option.imageUrl||!sameData(original.axisValues,option.axisValues))return false;
    }
    const issues=pageSourceIssues(reviewed).filter(issue=>!['최소 주문 수량','공급자 SKU'].includes(issue));
    return !issues.length&&sameData(saved.issues,issues);
  }catch{return false;}
}

/** Apply only to selections explicitly captured when this review was opened.
 * Preserve guidance, category, order and all existing work links. */
export function applyReviewedSourceToIntakeRows(rows:IntakeRow[],targets:readonly ReviewedSourceTarget[],before:SourceInboxItem,saved:SourceInboxItem):IntakeRow[]{
  if(!validateReviewedSourceTransition(before,saved))return rows;
  const previous=sourceCaptureSelection(before),next=sourceCaptureSelection(saved);let changed=false;
  const updated=rows.map(row=>{
    if(row.status==='saved'||row.productId||row.forkJobId||row.pendingJobId)return row;
    const target=targets.find(value=>value.rowId===row.id&&sameSourceCaptureSelection(value.sourceCapture,row.sourceCapture));
    if(!target)return row;
    try{
      const selected=validateSourceCaptureSelection(target.sourceCapture,row.url);
      if(selected.captureId!==previous.captureId||selected.fingerprint!==previous.fingerprint||selected.sourceUrl!==previous.sourceUrl||selected.revision>previous.revision)return row;
      changed=true;return {...row,sourceCapture:next};
    }catch{return row;}
  });
  return changed?updated:rows;
}
