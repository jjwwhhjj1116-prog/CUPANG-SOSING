import test from 'node:test';
import assert from 'node:assert/strict';
import {hydratePageForCapture} from '../extensions/supplier-hub/page-hydration.mjs';

function eventTarget(){
 const listeners=new Map();
 return {listeners,addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(callback);},
  removeEventListener(type,callback){listeners.get(type)?.delete(callback);},
  dispatch(type,patch={}){for(const callback of [...(listeners.get(type)??[])])callback({type,isTrusted:true,...patch});},
  listenerCount(){return [...listeners.values()].reduce((count,callbacks)=>count+callbacks.size,0);}};
}
function fixture({x=7,y=120,height=20000,viewport=800}={}){
 let elapsed=0,left=x,top=y;
 const moves=[],waits=[],timeline=[],document={...eventTarget(),visibilityState:'visible',hidden:false},view={...eventTarget(),innerHeight:viewport,innerWidth:1000};
 const root={scrollHeight:height,clientHeight:viewport,isConnected:true,ownerDocument:document};
 const position=(nextX,nextY)=>{left=nextX;top=nextY;};
 Object.defineProperties(root,{scrollLeft:{get:()=>left,set:value=>{left=value;}},scrollTop:{get:()=>top,set:value=>{top=value;}}});
 Object.defineProperties(view,{scrollX:{get:()=>left,set:value=>{left=value;}},scrollY:{get:()=>top,set:value=>{top=value;}},pageXOffset:{get:()=>left},pageYOffset:{get:()=>top}});
 document.documentElement=root;document.scrollingElement=root;document.defaultView=view;view.document=document;view.window=view;view.top=view;
 let onScroll=()=>{},onWait=()=>{};
 view.scrollTo=(first,second)=>{
  const nextX=typeof first==='object'?first.left??left:first,nextY=typeof first==='object'?first.top??top:second;
  assert.ok(Number.isFinite(nextX)&&Number.isFinite(nextY),'only finite scroll positions');
  position(nextX,nextY);const move={x:left,y:top,at:elapsed};moves.push(move);timeline.push({kind:'scroll',...move});onScroll(move);
  view.dispatch('scroll');document.dispatch('scroll');
 };
 const wait=async ms=>{assert.ok(Number.isFinite(ms)&&ms>=0);elapsed+=ms;waits.push(ms);timeline.push({kind:'wait',ms,at:elapsed});await onWait(ms);};
 return {document,view,root,moves,waits,timeline,wait,now:()=>elapsed,advance:ms=>{elapsed+=ms;},position,
  onScroll:callback=>{onScroll=callback;},onWait:callback=>{onWait=callback;},
  emit:(type,patch)=>{document.dispatch(type,patch);view.dispatch(type,patch);},
  listenerCount:()=>document.listenerCount()+view.listenerCount()};
}
const options=(h,capture,extra={})=>({wait:h.wait,now:h.now,capture,...extra});

test('scroll-triggered facts and late details are captured once before restoring the original position',async()=>{
 const h=fixture(),loaded={attributes:[],details:[]};let captures=0,checks=0;
 h.onScroll(({y})=>{if(y>=1400)loaded.attributes=['observed material'];if(y>=2800)loaded.details=['detail-1'];});
 h.onWait(ms=>{if(ms===500&&loaded.details.length)loaded.details.push('detail-2');});
 const snapshot=await hydratePageForCapture(h.document,h.view,options(h,checked=>{
  captures++;assert.equal(typeof checked,'function');checked();assert.equal(h.view.scrollY,3600);
  assert.equal(h.waits.at(-1),500);h.timeline.push({kind:'capture'});return structuredClone(loaded);
 },{assertCurrent(){checks++;}}));
 assert.deepEqual(snapshot,{attributes:['observed material'],details:['detail-1','detail-2']});assert.equal(captures,1);assert.ok(checks>1);
 assert.deepEqual([h.view.scrollX,h.view.scrollY],[7,120]);assert.equal(h.timeline.at(-2).kind,'capture');assert.equal(h.timeline.at(-1).kind,'scroll');
 assert.deepEqual(h.moves.at(-1),{x:7,y:120,at:h.now()});assert.equal(h.listenerCount(),0);
});

