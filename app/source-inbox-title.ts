import type {SourceInboxItem} from '@/app/source-inbox';
import {unsupportedTranslatedProductClaim} from '@/app/product-translation-quality';

export type SourceInboxTitlePreparation={format:'yoofam-collected-title-v1';fingerprint:string;revision:number;sourceTitle:string;state:'pending'|'running'|'completed'|'failed';translatedTitle:string|null;brand:string;attempts:number;retryable:boolean;message:string;provider?:string;model?:string|null;providerSignature?:string};
export function validCollectedKoreanTitle(value:unknown):value is string{return typeof value==='string'&&!!value.trim()&&value.length<=500&&/\p{Script=Hangul}/u.test(value)&&!/[\p{Script=Han}\u0000-\u001f\u007f<>]/u.test(value);}
export function validCollectedTitleTranslation(source:string,value:unknown):value is string{return validCollectedKoreanTitle(value)&&!unsupportedTranslatedProductClaim(value,source)&&JSON.stringify((source.match(/\d+(?:[.,]\d+)*/gu)??[]).sort())===JSON.stringify((value.match(/\d+(?:[.,]\d+)*/gu)??[]).sort());}
export function sourceHasManualTitle(item:SourceInboxItem){return !!item.reviewed&&item.reviewed.title!==item.snapshot.title;}
export function collectedTitleWithBrand(title:string,brand:string){
 const prefix=brand.trim();if(!prefix||title===prefix||title.startsWith(prefix+' '))return title;
 let value=(prefix+' '+title).slice(0,500);if(/[\uD800-\uDBFF]$/u.test(value))value=value.slice(0,-1);return value.trim();
}
/** Display preparation never edits the captured source or completes SEO. */
export function sourceInboxDisplayTitle(item:SourceInboxItem):string{
 if(sourceHasManualTitle(item))return item.reviewed!.title;
 const value=item.titlePreparation;
 return value?.format==='yoofam-collected-title-v1'&&value.fingerprint===item.fingerprint&&value.revision===item.revision&&value.sourceTitle===item.snapshot.title&&value.state==='completed'&&validCollectedTitleTranslation(item.snapshot.title,value.translatedTitle)
  ?collectedTitleWithBrand(value.translatedTitle,value.brand):item.reviewed?.title??item.snapshot.title;
}
