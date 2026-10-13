import {encodeManagedProductBarcode,type ManagedProductBarcodeView} from '@/app/managed-product-barcode';

export type ManagedBarcodeSettings={width:number;height:number;copies:number;gap:number;labelIndex:number|null};
export const managedBarcodeDefaults:ManagedBarcodeSettings={width:300,height:50,copies:1,gap:0,labelIndex:null};
export type ManagedBarcodeOutput={svg:string;width:number;height:number;copies:number;gap:number;title:string;barcode:string};
const escape=(text:string)=>text.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[value]!));
const integer=(value:number,min:number,max:number)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const printedFields=new Set(['제품명','수입원/판매원','제조원','제조국','내용량','원료명및성분명(재질)','상품유형','사용시주의사항','사용기준','custom']);
function lines(text:string,width:number){
 const limit=Math.max(1,Math.floor((width-24)/14)),result:string[]=[];
 for(const paragraph of text.split(/\r\n|\r|\n/u)){
  let line='',units=0;
  for(const character of paragraph){const next=character.codePointAt(0)!<128?0.6:1;if(units+next>limit&&line){result.push(line);line='';units=0;}line+=character;units+=next;}
  result.push(line);
 }
 return result;
}
/** A label contains only the selected saved values; it never creates a barcode,
 * certification mark, country of origin, or an unsaved product label. */
export function buildManagedBarcodeOutput(view:ManagedProductBarcodeView,settings:ManagedBarcodeSettings):ManagedBarcodeOutput{
 if(!integer(settings.width,100,1600)||!integer(settings.height,20,400)||!integer(settings.copies,1,100)||!integer(settings.gap,0,100)
  ||settings.labelIndex!==null&&(!integer(settings.labelIndex,0,view.labelInfo.length-1)))throw Error('바코드 크기·수량·표시사항 선택을 확인해주세요.');
 const code=encodeManagedProductBarcode(view.product.barcode);
 if(settings.width<code.viewBoxWidth)throw Error(`이 바코드를 선명하게 출력하려면 폭을 ${code.viewBoxWidth}px 이상으로 설정해주세요.`);
 const fields=settings.labelIndex===null?[]:Object.entries(view.labelInfo[settings.labelIndex].fields).filter(([key])=>printedFields.has(key));
 const textLines=[...lines(view.product.title,settings.width),`SKU ${view.skuId}`,view.product.barcode,...fields.flatMap(([key,value])=>lines(`${key==='custom'?'기타 표시사항':key}: ${String(value)}`,settings.width))];
 const height=settings.height+24+textLines.length*20;
 if(height>12000||textLines.length>500)throw Error('저장된 표시사항이 너무 길어 한 장에 출력할 수 없습니다. 바코드만 출력하거나 표시사항을 확인해주세요.');
 const scale=settings.width/code.viewBoxWidth;
 const bars=code.bars.map(bar=>`<rect x="${bar.x*scale}" y="10" width="${bar.width*scale}" height="${settings.height}" fill="#000"/>`).join('');
 const text=textLines.map((line,index)=>`<text x="12" y="${settings.height+30+index*20}" xml:space="preserve" font-family="Malgun Gothic,Arial,sans-serif" font-size="14" fill="#000">${escape(line)}</text>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width}" height="${height}" viewBox="0 0 ${settings.width} ${height}" role="img" aria-label="${escape(`SKU ${view.skuId} 바코드`)}"><rect width="100%" height="100%" fill="#fff"/>${bars}${text}</svg>`;
 return{svg,width:settings.width,height,copies:settings.copies,gap:settings.gap,title:view.product.title,barcode:view.product.barcode};
}
export async function downloadManagedBarcodePng(output:ManagedBarcodeOutput,filename:string,signal:AbortSignal){
 signal.throwIfAborted();
 const source=URL.createObjectURL(new Blob([output.svg],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const image=new Image();
  await new Promise<void>((resolve,reject)=>{const aborted=()=>{image.src='';reject(signal.reason??new DOMException('Aborted','AbortError'));},finish=(error?:Error)=>{signal.removeEventListener('abort',aborted);image.onload=null;image.onerror=null;if(error)reject(error);else resolve();};signal.addEventListener('abort',aborted,{once:true});image.onload=()=>finish();image.onerror=()=>finish(Error('바코드 이미지를 만들지 못했습니다.'));image.src=source;if(signal.aborted)aborted();});
  signal.throwIfAborted();const canvas=document.createElement('canvas');canvas.width=output.width;canvas.height=output.height;const context=canvas.getContext('2d');if(!context)throw Error('바코드 이미지 출력을 지원하지 않는 브라우저입니다.');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('바코드 PNG를 만들지 못했습니다.')),'image/png'));
  signal.throwIfAborted();const url=URL.createObjectURL(blob);try{const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
 }finally{URL.revokeObjectURL(source);}
}
/** Isolate printable content from the application so navigation and other
 * companies' rows cannot appear on the label. Printing is an explicit action. */
export async function printManagedBarcode(output:ManagedBarcodeOutput,signal:AbortSignal){
 signal.throwIfAborted();const frame=document.createElement('iframe');frame.title='바코드 인쇄';frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0';document.body.appendChild(frame);
 let timer:ReturnType<typeof setTimeout>|undefined;
 const cleanup=()=>{if(timer)clearTimeout(timer);signal.removeEventListener('abort',cleanup);frame.remove();};
 signal.addEventListener('abort',cleanup,{once:true});
 try{
  const doc=frame.contentDocument,win=frame.contentWindow;if(!doc||!win)throw Error('바코드 인쇄창을 준비하지 못했습니다.');
  doc.open();doc.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>바코드 인쇄</title><style>html,body{margin:0;padding:0;background:#fff}section{width:${output.width}px;margin:0 0 ${output.gap}px;break-inside:avoid;page-break-inside:avoid}svg{display:block}@page{margin:0}</style></head><body>${Array.from({length:output.copies},()=>`<section>${output.svg}</section>`).join('')}</body></html>`);doc.close();
  if(doc.fonts)await Promise.race([doc.fonts.ready,new Promise(resolve=>setTimeout(resolve,1000))]);
  signal.throwIfAborted();win.addEventListener('afterprint',cleanup,{once:true});timer=setTimeout(cleanup,60000);win.focus();win.print();
 }catch(error){cleanup();throw error;}
}
