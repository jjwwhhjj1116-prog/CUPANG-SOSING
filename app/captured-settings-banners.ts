import {isOwnedImageKey} from '@/app/image-files';
import type {ProductContent} from '@/app/product-content';
import type {SupplierHubCompany} from '@/app/supplier-hub-company';

export type CapturedSettingsBanners={format:'yoofam-captured-settings-banners-v1';productId:string;contentRevision:number;items:{role:'detailTop'|'detailBottom';key:string}[]};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Source-key identity only: a later manual selection of the same key cannot
 * be distinguished. Missing or uncertain evidence never disables editing. */
export function capturedSettingsBanners(owner:string,product:{id:string;image_keys:string},content:ProductContent,source:{payload:string}|null,company:SupplierHubCompany|null):CapturedSettingsBanners|undefined{
  try{
    if(!source||!company||content.productId!==product.id||!Number.isSafeInteger(content.revision)||content.revision<1)return;
    const context:unknown=JSON.parse(source.payload),pool:unknown=JSON.parse(product.image_keys);
    if(!object(context)||!object(context.company)||context.company.code!==company.code||context.company.name!==company.name
      ||!object(context.settings)||!Array.isArray(pool)||pool.some(key=>typeof key!=='string'))return;
    const items:CapturedSettingsBanners['items']=[];
    for(const [role,enabled,key]of [['detailTop','topImageEnabled','topImageKey'],['detailBottom','bottomImageEnabled','bottomImageKey']]as const){
      const selected=context.settings[key],saved=content.assets[role]?.value;
      if(context.settings[enabled]===true&&typeof selected==='string'&&isOwnedImageKey(owner,selected)
        &&pool.includes(selected)&&Array.isArray(saved)&&saved.length===1&&saved[0]===selected)items.push({role,key:selected});
    }
    if(!items.length||new Set(items.map(item=>item.key)).size!==items.length)return;
    return {format:'yoofam-captured-settings-banners-v1',productId:product.id,contentRevision:content.revision,items};
  }catch{return;}
}
/** Validate optional API metadata against the exact saved content snapshot. */
export function parseCapturedSettingsBanners(value:unknown,content:ProductContent):CapturedSettingsBanners|undefined{
  if(!object(value)||value.format!=='yoofam-captured-settings-banners-v1'||value.productId!==content.productId||value.contentRevision!==content.revision
    ||!Array.isArray(value.items)||!value.items.length||value.items.length>2)return;
  const items:CapturedSettingsBanners['items']=[];
  for(const item of value.items){
    if(!object(item)||!['detailTop','detailBottom'].includes(String(item.role))||typeof item.key!=='string')return;
    const role=item.role as 'detailTop'|'detailBottom',saved=content.assets[role]?.value;
    if(!Array.isArray(saved)||saved.length!==1||saved[0]!==item.key||items.some(previous=>previous.role===role||previous.key===item.key))return;
    items.push({role,key:item.key});
  }
  return {format:'yoofam-captured-settings-banners-v1',productId:content.productId,contentRevision:content.revision,items};
}
export function capturedSettingsBannerKeys(descriptor:CapturedSettingsBanners|undefined,content:ProductContent,assets:ProductContent['assets']|Record<string,string[]>,imageKeys:readonly string[]):string[]{
  const verified=parseCapturedSettingsBanners(descriptor,content);if(!verified)return [];
  return verified.items.filter(({role,key})=>{const field=assets[role],values=Array.isArray(field)?field:field?.value;return Array.isArray(values)&&values.includes(key)&&imageKeys.includes(key);}).map(item=>item.key);
}
export function capturedSettingsBannerChangeAllowed(descriptor:CapturedSettingsBanners|undefined,content:ProductContent,before:Record<string,string[]>,next:Record<string,string[]>,imageKeys:readonly string[]):boolean{
  const protectedKeys=new Set(capturedSettingsBannerKeys(descriptor,content,before,imageKeys));
  return !descriptor?.items.some(({role,key})=>protectedKeys.has(key)&&JSON.stringify(before[role])!==JSON.stringify(next[role]));
}
