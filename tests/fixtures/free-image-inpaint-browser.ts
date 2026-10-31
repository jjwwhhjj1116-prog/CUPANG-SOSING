import {renderFreeImageTranslation,type FreeImageLoaded,type FreeImageRegion} from '../../app/free-image-translation-client';
const status=document.querySelector<HTMLElement>('#status')!,run=document.querySelector<HTMLButtonElement>('#run')!;
function canvas(id:string){const value=document.querySelector<HTMLCanvasElement>(id)!;value.width=320;value.height=160;return value;}
async function paint(blob:Blob,target:HTMLCanvasElement){const bitmap=await createImageBitmap(blob);try{target.getContext('2d')!.drawImage(bitmap,0,0);}finally{bitmap.close();}}
run.onclick=()=>{run.disabled=true;status.textContent='Running local production renderer + self-hosted Worker/WASM…';void(async()=>{
 const original=canvas('#original'),context=original.getContext('2d')!,translated=canvas('#translated'),erased=canvas('#erased');
 const gradient=context.createLinearGradient(0,0,320,160);gradient.addColorStop(0,'#8ab4d8');gradient.addColorStop(1,'#e6d9a8');context.fillStyle=gradient;context.fillRect(0,0,320,160);
 const box={x:90,y:50,width:140,height:50};context.font='bold 32px sans-serif';context.fillStyle='#111111';context.fillText('中文文字',95,87);
 const sourcePixels=context.getImageData(0,0,320,160).data.slice();
 const image:FreeImageLoaded={width:320,height:160,canvas:original,blob:new Blob(['synthetic']),source:{productId:'synthetic',productVersion:'2026-10-31T00:00:00.000Z',contentRevision:0,sourceKey:'fixture/original.png',sourceSha256:'a'.repeat(64),role:'detail',width:320,height:160}};
 const region:FreeImageRegion={id:'synthetic-text',text:'中文文字',box,confidence:100,selected:true,translated:'한국어 문구',issue:null,translationProvenance:'manual',background:'#ffffff',foreground:'#111111',fontSize:24,backgroundMode:'inpaint-telea-v1',textAlign:'center'};
 const controller=new AbortController();
 const erasure=await renderFreeImageTranslation(image,[{...region,erase:true,translated:''}],controller.signal);await paint(erasure.output,erased);
 const output=await renderFreeImageTranslation(image,[region],controller.signal);await paint(output.output,translated);
 const erasedPixels=erased.getContext('2d')!.getImageData(0,0,320,160).data,result=translated.getContext('2d')!.getImageData(0,0,320,160).data;
 let outsideChanges=0,sourceChanges=0,koreanChanges=0;const colors=new Set<string>(),current=context.getImageData(0,0,320,160).data;
 for(let y=0;y<160;y++)for(let x=0;x<320;x++){
  const i=(y*320+x)*4,inside=x>=box.x&&x<box.x+box.width&&y>=box.y&&y<box.y+box.height;
  if(inside){colors.add(Array.from(erasedPixels.subarray(i,i+3)).join(','));if(result.subarray(i,i+4).some((value,c)=>value!==erasedPixels[i+c]))koreanChanges++;}
  else if(result.subarray(i,i+4).some((value,c)=>value!==sourcePixels[i+c])||erasedPixels.subarray(i,i+4).some((value,c)=>value!==sourcePixels[i+c]))outsideChanges++;
  if(current.subarray(i,i+4).some((value,c)=>value!==sourcePixels[i+c]))sourceChanges++;
 }
 if(outsideChanges||sourceChanges||koreanChanges<20||colors.size<30)throw Error(JSON.stringify({outsideChanges,sourceChanges,koreanChanges,restoredColors:colors.size}));
 status.textContent='PASS '+JSON.stringify({outsideChanges,sourceChanges,koreanChanges,restoredColors:colors.size,worker:'/inpaint/5.0.0-release.1/inpaint-worker.js',runtimeExternalDownloads:false});
})().catch(error=>{status.textContent='FAIL '+String(error);}).finally(()=>{run.disabled=false;});};
