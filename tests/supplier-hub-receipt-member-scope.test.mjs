import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {pathToFileURL} from 'node:url';

// Reuse the existing actual API/SQLite/recorded-source fixture, without running
// its test registrations or changing its mocked authentication globally.
const fixtureFile='tests/supplier-hub-receipts.test.mjs';
const fixtureSource=fs.readFileSync(new URL('./supplier-hub-receipts.test.mjs',import.meta.url),'utf8');
const ast=ts.createSourceFile(fixtureFile,fixtureSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const neededImports=['node:assert/strict','node:crypto','./helpers/mobile-intake.mjs','./helpers/quotation-workbook.mjs'];
const selected=ast.statements.filter(node=>ts.isImportDeclaration(node)&&neededImports.includes(node.moduleSpecifier.text)
 ||ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>['json','companies'].includes(d.name.getText(ast)))
 ||ts.isFunctionDeclaration(node)&&node.name?.text==='setup');
const fixtureModule=selected.map(node=>node.getFullText(ast)).join('\n').replace(/from '([.][^']+)'/g,
 (_match,relative)=>"from '"+new URL(relative,pathToFileURL(process.cwd()+'/'+fixtureFile)).href+"'")+'\nexport {setup,companies};';
const {setup,companies}=await import('data:text/javascript,'+encodeURIComponent(fixtureModule));
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};

export async function receiptMemberScopeFixture(company=companies[0]){
 const h=await setup(company),controls={beforeFirst:null,afterFirst:null},queries=[],writes=[],authReads=[];
 const email=company.companyCode==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',role=company.companyCode==='A01526306'?'admin':'member';
 const now=new Date().toISOString(),cookie='yoofam_session='+'a'.repeat(64),members=h.load('db/members.ts'),nativeMembers=h.load('app/workspace-members.ts');
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('owner',email,'synthetic-unused-password-hash',role,'approved',company.companyCode,company.companyName,now,now);
 h.sqlite.prepare('INSERT INTO member_sessions(token_hash,member_id,expires_at) VALUES(?,?,?)')
  .run(await nativeMembers.tokenHash('a'.repeat(64)),'owner',Date.now()+60_000);
 h.bindings.YOOFAM_AUTH_ENABLED='true';
 const member=()=>h.sqlite.prepare('SELECT * FROM members WHERE id=?').get('owner');
 const user=async()=>{const membership=await members.sessionMember(cookie);authReads.push(membership?JSON.parse(JSON.stringify(membership)):null);return membership?{userId:membership.id,email:membership.email,verifiedAccess:true,membership}:null;};
 const auth={getChatGPTUser:user,getWorkspaceOwnerId:async()=>{const value=await user();assert.ok(value,'actual session must exist at request ownership read');return value.userId;}};
 const prepare=h.db.prepare;
 h.db.prepare=function(sql){const q=prepare.call(this,sql),first=q.first;queries.push(sql);q.first=async function(...args){controls.beforeFirst?.(sql);const value=await first.apply(this,args);if(/^(?:INSERT INTO|UPDATE) supplier_hub_receipts\b/.test(sql)&&value)writes.push({sql,result:value});controls.afterFirst?.(sql,value);return value;};return q;};
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../app/api/products/[id]/supplier-hub-receipt/route.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports,Error,URL,Date,process:{env:{NODE_ENV:'production'}},require(name){if(name==='next/server')return {NextResponse:Response};if(name==='cloudflare:workers')return {env:h.bindings};if(name==='@/app/chatgpt-auth')return auth;assert.ok(name.startsWith('@/'),name);return h.load(name.slice(2)+'.ts');}});
 const request=(body,method='POST',query='')=>exports[method](new Request('https://app.test'+h.base+'/supplier-hub-receipt'+query,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({id:h.product.id})});
 const tables=['products','product_content','product_options','product_price_policy','product_quotation_fields','collection_jobs','collection_context','collection_results','collection_images','category_profiles','workspace_settings'];
 const retained=()=>JSON.stringify({rows:tables.map(table=>h.sqlite.prepare('SELECT * FROM '+table).all()),objects:[...h.objects].map(([key,bytes])=>[key,Buffer.from(bytes).toString('base64')])});
 const receiptPayload=()=>h.sqlite.prepare('SELECT payload FROM supplier_hub_receipts').get()?.payload??null;
 const authorization=()=>{const value=member();return {id:value.id,email:value.email,role:value.role,companyCode:value.company_code,companyName:value.company_name};};
 const change=kind=>{if(kind==='status')h.sqlite.prepare("UPDATE members SET status='suspended' WHERE id='owner'").run();
  else if(kind==='company'){const other=companies.find(value=>value.companyCode!==company.companyCode);h.sqlite.prepare('UPDATE members SET company_code=?,company_name=? WHERE id=?').run(other.companyCode,other.companyName,'owner');}
  else if(kind==='email')h.sqlite.prepare("UPDATE members SET email='changed@example.test' WHERE id='owner'").run();
  else if(kind==='role')h.sqlite.prepare('UPDATE members SET role=? WHERE id=?').run(role==='admin'?'member':'admin','owner');
  else if(kind==='name')h.sqlite.prepare("UPDATE members SET company_name='다른 이름' WHERE id='owner'").run();
  else throw Error('Unknown member mutation '+kind);};
 const during=(prefix,kind)=>{controls.beforeFirst=sql=>{if(!sql.startsWith(prefix))return;controls.beforeFirst=null;change(kind);};};
 const historyBody=(result=h.result)=>({...h.payload(result),action:'observe-history'});
 return {...h,controls,queries,writes,authReads,request,member,authorization,change,during,retained,receiptPayload,historyBody,restoreMember(){h.sqlite.prepare('UPDATE members SET email=?,role=?,status=?,company_code=?,company_name=? WHERE id=?').run(email,role,'approved',company.companyCode,company.companyName,'owner');}};
}

