import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,Error,window:overrides.window,require:name=>name in overrides?overrides[name]:name.startsWith('@/')?load(name.slice(2)+'.ts',overrides):require(name)});return exports;}
const {registrationTitle,registrationThumbnail,registrationStepLabel,registrationTransmissionLabel,RegistrationBoard,filterRegistrationProducts}=load('app/components/registration-board.tsx');
const columnLabels=['등록번호','상품이미지','상품명','구매링크','SEO설정','가격설정','대표이미지','추가이미지','상세이미지','사이즈표','한글표시사항','견적서','등록상태','관리'];
function elements(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(predicate(node))found.push(node);visit(node.props?.children);}visit(tree);return found;}
function nodeText(node){return Array.isArray(node)?node.map(nodeText).join(''):node&&typeof node==='object'?nodeText(node.props?.children):typeof node==='boolean'?'':String(node??'');}
function boardHarness(props={}){
 const values=[],confirmations=[];let cursor=0;
 const {RegistrationBoard:Board}=load('app/components/registration-board.tsx',{window:{confirm(message){confirmations.push(message);return props.confirm!==false;}},react:{...require('react'),useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];},useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value;}];}}});
 const product={id:'12345678-abcd',title:'수집한 상품명',source_url:'https://detail.1688.com/offer/813724060928.html',created_at:'2026-09-26T00:00:00Z',image_keys:'["owner/source","owner/main"]',source_image_key:'owner/source',options_count:3,registration_status:'작업 중',seo_status:'대기',quote_status:'대기',supply_price:1000,sale_price:2000,content_summary:{seoTitle:'수정한 상품명',mainImageKey:'owner/main',seo:true,main:1,additional:0,detail:0,label:0,missingImages:false}};
 const calls=[],options=[],selections=[];
 const base={products:[product],selected:new Set(),onSelected:value=>selections.push(value),onOpen:(...args)=>calls.push(args),onOptions:value=>options.push(value),loading:false,error:'',onArchive:()=>{},...props};
 return {product:base.products[0],calls,options,selections,confirmations,render(){cursor=0;return Board(base);}};
}
test('board shows edited title and selected image while searches retain source title and URL',()=>{
 const product={id:'p',title:'원본상품',source_url:'https://detail.1688.com/offer/813724060928.html',created_at:'2026-09-26T00:00:00Z',image_keys:'["first","owner/chosen image"]',content_summary:{seoTitle:'수정한 상품명',mainImageKey:'owner/chosen image'}};
 assert.equal(registrationTitle(product),'수정한 상품명');assert.equal(registrationThumbnail(product),'/api/files/owner/chosen%20image');
 for(const query of ['수정한','원본상품','813724060928'])assert.equal(filterRegistrationProducts([product],query,null,null).length,1);
 product.content_summary.seoTitle='';product.content_summary.mainImageKey=null;
 assert.equal(registrationTitle(product),'상품명 미입력');assert.equal(registrationThumbnail(product),null);
 product.content_summary.mainImageKey='foreign';assert.equal(registrationThumbnail(product),null);
 product.content_summary=null;assert.equal(registrationTitle(product),'원본상품');assert.equal(registrationThumbnail(product),null);
});

test('source preview survives an unchosen or cleared main image without completing image stages',()=>{
 const product={image_keys:JSON.stringify(['owner/banner','owner/source','owner/chosen']),source_image_key:'owner/source',content_summary:{mainImageKey:null,main:0,additional:0,detail:0,missingImages:false}};
 const before=JSON.stringify(product);
 assert.equal(registrationThumbnail(product),'/api/files/owner/source');
 for(const step of ['대표 이미지','추가 이미지','상세 이미지'])assert.equal(registrationStepLabel(product,step),'0장');
 assert.equal(JSON.stringify(product),before);
 product.content_summary.mainImageKey='owner/chosen';product.content_summary.main=1;
 assert.equal(registrationThumbnail(product),'/api/files/owner/chosen');
 product.content_summary.mainImageKey=null;product.content_summary.main=0;
 assert.equal(registrationThumbnail(product),'/api/files/owner/source');
 product.content_summary.mainImageKey='foreign';product.content_summary.missingImages=true;
 assert.equal(registrationThumbnail(product),'/api/files/owner/source');
 assert.equal(product.content_summary.missingImages,true);
});

test('listing never substitutes an arbitrary banner, removed original or malformed image library',()=>{
 const product={image_keys:'["owner/banner"]',source_image_key:'owner/removed',content_summary:{mainImageKey:null}};
 assert.equal(registrationThumbnail(product),null);
 for(const source of [null,'','foreign']){product.source_image_key=source;assert.equal(registrationThumbnail(product),null);}
 product.source_image_key='owner/source';product.image_keys='{"key":"owner/source"}';assert.equal(registrationThumbnail(product),null);
 product.image_keys='broken';assert.equal(registrationThumbnail(product),null);
});

