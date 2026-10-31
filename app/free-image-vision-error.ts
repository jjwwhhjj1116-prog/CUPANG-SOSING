import {validateFreeImageSource,type FreeImageSource} from '@/app/free-image-translation';
import {IMAGE_TEXT_INSPECTION_POLICY,parseImageTextVisionConfiguration,type ImageTextVisionConfiguration} from '@/app/image-text-vision';

export type FreeImageVisionAttempt={requestId:string;source:FreeImageSource;sourceLanguage:'zh'|'en';configuration:ImageTextVisionConfiguration;inspectionPolicy?:typeof IMAGE_TEXT_INSPECTION_POLICY};
const freeze=<T,>(value:T):T=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
/** An uncertain inference is not an uncertain PNG upload. Its original
 * identity must survive cancellation without authorizing another AI call. */
export class FreeImageVisionError extends Error{
 readonly attempt:FreeImageVisionAttempt;
 constructor(message:string,public readonly code:string,public readonly uncertain:boolean,attempt:FreeImageVisionAttempt){
  super(message);this.name='FreeImageVisionError';
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(attempt.requestId)
    ||!/^IMAGE_VISION_[A-Z_]{1,64}$/.test(code)||!['zh','en'].includes(attempt.sourceLanguage)||!parseImageTextVisionConfiguration(attempt.configuration)
    ||attempt.inspectionPolicy!==undefined&&attempt.inspectionPolicy!==IMAGE_TEXT_INSPECTION_POLICY)throw Error('원래 이미지 Vision 요청을 확인하지 못했습니다.');
  validateFreeImageSource(attempt.source);this.attempt=freeze(structuredClone(attempt));
 }
}
