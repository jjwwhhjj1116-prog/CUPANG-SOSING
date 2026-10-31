import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSingleReceipt,SINGLE_RECEIPT_URL} from '../extensions/supplier-hub/single-receipt.mjs';

const COMPANIES=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
function fixture(company=COMPANIES[0],status='SUBMITTED'){
  const expected={docId:701,ownedDocId:701,baselineDocIds:[700],productName:'새 검수 상품 · 검정',categoryPath:'스포츠 > 보호대 (80719)',company:{...company},
    identityDigest:'a'.repeat(64),preparedBodySha256:'b'.repeat(64),tabId:71,windowId:4,documentId:'01234567-89ab-cdef-0123-456789abcdef',operationId:'request-1:submit',submitRequestedAt:900};
  const provenance={method:'GET',url:SINGLE_RECEIPT_URL,status:200,redirected:false,contentType:'application/json;charset=UTF-8',cache:'no-store',readOnly:true,
    ...Object.fromEntries(['docId','company','identityDigest','preparedBodySha256','tabId','windowId','documentId','operationId'].map(key=>[key,structuredClone(expected[key])]))};
  const old={docId:700,status:'FINISHED',productName:'기존 작업 상품',categoryPath:'다른 카테고리',qvtRequestId:'previous-file',remark:'보존'};
  const row={docId:701,status,productName:expected.productName,categoryPath:expected.categoryPath,qvtRequestId:123456789012,modifiedAt:'2026-10-14T01:02:03Z',remark:null};
  return {expected,provenance,response:{ok:true,status:200,json:[old,row]},observedAt:1000};
}
const rejects=(input,code='RECEIPT_UNCONFIRMED')=>assert.throws(()=>normalizeSingleReceipt(input),error=>error.code===code);

for(const company of COMPANIES)test(company.name+' rejection remark belongs only to the exact owned row and can refresh without changing IDs',()=>{
  const input=fixture(company,'REJECTED'),before=structuredClone(input),error={columnName:'포장 크기',message:'숫자 세 개를 입력해주세요.'};
  input.response.json[0].remark=JSON.stringify({errors:[{columnName:'다른 상품',message:'읽으면 안 됨'}]});
  input.response.json[1].remark=JSON.stringify({errors:[error]});
  const result=normalizeSingleReceipt(input);assert.deepEqual(result.rejectionDetails.errors,[error]);assert.equal(result.state,'rejected');assert.equal(result.registered,false);
  input.previousReceipt=result;input.observedAt++;input.response.json[1].remark='malformed';
  const refreshed=normalizeSingleReceipt(input);assert.equal(refreshed.rejectionDetails.status,'unavailable');assert.equal(refreshed.receiptId,result.receiptId);
  for(const status of ['SUBMITTED','FINISHED']){const other=fixture(company,status);other.response.json[1].remark=JSON.stringify({errors:[error]});assert.equal(Object.hasOwn(normalizeSingleReceipt(other),'rejectionDetails'),false);}
  input.expected.docId=before.expected.docId+1;rejects(input);
});

for(const company of COMPANIES)test(company.name+' fresh native rows normalize pending/rejected/accepted without SKU completion',()=>{
  for(const [status,state]of [['SUBMITTED','pending'],['REJECTED','rejected'],['FINISHED','accepted']]){
    const input=fixture(company,status),before=structuredClone(input),receipt=normalizeSingleReceipt(input);
    assert.equal(receipt.state,state);assert.equal(receipt.docId,701);assert.equal(receipt.receiptId,123456789012);assert.equal(receipt.qvtRequestId,receipt.receiptId);assert.equal(receipt.sourceStatus,status);
    assert.deepEqual(receipt.company,company);assert.equal(receipt.evidence,'document-receipt');assert.equal(receipt.registered,false);
    assert.equal(Object.hasOwn(receipt,'skuId'),false);assert.equal(Object.hasOwn(receipt,'success'),false);
    assert.equal(Object.isFrozen(receipt),true);assert.equal(Object.isFrozen(receipt.company),true);assert.deepEqual(input,before);
  }
});

