import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,Error,window:overrides.window,require:name=>name in overrides?overrides[name]:name.startsWith('@/')?load(name.slice(2)+(fs.existsSync(new URL('../'+name.slice(2)+'.ts',import.meta.url))?'.ts':'.tsx'),overrides):require(name)});return exports;}
const {registrationTitle,registrationNumber,registrationThumbnail,registrationStepLabel,registrationTransmissionLabel,RegistrationBoard,filterRegistrationProducts,sortRegistrationProducts}=load('app/components/registration-board.tsx');
const columnLabels=['등록번호','상품이미지','상품명','구매링크','SEO설정','가격설정','대표이미지','추가이미지','상세이미지','사이즈표','한글표시사항','견적서','등록상태','관리'];
function elements(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(predicate(node))found.push(node);visit(node.props?.children);}visit(tree);return found;}
function nodeText(node){return Array.isArray(node)?node.map(nodeText).join(''):node&&typeof node==='object'?nodeText(node.props?.children):typeof node==='boolean'?'':String(node??'');}
const nativeSummary={format:'yoofam-single-receipt-summary-v1',evidence:'chrome-observation',registered:false,label:'개별 문서 등록 파일 완료 확인',company:{code:'A01526306',name:'유앤채'},fingerprint:'a'.repeat(64),categoryId:'81452',observedAt:Date.now(),createdAt:new Date().toISOString(),optionCount:1,optionId:'reviewed-one',docId:901,qvtRequestId:7901,state:'accepted',sourceStatus:'FINISHED'};
function boardHarness(props={}){
 const values=[],confirmations=[];let cursor=0;
 const {RegistrationBoard:Board}=load('app/components/registration-board.tsx',{window:{innerWidth:1600,innerHeight:900,confirm(message){confirmations.push(message);return props.confirm!==false;}},react:{...require('react'),useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];},useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value;}];}}});
 const product={id:'12345678-abcd',title:'수집한 상품명',source_url:'https://detail.1688.com/offer/813724060928.html',created_at:'2026-09-26T00:00:00Z',image_keys:'["owner/source","owner/main"]',source_image_key:'owner/source',options_count:3,registration_status:'작업 중',seo_status:'대기',quote_status:'대기',supply_price:1000,sale_price:2000,removal_policy:{blocked:false,code:null,reason:'',receipt:null},content_summary:{seoTitle:'수정한 상품명',mainImageKey:'owner/main',seo:true,main:1,additional:0,detail:0,label:0,missingImages:false}};
 const calls=[],options=[],selections=[];
 const base={products:[product],selected:new Set(),onSelected:value=>selections.push(value),onOpen:(...args)=>calls.push(args),onOptions:value=>options.push(value),loading:false,error:'',onArchive:()=>{},...props};
 return {product:base.products[0],calls,options,selections,confirmations,render(){cursor=0;return Board(base);}};
}

test('native receipt row keeps document and registration file distinct, never claims an issued SKU or all options',()=>{
 const h=boardHarness();h.product.hub_single_receipt=nativeSummary;
 const before=JSON.stringify(h.product),tree=h.render(),cell=elements(tree,node=>node.type==='td'&&node.props['data-column']==='status')[0];
 const value=nodeText(cell);assert.match(value,/문서 ID: 901/);assert.match(value,/등록 파일 ID: 7901/);assert.match(value,/개별 전송 기록 1개/);assert.match(value,/SKU 확인 전/);assert.doesNotMatch(value,/SKU 1\/3|전송완료|등록완료/);
 assert.equal(registrationTransmissionLabel(h.product),nativeSummary.label);assert.equal(JSON.stringify(h.product),before);
 const filter=elements(tree,node=>node.type==='select'&&node.props['aria-label']==='등록 상태 필터')[0];
 filter.props.onChange({target:{value:nativeSummary.label}});assert.equal(elements(h.render(),node=>node.type==='tbody')[0].props.children.length,1);
});

