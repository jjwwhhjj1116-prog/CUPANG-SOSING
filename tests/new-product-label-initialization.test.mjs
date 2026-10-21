import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileIntakeHarness } from './helpers/mobile-intake.mjs';
import { collectionNewDraftFixture, forkCompanies } from './helpers/collection-new-draft.mjs';
import { optionSplitFixture } from './helpers/product-option-splits-api.mjs';

const keys = ['productName','importer','manufacturer','countryOfOrigin','netContents','material','productType','precautions','usageStandard'];
const plain = value => JSON.parse(JSON.stringify(value));
const json = async (response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); return response.json(); };
const total = h => Number(h.sqlite.prepare('SELECT total_changes() n').get().n);
const labelRow = (h, id) => h.sqlite.prepare('SELECT * FROM product_labels WHERE product_id=?').get(id);
const dump = h => JSON.stringify(['products','product_labels','product_content','product_options','product_price_policy','product_registration_numbers','product_registration_options','product_registration_counters','collection_products','collection_jobs','collection_context','collection_results','collection_images','collection_offer_claims']
  .map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
async function manual(h, title = '합성 신규 상품') {
  return h.load('app/api/products/route.ts').POST(new Request('https://app.test/api/products', {method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({sourceUrl:h.sourceUrl,title,sourcePriceCny:5.25})}));
}
async function seed(h) {
  await json(await h.route('/api/collection-jobs/job/result', {method:'POST',body:{schemaVersion:1,sourceUrl:h.sourceUrl,provider:'synthetic-label-initialization',collectedAt:new Date().toISOString(),
    title:'합성 신규 원문',description:'합성 설명',attributes:[],options:[{sku:'synthetic-black',name:'검정',unitPriceCny:5,minimumOrder:1,stock:3}],images:[]}}));
}
async function promote(h) { await seed(h); return json(await h.route('/api/collection-jobs/job/product', {method:'POST'})); }
function assertInitial(h, id) {
  const product = h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id), row = labelRow(h,id), state = JSON.parse(row.payload);
  assert.equal(row.owner_id,'owner'); assert.equal(row.revision,1); assert.equal(row.updated_at,product.created_at);
  assert.equal(product.updated_at,product.created_at,'initial structure does not advance the product clock');
  assert.deepEqual(plain(state),{schemaVersion:1,productId:id,revision:1,overrides:{common:{},options:{}},
    structure:plain(h.load('app/product-label.ts').couplusProductLabelStructure()),updatedAt:product.created_at});
  assert.deepEqual(state.structure.map(field=>field.id),keys); assert.equal(Object.hasOwn(state,'renderEpoch'),false);
  return state;
}

