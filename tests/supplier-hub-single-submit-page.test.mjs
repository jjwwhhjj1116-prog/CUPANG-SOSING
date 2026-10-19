import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {singleDocumentSubmitPage} from '../extensions/supplier-hub/single-document-adapter.mjs';
import {validateSingleDocumentPacket} from '../extensions/supplier-hub/single-document.mjs';
import {singlePacket,SINGLE_COMPANIES,SINGLE_SENDER} from './helpers/supplier-hub-single-document.mjs';

// Execute the actual serializable page function in an inert DOM. This neither
// attaches to a browser nor invokes the native Hub page or any vendor code.
const files=['extensions/supplier-hub/single-document-adapter.mjs','extensions/supplier-hub/single-document.mjs','tests/supplier-hub-single-submit-page.test.mjs'];
const hashes=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(new URL('../'+file,import.meta.url))).digest('hex')]));
const frozen=hashes(),cases=[];
after(()=>{
  assert.deepEqual(hashes(),frozen,'reviewed adapter and tests did not change during the focused run');
  fs.writeFileSync(new URL('../outputs/step732-submit-version-proof.json',import.meta.url),JSON.stringify({sourceHashes:frozen,cases,
    boundary:'Actual own packet validator and serialized final-page function; inert synthetic DOM only. Numeric wire consistency is not evidence that current native Hub emits or accepts string/zero versions.',
    browserRequests:0,networkRequests:0,existingProductWrites:0,hubWrites:0,liveGatesChanged:false},null,2)+'\n');
});

function fixture(version,company=SINGLE_COMPANIES[0]){
  const packet=singlePacket(company);packet.body.version=version;
  const binding={identity:{company:structuredClone(company)},packetDigest:'a'.repeat(64),identityDigest:'b'.repeat(64),preparedBodySha256:'c'.repeat(64)};
  const record={binding:structuredClone(binding),docId:9001,loadedDocId:9001,confirmedChallengeId:'synthetic-challenge'};
  const state={clicks:0,buttons:[],checkboxes:[]},visible=value=>({getClientRects:()=>[{}],...value});
  const items=[{key:'syntheticPrice',id:'syntheticPrice',required:true,text:'합성 가격 동의'},{key:'syntheticLabel',id:'syntheticLabel',required:true,text:'합성 라벨 동의'}];
  state.checkboxes=items.map(item=>visible({id:item.id,disabled:false,checked:true,labels:[visible({innerText:item.text})]}));
  state.buttons=[visible({disabled:false,getAttribute:()=>null,click:()=>{state.clicks++;}})];
  const dataset={yoofamSingleDocumentRecords:JSON.stringify({[binding.packetDigest]:record})};
  const location={origin:'https://supplier.coupang.com',pathname:'/sr/registration/step/logisticsPage'};
  const document={body:{innerText:'Company Code: '+company.code},documentElement:{dataset},querySelectorAll(selector){
    if(selector==='input[type="checkbox"]')return state.checkboxes;
    if(selector==='button[type="submit"]')return state.buttons;
    throw Error('Unexpected DOM query: '+selector);
  }};
  const input={binding,docId:9001,operationId:packet.requestId+':submit',challenge:{id:'synthetic-challenge',items},expectedBody:{...packet.body,docId:9001}};
  return {packet,input,state,document,location,dataset,record:()=>JSON.parse(dataset.yoofamSingleDocumentRecords)[binding.packetDigest],
    save(value){dataset.yoofamSingleDocumentRecords=JSON.stringify({[binding.packetDigest]:value});},
    run:()=>vm.runInNewContext('('+singleDocumentSubmitPage.toString()+')(input)',{input,document,location,Date},{timeout:1000})};
}

