import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const plain=value=>JSON.parse(JSON.stringify(value));
function load(){const cache=new Map();function read(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Uint8ClampedArray,Uint8Array,Int32Array,require:name=>read(name.slice(2)+'.ts')});return exports;}return read('app/free-image-overlay-bounds.ts');}
function picture(){const width=100,height=80,data=new Uint8ClampedArray(width*height*4).fill(255);return{width,height,data,paint(x,y,w,h,color=[35,35,35,255]){for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)data.set(color,(py*width+px)*4);},getImageData(x,y,w,h){const pixels=new Uint8ClampedArray(w*h*4);for(let py=0;py<h;py++)for(let px=0;px<w;px++)pixels.set(data.subarray(((py+y)*width+px+x)*4,((py+y)*width+px+x)*4+4),(py*w+px)*4);return{data:pixels};}};}
const block=(box={x:30,y:25,width:30,height:20},kind='overlay')=>({id:'vision-1',text:'原文',translated:'한국어',issue:null,kind,box});
test('connected top/right source ink extends only the new flat-overlay geometry and keeps inputs immutable',()=>{
 const h=load(),p=picture(),raw=[block()],before=JSON.stringify(raw);p.paint(38,19,3,17);p.paint(49,33,16,3);const pixels=p.data.slice();
 const result=h.refineFlatOverlayBounds(raw,p,p.width,p.height);
 assert.deepEqual(plain(result),[{x:30,y:18,width:36,height:27}]);assert.equal(JSON.stringify(raw),before);assert.deepEqual(p.data,pixels);
});
test('independent next line stays outside; independent logo in an added strip blocks refinement',()=>{
 const h=load(),p=picture();p.paint(38,19,3,17);p.paint(36,52,8,2);
 assert.equal(h.refineFlatOverlayBounds([block()],p,100,80)[0].y,18);
 p.paint(53,20,3,2);assert.deepEqual(plain(h.refineFlatOverlayBounds([block()],p,100,80)[0]),block().box);
});
test('markings, uncertain blocks, missing classification, provider issues and protected neighboring boxes never expand',()=>{
 const h=load(),p=picture();p.paint(38,19,3,17);
 for(const raw of [block(undefined,'product-marking'),block(undefined,'uncertain'),{...block(),kind:undefined},{...block(),issue:'review'}])assert.deepEqual(plain(h.refineFlatOverlayBounds([raw],p,100,80)[0]),raw.box);
 for(const kind of ['product-marking','uncertain','overlay']){const rows=[block(),{...block({x:50,y:18,width:5,height:4},kind),id:'vision-2'}];assert.deepEqual(plain(h.refineFlatOverlayBounds(rows,p,100,80)[0]),rows[0].box);}
});
test('ROI-edge ink, nonuniform/transparent backgrounds, high ink and unavailable pixels retain original boxes',()=>{
 const h=load();for(const kind of ['edge','photo','alpha','dense','unavailable']){const p=picture();p.paint(38,19,3,17);
  if(kind==='edge')p.paint(38,13,3,20);if(kind==='photo')for(let y=13;y<57;y++)for(let x=18;x<72;x++)p.paint(x,y,1,1,[(x*37)%256,(y*41)%256,80,255]);
  if(kind==='alpha')p.paint(20,15,50,40,[255,255,255,100]);if(kind==='dense')p.paint(25,20,40,28);if(kind==='unavailable')p.getImageData=()=>{throw Error('tainted');};
  assert.deepEqual(plain(h.refineFlatOverlayBounds([block()],p,100,80)[0]),block().box,kind);
 }
});
test('no spill, image edges and over-budget regions do not invent blank padding or allocate/read unbounded pixels',()=>{
 const h=load(),p=picture();p.paint(38,28,3,6);assert.deepEqual(plain(h.refineFlatOverlayBounds([block()],p,100,80)[0]),block().box);
 const edge=block({x:0,y:0,width:20,height:15});assert.deepEqual(plain(h.refineFlatOverlayBounds([edge],p,100,80)[0]),edge.box);
 let reads=0;const huge=block({x:20,y:20,width:2000,height:2000});assert.deepEqual(plain(h.refineFlatOverlayBounds([huge],{getImageData(){reads++;throw Error('unexpected');}},4000,4000)[0]),huge.box);assert.equal(reads,0);
});