test('board separates all requested columns, shows saved title/image and opens the actual purchase URL',()=>{
 const h=boardHarness(),tree=h.render();
 assert.deepEqual(elements(tree,node=>node.type==='th').slice(1).map(nodeText),columnLabels);
 const cells=elements(tree,node=>node.type==='td');assert.equal(cells.length,columnLabels.length+1);
 const titleCell=cells.find(node=>node.props['data-column']==='product');
 assert.match(nodeText(titleCell),/수정한 상품명/);assert.match(nodeText(titleCell),/옵션 3개/);
 assert.equal(elements(titleCell,node=>node.type==='a').length,0);
 const sourceCell=cells.find(node=>node.props['data-column']==='source');
 const [link]=elements(sourceCell,node=>node.type==='a');
 assert.equal(link.props.href,h.product.source_url);assert.equal(link.props.target,'_blank');
 assert.equal(link.props.rel,'noopener noreferrer');assert.match(link.props['aria-label'],/구매링크 새 창에서 열기/);
 assert.equal(elements(link,node=>node.type==='svg').length,1);assert.equal(nodeText(sourceCell),'');
 const [image]=elements(tree,node=>node.type==='img');assert.equal(image.props.src,'/api/files/owner/main');
});

test('every stage and product option badge keeps its real connected handler',()=>{
 const h=boardHarness(),tree=h.render();
 const steps=[['SEO','SEO설정'],['가격','가격설정'],['대표 이미지','대표이미지'],['추가 이미지','추가이미지'],['상세 이미지','상세이미지'],['옵션','사이즈표'],['표시사항','한글표시사항'],['견적서','견적서']];
 for(const [step,label] of steps){
  const [button]=elements(tree,node=>node.type==='button'&&node.props['aria-label']===`${registrationTitle(h.product)} ${label} 열기`);
  assert.ok(button,`${label} stage exists`);button.props.onClick();assert.equal(h.calls.at(-1)[0],h.product);assert.equal(h.calls.at(-1)[1],step);
 }
 const [thumbnail]=elements(tree,node=>node.type==='button'&&node.props.className==='registration-thumbnail');thumbnail.props.onClick();assert.equal(h.calls.at(-1)[1],'대표 이미지');
 const [title]=elements(tree,node=>node.type==='button'&&node.props.className==='registration-title');title.props.onClick();assert.equal(h.calls.at(-1).length,1);
 const [options]=elements(tree,node=>node.type==='button'&&node.props.className==='registration-options');options.props.onClick();assert.equal(h.options.at(-1),h.product);
 const management=elements(tree,node=>node.type==='td'&&node.props['data-column']==='management')[0];
 const [open]=elements(management,node=>node.type==='button');assert.equal(nodeText(open),'열기');open.props.onClick();assert.equal(h.calls.at(-1)[0],h.product);assert.equal(h.calls.at(-1).length,1);
 assert.equal(elements(tree,node=>node.type==='button'&&nodeText(node)==='삭제').length,0);
 const fallback=boardHarness({onOptions:undefined});const [badge]=elements(fallback.render(),node=>node.type==='button'&&node.props.className==='registration-options');badge.props.onClick();assert.equal(fallback.calls.at(-1)[1],'옵션');
});

test('column picker hides and restores purchase links in requested order and pin selector tracks visible columns',()=>{
 const h=boardHarness();let tree=h.render();
 const picker=elements(tree,node=>node.type==='div'&&node.props['aria-label']==='표시할 컬럼')[0];
 assert.equal(elements(picker,node=>node.type==='input'&&node.props.type==='checkbox').length,columnLabels.length);
 let pin=elements(tree,node=>node.type==='select'&&node.props['aria-label']==='고정할 열 선택')[0];
 assert.deepEqual(elements(pin,node=>node.type==='option').slice(1).map(nodeText),columnLabels);
 pin.props.onChange({target:{value:'source'}});tree=h.render();
 const pinned=elements(tree,node=>['th','td'].includes(node.type)&&node.props['data-column']==='source');
 assert.equal(pinned.length,2);for(const cell of pinned)assert.match(cell.props.className,/registration-pinned/);
 const checkbox=elements(tree,node=>node.type==='input'&&node.props['aria-label']==='구매링크 컬럼 표시')[0];
 checkbox.props.onChange({target:{checked:false}});tree=h.render();
 assert.deepEqual(elements(tree,node=>node.type==='th').slice(1).map(nodeText),columnLabels.filter(label=>label!=='구매링크'));
 assert.equal(elements(tree,node=>node.type==='td'&&node.props['data-column']==='source').length,0);
 pin=elements(tree,node=>node.type==='select'&&node.props['aria-label']==='고정할 열 선택')[0];assert.equal(elements(pin,node=>node.type==='option'&&node.props.value==='source').length,0);
 const hidden=elements(tree,node=>node.type==='input'&&node.props['aria-label']==='구매링크 컬럼 표시')[0];hidden.props.onChange({target:{checked:true}});tree=h.render();
 assert.deepEqual(elements(tree,node=>node.type==='th').slice(1).map(nodeText),columnLabels);
 const imageCheckbox=elements(tree,node=>node.type==='input'&&node.props['aria-label']==='상품이미지 컬럼 표시')[0];imageCheckbox.props.onChange({target:{checked:false}});tree=h.render();
 const all=elements(tree,node=>node.type==='button'&&nodeText(node)==='전체 표시')[0];all.props.onClick();tree=h.render();
 assert.deepEqual(elements(tree,node=>node.type==='th').slice(1).map(nodeText),columnLabels);
 assert.equal(elements(tree,node=>node.type==='td').length,columnLabels.length+1);
});

