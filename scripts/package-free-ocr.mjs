import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const root=path.resolve(import.meta.dirname,'..'),target=path.join(root,'public/ocr/7.0.0');
const checking=process.argv.slice(2).join(' ')==='--check';
if(process.argv.length>3||process.argv.length===3&&!checking)throw Error('Use node scripts/package-free-ocr.mjs [--check]');
const version=JSON.parse(fs.readFileSync(path.join(root,'node_modules/tesseract.js/package.json'),'utf8')).version;
const coreVersion=JSON.parse(fs.readFileSync(path.join(root,'node_modules/tesseract.js-core/package.json'),'utf8')).version;
if(version!=='7.0.0'||coreVersion!=='7.0.0')throw Error('Free OCR requires pinned Tesseract and core 7.0.0');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[];
function copy(source,name){
 const bytes=fs.readFileSync(source),output=path.join(target,name);
 if(checking){if(!fs.existsSync(output)||sha(fs.readFileSync(output))!==sha(bytes))throw Error('OCR asset differs: '+name);}
 else{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}
 files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
}
copy(path.join(root,'node_modules/tesseract.js/dist/worker.min.js'),'worker.min.js');
copy(path.join(root,'node_modules/tesseract.js/LICENSE.md'),'LICENSE-tesseract.txt');
// Both pinned packages declare Apache-2.0; the core npm archive omits its
// license file. Retain the full Apache license from the matching JS package.
if(JSON.parse(fs.readFileSync(path.join(root,'node_modules/tesseract.js-core/package.json'),'utf8')).license!=='Apache-2.0')throw Error('Review the core package license.');
copy(path.join(root,'node_modules/tesseract.js/LICENSE.md'),'LICENSE-core.txt');
for(const name of fs.readdirSync(path.join(root,'node_modules/tesseract.js-core')).filter(name=>/^tesseract-core(?:-(?:relaxedsimd|simd))?(?:-lstm)?\.wasm(?:\.js)?$/.test(name)))copy(path.join(root,'node_modules/tesseract.js-core',name),'core/'+name);
const manifestPath=path.join(target,'manifest.json'),previous=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):null;
for(const language of ['eng','chi_sim']){
 const name='lang/'+language+'.traineddata.gz',output=path.join(target,name);
 const url=`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}@1.0.0/4.0.0_best_int/${language}.traineddata.gz`;
 if(checking){
  const known=previous?.files.find(row=>row.path===name);
  if(!known||!fs.existsSync(output))throw Error('Missing verified OCR language asset: '+name);
  const bytes=fs.readFileSync(output);
  if(known.source!==url||known.bytes!==bytes.length||known.sha256!==sha(bytes))throw Error('OCR language checksum differs: '+name);
  files.push(known);continue;
 }
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Official language download failed: '+language+' HTTP '+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length<1024||bytes.length>24*1024*1024||gunzipSync(bytes,{maxOutputLength:64*1024*1024}).length<1024)throw Error('Invalid OCR language file: '+language);
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);
 files.push({path:name,bytes:bytes.length,sha256:sha(bytes),source:url});
}
const manifest={version,coreVersion,languageVersion:'1.0.0',files};
if(checking){if(JSON.stringify(previous)!==JSON.stringify(manifest))throw Error('OCR asset manifest differs.');}
else fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({checked:checking,version,coreVersion,files:files.length,bytes:files.reduce((sum,row)=>sum+row.bytes,0),runtimeExternalDownloads:false}));
