import type {SourceInboxItem} from '@/app/source-inbox';

export function sameSourceUrl(first:string,second:string){
 try{const a=new URL(first),b=new URL(second);return a.origin===b.origin&&a.pathname===b.pathname;}catch{return false;}
}
/** A captured page is a list entry, not a priced/registered product. */
export function sourceRegistrationRows(items:SourceInboxItem[]){
 // A URL identifies an offer, not a capture version. A new capture must remain
 // visible even when an older version has already become a working product.
 // Only the explicit, recoverable archive action removes a capture row.
 return items.filter(item=>!item.archivedAt).map(item=>({
  id:`source:${item.id}`,source_capture:item,title:item.reviewed?.title??item.snapshot.title,
  source_url:item.snapshot.sourceUrl,created_at:item.receivedAt,image_keys:'[]',
  options_count:(item.reviewed??item.snapshot).options.length,registration_status:'카테고리 대기',
  seo_status:'대기',quote_status:'대기',supply_price:null,sale_price:null,
 }));
}
export type SourceRegistration=ReturnType<typeof sourceRegistrationRows>[number];
