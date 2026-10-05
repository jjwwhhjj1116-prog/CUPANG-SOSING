import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL} from '../../scripts/check-db-schema.mjs';

// Observed list/partial-quote structure; all product values are synthetic.
export function historicalRow(id='261002001001',options=2){
 const cells=Array(15).fill('');cells[1]=id;cells[3]=`시험 상품 ${id}\n옵션 ${options}개\n1688`;cells.splice(5,8,'완료','완료','대기','대기','대기','대기','대기','대기');cells[13]='등록대기';
 return {cells,images:[{alt:'시험',src:'https://cbu01.alicdn.com/img/ibank/test.jpg'}],links:['javascript:void(0)','https://detail.1688.com/offer/813724060928.html']};
}
export function historicalQuote(id='261002001001',optionId=id){return {source:'https://www.couplus.co.kr/AIRocketReg',companyCode:'A01464742',sourceRegistrationId:id,sourceOptionId:optionId,categoryCode:'81222',collectedAt:'2026-10-05T09:49:11.530Z',controls:[{index:0,label:'상품명 *',tag:'INPUT',type:'text',value:'수동 원문 이름'},{index:1,label:'명시 공란',tag:'TEXTAREA',type:'textarea',value:''},{index:2,label:'배터리',tag:'INPUT',type:'checkbox',value:false}]};}
export const historicalDocument=(name,value)=>({name,text:JSON.stringify(value)});
export function historicalHarness({withoutMigration=false}={}){
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())if(!withoutMigration||statement.name!=='historical_ai_records')sqlite.exec(statement.sql);
 const member={id:'unari-history',email:'unari8484@gmail.com',role:'member',status:'approved',companyCode:'A01464742',companyName:'와이홉'};
 sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(member.id,member.email,'test-only',member.role,member.status,member.companyCode,member.companyName,'2026-10-01','2026-10-01');
 const state={user:{userId:member.id,verifiedAccess:true,membership:member},calls:[],beforeBatch:null};
 const db={prepare(sql){let args=[];const q={bind(...values){args=values;return q;},execute(){const results=sqlite.prepare(sql).all(...args);return {results,meta:{changes:sqlite.prepare('SELECT changes() n').get().n}};},async all(){return q.execute();},async first(){return q.execute().results[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(queries){state.beforeBatch?.();sqlite.exec('BEGIN');try{const results=queries.map(q=>q.execute());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Response,Request,File,TextEncoder,TextDecoder,Uint8Array,crypto,require:name=>{
  if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>state.user};
  return load(name.startsWith('@/')?name.slice(2)+'.ts':path.posix.join(path.posix.dirname(file),name)+'.ts');
 }});return exports;}
 const fetcher=async(url,init={})=>{state.calls.push({url,method:init.method??'GET',body:init.body});const request=new Request('https://app.test'+url,{...init,headers:{origin:'https://app.test',...init.headers}}),route=load('app/api/historical-ai-registrations/route.ts');return request.method==='POST'?route.POST(request):route.GET(request);};
 const submit=(documents,{action='preview',sha256,extra={},headers={}}={})=>fetcher('/api/historical-ai-registrations',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({action,documents,...sha256?{expectedSha256:sha256}:{},...extra})});
 return {sqlite,state,load,fetcher,submit,close:()=>sqlite.close()};
}
