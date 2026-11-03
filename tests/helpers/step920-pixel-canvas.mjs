import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';

/** Local browser boundary only: sharp PNG decoding/encoding, basic unrotated
 * Canvas pixel operations, and the shipped OpenCV algorithm behind a Worker.
 * Production recognition/style/render/apply clients are loaded unchanged. */
export async function step920PixelCanvas(images,onBoundary){
 const cv=await(await import('@techstark/opencv-js')).default,raw=new Map(),cache=new Map(),box={x:20,y:20,width:60,height:24};
 const remember=async bytes=>{const{data,info}=await sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true});raw.set(Buffer.from(bytes).toString('base64'),{pixels:new Uint8ClampedArray(data),width:info.width,height:info.height});};
 await Promise.all(images.map(remember));
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,Error,Uint8ClampedArray,AbortController,AbortSignal,setTimeout,clearTimeout,Worker:class{
    postMessage(input){onBoundary({type:'synthetic-worker',engine:'actual @techstark/opencv-js',width:input.width,height:input.height});queueMicrotask(()=>{if(this.closed)return;try{const data=load('app/free-image-inpaint.ts').inpaintFreeImagePixels(cv,input);this.onmessage?.({data:{id:input.id,width:input.width,height:input.height,data}});}catch(error){this.onerror?.(error);}});}
    terminate(){this.closed=true;}
   },require:name=>{assert.equal(name,'@/app/free-image-inpaint');return load('app/free-image-inpaint.ts');}},{filename:file});return exports;
 }
 const document={fonts:{load:async()=>[],ready:Promise.resolve()},createElement(tag){
  assert.equal(tag,'canvas');const canvas={width:0,height:0,pixels:null},texts=[];
  const pixels=()=>{if(canvas.pixels?.length!==canvas.width*canvas.height*4)canvas.pixels=new Uint8ClampedArray(canvas.width*canvas.height*4);return canvas.pixels;};
  const context={font:'24px sans-serif',fillStyle:'#ffffff',save(){},restore(){},beginPath(){},rect(){},clip(){},strokeRect(){},
   measureText(text){return{width:Array.from(text).length*(Number(/([0-9.]+)px/u.exec(this.font)?.[1])||24)*.65};},
   drawImage(image,...args){const input=image.pixels?{pixels:image.pixels,width:image.width,height:image.height}:raw.get(Buffer.from(image.bytes).toString('base64'));assert.ok(input,'Only fixture sources and actually encoded canvas outputs may be drawn');
    let sx=0,sy=0,sw=input.width,sh=input.height,x,y,width,height;
    if(args.length===2){[x,y]=args;width=sw;height=sh;}else if(args.length===4){[x,y,width,height]=args;}else{assert.equal(args.length,8);[sx,sy,sw,sh,x,y,width,height]=args;}
    const target=pixels();for(let py=0;py<height;py++)for(let px=0;px<width;px++){const tx=x+px,ty=y+py;if(tx<0||ty<0||tx>=canvas.width||ty>=canvas.height)continue;const i=(Math.min(input.height-1,sy+Math.floor(py*sh/height))*input.width+Math.min(input.width-1,sx+Math.floor(px*sw/width)))*4;target.set(input.pixels.subarray(i,i+4),(ty*canvas.width+tx)*4);}
   },
   getImageData(x,y,width,height){const data=new Uint8ClampedArray(width*height*4),source=pixels();for(let py=0;py<height;py++)for(let px=0;px<width;px++){const i=((y+py)*canvas.width+x+px)*4;data.set(source.subarray(i,i+4),(py*width+px)*4);}return{data,width,height};},
   putImageData(image,x,y,dirtyX,dirtyY,width,height){const target=pixels();for(let py=dirtyY;py<dirtyY+height;py++)for(let px=dirtyX;px<dirtyX+width;px++)target.set(image.data.subarray((py*image.width+px)*4,(py*image.width+px)*4+4),((y+py)*canvas.width+x+px)*4);},
   fillRect(x,y,width,height){const color=this.fillStyle==='#fff'||this.fillStyle==='white'?[255,255,255]:[1,3,5].map(i=>parseInt(this.fillStyle.slice(i,i+2),16));const target=pixels();for(let py=y;py<y+height;py++)for(let px=x;px<x+width;px++)target.set([...color,255],(py*canvas.width+px)*4);},
   fillText(text,x,y){texts.push({text,x,y,font:this.font,color:this.fillStyle});}
  };
  canvas.getContext=()=>context;canvas.toBlob=(callback,type='image/png',quality)=>{onBoundary({type:'synthetic-canvas',textRows:texts.length,pixels:'sharp PNG; unrotated Canvas boundary'});void(async()=>{
   try{let image=sharp(pixels(),{raw:{width:canvas.width,height:canvas.height,channels:4}});
    if(texts.length){const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}">${texts.map(row=>`<text x="${row.x}" y="${row.y+24}" font-size="24" font-family="Malgun Gothic,sans-serif" fill="${escape(row.color)}">${escape(row.text)}</text>`).join('')}</svg>`;image=image.composite([{input:Buffer.from(svg)}]);}
    const bytes=await(type==='image/jpeg'?image.flatten({background:'#ffffff'}).jpeg({quality:Math.round((quality??.92)*100)}):image.png()).toBuffer();await remember(bytes);callback(new Blob([bytes],{type}));
   }catch(error){onBoundary({type:'synthetic-canvas-error',message:error.message});callback(null);}
  })();};return canvas;
 }};
 return{document,box,inpaintClient:load('app/free-image-inpaint-client.ts')};
}
