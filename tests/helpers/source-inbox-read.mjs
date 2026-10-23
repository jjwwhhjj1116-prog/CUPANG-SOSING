import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webcrypto} from 'node:crypto';
import {memoryDatabase} from '../../scripts/check-db-schema.mjs';
import * as pageSource from '../../extensions/supplier-hub/page-source.mjs';

export const inboxReadCompany={code:'A01464742',name:'와이홉'};
export const inboxReadId=index=>'80600000-0000-4000-8000-'+String(index).padStart(12,'0');
export function inboxReadSnapshot(index=1,{optionCount=4,imageCount=8,description='합성 수집 원문'}={}){
 return {format:'yoofam-page-source-v1',sourceUrl:'https://detail.1688.com/offer/806000000001.html',offerId:'806000000001',collectedAt:`2026-10-22T00:00:${String(index%60).padStart(2,'0')}.000Z`,title:'합성 상품 '+index,description,
  options:Array.from({length:optionCount},(_,i)=>({key:'option-'+i,name:'합성 옵션 '+i,supplierSku:'sku-'+i,unitPriceCny:3,currency:'CNY',minimumOrder:null,stock:1,imageUrl:`https://cbu01.alicdn.com/synthetic-806-${i%imageCount}.jpg`})),
  images:Array.from({length:imageCount},(_,i)=>({url:`https://cbu01.alicdn.com/synthetic-806-${i}.jpg`,role:i?'additional':'main'})),attributes:[]};
}

/** Synthetic SQLite only. This harness has no network/browser/production DB. */
export function sourceInboxReadHarness({sources={}}={}){
 const sqlite=memoryDatabase(),cache=new Map(),stats={validations:0};let owner='owner',company=inboxReadCompany;
 const DB={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async all(){return{results:sqlite.prepare(sql).all(...args)};},async first(){return sqlite.prepare(sql).get(...args)??null;},async run(){return sqlite.prepare(sql).run(...args);}};return query;}};
 const deps={'cloudflare:workers':{env:{DB}},'@/extensions/supplier-hub/page-source.mjs':{...pageSource,validatePageSource(...args){stats.validations++;return pageSource.validatePageSource(...args);}},'@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=>owner,getChatGPTUser:async()=>({verifiedAccess:true,membership:{status:'approved',companyCode:company.code,companyName:company.name}})}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(sources[file]??fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports,URL,Date,Error,Response,TextEncoder,Uint8Array,crypto:webcrypto,fetch(){throw Error('network forbidden in inbox read fixture');},require(name){if(name in deps)return deps[name];if(!name.startsWith('@/'))throw Error(name);return load(name.slice(2)+'.ts');}},{filename:file});return exports;
 }
 const db=load('db/source-inbox.ts');sqlite.exec(db.sourceInboxSchema);sqlite.exec(db.sourceInboxCaptureSchema);
 const api=load('app/api/source-inbox/route.ts');
 function seed(index,snapshot=inboxReadSnapshot(index),{ownerId='owner',capturedCompany=inboxReadCompany,archivedAt=null,reviewed=null,originId=inboxReadId(1)}={}){
  const id=inboxReadId(index),payload=JSON.stringify(pageSource.validatePageSource(snapshot)),review=reviewed?JSON.stringify(pageSource.validatePageSource(reviewed)):null,receivedAt=new Date(Date.UTC(2026,9,22,0,0,index)).toISOString();
  if(index===1||originId===id)sqlite.prepare('INSERT INTO source_inbox(owner_id,id,company_code,company_name,offer_id,fingerprint,payload,review_payload,received_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(ownerId,id,capturedCompany.code,capturedCompany.name,snapshot.offerId,'a'.repeat(64),payload,review,receivedAt,archivedAt);
  else sqlite.prepare('INSERT INTO source_inbox_captures(owner_id,id,origin_id,company_code,company_name,offer_id,fingerprint,payload,review_payload,capture_version,received_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(ownerId,id,originId,capturedCompany.code,capturedCompany.name,snapshot.offerId,index.toString(16).padStart(64,'0'),payload,review,index,receivedAt,archivedAt);
  return id;
 }
 return{sqlite,db,api,stats,seed,load,scope(nextOwner,nextCompany=inboxReadCompany){owner=nextOwner;company=nextCompany;},close(){sqlite.close();}};
}
