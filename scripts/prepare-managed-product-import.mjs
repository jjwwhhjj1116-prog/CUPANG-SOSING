import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const repository=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const literal=value=>typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?`'${value.replaceAll("'","''")}'`:(()=>{throw Error('INVALID_BINDING');})();
function render(sql,args){let index=0;const result=sql.replace(/\?/g,()=>literal(args[index++]));if(index!==args.length)throw Error('BINDING_COUNT');return result;}
function modules(db){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(repository,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,TextEncoder,TextDecoder,Uint8Array,DataView,DecompressionStream,crypto,require:name=>{
   if(name==='cloudflare:workers')return {env:{DB:db}};
   if(!name.startsWith('@/'))throw Error('UNEXPECTED_IMPORT');return load(name.slice(2)+'.ts');
  }});return exports;
 }return load;
}

/** Generates local SQL only. Captures the app importer, preserving its original values and idempotent upsert. */
export async function createManagedProductImportPlan(bytes,{ownerId,companyCode,sourceName}){
 if(!(bytes instanceof ArrayBuffer)||typeof ownerId!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(ownerId)
  ||typeof sourceName!=='string'||!sourceName.toLowerCase().endsWith('.xlsx')||sourceName.length>240||/[\\/\u0000-\u001f]/.test(sourceName))throw Error('INVALID_TARGET');
 let schema='',captured;
 const db={prepare(sql){const q={sql,args:[],bind(...args){q.args=args;return q;},async run(){if(!/^CREATE TABLE IF NOT EXISTS managed_products \(/.test(sql))throw Error('UNEXPECTED_WRITE');schema=sql;}};return q;},async batch(queries){if(captured)throw Error('UNEXPECTED_BATCH');captured=queries;return queries.map(()=>({results:[{total:0,added:0,unchanged:0}]}));}};
 const load=modules(db),account=load('app/workspace-members.ts').WORKSPACE_ACCOUNTS.find(account=>account.role==='member'&&account.companyCode===companyCode);
 if(!account)throw Error('INVALID_COMPANY');
 const company={code:account.companyCode,name:account.companyName},source=await load('app/managed-products.ts').parseManagedProductWorkbook(bytes,company);
 await load('db/managed-products.ts').importManagedProducts(ownerId,source,sourceName,false);
 if(!schema||!captured?.length||captured.length%2)throw Error('IMPORT_CONTRACT_CHANGED');
 const guard=`EXISTS(SELECT 1 FROM members WHERE id=${literal(ownerId)} AND lower(trim(email))=${literal(account.email)} AND role='member' AND status='approved' AND company_code=${literal(company.code)} AND company_name=${literal(company.name)})`;
 const previews=[],inserts=[];
 for(let index=0;index<captured.length;index+=2){
  const count=captured[index],insert=captured[index+1];
  if(!count.sql.startsWith('SELECT COUNT(*) AS total,')||!insert.sql.startsWith('INSERT INTO managed_products(')||!insert.sql.includes('FROM json_each(?) WHERE 1\n')||count.args.length!==3||insert.args.length!==7
   ||count.args[0]!==insert.args[6]||count.args[1]!==ownerId||count.args[2]!==company.code||insert.args[0]!==ownerId||insert.args[1]!==company.code)throw Error('IMPORT_CONTRACT_CHANGED');
  const guarded=insert.sql.replace('FROM json_each(?) WHERE 1\n',`FROM json_each(?) WHERE ${guard}\n`);
  const renderInsert=rows=>render(guarded,[...insert.args.slice(0,-1),JSON.stringify(rows)]);
  const append=rows=>{const payload=JSON.stringify(rows),statement=renderInsert(rows);if(Buffer.byteLength(statement)>80000)throw Error('STATEMENT_TOO_LARGE');inserts.push(statement+';');previews.push(`SELECT ${previews.length+1} AS chunk,CASE WHEN ${guard} THEN 1 ELSE 0 END AS authorized,counts.* FROM (${render(count.sql,[payload,ownerId,company.code])}) counts;`);};
  let group=[];
  for(const entry of JSON.parse(insert.args[6])){if(group.length&&Buffer.byteLength(renderInsert([...group,entry]))>80000){append(group);group=[];}group.push(entry);}if(group.length)append(group);
 }
 const banner='-- Private source data. Generated locally; no remote execution. Only managed_products may be written.\n';
 return {
  previewSql:banner+previews.join('\n'),
  importSql:banner+schema+';\n'+inserts.join('\n'),
  verifySql:banner+previews.join('\n'),
  ownerId,company,sourceName,sha256:source.sha256,total:source.rows.length,columns:source.headers.length,chunks:inserts.length,
 };
}

function privateDirectory(){
 const directory=path.join(repository,'outputs',`private-managed-product-import-${crypto.randomUUID()}`);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(process.platform==='win32'){
  const identity=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}),sid=identity.match(/S-1-\d+(?:-\d+)+/u)?.[0];if(!sid)throw Error('PRIVATE_DIRECTORY_FAILED');
  execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{stdio:'pipe',windowsHide:true});
 }return directory;
}
async function main(){
 const [file,ownerId,companyCode,sourceName=path.basename(file??'')]=process.argv.slice(2);
 if(process.argv.length<5||process.argv.length>6||!file||fs.statSync(file).size>5000000)throw Error('INVALID_ARGUMENTS');
 const bytes=fs.readFileSync(file),plan=await createManagedProductImportPlan(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{ownerId,companyCode,sourceName}),directory=privateDirectory();
 for(const [name,sql]of [['preview.sql',plan.previewSql],['import.sql',plan.importSql],['verify.sql',plan.verifySql]])fs.writeFileSync(path.join(directory,name),sql,{flag:'wx',mode:0o600});
 const {previewSql:_,importSql:__,verifySql:___,...summary}=plan;void _;void __;void ___;
 process.stdout.write(JSON.stringify({directory,...summary})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('Product import SQL was not prepared. Check the source XLSX, owner/company and local filesystem permissions.\n');process.exitCode=1;});
