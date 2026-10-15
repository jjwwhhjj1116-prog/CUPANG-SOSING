import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import sharp from 'sharp';
import { createRequire } from 'node:module';
import { downloadFixture, json } from './image-download-ui.mjs';
const native = createRequire(import.meta.url);
export async function makeCompositeFixture(company, { count = 32, manualHtml } = {}) {
 const f=await downloadFixture(company);
 try {
  const selectedKeys=[],colors=[];
  for(let index=0;index<count;index++){
   const key=`owner/composite-source-${index}.png`,color={r:(index*61+40)%256,g:(index*93+80)%256,b:(index*37+120)%256,alpha:1};
   const bytes=await sharp({create:{width:800,height:1,channels:4,background:color}}).png().toBuffer();
   await f.api.bindings.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'}});selectedKeys.push(key);colors.push(color);
  }
  f.api.sqlite.prepare('UPDATE products SET image_keys=?').run(JSON.stringify([...f.keys,...selectedKeys]));
  const content=(await json(await f.api.route(f.base+'/content'))).content;
  await json(await f.api.route(f.base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{detailTop:[selectedKeys[0]],detail:selectedKeys.slice(1,-1),detailBottom:[selectedKeys.at(-1)]}}}}));
  let view=await json(await f.api.route(f.base+'/quotation-fields')),optionId=view.resolved.rows.find(row=>row.optionId).optionId;
  const changes=view.resolved.rows.filter(row=>row.optionId&&row.optionId!==optionId).flatMap(row=>[{optionId:row.optionId,fieldKey:'detailImages',value:f.keys[5]},{optionId:row.optionId,fieldKey:'detailHtml',value:'<p>다른 옵션의 직접 HTML</p>'}]);
  if(manualHtml!==undefined)changes.push({optionId,fieldKey:'detailHtml',value:manualHtml});
  view=await json(await f.api.route(f.base+'/quotation-fields',{method:'PUT',body:{expectedRevision:view.revision,expectedInputFingerprint:view.inputFingerprint,changes}}));
  view=await json(await f.api.route(f.base+'/quotation-fields?profileId='+encodeURIComponent(view.categoryContext.profileId)));
  const get=f.api.bindings.FILES.get;f.api.bindings.FILES.get=async(key,options)=>{const object=await get(key);if(!object)return null;const data=f.api.objects.get(key),bytes=options?.range?data.slice(options.range.offset,options.range.offset+options.range.length):data.slice();return {...object,body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};};
  const calls=[],request=async(url,init={})=>{calls.push({url,init});if(url==='/api/files')return f.api.load('app/api/files/route.ts')[init.method??'GET'](new Request('https://app.test'+url,{...init}));return f.request(url,init);};
  return {...f,view,optionId,selectedKeys,colors,request,calls};
 }catch(error){f.api.close();throw error;}
}
/** The production browser code calls Image and Canvas normally. This local
 * adapter decodes real images, encodes PNG/JPEG and paints each drawImage with
 * libvips, so API/ZIP tests examine pixels rather than a fake PNG header. A
 * separate same-browser QA exercises native Canvas with these RGB fixtures. */
export function loadComposite(f, extra={}) {
 const modules=new Map(),blobs=new Map(),draws=[],decoded=[],encodes=[];
 class LocalURL extends URL{static createObjectURL(blob){const key='blob:composite-'+blobs.size;blobs.set(key,blob);return key;}static revokeObjectURL(key){blobs.delete(key);}}
 class FixtureImage{naturalWidth=0;naturalHeight=0;onload=null;onerror=null;bytes=null;set src(value){if(!value)return;decoded.push(value);void(async()=>{try{this.bytes=Buffer.from(await blobs.get(value).arrayBuffer());const image=await sharp(this.bytes).metadata();this.naturalWidth=image.width;this.naturalHeight=image.height;this.onload?.();}catch(error){this.onerror?.(error);}})();}}
 const document={createElement(name){if(name!=='canvas')throw Error(name);const layers=[];return{width:0,height:0,getContext(){return{fillStyle:'',fillRect(){},drawImage(image,x,y,width,height){draws.push({x,y,width,height});layers.push({bytes:image.bytes,x,y,width,height});}};},toBlob(callback,type='image/png',quality){const width=this.width,height=this.height;encodes.push({type,quality,width,height});void(async()=>{try{const overlays=[];for(const layer of layers)overlays.push({input:await sharp(layer.bytes).resize(layer.width,layer.height,{fit:'fill'}).png().toBuffer(),left:layer.x,top:layer.y});const canvas=sharp({create:{width,height,channels:4,background:'#ffffff'}}).composite(overlays);const buffer=await(type==='image/jpeg'?canvas.flatten({background:'#ffffff'}).jpeg({quality:Math.round((quality??0.92)*100)}):canvas.png()).toBuffer();callback(new Blob([buffer],{type}));}catch{callback(null);}})();}};}};
 function load(file){if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL:LocalURL,URLSearchParams,Image:FixtureImage,document:extra.document??document,AbortController,AbortSignal,DOMException,Blob,File,FormData,Headers,Response,TextEncoder,TextDecoder,Uint8Array,DataView,crypto,structuredClone,setTimeout,clearTimeout,fetch:f.request,require(name){if(extra.modules?.[name])return extra.modules[name];if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return name.startsWith('@/')?load(name.slice(2)+(name.includes('/components/')?'.tsx':'.ts')):native(name);}});return exports;}
 return {load,draws,decoded,encodes,blobs,document:extra.document??document,helper:load('app/detail-image-composite.ts')};
}
