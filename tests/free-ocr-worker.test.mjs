import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/free-ocr-worker.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto,Uint8Array,Blob,TextEncoder,AbortController,Error,setTimeout,clearTimeout,require(name){assert.equal(name,'@/app/image-files');return{MAX_IMAGE_BYTES:10*1024*1024};}});
const options={workerPath:'/ocr/7.0.0/worker.min.js',corePath:'/ocr/7.0.0/core',langPath:'/ocr/7.0.0/lang',workerBlobURL:false};
const plain=value=>JSON.parse(JSON.stringify(value));
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function port(handler){
 const events=new Map(),calls=[],transfers=[];let terminated=0;
 const value={addEventListener(name,fn){events.set(name,fn);},removeEventListener(name,fn){if(events.get(name)===fn)events.delete(name);},postMessage(message,transfer){calls.push(message);transfers.push(transfer);handler?.(message,value);},terminate(){terminated++;},
  reply(message,status='resolve',data={}){events.get('message')?.({data:{workerId:message.workerId,jobId:message.jobId,action:message.action,status,data}});},emit(name,data){events.get(name)?.(data);},get terminated(){return terminated;},get listeners(){return events.size;},calls,transfers};return value;
}
test('pinned worker loads local models sequentially, forwards blocks and transfers image bytes, then terminates once',async()=>{
 const messages=[],p=port((request,target)=>queueMicrotask(()=>{if(request.action==='recognize')target.reply(request,'progress',{status:'recognizing text',progress:0.5});target.reply(request,'resolve',{text:'黑色',blocks:[]});}));
 const engine=await exports.createFreeOcrWorker(['chi_sim','eng'],1,{...options,logger:value=>messages.push(value)},new AbortController().signal,path=>{assert.equal(path,options.workerPath);return p;});
 assert.deepEqual(p.calls.map(row=>row.action),['load','loadLanguage','initialize']);assert.deepEqual(plain(p.calls[1].payload.langs),['chi_sim','eng']);assert.equal(p.calls[1].payload.options.langPath,options.langPath);assert.equal(p.calls[0].payload.options.corePath,options.corePath);assert.equal('dataPath' in p.calls[1].payload.options,false,'the engine default avoids mkdir of an existing virtual root');
 const input=new Uint8Array([1,2,3]),result=await engine.recognize(input,{rotateAuto:false},{blocks:true,text:true});assert.equal(result.data.text,'黑色');assert.equal(p.calls[3].payload.output.blocks,true);assert.equal(p.transfers[3].length,1);assert.deepEqual(Array.from(input),[1,2,3]);assert.equal(messages[0].progress,0.5);
 await engine.terminate();await engine.terminate();assert.equal(p.terminated,1);assert.equal(p.listeners,0);await assert.rejects(()=>engine.recognize(input));
});
test('cancelling language initialization immediately terminates the owned worker instead of awaiting a hidden SDK handle',async()=>{
 const controller=new AbortController(),p=port((request,target)=>{if(request.action==='load')queueMicrotask(()=>target.reply(request));});
 const starting=exports.createFreeOcrWorker(['eng'],1,options,controller.signal,()=>p);await settle();assert.deepEqual(p.calls.map(row=>row.action),['load','loadLanguage']);
 const rejected=assert.rejects(()=>starting);controller.abort();assert.equal(p.terminated,1);assert.equal(p.listeners,0);await rejected;p.reply(p.calls[1]);assert.equal(p.calls.length,2);
});
for(const action of ['load','loadLanguage','initialize'])test(`a ${action} rejection terminates the worker and rejects creation without an unresolved initialization`,async()=>{
 const p=port((request,target)=>queueMicrotask(()=>target.reply(request,request.action===action?'reject':'resolve','fixture')));
 await assert.rejects(()=>exports.createFreeOcrWorker(['eng'],1,options,new AbortController().signal,()=>p),/인식/);assert.equal(p.terminated,1);assert.equal(p.listeners,0);assert.equal(p.calls.at(-1).action,action);
});
test('unmatched worker messages cannot resolve jobs; native errors terminate pending initialization',async()=>{
 const p=port();const controller=new AbortController(),starting=exports.createFreeOcrWorker(['eng'],1,options,controller.signal,()=>p);const first=p.calls[0];
 p.emit('message',{data:{...first,workerId:'other',status:'resolve',data:{}}});p.emit('message',{data:{...first,jobId:'unknown',status:'resolve',data:{}}});p.emit('message',{data:{...first,action:'initialize',status:'resolve',data:{}}});await settle();assert.equal(p.calls.length,1);
 const rejected=assert.rejects(()=>starting,/도구/);p.emit('error',{message:'fixture'});await rejected;assert.equal(p.terminated,1);assert.equal(p.listeners,0);
});
test('only one recognition can run and cancellation rejects it while preserving the input bytes',async()=>{
 const controller=new AbortController(),p=port((request,target)=>{if(request.action!=='recognize')queueMicrotask(()=>target.reply(request));});
 const engine=await exports.createFreeOcrWorker(['eng'],1,options,controller.signal,()=>p),bytes=new Uint8Array([1]);const running=engine.recognize(bytes);await settle();await assert.rejects(()=>engine.recognize(bytes),/진행/);assert.equal(p.calls.filter(row=>row.action==='recognize').length,1);
 const rejected=assert.rejects(()=>running);controller.abort();await rejected;assert.equal(p.terminated,1);assert.deepEqual(Array.from(bytes),[1]);
});
test('invalid languages or external asset paths are rejected before constructing a worker',async()=>{
 let spawns=0;for(const [langs,oem,paths]of [[['chi_tra'],1,options],[['eng','eng'],1,options],[['eng'],0,options],[['eng'],1,{...options,workerPath:'https://other.test/worker.js'}]])await assert.rejects(()=>exports.createFreeOcrWorker(langs,oem,paths,new AbortController().signal,()=>{spawns++;return port();}));assert.equal(spawns,0);
});
