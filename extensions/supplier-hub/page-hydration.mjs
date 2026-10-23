/** A bounded viewport sweep inside one explicit collection click. This never
 * clicks page controls, follows links, reads frames or requests source data. */
export async function hydratePageForCapture(document,view,{assertCurrent=()=>{},capture,wait,now=()=>Date.now()}={}){
 assertCurrent();
 const root=document.documentElement,scroller=document.scrollingElement;
 const delay=wait??(typeof globalThis.setTimeout==='function'?ms=>new Promise(resolve=>globalThis.setTimeout(resolve,ms)):null);
 // Non-window/inert readers retain their existing passive collection behavior.
 if(!scroller||!delay||typeof view?.scrollTo!=='function'||typeof view.addEventListener!=='function'||typeof view.removeEventListener!=='function'||typeof document.addEventListener!=='function'||typeof document.removeEventListener!=='function')return capture(assertCurrent);
 const start=now(),deadline=start+5500;
 const position=()=>({x:Number(view.scrollX),y:Number(view.scrollY)});
 const original=position(),viewport=Number(view.innerHeight),height=Number(scroller.scrollHeight);
 if(!Number.isFinite(original.x)||!Number.isFinite(original.y)||!Number.isFinite(viewport)||viewport<=0||!Number.isFinite(height))return capture(assertCurrent);
 let interrupted=false,moved=false,expected=original;
 const interrupt=event=>{if(event.isTrusted)interrupted=true;};
 const visibility=()=>{if(document.visibilityState==='hidden')interrupted=true;};
 const pagehide=()=>{interrupted=true;};
 const inputEvents=['wheel','touchstart','pointerdown','keydown'];
 const options={capture:true,passive:true};
 const samePosition=()=>{const current=position();return Math.abs(current.x-expected.x)<=2&&Math.abs(current.y-expected.y)<=2;};
 const scope=()=>{assertCurrent();if(document.documentElement!==root||document.scrollingElement!==scroller)throw Error('상품 문서가 변경되어 화면 확인을 중단했습니다. 다시 수집해주세요.');};
 const checked=()=>{
  scope();visibility();
  if(moved&&!samePosition())interrupted=true;
  if(interrupted)throw Error('화면 조작 또는 페이지 이동으로 수집을 중단했습니다. 화면이 안정된 뒤 상품 수집을 다시 눌러주세요.');
  if(now()>=deadline)throw Error('상품 화면 확인 시간을 초과했습니다. 자동으로 저장하지 않았습니다. 화면이 안정된 뒤 다시 수집해주세요.');
 };
 for(const type of inputEvents)view.addEventListener(type,interrupt,options);
 view.addEventListener('pagehide',pagehide,options);document.addEventListener('visibilitychange',visibility,options);
 try{
  checked();
  // A lazy module can grow the document between moves, but neither that nor
  // related-product infinite scrolling can extend the fixed distance/count.
  // Do not move farther down an already deep viewport.
  const step=Math.max(1,Math.min(viewport*.85,900));
  for(let move=0;move<6;move++){
   checked();const currentHeight=Number(scroller.scrollHeight),limit=Math.max(0,Math.min(currentHeight-viewport,3600));
   if(!Number.isFinite(limit)||expected.y>=limit-2)break;
   const target=Math.min(limit,expected.y+step);
   view.scrollTo({left:original.x,top:target,behavior:'instant'});moved=true;expected=position();
   checked();await delay(350);checked();
   if(expected.y<target-2)break;
  }
  if(moved){await delay(500);checked();}
  // The caller reads all fields before restoration; a virtualized viewport
  // must not lose the just-observed DOM merely because we restored first.
  const result=await capture(checked);checked();return result;
 }finally{
  try{
   let current=false;try{scope();current=true;}catch{/* Never scroll a replacement document/collector. */}
   if(moved&&current&&!interrupted&&document.visibilityState!=='hidden'&&samePosition())view.scrollTo({left:original.x,top:original.y,behavior:'instant'});
  }finally{
   for(const type of inputEvents)view.removeEventListener(type,interrupt,options);
   view.removeEventListener('pagehide',pagehide,options);document.removeEventListener('visibilitychange',visibility,options);
  }
 }
}
