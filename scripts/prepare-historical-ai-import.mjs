import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const repository=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const literal=value=>typeof value==='number'?String(value):`'${String(value).replaceAll("'","''")}'`;
/** Capture the production parser and DB import SQL without opening any database. */
export async function createHistoricalAiImportSql(owner,documents){
 if(typeof owner!=='string'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(owner))throw Error('INVALID_OWNER');
 const statements=[],ddl=[],db={prepare(sql){let args=[];const query={bind(...values){args=values;return query;},async run(){ddl.push(sql);},get statement(){return{sql,args};}};return query;},async batch(queries){statements.push(...queries.map(query=>query.statement));return[{results:[{added:0,conflicts:0,unlinked:0}]},{meta:{changes:0}}];}};
 const cache=new Map();function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(repository,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,URL,crypto,TextEncoder,Uint8Array,require:name=>{if(name==='cloudflare:workers')return{env:{DB:db}};if(name==='@/app/historical-ai-registrations')return load('app/historical-ai-registrations.ts');throw Error('UNEXPECTED_IMPORT');}});return exports;
 }
 const source=await load('app/historical-ai-registrations.ts').parseHistoricalAiImport(documents);
 await load('db/historical-ai-registrations.ts').importHistoricalAi(owner,source,false);
 if(statements.length!==2||ddl.length!==1)throw Error('IMPORT_CONTRACT_CHANGED');
 const input=JSON.stringify(source.entries),stage=`historical_ai_stage_${crypto.randomUUID().replaceAll('-','')}`;
 const staged=`(SELECT CASE WHEN COUNT(*)=${source.entries.length} THEN json_group_array(json(payload)) ELSE '[]' END FROM (SELECT payload FROM ${stage} ORDER BY seq))`;
 function bound({sql,args}){let index=0;const result=sql.replace(/\?/g,()=>{if(index>=args.length)throw Error('IMPORT_CONTRACT_CHANGED');const arg=args[index++];return arg===input?staged:literal(arg);});if(index!==args.length)throw Error('IMPORT_CONTRACT_CHANGED');return result;}
 const insert=bound(statements[1]),policy=/FROM json_each\([\s\S]*?\) j WHERE (EXISTS\(SELECT 1 FROM members[\s\S]*?\)) AND NOT EXISTS/.exec(insert)?.[1];
 if(!policy||!policy.includes(literal(owner))||!policy.includes("'unari8484@gmail.com'"))throw Error('IMPORT_CONTRACT_CHANGED');
 const chunks=[];let rows=[],size=0;
 const flush=()=>{if(rows.length){chunks.push(`INSERT INTO ${stage}(seq,payload) SELECT column1,column2 FROM (VALUES ${rows.join(',')}) WHERE ${policy} ON CONFLICT(seq) DO NOTHING`);rows=[];size=0;}};
 for(const [index,entry]of source.entries.entries()){
  const row=`(${index},${literal(JSON.stringify(entry))})`,bytes=Buffer.byteLength(row,'utf8');if(bytes>60000)throw Error('ROW_REQUIRES_API_IMPORT');if(size+bytes>60000)flush();rows.push(row);size+=bytes;
 }flush();
 const commands=[...ddl,`CREATE TABLE IF NOT EXISTS ${stage}(seq INTEGER PRIMARY KEY,payload TEXT NOT NULL CHECK(json_valid(payload)))`,...chunks,
  `SELECT ${source.entries.length} AS expected_rows,COUNT(*) AS staged_rows FROM ${stage}`,bound(statements[0]),insert,
  'SELECT changes() AS added',bound(statements[0]),`DROP TABLE ${stage}`];
 if(commands.some(sql=>Buffer.byteLength(sql,'utf8')>90000))throw Error('STATEMENT_TOO_LARGE');
 const sql=`-- Private source records. Generated only; run explicitly against the intended database.\n-- No existing product, option or receipt is changed. Final import uses production all-or-none guards.\n-- If execution is interrupted, rerun this same file to finish idempotently and remove its staging table.\n${commands.join(';\n')};\n`;
 return{sql,summary:{owner,companyCode:'A01464742',registrations:source.entries.filter(entry=>entry.kind==='registration').length,partialQuotations:source.entries.filter(entry=>entry.kind==='quotation').length,reportedOptions:source.entries.reduce((sum,entry)=>sum+entry.optionCount,0),sourceSha256:source.sha256,stagingTable:stage,statements:commands.length,maxStatementBytes:Math.max(...commands.map(command=>Buffer.byteLength(command,'utf8')))}};
}
function privateDirectory(){
 const directory=path.join(repository,'outputs',`private-historical-ai-${crypto.randomUUID()}`);fs.mkdirSync(directory,{mode:0o700});
 if(process.platform==='win32'){
  const result=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}),sid=result.match(/S-1-\d+(?:-\d+)+/u)?.[0];if(!sid)throw Error('PRIVATE_DIRECTORY_FAILED');
  execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{stdio:'pipe',windowsHide:true});
 }return directory;
}
async function main(){
 const [owner,...files]=process.argv.slice(2);if(!files.length||files.length>100)throw Error('INVALID_FILES');
 const outputs=fs.realpathSync(path.join(repository,'outputs')),documents=files.map(file=>{
  const resolved=fs.realpathSync(path.resolve(repository,file)),relative=path.relative(outputs,resolved);if(relative.startsWith('..')||path.isAbsolute(relative)||!relative.endsWith('.json')||fs.statSync(resolved).size>1500000)throw Error('INVALID_FILE');
  return{name:path.basename(resolved),text:fs.readFileSync(resolved,'utf8')};
 });
 const plan=await createHistoricalAiImportSql(owner,documents),file=path.join(privateDirectory(),'historical-ai-import.sql');fs.writeFileSync(file,plan.sql,{flag:'wx',mode:0o600});
 process.stdout.write(JSON.stringify({dryRun:true,file,...plan.summary})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{
 const parserCodes=['INVALID_FORMAT','INPUT_LIMIT','DUPLICATE_KEY','INVALID_OPTION_MARKER'],scriptCodes=['INVALID_OWNER','INVALID_FILES','INVALID_FILE','IMPORT_CONTRACT_CHANGED','ROW_REQUIRES_API_IMPORT','STATEMENT_TOO_LARGE','PRIVATE_DIRECTORY_FAILED'];
 const reason=error?.name==='HistoricalAiInputError'&&parserCodes.includes(error.code)?error.code:scriptCodes.includes(error?.message)?error.message:'FILE_OR_OUTPUT_ERROR';
 process.stderr.write(JSON.stringify({error:'HISTORICAL_IMPORT_NOT_PREPARED',reason,databaseOpened:false})+'\n');process.exitCode=1;
});
