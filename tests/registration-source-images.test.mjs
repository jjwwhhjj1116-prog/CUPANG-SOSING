import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';

const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const savedState=h=>JSON.stringify(['products','product_content','product_options','product_price_policy'].map(table=>h.sqlite.prepare(`SELECT * FROM ${table}`).all()));
function insert(h,table,record){
 const columns=Object.keys(record);
 h.sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(record));
}
function linkedProduct(h,base,id,owner='owner',keys=[owner+'/'+id+'.png'],jobOwner=owner){
 const product={...base,id,owner_id:owner,image_keys:JSON.stringify(keys)};insert(h,'products',product);
 const job={...h.sqlite.prepare("SELECT * FROM collection_jobs WHERE id='job'").get(),id:'job-'+id,owner_id:jobOwner,status:'cancelled'};
 insert(h,'collection_jobs',job);
 insert(h,'collection_products',{job_id:job.id,owner_id:owner,product_id:id,created_at:base.created_at});
 insert(h,'collection_images',{job_id:job.id,image_index:0,owner_id:owner,product_id:id,object_key:keys[0],operation_id:'op-'+id,created_at:base.created_at});
 return product;
}

test('new intake preview uses its first persisted original, preserves banner and all editable draft values',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get();
  const original=h.sqlite.prepare('SELECT object_key FROM collection_images WHERE image_index=0').get().object_key;
  const keys=JSON.parse(product.image_keys);const banner='owner/account-banner.png';
  h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([banner,...keys.slice().reverse()]),product.id);
  const before=savedState(h),response=await h.load('app/api/products/route.ts').GET();
  assert.equal(response.headers.get('cache-control'),'no-store');
  const listed=(await json(response)).products[0];assert.equal(listed.source_image_key,original);assert.notEqual(listed.source_image_key,banner);
  assert.equal(listed.content_summary.mainImageKey,null);
  for(const role of ['main','additional','detail','label'])assert.equal(listed.content_summary[role],0);
  assert.equal(savedState(h),before,'list reads never save content, options, price or completion status');
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const chosen=keys[2];await json(await h.route('/api/products/'+product.id+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{main:[chosen]}}}}));
  const edited=(await json(await h.load('app/api/products/route.ts').GET())).products[0];
  assert.equal(edited.content_summary.mainImageKey,chosen);assert.equal(edited.content_summary.main,1);assert.equal(edited.source_image_key,original);
  const view=await json(await h.route('/api/products/'+product.id+'/quotation-fields'));
  for(const row of view.resolved.rows)assert.equal(row.fields.mainImage.value,chosen);
 }finally{h.close();}
});

test('source preview requires exact product, receipt, database owner and image namespace',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const base=h.sqlite.prepare('SELECT * FROM products').get();
  const valid=linkedProduct(h,base,'valid'),foreign=linkedProduct(h,base,'foreign','other');
  const wrongJobOwner=linkedProduct(h,base,'wrong-job-owner','owner',undefined,'other');
  const wrongImageOwner=linkedProduct(h,base,'wrong-image-owner');
  h.sqlite.prepare('UPDATE collection_images SET owner_id=? WHERE product_id=?').run('other',wrongImageOwner.id);
  const foreignKey=linkedProduct(h,base,'foreign-key','owner',['other/foreign.png']);
  const wrongReceipt=linkedProduct(h,base,'wrong-receipt');
  h.sqlite.prepare('UPDATE collection_images SET job_id=?,image_index=99 WHERE product_id=?').run('job',wrongReceipt.id);
  const broken=linkedProduct(h,base,'broken');h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run('broken',broken.id);broken.image_keys='broken';
  const products=[valid,foreign,wrongJobOwner,wrongImageOwner,foreignKey,wrongReceipt,broken];
  const result=await h.load('db/collection-images.ts').readRegistrationSourceImages('owner',products);
  assert.deepEqual({...result},{valid:'owner/valid.png'});
  assert.equal(valid.source_url,wrongReceipt.source_url,'same source URL never substitutes another intake receipt');
  const listing=await json(await h.load('app/api/products/route.ts').GET());
  assert.ok(!listing.products.some(product=>product.id===foreign.id));
  for(const id of ['wrong-job-owner','wrong-image-owner','foreign-key','wrong-receipt','broken'])assert.equal(listing.products.find(product=>product.id===id).source_image_key,null);
 }finally{h.close();}
});

test('removed or concurrently replaced originals never fall back to arbitrary uploaded images',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get();
  const keys=JSON.parse(product.image_keys),first=keys[0],second=keys[1],manual='owner/manual.png';
  const read=h.load('db/collection-images.ts').readRegistrationSourceImages;
  h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([manual,...keys.slice(1)]),product.id);
  product.image_keys=JSON.stringify([manual,...keys.slice(1)]);
  assert.equal((await read('owner',[product]))[product.id],second);
  product.image_keys=JSON.stringify([first]);assert.deepEqual({...await read('owner',[product])},{});
  h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(JSON.stringify([manual]),product.id);product.image_keys=JSON.stringify([manual]);
  assert.deepEqual({...await read('owner',[product])},{});
 }finally{h.close();}
});