test('purchase link cell leaves missing or unsupported URLs inert',()=>{
 const h=boardHarness();for(const value of ['', 'javascript:alert(1)', 'file:///secret', 'broken-url']){
  h.product.source_url=value;const source=elements(h.render(),node=>node.type==='td'&&node.props['data-column']==='source')[0];
  assert.equal(elements(source,node=>node.type==='a'||node.type==='button').length,0);assert.equal(nodeText(source),value?'링크 확인 필요':'미입력');
 }
});

test('registration status waits for a transmission receipt even when the saved draft stage claims completion',()=>{
 const h=boardHarness();for(const stage of ['완료','전송완료','수집 원문 반영']){
  h.product.registration_status=stage;assert.equal(registrationTransmissionLabel(h.product),'등록대기');
  const cell=elements(h.render(),node=>node.type==='td'&&node.props['data-column']==='status')[0];assert.equal(nodeText(cell),'등록대기');
  const [badge]=elements(cell,node=>node.type==='span'&&node.props.className==='registration-state');assert.match(badge.props.title,/검증 필요/);
  assert.equal(elements(cell,node=>node.props?.['aria-label']==='최근 전송 결과').length,0);
 }
});

test('authoritative transmission summaries provide the primary status without a conflicting draft label',()=>{
 const h=boardHarness();h.product.registration_status='수집 원문 반영';
 for(const label of ['파일 검증 중','견적서 접수','SKU ID 확인','파일 반려','상품 반려']){
  h.product.hub_receipt={label,company:{code:'A01464742',name:'와이홉'},quotationId:'saved-quote',fingerprint:'a'.repeat(64),categoryId:'80719',observedAt:1,includedOptions:3,issuedSkus:label==='SKU ID 확인'?3:0};
  const before=JSON.stringify(h.product);assert.equal(registrationTransmissionLabel(h.product),label);
  const cell=elements(h.render(),node=>node.type==='td'&&node.props['data-column']==='status')[0];
  const [badge]=elements(cell,node=>node.type==='span'&&node.props.className==='registration-state');assert.equal(nodeText(badge),label);
  assert.equal(nodeText(cell).includes('수집 원문 반영'),false);assert.match(nodeText(cell),/saved-quote/);assert.match(nodeText(cell),/최근 전송한 견적서 기준/);assert.equal(JSON.stringify(h.product),before);
 }
});

test('registration-waiting filter selects only products without receipts and receipt filters use the same authoritative label',()=>{
 const base=boardHarness().product,labels=['파일 검증 중','견적서 접수','SKU ID 확인','파일 반려','상품 반려'];
 const products=[{...base,id:'waiting-complete',registration_status:'완료'},{...base,id:'waiting-local',registration_status:'수집 원문 반영'},...labels.map((label,index)=>({...base,id:'receipt-'+index,registration_status:'등록대기',hub_receipt:{label,company:{code:'A01464742',name:'와이홉'},quotationId:'quote-'+index,fingerprint:'a'.repeat(64),categoryId:'80719',observedAt:1,includedOptions:3,issuedSkus:0}}))];
 const h=boardHarness({products});let tree=h.render();
 const select=elements(tree,node=>node.type==='select'&&node.props['aria-label']==='등록 상태 필터')[0];assert.ok(elements(select,node=>node.type==='option'&&nodeText(node)==='등록대기').length);
 select.props.onChange({target:{value:'등록대기'}});tree=h.render();
 const rowIds=()=>elements(elements(h.render(),node=>node.type==='tbody')[0],node=>node.type==='tr').map(node=>node.key);
 assert.deepEqual(rowIds(),['waiting-complete','waiting-local']);
 for(const [index,label] of labels.entries()){
  elements(h.render(),node=>node.type==='select'&&node.props['aria-label']==='등록 상태 필터')[0].props.onChange({target:{value:label}});assert.deepEqual(rowIds(),['receipt-'+index]);
 }
 const drafts=boardHarness({products:[{...base,id:'working',registration_status:'수집 원문 반영'},{...base,id:'ready',registration_status:'전송 가능'},{...base,id:'legacy-complete',registration_status:'전송완료'}]});
 const choose=value=>elements(drafts.render(),node=>node.type==='select'&&node.props['aria-label']==='등록 상태 필터')[0].props.onChange({target:{value}});
 const draftIds=()=>elements(elements(drafts.render(),node=>node.type==='tbody')[0],node=>node.type==='tr').map(node=>node.key);
 choose('작업 중');assert.deepEqual(draftIds(),['working']);choose('전송 가능');assert.deepEqual(draftIds(),['ready']);
});