test('coexisting native and file receipts display both histories without claiming either is the latest',()=>{
 const h=boardHarness();h.product.hub_single_receipt=nativeSummary;h.product.hub_receipt={label:'견적서 접수',company:nativeSummary.company,quotationId:'bulk-401',fingerprint:'b'.repeat(64),categoryId:'80719',observedAt:Date.now()+1,includedOptions:3,issuedSkus:0};
 const value=nodeText(elements(h.render(),node=>node.type==='td'&&node.props['data-column']==='status')[0]);
 assert.equal(registrationTransmissionLabel(h.product),'전송 이력 있음');assert.match(value,/견적서 ID: bulk-401/);assert.match(value,/등록 파일 ID: 7901/);assert.match(value,/SKU 0\/3개/);assert.match(value,/SKU 확인 전/);
 assert.doesNotMatch(value,/최근 전송한 견적서 기준/);
});
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
 const h=boardHarness({onOptions:undefined}),tree=h.render();
 const steps=[['SEO','SEO설정'],['가격','가격설정'],['대표 이미지','대표이미지'],['추가 이미지','추가이미지'],['상세 이미지','상세이미지'],['옵션','사이즈표'],['표시사항','한글표시사항'],['견적서','견적서']];
 for(const [step,label] of steps){
  const [button]=elements(tree,node=>node.type==='button'&&node.props['aria-label']===`${registrationTitle(h.product)} ${label} 열기`);
  assert.ok(button,`${label} stage exists`);button.props.onClick();assert.equal(h.calls.at(-1)[0],h.product);assert.equal(h.calls.at(-1)[1],step);
 }
 const [thumbnail]=elements(tree,node=>node.type==='button'&&node.props.className==='registration-thumbnail');thumbnail.props.onClick();assert.equal(h.calls.at(-1)[1],'대표 이미지');
 const [title]=elements(tree,node=>node.type==='button'&&node.props.className==='registration-title');title.props.onClick();assert.equal(h.calls.at(-1).length,1);
 const [options]=elements(tree,node=>node.type==='button'&&node.props.className==='registration-options');options.props.onClick();assert.equal(h.calls.at(-1)[1],'옵션');
 const management=elements(tree,node=>node.type==='td'&&node.props['data-column']==='management')[0];
 const [open]=elements(management,node=>node.type==='button');assert.equal(nodeText(open),'열기');open.props.onClick();assert.equal(h.calls.at(-1)[0],h.product);assert.equal(h.calls.at(-1).length,1);
 assert.equal(elements(tree,node=>node.type==='button'&&nodeText(node)==='삭제').length,0);
 const fallback=boardHarness({onOptions:undefined});const [badge]=elements(fallback.render(),node=>node.type==='button'&&node.props.className==='registration-options');badge.props.onClick();assert.equal(fallback.calls.at(-1)[1],'옵션');
});

