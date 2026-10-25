import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';
const root=new URL('../',import.meta.url),folder=new URL('extensions/supplier-hub/',root);
const decoder=new TextDecoder('utf-8',{fatal:true});
function packageFiles(directory,prefix=''){
 return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0).flatMap(entry=>{
  if(entry.isDirectory()&&prefix===''&&entry.name==='icons')return packageFiles(new URL('icons/',directory),'icons/');
  if(!entry.isFile()||!/^[A-Za-z0-9._-]+\.(mjs|mts|js|json|html|css|txt|md|svg|png)$/.test(entry.name))throw Error('확장 패키지에 예상하지 않은 파일이 있습니다.');
  const raw=new Uint8Array(fs.readFileSync(new URL(entry.name,directory)));
  return [{name:prefix+entry.name,data:entry.name.endsWith('.png')?raw:new TextEncoder().encode(decoder.decode(raw).replace(/\r\n/g,'\n'))}];
 });
}
const files=packageFiles(folder);
const manifest=JSON.parse(new TextDecoder().decode(files.find(file=>file.name==='manifest.json')?.data));
if(manifest.manifest_version!==3||manifest.background.service_worker!=='handoff-worker.mjs'||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('Chrome 확장 배포 정보를 확인해주세요.');
// Whole-product preview is a separate contract. Never ship an extension that
// advertises it while omitting a runtime dependency or its source verifier.
const productDocumentFiles=['product-document.mjs','product-document.d.mts','product-document-receiver.mjs','product-document-dispatch.mjs','product-document-adapter.mjs','rejection-details.mjs','rejection-details.d.mts','native-registration.mjs','native-registration-page.mjs','native-product-recovery.mjs','native-asset-recovery-page.mjs'];
if([...productDocumentFiles,'product-document-source.mjs','product-source-session.mjs','native-source-content.js'].some(name=>!files.some(file=>file.name===name))||!manifest.content_scripts?.some(entry=>entry.js?.includes('single-content.js')&&entry.js?.includes('native-source-content.js')))
 throw Error('전체 상품 견적 확인 확장의 실행 파일을 확인해주세요.');
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('app/exports/zip.ts',root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Uint8Array,Uint32Array,DataView});
const archive=new Uint8Array(exports.zipFiles(files)),unpacked=readPackageZip(archive);
for(const file of files)if(Buffer.compare(Buffer.from(unpacked.get(file.name)??[]),Buffer.from(file.data)))throw Error('확장 ZIP의 파일이 원본과 다릅니다.');
const target=new URL('public/downloads/yoofam-plus-supplier-hub-extension-'+manifest.version+'.zip',root);
if(process.argv.includes('--check')){if(Buffer.compare(fs.readFileSync(target),archive))throw Error('확장 ZIP을 다시 빌드해주세요.');}
else fs.writeFileSync(target,archive);
console.log(JSON.stringify({version:manifest.version,files:files.length,bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex'),checked:process.argv.includes('--check')}));