for(const company of companies){
 test(`actual approved session stores and refreshes its exact receipt while all draft inputs stay unchanged (${company.companyCode})`,async()=>{
  const h=await receiptMemberScopeFixture(company);try{const before=h.retained();assert.equal(await json(await h.request(h.payload(h.result))).then(value=>value.saved),true);assert.equal(h.writes.length,1);assert.equal(JSON.parse(h.receiptPayload()).result.company.code,company.companyCode);
   const duplicate=h.receiptPayload();await json(await h.request(h.payload(h.result)));assert.equal(h.writes.length,1);assert.equal(h.receiptPayload(),duplicate);
   const refreshed={...h.result,observedAt:h.result.observedAt+10,registration:{...h.registration,observedAt:h.registration.observedAt+10}};await json(await h.request(h.historyBody(refreshed)));assert.equal(h.writes.length,2);assert.equal(JSON.parse(h.receiptPayload()).result.registration.rows.length,6);
   await json(await h.request(undefined,'GET','?mode=history'));await json(await h.request(undefined,'GET','?fingerprint='+h.preview.fingerprint));assert.equal(h.retained(),before);assert.ok(h.authReads.every(value=>value?.id==='owner'&&value.status==='approved'&&value.companyCode===company.companyCode));assert.ok(!h.network.includes('supplier.coupang.com'));
  }finally{h.close();}
 });
 for(const kind of ['status','company','name','email','role'])test(`atomic receipt insert rejects a real member ${kind} change after identity review (${company.companyCode})`,async()=>{
  const h=await receiptMemberScopeFixture(company);try{const before=h.retained();h.during('INSERT INTO supplier_hub_receipts',kind);await json(await h.request(h.payload(h.result)),409);assert.equal(h.writes.length,0);assert.equal(h.receiptPayload(),null);assert.equal(h.retained(),before);assert.ok(h.authReads.length>=3);assert.ok(!h.network.includes('supplier.coupang.com'));
  }finally{h.close();}
 });
 test(`equal existing observation cannot claim success from a fallback SELECT after member suspension (${company.companyCode})`,async()=>{
  const h=await receiptMemberScopeFixture(company);try{await json(await h.request(h.payload(h.result)));const old=h.receiptPayload(),before=h.retained();h.during('SELECT p.id FROM products p WHERE','status');
   // The source guards also use this prefix; wait for the receipt existence
   // query rather than suspending before the endpoint's identity review.
   h.controls.beforeFirst=sql=>{if(!sql.includes('AND EXISTS(SELECT 1 FROM supplier_hub_receipts r'))return;h.controls.beforeFirst=null;h.change('status');};
   await json(await h.request(h.payload(h.result)),409);assert.equal(h.writes.length,1);assert.equal(h.receiptPayload(),old);assert.equal(h.retained(),before);
  }finally{h.close();}
 });
 test(`historical receipt update rejects changed real member company and preserves the original receipt (${company.companyCode})`,async()=>{
  const h=await receiptMemberScopeFixture(company);try{await json(await h.request(h.payload(h.result)));const old=h.receiptPayload(),before=h.retained();h.during('UPDATE supplier_hub_receipts SET','company');await json(await h.request(h.historyBody({...h.result,observedAt:h.result.observedAt+20})),409);assert.equal(h.writes.length,1);assert.equal(h.receiptPayload(),old);assert.equal(h.retained(),before);h.restoreMember();const historical=await json(await h.request(undefined,'GET','?mode=history'));assert.equal(historical.history.receipts[0].result.company.code,company.companyCode);
  }finally{h.close();}
 });
 test(`historical repeated observation cannot pass its fallback after real member suspension (${company.companyCode})`,async()=>{
  const h=await receiptMemberScopeFixture(company);try{await json(await h.request(h.payload(h.result)));const old=h.receiptPayload(),before=h.retained();h.during('SELECT p.id FROM products p JOIN supplier_hub_receipts','status');await json(await h.request(h.historyBody()),409);assert.equal(h.writes.length,1);assert.equal(h.receiptPayload(),old);assert.equal(h.retained(),before);
  }finally{h.close();}
 });
 test(`direct native-auth saves cannot omit or substitute the exact member-company authorization (${company.companyCode})`,async()=>{
  const h=await receiptMemberScopeFixture(company);try{const source=await h.load('app/exports/quotation-source.ts').readMappedQuotationSource('owner',h.product.id,'cat'),db=h.load('db/supplier-hub-receipts.ts'),receipt={schemaVersion:1,evidence:'chrome-observation',profileId:'cat',categoryId:'80719',fingerprint:h.preview.fingerprint,productVersion:h.product.updated_at,recordedAt:new Date().toISOString(),result:h.result};
   for(const authorization of [undefined,{...h.authorization(),id:'another-owner'},{...h.authorization(),companyCode:'foreign'},{...h.authorization(),companyName:'foreign'}])assert.equal(await db.saveSupplierHubReceipt('owner',h.product.id,receipt,source.source,source.state.revision,authorization),false);assert.equal(h.writes.length,0);assert.equal(h.receiptPayload(),null);
  }finally{h.close();}
 });
}