for(const company of SINGLE_COMPANIES)for(const version of [188,'188',0,'00188','0','12345678901234567890']){
  test(`prepared ${company.code} version ${JSON.stringify(version)} retains its raw wire value through one final-page click`,()=>{
    const f=fixture(version,company),bodyBefore=JSON.stringify(f.input.expectedBody);
    validateSingleDocumentPacket(f.packet,SINGLE_SENDER);
    const result=f.run(),record=f.record();
    assert.equal(result.dispatched,true);assert.equal(result.registered,false);assert.equal(f.state.clicks,1);
    assert.equal(record.submitProof.version,version);assert.equal(typeof record.submitProof.version,typeof version);
    assert.equal(record.submitProof.operationId,f.input.operationId);assert.equal(record.submitProof.docId,f.input.docId);
    assert.equal(record.submitProof.identityDigest,f.input.binding.identityDigest);assert.equal(record.submitProof.preparedBodySha256,f.input.binding.preparedBodySha256);
    assert.equal(record.submitProof.productName,f.input.expectedBody.productName);assert.equal(record.submitProof.categoryPath,f.input.expectedBody.categoryPath);
    assert.equal(record.submitOperationId,f.input.operationId);assert.equal(record.state,'submit-requested');
    assert.ok(Number.isSafeInteger(record.submitProof.requestedAt));assert.equal(JSON.stringify(f.input.expectedBody),bodyBefore,'wire metadata and body were not coerced or rewritten');
    const stored=f.dataset.yoofamSingleDocumentRecords;
    assert.throws(()=>f.run(),/원래 새 문서의 제출 확인/);assert.equal(f.state.clicks,1);assert.equal(f.dataset.yoofamSingleDocumentRecords,stored,'repeat invocation cannot replace intent or click again');
    cases.push({company:company.code,version,versionType:typeof version,packetAccepted:true,clicks:1,rawValuePreserved:true,repeatBlocked:true});
  });
}

test('malformed versions fail before recording submission intent or clicking',()=>{
  const invalid=[-1,1.5,Number.MAX_SAFE_INTEGER+1,'',' ',' 188','188 ','1.5','-1','1e2','１２３','123456789012345678901',null,undefined,true,NaN,Infinity,[],{}];
  for(const version of invalid){
    const f=fixture(version),before=f.dataset.yoofamSingleDocumentRecords;
    assert.throws(()=>validateSingleDocumentPacket(f.packet,SINGLE_SENDER));
    assert.throws(()=>f.run(),/상품·카테고리·버전/);assert.equal(f.state.clicks,0);assert.equal(f.dataset.yoofamSingleDocumentRecords,before);
    assert.equal(f.record().submitProof,undefined);assert.equal(f.record().submitOperationId,undefined);
  }
  cases.push({name:'invalid wire versions',count:invalid.length,intentWrites:0,clicks:0});
});

test('company, owned document, challenge, body and current checkbox guards remain in force for numeric-string versions',()=>{
  const mutations=[
    f=>{f.document.body.innerText='Company Code: A99999999';},
    f=>{f.location.pathname='/sr/registration/step/imagePage';},
    f=>{const record=f.record();record.docId++;f.save(record);},
    f=>{const record=f.record();record.loadedDocId++;f.save(record);},
    f=>{const record=f.record();record.binding.identityDigest='d'.repeat(64);f.save(record);},
    f=>{const record=f.record();record.confirmedChallengeId='older-challenge';f.save(record);},
    f=>{f.input.expectedBody.docId++;},
    f=>{f.input.expectedBody.productName+=' changed';},
    f=>{f.input.expectedBody.categoryPath+=' changed';},
    f=>{f.state.checkboxes[0].checked=false;},
    f=>{f.state.checkboxes[0].disabled=true;},
    f=>{f.state.checkboxes[0].labels[0].innerText='changed terms';},
    f=>{f.state.buttons.push(f.state.buttons[0]);},
  ];
  for(const mutate of mutations){
    const f=fixture('00188');mutate(f);const before=f.dataset.yoofamSingleDocumentRecords;
    assert.throws(()=>f.run());assert.equal(f.state.clicks,0);assert.equal(f.dataset.yoofamSingleDocumentRecords,before);assert.equal(f.record().submitProof,undefined);
  }
  cases.push({name:'existing current-scope guards',count:mutations.length,intentWrites:0,clicks:0});
});
