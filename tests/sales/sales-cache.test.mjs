import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogCache} from '../../extensions/supplier-hub/sales-cache.mjs';

const BASE=Date.UTC(2026,9,5,12,0,0);
const iso=time=>new Date(time).toISOString();
const row=(overrides={})=>({productId:'123',itemId:'456',vendorItemId:'789',salesLast28d:12,pvLast28Day:100,...overrides});
function setup(options={}) {
  let time=BASE;
  const cache=createCatalogCache({...options,now:()=>time});
  return {cache,advance:ms=>{time+=ms;},now:()=>time};
}

test('query cache trims query but keeps case and Wing scope distinct',()=>{
  const {cache}=setup();
  cache.put('8:5','  Neck warmer  ',[row()],iso(BASE));
  assert.deepEqual(cache.get('8:5','Neck warmer'),{rows:[row()],asOf:iso(BASE)});
  assert.equal(cache.get('8:6','Neck warmer'),null);
  assert.equal(cache.get('9:5','Neck warmer'),null);
  assert.equal(cache.get('8:5','neck warmer'),null);
  cache.put({tabId:8,windowId:5},'test',[row()],iso(BASE));
  assert.deepEqual(cache.get({tabId:8,windowId:5},'test')?.rows,[row()]);
  assert.equal(cache.get({tabId:9,windowId:5},'test'),null);
});

test('successful query TTL is fifteen minutes and reads do not refresh asOf or expiry',()=>{
  const {cache,advance}=setup();
  cache.put('8:5','test',[row()],iso(BASE));
  advance(14*60000);
  assert.equal(cache.get('8:5','test').asOf,iso(BASE));
  assert.equal(cache.getProduct('8:5','123').asOf,iso(BASE));
  advance(60000-1);
  assert.ok(cache.get('8:5','test'));
  advance(1);
  assert.equal(cache.get('8:5','test'),null);
  assert.equal(cache.getProduct('8:5','123'),null);
});

test('empty query TTL is two minutes and does not mean zero product sales',()=>{
  const {cache,advance}=setup();
  cache.put('8:5','empty',[],iso(BASE));
  advance(120000-1);
  assert.deepEqual(cache.get('8:5','empty'),{rows:[],asOf:iso(BASE)});
  assert.equal(cache.getProduct('8:5','123'),null);
  advance(1);
  assert.equal(cache.get('8:5','empty'),null);
});

test('cache keeps defensive copies of whitelisted catalog fields and preserves zero/null',()=>{
  const {cache}=setup();
  const rows=[row({salesLast28d:0,pvLast28Day:null,secret:'private',cookie:'private'})];
  cache.put('8:5','test',rows,iso(BASE));
  rows[0].salesLast28d=99;
  rows.push(row({productId:'999'}));
  const query=cache.get('8:5','test');
  assert.deepEqual(query.rows,[row({salesLast28d:0,pvLast28Day:null})]);
  assert.ok(!JSON.stringify(query).includes('private'));
  query.rows[0].salesLast28d=300;
  query.rows.length=0;
  const product=cache.getProduct('8:5','123');
  assert.equal(product.rows[0].salesLast28d,0);
  product.rows[0].productId='999';
  assert.equal(cache.getProduct('8:5','123').rows[0].productId,'123');
});

test('product reuse reads all matching variants from newest snapshot, without combining older values',()=>{
  const {cache,advance,now}=setup();
  cache.put('8:5','broad',[row({salesLast28d:10}),row({productId:'900'})],iso(now()));
  advance(1000);
  const latest=[row({salesLast28d:20}),row({itemId:'457',vendorItemId:'790',salesLast28d:30})];
  cache.put('8:5','specific',latest,iso(now()));
  assert.deepEqual(cache.getProduct('8:5','123'),{rows:latest,asOf:iso(now())});
  assert.equal(cache.getProduct('8:5','900').asOf,iso(BASE));
  assert.equal(cache.getProduct('9:5','123'),null);
  cache.put('8:5','late-old-response',[row({salesLast28d:1})],iso(BASE));
  assert.deepEqual(cache.getProduct('8:5','123').rows,latest);
});

