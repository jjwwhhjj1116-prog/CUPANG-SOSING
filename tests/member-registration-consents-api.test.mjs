import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const origin='https://app.test',companies=[{code:'A01526306',name:'유앤채',email:'jwhj1116@kakao.com',role:'admin'},{code:'A01464742',name:'와이홉',email:'unari8484@gmail.com',role:'member'}];
const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
async function fixture(company=companies[0]){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
 h.bindings.YOOFAM_CREDENTIAL_ENCRYPTION_KEY=Buffer.from(Array.from({length:32},(_,i)=>i+1)).toString('base64');
 h.sqlite.prepare('INSERT INTO members(id,email,password_hash,role,status,company_code,company_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('owner',company.email,'synthetic-only',company.role,'approved',company.code,company.name,'2026-10-31','2026-10-31');
 const connections=h.load('app/api/member-connections/route.ts'),api=h.load('app/api/supplier-hub/registration-consents/route.ts'),model=h.load('app/member-registration-consents.ts');
 const connectionId=crypto.randomUUID(),scope={ownerId:'owner',company:{code:company.code,name:company.name}};
 await json(await connections.POST(new Request(origin+'/api/member-connections',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'save',expectedOwnerId:'owner',expectedCompany:scope.company,id:connectionId,expectedRevision:0,service:'supplier-hub',alias:'검증 계정',loginId:'synthetic-login',password:'synthetic-private-password'})})));
 const post=(body,headers={})=>api.POST(new Request(origin+'/api/supplier-hub/registration-consents',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}));
 const get=(query='')=>api.GET(new Request(origin+'/api/supplier-hub/registration-consents'+query));
 const terms=kind=>({stage:kind==='price-data'?'productPage':'imagePage',key:kind==='price-data'?'msrpAgree':'labelContactAgreed',id:kind==='price-data'?'agreeMSRPTerm':'agreeLabelContact',title:'합성 검수용 '+kind,text:'합성 검수용 현재 안내',termsText:'합성 검수용 약관 전문. 실제 약관 동의가 아닙니다.'});
 const save=async(kind='price-data',patch={})=>{const value=terms(kind);return{action:'save',expectedOwnerId:'owner',expectedCompany:scope.company,kind,connectionId,expectedConnectionRevision:1,expectedRevision:0,enabled:true,accepted:true,termsVersion:model.MEMBER_REGISTRATION_CONSENT_TERMS_VERSION,termsSha256:await model.memberRegistrationConsentTermsSha256(value),terms:value,...patch};};
 const state=(enabled,revision,connectionRevision=1)=>({action:'set-enabled',expectedOwnerId:'owner',expectedCompany:scope.company,kind:'price-data',connectionId,expectedConnectionRevision:connectionRevision,expectedRevision:revision,enabled});
 const rows=()=>h.sqlite.prepare('SELECT * FROM member_registration_consents ORDER BY connection_id,kind').all();
 return{h,api,model,connectionId,scope,get,post,save,state,rows,close:()=>h.close()};
}

for(const company of companies)test(`${company.code}: settings default off, independently store exact displayed terms per own connection, and never expose credentials`,async()=>{
 const f=await fixture(company);try{
  const original=f.h.sqlite.prepare('SELECT * FROM products').all(),first=await json(await f.get());assert.deepEqual(first.policies,[]);assert.equal(first.connections.length,1);assert.equal(first.actor.credentialVersion,0);
  for(const kind of ['price-data','label-contact']){const body=await f.save(kind),view=await json(await f.post(body));assert.equal(view.policies.length,kind==='price-data'?1:2);const policy=view.policies.find(p=>p.kind===kind);assert.equal(policy.enabled,true);assert.equal(policy.revision,1);assert.equal(policy.connectionRevision,1);assert.equal(policy.termsSha256,body.termsSha256);assert.deepEqual(policy.terms,body.terms);assert.equal(f.model.memberRegistrationConsentCurrent(policy,view),true);assert.equal(JSON.stringify(view).includes('synthetic-private-password'),false);assert.equal(JSON.stringify(view).includes('password_ciphertext'),false);}
  await json(await f.post(f.state(false,1)));const off=await json(await f.get());assert.equal(off.policies.find(p=>p.kind==='price-data').enabled,false);assert.equal(off.policies.find(p=>p.kind==='label-contact').enabled,true);
  await json(await f.post(f.state(true,2)));assert.equal(f.rows().find(p=>p.kind==='price-data').revision,3);
  assert.deepEqual(f.h.sqlite.prepare('SELECT * FROM products').all(),original);assert.equal(f.h.network.length,0);
 }finally{f.close();}
});

