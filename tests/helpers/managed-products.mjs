import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import {memoryDatabase,runtimeDDL} from '../../scripts/check-db-schema.mjs';
import {workbookArchive} from './quotation-workbook.mjs';

// Observed column contract only. All row values below are synthetic.
export const managedHeaders=['상품명','SKUID','바코드','제품분류','발주가능상태','구매링크','옵션1_중국어','옵션2_중국어','판매구성수량','매입단가','공급가액','부가세액','총매입가','썸네일','노출ID','옵션ID','vendorItemId','productId','판매링크','재고','판매가','판매가기준일','공급가','리뷰평점','리뷰수','매입정보','latestImportPrice','구매정보','구매정보여부','winner','productIdHistory','priceHistory','otherSellers','쿠팡마진','쿠팡마진율','마진','마진율','ROI','최소ROAS'];
export function managedFixture(count=3,mutate){
 const rows=Array.from({length:count},(_,index)=>Object.fromEntries(managedHeaders.map(name=>[name,({상품명:`시험 상품 ${index+1}`,SKUID:String(1000000000+index),바코드:'B'+index,발주가능상태:index>=636?'품절':'정상',판매가:'15000',공급가:'8000',판매가기준일:'2026-08-07',winner:index<15?'LOSER':'WINNER',구매정보여부:'0',재고:'0',노출ID:'12345',옵션ID:'98765',마진:'0',판매구성수량:'1'}[name]??'')])));mutate?.(rows);
 const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;'),column=index=>{let result='';for(let n=index+1;n;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;};
 const values=[managedHeaders,...rows.map(row=>managedHeaders.map(name=>row[name]??''))];
 return workbookArchive([
  ['[Content_Types].xml','<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
  ['_rels/.rels','<Relationships><Relationship Id="main" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml','<workbook xmlns:r="relationship"><sheets><sheet name="로켓배송상품DB" r:id="one"/></sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="one" Type="x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
  ['xl/worksheets/sheet1.xml','<worksheet><sheetData>'+values.map((row,index)=>`<row r="${index+1}">`+row.map((value,col)=>`<c r="${column(col)}${index+1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`).join('')+'</row>').join('')+'</sheetData></worksheet>'],
 ]);
}
export function managedProductHarness(){
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const state={user:{userId:'unari-test',verifiedAccess:true,membership:{id:'unari-test',email:'managed-owner@example.test',role:'member',status:'approved',companyCode:'A01464742',companyName:'와이홉'}},calls:[],beforeBatch:null};
 function syncMember(){const member=state.user?.membership;if(member)sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role,status=excluded.status,company_code=excluded.company_code,company_name=excluded.company_name').run(member.id,`managed-${member.id}@example.test`,'test-only',member.role,member.status,member.companyCode,member.companyName,'2026-10-01','2026-10-01');}
 syncMember();
 const db={prepare(sql){let args=[];const q={sql,bind(...values){args=values;return q;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return{results:q.execute()};},async first(){return q.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return q;},async batch(queries){state.beforeBatch?.(queries);sqlite.exec('BEGIN');try{const results=queries.map(q=>({results:q.execute()}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,Response,Request,File,FormData,Blob,DecompressionStream,TextEncoder,TextDecoder,Uint8Array,DataView,crypto,process:{env:{NODE_ENV:'production'}},require:name=>{
  if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='next/server')return{NextResponse:Response};if(name==='@/app/chatgpt-auth')return{getChatGPTUser:async()=>state.user};
  return load(name.startsWith('@/')?name.slice(2)+'.ts':path.posix.join(path.posix.dirname(file),name)+'.ts');
 }});return exports;}
 const fetcher=async(url,init={})=>{state.calls.push({url,method:init.method??'GET'});const request=new Request('https://app.test'+url,init);return url.startsWith('/api/managed-products/import')?load('app/api/managed-products/import/route.ts').POST(request):load('app/api/managed-products/route.ts').GET(request);};
 const submit=async(bytes,{action='preview',companyCode='A01464742',sha256,confirmed=true,accountContext}={})=>{const form=new FormData();form.set('file',new File([bytes],'상품DB.xlsx'));form.set('action',action);form.set('companyCode',companyCode);if(sha256)form.set('expectedSha256',sha256);if(action==='import'){form.set('confirmedCompany',String(confirmed));if(accountContext!==null)form.set('expectedAccountContext',accountContext??await load('app/managed-products.ts').managedProductAccountContext(state.user?.userId??'',{code:state.user?.membership.companyCode??'',name:state.user?.membership.companyName??''}));}return fetcher('/api/managed-products/import',{method:'POST',body:form});};
 return{sqlite,state,load,fetcher,submit,syncMember,close:()=>sqlite.close()};
}
