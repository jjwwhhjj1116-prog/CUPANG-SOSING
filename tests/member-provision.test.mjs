import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createMemberProvision} from '../scripts/provision-members.mjs';

const admin='357de0ad-3c79-4d81-afac-9c61464e422b';
const fixture=()=>({expectedAdminId:admin,pepper:'test-only-provision-pepper-32-characters',passwords:{'jwhj1116@kakao.com':'test-only-admin-password','unari8484@gmail.com':'test-only-member-password'}});
function helpers(){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/workspace-members.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto,TextEncoder});return exports;}
function database(){const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync('db/migrations/0009_members.sql','utf8'));return db;}
function insert(db,id,email,role,companyCode='A01464742',companyName='와이홉'){
 db.prepare("INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,'approved',?,?,'original-created','original-updated')").run(id,email,'previous-hash',role,companyCode,companyName);
 db.prepare('INSERT INTO member_sessions(token_hash,member_id,expires_at) VALUES(?,?,?)').run(id,id,Date.now()+100000);
}
test('private provision preserves existing IDs, original product ownership and legacy data, resetting only the two assigned accounts',async()=>{
 const db=database();try{
  insert(db,admin,'jwhj1116@kakao.com','admin');insert(db,'existing-member','unari8484@gmail.com','member');insert(db,'legacy','legacy@example.test','member');
  db.exec("CREATE TABLE products(id TEXT PRIMARY KEY,user_id TEXT,source_payload TEXT); INSERT INTO products VALUES('22e079fc-f478-4e18-9002-7e6f2c12b75c','357de0ad-3c79-4d81-afac-9c61464e422b','immutable original company and R2 paths');");
  const product=db.prepare('SELECT * FROM products').get(),legacy=db.prepare("SELECT * FROM members WHERE id='legacy'").get();
  const input=fixture(),plan=await createMemberProvision(input);
  assert.ok(!plan.sql.includes(input.pepper));for(const password of Object.values(input.passwords))assert.ok(!plan.sql.includes(password));
  db.exec(plan.sql);const rows=db.prepare('SELECT * FROM members WHERE id<>? ORDER BY role').all('legacy');
  assert.deepEqual(rows.map(row=>[row.id,row.email,row.role,row.company_code,row.company_name,row.status]),[[admin,'jwhj1116@kakao.com','admin','A01526306','유앤채','approved'],['existing-member','unari8484@gmail.com','member','A01464742','와이홉','approved']]);
  assert.deepEqual(db.prepare('SELECT * FROM products').get(),product);assert.deepEqual(db.prepare("SELECT * FROM members WHERE id='legacy'").get(),legacy);
  assert.deepEqual(db.prepare('SELECT member_id FROM member_sessions').all().map(row=>row.member_id),['legacy']);
  for(const row of rows){assert.equal(row.created_at,'original-created');assert.equal(await helpers().verifyPassword(input.passwords[row.email],row.password_hash,input.pepper),true);}
  assert.equal(db.prepare('SELECT count(*) n FROM member_audit').get().n,2);
  db.exec(plan.sql);assert.equal(db.prepare('SELECT count(*) n FROM members').get().n,3);assert.equal(db.prepare('SELECT count(*) n FROM member_audit').get().n,2);
 }finally{db.close();}
});
test('current one-admin database gains only the designated member; wrong admin identity and unrelated admin are not modified',async()=>{
 for(const mode of ['current','wrong-id','unrelated-admin','fresh']){
  const db=database();try{
   if(mode!=='fresh')insert(db,mode==='wrong-id'?'unexpected-id':admin,mode==='unrelated-admin'?'someone@example.test':'jwhj1116@kakao.com','admin');
   const before=db.prepare('SELECT * FROM members').all(),sessions=db.prepare('SELECT * FROM member_sessions').all();
   const plan=await createMemberProvision({...fixture(),expectedAdminId:mode==='fresh'?null:admin});db.exec(plan.sql);
   if(mode==='current'||mode==='fresh'){
    assert.equal(db.prepare('SELECT count(*) n FROM members').get().n,2);assert.equal(db.prepare("SELECT company_code FROM members WHERE role='admin'").get().company_code,'A01526306');
    assert.equal(db.prepare('SELECT count(*) n FROM member_sessions').get().n,0);
   }else{assert.deepEqual(db.prepare('SELECT * FROM members').all(),before);assert.deepEqual(db.prepare('SELECT * FROM member_sessions').all(),sessions);assert.equal(db.prepare('SELECT count(*) n FROM member_audit').get().n,0);}
  }finally{db.close();}
 }
});
test('provision input permits exactly two fixed passwords and never accepts replacement role or company fields',async()=>{
 for(const input of [{...fixture(),role:'admin'},{...fixture(),expectedAdminId:'unsafe\nvalue'},{...fixture(),passwords:{...fixture().passwords,'third@example.test':'test-only-third-password'}},{...fixture(),passwords:{'jwhj1116@kakao.com':'test-only-admin-password'}},{...fixture(),pepper:'short'}])await assert.rejects(()=>createMemberProvision(input));
});
test('private stdin CLI writes only hashed SQL to an ignored private file and never echoes invalid input',()=>{
 const input=fixture(),child=spawnSync(process.execPath,['scripts/provision-members.mjs'],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout),file=path.resolve(result.file),outputRoot=path.resolve('outputs')+path.sep;
 assert.ok(file.startsWith(outputRoot));assert.match(path.basename(path.dirname(file)),/^private-member-provision-[a-f0-9-]+$/);assert.equal(path.basename(file),'members.sql');
 try{
  const sql=fs.readFileSync(file,'utf8');for(const secret of [input.pepper,...Object.values(input.passwords)]){assert.ok(!sql.includes(secret));assert.ok(!child.stdout.includes(secret));assert.ok(!child.stderr.includes(secret));}
  const db=database();try{insert(db,admin,'jwhj1116@kakao.com','admin');db.exec(sql);assert.equal(db.prepare('SELECT count(*) n FROM members').get().n,2);}finally{db.close();}
 }finally{fs.unlinkSync(file);fs.rmdirSync(path.dirname(file));}
 const invalid=spawnSync(process.execPath,['scripts/provision-members.mjs'],{input:'private-invalid-secret',encoding:'utf8',windowsHide:true});
 assert.equal(invalid.status,1);assert.equal(invalid.stdout,'');assert.ok(!invalid.stderr.includes('private-invalid-secret'));
});
