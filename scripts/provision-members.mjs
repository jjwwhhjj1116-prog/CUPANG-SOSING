import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

const repository=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
function memberHelpers(){
 const exports={};
 const source=fs.readFileSync(path.join(repository,'app/workspace-members.ts'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto,TextEncoder});
 return exports;
}
const literal=value=>`'${String(value).replaceAll("'","''")}'`;

/** Only hashes enter the SQL; existing email identities keep their primary keys. */
export async function createMemberProvision(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='expectedAdminId,passwords,pepper')throw Error('INVALID_INPUT');
 const {WORKSPACE_ACCOUNTS:accounts,passwordHash}=memberHelpers();
 if(typeof input.pepper!=='string'||input.pepper.length<32||input.pepper.length>4096)throw Error('INVALID_PEPPER');
 if(input.expectedAdminId!==null&&(typeof input.expectedAdminId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.expectedAdminId)))throw Error('INVALID_ADMIN_ID');
 if(!input.passwords||typeof input.passwords!=='object'||Array.isArray(input.passwords)||Object.keys(input.passwords).sort().join(',')!==accounts.map(account=>account.email).sort().join(','))throw Error('INVALID_ACCOUNTS');
 const now=new Date().toISOString(),rows=[];
 for(const account of accounts){
  const hash=await passwordHash(input.passwords[account.email],input.pepper);
  rows.push({...account,id:account.role==='admin'&&input.expectedAdminId?input.expectedAdminId:crypto.randomUUID(),hash});
 }
 const admin=rows.find(row=>row.role==='admin'),emails=rows.map(row=>literal(row.email)).join(',');
 const guard=input.expectedAdminId===null
  ?`NOT EXISTS(SELECT 1 FROM members WHERE role='admin' OR lower(trim(email)) IN (${emails}))`
  :`EXISTS(SELECT 1 FROM members WHERE id=${literal(input.expectedAdminId)} AND email=${literal(admin.email)} COLLATE NOCASE AND role='admin') AND NOT EXISTS(SELECT 1 FROM members WHERE role='admin' AND id<>${literal(input.expectedAdminId)})`;
 const installed=rows.map(row=>`EXISTS(SELECT 1 FROM members WHERE email=${literal(row.email)} COLLATE NOCASE AND password_hash=${literal(row.hash)} AND role=${literal(row.role)} AND status='approved' AND company_code=${literal(row.companyCode)} AND company_name=${literal(row.companyName)})`).join(' AND ');
 const selectRows=rows.map(row=>`SELECT ${[row.id,row.email,row.hash,row.role,'approved',row.companyCode,row.companyName,now,now,'fixed-account-provision'].map(literal).join(',')} WHERE ${guard}`).join('\nUNION ALL\n');
 const sql=[
  '-- Private credential hashes. Apply once after the fixed-account app policy is deployed; remove this file after verification.',
  '-- No product, collection, image, quotation or settings ownership is changed.',
  `DELETE FROM member_sessions WHERE member_id IN (SELECT id FROM members WHERE lower(trim(email)) IN (${emails})) AND (${guard});`,
  `INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at,reviewed_by)\n${selectRows}\nON CONFLICT(email) DO UPDATE SET email=excluded.email,password_hash=excluded.password_hash,role=excluded.role,status=excluded.status,company_code=excluded.company_code,company_name=excluded.company_name,updated_at=excluded.updated_at,reviewed_by=excluded.reviewed_by;`,
  `DELETE FROM member_sessions WHERE member_id IN (SELECT id FROM members WHERE lower(trim(email)) IN (${emails})) AND (${installed});`,
  ...rows.map(row=>`INSERT OR IGNORE INTO member_audit(id,actor_id,member_id,action,created_at) SELECT ${literal(crypto.randomUUID())},${literal(admin.id)},id,'fixed-account-provision',${literal(now)} FROM members WHERE email=${literal(row.email)} COLLATE NOCASE AND (${installed});`),
  `SELECT id,email,role,status,company_code AS companyCode,company_name AS companyName,CASE WHEN (${installed}) THEN 1 ELSE 0 END AS provisioned FROM members WHERE lower(trim(email)) IN (${emails}) ORDER BY role;`,
 ].join('\n');
 return {sql,accounts:accounts.map(account=>({...account})),expectedAdminId:input.expectedAdminId};
}

async function readPrivateInput(){
 if(process.stdin.isTTY)throw Error('PRIVATE_STDIN_REQUIRED');
 const chunks=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;if(size>8192)throw Error('INPUT_TOO_LARGE');chunks.push(chunk);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function privateDirectory(){
 const directory=path.join(repository,'outputs',`private-member-provision-${crypto.randomUUID()}`);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 if(process.platform==='win32'){
  const identity=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});
  const sid=identity.match(/S-1-\d+(?:-\d+)+/u)?.[0];if(!sid)throw Error('PRIVATE_DIRECTORY_FAILED');
  execFileSync('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`],{stdio:'pipe',windowsHide:true});
 }
 return directory;
}
async function main(){
 if(process.argv.length!==2)throw Error('PRIVATE_STDIN_REQUIRED');
 const plan=await createMemberProvision(await readPrivateInput());
 const file=path.join(privateDirectory(),'members.sql');
 fs.writeFileSync(file,plan.sql,{flag:'wx',mode:0o600});
 // Never print input, hashes, SQL, or errors carrying user-controlled text.
 process.stdout.write(JSON.stringify({file,accounts:plan.accounts,expectedAdminId:plan.expectedAdminId})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{process.stderr.write('Account provisioning was not prepared. Check the private input and filesystem permissions.\n');process.exitCode=1;});
}
