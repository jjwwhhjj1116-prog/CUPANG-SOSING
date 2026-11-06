import type {ImageTextVisionBlock} from '@/app/image-text-vision';
import {MAX_FREE_IMAGE_INPAINT_ROI_PIXELS,MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS} from '@/app/free-image-inpaint';

type Box=ImageTextVisionBlock['box'];
type Pixels=Pick<CanvasRenderingContext2D,'getImageData'>;
const inside=(x:number,y:number,b:Box)=>x>=b.x&&y>=b.y&&x<b.x+b.width&&y<b.y+b.height;
const overlap=(a:Box,b:Box)=>a.x<b.x+b.width&&b.x<a.x+a.width&&a.y<b.y+b.height&&b.y<a.y+a.height;
const median=(values:number[])=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];

/** A new overlay may have a glyph crossing its OCR edge. Never pad every mask:
 * only follow ink connected to the original box, inside a confirmed flat panel.
 * This is initialization geometry, not a renderer or stored-document policy. */
export function refineFlatOverlayBounds(blocks:readonly ImageTextVisionBlock[],context:Pixels|undefined,width:number,height:number):Box[]{
 let readPixels=0;
 return blocks.map(row=>{
  const original={...row.box};
  if(!context||row.kind!=='overlay'||row.issue!==null||!row.translated||!row.text
   ||![width,height,original.x,original.y,original.width,original.height].every(Number.isSafeInteger)
   ||original.width<1||original.height<1||original.x<2||original.y<2||original.x+original.width>width-2||original.y+original.height>height-2)return original;
  const left=Math.max(0,original.x-12),top=Math.max(0,original.y-12),right=Math.min(width,original.x+original.width+12),bottom=Math.min(height,original.y+original.height+12);
  const w=right-left,h=bottom-top,count=w*h;
  if(count>MAX_FREE_IMAGE_INPAINT_ROI_PIXELS||readPixels+count>MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS)return original;
  readPixels+=count;
  let data:Uint8ClampedArray;try{data=context.getImageData(left,top,w,h).data;}catch{return original;}
  if(data.length!==count*4)return original;
  const channels:[number[],number[],number[]]=[[],[],[]];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=(y*w+x)*4;if(data[i+3]<250)return original;
   if(x<2||y<2||x>=w-2||y>=h-2)for(let c=0;c<3;c++)channels[c].push(data[i+c]);
  }
  const background=channels.map(median),flat=(i:number)=>[0,1,2].every(c=>Math.abs(data[i*4+c]-background[c])<=16);
  // A neighboring independent line can cross the exploratory ROI. The final
  // candidate still needs a fully flat two-pixel frame, not this majority vote.
  let perimeter=0,consistent=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(x<2||y<2||x>=w-2||y>=h-2){perimeter++;if(flat(y*w+x))consistent++;}
  if(consistent<perimeter*.85)return original;
  const ink=new Uint8Array(count),labels=new Uint8Array(count),stack=new Int32Array(count),component=new Int32Array(count);
  // Include antialiased strokes as seed-connected ink; the stricter outer
  // frame below must still prove the expanded rectangle ends on flat pixels.
  for(let i=0;i<count;i++)ink[i]=[0,1,2].some(c=>Math.abs(data[i*4+c]-background[c])>32)?1:0;
  let minX=original.x,minY=original.y,maxX=original.x+original.width-1,maxY=original.y+original.height-1,spilled=false;
  for(let first=0;first<count;first++){
   if(!ink[first]||labels[first])continue;
   let pending=1,size=0,seed=false,edge=false;stack[0]=first;labels[first]=1;
   let x1=right,y1=bottom,x2=left,y2=top;
   while(pending){
    const p=stack[--pending],x=p%w,y=Math.floor(p/w),sx=x+left,sy=y+top;component[size++]=p;
    seed ||=inside(sx,sy,original);edge ||=x===0||y===0||x===w-1||y===h-1;
    x1=Math.min(x1,sx);y1=Math.min(y1,sy);x2=Math.max(x2,sx);y2=Math.max(y2,sy);
    for(let yy=Math.max(0,y-1);yy<=Math.min(h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(w-1,x+1);xx++){
     const next=yy*w+xx;if(ink[next]&&!labels[next]){labels[next]=1;stack[pending++]=next;}
    }
   }
   if(!seed)continue;
   for(let i=0;i<size;i++)labels[component[i]]=2;
   if(x1<original.x||y1<original.y||x2>=original.x+original.width||y2>=original.y+original.height){
    if(edge)return original;
    spilled=true;minX=Math.min(minX,x1);minY=Math.min(minY,y1);maxX=Math.max(maxX,x2);maxY=Math.max(maxY,y2);
   }
  }
  if(!spilled)return original;
  // The one-pixel antialias halo is only on a side with proven connected ink.
  if(minX<original.x)minX--;if(minY<original.y)minY--;if(maxX>=original.x+original.width)maxX++;if(maxY>=original.y+original.height)maxY++;
  const candidate={x:minX,y:minY,width:maxX-minX+1,height:maxY-minY+1};
  if(minX<left+2||minY<top+2||maxX>=right-2||maxY>=bottom-2||blocks.some(other=>other!==row&&overlap(candidate,other.box)))return original;
  let inkCount=0;
  for(let y=minY-2;y<=maxY+2;y++)for(let x=minX-2;x<=maxX+2;x++){
   const i=(y-top)*w+x-left;
   if(!inside(x,y,candidate)){if(!flat(i))return original;continue;}
   if(ink[i]){
    inkCount++;
    if(!inside(x,y,original)&&labels[i]!==2)return original;
   }
  }
  return inkCount<=candidate.width*candidate.height*.35?candidate:original;
 });
}
