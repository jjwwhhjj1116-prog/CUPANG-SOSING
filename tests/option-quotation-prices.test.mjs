import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {submissionPackageUI} from './helpers/submission-package-ui.mjs';
const native=createRequire(import.meta.url);
const nodes=t=>Array.isArray(t)?t.flatMap(nodes):t&&typeof t==='object'?[t,...nodes(t.props?.children)]:[];
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const version='2026-10-07T00:00:00.000Z',advance=before=>new Date(Date.parse(before)+1).toISOString(),plain=value=>JSON.parse(JSON.stringify(value));
const view=()=>{const schema={categoryId:'80719',categoryPath:['주방'],fields:['supplyPrice','salePrice','msrp'].map(id=>({id,label:id,type:'number',min:1,integer:true}))};
 return{revision:1,inputFingerprint:'a'.repeat(64),productVersion:version,contentRevision:1,optionRevision:1,updatedAt:version,imageKeys:[],categoryContext:{source:'profile',profileId:'profile',categoryId:'80719',categoryPath:['주방']},overrides:{common:{},options:{}},resolved:{schema,rows:[{optionId:'red',optionLabel:'빨강',included:true,fields:Object.fromEntries(['supplyPrice','salePrice','msrp'].map((id,i)=>[id,{value:String((i+1)*100),source:'pricing'}]))}]},automatic:{schema,rows:[{optionId:'red',fields:{supplyPrice:{value:'100',source:'pricing'},salePrice:{value:'200',source:'pricing'},msrp:{value:'300',source:'pricing'}}}]}};
};
function fixture(){const current=view();return{current,reply(url,init={}){
 if(init.method==='PUT'){const body=JSON.parse(init.body);if(body.expectedRevision!==current.revision||body.expectedInputFingerprint!==current.inputFingerprint)return Response.json({error:'동시 수정'},{status:409});
  for(const change of body.changes){const values=change.optionId===null?current.overrides.common:(current.overrides.options[change.optionId]??={});if(change.value===null)delete values[change.fieldKey];else values[change.fieldKey]=change.value;if(change.optionId!==null&&!Object.keys(values).length)delete current.overrides.options[change.optionId];}
  current.revision++;current.productVersion=advance(current.productVersion);current.updatedAt=current.productVersion;current.inputFingerprint=String(current.revision%10).repeat(64);
  for(const row of current.resolved.rows)for(const field of current.resolved.schema.fields){const own=current.overrides.options[row.optionId]??{},common=current.overrides.common,automatic=current.automatic.rows.find(item=>item.optionId===row.optionId).fields[field.id];row.fields[field.id]={...row.fields[field.id],value:Object.hasOwn(own,field.id)?own[field.id]:Object.hasOwn(common,field.id)?common[field.id]:automatic.value,source:Object.hasOwn(own,field.id)?'manual-option':Object.hasOwn(common,field.id)?'manual-common':automatic.source};}
 }
 const output=plain(current);if(url.includes('profileId=other'))output.categoryContext.profileId='other';return Response.json(output);
}};}
function harness(fetcher,initial={}){
 const slots=[],effects=[],layouts=[],calls=[],cache=new Map();let cursor=0,saved=0,closed=false,lateWrites=0,currentVersion=initial.version??version,refreshToken='0',productId=initial.productId??'p',profileId=Object.hasOwn(initial,'profileId')?initial.profileId:'profile';
 const effect=(queue,fn,deps)=>{const i=cursor++,old=slots[i];if(!old||JSON.stringify(old.deps)!==JSON.stringify(deps)){const entry={deps,cleanup:old?.cleanup};slots[i]=entry;queue.push(()=>{entry.cleanup?.();entry.cleanup=fn();});}};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{if(closed){lateWrites++;return;}slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},useEffect(fn,deps){effect(effects,fn,deps);},useLayoutEffect(fn,deps){effect(layouts,fn,deps);}};
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,structuredClone,TextEncoder,fetch:async(url,init)=>{calls.push({url,init});return fetcher(url,init);},require(name){if(name==='react')return react;return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);}});return exports;}
 const Component=load('app/components/option-quotation-prices.tsx').OptionQuotationPrices;
 const render=(flush=true)=>{cursor=0;const tree=Component({productId,version:currentVersion,refreshToken,profileId,onSaved(){saved++;}});layouts.splice(0).forEach(fn=>fn());if(flush)effects.splice(0).forEach(fn=>fn());return tree;};
 const button=text=>nodes(render()).find(n=>n.type==='button'&&n.props.children===text);
 const input=label=>nodes(render()).find(n=>n.props?.['aria-label']===label);
 const idle=async()=>{const deadline=Date.now()+10000;let stable=0,last='';for(;;){render();await new Promise(resolve=>setImmediate(resolve));const tree=render(),identity=JSON.stringify([currentVersion,refreshToken,productId,profileId,calls.length]);stable=!tree.props['data-workspace-saving']&&!effects.length&&!layouts.length&&identity===last?stable+1:0;if(stable>=3)return;last=identity;assert.ok(Date.now()<deadline,'price UI request timed out');await new Promise(resolve=>setTimeout(resolve,1));}};
 render();return {render,button,input,calls,idle,load,get saved(){return saved;},get lateWrites(){return lateWrites;},refresh(v,flush=true){refreshToken=v;render(flush);},setVersion(v,flush=true){currentVersion=v;render(flush);},select(p,c,flush=true){productId=p;profileId=c;render(flush);},close(){closed=true;slots.forEach(s=>s?.cleanup?.());}};
}

