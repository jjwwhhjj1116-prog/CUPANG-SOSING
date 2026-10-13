import test from 'node:test';
import assert from 'node:assert/strict';
import {bannerFixture,bannerCompanies as companies} from './helpers/captured-settings-banners.mjs';
const plain=value=>JSON.parse(JSON.stringify(value));
for(const company of companies)test(`captured enabled banners remain exact read-only descriptors after content save and later workspace settings (${company.code})`,async()=>{
 const f=await bannerFixture(company);try{
  const initial=await f.read(),before=f.stable();assert.equal(initial.content.assets.detailTop.provenance,'manual');
  assert.deepEqual(plain(initial.capturedSettingsBanners),{format:'yoofam-captured-settings-banners-v1',productId:f.product().id,contentRevision:initial.content.revision,items:[{role:'detailTop',key:f.top},{role:'detailBottom',key:f.bottom}]});
  const saved=await f.save({detail:{description:'사람이 검토한 상세 설명'}});assert.equal(saved.capturedSettingsBanners.contentRevision,saved.content.revision);assert.deepEqual(plain(saved.capturedSettingsBanners.items),plain(initial.capturedSettingsBanners.items));
  f.h.sqlite.prepare('INSERT OR REPLACE INTO workspace_settings(owner_id,payload,updated_at) VALUES(?,?,?)').run('owner',JSON.stringify({...f.h.settings,topImageEnabled:false,topImageKey:'owner/different-workspace.png'}),new Date().toISOString());
  const later=await f.read();assert.deepEqual(plain(later.capturedSettingsBanners.items),plain(initial.capturedSettingsBanners.items));assert.equal(f.stable(),before);
  assert.equal(f.h.sqlite.prepare('SELECT COUNT(*) AS total FROM supplier_hub_receipts').get().total,0);
 }finally{f.close();}
});
for(const company of companies)test(`direct top replacement and explicit API clearing retain the ordinary content write contract (${company.code})`,async()=>{
 const f=await bannerFixture(company);try{
  const original=await f.read(),body=original.content.assets.detail.value[0],before=f.stable();
  const next=await f.save({assets:{detailTop:[body],detail:original.content.assets.detail.value.slice(1)}});
  assert.deepEqual(plain(next.content.assets.detailTop.value),[body]);assert.deepEqual(plain(next.capturedSettingsBanners.items),[{role:'detailBottom',key:f.bottom}]);
  const cleared=await f.save({assets:{detailTop:[],detailBottom:[]}});assert.equal(cleared.capturedSettingsBanners,undefined);assert.deepEqual(plain(cleared.content.assets.detailTop.value),[]);assert.equal(f.stable(),before);
 }finally{f.close();}
});
test('unknown, missing, foreign or disabled captured evidence never makes content GET fail or locks a direct banner',async()=>{
 for(const mutation of ['missing-link','foreign-owner','foreign-job-owner','foreign-offer','foreign-company','disabled','missing-table','malformed-context']){
  const f=await bannerFixture();try{
   if(mutation==='missing-link')f.h.sqlite.prepare('DELETE FROM collection_products').run();
   if(mutation==='foreign-owner')f.h.sqlite.prepare("UPDATE collection_products SET owner_id='other'").run();
   if(mutation==='foreign-job-owner')f.h.sqlite.prepare("UPDATE collection_jobs SET owner_id='other'").run();
   if(mutation==='foreign-offer')f.h.sqlite.prepare("UPDATE collection_jobs SET offer_id='649000000002'").run();
   if(mutation==='foreign-company')f.h.context.company=companies[1];
   if(mutation==='disabled'){f.h.context.settings.topImageEnabled=false;f.h.context.settings.bottomImageEnabled=false;}
   if(['foreign-company','disabled'].includes(mutation))f.h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(f.h.context));
   if(mutation==='malformed-context')f.h.sqlite.prepare("UPDATE collection_context SET payload='not-json'").run();
   if(mutation==='missing-table')f.h.sqlite.prepare('DROP TABLE collection_products').run();
   const result=await f.read();assert.equal(result.capturedSettingsBanners,undefined,mutation);assert.deepEqual(plain(result.content.assets.detailTop.value),[f.top],mutation);
  }finally{f.close();}
 }
});
test('descriptor validation keeps exact roles, snapshot revisions and keys; protected role changes never infer a banner from provenance',async()=>{
 const f=await bannerFixture();try{
  const model=f.h.load('app/captured-settings-banners.ts'),body=await f.read(),content=body.content,descriptor=body.capturedSettingsBanners,assets=Object.fromEntries(Object.entries(content.assets).map(([role,field])=>[role,Array.from(field.value)])),pool=JSON.parse(f.product().image_keys);
  assert.deepEqual(plain(model.capturedSettingsBannerKeys(descriptor,content,assets,pool)),[f.top,f.bottom]);
  for(const mutate of [value=>{value.contentRevision++;},value=>{value.productId='other';},value=>{value.items[0].role='detail';},value=>{value.items[0].key='owner/other.png';},value=>{value.items.push(value.items[0]);}]){const next=structuredClone(descriptor);mutate(next);assert.equal(model.parseCapturedSettingsBanners(next,content),undefined);}
  const next={...assets,detailTop:[assets.detail[0]]};assert.equal(model.capturedSettingsBannerChangeAllowed(descriptor,content,assets,next,pool),false);
  const plainManual=structuredClone(content);plainManual.assets.detailTop.value=['owner/direct-top.png'];assert.equal(model.parseCapturedSettingsBanners(descriptor,plainManual),undefined);
  assert.equal(model.capturedSettingsBannerChangeAllowed(undefined,content,assets,next,pool),true);assert.equal(model.capturedSettingsBannerChangeAllowed(descriptor,content,assets,{...assets,detail:assets.detail.slice(1)},pool),true);
 }finally{f.close();}
});