test('height growth can reveal more content without exceeding the fixed movement and absolute y limits',async()=>{
 for(const initialHeight of [2000,20000]){
  const h=fixture({y:0,height:initialHeight});h.onScroll(()=>{h.root.scrollHeight=100000;});
  await hydratePageForCapture(h.document,h.view,options(h,checked=>{checked();return 'captured';}));
  const forward=h.moves.slice(0,-1),target=3600;
  assert.ok(forward.length>0&&forward.length<=6);assert.equal(forward.at(-1).y,target);
  if(initialHeight===2000)assert.ok(forward.at(-1).y>initialHeight-h.view.innerHeight,'newly hydrated height can extend the sweep within the fixed cap');
  let prior=0;for(const move of forward){assert.ok(move.y>prior&&move.y-prior<=Math.min(h.view.innerHeight*.85,900));assert.ok(move.y<=target);prior=move.y;}
  assert.deepEqual(h.waits,[...forward.map(()=>350),500]);assert.ok(h.now()<=5500);assert.equal(h.view.scrollY,0);assert.equal(h.listenerCount(),0);
 }
});

test('an early detail image cannot end hydration before later viewport-triggered images appear',async()=>{
 const h=fixture({y:0}),details=['already-visible'];let captures=0;
 h.onScroll(({y})=>{if(y>=3000&&!details.includes('later-image'))details.push('later-image');});
 const snapshot=await hydratePageForCapture(h.document,h.view,options(h,checked=>{checked();captures++;return [...details];}));
 assert.deepEqual(snapshot,['already-visible','later-image']);assert.equal(captures,1);assert.ok(h.moves.some(move=>move.y>=3000));assert.equal(h.view.scrollY,0);assert.equal(h.listenerCount(),0);
});

test('virtualized sections are observed at each mounted viewport before they disappear',async()=>{
 const h=fixture({y:0}),seen=[];let captures=0;
 const value=()=>h.view.scrollY<900?'attributes':h.view.scrollY<2200?'packaging':'detail';
 const result=await hydratePageForCapture(h.document,h.view,options(h,checked=>{checked();captures++;return [...seen];},{observe(checked){checked();const item=value();if(!seen.includes(item))seen.push(item);}}));
 assert.deepEqual(result,['attributes','packaging','detail']);assert.equal(captures,1);assert.equal(h.view.scrollY,0);assert.equal(h.listenerCount(),0);
});

test('interrupted or asynchronous viewport observations never return a partial capture',async()=>{
 for(const asyncObserver of [false,true]){
  const h=fixture({y:0});let captures=0,observations=0;
  await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,()=>{captures++;},{observe(){observations++;if(asyncObserver)return Promise.resolve();h.emit('wheel');}})));
  assert.equal(captures,0);assert.equal(observations,1);assert.equal(h.listenerCount(),0);
 }
});

for(const type of ['wheel','touchstart','pointerdown','keydown'])test(`trusted ${type} interrupts hydration without capture or forced restoration`,async()=>{
 const h=fixture();let captures=0;h.onWait(()=>h.emit(type,{key:'ArrowDown'}));
 await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,()=>{captures++;})));
 assert.equal(captures,0);assert.equal(h.moves.length,1);assert.notEqual(h.view.scrollY,120);assert.equal(h.listenerCount(),0);
});

test('untrusted input and programmatic scroll events do not interrupt hydration',async()=>{
 const h=fixture();let captures=0;
 h.onWait(()=>{for(const type of ['wheel','touchstart','pointerdown','keydown'])h.emit(type,{isTrusted:false,key:'ArrowDown'});});
 assert.equal(await hydratePageForCapture(h.document,h.view,options(h,checked=>{checked();captures++;return 'ready';})),'ready');
 assert.equal(captures,1);assert.deepEqual([h.view.scrollX,h.view.scrollY],[7,120]);assert.equal(h.listenerCount(),0);
});

for(const type of ['visibilitychange','pagehide'])test(`${type} interrupts hydration and leaves the user's current position alone`,async()=>{
 const h=fixture();let captures=0;
 h.onWait(()=>{if(type==='visibilitychange'){h.document.visibilityState='hidden';h.document.hidden=true;}h.emit(type);});
 await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,()=>{captures++;})));
 assert.equal(captures,0);assert.equal(h.moves.length,1);assert.notEqual(h.view.scrollY,120);assert.equal(h.listenerCount(),0);
});

