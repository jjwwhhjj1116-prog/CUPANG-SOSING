import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {cropCore,cropClientFixture,plain} from './helpers/free-image-crop.mjs';
const sha=bytes=>createHash('sha256').update(typeof bytes==='string'?bytes:Buffer.from(bytes)).digest('hex');
const slice=(pixels,width,rect)=>{const output=new Uint8Array(rect.width*rect.height*4);for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++)output.set(pixels.subarray(((rect.y+y)*width+rect.x+x)*4,((rect.y+y)*width+rect.x+x+1)*4),(y*rect.width+x)*4);return output;};

test('crop rect accepts only original integer pixels; orientation proof is exact same or rotated',()=>{
 const core=cropCore(),rect={x:1,y:2,width:7,height:6};assert.deepEqual(plain(core.validateFreeImageCropRect(rect,20,12)),rect);
 assert.deepEqual(plain(core.validateFreeImageCrop({...rect,sourceWidth:20,sourceHeight:12},{width:20,height:12})),{...rect,sourceWidth:20,sourceHeight:12});
 assert.deepEqual(plain(core.validateFreeImageCrop({...rect,sourceWidth:12,sourceHeight:20},{width:20,height:12})),{...rect,sourceWidth:12,sourceHeight:20});
 for(const bad of [null,[],{},'rect',{...rect,x:-1},{...rect,y:0.5},{...rect,width:0},{...rect,height:-1},{...rect,width:21},{...rect,y:10},{...rect,x:NaN},{...rect,width:Infinity},{...rect,x:Number.MAX_SAFE_INTEGER},{...rect,extra:true}])assert.throws(()=>core.validateFreeImageCropRect(bad,20,12));
 for(const bad of [null,{...rect,sourceWidth:21,sourceHeight:12},{...rect,sourceWidth:20.1,sourceHeight:12},{...rect,sourceWidth:20,sourceHeight:0},{...rect,sourceWidth:20,sourceHeight:12,extra:true}])assert.throws(()=>core.validateFreeImageCrop(bad,{width:20,height:12}));
 assert.throws(()=>core.validateFreeImageCropRect(rect,Infinity,12));assert.throws(()=>core.validateFreeImageCropRect(rect,20000,12));
});

test('crop-only yields the exact original pixel window and does not mutate the original canvas',async()=>{
 const h=cropClientFixture(),image=h.image(),before=image.canvas.pixels.slice(),rect={x:3,y:2,width:8,height:5};
 const rendered=await h.client.renderFreeImageTranslation(image,[],new AbortController().signal,[],rect),output=h.canvases.at(-1),bytes=new Uint8Array(await rendered.output.arrayBuffer());
 assert.equal(rendered.output.type,'image/png');assert.deepEqual([rendered.width,rendered.height],[8,5]);assert.deepEqual(plain(rendered.crop),{...rect,sourceWidth:20,sourceHeight:12});assert.deepEqual(output.pixels,slice(before,20,rect));assert.deepEqual(image.canvas.pixels,before);assert.deepEqual(h.operations.at(-1),['crop',3,2,8,5]);assert.equal(new DataView(bytes.buffer).getUint32(16),8);assert.equal(new DataView(bytes.buffer).getUint32(20),5);assert.equal(rendered.source,image.source);
});

test('text, erase and brush edits render in original coordinates before the final pixel crop',async()=>{
 const h=cropClientFixture(),image=h.image(),rect={x:3,y:2,width:9,height:7},before=image.canvas.pixels.slice();
 const brush=h.brush.createFreeImageBrush(2,[{x:4,y:7},{x:8,y:8}],20,12);
 const regions=[h.region('text',{x:2,y:1,width:8,height:5},'한'),{...h.region('erase',{x:9,y:4,width:3,height:4},''),erase:true,background:'#ff0000'},{...h.region('brush',brush.box,''),erase:true,background:'#0000ff',brush:brush.brush}];
 const full=await h.client.renderFreeImageTranslation(image,regions,new AbortController().signal),fullPixels=h.canvases.at(-1).pixels.slice();assert.deepEqual([full.width,full.height],[20,12]);
 const cropped=await h.client.renderFreeImageTranslation(image,regions,new AbortController().signal,[],rect);assert.deepEqual(h.canvases.at(-1).pixels,slice(fullPixels,20,rect));assert.deepEqual(image.canvas.pixels,before);assert.equal(h.operations.at(-1)[0],'crop');assert.deepEqual([cropped.width,cropped.height],[9,7]);assert.ok(h.operations.some(value=>value[0]==='text'));assert.ok(h.operations.some(value=>value[0]==='stroke'));
 const calls=h.operations.length;await assert.rejects(h.client.renderFreeImageTranslation(image,[{...regions[0],box:{x:20,y:0,width:1,height:1}}],new AbortController().signal,[],rect));assert.equal(h.operations.length,calls,'even an overlay outside the selected crop must be valid on the original');
});