test('source preview lookup batches 165 products within D1 binding limits and skips empty inputs',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const base=h.sqlite.prepare('SELECT * FROM products').get();
  const products=Array.from({length:165},(_,i)=>linkedProduct(h,base,'batch-'+i));
  const prepare=h.db.prepare;const bindings=[];let queries=0;
  h.db.prepare=function(sql){const statement=prepare(sql),bind=statement.bind;if(sql.startsWith('WITH ranked'))queries++;
   statement.bind=(...args)=>{bindings.push(args.length);return bind(...args);};return statement;};
  const read=h.load('db/collection-images.ts').readRegistrationSourceImages,result=await read('owner',products);
  assert.equal(Object.keys(result).length,165);assert.equal(queries,3);assert.deepEqual(bindings,[81,81,6]);
  for(const product of products)assert.equal(result[product.id],'owner/'+product.id+'.png');
  const before=queries;assert.deepEqual({...await read('owner',[])},{});
  assert.deepEqual({...await read('owner',[{id:'empty',image_keys:'[]'},{id:'invalid',image_keys:'{}'}])},{});assert.equal(queries,before);
 }finally{h.close();}
});

test('preview lookup failure preserves the product list and selected quotation main image',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),chosen=JSON.parse(product.image_keys)[1];
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  await json(await h.route('/api/products/'+product.id+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{assets:{main:[chosen]}}}}));
  const before=savedState(h),prepare=h.db.prepare;
  h.db.prepare=sql=>{if(sql.startsWith('WITH ranked'))throw Error('private preview query failure');return prepare(sql);};
  const result=await json(await h.load('app/api/products/route.ts').GET());
  assert.equal(result.products.length,1);assert.equal(result.products[0].source_image_key,null);
  assert.equal(result.products[0].content_summary.mainImageKey,chosen);assert.equal(result.products[0].content_summary.main,1);
  assert.equal(savedState(h),before);assert.ok(!JSON.stringify(result).includes('private preview'));
 }finally{h.close();}
});

test('six SKU previews follow recorded image indices without selecting quotation or option images',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),before=savedState(h);
  const view=await json(await h.route('/api/products/'+product.id+'/options'));
  const receipt=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload);
  const originals=new Map(h.sqlite.prepare('SELECT image_index,object_key FROM collection_images').all().map(row=>[row.image_index,row.object_key]));
  assert.equal(Object.keys(view.sourceImageKeys).length,6);
  for(const option of view.options.rows){
   assert.equal(option.imageKey,null);
   assert.equal(view.sourceImageKeys[option.id],originals.get(receipt.options.find(row=>row.sku===option.supplierSku).imageIndex));
  }
  assert.equal(savedState(h),before);
  const read=h.load('db/collection-images.ts').readOptionSourceImages;
  const changed=structuredClone(view.options);changed.rows[0].supplierSku='manual-new-sku';changed.rows[1].translatedName='수정한 이름';
  const changedImages=await read('owner',product,changed);
  assert.equal(changedImages[changed.rows[0].id],undefined);assert.equal(changedImages[changed.rows[1].id],view.sourceImageKeys[changed.rows[1].id]);
  changed.rows[0].supplierSku=changed.rows[1].supplierSku;const duplicates=await read('owner',product,changed);
  assert.equal(duplicates[changed.rows[0].id],undefined);assert.equal(duplicates[changed.rows[1].id],undefined);
  assert.deepEqual({...await read('other',product,view.options)},{});
  assert.deepEqual({...await read('owner',product,{...view.options,productId:'other'})},{});
 }finally{h.close();}
});

test('SKU previews reject disconnected images, receipt mismatch, duplicate source SKUs and malformed originals',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get();
  const options=await h.load('db/product-options.ts').readProductOptions('owner',product.id);
  const receipt=JSON.parse(h.sqlite.prepare('SELECT payload FROM collection_results').get().payload),read=h.load('db/collection-images.ts').readOptionSourceImages;
  const write=value=>h.sqlite.prepare('UPDATE collection_results SET payload=?').run(typeof value==='string'?value:JSON.stringify(value));
  for(const bad of ['broken',{...receipt,offerId:'999'}, {...receipt,schemaVersion:2}, {...receipt,images:[]}, {...receipt,options:['not an option',42,null]}, {...receipt,options:receipt.options[0]}]){write(bad);assert.deepEqual({...await read('owner',product,options)},{});}
  write({...receipt,options:[...receipt.options,receipt.options[0]]});const duplicate=await read('owner',product,options);
  assert.equal(duplicate[options.rows[0].id],undefined);assert.equal(Object.keys(duplicate).length,5);
  write(receipt);const before=await read('owner',product,options),removed=before[options.rows[0].id];
  product.image_keys=JSON.stringify(JSON.parse(product.image_keys).filter(key=>key!==removed));
  h.sqlite.prepare('UPDATE products SET image_keys=? WHERE id=?').run(product.image_keys,product.id);
  const after=await read('owner',product,options);assert.equal(after[options.rows[0].id],undefined);assert.ok(Object.keys(after).length<Object.keys(before).length);
  h.sqlite.prepare('UPDATE collection_results SET owner_id=?').run('other');assert.deepEqual({...await read('owner',product,options)},{});
 }finally{h.close();}
});

test('source preview failure leaves option editing, prices and saved values available',async()=>{
 const h=mobileIntakeHarness();
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),before=savedState(h),prepare=h.db.prepare;
  h.db.prepare=sql=>{if(sql.includes("AS sku,ci.object_key"))throw Error('private source lookup failure');return prepare(sql);};
  const view=await json(await h.route('/api/products/'+product.id+'/options'));
  assert.deepEqual(view.sourceImageKeys,{});assert.equal(view.options.rows.length,6);assert.equal(view.pricing.rows.length,6);
  assert.equal(savedState(h),before);assert.ok(!JSON.stringify(view).includes('private source'));
 }finally{h.close();}
});
