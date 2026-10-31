import {IMAGE_TEXT_INSPECTION_POLICY,IMAGE_TEXT_VISION_MODEL,parseImageTextVisionConfiguration,type ImageTextVisionConfiguration} from '@/app/image-text-vision';
export type ImageNoTextProof={policy:typeof IMAGE_TEXT_INSPECTION_POLICY;productId:string;sourceKey:string;sourceSha256:string;width:number;height:number;
 requestId:string;verifiedAt:string;sourceLanguage:'zh'|'en';configuration:ImageTextVisionConfiguration};
/** Only a server receipt can supply this object. A caller's empty OCR list is
 * never converted into a no-op decision. Source GET additionally checks bytes. */
export function parseImageNoTextProof(value:unknown):ImageNoTextProof|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;const row=value as Record<string,unknown>;
 if(Object.keys(row).sort().join(',')!=='configuration,height,policy,productId,requestId,sourceKey,sourceLanguage,sourceSha256,verifiedAt,width'
  ||row.policy!==IMAGE_TEXT_INSPECTION_POLICY||typeof row.productId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(row.productId)
  ||typeof row.sourceKey!=='string'||row.sourceKey.length>512||typeof row.sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sourceSha256)
  ||typeof row.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.requestId)
  ||typeof row.verifiedAt!=='string'||!Number.isFinite(Date.parse(row.verifiedAt))||!['zh','en'].includes(String(row.sourceLanguage))||!Number.isSafeInteger(row.width)||!Number.isSafeInteger(row.height)||(row.width as number)<1||(row.height as number)<1
  ||(row.width as number)*(row.height as number)>12000000)return null;
 const configuration=parseImageTextVisionConfiguration(row.configuration);if(!configuration?.configured||configuration.model!==IMAGE_TEXT_VISION_MODEL)return null;
 return {...row,configuration} as ImageNoTextProof;
}
