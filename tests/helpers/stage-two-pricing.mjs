import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {memoryDatabase,runtimeDDL} from '../../scripts/check-db-schema.mjs';
const native=createRequire(import.meta.url);
export const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
export const plain=value=>JSON.parse(JSON.stringify(value));
export const json=async(response,status=200)=>{if(response.status!==status)throw Error('Expected '+status+', got '+response.status+': '+await response.text());return response.json();};
export async function stageTwoFixture(company=companies[0]){
 const sqlite=memoryDatabase();for(const statement of runtimeDDL())sqlite.exec(statement.sql);
 const owner='stage-two-owner-'+company.code,id='stage-two-product-'+company.code,cache=new Map();let verified=true,beforeBatch,fault,batches=0;
 const email=company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com',role=company.code==='A01526306'?'admin':'member';
 const db={prepare(sql){let args=[];const statement={sql,bind(...values){args=values;return statement;},execute(){return sqlite.prepare(sql).all(...args);},async all(){return{results:statement.execute()};},async first(){return statement.execute()[0]??null;},async run(){return sqlite.prepare(sql).run(...args);}};return statement;},
 async batch(statements){const atomic=statements.length===7&&statements[0].sql.includes('INSERT INTO product_options');if(atomic){batches++;const callback=beforeBatch;beforeBatch=undefined;callback?.();}
 sqlite.exec('BEGIN');try{const values=statements.map((statement,index)=>{if(atomic&&index===fault)throw Error('injected atomic companion '+index);return{results:statement.execute()};});sqlite.exec('COMMIT');return values;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 const bindings={DB:db,YOOFAM_AUTH_ENABLED:'true'},deps={'cloudflare:workers':{env:bindings},'next/server':{NextResponse:Response},'@/db/collection-images':{readOptionSourceImages:async()=>({})},
 '@/app/chatgpt-auth':{getWorkspaceOwnerId:async()=>owner,getChatGPTUser:async()=>({verifiedAccess:verified,userId:owner,email,membership:{id:owner,email,role,status:'approved',companyCode:company.code,companyName:company.name}})}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,
 {exports,Error,RangeError,Date,URL,URLSearchParams,Response,Request,Headers,Blob,TextEncoder,TextDecoder,Uint8Array,DataView,structuredClone,crypto:webcrypto,process:{env:{NODE_ENV:'production'}},fetch:async()=>{throw Error('External requests prohibited');},require(name){if(name in deps)return deps[name];if(name.startsWith('@/'))return load(name.slice(2)+'.ts');if(name.startsWith('./')||name.startsWith('../'))return load(path.posix.join(path.posix.dirname(file),name)+'.ts');return native(name);}},{filename:file});return exports;}
 const version='2026-10-20T00:00:00.000Z',policy={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest',arithmeticMode:'couplus-number-v1',recalculationMode:'couplus-stage-two-v1',recalculationMinimumEnabled:true};
 sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(owner,email,'synthetic-never-login',role,'approved',company.code,company.name,version,version);
 const calculation=load('app/pricing.ts').calculatePrice(2.99,policy),product={id,owner_id:owner,source_url:'https://detail.1688.com/offer/761000000001.html',title:'LOCAL ATOMIC STAGE TWO',source_price_cny:2.99,exchange_rate:350,supply_margin:50,coupang_margin:40,supply_price:calculation.supplyPrice,sale_price:calculation.salePrice,msrp:calculation.msrp,options_count:2,seo_status:'대기',image_status:'대기',quote_status:'대기',registration_status:'수집완료',supplier_hub_status:'미전송',image_keys:'[]',goal_stage:'price',created_at:version,updated_at:version};
 await load('db/queries.ts').insertProduct(product,policy);
 const model=load('app/product-options.ts'),rows=['row-a','row-b','row-excluded'].map((id,index)=>({...model.emptyOptionInput(id),originalName:'原始选项 '+index,translatedName:'합성 옵션 '+index,supplierSku:'synthetic-sku-'+index,unitCostCny:2.99,unitsPerPack:index===2?7:1,minimumOrderQuantity:2,stock:29,included:index<2,packagedWeightG:200,packagedWidthMm:10,packagedLengthMm:20,packagedHeightMm:30,packagingConfirmed:true}));
 await load('db/product-options.ts').saveProductOptions(owner,model.applyOptionRows(model.emptyProductOptions(id),rows,version),0,version);
 const context={params:Promise.resolve({id})},base='https://app.test/api/products/'+id+'/stage-two-pricing';
 const get=(suffix='')=>load('app/api/products/[id]/stage-two-pricing/route.ts').GET(new Request(base+suffix),context);
 const post=(body,suffix='',headers={})=>load('app/api/products/[id]/stage-two-pricing/route.ts').POST(new Request(base+suffix,{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test',...headers},body:typeof body==='string'?body:JSON.stringify(body)}),context);
 const body=receipt=>({expectedProductVersion:receipt.product.updated_at,expectedOptionRevision:receipt.options.options.revision,expectedQuotationRevision:receipt.quotation.revision,expectedInputFingerprint:receipt.quotation.inputFingerprint,policy:receipt.options.pricing.policy,rows:model.optionInputs(receipt.options.options),changes:[],recalculate:false});
 const snapshot=()=>JSON.stringify(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
 return{sqlite,bindings,load,id,owner,product,policy,company,email,role,get,post,body,snapshot,before(callback){beforeBatch=callback;},fault(value){fault=value;},verified(value){verified=value;},get batches(){return batches;},close(){sqlite.close();}};
}
