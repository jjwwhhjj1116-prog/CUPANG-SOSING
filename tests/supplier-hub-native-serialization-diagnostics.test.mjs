import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule} from './helpers/provided-option-quotation.mjs';

const {nativeSerializationDiagnostics}=providedOptionModule('app/supplier-hub-native-serialization-diagnostics.ts');
const SHA='f675549f02d67d903a82e28ba4ba116ee1a96f7740558431b3a0ce4cbfd47e10';
const plain=value=>JSON.parse(JSON.stringify(value));
const kind=type=>type==='missing'?'missing':type==='string-empty'?'empty':type==='array'||type==='object'?'not-applicable':'present';
const row=(index,path,expectedType,actualType)=>({path:['jsonDocument',index,...path.split('.')],expectedType,actualType,expectedValueKind:kind(expectedType),actualValueKind:kind(actualType)});
const leaf=rows=>({format:'yoofam-saved-body-leaf-differences-v1',rows,visited:200,truncated:false});
function originalStructuralFixture(){
 const rows=[];
 for(let index=0;index<3;index++){
  rows.push(row(index,'imagePage.details.htmlProductDetailContent','string-empty','null'),row(index,'imagePage.images.sizeChartImage','missing','string-empty'),row(index,'legalPage.productNoticeName','string','missing'),row(index,'productPage.commonAttributes.osrp','string','missing'));
  for(const attributeIndex of [3,8,10,12,13,14])rows.push({...row(index,'productPage.unexposedAttributes','null','string-empty'),path:['jsonDocument',index,'productPage','unexposedAttributes',attributeIndex,'attributeValue']});
  if(index>0)rows.push(row(index,'sourcingPage.sourcingChannelId','null','string-empty'),row(index,'sourcingPage.sourcingChannelType','null','string-empty'));
 }
 return leaf(rows);
}

test('the original 34 structural deltas classify only exact proven schema/model patterns without changing the audit',()=>{
 const input=originalStructuralFixture(),before=plain(input),result=nativeSerializationDiagnostics(SHA,input);
 assert.equal(input.rows.length,34);assert.equal(result.patternCount,34);assert.equal(result.unclassifiedCount,0);assert.equal(result.patterns.filter(value=>value==='optional-form-key-omission').length,6);assert.equal(result.patterns.filter(value=>value==='empty-attribute-template-fallback').length,18);
 assert.equal(result.patterns.filter(value=>value==='empty-detail-html-to-null').length,3);assert.equal(result.patterns.filter(value=>value==='empty-size-chart-slot').length,3);assert.equal(result.patterns.filter(value=>value==='later-option-empty-sourcing').length,4);
 assert.deepEqual(input,before);assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.patterns));
 assert.deepEqual(Object.keys(result).sort(),['patternCount','patterns','unclassifiedCount']);
 assert.doesNotMatch(JSON.stringify(result),/canResume|canDelete|bodyMatches|registered|2347603|886034098637|\.jpg|certificateNumber|PRIVATE/);
});

test('unknown or changed schemas, old reports and empty projections are never classified',()=>{
 const input=originalStructuralFixture();
 for(const sha of ['a'.repeat(64),SHA.toUpperCase(),SHA.slice(0,-1),''])assert.equal(nativeSerializationDiagnostics(sha,input),null);
 assert.equal(nativeSerializationDiagnostics(SHA,undefined),null);
 assert.equal(nativeSerializationDiagnostics(SHA,{...input,format:'unknown'}),null);
 assert.equal(nativeSerializationDiagnostics(SHA,leaf([])),null);
 assert.equal(nativeSerializationDiagnostics(SHA,leaf(Array.from({length:81},()=>input.rows[0]))),null);
});

test('same-path value edits, inverse transformations, first sourcing option and all consent/certificate/price edits stay unclassified',()=>{
 const rows=[
  row(0,'imagePage.details.htmlProductDetailContent','string','null'),row(0,'imagePage.details.htmlProductDetailContent','null','string-empty'),
  row(0,'imagePage.images.sizeChartImage','string','string-empty'),row(0,'legalPage.productNoticeName','string','string'),row(0,'productPage.commonAttributes.osrp','string','string'),
  row(0,'sourcingPage.sourcingChannelId','null','string-empty'),row(1,'sourcingPage.sourcingChannelType','string','string-empty'),
  {...row(0,'imagePage.msrpAgree','boolean','boolean'),expectedPrimitive:false,actualPrimitive:true},
  {...row(0,'imagePage.labelContactAgreed','boolean','boolean'),expectedPrimitive:true,actualPrimitive:false},
  row(0,'legalPage.certificates','array','array'),row(0,'productPage.commonAttributes.msrp','string','missing'),row(0,'productPage.commonAttributes.purchasePrice','string','string'),
  {...row(0,'productPage.unexposedAttributes','null','string-empty'),path:['jsonDocument',0,'productPage','unexposedAttributes',0,'attributeValue']},
  {...row(0,'productPage.unexposedAttributes','null','string-empty'),path:['jsonDocument',0,'productPage','unexposedAttributes',1,'attributeValue']},
  {...row(0,'productPage.unexposedAttributes','null','string-empty'),path:['jsonDocument',0,'productPage','unexposedAttributes',3,'otherValue']},
 ];
 const result=nativeSerializationDiagnostics(SHA,leaf(rows));assert.equal(result.patternCount,0);assert.equal(result.unclassifiedCount,rows.length);
 assert.ok(result.patterns.every(value=>value===null));
});

test('truncated input is only classified within visible rows and cannot claim complete native equivalence',()=>{
 const input={...originalStructuralFixture(),truncated:true},result=nativeSerializationDiagnostics(SHA,input);
 assert.equal(result.patternCount+result.unclassifiedCount,input.rows.length);assert.equal(input.truncated,true);assert.equal(Object.hasOwn(result,'complete'),false);assert.equal(Object.hasOwn(result,'matches'),false);
});