test('exact native ID JSON types are preserved; no numeric-string coercion',()=>{
  const input=fixture();input.expected.docId='701';input.expected.ownedDocId='701';input.provenance.docId='701';input.response.json[1].docId='701';input.response.json[1].qvtRequestId='registration-file-701';
  assert.equal(normalizeSingleReceipt(input).receiptId,'registration-file-701');
  input.response.json[1].docId=701;rejects(input);
});

test('existing document ownership, baseline type aliases and missing ownership proof fail closed',()=>{
  for(const mutate of [input=>{input.expected.ownedDocId=700;},input=>{input.expected.baselineDocIds.push(701);},input=>{input.expected.baselineDocIds.push('701');},input=>{delete input.expected.baselineDocIds;},input=>{delete input.expected.ownedDocId;}]){
    const input=fixture();mutate(input);rejects(input);
  }
});

test('wrappers, nulls, sparse arrays and duplicated document IDs never produce a receipt',()=>{
  for(const rows of [null,{code:200,data:fixture().response.json},[null],Array(2),[fixture().response.json[1],fixture().response.json[1]],
    [fixture().response.json[1],{...fixture().response.json[1],docId:'701'}]]){
    const input=fixture();input.response.json=rows;rejects(input);
  }
});

test('only a strict fresh list with no same document representation is temporarily not visible',()=>{
  for(const rows of [[],[{...fixture().response.json[1],docId:'foreign'}]]){const input=fixture();input.response.json=rows;rejects(input,'RECEIPT_NOT_VISIBLE');}
  for(const mutate of [input=>{input.provenance.status=403;},input=>{input.expected.ownedDocId=702;},input=>{input.previousReceipt={};},input=>{input.observedAt=899;}]){const input=fixture();input.response.json=[];mutate(input);rejects(input);}
  const changed=fixture();changed.response.json[1].docId='701';rejects(changed);
});

test('unknown statuses, changed name/category and absent or truncated registration-file IDs fail closed',()=>{
  for(const patch of [{status:'UNFINISHED'},{status:'REGISTERED'},{status:null},{status:'FINISHED '},{productName:'다른 상품'},{categoryPath:'다른 카테고리'},
    {qvtRequestId:null},{qvtRequestId:undefined},{qvtRequestId:''},{qvtRequestId:' 123 '},{qvtRequestId:'123...'},{qvtRequestId:'123…'},{qvtRequestId:0},{qvtRequestId:-1},{qvtRequestId:1.5},{qvtRequestId:Infinity}]){
    const input=fixture();Object.assign(input.response.json[1],patch);rejects(input);
  }
});

test('company and SKU fields in native rows are not used or copied as fabricated proof',()=>{
  const input=fixture(COMPANIES[0],'FINISHED');Object.assign(input.response.json[1],{company:COMPANIES[1],companyCode:'A01464742',skuId:999,registered:true,success:true});
  const receipt=normalizeSingleReceipt(input);assert.deepEqual(receipt.company,COMPANIES[0]);assert.equal(receipt.registered,false);assert.equal(Object.hasOwn(receipt,'skuId'),false);
});

test('fresh same-company native response provenance is mandatory and exact',()=>{
  const patches=[{method:'POST'},{url:SINGLE_RECEIPT_URL+'?docId=701'},{url:'https://supplier.coupang.com/sr/draft/api/drafts'},{url:'https://foreign.test/sr/draft/api/drafts/register-requested'},
    {status:201},{redirected:true},{contentType:'text/html'},{contentType:'application/json\r\nset-cookie: secret'},{cache:'default'},{readOnly:false},{docId:'701'},
    {company:COMPANIES[1]},{identityDigest:'c'.repeat(64)},{preparedBodySha256:'c'.repeat(64)},{tabId:72},{windowId:5},{documentId:'changed-document'},{operationId:'request-2:submit'}];
  for(const patch of patches){const input=fixture();Object.assign(input.provenance,patch);rejects(input);}
  for(const key of Object.keys(fixture().provenance)){const input=fixture();delete input.provenance[key];rejects(input);}
  for(const input of [{...fixture(),provenance:null},{...fixture(),provenance:{current:true}},{...fixture(),provenance:{...fixture().provenance,foreign:true}}])rejects(input);
});