test('crop identity changes only cropped edits and includes rectangle, visible orientation and selected option IDs',async()=>{
 const h=cropClientFixture(),image=h.image(),core=cropCore(),output=new Blob(['identical fixture PNG'],{type:'image/png'}),base={source:image.source,output,width:20,height:12};
 assert.equal(core.freeImageApplyIdentity(image.source),core.freeImageSourceIdentity(image.source));
 const legacy=await h.client.expectedFreeImageOutputKey(base);assert.equal(legacy,`owner/free-image-product-${sha(core.freeImageSourceIdentity(image.source))}-${sha(await output.arrayBuffer())}.png`);
 const crop={x:1,y:2,width:4,height:5,sourceWidth:20,sourceHeight:12},rendered={...base,width:4,height:5,crop};const key=await h.client.expectedFreeImageOutputKey(rendered);assert.notEqual(key,legacy);
 for(const value of [{...crop,x:2},{...crop,sourceWidth:12,sourceHeight:20}])assert.notEqual(await h.client.expectedFreeImageOutputKey({...rendered,crop:value}),key);
 const optionSource={...image.source,role:'main',optionImages:{revision:3,optionIds:['sku-a','sku-b']}};assert.equal(core.freeImageApplyIdentity(optionSource,['sku-b','sku-a']),JSON.stringify({source:core.freeImageSourceIdentity(optionSource),optionImageIds:['sku-a','sku-b']}));assert.notEqual(core.freeImageApplyIdentity(optionSource,['sku-a'],crop),core.freeImageApplyIdentity(optionSource,['sku-b'],crop));
 await assert.rejects(h.client.expectedFreeImageOutputKey({...rendered,width:5}));
});

test('cropped apply/recover send and verify the same immutable PNG and exact crop echo without an automatic second save',async()=>{
 const h=cropClientFixture(),source={...h.source,quotationTarget:{kind:'quotation',profileId:null,optionId:'sku-a',input:'detailImages',fieldKey:'wire-detail',slotIndex:1,revision:7,inputFingerprint:'c'.repeat(64),optionRevision:3,bindingSha256:'b'.repeat(64),value:'owner/first.png\nowner/original.png'}},crop={x:2,y:1,width:4,height:5,sourceWidth:20,sourceHeight:12},output=new Blob(['same reviewed PNG'],{type:'image/png'}),rendered={source,crop,output,width:4,height:5},calls=[];
 const key=await h.client.expectedFreeImageOutputKey(rendered),good={source,crop,key,productVersion:'2026-10-06T00:00:01Z',contentRevision:2,optionRevision:3,quotationRevision:8,quotationInputFingerprint:'d'.repeat(64),applied:true};
 await h.client.applyFreeImageTranslation(rendered,new AbortController().signal,async(_url,init)=>{calls.push('apply');assert.deepEqual(JSON.parse(init.body.get('crop')),crop);assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()),Buffer.from(await output.arrayBuffer()));return Response.json(good);});
 for(const applied of [false,true]){const reply=await h.client.recoverFreeImageTranslation(rendered,new AbortController().signal,async(_url,init)=>{calls.push('recover');assert.deepEqual(JSON.parse(init.body),{action:'recover',source,outputSha256:sha(await output.arrayBuffer()),outputBytes:output.size,crop});return Response.json(applied?{...good,replayed:true}:{source,crop,key,applied:false});});assert.equal(reply.applied,applied);}
 for(const value of [undefined,{...crop,x:3},{...crop,extra:true}])await assert.rejects(h.client.recoverFreeImageTranslation(rendered,new AbortController().signal,async()=>Response.json({source,key,crop:value,applied:false})),error=>error.uncertain===true);
 assert.deepEqual(calls,['apply','recover','recover']);assert.equal(rendered.output,output);
});

test('invalid crop, empty non-crop work, cancelled work and option-only missing selection never render',async()=>{
 const h=cropClientFixture(),image=h.image(),before=h.operations.length;
 for(const rect of [{x:-1,y:0,width:2,height:2},{x:0,y:0,width:21,height:1},{x:0,y:0,width:1.5,height:2}])await assert.rejects(h.client.renderFreeImageTranslation(image,[],new AbortController().signal,[],rect));
 await assert.rejects(h.client.renderFreeImageTranslation(image,[],new AbortController().signal));const controller=new AbortController();controller.abort();await assert.rejects(h.client.renderFreeImageTranslation(image,[],controller.signal,[],{x:0,y:0,width:2,height:2}));
 await assert.rejects(h.client.renderFreeImageTranslation({...image,source:{...image.source,role:'main',optionImages:{revision:3,optionIds:['sku-a'],commonAssigned:false}}},[],new AbortController().signal,[],{x:0,y:0,width:2,height:2}));assert.equal(h.operations.length,before);
});
