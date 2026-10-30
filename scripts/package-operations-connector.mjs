import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';

const root=new URL('../',import.meta.url),folder=new URL('extensions/operations-connector/',root),encoder=new TextEncoder();
const files=fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(entry=>{
 if(!entry.isFile()||!/^[A-Za-z][A-Za-z0-9.-]*\.(?:mjs|js|json|html|md)$/.test(entry.name))throw Error('운영 연결 확장 폴더의 파일 구성을 확인해주세요.');
 return {name:entry.name,data:encoder.encode(fs.readFileSync(new URL(entry.name,folder),'utf8').replace(/\r\n/g,'\n'))};
});
const manifest=JSON.parse(new TextDecoder().decode(files.find(file=>file.name==='manifest.json')?.data));
if(manifest.manifest_version!==3||manifest.background?.service_worker!=='worker.mjs'||manifest.permissions?.includes('cookies'))throw Error('최소 권한의 운영 연결 확장 구성을 확인해주세요.');
for(const name of ['worker.mjs','page.mjs','protocol.mjs','normalizers.mjs','content.js','popup.html','confirmation.html','confirmation.js','approval.mjs','README.md'])if(!files.some(file=>file.name===name))throw Error(`운영 연결 확장 파일이 없습니다: ${name}`);
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('app/exports/zip.ts',root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Uint8Array,Uint32Array,DataView});
const archive=new Uint8Array(exports.zipFiles(files)),unpacked=readPackageZip(archive);
for(const file of files)if(Buffer.compare(Buffer.from(file.data),Buffer.from(unpacked.get(file.name)??[])))throw Error('ZIP 파일이 운영 연결 확장 원본과 다릅니다.');
const target=new URL('public/downloads/yoofam-operations-connector.zip',root);
if(process.argv.includes('--check')){if(!fs.existsSync(target)||Buffer.compare(Buffer.from(archive),fs.readFileSync(target)))throw Error('운영 연결 확장 패키지를 다시 생성해주세요.');}
else fs.writeFileSync(target,archive);
console.log(JSON.stringify({version:manifest.version,files:files.length,bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex'),checked:process.argv.includes('--check')}));