test('stage-two direct price saves only the changed option field using the same quotation version',async()=>{
 const f=fixture(),h=harness((url,init)=>f.reply(url,init));await settle();
 h.input('빨강 공급가').props.onChange({target:{value:'150'}});
 const click=h.button('옵션 가격 저장').props.onClick;click();click();await settle();
 const writes=h.calls.filter(c=>c.init.method==='PUT');assert.equal(writes.length,1);
 const body=JSON.parse(writes[0].init.body);assert.deepEqual(body.changes,[{optionId:'red',fieldKey:'supplyPrice',value:'150'}]);assert.equal(body.expectedRevision,1);assert.equal(body.expectedInputFingerprint,'a'.repeat(64));assert.match(writes[0].url,/profileId=profile/);assert.equal(h.saved,1);
});

test('retained price callbacks submit the latest synchronous edits and preserve an intentional optional blank',async()=>{
 const f=fixture(),h=harness((url,init)=>f.reply(url,init));try{
  await h.idle();h.input('빨강 공급가').props.onChange({target:{value:'150'}});const captured=h.button('옵션 가격 저장').props.onClick;
  h.input('빨강 공급가').props.onChange({target:{value:'170'}});h.input('빨강 권장소비자가').props.onChange({target:{value:''}});captured();captured();await h.idle();
  const writes=h.calls.filter(call=>call.init.method==='PUT');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].init.body).changes,[{optionId:'red',fieldKey:'supplyPrice',value:'170'},{optionId:'red',fieldKey:'msrp',value:''}]);
  assert.equal(h.saved,1);assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.input('빨강 공급가').props.value,'170');assert.equal(h.input('빨강 권장소비자가').props.value,'');
 }finally{h.close();}
});

