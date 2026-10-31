// Local synthetic fixture only. Not copied into public/ or deployed.
import {createServer} from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const root=path.resolve(import.meta.dirname,'..');
const built=await build({entryPoints:[path.join(root,'tests/fixtures/free-image-inpaint-browser.ts')],bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
const files=new Map([
 ['/',{type:'text/html; charset=utf-8',bytes:fs.readFileSync(path.join(root,'tests/fixtures/free-image-inpaint-browser.html'))}],
 ['/fixture.js',{type:'text/javascript; charset=utf-8',bytes:built.outputFiles[0].contents}],
 ['/fixture.css',{type:'text/css',bytes:Buffer.from('body{font:16px sans-serif;margin:28px}main{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0}canvas{border:1px solid #aaa}pre{white-space:pre-wrap;max-width:1040px}button{padding:12px}')}],
]);
for(const name of ['inpaint-worker.js','opencv.js'])files.set('/inpaint/5.0.0-release.1/'+name,{type:'text/javascript; charset=utf-8',bytes:fs.readFileSync(path.join(root,'public/inpaint/5.0.0-release.1',name))});
createServer((request,response)=>{
 const file=files.get(request.url);if(request.method!=='GET'||!file){response.writeHead(404);response.end();return;}
 response.writeHead(200,{'content-type':file.type,'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(file.bytes);
}).listen(4244,'127.0.0.1',()=>console.log('Synthetic inpaint fixture: http://127.0.0.1:4244/'));