test('connected stage cells and product previews open the product option selector before editing',()=>{
 const h=boardHarness(),tree=h.render();
 const buttons=elements(tree,node=>node.type==='button'&&(node.props.className==='registration-cell-button'||node.props.className==='registration-thumbnail'||node.props.className==='registration-title'||node.props.className==='registration-options'));
 assert.equal(buttons.length,11);
 for(const button of buttons){button.props.onClick();assert.equal(h.options.at(-1),h.product);}
 assert.equal(h.options.length,11);assert.equal(h.calls.length,0);assert.equal(h.confirmations.length,0);
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

test('100-product pages preserve off-page selection and never modify registration records',()=>{
 const seed=boardHarness().product;
 const products=Array.from({length:120},(_,index)=>({...seed,id:`page-product-${index}`,content_summary:{...seed.content_summary,seoTitle:`상품 ${index}`}}));
 const before=JSON.stringify(products),h=boardHarness({products,selected:new Set(['page-product-110'])});
 const rows=tree=>elements(elements(tree,node=>node.type==='tbody')[0],node=>node.type==='tr');
 let tree=h.render();assert.equal(rows(tree).length,10);
 elements(tree,node=>node.type==='select'&&node.props['aria-label']==='페이지당 상품 수')[0].props.onChange({target:{value:'100'}});
 tree=h.render();assert.deepEqual(rows(tree).map(row=>row.key),products.slice(0,100).map(product=>product.id));
 elements(tree,node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0].props.onChange({target:{checked:true}});
 assert.deepEqual([...h.selections.at(-1)].sort(),['page-product-110',...products.slice(0,100).map(product=>product.id)].sort());
 elements(tree,node=>node.type==='button'&&nodeText(node)==='다음')[0].props.onClick();
 tree=h.render();assert.deepEqual(rows(tree).map(row=>row.key),products.slice(100).map(product=>product.id));
 assert.equal(elements(tree,node=>node.type==='button'&&nodeText(node)==='다음')[0].props.disabled,true);
 elements(tree,node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0].props.onChange({target:{checked:false}});
 assert.equal(h.selections.at(-1).size,0);
 elements(tree,node=>node.type==='input'&&node.props['aria-label']==='상품 검색')[0].props.onChange({target:{value:'상품 119'}});
 tree=h.render();assert.deepEqual(rows(tree).map(row=>row.key),['page-product-119']);
 assert.equal(elements(tree,node=>node.type==='button'&&nodeText(node)==='이전')[0].props.disabled,true);
 assert.equal(h.calls.length,0);assert.equal(h.options.length,0);assert.equal(h.confirmations.length,0);assert.equal(JSON.stringify(products),before);
});

test('registration header sorting cycles through natural ascending, descending and original order without writes',()=>{
 const seed=boardHarness().product,products=['10','2','1'].map(id=>({...seed,id})),before=JSON.stringify(products),h=boardHarness({products});
 const ids=()=>elements(elements(h.render(),node=>node.type==='tbody')[0],node=>node.type==='tr').map(node=>node.key);
 const sort=()=>elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='등록번호 정렬')[0].props.onClick();
 const direction=()=>elements(h.render(),node=>node.type==='th'&&node.props['data-column']==='id')[0].props['aria-sort'];
 assert.equal(direction(),'none');assert.deepEqual(ids(),['10','2','1']);
 sort();assert.equal(direction(),'ascending');assert.deepEqual(ids(),['1','2','10']);
 sort();assert.equal(direction(),'descending');assert.deepEqual(ids(),['10','2','1']);
 sort();assert.equal(direction(),'none');assert.deepEqual(ids(),['10','2','1']);
 assert.equal(h.calls.length,0);assert.equal(h.options.length,0);assert.equal(h.selections.length,0);assert.equal(h.confirmations.length,0);assert.equal(JSON.stringify(products),before);
});

test('sorting uses edited names, numeric image counts and verified receipt labels with stable equal rows',()=>{
 const seed=boardHarness().product;
 const products=[{...seed,id:'third',title:'가',content_summary:{...seed.content_summary,seoTitle:'상품 11',main:11}},
  {...seed,id:'first',title:'다',content_summary:{...seed.content_summary,seoTitle:'상품 2',main:2}},
  {...seed,id:'second',title:'나',content_summary:{...seed.content_summary,seoTitle:'상품 2',main:2},hub_receipt:{label:'SKU ID 확인'}},
  {...seed,id:'last',registration_status:'전송완료',quote_status:'완료',content_summary:{...seed.content_summary,seoTitle:'상품 1',main:0}}];
 const before=JSON.stringify(products),ids=(column,direction='ascending')=>sortRegistrationProducts(products,{column,direction}).map(product=>product.id);
 assert.deepEqual(ids('product'),['last','first','second','third']);assert.deepEqual(ids('product','descending'),['third','first','second','last']);
 assert.deepEqual(ids('대표 이미지'),['last','first','second','third']);assert.deepEqual(ids('대표 이미지','descending'),['third','first','second','last']);
 assert.deepEqual(ids('status'),['third','first','last','second']);assert.deepEqual(ids('status','descending'),['second','third','first','last']);
 for(const column of ['image','management','unknown'])assert.deepEqual(ids(column),products.map(product=>product.id));
 assert.equal(JSON.stringify(products),before);
});

test('a new sort resets pagination and page selection follows displayed IDs while retaining off-page selection',()=>{
 const seed=boardHarness().product,products=Array.from({length:23},(_,index)=>({...seed,id:String(index+1),content_summary:{...seed.content_summary,seoTitle:`상품 ${23-index}`}}));
 const before=JSON.stringify(products),h=boardHarness({products,selected:new Set(['23'])});
 elements(h.render(),node=>node.type==='button'&&nodeText(node)==='다음')[0].props.onClick();
 assert.equal(elements(elements(h.render(),node=>node.type==='tbody')[0],node=>node.type==='tr')[0].key,'11');
 elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='상품명 정렬')[0].props.onClick();
 let tree=h.render();assert.equal(elements(tree,node=>node.type==='button'&&nodeText(node)==='이전')[0].props.disabled,true);
 const visible=elements(elements(tree,node=>node.type==='tbody')[0],node=>node.type==='tr').map(node=>node.key);assert.deepEqual(visible,products.slice(13).reverse().map(product=>product.id));
 elements(tree,node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0].props.onChange({target:{checked:true}});assert.deepEqual([...h.selections.at(-1)].sort(),[...new Set(['23',...visible])].sort());
 elements(tree,node=>node.type==='input'&&node.props['aria-label']==='상품명 컬럼 표시')[0].props.onChange({target:{checked:false}});tree=h.render();
 assert.deepEqual(elements(elements(tree,node=>node.type==='tbody')[0],node=>node.type==='tr').map(node=>node.key),visible);
 assert.equal(h.calls.length,0);assert.equal(h.options.length,0);assert.equal(JSON.stringify(products),before);
});

