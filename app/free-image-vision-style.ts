import {resolveFreeImageTextStyle} from '@/app/free-image-text-style';
import type {ImageTextVisionBlock} from '@/app/image-text-vision';
import type {FreeImageRegion} from '@/app/free-image-translation-client';

export type VisionStyleIssue='VISION_REGION_OVERLAP'|'VISION_BACKGROUND_COMPLEX'|'VISION_BACKGROUND_UNAVAILABLE'|'VISION_TEXT_FIT';
const messages:Record<VisionStyleIssue,string>={
 VISION_REGION_OVERLAP:'Vision 영역이 서로 겹칩니다. 원문과 번역을 보존했으며 영역을 직접 조정한 뒤 선택해주세요.',
 VISION_BACKGROUND_COMPLEX:'주변 배경색이 일정하지 않아 단색 채움이 어울리지 않을 수 있습니다. 배경색과 영역을 직접 확인한 뒤 선택해주세요.',
 VISION_BACKGROUND_UNAVAILABLE:'주변 배경색을 확인하지 못했습니다. 원본을 보며 색상과 영역을 직접 설정한 뒤 선택해주세요.',
 VISION_TEXT_FIT:'한국어를 읽을 수 있는 크기로 넣기 어렵습니다. 문구와 영역을 직접 조정한 뒤 선택해주세요.',
};
type PixelContext=Pick<CanvasRenderingContext2D,'getImageData'|'measureText'|'font'>;
type Box=ImageTextVisionBlock['box'];
const inside=(x:number,y:number,box:Box)=>x>=box.x&&x<box.x+box.width&&y>=box.y&&y<box.y+box.height;
const overlaps=(a:Box,b:Box)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const hex=(rgb:number[])=>'#'+rgb.map(value=>value.toString(16).padStart(2,'0')).join('');
function backdrop(context:PixelContext|undefined,box:Box,all:readonly ImageTextVisionBlock[],width:number,height:number):{background:string;foreground:string;issue?:VisionStyleIssue}{
 const unavailable={background:'#ffffff',foreground:'#111111',issue:'VISION_BACKGROUND_UNAVAILABLE' as const};
 if(!context?.getImageData)return unavailable;
 const gap=Math.max(2,Math.min(6,Math.round(Math.min(box.width,box.height)*0.08))),points=new Map<string,{x:number;y:number}>();
 const add=(x:number,y:number)=>{if(x>=0&&y>=0&&x<width&&y<height&&!all.some(row=>inside(x,y,row.box)))points.set(`${x},${y}`,{x,y});};
 for(let i=0;i<16;i++){
  const x=box.x+Math.round((box.width-1)*i/15),y=box.y+Math.round((box.height-1)*i/15);
  add(x,box.y-gap);add(x,box.y+box.height+gap-1);add(box.x-gap,y);add(box.x+box.width+gap-1,y);
 }
 const sample=[...points.values()];if(sample.length<12)return unavailable;
 const left=Math.min(...sample.map(point=>point.x)),top=Math.min(...sample.map(point=>point.y)),w=Math.max(...sample.map(point=>point.x))-left+1,h=Math.max(...sample.map(point=>point.y))-top+1;
 let pixels:Uint8ClampedArray;try{pixels=context.getImageData(left,top,w,h).data;}catch{return unavailable;}
 if(pixels.length!==w*h*4)return unavailable;
 const colors=sample.flatMap(point=>{const index=((point.y-top)*w+point.x-left)*4;return pixels[index+3]>=250?[[pixels[index],pixels[index+1],pixels[index+2]]]:[];});
 if(colors.length<12||colors.length<sample.length*0.75)return unavailable;
 const rgb=[0,1,2].map(channel=>median(colors.map(value=>value[channel]))),consistent=colors.filter(value=>value.every((channel,index)=>Math.abs(channel-rgb[index])<=32)).length/colors.length;
 const luminance=rgb.map(value=>{const s=value/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
 return{background:hex(rgb),foreground:luminance>0.179?'#111111':'#ffffff',...(consistent<0.75?{issue:'VISION_BACKGROUND_COMPLEX' as const}:{})};
}
function fittedFont(context:PixelContext|undefined,text:string,box:Box):{fontSize:number;issue?:VisionStyleIssue}{
 const padding=Math.min(3,Math.floor(Math.min(box.width,box.height)/10)),width=Math.max(1,box.width-padding*2),height=Math.max(1,box.height-padding*2),style=resolveFreeImageTextStyle({textAlign:'center'});
 let size=Math.min(200,Math.floor(height/style.lineHeight));
 if(!context?.measureText)return{fontSize:Math.max(1,size),issue:'VISION_TEXT_FIT'};
 const previous=context.font;
 try{
  for(;size>=1;size--){context.font=`${size}px ${style.fontFamily}`;const measured=context.measureText(text).width;if(Number.isFinite(measured)&&measured<=width)break;}
 }catch{return{fontSize:1,issue:'VISION_TEXT_FIT'};}finally{context.font=previous;}
 return{fontSize:Math.max(1,size),...(size<8?{issue:'VISION_TEXT_FIT' as const}:{})};
}
/** Initial styles for newly received Vision blocks only. Existing regions and
 * saved documents never enter this function. A sampled flat fill is not image
 * reconstruction; uncertain geometry/background stays available for review. */
export function initializeVisionRegions(blocks:readonly ImageTextVisionBlock[],canvas:Pick<HTMLCanvasElement,'getContext'>,width:number,height:number):{regions:FreeImageRegion[];issues:VisionStyleIssue[]}{
 let context:PixelContext|undefined;try{context=canvas.getContext('2d')??undefined;}catch{/* Keep all blocks available for manual correction. */}
 const issues=new Set<VisionStyleIssue>();
 const regions=blocks.map((row,index):FreeImageRegion=>{
  const background=backdrop(context,row.box,blocks,width,height),fit=fittedFont(context,row.translated??row.text,row.box);
  const rowIssues:VisionStyleIssue[]=[];
  if(blocks.some((other,otherIndex)=>otherIndex!==index&&overlaps(row.box,other.box)))rowIssues.push('VISION_REGION_OVERLAP');
  if(background.issue)rowIssues.push(background.issue);if(fit.issue)rowIssues.push(fit.issue);rowIssues.forEach(issue=>issues.add(issue));
  return{id:row.id,text:row.text,box:{...row.box},confidence:0,selected:rowIssues.length===0,translated:row.translated??'',
   issue:[row.issue,...rowIssues.map(issue=>`${issue}: ${messages[issue]}`)].filter(Boolean).join(' ')||null,
   translationProvenance:row.translated===null?'empty':'generated',background:background.background,foreground:background.foreground,fontSize:fit.fontSize,textAlign:'center'};
 });
 return{regions,issues:[...issues]};
}
