import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {readPackageZip} from '../extensions/supplier-hub/package.mjs';

const root=new URL('../',import.meta.url),directory=new URL('cli/',root);
const permitted=['README.md','package.json','server.mjs','yoofam-studio.mjs'];
const actual=fs.readdirSync(directory).sort();
if(JSON.stringify(actual)!==JSON.stringify([...permitted].sort()))throw Error('CLI 배포 대상 파일을 확인해주세요.');
const files=permitted.map(name=>({name:'cli/'+name,data:new TextEncoder().encode(fs.readFileSync(new URL(name,directory),'utf8').replace(/\r\n/g,'\n'))}));
const pkg=JSON.parse(new TextDecoder().decode(files.find(file=>file.name.endsWith('/package.json')).data));
if(pkg.name!=='@yoofam/studio-cli'||!/^\d+\.\d+\.\d+$/.test(pkg.version)||pkg.bin?.['yoofam-studio']!=='./yoofam-studio.mjs')throw Error('CLI 배포 정보를 확인해주세요.');
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('app/exports/zip.ts',root),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Uint8Array,Uint32Array,DataView});
const archive=new Uint8Array(exports.zipFiles(files)),unpacked=readPackageZip(archive);
if(unpacked.size!==files.length||files.some(file=>Buffer.compare(Buffer.from(file.data),Buffer.from(unpacked.get(file.name)??[]))))throw Error('CLI ZIP의 내용이 원본과 다릅니다.');
const target=new URL('public/downloads/yoofam-studio-cli-'+pkg.version+'.zip',root);
if(process.argv.includes('--check')){if(Buffer.compare(fs.readFileSync(target),archive))throw Error('CLI ZIP을 다시 만들어주세요.');}
else fs.writeFileSync(target,archive);
console.log(JSON.stringify({version:pkg.version,files:files.length,bytes:archive.length,sha256:createHash('sha256').update(archive).digest('hex'),checked:process.argv.includes('--check')}));