test('the displayed registration number and full saved ID are searchable without replacing edited names or purchase URLs',()=>{
 const product=boardHarness().product,before=JSON.stringify(product);
 assert.equal(registrationNumber(product),'YP-12345678');
 for(const query of ['yp-12345678','12345678-abcd','수정한 상품명','813724060928'])assert.equal(filterRegistrationProducts([product],query,null,null).length,1);
 assert.equal(filterRegistrationProducts([product],'YP-99999999',null,null).length,0);assert.equal(JSON.stringify(product),before);
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

test('receipt-backed deletion locks keep the Couplus trash shape and exact tooltip, even when the latest file failed',async()=>{
 const reason='쿠팡에 이미 전송된 상품이라 삭제할 수 없습니다';
 for(const company of [{code:'A01464742',name:'와이홉'},{code:'A01526306',name:'유앤채'}]){
  let writes=0;const h=boardHarness({onDelete:async()=>{writes++;}});
  const accepted={label:'견적서 접수',company,quotationId:'previous-accepted-quote',fingerprint:'a'.repeat(64),categoryId:'69900',observedAt:1,includedOptions:3,issuedSkus:0};
  h.product.hub_receipt={...accepted,label:'파일 반려',quotationId:null,fingerprint:'b'.repeat(64)};
  h.product.removal_policy={blocked:true,code:'PRODUCT_HUB_TRANSMITTED',reason,receipt:accepted};
  const before=JSON.stringify(h.product),tree=h.render(),management=elements(tree,node=>node.type==='td'&&node.props['data-column']==='management')[0];
  const [trash]=elements(management,node=>node.type==='button');assert.equal(trash.props.className,'registration-delete');assert.equal(trash.props.disabled,true);assert.equal(trash.props.title,reason);assert.equal(elements(trash,node=>node.type==='svg').length,1);
  await trash.props.onClick();assert.equal(writes,0);assert.equal(h.confirmations.length,0);assert.equal(JSON.stringify(h.product),before);
  const status=elements(tree,node=>node.type==='td'&&node.props['data-column']==='status')[0];assert.match(nodeText(status),/파일 반려/,'the latest observed status remains independent of older transmission evidence');
 }
});

test('unconfirmed deletion policies stay inert while verified unsubmitted or failed-only drafts can be removed',async()=>{
 for(const policy of [undefined,null,{blocked:false},{blocked:true,code:'PRODUCT_HUB_EVIDENCE_UNCONFIRMED',reason:'전송 결과를 확인한 뒤 삭제해주세요.',receipt:null}]){
  let writes=0;const h=boardHarness({onDelete:async()=>{writes++;}});h.product.removal_policy=policy;
  const [trash]=elements(h.render(),node=>node.type==='button'&&node.props.className==='registration-delete');assert.equal(trash.props.disabled,true);assert.ok(trash.props.title);await trash.props.onClick();assert.equal(writes,0);assert.equal(h.confirmations.length,0);
 }
 for(const state of ['미전송','파일 반려']){
  let writes=0;const h=boardHarness({onDelete:async()=>{writes++;}});h.product.supplier_hub_status=state;
  if(state==='파일 반려')h.product.hub_receipt={label:state,company:{code:'A01464742',name:'와이홉'},quotationId:null,fingerprint:'a'.repeat(64),categoryId:'80719',observedAt:1,includedOptions:3,issuedSkus:0};
  const [trash]=elements(h.render(),node=>node.type==='button'&&node.props.className==='registration-delete');assert.equal(trash.props.disabled,false);assert.equal(trash.props.title,'삭제');await trash.props.onClick();assert.equal(writes,1);assert.equal(h.confirmations.length,1);
 }
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

function openColumnFilter(h,label){const trigger=elements(h.render(),node=>node.type==='button'&&node.props['aria-label']===`${label} 열 필터`)[0];trigger.props.onClick({currentTarget:{getBoundingClientRect:()=>({left:100,bottom:220}),contains:()=>false}});return elements(h.render(),node=>node.type?.name==='RegistrationFilterPopover')[0];}
const boardRowIds=h=>elements(elements(h.render(),node=>node.type==='tbody')[0],node=>node.type==='tr').map(row=>row.key);
test('column values and AND bounds operate before pagination and preserve off-page selections and source records',()=>{
 const seed=boardHarness().product,products=Array.from({length:36},(_,index)=>({...seed,id:`f-${index}`,content_summary:{...seed.content_summary,seoTitle:index%2?'나':'가',additional:index%13}})),before=JSON.stringify(products),h=boardHarness({products,selected:new Set(['f-35'])});
 elements(h.render(),node=>node.type==='button'&&nodeText(node)==='다음')[0].props.onClick();
 openColumnFilter(h,'상품명').props.onApply({mode:'values',values:['가']});
 openColumnFilter(h,'추가이미지').props.onApply({mode:'conditions',conditions:[{operator:'gte',value:'2'},{operator:'lte',value:'10'}]});
 const expected=products.filter(product=>product.content_summary.seoTitle==='가'&&product.content_summary.additional>=2&&product.content_summary.additional<=10);
 assert.deepEqual(boardRowIds(h),expected.slice(0,10).map(product=>product.id));
 assert.equal(elements(h.render(),node=>node.type==='button'&&nodeText(node)==='이전')[0].props.disabled,true);
 elements(h.render(),node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0].props.onChange({target:{checked:true}});
 assert.deepEqual([...h.selections.at(-1)],['f-35',...expected.slice(0,10).map(product=>product.id)]);
 assert.equal(h.calls.length,0);assert.equal(h.options.length,0);assert.equal(h.confirmations.length,0);assert.equal(JSON.stringify(products),before);
});
test('column filter draft close is inert and clearing one column retains other filters and editable title handlers',()=>{
 const seed=boardHarness().product,products=[{...seed,id:'a',content_summary:{...seed.content_summary,seoTitle:'가',additional:2}},{...seed,id:'b',content_summary:{...seed.content_summary,seoTitle:'나',additional:2}},{...seed,id:'c',content_summary:{...seed.content_summary,seoTitle:'가',additional:0}}],h=boardHarness({products});
 openColumnFilter(h,'상품명').props.onClose();assert.deepEqual(boardRowIds(h),['a','b','c']);
 openColumnFilter(h,'상품명').props.onApply({mode:'values',values:['가']});openColumnFilter(h,'추가이미지').props.onApply({mode:'values',values:['2장']});assert.deepEqual(boardRowIds(h),['a']);
 openColumnFilter(h,'상품명').props.onApply(undefined);assert.deepEqual(boardRowIds(h),['a','b']);
 const row=elements(elements(h.render(),node=>node.type==='tbody')[0],node=>node.type==='tr')[0];elements(row,node=>node.type==='button'&&node.props.className==='registration-title')[0].props.onClick();assert.equal(h.options.at(-1),products[0]);
 elements(h.render(),node=>node.type==='button'&&nodeText(node).startsWith('열 필터 모두 해제'))[0].props.onClick();assert.deepEqual(boardRowIds(h),['a','b','c']);
});
test('filters use edited names and receipt evidence, and hidden columns keep their selected filters',()=>{
 const seed=boardHarness().product,receipt={label:'SKU ID 확인',company:{name:'유앤채'},issuedSkus:2,includedOptions:2,quotationId:'q-2',observedAt:Date.parse('2026-10-11T00:00:00Z')};
 const products=[{...seed,id:'a',registration_status:'전송완료',content_summary:{...seed.content_summary,seoTitle:'새 이름'}},{...seed,id:'b',registration_status:'작업 중',hub_receipt:receipt,content_summary:{...seed.content_summary,seoTitle:'새 이름'}}],h=boardHarness({products});
 const name=openColumnFilter(h,'상품명');assert.deepEqual(JSON.parse(JSON.stringify(name.props.choices)),[{value:'새 이름',count:2}]);name.props.onApply({mode:'values',values:['새 이름']});
 const status=openColumnFilter(h,'등록상태');assert.deepEqual(Array.from(status.props.choices,choice=>choice.value),['등록대기','SKU ID 확인']);status.props.onApply({mode:'values',values:['SKU ID 확인']});assert.deepEqual(boardRowIds(h),['b']);
 elements(h.render(),node=>node.type==='input'&&node.props['aria-label']==='등록상태 컬럼 표시')[0].props.onChange({target:{checked:false}});assert.deepEqual(boardRowIds(h),['b']);
 elements(h.render(),node=>node.type==='button'&&nodeText(node).startsWith('열 필터 모두 해제'))[0].props.onClick();assert.deepEqual(boardRowIds(h),['a','b']);
});
test('the open filter trigger toggles closed and popup sorting preserves existing filters',()=>{
 const seed=boardHarness().product,h=boardHarness({products:['10','2','1'].map(id=>({...seed,id}))});let popup=openColumnFilter(h,'등록번호');assert.ok(popup);
 const trigger=elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='등록번호 열 필터')[0];trigger.props.onClick({currentTarget:{getBoundingClientRect:()=>({left:100,bottom:220})}});assert.equal(elements(h.render(),node=>node.type?.name==='RegistrationFilterPopover').length,0);
 popup=openColumnFilter(h,'등록번호');popup.props.onApply({mode:'values',values:['YP-10','YP-2']});openColumnFilter(h,'등록번호').props.onSort('ascending');assert.deepEqual(boardRowIds(h),['2','10']);openColumnFilter(h,'등록번호').props.onSort('descending');assert.deepEqual(boardRowIds(h),['10','2']);assert.equal(h.options.length,0);assert.equal(h.confirmations.length,0);
});
