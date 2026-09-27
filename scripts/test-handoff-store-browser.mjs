// A local fixture server only; browser interaction uses the normal Chrome tool.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const pages=new Map([
  ['/',[new URL('../tests/fixtures/handoff-store-browser.html',import.meta.url),'text/html; charset=utf-8']],
  ['/handoff-store.mjs',[new URL('../extensions/supplier-hub/handoff-store.mjs',import.meta.url),'text/javascript; charset=utf-8']],
]);
createServer((request,response)=>{
  const entry=pages.get(request.url);
  if(request.method!=='GET'||!entry){response.writeHead(404);response.end();return;}
  response.writeHead(200,{'content-type':entry[1],'cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'none'"});response.end(readFileSync(entry[0]));
}).listen(4243,'127.0.0.1',()=>console.log('Fixture: http://127.0.0.1:4243/'));
