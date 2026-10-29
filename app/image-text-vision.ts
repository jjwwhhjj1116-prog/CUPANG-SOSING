/** Shared public contract. Provider output never carries URLs or storage keys. */
export const IMAGE_TEXT_VISION_MODEL='@cf/qwen/qwen3.8-27b';
export const IMAGE_TEXT_VISION_NOTICE='선택한 본인 소유 원본 이미지 한 장을 Cloudflare Workers AI Qwen3.8 Vision에 보내 문구와 한국어 번역을 읽습니다. Cloudflare 무료 사용량을 넘으면 사용료가 발생할 수 있습니다. 이미지 생성은 하지 않으며, 실패 후 자동 재요청하지 않습니다. 적용 전 문구와 영역을 확인해주세요.';
export type ImageTextVisionConfiguration={provider:'workers-ai-vision';model:typeof IMAGE_TEXT_VISION_MODEL;configured:boolean;paidAllowed:boolean;notice:typeof IMAGE_TEXT_VISION_NOTICE};
export type ImageTextVisionBlock={id:string;text:string;translated:string|null;issue:string|null;box:{x:number;y:number;width:number;height:number}};
export type ImageTextVisionResult={provider:'workers-ai-vision';model:typeof IMAGE_TEXT_VISION_MODEL;requests:1;blocks:ImageTextVisionBlock[];notice:typeof IMAGE_TEXT_VISION_NOTICE};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string)=>Object.keys(value).sort().join(',')===keys;
export function parseImageTextVisionConfiguration(value:unknown):ImageTextVisionConfiguration|null{
 if(!object(value)||!exact(value,'configured,model,notice,paidAllowed,provider')||value.provider!=='workers-ai-vision'||value.model!==IMAGE_TEXT_VISION_MODEL
  ||typeof value.configured!=='boolean'||typeof value.paidAllowed!=='boolean'||value.configured&&!value.paidAllowed||value.notice!==IMAGE_TEXT_VISION_NOTICE)return null;
 return{provider:value.provider,model:value.model,configured:value.configured,paidAllowed:value.paidAllowed,notice:IMAGE_TEXT_VISION_NOTICE};
}
export function parseImageTextVisionResult(value:unknown,width:number,height:number):ImageTextVisionResult|null{
 if(!object(value)||!exact(value,'blocks,model,notice,provider,requests')||value.provider!=='workers-ai-vision'||value.model!==IMAGE_TEXT_VISION_MODEL||value.requests!==1
  ||value.notice!==IMAGE_TEXT_VISION_NOTICE||!Array.isArray(value.blocks)||value.blocks.length>30)return null;
 let total=0;const seen=new Set<string>(),blocks:ImageTextVisionBlock[]=[];
 for(const [index,raw]of value.blocks.entries()){
  if(!object(raw)||!exact(raw,'box,id,issue,text,translated')||raw.id!==`vision-${index+1}`||typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>500
   ||/[\p{C}<>`]|https?:|data:|javascript:/iu.test(raw.text)||typeof raw.translated!=='string'&&raw.translated!==null||typeof raw.issue!=='string'&&raw.issue!==null
   ||raw.translated!==null&&(!raw.translated.trim()||raw.translated.length>1000||!/[가-힣]/u.test(raw.translated)||/\p{Script=Han}|[\p{C}<>`]/u.test(raw.translated))
   ||raw.issue!==null&&raw.issue!=='번역 검증을 통과하지 못했습니다. 원문과 영역을 확인해주세요.'||raw.translated===null&&raw.issue===null||raw.translated!==null&&raw.issue!==null
   ||!object(raw.box)||!exact(raw.box,'height,width,x,y'))return null;
  const box=raw.box as ImageTextVisionBlock['box'];
  if(!Object.values(box).every(Number.isSafeInteger)||box.x<0||box.y<0||box.width<1||box.height<1||box.x+box.width>width||box.y+box.height>height)return null;
  if(blocks.some(row=>{const overlap=Math.max(0,Math.min(box.x+box.width,row.box.x+row.box.width)-Math.max(box.x,row.box.x))*Math.max(0,Math.min(box.y+box.height,row.box.y+row.box.height)-Math.max(box.y,row.box.y));return overlap>Math.min(box.width*box.height,row.box.width*row.box.height)*0.5;}))return null;
  const identity=JSON.stringify([box,raw.text]);if(seen.has(identity))return null;seen.add(identity);total+=raw.text.length;if(total>5000)return null;
  blocks.push({id:raw.id,text:raw.text,translated:raw.translated,issue:raw.issue,box:{...box}});
 }
 return{provider:'workers-ai-vision',model:IMAGE_TEXT_VISION_MODEL,requests:1,blocks,notice:IMAGE_TEXT_VISION_NOTICE};
}
