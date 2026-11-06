import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(color=()=>[240,202,172,255]){
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,require:name=>load(name.slice(2)+'.ts')});return exports;}
 const context={font:'original font',measureText(text){return{width:Array.from(text).length*Number(/([0-9.]+)px/u.exec(this.font)?.[1]??10)};},getImageData(x,y,width,height){const data=new Uint8ClampedArray(width*height*4);for(let py=0;py<height;py++)for(let px=0;px<width;px++)data.set(color(x+px,y+py),(py*width+px)*4);return{data};}};
 return{...load('app/free-image-vision-style.ts'),textStyle:load('app/free-image-text-style.ts'),context,canvas:{getContext:()=>context}};
}
const block=(id,box,translated='신발 사이즈 조절 뒤꿈치 패드')=>({id:`vision-${id}`,text:'调鞋码后跟贴',translated,issue:null,box});
test('flat connected-ink refinement is explicit and styles/checks use the derived box without changing raw OCR',()=>{
 const h=fixture((x,y)=>x>=38&&x<41&&y>=19&&y<36?[35,35,35,255]:[255,255,255,255]),rows=[{...block(1,{x:30,y:25,width:30,height:20},'번역'),kind:'overlay'}],before=JSON.stringify(rows);
 assert.deepEqual(plain(h.initializeVisionRegions(rows,h.canvas,100,80).regions[0].box),rows[0].box);
 const result=h.initializeVisionRegions(rows,h.canvas,100,80,{refineFlatOverlayBounds:true});
 assert.deepEqual(plain(result.regions[0].box),{x:30,y:18,width:30,height:27});assert.equal(JSON.stringify(rows),before);
});
test('Vision font fitting uses rendered Korean wrapping and explicit newline heights',()=>{
 for(const [text,fontSize]of [['한국어'.repeat(10),12],['한국어\n번역',14],['한국어\n\n번역',9]]){
  const h=fixture(()=>[255,255,255,255]),blocks=[block(1,{x:20,y:20,width:200,height:40},text)],before=JSON.stringify(blocks);
  const result=h.initializeVisionRegions(blocks,h.canvas,400,160);
  assert.equal(result.regions[0].fontSize,fontSize,text);assert.equal(result.regions[0].selected,true);assert.deepEqual(plain(result.issues),[]);
  assert.equal(JSON.stringify(blocks),before);assert.equal(h.context.font,'original font');
 }
});

test('invalid measured line widths remain unresolved instead of selecting an automatic font',()=>{
 for(const width of [-Infinity,NaN,Infinity,-1]){
  const h=fixture(()=>[255,255,255,255]);h.context.measureText=()=>({width});
  const result=h.initializeVisionRegions([block(1,{x:20,y:20,width:200,height:40},'한국어')],h.canvas,400,160);
  assert.equal(result.regions[0].selected,false);assert.ok(result.issues.includes('VISION_TEXT_FIT'));assert.equal(h.context.font,'original font');
 }
 const h=fixture(()=>[255,255,255,255]);h.context.measureText=()=>({width:0});
 assert.equal(h.initializeVisionRegions([block(1,{x:20,y:20,width:200,height:40},'한국어')],h.canvas,400,160).regions[0].selected,true);
});

test('new Vision defaults sample peach/dark backgrounds, choose contrast and fit Korean with renderer wrapping without changing source blocks',()=>{
 for(const [color,background,foreground]of [[()=>[240,202,172,255],'#f0caac','#111111'],[()=>[25,30,35,255],'#191e23','#ffffff']]){
  const h=fixture(color),blocks=[block(1,{x:20,y:20,width:260,height:80})],before=JSON.stringify(blocks),result=h.initializeVisionRegions(blocks,h.canvas,400,160),row=result.regions[0];
  assert.deepEqual(plain(result.issues),[]);assert.equal(row.background,background);assert.equal(row.foreground,foreground);assert.equal(row.textAlign,'center');assert.equal(row.selected,true);assert.ok(row.fontSize<64,'Korean wrapping reduces the old height-only default');assert.equal(h.context.font,'original font');
  h.context.font=`${row.fontSize}px Arial`;const lines=h.textStyle.wrappedLines(h.context,row.translated,254);assert.ok(lines.every(line=>h.context.measureText(line).width<=254));assert.ok(lines.length*row.fontSize*1.2<=74);assert.equal(JSON.stringify(blocks),before);
 }
});
test('actual five-box geometry preserves all text/coordinates but deselects overlaps and classifies automatic preview unsafe',()=>{
 const h=fixture(),boxes=[{x:1030,y:200,width:780,height:180},{x:170,y:1320,width:520,height:280},{x:580,y:1380,width:420,height:200},{x:200,y:1580,width:560,height:140},{x:160,y:1730,width:520,height:120}],text=['인체공학적 디자인','마찰 방지','발뒤꿈치 빠짐 방지','신발 사이즈 조절 뒤꿈치 패드','마찰 방지 및 발뒤꿈치 빠짐 방지'],blocks=boxes.map((box,index)=>block(index+1,box,text[index])),before=JSON.stringify(blocks);
 const result=h.initializeVisionRegions(blocks,h.canvas,1920,1920);assert.ok(result.issues.includes('VISION_REGION_OVERLAP'));assert.equal(result.regions.length,5);
 assert.deepEqual(plain(result.regions.map(row=>row.box)),boxes);assert.deepEqual(plain(result.regions.map(row=>row.translated)),text);assert.equal(JSON.stringify(blocks),before);
 for(const index of [1,2,3]){assert.equal(result.regions[index].selected,false);assert.match(result.regions[index].issue,/VISION_REGION_OVERLAP/);}
 assert.ok(result.regions[0].fontSize<144);assert.ok(result.regions[2].fontSize<160);assert.ok(result.regions[3].fontSize<112);
});
test('complex/transparent/unreadable backgrounds and tiny fits remain editable with fixed review issues, not a guessed automatic fill',()=>{
 for(const [color,expected]of [[(x,y)=>(x+y)%2?[0,0,0,255]:[255,255,255,255],'VISION_BACKGROUND_COMPLEX'],[()=>[0,0,0,0],'VISION_BACKGROUND_UNAVAILABLE']]){
  const h=fixture(color),source=block(1,{x:20,y:20,width:260,height:80}),result=h.initializeVisionRegions([source],h.canvas,400,160);assert.ok(result.issues.includes(expected));assert.equal(result.regions[0].selected,false);assert.equal(result.regions[0].translated,source.translated);assert.deepEqual(plain(result.regions[0].box),source.box);
 }
 const h=fixture(),result=h.initializeVisionRegions([block(1,{x:20,y:20,width:10,height:10},'한국어'.repeat(40))],h.canvas,400,160);assert.ok(result.issues.includes('VISION_TEXT_FIT'));assert.equal(result.regions[0].selected,false);assert.equal(result.regions[0].translated,'한국어'.repeat(40));
});

