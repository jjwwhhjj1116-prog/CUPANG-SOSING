import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..'),version='5.0.0-release.1',target=path.join(root,'public/inpaint',version);
const checking=process.argv.length===3&&process.argv[2]==='--check';
if(process.argv.length>3||process.argv.length===3&&!checking)throw Error('Use node scripts/package-free-inpaint.mjs [--check]');
const packageRoot=path.join(root,'node_modules/@techstark/opencv-js'),pkg=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
if(pkg.version!==version||pkg.license!=='Apache-2.0')throw Error('Review the pinned OpenCV package version/license.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),files=[];
function write(name,bytes){
 if(bytes.length>25*1024*1024)throw Error('Cloudflare asset exceeds 25 MiB: '+name);
 const output=path.join(target,name);
 if(checking){if(!fs.existsSync(output)||sha(fs.readFileSync(output))!==sha(bytes))throw Error('Inpaint asset differs: '+name);}
 else{fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,bytes);}
 files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
}
const runtime=fs.readFileSync(path.join(packageRoot,'dist/opencv.js'));
// Exact published npm artifact, including embedded WASM. No runtime CDN/fetch.
if(sha(runtime)!=='b873c8211421da7b9bf41ae157a923f05a46a0b8d3e5904c44c6f3ad6d39a1bd')throw Error('Pinned OpenCV runtime checksum differs.');
write('opencv.js',runtime);
write('licenses/LICENSE-opencv-js.txt',fs.readFileSync(path.join(packageRoot,'LICENSE')));
const worker=await build({entryPoints:[path.join(root,'app/free-image-inpaint-worker.ts')],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
write('inpaint-worker.js',worker.outputFiles[0].contents);
const manifest={package:pkg.name,version,license:pkg.license,source:`https://registry.npmjs.org/@techstark/opencv-js/-/opencv-js-${version}.tgz`,algorithm:'OpenCV photo.inpaint / INPAINT_TELEA / radius 3',runtimeExternalDownloads:false,files};
const manifestPath=path.join(target,'manifest.json'),serialized=JSON.stringify(manifest,null,2)+'\n';
if(checking){if(fs.readFileSync(manifestPath,'utf8')!==serialized)throw Error('Inpaint manifest differs.');}else fs.writeFileSync(manifestPath,serialized);
console.log(JSON.stringify({checked:checking,version,files:files.length,bytes:files.reduce((sum,row)=>sum+row.bytes,0),runtimeExternalDownloads:false}));