for (const company of forkCompanies) {
  test(`manual fresh creation stores an explicit Couplus structure with the initial policy and registration (${company.code})`, async () => {
    const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
    try {
      const {product}=await json(await manual(h),201); assertInitial(h,product.id);
      assert.match(product.registration_number,/^\d{12}$/);
      assert.equal(h.sqlite.prepare('SELECT registration_number FROM product_registration_numbers WHERE product_id=?').get(product.id).registration_number,product.registration_number);
      assert.deepEqual(h.network,[]); assert.equal(h.aiSources.length,0);
    } finally { h.close(); }
  });
  test(`saved source promotion initializes once and reused acknowledgements preserve custom and missing legacy states (${company.code})`, async () => {
    const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
    try {
      const created=await promote(h); assert.equal(created.reused,false); const state=assertInitial(h,created.productId);
      state.structure.push({id:'custom_reviewed',label:'직접 작성한 항목',required:false}); state.overrides.common.custom_reviewed='보존할 값\n두 번째 줄';
      state.overrides.common.manufacturer=''; state.renderEpoch=3;
      h.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(JSON.stringify(state),created.productId);
      let before=dump(h), changes=total(h);
      let retry=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
      assert.equal(retry.reused,true); assert.equal(retry.productId,created.productId); assert.equal(dump(h),before); assert.equal(total(h),changes);
      h.sqlite.prepare('DELETE FROM product_labels WHERE product_id=?').run(created.productId);
      before=dump(h); changes=total(h); retry=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'}));
      assert.equal(retry.reused,true); assert.equal(labelRow(h,created.productId),undefined); assert.equal(dump(h),before); assert.equal(total(h),changes);
      assert.deepEqual(h.network,[]);
    } finally { h.close(); }
  });
  test(`a new retained-source draft gets fresh structure while the old working product and UUID retry remain unchanged (${company.code})`, async () => {
    const f=await collectionNewDraftFixture(company,{images:false});
    try {
      const prior=labelRow(f.api,f.sourceProductId), source=JSON.parse(prior.payload);
      source.structure=[...source.structure].reverse(); source.overrides.common.material='원래 작업 중인 공통 재질'; source.renderEpoch=2;
      f.api.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(JSON.stringify(source),f.sourceProductId);
      const original=f.originalSnapshot(), protectedLabel=JSON.stringify(labelRow(f.api,f.sourceProductId));
      const preview=await f.preview(), requestId=crypto.randomUUID(), created=await f.create(preview,f.input,requestId);
      assert.equal(created.reused,false); assertInitial(f.api,created.productId);
      assert.equal(f.originalSnapshot(),original); assert.equal(JSON.stringify(labelRow(f.api,f.sourceProductId)),protectedLabel);
      const before=dump(f.api), changes=total(f.api), retry=await f.create(preview,f.input,requestId);
      assert.equal(retry.reused,true); assert.equal(retry.productId,created.productId); assert.equal(dump(f.api),before); assert.equal(total(f.api),changes);
      assert.deepEqual(f.api.network,[]);
    } finally { f.close(); }
  });
  test(`missing and custom legacy PNG plans, signatures and server proof metadata remain invariant when a fresh product is created (${company.code})`, async () => {
    const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});
    try {
      const created=await promote(h), id=created.productId, endpoint='/api/products/'+id+'/product-labels';
      const stored=labelRow(h,id), initial=JSON.parse(stored.payload);
      const model=h.load('app/product-label.ts'), upload=h.load('app/product-label-upload.ts'), proof=h.load('app/product-label-proof.ts');
      for (const custom of [false,true]) {
        if(custom){const state={...initial,structure:[...initial.structure].reverse(),overrides:{common:{material:'검토한 재질',manufacturer:''},options:{}},renderEpoch:3};
          state.structure.push({id:'custom_legacy',label:'기존 항목',required:false}); state.overrides.common.custom_legacy='기존\n문구';
          h.sqlite.prepare('INSERT INTO product_labels VALUES(?,?,?,?,?)').run(id,'owner',stored.revision,JSON.stringify(state),stored.updated_at);
        }else h.sqlite.prepare('DELETE FROM product_labels WHERE product_id=?').run(id);
        const view=await json(await h.route(endpoint));
        assert.equal(Object.hasOwn(view,'structure'),custom);
        if(!custom)assert.deepEqual(plain(model.productLabelDefinitions(view).slice(0,3).map(field=>field.key)),['productName','manufacturer','importer']);
        const ctx={productId:id,endpoint,optionId:'collected-1',view}, uploadId=await upload.productLabelUploadId(ctx);
        const recipe={plan:plain(model.productLabelPlan(view,ctx.optionId)),signature:upload.productLabelPreviewSignature(ctx),uploadId,
          metadata:plain(await proof.verifiedProductLabelMetadata(proof.productLabelProofRequest(ctx),view,uploadId))};
        const old=JSON.stringify(labelRow(h,id)??null), product=JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id));
        const fresh=await json(await manual(h,'새 상품 '+custom),201); assertInitial(h,fresh.product.id);
        const after=await json(await h.route(endpoint)), nextCtx={...ctx,view:after}, nextId=await upload.productLabelUploadId(nextCtx);
        assert.deepEqual({plan:plain(model.productLabelPlan(after,ctx.optionId)),signature:upload.productLabelPreviewSignature(nextCtx),uploadId:nextId,
          metadata:plain(await proof.verifiedProductLabelMetadata(proof.productLabelProofRequest(nextCtx),after,nextId))},recipe);
        assert.equal(JSON.stringify(labelRow(h,id)??null),old); assert.equal(JSON.stringify(h.sqlite.prepare('SELECT * FROM products WHERE id=?').get(id)),product);
      }
      assert.deepEqual(h.network,[]);
    } finally { h.close(); }
  });
}

