import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function route(user){
 const exports={};
 const deps={
  'next/server':{NextResponse:Response},
  '@/app/chatgpt-auth':{getChatGPTUser:async()=>typeof user==='function'?user():user},
  '@/app/supplier-hub-company':{approvedSupplierHubCompany:membership=>membership?.company??null},
 };
 const source=fs.readFileSync(new URL('../app/api/supplier-hub/catalog-context/route.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>deps[name]});
 return exports.GET;
}
test('session storage failure remains a private JSON service error, never HTML or a false logout',async()=>{
 const response=await route(()=>{throw Error('private session/database details');})();
 assert.equal(response.status,503);assert.equal(response.headers.get('content-type'),'application/json');
 assert.equal(response.headers.get('cache-control'),'no-store');
 const body=await response.json();assert.equal(body.code,'YOOFAM_CONTEXT_SERVICE_ERROR');assert.doesNotMatch(JSON.stringify(body),/private|database/);
});
test('real authentication and company outcomes keep their separate statuses',async()=>{
 assert.equal((await route(null)()).status,401);
 assert.equal((await route({verifiedAccess:true,userId:'member'})()).status,403);
 const company={code:'A01526306',name:'유앤채'};
 assert.deepEqual(await (await route({verifiedAccess:true,userId:'member',membership:{company}})()).json(),{ownerId:'member',company});
});