test('unchanged, wrong-scope or forged manual-price acknowledgements retain all edits instead of claiming success',async()=>{
 for(const [name,mutate]of[
  ['unchanged',(_body,before)=>before],['revision',body=>{body.revision++;}],['clock',body=>{body.productVersion=version;}],['updatedAt',body=>{body.updatedAt=version;}],
  ['input proof',body=>{body.inputFingerprint='a'.repeat(64);}],['content',body=>{body.contentRevision++;}],['options',body=>{body.optionRevision++;}],
  ['category',body=>{body.categoryContext.profileId='other';}],['wire definition',body=>{body.resolved.schema.fields[0].maxLength=99;}],
  ['common override',body=>{body.overrides.common.msrp='999';}],['other override',body=>{body.overrides.options.blue={salePrice:'999'};}],
  ['other returned price',body=>{body.resolved.rows[1].fields.salePrice.value='999';}],
  ['other automatic price',body=>{body.automatic.rows[1].fields.salePrice.value='999';body.resolved.rows[1].fields.salePrice.value='999';}],
  ['other title',body=>{body.resolved.rows[1].fields.title.value='unexpected title';}],['missing row',body=>{body.resolved.rows.pop();body.automatic.rows.pop();}],
  ['image source',body=>{body.imageKeys.push('owner/other.png');}],['selected cell',body=>{body.resolved.rows[0].fields.supplyPrice.value='151';}],
 ]){
  const f=fixture();f.current.resolved.schema.fields.push({id:'title',label:'상품명',type:'text'});
  f.current.resolved.rows[0].fields.title={value:'unchanged title',source:'product'};f.current.automatic.rows[0].fields.title={value:'unchanged title',source:'product'};
  f.current.resolved.rows.push({...plain(f.current.resolved.rows[0]),optionId:'blue',optionLabel:'파랑'});f.current.automatic.rows.push({...plain(f.current.automatic.rows[0]),optionId:'blue'});
  const before=plain(f.current),h=harness((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'){const body=plain(f.current),replacement=mutate(body,before);return Response.json(replacement??body);}return response;});
  try{await h.idle();h.input('빨강 공급가').props.onChange({target:{value:'150'}});h.button('옵션 가격 저장').props.onClick();await h.idle();
   assert.equal(h.saved,0,name);assert.equal(h.render().props['data-workspace-dirty'],true,name);assert.equal(h.input('빨강 공급가').props.value,'150',name);assert.equal(h.input('파랑 판매가').props.value,'200',name);
   assert.match(JSON.stringify(h.render()),/확인하지 못했습니다|다릅니다/,name);assert.equal(h.calls.filter(call=>call.init.method==='PUT').length,1,name);
  }finally{h.close();}
 }
});

test('a reset price acknowledgement must prove the final common/automatic value and source',async()=>{
 const f=fixture();f.current.overrides.common.salePrice='220';f.current.overrides.options.red={salePrice:'250'};f.current.resolved.rows[0].fields.salePrice={value:'250',source:'manual-option'};
 const h=harness((url,init)=>{const response=f.reply(url,init);if(init?.method==='PUT'){const forged=plain(f.current);forged.resolved.rows[0].fields.salePrice={value:'250',source:'manual-option'};return Response.json(forged);}return response;});
 try{await h.idle();nodes(h.render()).filter(node=>node.type==='button'&&node.props.children==='복원')[1].props.onClick();h.button('옵션 가격 저장').props.onClick();await h.idle();
  assert.equal(h.saved,0);assert.equal(h.render().props['data-workspace-dirty'],true);assert.equal(h.input('빨강 판매가').props.value,'220');assert.equal(f.current.overrides.options.red,undefined);
  h.button('입력 유지·최신 가격 조회').props.onClick();await h.idle();assert.equal(h.saved,1);assert.equal(h.input('빨강 판매가').props.value,'220');assert.equal(h.render().props['data-workspace-dirty'],false);assert.equal(h.calls.filter(call=>call.init.method==='PUT').length,1);
 }finally{h.close();}
});

test('layout source guards reject retained callbacks before passive cleanup and ignore aborted writes after source change',async()=>{
 for(const kind of ['version','refresh','category','product','unmount']){
  const f=fixture();let finish,sent;const pending=new Promise(resolve=>finish=resolve),h=harness((url,init)=>{if(init?.method==='PUT'){sent={url,init};return pending;}if(url.includes('profileId=other')||url.includes('/other-product/')){const body=view();if(url.includes('profileId=other'))body.categoryContext.profileId='other';return Response.json(body);}return f.reply(url,init);});
  try{await h.idle();h.input('빨강 판매가').props.onChange({target:{value:'270'}});const oldEdit=h.input('빨강 판매가').props.onChange,oldSave=h.button('옵션 가격 저장').props.onClick;oldSave();
   if(kind==='version')h.setVersion(advance(version),false);else if(kind==='refresh')h.refresh('1',false);else if(kind==='category')h.select('p','other',false);else if(kind==='product')h.select('other-product','profile',false);else h.close();
   assert.equal(sent.init.signal.aborted,true,kind);oldEdit({target:{value:'999'}});oldSave();assert.equal(h.calls.filter(call=>call.init.method==='PUT').length,1,kind);
   finish(f.reply(sent.url,sent.init));await settle();if(kind!=='unmount')await h.idle();assert.equal(h.saved,0,kind);assert.equal(h.lateWrites,0,kind);
   if(kind!=='unmount'){const field=h.input('빨강 판매가');assert.ok(field,JSON.stringify({kind,alerts:nodes(h.render()).filter(node=>node.props?.role==='alert').map(node=>node.props.children),reads:h.calls.filter(call=>call.init.method!=='PUT').map(call=>call.url)}));assert.equal(field.props.value,kind==='version'||kind==='refresh'?'270':'200',kind);}
  }finally{if(kind!=='unmount')h.close();}
 }
});

test('explicit refresh refuses older parent-known clocks and changed category/price rules without discarding a draft',async()=>{
 for(const kind of ['clock','category','schema','option']){
  const f=fixture();let changed=false;const h=harness((url,init)=>{if(!changed)return f.reply(url,init);const body=plain(f.current);if(kind==='category')body.categoryContext.categoryId='69900';if(kind==='schema')body.resolved.schema.fields[0].maxLength=99;if(kind==='option'){body.resolved.rows[0].included=false;}return Response.json(body);});
  try{await h.idle();h.input('빨강 판매가').props.onChange({target:{value:'270'}});changed=true;if(kind==='clock')h.setVersion(advance(version));
   h.button('입력 유지·최신 가격 조회').props.onClick();await h.idle();assert.equal(h.saved,0,kind);assert.equal(h.input('빨강 판매가').props.value,'270',kind);assert.equal(h.render().props['data-workspace-dirty'],true,kind);assert.equal(h.calls.some(call=>call.init.method==='PUT'),false,kind);
  }finally{h.close();}
 }
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`a real committed price save lost its ACK and recovers once by explicit read while the parent clock remains old (${company.companyCode})`,async()=>{
 const api=mobileIntakeHarness(company);let ui;try{
  await api.intake();const product=api.sqlite.prepare('SELECT * FROM products').get(),endpoint='/api/products/'+product.id+'/quotation-fields',before=await (await api.route(endpoint)).json(),selected=before.resolved.rows.find(row=>row.included),others=plain(before.overrides);let lost=true;
  ui=harness(async(url,init)=>{const response=await api.route(url,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})});if(init?.method==='PUT'&&response.ok&&lost){lost=false;throw Error('committed price ACK lost');}return response;},{productId:product.id,version:before.productVersion,profileId:undefined});
  await ui.idle();for(const [caption,value]of[['공급가','12345'],['판매가','23456'],['권장소비자가','']])ui.input(selected.optionLabel+' '+caption).props.onChange({target:{value}});
  ui.button('옵션 가격 저장').props.onClick();await ui.idle();assert.equal(ui.saved,0);assert.equal(ui.render().props['data-workspace-dirty'],true);assert.match(JSON.stringify(ui.render()),/committed price ACK lost/);
  ui.button('입력 유지·최신 가격 조회').props.onClick();await ui.idle();assert.equal(ui.saved,1);assert.equal(ui.render().props['data-workspace-dirty'],false);assert.equal(ui.calls.filter(call=>call.init.method==='PUT').length,1);
  const final=await (await api.route(endpoint)).json(),row=final.resolved.rows.find(row=>row.optionId===selected.optionId);assert.notEqual(final.productVersion,before.productVersion);
  for(const [id,value]of[['supplyPrice','12345'],['salePrice','23456'],['msrp','']]){assert.equal(row.fields[id].value,value);assert.equal(row.fields[id].source,'manual-option');}
  assert.deepEqual(final.overrides.common,others.common);for(const id of Object.keys(others.options))if(id!==selected.optionId)assert.deepEqual(final.overrides.options[id],others.options[id]);
  ui.button('저장 가격 다시 조회').props.onClick();await ui.idle();assert.equal(ui.saved,1);assert.equal(ui.calls.filter(call=>call.init.method==='PUT').length,1);assert.equal(api.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{ui?.close();api.close();}
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`unsaved option prices can recover after saving a new policy without losing blanks or same-value intent (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company),json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};let prices;
 try{
  await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const current=await json(await h.route(base+'/quotation-fields')),target=current.resolved.rows.find(row=>row.included);
  prices=harness((path,init)=>h.route(path,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}),{productId:product.id,profileId:undefined,version:current.productVersion});await prices.idle();
  const label=field=>target.optionLabel+' '+field;
  const manual=[['공급가',target.fields.supplyPrice.value],['판매가','99000'],['권장소비자가','']];
  for(const [field,value]of manual)prices.input(label(field)).props.onChange({target:{value}});
  const policy={...JSON.parse(product.pricing_policy??h.sqlite.prepare('SELECT payload FROM product_price_policy WHERE product_id=?').get(product.id).payload),exchangeRate:400};
  const saved=await json(await h.route(base+'/pricing',{method:'POST',body:{expectedVersion:current.productVersion,policy}}));
  prices.setVersion(saved.product.updated_at);await prices.idle();
  for(let attempt=0;attempt<2;attempt++){prices.button('옵션 가격 저장').props.onClick();await prices.idle();assert.equal(prices.saved,0);}
  for(const [field,value]of manual)assert.equal(prices.input(label(field)).props.value,value);
  const before=prices.calls.filter(call=>call.init.method==='PUT').length;
  const recover=prices.button('입력 유지·최신 가격 조회');assert.ok(recover,'retain the manual draft while refreshing its stale save base');
  recover.props.onClick();await prices.idle();assert.equal(prices.calls.filter(call=>call.init.method==='PUT').length,before,'recovery only reads');
  for(const [field,value]of manual)assert.equal(prices.input(label(field)).props.value,value);
  prices.button('옵션 가격 저장').props.onClick();await prices.idle();assert.equal(prices.saved,1);
  const final=await json(await h.route(base+'/quotation-fields')),row=final.resolved.rows.find(row=>row.optionId===target.optionId);
  for(const [field,value]of [['supplyPrice',manual[0][1]],['salePrice','99000'],['msrp','']]){assert.equal(row.fields[field].value,value);assert.equal(row.fields[field].source,'manual-option');}
  const last=JSON.parse(prices.calls.filter(call=>call.init.method==='PUT').at(-1).init.body);assert.notEqual(last.expectedInputFingerprint,current.inputFingerprint);
  // A conflicting reviewed value is never rebased away by the recovery read.
  prices.input(label('판매가')).props.onChange({target:{value:'98000'}});
  const other=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:final.revision,expectedInputFingerprint:final.inputFingerprint,
   changes:[{optionId:target.optionId,fieldKey:'salePrice',value:'97000'}]}}));
  prices.setVersion(other.productVersion);await prices.idle();
  const writes=prices.calls.filter(call=>call.init.method==='PUT').length;
  prices.button('입력 유지·최신 가격 조회').props.onClick();await prices.idle();
  assert.equal(prices.input(label('판매가')).props.value,'98000');assert.match(JSON.stringify(prices.render()),/다른 저장값/);
  assert.equal(prices.calls.filter(call=>call.init.method==='PUT').length,writes);
  prices.button('옵션 가격 저장').props.onClick();await prices.idle();assert.equal(prices.saved,1);
  const unchanged=await json(await h.route(base+'/quotation-fields'));assert.equal(unchanged.overrides.options[target.optionId].salePrice,'97000');
  prices.button('입력 취소·저장 가격 다시 조회').props.onClick();await prices.idle();assert.equal(prices.input(label('판매가')).props.value,'97000');
  assert.equal(h.aiSources.length,1);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{prices?.close();h.close();}
});

test('price draft recovery preserves inputs after a failed read and ignores a response after category switch or unmount',async()=>{
 for(const end of ['retry','category','unmount']){
  let reads=0,finish;const pending=new Promise(resolve=>finish=resolve);
  const h=harness(async url=>{reads++;if(reads===1)return Response.json(view());if(reads===2)return Response.json({error:'fixture recovery offline'},{status:503});if(reads===3)return pending;const body=view();if(url.includes('profileId=other'))body.categoryContext.profileId='other';return Response.json(body);});
  try{
   await h.idle();h.input('빨강 판매가').props.onChange({target:{value:'270'}});
   h.button('입력 유지·최신 가격 조회').props.onClick();await h.idle();assert.equal(h.input('빨강 판매가').props.value,'270');assert.match(JSON.stringify(h.render()),/fixture recovery offline/);
   h.button('입력 유지·최신 가격 조회').props.onClick();const read=h.calls.at(-1);
   if(end==='category'){h.select('p','other');await h.idle();}else if(end==='unmount')h.close();
   const latest=view();latest.revision=2;latest.inputFingerprint='b'.repeat(64);latest.productVersion=advance(version);latest.updatedAt=latest.productVersion;latest.resolved.rows[0].fields.salePrice.value='220';latest.automatic.rows[0].fields.salePrice.value='220';
   finish(Response.json(latest));await settle();
   if(end==='retry'){assert.equal(h.input('빨강 판매가').props.value,'270');assert.equal(h.render().props['data-workspace-dirty'],true);}
   else assert.equal(read.init.signal.aborted,true);
   if(end==='category')assert.equal(h.input('빨강 판매가').props.value,'200');
   assert.equal(h.saved,0);assert.equal(h.calls.some(call=>call.init.method==='PUT'),false);
  }finally{h.close();}
 }
});

for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])
for(const scenario of [
 {name:'nearest',unitCostCny:0.6833333333333333,exchangeRate:100,roundingMode:'nearest',minimumMargin:0,expected:[200,330,430]},
 {name:'ceiling',unitCostCny:0.33333333333333337,exchangeRate:350,roundingMode:'up',minimumMargin:0,expected:[360,600,780]},
 {name:'minimum',unitCostCny:0.35000000000000003,exchangeRate:100,roundingMode:'up',minimumMargin:5,expected:[120,200,260]},
])test(`exact pack prices reach both stages, workbook and handoff (${company.companyCode}, ${scenario.name})`,async()=>{
 const h=mobileIntakeHarness(company),json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 let prices;
 try{
  const schema=h.load('app/quotation-schema.ts'),fields=['skuId','categoryId',...schema.getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'묶음 원가 경계 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic-pack-prices.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const options=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);
  rows[0].unitCostCny=scenario.unitCostCny;rows[0].unitsPerPack=3;rows[5].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  const policy={exchangeRate:scenario.exchangeRate,supplyMargin:0,coupangMargin:40,minimumMargin:scenario.minimumMargin,msrpMultiple:1.3,roundingUnit:10,roundingMode:scenario.roundingMode};
  const latest=h.sqlite.prepare('SELECT * FROM products').get();
  await json(await h.route(base+'/pricing',{method:'POST',body:{expectedVersion:latest.updated_at,policy}}));
  // The older generic export route must use the same engine, not a rounded pack total.
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const saved=h.sqlite.prepare('SELECT * FROM products').get();saved.pricing_policy=JSON.stringify(policy);
  const legacy=h.load('app/exports/quotation-data.ts').quotationData(saved,content,h.settings,rows,[]);
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>legacy[0][key]),scenario.expected);
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'PACK-REVIEWED',material:'검토 재질'},
   assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const read=()=>h.route(base+'/quotation-fields').then(json);
  let current=await read();
  current=await json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes:[
   {fieldKey:'taxType',optionId:null,value:'과세'},{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
   {fieldKey:'storageMaterial',optionId:null,value:''},
   {fieldKey:'supplyPrice',optionId:'collected-2',value:'990'},{fieldKey:'salePrice',optionId:'collected-2',value:'1990'},
   {fieldKey:'msrp',optionId:'collected-2',value:''},
  ]}}));
  prices=harness((path,init)=>h.route(path,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}),{productId:product.id,profileId:undefined,version:current.productVersion});
  await prices.idle();
  const target=current.resolved.rows.find(row=>row.optionId==='collected-1');
  for(const [index,[key,label]] of [['supplyPrice','공급가'],['salePrice','판매가'],['msrp','권장소비자가']].entries()){
   assert.equal(target.fields[key].value,String(scenario.expected[index]));assert.equal(target.fields[key].source,'pricing');
   assert.equal(prices.input(target.optionLabel+' '+label).props.value,String(scenario.expected[index]));
  }
  const requests=h.network.length;await h.intake();assert.equal(h.network.length,requests);assert.equal(h.aiSources.length,1);
  current=await read();assert.equal(current.resolved.rows.find(row=>row.optionId==='collected-2').fields.msrp.value,'');
  const source=h.load('app/exports/quotation-source.ts'),fingerprint=h.load('app/automation/model.ts').fingerprint;
  const editing=await source.readQuotationExportSource('owner',product.id,null);
  const oldInput=await fingerprint({inputs:{categoryId:editing.categoryContext.categoryId,categoryPath:editing.categoryContext.categoryPath,
   product:editing.product,content:editing.content,options:editing.options,settings:editing.settings},schema:current.automatic.schema,
   categoryContext:editing.categoryContext,profileRevision:null,settingsPayload:editing.source.settingsPayload,collection:editing.source.collection});
  assert.notEqual(current.inputFingerprint,oldInput);
  assert.equal((await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:oldInput,
   changes:[{fieldKey:'salePrice',optionId:'collected-1',value:'9999'}]}})).status,409);
  const mapped=await source.readMappedQuotationSource('owner',product.id,null),dataStartRow=h.load('app/category-profiles.ts').quotationStartRow(mapped.profile.template);
  const oldExport=await fingerprint({format:'sourceflow-quotation-fields-v1',saved:mapped,dataStartRow,
   schema:schema.getQuotationSchema(mapped.categoryContext.categoryId,mapped.categoryContext.categoryPath)});
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.notEqual(preview.fingerprint,oldExport);
  for(const action of ['export','download'])assert.equal((await h.route(base+'/quotation',{method:'POST',body:{action,fingerprint:oldExport}})).status,409);
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200);
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))),fieldFile=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  const exported=index=>{const cells=reader.xlsxHeaders(sheet,'견적서',index+2);return Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));};
  const first=exported(0);assert.equal(first.quantity,'3');assert.equal(first.categoryId,'80719');
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>Number(first[key])),scenario.expected);
  assert.deepEqual(['supplyPrice','salePrice','msrp'].map(key=>fieldFile.rows[0].fields[key].value),scenario.expected.map(String));
  const manual=exported(1);assert.equal(manual.supplyPrice,'990');assert.equal(manual.salePrice,'1990');assert.equal(manual.msrp,'');
  assert.deepEqual(fieldFile.excludedOptions.map(row=>row.optionId),['collected-6']);
  const ui=submissionPackageUI({route:h.route,productId:product.id});await ui.click('견적서 + 첨부 파일 준비');
  await ui.click('확장에 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  const handoff=ui.calls.find(call=>call.action==='transmit');assert.ok(handoff);assert.equal(handoff.files.includedOptions,5);
  assert.deepEqual(handoff.files.company,plan.company);
  assert.deepEqual(Buffer.from(handoff.files.quotation[0].base64,'base64'),Buffer.from(files.get(plan.quotation.file.filename)));
  assert.deepEqual(ui.alerts(),[]);assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{prices?.close();h.close();}
});

function failedAutomaticPrices(common={}){
 const h=mobileIntakeHarness();
 try{
  const options=h.load('app/product-options.ts'),model=h.load('app/quotation-schema.ts');
  const source={categoryId:'80719',product:{id:'p',title:'가격 시험',image_keys:'[]',supply_price:100,sale_price:200,msrp:300,
   pricing_policy:JSON.stringify({...h.load('app/pricing.ts').pricePolicy(h.settings),exchangeRate:1e9})},
   settings:h.settings,content:h.load('app/product-content.ts').emptyProductContent('p'),
   options:options.applyOptionRows(options.emptyProductOptions('p'),[{...options.emptyOptionInput('red'),originalName:'빨강',included:true,unitCostCny:1e9,unitsPerPack:1e6}], 'v')};
  const overrides={common,options:{}};
  const resolved=model.resolveQuotationFields({...source,overrides}),automatic=model.resolveQuotationFields(source);
  return {...view(),categoryContext:{...view().categoryContext,categoryPath:resolved.schema.categoryPath},overrides,resolved,automatic};
 }finally{h.close();}
}

test('stage-two restoration retains a real automatic calculation failure on an optional price',async()=>{
 const initial=failedAutomaticPrices({supplyPrice:'100',salePrice:'200'});
 const automatic=initial.automatic.rows.find(row=>row.optionId==='red').fields.msrp;
 assert.ok(automatic.validationIssues.some(issue=>issue.includes('계산 가능한 가격 범위')));
 const h=harness(async()=>Response.json(initial));await settle();
 assert.match(JSON.stringify(h.render()),/계산 가능한 가격 범위/);
 h.input('빨강 공급가').props.onChange({target:{value:'150'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 h.input('빨강 권장소비자가').props.onChange({target:{value:'400'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);
 nodes(h.render()).filter(n=>n.type==='button'&&n.props.children==='복원')[2].props.onClick();
 assert.equal(h.input('빨강 권장소비자가').props.value,'');
 assert.match(JSON.stringify(h.render()),/계산 가능한 가격 범위/);
 assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 h.button('옵션 가격 저장').props.onClick();await settle();
 assert.equal(h.calls.filter(call=>call.init.method==='PUT').length,0);h.close();
});

test('reviewed common prices replace calculation diagnostics, and deliberate optional blanks remain editable',async()=>{
 const initial=failedAutomaticPrices({supplyPrice:'100',salePrice:'200',msrp:'300'});
 const h=harness(async()=>Response.json(initial));await settle();
 assert.doesNotMatch(JSON.stringify(h.render()),/계산 가능한 가격 범위/);
 h.input('빨강 권장소비자가').props.onChange({target:{value:''}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);
 nodes(h.render()).filter(n=>n.type==='button'&&n.props.children==='복원')[2].props.onClick();
 assert.equal(h.input('빨강 권장소비자가').props.value,'300');
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);h.close();
});

test('price relationship errors use current edits rather than stale automatic diagnostics',async()=>{
 const initial=view();initial.resolved.schema.salePriceMustCoverSupply=true;
 initial.resolved.rows[0].fields.salePrice.value='50';initial.automatic.rows[0].fields.salePrice.value='50';
 initial.automatic.rows[0].fields.salePrice.validationIssues=['판매가는 공급가보다 작을 수 없습니다.'];
 const h=harness(async()=>Response.json(initial));await settle();
 assert.match(JSON.stringify(h.render()),/빨강 · 판매가: 판매가는 공급가보다 작을 수 없습니다/);
 h.input('빨강 공급가').props.onChange({target:{value:'40'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,false);
 assert.doesNotMatch(JSON.stringify(h.render()),/공급가보다 작을/);
 h.input('빨강 공급가').props.onChange({target:{value:'60'}});
 assert.equal(h.button('옵션 가격 저장').props.disabled,true);h.close();
});

test('price conflicts preserve entered values and reload is explicit; invalid prices cannot save',async()=>{
 const h=harness(async(url,init)=>init.method==='PUT'?Response.json({error:'동시 수정'},{status:409}):Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'250'}});h.button('옵션 가격 저장').props.onClick();await settle();
 assert.equal(h.input('빨강 판매가').props.value,'250');assert.match(JSON.stringify(h.render()),/동시 수정/);assert.equal(h.saved,0);
 h.input('빨강 공급가').props.onChange({target:{value:'-1'}});assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 h.button('입력 취소·저장 가격 다시 조회').props.onClick();await settle();assert.equal(h.input('빨강 판매가').props.value,'200');
});

test('restoring an option price sends null and verifies the common override before automatic calculation',async()=>{
 const f=fixture(),initial=f.current;initial.overrides.common.salePrice='220';initial.resolved.rows[0].fields.salePrice={value:'250',source:'manual-option'};initial.overrides.options.red={salePrice:'250'};
 const h=harness((url,init)=>f.reply(url,init));await settle();
 nodes(h.render()).filter(n=>n.type==='button'&&n.props.children==='복원')[1].props.onClick();assert.equal(h.input('빨강 판매가').props.value,'220');
 h.button('옵션 가격 저장').props.onClick();await settle();assert.equal(JSON.parse(h.calls.at(-1).init.body).changes[0].value,null);assert.equal(h.saved,1);assert.equal(h.input('빨강 판매가').props.value,'220');h.close();
});

test('version changes retain edits and unmount aborts an in-flight write',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const h=harness(async(url,init)=>init.method==='PUT'?pending:Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});h.button('옵션 가격 저장').props.onClick();const write=h.calls.at(-1);
 h.setVersion(advance(version),false);assert.equal(write.init.signal.aborted,true);assert.equal(h.input('빨강 판매가').props.value,'270');h.close();finish(Response.json(view()));await settle();assert.equal(h.saved,0);assert.equal(h.lateWrites,0);
});

test('quotation source saves refresh clean stage-two prices while retaining unsaved edits on later clocks',async()=>{
 const latest=view();const h=harness(async()=>Response.json(latest));await settle();
 latest.revision++;latest.productVersion=advance(latest.productVersion);latest.updatedAt=latest.productVersion;latest.inputFingerprint='b'.repeat(64);latest.overrides.options.red={salePrice:'260'};latest.resolved.rows[0].fields.salePrice={value:'260',source:'manual-option'};h.setVersion(latest.productVersion);h.refresh('1');await settle();
 assert.equal(h.input('빨강 판매가').props.value,'260');assert.equal(h.calls.length,2);
 h.input('빨강 판매가').props.onChange({target:{value:'280'}});
 latest.revision++;latest.productVersion=advance(latest.productVersion);latest.updatedAt=latest.productVersion;latest.inputFingerprint='c'.repeat(64);latest.overrides.options.red.salePrice='290';latest.resolved.rows[0].fields.salePrice.value='290';h.setVersion(latest.productVersion);h.refresh('2');await settle();
 assert.equal(h.input('빨강 판매가').props.value,'280');assert.equal(h.calls.length,2);
});


test('changing category or product clears old prices even when the new lookup fails',async()=>{
 const h=harness(async(url)=>url.includes('profileId=other')?Response.json({error:'조회 실패'},{status:500}):Response.json(view()));await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});
 h.select('p','other');await settle();
 assert.equal(h.input('빨강 판매가'),undefined);assert.equal(h.button('옵션 가격 저장').props.disabled,true);
 assert.equal(h.calls.filter(c=>c.init.method==='PUT').length,0);
 h.select('second','profile');await settle();assert.equal(h.input('빨강 판매가').props.value,'200');
 assert.match(h.calls.at(-1).url,/products\/second\//);
});

test('switching category aborts an old save and ignores its late response',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve);
 const h=harness(async(url,init)=>{if(init.method==='PUT')return pending;const body=view();if(url.includes('profileId=other'))body.categoryContext.profileId='other';return Response.json(body);});await settle();
 h.input('빨강 판매가').props.onChange({target:{value:'270'}});h.button('옵션 가격 저장').props.onClick();
 const write=h.calls.at(-1);h.select('p','other');await settle();assert.equal(write.init.signal.aborted,true);
 const stale=view();stale.resolved.rows[0].fields.salePrice.value='270';finish(Response.json(stale));await settle();
 assert.equal(h.saved,0);assert.equal(h.input('빨강 판매가').props.value,'200');
});

// Recorded source facts and real APIs/SQLite/React/XLSX. Auth, AI, image bytes,
// and the 80719 workbook are fixtures; the final Hub transport is captured.
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test(`stage-two and stage-seven price edits survive repricing, retry and handoff (${company.companyCode})`,async()=>{
 const h=mobileIntakeHarness(company),json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
 let prices;
 try{
  const schema=h.load('app/quotation-schema.ts'),fields=['skuId','categoryId',...schema.getQuotationSchema('80719').fields.map(field=>field.id)];
  const workbook=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',workbook)).toString('hex');
  const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,workbook);
  const profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'합성 가격 연동 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
   template:{name:'synthetic-prices.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},
   mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
  h.context.category=profile;h.sqlite.prepare("UPDATE collection_context SET payload=? WHERE job_id='job'").run(JSON.stringify(h.context));
  await h.intake();
  const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id;
  const options=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(options.options);
  rows[0].unitsPerPack=2;rows[5].included=false;
  await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:options.options.revision,expectedProductVersion:options.productVersion,rows}}));
  const content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);
  const images=h.sqlite.prepare('SELECT object_key FROM collection_images ORDER BY image_index').all().map(row=>row.object_key);
  await json(await h.route(base+'/content',{method:'PATCH',body:{expectedRevision:content.revision,patch:{label:{model:'REVIEWED-MODEL',material:'검토 재질'},
   assets:{main:[images[0]],additional:[images[1]],detail:[images[2]],label:[images[3]]}}}}));
  const read=()=>h.route(base+'/quotation-fields').then(json);
  const write=async changes=>{const current=await read();return json(await h.route(base+'/quotation-fields',{method:'PUT',body:{expectedRevision:current.revision,expectedInputFingerprint:current.inputFingerprint,changes}}));};
  let current=await write([
   {fieldKey:'supplyPrice',optionId:null,value:'5000'},{fieldKey:'salePrice',optionId:null,value:'9000'},{fieldKey:'msrp',optionId:null,value:'12000'},
   {fieldKey:'taxType',optionId:null,value:'과세'},{fieldKey:'handlingReason',optionId:null,value:'해당사항없음'},
   {fieldKey:'packagedWeightG',optionId:null,value:'420'},{fieldKey:'packagedDimensionsMm',optionId:null,value:'100*200*300'},
   // This basket schema is a form test contract, not the sunglasses' classification.
   {fieldKey:'storageMaterial',optionId:null,value:''},
  ]);
  const included=current.resolved.rows.filter(row=>row.included),label=id=>included.find(row=>row.optionId===id).optionLabel;
  prices=harness((path,init)=>h.route(path,{method:init?.method??'GET',...(init?.body?{body:JSON.parse(init.body)}:{})}),{productId:product.id,profileId:undefined,version:current.productVersion});
  await prices.idle();
  for(const [key,value] of [['공급가','6000'],['판매가','10000'],['권장소비자가','13000']])prices.input(label('collected-1')+' '+key).props.onChange({target:{value}});
  assert.equal(prices.button('옵션 가격 저장').props.disabled,false);prices.button('옵션 가격 저장').props.onClick();await prices.idle();
  assert.equal(prices.saved,1);
  const initialWrite=JSON.parse(prices.calls.find(call=>call.init.method==='PUT').init.body);
  assert.equal(initialWrite.changes.length,3);assert.ok(initialWrite.changes.every(change=>change.optionId==='collected-1'));
  current=await write([{fieldKey:'salePrice',optionId:'collected-2',value:'11000'},{fieldKey:'msrp',optionId:'collected-2',value:''},
   {fieldKey:'model',optionId:'collected-3',value:'SKU-MODEL'},{fieldKey:'brand',optionId:'collected-3',value:'SKU-BRAND'},
   {fieldKey:'noticeDimensions',optionId:'collected-3',value:'검토 크기'}]);
  prices.setVersion(current.productVersion);await prices.idle();
  assert.equal(prices.input(label('collected-2')+' 판매가').props.value,'11000');
  assert.equal(prices.input(label('collected-2')+' 권장소비자가').props.value,'');
  const saleInput=prices.input(label('collected-2')+' 판매가'),targetCell=nodes(prices.render()).find(node=>node.type==='td'&&nodes(node).some(child=>child.props?.['aria-label']===saleInput.props['aria-label']));
  nodes(targetCell).find(node=>node.type==='button'&&node.props.children==='복원').props.onClick();
  assert.equal(prices.input(label('collected-2')+' 판매가').props.value,'9000');
  prices.button('옵션 가격 저장').props.onClick();await prices.idle();assert.equal(prices.saved,2);
  const old=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));assert.equal(old.submissionReview.errorCount,0,JSON.stringify(old.submissionReview.issues.filter(issue=>issue.kind==='error')));
  const latest=h.sqlite.prepare('SELECT * FROM products').get(),policy={...h.load('app/pricing.ts').pricePolicy(h.settings),exchangeRate:400};
  await json(await h.route(base+'/pricing',{method:'POST',body:{expectedVersion:latest.updated_at,policy}}));
  current=await write(['supplyPrice','salePrice','msrp'].map(fieldKey=>({fieldKey,optionId:null,value:null})));
  prices.setVersion(current.productVersion);await prices.idle();
  const expected=rows.slice(0,5).map(row=>h.load('app/pricing.ts').calculatePrice(h.load('app/product-options.ts').optionSourceCostCny(row.unitCostCny,row.unitsPerPack),policy));
  for(const [index,row] of current.resolved.rows.filter(row=>row.included).entries())for(const [key,fieldLabel] of [['supplyPrice','공급가'],['salePrice','판매가'],['msrp','권장소비자가']]){
   const value=index===0?{supplyPrice:'6000',salePrice:'10000',msrp:'13000'}[key]:index===1&&key==='msrp'?'':String(expected[index][key]);
   assert.equal(row.fields[key].value,value);assert.equal(prices.input(row.optionLabel+' '+fieldLabel).props.value,value);
   assert.equal(row.fields[key].source,index===0||index===1&&key==='msrp'?'manual-option':'pricing');
  }
  assert.equal(current.resolved.rows.find(row=>row.optionId==='collected-3').fields.model.value,'SKU-MODEL');
  const stale=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:old.fingerprint}});assert.equal(stale.status,409);
  const requests=h.network.length,beforeRetry=JSON.stringify(current.overrides);
  assert.match(await h.intake(),/저장된 SEO·옵션값/);assert.equal(h.network.length,requests);assert.equal(h.aiSources.length,1);
  current=await read();assert.equal(JSON.stringify(current.overrides),beforeRetry);
  const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}}));
  assert.equal(preview.submissionReview.errorCount,0,JSON.stringify(preview.submissionReview.issues.filter(issue=>issue.kind==='error')));assert.equal(preview.rows.length,5);
  const bundle=await h.route(base+'/quotation',{method:'POST',body:{action:'export',fingerprint:preview.fingerprint}});assert.equal(bundle.status,200);
  const reader=h.load('app/xlsx-template.ts'),files=await reader.readXlsxArchive(await bundle.arrayBuffer());
  const plan=JSON.parse(new TextDecoder().decode(files.get('supplier-hub-upload-plan.json'))),fieldFile=JSON.parse(new TextDecoder().decode(files.get('quotation-fields.json')));
  const sheet=reader.inspectXlsxArchive(await reader.readXlsxArchive(files.get(plan.quotation.file.filename)));
  assert.deepEqual(plan.company,{code:company.companyCode,name:company.companyName});assert.equal(plan.categoryId,'80719');
  for(let index=0;index<5;index++){
   const cells=reader.xlsxHeaders(sheet,'견적서',index+2),row=Object.fromEntries(fields.map((field,column)=>[field,cells[column]]));
   assert.equal(row.categoryId,'80719');assert.equal(row.quantity,index===0?'2':'1');
   for(const key of ['supplyPrice','salePrice','msrp']){const final=current.resolved.rows.find(row=>row.optionId==='collected-'+(index+1)).fields[key];
    assert.equal(row[key],final.value);assert.equal(fieldFile.rows[index].fields[key].value,final.value);}
   if(index===2){assert.equal(row.model,'SKU-MODEL');assert.equal(row.brand,'SKU-BRAND');assert.equal(row.noticeDimensions,'검토 크기');}
  }
  assert.deepEqual(fieldFile.excludedOptions.map(row=>row.optionId),['collected-6']);
  const ui=submissionPackageUI({route:h.route,productId:product.id});await ui.click('견적서 + 첨부 파일 준비');
  assert.equal(ui.button('등록 전송').props.disabled,true);await ui.click('확장에 첨부 파일 준비');ui.choose();await ui.click('등록 전송');
  const handoff=ui.calls.find(call=>call.action==='transmit');assert.ok(handoff);assert.equal(handoff.files.includedOptions,5);
  assert.deepEqual(handoff.files.company,plan.company);assert.deepEqual(ui.alerts(),[]);
  assert.equal(handoff.files.quotation[0].name,plan.quotation.file.filename);
  assert.deepEqual(Buffer.from(handoff.files.quotation[0].base64,'base64'),Buffer.from(files.get(plan.quotation.file.filename)));
  assert.equal(h.sqlite.prepare('SELECT supplier_hub_status FROM products').get().supplier_hub_status,'미전송');
 }finally{prices?.close();h.close();}
});