test('seed guards reject cross-owner and stale no-op attempts without initializing existing products', async () => {
  const h=mobileIntakeHarness();
  try {
    const {product}=await json(await manual(h),201), init=h.load('db/product-label-initialization.ts'), before=dump(h), changes=total(h);
    h.sqlite.exec('CREATE TRIGGER ignore_product_collision BEFORE INSERT ON products BEGIN SELECT RAISE(IGNORE); END');
    const ignoredInsert=()=>h.db.prepare('INSERT INTO products SELECT * FROM products WHERE id=?').bind(product.id);
    await h.db.batch([ignoredInsert(),...init.prepareNewProductLabels(h.db,'owner',product.id,product.created_at)]);
    const noOp=h.db.prepare('UPDATE products SET title=title WHERE 0');
    await h.db.batch([noOp,...init.prepareNewProductLabels(h.db,'other-owner',product.id,product.created_at)]);
    await h.db.batch([h.db.prepare('UPDATE products SET title=title WHERE 0'),...init.prepareNewProductLabels(h.db,'owner',product.id,product.created_at)]);
    assert.equal(dump(h),before); assert.equal(total(h),changes);
    h.sqlite.prepare('DELETE FROM product_labels WHERE product_id=?').run(product.id); const missing=dump(h);
    await assert.rejects(h.db.batch([ignoredInsert(),...init.prepareNewProductLabels(h.db,'owner',product.id,product.created_at)]),/NOT NULL/);
    assert.equal(dump(h),missing); assert.equal(labelRow(h,product.id),undefined); assert.deepEqual(h.network,[]);
  } finally { h.close(); }
});

test('seed-boundary owner and birth-clock changes abort creation instead of escaping the companion assertion', async () => {
  for(const mutation of ["owner_id='different-owner'","updated_at='2030-01-01T00:00:00.000Z'"]){
    const h=mobileIntakeHarness();
    try {
      const before=dump(h);
      h.sqlite.exec(`CREATE TRIGGER alter_seed_product AFTER INSERT ON product_labels BEGIN UPDATE products SET ${mutation} WHERE id=NEW.product_id; END`);
      const response=await manual(h); assert.equal(response.status,503,await response.clone().text()); assert.equal(dump(h),before); assert.deepEqual(h.network,[]);
    } finally { h.close(); }
  }
});

test('splitting saved work copies its custom structure and render epoch instead of applying the new-product default', async () => {
  const f=await optionSplitFixture();
  try {
    const network=[...f.api.network];
    const row=labelRow(f.api,f.product.id), state=JSON.parse(row.payload), model=f.api.load('app/product-label.ts');
    state.structure=model.couplusProductLabelStructure().reverse(); state.structure.push({id:'custom_split',label:'분할 전 저장 항목',required:false});
    state.overrides.common.custom_split='보존할 분할 문구'; state.renderEpoch=4;
    f.api.sqlite.prepare('UPDATE product_labels SET payload=? WHERE product_id=?').run(JSON.stringify(state),f.product.id);
    await f.refresh(); const input=f.makeInput(), preview=await f.preview(input), result=await json(await f.commit(input,preview));
    for(const group of result.receipt.groups){const saved=JSON.parse(labelRow(f.api,group.productId).payload);
      assert.deepEqual(saved.structure,plain(state.structure)); assert.equal(saved.renderEpoch,4);
      assert.equal(saved.overrides.common.custom_split,'보존할 분할 문구');
    }
    assert.deepEqual(f.api.network,network,'splitting adds no source or Hub request beyond the recorded-source fixture setup');
  } finally { f.api.close(); }
});

for (const path of ['manual','promotion','fork']) for (const action of ['IGNORE','ABORT']) test(`${path} creation rolls back every new record if the initial label INSERT triggers ${action}`, async () => {
  if(path==='fork'){
    const f=await collectionNewDraftFixture(forkCompanies[0],{images:false});
    try {
      const preview=await f.preview(), before=dump(f.api);
      f.api.sqlite.exec(`CREATE TRIGGER fail_initial_label BEFORE INSERT ON product_labels BEGIN SELECT RAISE(${action}${action==='ABORT'?',\'synthetic seed failure\'':''}); END`);
      const response=await f.request(f.endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...f.input,requestId:crypto.randomUUID(),baseFingerprint:preview.baseFingerprint})});
      assert.equal(response.status,503,await response.clone().text()); assert.equal(dump(f.api),before); assert.deepEqual(f.api.network,[]);
    } finally { f.close(); }
  }else{
    const h=mobileIntakeHarness();
    try {
      if(path==='promotion')await seed(h); const before=dump(h);
      h.sqlite.exec(`CREATE TRIGGER fail_initial_label BEFORE INSERT ON product_labels BEGIN SELECT RAISE(${action}${action==='ABORT'?',\'synthetic seed failure\'':''}); END`);
      const response=path==='manual'?await manual(h):await h.route('/api/collection-jobs/job/product',{method:'POST'});
      assert.equal(response.status,503,await response.clone().text()); assert.equal(dump(h),before); assert.deepEqual(h.network,[]);
    } finally { h.close(); }
  }
});
