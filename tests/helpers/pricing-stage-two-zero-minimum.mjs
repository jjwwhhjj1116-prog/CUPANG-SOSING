import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {mobileIntakeHarness} from './mobile-intake.mjs';
import {providedOptionModule as load} from './provided-option-quotation.mjs';

export {load};
export const mode='couplus-stage-two-v1';
export const observed={exchangeRate:350,supplyMargin:50,coupangMargin:40,minimumMargin:3000,msrpMultiple:1.3,roundingUnit:10,roundingMode:'nearest'};
export const companies=[{code:'A01526306',name:'유앤채'},{code:'A01464742',name:'와이홉'}];
export const plain=value=>JSON.parse(JSON.stringify(value));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const json=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
export const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
export const text=tree=>Array.isArray(tree)?tree.map(text).join(' '):tree&&typeof tree==='object'?text(tree.props?.children):typeof tree==='string'||typeof tree==='number'?String(tree):'';
const profileFile=new URL('../../outputs/step604-unand-profile-read.json',import.meta.url),originalFile=new URL('../../outputs/step603-official-unand-2624.xlsx',import.meta.url);
export const available=fs.existsSync(profileFile)&&fs.existsSync(originalFile);

/** Runs real component hooks/callbacks, committing effects only after a stable
 * render. This is a deterministic React contract harness, not a native browser. */
export function componentUI(file,name,{props,fetcher,loader=load}){
 const slots=[];let cursor=0,changed=false,tree,effects=[];
 const effect=(callback,deps)=>{const i=cursor++,previous=slots[i];if(!previous||!deps||deps.some((value,j)=>!Object.is(value,previous.deps?.[j])))effects.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:callback()};});};
 const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;changed||=!Object.is(next,slots[i]);slots[i]=next;}];},useRef(value){const i=cursor++;return slots[i]??(slots[i]={current:value});},useMemo(factory,deps){const i=cursor++,previous=slots[i];if(!previous||deps.some((value,j)=>!Object.is(value,previous.deps[j])))slots[i]={deps:[...deps],value:factory()};return slots[i].value;},useLayoutEffect:effect,useEffect:effect};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,AbortController,fetch:fetcher??(()=>{throw Error('No external fetch in UI harness');}),require(dependency){
  if(dependency==='react')return react;
  if(dependency==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(dependency==='@/app/components/option-price-preview')return{OptionPricePreview:function OptionPricePreview(){}};
  if(dependency==='@/app/components/option-quotation-prices')return{OptionQuotationPrices:function OptionQuotationPrices(){}};
  if(dependency==='@/app/components/settings-price-preview')return{SettingsPricePreview:function SettingsPricePreview(){},SettingsPriceRatio:function SettingsPriceRatio(){}};
  if(dependency.startsWith('@/app/'))return loader(dependency.slice(2)+'.ts');
  throw Error(dependency);
 }},{filename:file});
 const render=()=>{for(let i=0;i<16;i++){cursor=0;changed=false;effects=[];tree=exports[name](props);if(changed)continue;for(const commit of effects)commit();if(!changed)return tree;}throw Error('Unstable component render');};
 return{render,update(patch){Object.assign(props,patch);},async flush(){for(let i=0;i<5;i++){render();await new Promise(resolve=>setImmediate(resolve));}return render();}};
}

export function zeroMinimumUI({initial=observed,sourcePrice=25.6,onSave=async()=>{},loader=load,onDraftStateChange}={}){
 let writes=0;const props={initial,sourcePrice,productId:'local',version:'2026-10-18T00:00:00.000Z',onDraftStateChange,onSave:async value=>{writes++;await onSave(value);props.initial=value;}};
 const ui=componentUI('app/components/price-editor.tsx','PriceEditor',{props,loader});
 return{...ui,button:label=>nodes(ui.render()).find(node=>node.type==='button'&&node.props.children===label),field:label=>nodes(ui.render()).find(node=>node.type==='label'&&nodes(node.props.children).some(child=>child.type==='span'&&child.props.children===label))?.props.children[1],policy:()=>nodes(ui.render()).find(node=>node.type?.name==='OptionPricePreview').props.policy,submit:()=>ui.render().props.onSubmit({preventDefault(){}}),get writes(){return writes;}};
}

/** Isolated synthetic source and actual route/SQLite/Excel handlers. The
 * recorded Unand workbook contract is reused for Waihop locally, not recaptured. */
