/** Shared public contract. Provider output never carries URLs or storage keys. */
export const IMAGE_TEXT_VISION_MODEL='@cf/qwen/qwen3.8-27b';
export const IMAGE_TEXT_INSPECTION_POLICY='foreign-text-inspection-v1';
export const IMAGE_TEXT_PRESERVATION_POLICY='product-text-preservation-v2';
export type ImageTextInspectionPolicy=typeof IMAGE_TEXT_INSPECTION_POLICY|typeof IMAGE_TEXT_PRESERVATION_POLICY;
export const isImageTextInspectionPolicy=(value:unknown):value is ImageTextInspectionPolicy=>value===IMAGE_TEXT_INSPECTION_POLICY||value===IMAGE_TEXT_PRESERVATION_POLICY;
export type ImageTextInspection={policy:ImageTextInspectionPolicy;decision:'no-foreign-text'|'foreign-text'|'unreadable'|'product-markings-only'};
export const IMAGE_TEXT_VISION_NOTICE='선택한 본인 소유 원본 이미지 한 장을 Cloudflare Workers AI Qwen3.8 Vision에 보내 문구와 한국어 번역을 읽습니다. Cloudflare 무료 사용량을 넘으면 사용료가 발생할 수 있습니다. 이미지 생성은 하지 않으며, 실패 후 자동 재요청하지 않습니다. 적용 전 문구와 영역을 확인해주세요.';
export type ImageTextVisionConfiguration={provider:'workers-ai-vision';model:typeof IMAGE_TEXT_VISION_MODEL;configured:boolean;paidAllowed:boolean;notice:typeof IMAGE_TEXT_VISION_NOTICE};
export type ImageTextVisionBlock={id:string;text:string;translated:string|null;issue:string|null;kind?:'overlay'|'product-marking'|'uncertain';box:{x:number;y:number;width:number;height:number}};
export type ImageTextVisionResult={provider:'workers-ai-vision';model:typeof IMAGE_TEXT_VISION_MODEL;requests:1;blocks:ImageTextVisionBlock[];notice:typeof IMAGE_TEXT_VISION_NOTICE;inspection?:ImageTextInspection};
export type ImageTextVisionFailure='BLOCKS'|'BLOCK_SHAPE'|'TEXT'|'BOX_SHAPE'|'COORDINATES'|'OVERLAP'|'TEXT_LIMIT'|'DECISION';
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string)=>Object.keys(value).sort().join(',')===keys;
export function parseImageTextVisionConfiguration(value:unknown):ImageTextVisionConfiguration|null{
 if(!object(value)||!exact(value,'configured,model,notice,paidAllowed,provider')||value.provider!=='workers-ai-vision'||value.model!==IMAGE_TEXT_VISION_MODEL
  ||typeof value.configured!=='boolean'||typeof value.paidAllowed!=='boolean'||value.configured&&!value.paidAllowed||value.notice!==IMAGE_TEXT_VISION_NOTICE)return null;
 return{provider:value.provider,model:value.model,configured:value.configured,paidAllowed:value.paidAllowed,notice:IMAGE_TEXT_VISION_NOTICE};
}
export function parseImageTextVisionResult(value:unknown,width:number,height:number,onInvalid?:(reason:ImageTextVisionFailure)=>void):ImageTextVisionResult|null{
 const fail=(reason:ImageTextVisionFailure):null=>{onInvalid?.(reason);return null;};
 if(!object(value)||!['blocks,model,notice,provider,requests','blocks,inspection,model,notice,provider,requests'].includes(Object.keys(value).sort().join(','))||value.provider!=='workers-ai-vision'||value.model!==IMAGE_TEXT_VISION_MODEL||value.requests!==1
  ||value.notice!==IMAGE_TEXT_VISION_NOTICE||!Array.isArray(value.blocks)||value.blocks.length>30)return fail('BLOCKS');
 const preservation=(value.inspection as ImageTextInspection|undefined)?.policy===IMAGE_TEXT_PRESERVATION_POLICY;
 let total=0;const seen=new Set<string>(),blocks:ImageTextVisionBlock[]=[];
 for(const [index,raw]of value.blocks.entries()){
  if(!object(raw)||!exact(raw,preservation?'box,id,issue,kind,text,translated':'box,id,issue,text,translated')||raw.id!==`vision-${index+1}`
   ||preservation&&!['overlay','product-marking','uncertain'].includes(String(raw.kind)))return fail('BLOCK_SHAPE');
  const retained=preservation&&raw.kind!=='overlay';
  if(typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>500
   ||/[\p{C}<>`]|https?:|data:|javascript:/iu.test(raw.text)||typeof raw.translated!=='string'&&raw.translated!==null||typeof raw.issue!=='string'&&raw.issue!==null
   ||raw.translated!==null&&(!raw.translated.trim()||raw.translated.length>1000||!/[가-힣]/u.test(raw.translated)||/\p{Script=Han}|[\p{C}<>`]/u.test(raw.translated))
   ||raw.issue!==null&&raw.issue!=='번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요.'||!retained&&raw.translated===null&&raw.issue===null||raw.translated!==null&&raw.issue!==null
   ||retained&&(raw.translated!==null||raw.issue!==null))return fail('TEXT');
  if(!object(raw.box)||!exact(raw.box,'height,width,x,y'))return fail('BOX_SHAPE');
  const box=raw.box as ImageTextVisionBlock['box'];
  if(!Object.values(box).every(Number.isSafeInteger)||box.x<0||box.y<0||box.width<1||box.height<1||box.x+box.width>width||box.y+box.height>height)return fail('COORDINATES');
  if(blocks.some(row=>{const overlap=Math.max(0,Math.min(box.x+box.width,row.box.x+row.box.width)-Math.max(box.x,row.box.x))*Math.max(0,Math.min(box.y+box.height,row.box.y+row.box.height)-Math.max(box.y,row.box.y));return overlap>Math.min(box.width*box.height,row.box.width*row.box.height)*0.5;}))return fail('OVERLAP');
  const identity=JSON.stringify([box,raw.text]);if(seen.has(identity))return fail('BLOCKS');seen.add(identity);total+=raw.text.length;if(total>5000)return fail('TEXT_LIMIT');
  blocks.push({id:raw.id,text:raw.text,translated:raw.translated,issue:raw.issue,box:{...box},...(preservation?{kind:raw.kind as ImageTextVisionBlock['kind']}:{})});
 }
 let inspection:ImageTextInspection|undefined;
 if(value.inspection!==undefined){const check=value.inspection;if(!object(check)||!exact(check,'decision,policy')||!isImageTextInspectionPolicy(check.policy)
  ||!['no-foreign-text','foreign-text','unreadable',...(preservation?['product-markings-only']:[])].includes(String(check.decision))||check.decision==='no-foreign-text'&&blocks.length!==0||check.decision==='foreign-text'&&!blocks.length
  ||preservation&&(check.decision==='product-markings-only'&&(!blocks.length||blocks.some(row=>row.kind!=='product-marking'))
   ||check.decision==='foreign-text'&&(!blocks.some(row=>row.kind==='overlay')||blocks.some(row=>row.kind==='uncertain'))||blocks.some(row=>row.kind==='uncertain')&&check.decision!=='unreadable'))return fail('DECISION');
  inspection={policy:check.policy,decision:check.decision as ImageTextInspection['decision']};}
 return{provider:'workers-ai-vision',model:IMAGE_TEXT_VISION_MODEL,requests:1,blocks,notice:IMAGE_TEXT_VISION_NOTICE,...(inspection?{inspection}:{})};
}
export function isVerifiedNoForeignText(result:ImageTextVisionResult|undefined):boolean{return !!result?.inspection&&isImageTextInspectionPolicy(result.inspection.policy)&&result.inspection.decision==='no-foreign-text'&&result.blocks.length===0;}
export function isVerifiedProductMarkingsOnly(result:ImageTextVisionResult|undefined):boolean{return result?.inspection?.policy===IMAGE_TEXT_PRESERVATION_POLICY&&result.inspection.decision==='product-markings-only'&&result.blocks.length>0&&result.blocks.every(row=>row.kind==='product-marking');}
export function isVerifiedOriginalPreservation(result:ImageTextVisionResult|undefined):boolean{return isVerifiedNoForeignText(result)||isVerifiedProductMarkingsOnly(result);}
