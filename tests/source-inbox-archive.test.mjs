import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const sourceUrl='https://detail.1688.com/offer/700000000973.html';
const request=body=>new Request('https://app.test/api/source-inbox',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const snapshot=n=>({format:'yoofam-page-source-v1',sourceUrl,offerId:'700000000973',collectedAt:new Date(Date.now()-60000+n).toISOString(),title:'합성 보존 상품 '+n,description:'원문 보존',
 options:[{key:'black',name:'검정',supplierSku:'synthetic-'+n,unitPriceCny:5,currency:'CNY',minimumOrder:1,stock:3,imageUrl:'https://cbu01.alicdn.com/synthetic.jpg'}],images:[{url:'https://cbu01.alicdn.com/synthetic.jpg',role:'main'}],attributes:[]});
function harness(company=companies[1]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),api=h.load('app/api/source-inbox/route.ts'),db=h.load('db/source-inbox.ts');
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',company.code==='A01526306'?'jwhj1116@kakao.com':'unari8484@gmail.com','synthetic',company.code==='A01526306'?'admin':'member','approved',company.code,company.name,'2026-10-23','2026-10-23');
 h.sqlite.prepare('INSERT INTO products(id,owner_id,source_url,title,source_price_cny,exchange_rate,supply_margin,coupang_margin,supply_price,sale_price,msrp,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('protected','owner',sourceUrl,'기존 작업 상품',5,300,50,40,3000,5000,6500,'2026-10-22','2026-10-22');
 h.sqlite.prepare('INSERT INTO collection_results(job_id,owner_id,payload,received_at) VALUES(?,?,?,?)').run('job','owner','{"protected":"immutable-receipt"}','2026-10-22');
 const protectedState=()=>JSON.stringify({products:h.sqlite.prepare('SELECT * FROM products ORDER BY id').all(),receipts:h.sqlite.prepare('SELECT * FROM collection_results ORDER BY job_id').all()});
 const add=async n=>{const source=snapshot(n),fingerprint=await h.load('app/source-inbox.ts').pageSourceFingerprint(source),saved=await db.storeSourceInbox('owner',company,id(n),fingerprint,source);assert.ok(saved);return saved.item;};
 const body=item=>({expectedOwnerId:'owner',id:item.id,expectedRevision:item.revision,expectedCompany:company,expectedFingerprint:item.fingerprint,expectedSourceUrl:item.snapshot.sourceUrl});
 return {h,api,db,add,body,protectedState,rows:()=>JSON.stringify({base:h.sqlite.prepare('SELECT * FROM source_inbox ORDER BY id').all(),captures:h.sqlite.prepare('SELECT * FROM source_inbox_captures ORDER BY id').all()})};
}

for(const company of companies)test(`${company.code}: exact selected capture archives only that row and returns a revision-bound receipt; originals/products/receipts remain intact`,async()=>{
 const x=harness(company);try{
  const first=await x.add(1),second=await x.add(2),protectedState=x.protectedState(),base=x.h.sqlite.prepare('SELECT * FROM source_inbox').get(),raw=x.h.sqlite.prepare('SELECT payload,review_payload FROM source_inbox_captures').get();
  const response=await x.api.DELETE(request(x.body(second)));assert.equal(response.status,200,await response.clone().text());const ack=await response.json();
  assert.deepEqual({...ack,archivedAt:null},{ownerId:'owner',company,id:second.id,fingerprint:second.fingerprint,sourceUrl,previousRevision:1,revision:2,archived:true,archivedAt:null});assert.ok(Number.isFinite(Date.parse(ack.archivedAt)));
  assert.deepEqual(x.h.sqlite.prepare('SELECT * FROM source_inbox').get(),base);assert.deepEqual(x.h.sqlite.prepare('SELECT payload,review_payload FROM source_inbox_captures').get(),raw);
  assert.equal((await x.db.readSourceInbox('owner',first.id)).archivedAt,null);assert.ok((await x.db.readSourceInbox('owner',second.id)).archivedAt);
  assert.equal((await x.api.DELETE(request(x.body(second)))).status,409,'no repeated archive or success guess');
  assert.equal(x.protectedState(),protectedState);assert.deepEqual(x.h.network,[]);
  const restored=await x.db.restoreSourceInbox('owner',second.id,2);assert.equal(restored.revision,3);assert.equal(restored.archivedAt,null,'archive remains reversible without changing the original');
 }finally{x.h.close();}
});

test('legacy DELETE payload and ACK remain compatible with the same current-member fence',async()=>{
 const x=harness();try{const item=await x.add(1),response=await x.api.DELETE(request({expectedOwnerId:'owner',id:item.id,expectedRevision:1}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{ownerId:'owner',id:item.id,archived:true});}finally{x.h.close();}
});

test('partial/extra/malformed strict identities fail without writes',async()=>{
 const x=harness();try{const item=await x.add(1),good=x.body(item),before=x.rows();
  const invalid=[{...good,expectedRevision:0},{...good,expectedRevision:-1},{...good,id:'invalid'},{...good,expectedFingerprint:'x'},{...good,expectedSourceUrl:sourceUrl+'?spm=changed'},{...good,expectedSourceUrl:'https://evil.test/offer/700000000973.html'},{...good,extra:true},{...good,expectedCompany:{...companies[1],extra:true}}];
  for(const name of ['expectedCompany','expectedFingerprint','expectedSourceUrl']){const value={...good};delete value[name];invalid.push(value);}
  for(const body of invalid)assert.equal((await x.api.DELETE(request(body))).status,400,JSON.stringify(body));assert.equal(x.rows(),before);
 }finally{x.h.close();}
});

test('wrong owner/company/source/fingerprint/revision and foreign rows never archive another capture',async()=>{
 const x=harness();try{const item=await x.add(1),good=x.body(item),before=x.rows();
  for(const body of [{...good,expectedOwnerId:'other'},{...good,expectedCompany:companies[0]},{...good,expectedFingerprint:'0'.repeat(64)},{...good,expectedSourceUrl:sourceUrl.replace('973','974')},{...good,expectedRevision:2}])assert.equal((await x.api.DELETE(request(body))).status,409);
  assert.equal((await x.api.DELETE(request({...good,id:id(99)}))).status,404);assert.equal(x.rows(),before);
 }finally{x.h.close();}
});

test('latest user company/status is rechecked after reading the selected immutable source',async()=>{
 for(const kind of ['company','status']){const x=harness();try{const item=await x.add(1),before=x.rows(),prepare=x.h.db.prepare;let fired=false;
  x.h.db.prepare=sql=>{const statement=prepare(sql);if(!fired&&sql.startsWith('SELECT * FROM (SELECT owner_id,id,company_code')){const all=statement.all;statement.all=async()=>{const value=await all();fired=true;if(kind==='company')x.h.setCompany(companies[0]);else x.h.setMembershipStatus('suspended');return value;};}return statement;};
  assert.equal((await x.api.DELETE(request(x.body(item)))).status,409);assert.equal(fired,true);assert.equal(x.rows(),before);
 }finally{x.h.close();}}
});

for(const table of ['source_inbox','source_inbox_captures'])test(`${table}: SQL CAS refuses source/review/company/member races before archive without touching products or receipts`,async()=>{
 for(const kind of ['row-company','fingerprint','payload','review','revision','already-archived','member-company','member-name','member-email','member-role','member-status']){
  const x=harness();try{const base=await x.add(1),item=table==='source_inbox'?base:await x.add(2),protectedState=x.protectedState(),prepare=x.h.db.prepare;let fired=false,changedRow;
   x.h.db.prepare=sql=>{if(!fired&&sql.startsWith('UPDATE '+table+' SET archived_at=')){fired=true;
    if(kind==='row-company')x.h.sqlite.prepare(`UPDATE ${table} SET company_name='changed' WHERE id=?`).run(item.id);
    if(kind==='fingerprint')x.h.sqlite.prepare(`UPDATE ${table} SET fingerprint=? WHERE id=?`).run('0'.repeat(64),item.id);
    if(kind==='payload'){const value=JSON.parse(x.h.sqlite.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(item.id).payload);value.title='changed';x.h.sqlite.prepare(`UPDATE ${table} SET payload=? WHERE id=?`).run(JSON.stringify(value),item.id);}
    if(kind==='review')x.h.sqlite.prepare(`UPDATE ${table} SET review_payload=payload WHERE id=?`).run(item.id);
    if(kind==='revision')x.h.sqlite.prepare(`UPDATE ${table} SET revision=revision+1 WHERE id=?`).run(item.id);
    if(kind==='already-archived')x.h.sqlite.prepare(`UPDATE ${table} SET archived_at='2026-10-22' WHERE id=?`).run(item.id);
    const memberColumns={'member-company':"company_code='A01526306'",'member-name':"company_name='changed'",'member-email':"email='changed@example.test'",'member-role':"role='admin'",'member-status':"status='suspended'"};
    if(kind in memberColumns)x.h.sqlite.exec('UPDATE members SET '+memberColumns[kind]+" WHERE id='owner'");
    changedRow=JSON.stringify(x.h.sqlite.prepare(`SELECT * FROM ${table} WHERE id=?`).get(item.id));
   }return prepare(sql);};
   const response=await x.api.DELETE(request(x.body(item)));assert.equal(response.status,409,kind+' '+await response.clone().text());assert.equal(fired,true);
   assert.equal(JSON.stringify(x.h.sqlite.prepare(`SELECT * FROM ${table} WHERE id=?`).get(item.id)),changedRow,'archive made no additional mutation');assert.equal(x.protectedState(),protectedState);assert.deepEqual(x.h.network,[]);
  }finally{x.h.close();}
 }
});
