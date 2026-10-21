import test from 'node:test';
import assert from 'node:assert/strict';
import {companies,syntheticSnapshot,projectionFixture,plain,module} from './helpers/supplier-hub-single-projection.mjs';
const project=module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;

for(const company of companies)test(`form descriptions and example annotations never change the saved Single payload (${company.code})`,async()=>{
 const snapshot=syntheticSnapshot(company),baseline=projectionFixture(snapshot);
 baseline.set(['productPage','commonAttributes','exposedAttributes'],'색상','검정');
 const expected=await project(baseline.input),raw=JSON.parse(snapshot.schemaString);
 raw.properties.startPage.properties.productName.description='카테고리의 상품명 안내';
 raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[0].contains.properties.attributeValue.example='파랑';
 const described=projectionFixture({...snapshot,schemaString:JSON.stringify(raw)});
 described.set(['productPage','commonAttributes','exposedAttributes'],'색상','검정');
 const before=JSON.stringify(described.input),actual=await project(described.input);
 assert.deepEqual(plain(actual.payload),plain(expected.payload));
 assert.notEqual(actual.schemaSha256,expected.schemaSha256);
 assert.equal(JSON.stringify(described.input),before);
 assert.equal(actual.payload.jsonDocument[0].productPage.commonAttributes.exposedAttributes[0].attributeValue,'검정');
 assert.equal(actual.registered,false);assert.equal(actual.remoteWrites,false);assert.equal(actual.submissionReady,false);assert.equal(actual.humanAgreementsConfirmed,false);
});

for(const key of ['exampleValidation','pattern'])test(`unknown or actual validation still blocks Single projection: ${key}`,async()=>{
 const snapshot=syntheticSnapshot(),raw=JSON.parse(snapshot.schemaString);
 raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf[0].contains.properties.attributeValue[key]='^파랑$';
 const fixture=projectionFixture({...snapshot,schemaString:JSON.stringify(raw)});
 await assert.rejects(project(fixture.input),error=>error.code==='SINGLE_UNSUPPORTED');
});