test('unsuccessful native response, extra wrapper properties and uncertain timestamps are rejected',()=>{
  for(const patch of [{ok:false},{status:403},{status:201},{json:{data:[]}},{error:'denied'}]){const input=fixture();Object.assign(input.response,patch);rejects(input);}
  for(const observedAt of [undefined,null,0,-1,1.5,NaN,Infinity,'1000',899])rejects({...fixture(),observedAt});
  for(const submitRequestedAt of [undefined,null,0,-1,1.5,NaN,Infinity,'900',1001]){const input=fixture();input.expected.submitRequestedAt=submitRequestedAt;rejects(input);}
});

test('prior exact receipt identity is preserved across pending to finished and never rolls back accepted to pending',()=>{
  const input=fixture(),previousReceipt=normalizeSingleReceipt(input);input.previousReceipt=previousReceipt;input.observedAt++;
  input.response.json[1].status='FINISHED';const accepted=normalizeSingleReceipt(input);assert.equal(accepted.state,'accepted');assert.equal(accepted.receiptId,previousReceipt.receiptId);
  input.previousReceipt=accepted;input.observedAt++;
  input.response.json[1].status='SUBMITTED';rejects(input,'RECEIPT_CHANGED');
  input.response.json[1].status='REJECTED';assert.equal(normalizeSingleReceipt(input).state,'rejected');
});

test('changed raw registration-file ID, changed JSON type, other-company prior or older observation cannot replace prior receipt',()=>{
  for(const mutate of [input=>{input.response.json[1].qvtRequestId=555;},input=>{input.response.json[1].qvtRequestId='123456789012';}]){
    const input=fixture();input.previousReceipt=normalizeSingleReceipt(input);input.observedAt++;mutate(input);rejects(input,'RECEIPT_CHANGED');
  }
  for(const mutate of [input=>{input.previousReceipt.company=COMPANIES[1];},input=>{input.previousReceipt.docId=700;},input=>{input.previousReceipt.identityDigest='c'.repeat(64);},
    input=>{input.previousReceipt.evidence='document-and-sku';},input=>{input.previousReceipt.skuId=999;},input=>{input.previousReceipt.registered=true;},input=>{input.previousReceipt.qvtRequestId='different';},input=>{input.previousReceipt.sourceStatus='UNKNOWN';},input=>{input.observedAt=999;}]){
    const input=fixture();input.previousReceipt=structuredClone(normalizeSingleReceipt(input));mutate(input);rejects(input);
  }
});

test('plain JSON values only: inherited identity, accessors, non-record rows and illegal array keys fail closed',()=>{
  const input=fixture();const inherited=Object.create({docId:701});Object.assign(inherited,input.response.json[1]);input.response.json=[inherited];rejects(input);
  const accessor=fixture();let touched=false;Object.defineProperty(accessor.response.json[1],'qvtRequestId',{get(){touched=true;return 1;},enumerable:true});rejects(accessor);assert.equal(touched,false);
  const extra=fixture();extra.response.json.other='foreign';rejects(extra);
  const weird=fixture();weird.response.json=[new Date()];rejects(weird);
});

test('array accessors and holes masked by extra keys never read or accept data',()=>{
  const input=fixture();let touched=false;Object.defineProperty(input.response.json,'0',{get(){touched=true;return fixture().response.json[0];},enumerable:true});rejects(input);assert.equal(touched,false);
  const hole=fixture();delete hole.response.json[0];hole.response.json.extra='replace hole';rejects(hole);
  const symbol=fixture();symbol.response.json[1][Symbol('foreign')]=true;rejects(symbol);
  const hidden=fixture();Object.defineProperty(hidden.response.json,'foreign',{value:'hidden'});rejects(hidden);
});

test('exact saved names are preserved, not trimmed to manufacture a match',()=>{
  const input=fixture();input.expected.productName+=' ';input.response.json[1].productName=input.expected.productName;assert.equal(normalizeSingleReceipt(input).state,'pending');
  input.response.json[1].productName=input.response.json[1].productName.trim();rejects(input);
});