test('equal-time snapshots choose latest insertion and a cache hit never makes an older observation newer',()=>{
  const {cache}=setup();
  cache.put('8:5','a',[row({salesLast28d:1})],iso(BASE));
  cache.put('8:5','b',[row({salesLast28d:2})],iso(BASE));
  cache.get('8:5','a');
  assert.equal(cache.getProduct('8:5','123').rows[0].salesLast28d,2);
});

test('an older response cannot replace a newer snapshot for the same query',()=>{
  const {cache,advance}=setup();
  advance(60000);
  cache.put('8:5','same',[row({salesLast28d:20})],iso(BASE+60000));
  assert.equal(cache.put('8:5','same',[row({salesLast28d:10})],iso(BASE)),false);
  assert.equal(cache.get('8:5','same').rows[0].salesLast28d,20);
});

test('original observation time limits TTL when a snapshot is stored later',()=>{
  const {cache,advance}=setup();
  advance(14*60000);
  cache.put('8:5','old',[row()],iso(BASE));
  advance(60000);
  assert.equal(cache.get('8:5','old'),null);
  assert.equal(cache.put('8:5','expired',[row()],iso(BASE)),false);
  assert.equal(cache.get('8:5','expired'),null);
});

test('LRU bounds entries, query and product hits count as use, and expired entries do not evict fresh ones',()=>{
  const {cache,advance,now}=setup({maxEntries:2});
  cache.put('8:5','a',[row()],iso(now()));
  cache.put('8:5','b',[row({productId:'200'})],iso(now()));
  cache.get('8:5','a');
  cache.put('8:5','c',[row({productId:'300'})],iso(now()));
  assert.equal(cache.get('8:5','b'),null);
  assert.ok(cache.getProduct('8:5','123'));
  cache.put('8:5','d',[row({productId:'400'})],iso(now()));
  assert.equal(cache.get('8:5','c'),null);
  assert.ok(cache.get('8:5','a'));
  advance(15*60000);
  cache.put('8:5','e',[row({productId:'500'})],iso(now()));
  cache.put('8:5','f',[row({productId:'600'})],iso(now()));
  assert.ok(cache.get('8:5','e'));
  assert.ok(cache.get('8:5','f'));
  assert.equal(cache.get('8:5','a'),null);
});

test('default capacity is bounded to 300 entries and each response to 200 rows',()=>{
  const {cache}=setup();
  for(let i=0;i<301;i++)cache.put('8:5',`q${i}`,[row()],iso(BASE));
  assert.equal(cache.get('8:5','q0'),null);
  assert.ok(cache.get('8:5','q1'));
  cache.put('8:5','many',Array.from({length:250},(_,i)=>row({productId:String(i+1)})),iso(BASE));
  assert.equal(cache.get('8:5','many').rows.length,200);
});

test('invalidate clears all query and product results across scopes',()=>{
  const {cache}=setup();
  cache.put('8:5','a',[row()],iso(BASE));
  cache.put('9:5','b',[row()],iso(BASE));
  cache.invalidate();
  assert.equal(cache.get('8:5','a'),null);
  assert.equal(cache.get('9:5','b'),null);
  assert.equal(cache.getProduct('8:5','123'),null);
  cache.put('8:5','a',[row({salesLast28d:0})],iso(BASE));
  assert.equal(cache.getProduct('8:5','123').rows[0].salesLast28d,0);
});

test('unsafe IDs, invalid scope and malformed input cannot broaden a cache lookup',()=>{
  const {cache}=setup();
  cache.put('8:5','test',[row({productId:Number.MAX_SAFE_INTEGER+1}),null,false,[]],iso(BASE));
  assert.equal(cache.getProduct('8:5','9007199254740992'),null);
  assert.equal(cache.getProduct('8:5','bad'),null);
  assert.throws(()=>cache.get(undefined,'test'));
  assert.throws(()=>cache.get('8:5',' '));
  assert.throws(()=>cache.put('8:5','test',null,iso(BASE)));
  assert.throws(()=>cache.put('8:5','test',[], 'bad date'));
  assert.throws(()=>createCatalogCache({maxEntries:0}));
});