const sockBoxes=[{x:415,y:55,width:330,height:50},{x:458,y:105,width:295,height:30},{x:415,y:150,width:290,height:48},{x:458,y:195,width:305,height:30},{x:40,y:565,width:195,height:48},{x:40,y:620,width:195,height:48}];
const overlayBlocks=boxes=>boxes.map((box,index)=>({...block(index+1,box,'한국어 문구'),kind:'overlay'}));
test('the observed six-box geometry is only a versioned two-pass candidate when explicitly enabled; raw OCR coordinates and text remain exact',()=>{
 const h=fixture(),blocks=overlayBlocks(sockBoxes),before=JSON.stringify(blocks),legacy=h.initializeVisionRegions(blocks,h.canvas,800,800);
 assert.equal(legacy.paintOrder,undefined);assert.ok(legacy.issues.includes('VISION_REGION_OVERLAP'));assert.equal(legacy.regions[2].selected,false);assert.equal(legacy.regions[3].selected,false);
 const result=h.initializeVisionRegions(blocks,h.canvas,800,800,{allowSafeOverlayOverlap:true});
 assert.equal(result.paintOrder,'backgrounds-first-v1');assert.deepEqual(plain(result.issues),[]);assert.ok(result.regions.every(row=>row.selected&&row.issue===null));
 assert.deepEqual(plain(result.regions.map(row=>row.box)),sockBoxes);assert.deepEqual(plain(result.regions.map(row=>[row.text,row.translated])),blocks.map(row=>[row.text,row.translated]));assert.equal(JSON.stringify(blocks),before);
});
test('two-pass candidates still reject deep or proportionally excessive overlaps, unknown classification, raw issues and non-overlap style failures',()=>{
 const h=fixture(),pair=[{x:20,y:20,width:80,height:30},{x:30,y:47,width:80,height:30}];
 const cases=[
  overlayBlocks([{...pair[0]},{...pair[1],y:46}]),
  overlayBlocks([{...pair[0],height:20},{...pair[1],y:37,height:20}]),
  overlayBlocks([{...pair[0]},{...pair[1],x:99,y:20}]),
  ...['product-marking','uncertain',undefined].map(kind=>{const blocks=overlayBlocks(pair);if(kind)blocks[1].kind=kind;else delete blocks[1].kind;return blocks;}),
  overlayBlocks(pair).map((row,index)=>index?{...row,issue:'원문 번역 검토'}:row),
  overlayBlocks(pair).map((row,index)=>index?{...row,translated:'한국어'.repeat(100)}:row),
 ];
 for(const blocks of cases){const before=JSON.stringify(blocks),result=h.initializeVisionRegions(blocks,h.canvas,160,100,{allowSafeOverlayOverlap:true});assert.equal(result.paintOrder,undefined);assert.ok(result.issues.includes('VISION_REGION_OVERLAP'));assert.equal(JSON.stringify(blocks),before);}
 for(const color of [(x,y)=>(x+y)%2?[0,0,0,255]:[255,255,255,255],()=>[0,0,0,0]]){
  const bad=fixture(color),result=bad.initializeVisionRegions(overlayBlocks(pair),bad.canvas,160,100,{allowSafeOverlayOverlap:true});assert.equal(result.paintOrder,undefined);assert.ok(result.issues.includes('VISION_REGION_OVERLAP'));assert.ok(result.regions.every(row=>!row.selected));
 }
 const noContext=h.initializeVisionRegions(overlayBlocks(pair),{getContext:()=>null},160,100,{allowSafeOverlayOverlap:true});assert.equal(noContext.paintOrder,undefined);assert.ok(noContext.issues.includes('VISION_BACKGROUND_UNAVAILABLE'));
 const touching=h.initializeVisionRegions(overlayBlocks([{...pair[0]},{...pair[1],y:50}]),h.canvas,160,100,{allowSafeOverlayOverlap:true});assert.equal(touching.paintOrder,undefined);assert.deepEqual(plain(touching.issues),[]);
});