test('connected trash button confirms removal, calls the actual async callback and blocks duplicate clicks',async()=>{
 let finish;const deleted=[];const h=boardHarness({onDelete:product=>{deleted.push(product);return new Promise(resolve=>{finish=resolve;});}});
 const before=JSON.stringify(h.product),tree=h.render();
 const management=elements(tree,node=>node.type==='td'&&node.props['data-column']==='management')[0];assert.equal(elements(management,node=>node.type==='button').length,1);assert.equal(elements(management,node=>node.type==='button'&&nodeText(node)==='열기').length,0);
 const [trash]=elements(tree,node=>node.type==='button'&&node.props.className==='registration-delete');assert.ok(trash);assert.equal(trash.props['aria-label'],'수정한 상품명 삭제');
 const pending=trash.props.onClick();await trash.props.onClick();assert.equal(deleted.length,1);assert.equal(deleted[0],h.product);assert.equal(h.confirmations.length,1);assert.match(h.confirmations[0],/복원할 수 있습니다/);
 const [busy]=elements(h.render(),node=>node.type==='button'&&node.props.className==='registration-delete');assert.equal(busy.props.disabled,true);assert.equal(busy.props.title,'삭제 중');
 finish();await pending;const [ready]=elements(h.render(),node=>node.type==='button'&&node.props.className==='registration-delete');assert.equal(ready.props.disabled,false);assert.equal(JSON.stringify(h.product),before);
});

test('cancelled or failed removal keeps the product available and surfaces the server error',async()=>{
 let calls=0;const cancelled=boardHarness({confirm:false,onDelete:async()=>{calls++;}});
 const [cancel]=elements(cancelled.render(),node=>node.type==='button'&&node.props.className==='registration-delete');await cancel.props.onClick();assert.equal(calls,0);
 const h=boardHarness({onDelete:async()=>{throw Error('상품이 변경되었습니다. 목록을 다시 불러와주세요.');}});const before=JSON.stringify(h.product);
 const [trash]=elements(h.render(),node=>node.type==='button'&&node.props.className==='registration-delete');await trash.props.onClick();
 assert.equal(JSON.stringify(h.product),before);assert.equal(elements(h.render(),node=>node.props?.role==='alert').map(nodeText).join(''),'상품이 변경되었습니다. 목록을 다시 불러와주세요.');
});

test('real collected draft renders a product preview while quotation image fields remain blank',async()=>{
 const {mobileIntakeHarness}=await import('./helpers/mobile-intake.mjs');
 const {renderToStaticMarkup}=await import('react-dom/server');
 const {createElement}=await import('react');const h=mobileIntakeHarness();
 try{
  await h.intake();const response=await h.load('app/api/products/route.ts').GET();assert.equal(response.status,200);
  const {products}=await response.json(),product=products[0];assert.ok(product.source_image_key);
  const html=renderToStaticMarkup(createElement(RegistrationBoard,{products,selected:new Set(),onSelected:()=>{},onOpen:()=>{},loading:false,error:'',onArchive:()=>{}}));
  assert.ok(html.includes(`src="${registrationThumbnail(product)}"`));assert.ok(!html.includes('이미지<br/>없음'));
  assert.match(html,/우드 패턴 다리 선글라스/);assert.equal((html.match(/>0장<\/button>/g)||[]).length,4);
  const fields=await h.route('/api/products/'+product.id+'/quotation-fields');assert.equal(fields.status,200);
  for(const row of (await fields.json()).resolved.rows)for(const key of ['mainImage','additionalImages','detailImages'])assert.equal(row.fields[key].value,'');
 }finally{h.close();}
});