export async function zeroMinimumFixture(company=companies[0],{pack=1,integrated=false}={}){
 const h=mobileIntakeHarness({companyCode:company.code,companyName:company.name}),trace=[];
 try{
  const nativeRoute=h.route;h.route=async(path,init={})=>{const response=await nativeRoute(path,init);trace.push({method:init.method??'GET',path,status:response.status});return response;};
  Object.assign(h.settings,{bundleEnabled:false,...(integrated?{useIntegratedRate:true,integratedRate:300}:{})});h.context.settings=plain(h.settings);await h.load('db/queries.ts').saveSettings('owner',JSON.stringify(h.settings));
  const saved=JSON.parse(JSON.parse(fs.readFileSync(profileFile,'utf8'))[0].results[0].payload),hubSchema=structuredClone(saved.hubSchema);assert.deepEqual(hubSchema.company,companies[0]);hubSchema.company=plain(company);
  const bytes=new Uint8Array(fs.readFileSync(originalFile)),form=new FormData();form.set('file',new File([bytes],'recorded-original.xlsx'));form.set('schema',JSON.stringify(hubSchema));form.set('action','workbook');
  const response=await h.load('app/api/category-profiles/official-template/route.ts').POST(new Request('https://app.test/api/category-profiles/official-template',{method:'POST',body:form}));trace.push({method:'POST',path:'/api/category-profiles/official-template',status:response.status});
  const linked=await json(response,201),profile=await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'LOCAL ZERO MINIMUM 695',categoryId:saved.categoryId,categoryPath:saved.categoryPath,hubSchema,template:linked.template,mappings:linked.mappings},'cat');
  h.context.category=profile;const sourceUrl='https://detail.1688.com/offer/90000000695.html';h.sqlite.prepare('UPDATE collection_jobs SET offer_id=?,source_url=?').run('90000000695',sourceUrl);h.sqlite.prepare('UPDATE collection_context SET payload=?').run(JSON.stringify(h.context));
  await json(await h.route('/api/collection-jobs/job/result',{method:'POST',body:{schemaVersion:1,sourceUrl,provider:'synthetic-local-695',collectedAt:new Date().toISOString(),title:'本地零利润商品',description:'本地测试原文',attributes:[],options:[{sku:'LOCAL695-HIGH',name:'高价',unitPriceCny:25.6,minimumOrder:2,stock:7},{sku:'LOCAL695-LOW',name:'低价',unitPriceCny:5.23,minimumOrder:1,stock:8}],images:[]}}));
  const promoted=await json(await h.route('/api/collection-jobs/job/product',{method:'POST'})),productId=promoted.productId,base='/api/products/'+productId;
  const product=()=>h.load('db/queries.ts').findProduct('owner',productId),read=()=>h.route(base+'/quotation-fields').then(response=>json(response));
  if(pack!==1){const view=await json(await h.route(base+'/options')),rows=h.load('app/product-options.ts').optionInputs(view.options);rows[0].unitsPerPack=pack;await json(await h.route(base+'/options',{method:'PATCH',body:{expectedRevision:view.options.revision,expectedProductVersion:view.productVersion,rows}}));}
  const immutable=()=>JSON.stringify(Object.fromEntries(['collection_results','collection_context','category_profiles','workspace_settings','product_options','product_content'].map(table=>[table,h.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()])));
  const allTables=()=>JSON.stringify(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,h.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
  const workbook=async()=>{const preview=await json(await h.route(base+'/quotation',{method:'POST',body:{action:'preview'}})),response=await h.route(base+'/quotation',{method:'POST',body:{action:'download',fingerprint:preview.fingerprint}});assert.equal(response.status,200,await response.clone().text());const reader=h.load('app/xlsx-template.ts'),book=reader.inspectXlsxArchive(await reader.readXlsxArchive(await response.arrayBuffer()));return{preview,cells:preview.rows.map((_,index)=>reader.xlsxHeaders(book,profile.template.sheetName,profile.template.dataStartRow+index))};};
  const objectSnapshot=()=>JSON.stringify([...h.objects].map(([key,bytes])=>[key,sha(bytes)]));
  const originalObjects=objectSnapshot();
  return{h,company,integrated,trace,productId,base,profile,bytes,product,read,immutable,allTables,workbook,objectSnapshot,originalObjects};
 }catch(error){h.close();throw error;}
}
