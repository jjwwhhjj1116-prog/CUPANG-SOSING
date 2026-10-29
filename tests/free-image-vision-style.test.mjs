import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(color=()=>[240,202,172,255]){
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,require:name=>load(name.slice(2)+'.ts')});return exports;}
 const context={font:'original font',measureText(text){return{width:Array.from(text).length*Number(/([0-9.]+)px/u.exec(this.font)?.[1]??10)};},getImageData(x,y,width,height){const data=new Uint8ClampedArray(width*height*4);for(let py=0;py<height;py++)for(let px=0;px<width;px++)data.set(color(x+px,y+py),(py*width+px)*4);return{data};}};
 return{...load('app/free-image-vision-style.ts'),context,canvas:{getContext:()=>context}};
}
const block=(id,box,translated='신발 사이즈 조절 뒤꿈치 패드')=>({id:`vision-${id}`,text:'调鞋码后跟贴',translated,issue:null,box});
test('new Vision defaults sample peach/dark backgrounds, choose contrast and fit Korean on one line without changing source blocks',()=>{
 for(const [color,background,foreground]of [[()=>[240,202,172,255],'#f0caac','#111111'],[()=>[25,30,35,255],'#191e23','#ffffff']]){
  const h=fixture(color),blocks=[block(1,{x:20,y:20,width:260,height:80})],before=JSON.stringify(blocks),result=h.initializeVisionRegions(blocks,h.canvas,400,160),row=result.regions[0];
  assert.deepEqual(plain(result.issues),[]);assert.equal(row.background,background);assert.equal(row.foreground,foreground);assert.equal(row.textAlign,'center');assert.equal(row.selected,true);assert.ok(row.fontSize<64,'Korean width reduces the old height-only default');assert.ok(Array.from(row.translated).length*row.fontSize<=254);assert.ok(row.fontSize*1.2<=74);assert.equal(JSON.stringify(blocks),before);assert.equal(h.context.font,'original font');
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
