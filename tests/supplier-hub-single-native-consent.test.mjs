import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {companies,syntheticSnapshot,projectionFixture,module,plain} from './helpers/supplier-hub-single-projection.mjs';

const project=module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
const flags=['msrpAgree','labelContactAgreed'];
const missingSnapshot=(company=companies[0])=>{const snapshot=syntheticSnapshot(company),raw=JSON.parse(snapshot.schemaString);for(const key of flags)delete raw.properties.imagePage.properties[key];snapshot.schemaString=JSON.stringify(raw);return snapshot;};
const image=out=>out.payload.jsonDocument[0].imagePage;
const recorded=new URL('../outputs/step650-official-81452-profile-after.json',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

for(const company of companies)test(`recorded 81452 native image document receives only two deferred false flags (${company.code})`,{skip:!fs.existsSync(recorded)},async()=>{
 const bytes=fs.readFileSync(recorded),beforeHash=sha(bytes),snapshot={...JSON.parse(bytes).hubSchema,company:{...company}},raw=JSON.parse(snapshot.schemaString);
 assert.deepEqual(Object.keys(raw.properties.imagePage.properties),['images','details']);assert.equal(snapshot.draftInitialization,'couplus-required-v1');
 const f=projectionFixture(snapshot),before=JSON.stringify(f.input),out=await project(f.input),value=image(out);
 assert.equal(value.msrpAgree,false);assert.equal(value.labelContactAgreed,false);assert.deepEqual(Object.keys(value),['images','details',...flags]);
 for(const key of flags){assert.ok(out.review.issues.some(issue=>issue.code==='AGREEMENT_UNCONFIRMED'&&JSON.stringify(issue.path)===JSON.stringify(['imagePage',key])));
  assert.equal(out.review.fields.some(field=>JSON.stringify(field.path)===JSON.stringify(['imagePage',key])),false,'native controls must not become fabricated category schema fields');}
 assert.equal(out.humanAgreementsConfirmed,false);assert.equal(out.registered,false);assert.equal(out.remoteWrites,false);assert.equal(out.submissionReady,false);
 assert.equal(JSON.stringify(f.input),before);assert.equal(sha(fs.readFileSync(recorded)),beforeHash);
});

test('the known captured native contract initializes absent controls without changing page facts or excluded rows',async()=>{
 const f=projectionFixture(missingSnapshot());f.resolved.rows.push({...structuredClone(f.row),optionId:'excluded',included:false});
 f.set(['productPage','modelNumber'],undefined,'');f.set(['imagePage','details','htmlProductDetailContent'],undefined,'');
 const before=JSON.stringify(f.input),out=await project(f.input);assert.equal(out.payload.jsonDocument.length,1);
 assert.equal(image(out).msrpAgree,false);assert.equal(image(out).labelContactAgreed,false);assert.equal(image(out).details.htmlProductDetailContent,'');
 assert.equal(out.payload.jsonDocument[0].productPage.modelNumber,'');assert.equal(JSON.stringify(f.input),before);
});

test('unmarked category schemas retain their own shape and do not acquire assumed agreement flags',async()=>{
 const snapshot=missingSnapshot();delete snapshot.draftInitialization;const f=projectionFixture(snapshot),before=JSON.stringify(f.input),out=await project(f.input);
 assert.equal(Object.hasOwn(image(out),'msrpAgree'),false);assert.equal(Object.hasOwn(image(out),'labelContactAgreed'),false);assert.equal(JSON.stringify(f.input),before);
});

test('a partial or other image object is not silently promoted to the known images/details native contract',async()=>{
 for(const absent of ['images','details']){
  const snapshot=missingSnapshot(),raw=JSON.parse(snapshot.schemaString);delete raw.properties.imagePage.properties[absent];snapshot.schemaString=JSON.stringify(raw);
  const f=projectionFixture(snapshot),out=await project(f.input);assert.equal(Object.hasOwn(image(out),'msrpAgree'),false);assert.equal(Object.hasOwn(image(out),'labelContactAgreed'),false);
 }
});

test('declared native boolean values remain saved preview facts while only an absent counterpart starts false',async()=>{
 for(const kept of flags){
  const snapshot=syntheticSnapshot(),raw=JSON.parse(snapshot.schemaString),missing=flags.find(key=>key!==kept);delete raw.properties.imagePage.properties[missing];snapshot.schemaString=JSON.stringify(raw);
  const f=projectionFixture(snapshot);f.set(['imagePage',kept],undefined,'true','manual-option');const before=JSON.stringify(f.input),out=await project(f.input);
  assert.equal(image(out)[kept],true);assert.equal(image(out)[missing],false);assert.equal(out.humanAgreementsConfirmed,false);assert.equal(JSON.stringify(f.input),before);
 }
});

test('malformed declared agreement types are rejected rather than replaced with a false-looking usable control',async()=>{
 for(const type of ['string',['boolean','null'],'integer']){
  const snapshot=missingSnapshot(),raw=JSON.parse(snapshot.schemaString);raw.properties.imagePage.properties.msrpAgree={type,title:'변경된 동의 형식'};snapshot.schemaString=JSON.stringify(raw);
  const f=projectionFixture(snapshot);f.set(['imagePage','msrpAgree'],undefined,type==='integer'?'0':'false');const before=JSON.stringify(f.input);
  await assert.rejects(project(f.input),error=>error.code==='SINGLE_NATIVE_AGREEMENT');assert.equal(JSON.stringify(f.input),before);
 }
});

test('same-named controls outside the exact image page keep their original values and are not used for consent',async()=>{
 const snapshot=missingSnapshot(),raw=JSON.parse(snapshot.schemaString);raw.properties.productPage.properties.msrpAgree={type:'string',title:'다른 일반 값'};snapshot.schemaString=JSON.stringify(raw);
 const f=projectionFixture(snapshot);f.set(['productPage','msrpAgree'],undefined,'보존할 일반 문자열');const out=await project(f.input);
 assert.equal(out.payload.jsonDocument[0].productPage.msrpAgree,'보존할 일반 문자열');assert.deepEqual(plain(flags.map(key=>image(out)[key])),[false,false]);
 assert.equal(out.review.fields.filter(field=>JSON.stringify(field.path)===JSON.stringify(['productPage','msrpAgree'])).length,1);
});