test('connection changes invalidate old policy; withdrawal remains possible and re-enabling requires fresh explicit acceptance',async()=>{
 const f=await fixture();try{
  await json(await f.post(await f.save()));f.h.sqlite.prepare('UPDATE member_connections SET revision=revision+1 WHERE profile_id=?').run(f.connectionId);
  let view=await json(await f.get());assert.equal(f.model.memberRegistrationConsentCurrent(view.policies[0],view),false);
  const before=JSON.stringify(f.rows());await json(await f.post(f.state(true,1,2)),409);assert.equal(JSON.stringify(f.rows()),before);
  await json(await f.post(f.state(false,1,2)));await json(await f.post(f.state(true,2,2)),409);
  view=await json(await f.post(await f.save('price-data',{expectedRevision:2,expectedConnectionRevision:2})));assert.equal(view.policies[0].connectionRevision,2);assert.equal(f.model.memberRegistrationConsentCurrent(view.policies[0],view),true);
  f.h.sqlite.prepare('UPDATE members SET credential_version=credential_version+1 WHERE id=?').run('owner');view=await json(await f.get());assert.equal(view.actor.credentialVersion,1);assert.equal(f.model.memberRegistrationConsentCurrent(view.policies[0],view),false);
  await json(await f.post(f.state(true,3,2)),409);await json(await f.post(f.state(false,3,2)));
  view=await json(await f.post(await f.save('price-data',{expectedRevision:4,expectedConnectionRevision:2})));assert.equal(view.policies[0].actor.credentialVersion,1);assert.equal(f.model.memberRegistrationConsentCurrent(view.policies[0],view),true);
 }finally{f.close();}
});

test('cross-member/company/connection requests, duplicate CAS, missing explicit opt-in and changed terms are rejected without writes',async()=>{
 const f=await fixture();try{
  const input=await f.save();await json(await f.post(input));const before=JSON.stringify(f.rows());
  for(const patch of [{expectedOwnerId:'other'},{expectedCompany:{code:'A01464742',name:'와이홉'}},{connectionId:crypto.randomUUID(),expectedRevision:0},{expectedRevision:0},{expectedRevision:2},{expectedConnectionRevision:2}])await json(await f.post({...input,expectedRevision:1,...patch}),409);
  for(const patch of [{accepted:false},{enabled:false},{termsSha256:'0'.repeat(64)},{terms:{...input.terms,termsText:'다른 약관'}},{secret:true},{kind:'all'},{termsVersion:'future'}])await json(await f.post({...input,expectedRevision:1,...patch}),400);
  for(const value of ['', 'null','https://other.test'])await json(await f.post({...input,expectedRevision:1},{origin:value}),403);
  await json(await f.post({...input,expectedRevision:1},{'sec-fetch-site':'cross-site'}),403);await json(await f.get('?includeSecrets=true'),400);
  assert.equal(JSON.stringify(f.rows()),before);f.h.sqlite.prepare('UPDATE member_connections SET owner_id=? WHERE profile_id=?').run('other',f.connectionId);await json(await f.post({...input,expectedRevision:1}),409);assert.equal(JSON.stringify(f.rows()),before);
 }finally{f.close();}
});

test('suspended or mid-request credential-changing members cannot save or return policies',async()=>{
 for(const mode of ['suspended','changed-while-saving','changed-while-reading']){const f=await fixture();try{
  const input=await f.save();await json(await f.post(input));const before=JSON.stringify(f.rows());
  if(mode==='suspended'){f.h.setMembershipStatus('suspended');await json(await f.get(),403);await json(await f.post({...input,expectedRevision:1}),403);}
  else{
   const prepare=f.h.bindings.DB.prepare;let reads=0;
   f.h.bindings.DB.prepare=sql=>{if(sql.includes('SELECT credential_version AS version')&&++reads===2)f.h.sqlite.prepare('UPDATE members SET credential_version=credential_version+1 WHERE id=?').run('owner');return prepare(sql);};
   await json(await (mode==='changed-while-saving'?f.post({...input,expectedRevision:1}):f.get()),409);
  }
  assert.equal(JSON.stringify(f.rows()),before);assert.equal(f.h.network.length,0);
 }finally{f.close();}}
});

test('a connection disabled or revised between metadata and policy reads cannot return a stale current approval',async()=>{
 for(const mode of ['disabled','revision','login-id']){const f=await fixture();try{
  await json(await f.post(await f.save()));const before=JSON.stringify(f.rows()),store=f.h.load('db/member-registration-consents.ts'),read=store.readMemberRegistrationConsents;let changed=false;
  store.readMemberRegistrationConsents=async scope=>{
   // Let the independently awaited connection metadata complete first.
   await new Promise(resolve=>setImmediate(resolve));
   if(!changed){changed=true;f.h.sqlite.prepare(mode==='disabled'?'UPDATE member_connections SET enabled=0,revision=revision+1 WHERE profile_id=?'
    :mode==='revision'?'UPDATE member_connections SET revision=revision+1 WHERE profile_id=?':"UPDATE member_connections SET login_id='changed-synthetic-login',revision=revision+1 WHERE profile_id=?").run(f.connectionId);}
   return read(scope);
  };
  const rejected=await json(await f.get(),409);assert.equal(rejected.code,'REGISTRATION_CONSENTS_CHANGED');assert.equal(rejected.policies,undefined);assert.equal(rejected.connections,undefined);
  assert.equal(changed,true);assert.equal(JSON.stringify(f.rows()),before,'a read conflict cannot change saved consent records');assert.equal(f.h.network.length,0);
 }finally{f.close();}}
});
