import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {hubSchemaSnapshot,schemaCompanies,schemaPath} from './helpers/hub-schema.mjs';
import {downloadUI} from './helpers/image-download-ui.mjs';
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const json=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const labels={countryOfOrigin:'제조국',precautions:'취급·사용 주의사항',usageStandard:'사용 기준'};
const defaults={countryOfOrigin:'중국',precautions:'용도 외에 사용금지. 파손및화기주의',usageStandard:'14세이상'};
function field(ui,key){const tree=nodes(ui.render()),label=tree.find(node=>node.type==='label'&&nodes(node).some(child=>child.type==='span'&&text(child).trim()===labels[key])&&nodes(node).some(child=>child.type==='textarea'));assert.ok(label,'missing '+key+'; visible labels: '+tree.filter(node=>node.type==='label').map(text).join(' | '));return nodes(label).find(node=>node.type==='textarea');}
for(const company of schemaCompanies)test(`legacy non80719 common-label entry waits for explicit draft fill and discard retains its saved nine-row/DB values (${company.code})`,async()=>{
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name});let ui;try{
  const sourceUrl='https://detail.1688.com/offer/629000000002.html',snapshot={...hubSchemaSnapshot(company),draftInitialization:'couplus-required-v1',inputBindings:'couplus-paths-v1'};
  h.context.category={...h.context.category,categoryId:snapshot.categoryId,categoryPath:schemaPath,hubSchema:snapshot};h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?').run('629000000002',sourceUrl);
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-label-UI',collectedAt:new Date().toISOString(),title:'기존 원문 상품',description:'기존 설명',attributes:[],options:[{sku:'first',name:'첫 옵션',unitPriceCny:2,minimumOrder:1,stock:3}],images:[]}}));await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),base='/api/products/'+product.id,content=JSON.parse(h.sqlite.prepare('SELECT payload FROM product_content').get().payload);for(const key of Object.keys(labels))delete content.label[key];h.sqlite.prepare('UPDATE product_content SET payload=?').run(JSON.stringify(content));
  const before=h.sqlite.prepare('SELECT payload FROM product_content').get().payload,nine=JSON.stringify(await json(await h.route(base+'/product-labels'))),calls=[];
  const request=async(url,init={})=>{calls.push({url,method:init.method??'GET'});return h.route(url,{method:init.method??'GET',body:init.body});},props={product,section:'표시사항'};
  ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',props,request);await ui.idle();for(const key of Object.keys(labels))assert.equal(field(ui,key).props.value,'','opening an old draft cannot add the new generic default');assert.equal(calls.filter(call=>call.method!=='GET').length,0);
  await ui.click('상품명·저장 기본설정으로 빈 표시사항 채우기');for(const [key,value]of Object.entries(defaults))assert.equal(field(ui,key).props.value,value);assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,before);assert.equal(JSON.stringify(await json(await h.route(base+'/product-labels'))),nine);
  field(ui,'countryOfOrigin').props.onChange({target:{value:''}});await ui.click('상품명·저장 기본설정으로 빈 표시사항 채우기');assert.equal(field(ui,'countryOfOrigin').props.value,'','an explicit unsaved clear keeps priority over the button default');
  ui.close();ui=downloadUI('app/components/product-content-editor.tsx','ProductContentEditor',props,request);await ui.idle();for(const key of Object.keys(labels))assert.equal(field(ui,key).props.value,'');assert.equal(h.sqlite.prepare('SELECT payload FROM product_content').get().payload,before);assert.equal(JSON.stringify(await json(await h.route(base+'/product-labels'))),nine);assert.equal(calls.filter(call=>call.method!=='GET').length,0);
 }finally{ui?.close();h.close();}
});