test('same-offer or collector-lease assertion failure stops before another read and does not restore',async()=>{
 const h=fixture();let changed=false,captures=0;h.onWait(()=>{changed=true;});
 await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,()=>{captures++;},{assertCurrent(){if(changed)throw Error('synthetic offer or collector changed');}})),/synthetic offer or collector changed/);
 assert.equal(captures,0);assert.equal(h.moves.length,1);assert.notEqual(h.view.scrollY,120);assert.equal(h.listenerCount(),0);
});

for(const property of ['documentElement','scrollingElement'])test(`${property} replacement stops hydration without scrolling the replacement document`,async()=>{
 const h=fixture();let captures=0;h.onWait(()=>{h.document[property]={scrollHeight:10000,clientHeight:800,scrollTop:0,scrollLeft:0,isConnected:true};});
 await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,()=>{captures++;})));
 assert.equal(captures,0);assert.equal(h.moves.length,1);assert.notEqual(h.view.scrollY,120);assert.equal(h.listenerCount(),0);
});

test('unexpected horizontal or vertical scroll displacement aborts instead of fighting another scroller',async()=>{
 for(const axis of ['x','y']){
  const h=fixture();let captures=0;h.onWait(()=>h.position(h.view.scrollX+(axis==='x'?3:0),h.view.scrollY+(axis==='y'?3:0)));
  await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,()=>{captures++;})));
  assert.equal(captures,0);assert.equal(h.moves.length,1);assert.equal(h.listenerCount(),0);
 }
});

test('the 5500ms budget covers hydration and capture awaits and never returns a late snapshot',async()=>{
 for(const duringCapture of [false,true]){
  const h=fixture();let captures=0;
  if(!duringCapture)h.onWait(()=>h.advance(5501));
  await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,async checked=>{
   captures++;checked();await Promise.resolve();h.advance(5501);return {late:true};
  })));
  assert.equal(captures,duringCapture?1:0);assert.equal(h.listenerCount(),0);
 }
});

test('the callback receives a checked guard that rejects an expired capture before another read',async()=>{
 const h=fixture();let lateRead=false;
 await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,async checked=>{checked();await Promise.resolve();h.advance(5501);checked();lateRead=true;return {};})));
 assert.equal(lateRead,false);assert.equal(h.listenerCount(),0);
});

test('a same-scope extraction failure restores the original position and propagates the error',async()=>{
 const h=fixture();let captures=0;
 await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,checked=>{checked();captures++;throw Error('synthetic extraction failure');})),/synthetic extraction failure/);
 assert.equal(captures,1);assert.deepEqual([h.view.scrollX,h.view.scrollY],[7,120]);assert.deepEqual(h.moves.at(-1),{x:7,y:120,at:h.now()});assert.equal(h.listenerCount(),0);
});

test('capture interrupted after an await cannot return its snapshot or restore over user input',async()=>{
 const h=fixture();let captures=0;
 await assert.rejects(hydratePageForCapture(h.document,h.view,options(h,async checked=>{checked();captures++;await Promise.resolve();h.emit('wheel');return {stale:true};})));
 assert.equal(captures,1);assert.equal(h.view.scrollY,3600);assert.equal(h.moves.at(-1).y,3600);assert.equal(h.listenerCount(),0);
});

test('already-below-limit and unscrollable documents capture without moving or waiting',async()=>{
 for(const settings of [{y:5000},{y:0,height:800}]){
  const h=fixture(settings);let captures=0;
  assert.equal(await hydratePageForCapture(h.document,h.view,options(h,checked=>{checked();captures++;return 'unchanged';})),'unchanged');
  assert.equal(captures,1);assert.deepEqual(h.moves,[]);assert.deepEqual(h.waits,[]);assert.equal(h.listenerCount(),0);
 }
});

test('inert fixtures without real scrolling or event APIs pass through capture without inventing movement',async()=>{
 for(const missing of ['scrollTo','view-events','document-events']){
  const h=fixture();if(missing==='scrollTo')delete h.view.scrollTo;if(missing==='view-events')delete h.view.addEventListener;if(missing==='document-events')delete h.document.addEventListener;
  let captures=0,checks=0;
  assert.deepEqual(await hydratePageForCapture(h.document,h.view,options(h,checked=>{captures++;checked();return {inert:true};},{assertCurrent(){checks++;}})),{inert:true});
  assert.equal(captures,1);assert.ok(checks>0);assert.deepEqual(h.moves,[]);assert.deepEqual(h.waits,[]);assert.equal(h.listenerCount(),0);
 }
});
