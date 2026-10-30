import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function load(file,overrides={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,URL,Error,window:overrides.window,require:name=>name.endsWith('.css')?{}:name in overrides?overrides[name]:name.startsWith('@/')?load(name.slice(2)+(fs.existsSync(new URL('../'+name.slice(2)+'.ts',import.meta.url))?'.ts':'.tsx'),overrides):require(name)});return exports;}
const {registrationTitle,registrationNumber,registrationThumbnail,registrationStepLabel,registrationTransmissionLabel,RegistrationBoard,filterRegistrationProducts,sortRegistrationProducts}=load('app/components/registration-board.tsx');
const columnLabels=['등록번호','상품이미지','상품명','구매링크','SEO설정','가격설정','대표이미지','추가이미지','상세이미지','사이즈표','한글표시사항','견적서','등록상태','관리'];
function elements(tree,predicate){const found=[];function visit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(visit);return;}if(predicate(node))found.push(node);visit(node.props?.children);}visit(tree);return found;}
function nodeText(node){return Array.isArray(node)?node.map(nodeText).join(''):node&&typeof node==='object'?nodeText(node.props?.children):typeof node==='boolean'?'':String(node??'');}
const nativeSummary={format:'yoofam-single-receipt-summary-v1',evidence:'chrome-observation',registered:false,label:'개별 문서 등록 파일 완료 확인',company:{code:'A01526306',name:'유앤채'},fingerprint:'a'.repeat(64),categoryId:'81452',observedAt:Date.now(),createdAt:new Date().toISOString(),optionCount:1,optionId:'reviewed-one',docId:901,qvtRequestId:7901,state:'accepted',sourceStatus:'FINISHED'};
function boardHarness(props={}){
 const values=[],confirmations=[],layouts=[];let cursor=0;
 const {RegistrationBoard:Board}=load('app/components/registration-board.tsx',{window:{innerWidth:1600,innerHeight:900,confirm(message){confirmations.push(message);return typeof props.confirm==='function'?props.confirm(message):props.confirm!==false;}},react:{...require('react'),useRef(initial){const index=cursor++;if(!(index in values))values[index]={current:initial};return values[index];},useMemo(fn,deps){const index=cursor++,previous=values[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i])))values[index]={deps,value:fn()};return values[index].value;},useLayoutEffect(fn,deps){const index=cursor++,previous=values[index];if(!previous||!deps||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){const next={deps,cleanup:previous?.cleanup};values[index]=next;layouts.push(()=>{next.cleanup?.();next.cleanup=fn();});}},useState(initial){const index=cursor++;if(!(index in values))values[index]=typeof initial==='function'?initial():initial;return [values[index],value=>{values[index]=typeof value==='function'?value(values[index]):value;}];}}});
 const product={id:'12345678-abcd',title:'수집한 상품명',source_url:'https://detail.1688.com/offer/813724060928.html',created_at:'2026-09-26T00:00:00Z',image_keys:'["owner/source","owner/main"]',source_image_key:'owner/source',options_count:3,registration_status:'작업 중',seo_status:'대기',quote_status:'대기',supply_price:1000,sale_price:2000,removal_policy:{blocked:false,code:null,reason:'',receipt:null},content_summary:{seoTitle:'수정한 상품명',mainImageKey:'owner/main',seo:true,main:1,additional:0,detail:0,label:0,missingImages:false}};
 const calls=[],options=[],selections=[];
 const base={products:[product],sourceOwnerId:'owner',sourceCompany:{code:'A01464742',name:'와이홉'},selected:new Set(),onSelected:value=>selections.push(value),onOpen:(...args)=>calls.push(args),onOptions:value=>options.push(value),loading:false,error:'',onArchive:()=>{},...props};
 return {product:base.products[0],calls,options,selections,confirmations,update(value){Object.assign(base,value);return this.render();},close(){for(const value of values)value?.cleanup?.();},render(){cursor=0;const tree=Board(base);layouts.splice(0).forEach(fn=>fn());return tree;}};
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
 for(const step of ['대표 이미지','추가 이미지','상세 이미지'])assert.equal(registrationStepLabel(product,step),'대기');
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

test('product title cell omits representative record prices while saved option-price editing remains connected',()=>{
 for(const useOptionSelector of [false,true]){
  const h=useOptionSelector?boardHarness():boardHarness({onOptions:undefined});
  Object.assign(h.product,{source_price_cny:5.3,supply_price:5120,sale_price:8530});
  const before=JSON.stringify(h.product),tree=h.render();
  const [cell]=elements(tree,node=>node.type==='td'&&node.props['data-column']==='product');
  assert.equal(nodeText(cell),'수정한 상품명옵션 3개');
  assert.doesNotMatch(nodeText(tree),/공급 5,120원|판매 8,530원/);
  const [price]=elements(tree,node=>node.type==='button'&&node.props['aria-label']==='수정한 상품명 가격설정 열기');
  assert.ok(price);assert.notEqual(price.props.disabled,true);price.props.onClick();
  if(useOptionSelector){assert.equal(h.options.at(-1),h.product);assert.equal(h.calls.length,0);}
  else{assert.equal(h.calls.at(-1)[0],h.product);assert.equal(h.calls.at(-1)[1],'가격');}
  assert.equal(JSON.stringify(h.product),before);
 }
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
 assert.equal(elements(management,node=>node.type==='button'&&nodeText(node)==='삭제').length,0);
 const fallback=boardHarness({onOptions:undefined});const [badge]=elements(fallback.render(),node=>node.type==='button'&&node.props.className==='registration-options');badge.props.onClick();assert.equal(fallback.calls.at(-1)[1],'옵션');
});

test('connected stage cells and product previews open the product option selector before editing',()=>{
 const h=boardHarness(),tree=h.render();
 const buttons=elements(tree,node=>node.type==='button'&&(node.props.className?.includes('registration-cell-button')||node.props.className==='registration-thumbnail'||node.props.className==='registration-title'||node.props.className==='registration-options'));
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

test('saved twelve-digit registration metadata drives displayed search while invalid or legacy metadata uses its existing label',()=>{
 const product={...boardHarness().product,registration_number:'261015009001'},before=JSON.stringify(product);
 assert.equal(registrationNumber(product),'261015009001');
 for(const query of ['261015009001','15009','12345678-abcd','수정한 상품명','813724060928'])assert.equal(filterRegistrationProducts([product],query,null,null).length,1);
 assert.equal(filterRegistrationProducts([product],'YP-12345678',null,null).length,0);
 const h=boardHarness({products:[product]});assert.match(nodeText(elements(h.render(),node=>node.type==='td'&&node.props['data-column']==='id')[0]),/^261015009001/);
 assert.equal(JSON.stringify(product),before);
 for(const registration_number of [undefined,null,'','26101500901','2610150090010','261015009001\n',' 261015009001','２６１０１５００９００１','YP-12345678',261015009001])assert.equal(registrationNumber({...product,registration_number}),'YP-12345678');
});

test('registration number column filters and sorts the displayed metadata without changing selection or action IDs',()=>{
 const seed=boardHarness().product,products=[{...seed,id:'uuid-z',registration_number:'261015002001'},{...seed,id:'uuid-a',registration_number:'261015003001'},{...seed,id:'uuid-m',registration_number:'261015001001'},{...seed,id:'legacy-id'}],before=JSON.stringify(products),h=boardHarness({products,selected:new Set(['legacy-id'])});
 const popup=openColumnFilter(h,'등록번호');assert.deepEqual(Array.from(popup.props.choices,choice=>choice.value),['261015001001','261015002001','261015003001','YP-LEGACY-I']);
 popup.props.onApply({mode:'conditions',conditions:[{operator:'gte',value:'261015001001'},{operator:'lte',value:'261015002001'}]});
 openColumnFilter(h,'등록번호').props.onSort('ascending');assert.deepEqual(boardRowIds(h),['uuid-m','uuid-z']);
 openColumnFilter(h,'등록번호').props.onSort('descending');assert.deepEqual(boardRowIds(h),['uuid-z','uuid-m']);
 const tree=h.render();elements(tree,node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0].props.onChange({target:{checked:true}});assert.deepEqual([...h.selections.at(-1)],['legacy-id','uuid-z','uuid-m']);
 elements(tree,node=>node.type==='button'&&node.props.className==='registration-title')[0].props.onClick();assert.equal(h.options.at(-1).id,'uuid-z');assert.equal(JSON.stringify(products),before);
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
  const [trash]=elements(management,node=>node.type==='button');assert.equal(trash.props.className,'registration-delete');assert.equal(trash.props.disabled,true);assert.equal(trash.props.title,reason);assert.equal(nodeText(trash),'삭제');
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
  assert.match(html,/우드 패턴 다리 선글라스/);assert.equal(registrationStepLabel(product,'SEO'),'완료');assert.equal((html.match(/>대기<\/button>/g)||[]).length,6);
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

const sourceItem={id:'00000000-0000-4000-8000-000000000001',ownerId:'owner',company:{code:'A01464742',name:'와이홉'},fingerprint:'a'.repeat(64),revision:1,snapshot:{offerId:'700000000001',sourceUrl:'https://detail.1688.com/offer/700000000001.html',title:'새 수집 상품',options:[{key:'a'}],images:[{url:'https://cbu01.alicdn.com/test.jpg',role:'main'}]},reviewed:null,receivedAt:'2026-10-19T00:00:00Z',archivedAt:null,issues:['공급자 SKU']};
test('collected product appears in the same fourteen-column board and routes category/review without existing-product handlers',()=>{
 const prepared=[],reviewed=[];const h=boardHarness({sources:[sourceItem],onPrepareSource:item=>prepared.push(item),onReviewSource:item=>reviewed.push(item)});const before=JSON.stringify(h.product);
 const tree=h.render(),sourceRow=elements(tree,node=>node.type==='tr'&&elements(node,child=>child.type==='td'&&child.props['data-column']==='product'&&nodeText(child).includes('새 수집 상품')).length)[0];
 assert.ok(sourceRow);assert.equal(elements(sourceRow,node=>node.type==='td'&&node.props['data-column']).length,14);
 assert.match(nodeText(sourceRow),/등록대기/);assert.doesNotMatch(nodeText(sourceRow),/공급 0원|전송완료|등록완료/);
 const checkbox=elements(sourceRow,node=>node.type==='input'&&node.props.type==='checkbox')[0];assert.equal(checkbox.props.disabled,false);
 elements(sourceRow,node=>node.type==='button'&&node.props['aria-label']==='새 수집 상품 SEO설정 열기')[0].props.onClick();
 elements(sourceRow,node=>node.type==='button'&&node.props.className==='registration-options')[0].props.onClick();
 assert.equal(prepared[0],sourceItem);assert.equal(reviewed[0],sourceItem);assert.equal(h.calls.length,0);assert.equal(h.options.length,0);
 elements(tree,node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0].props.onChange({target:{checked:true}});assert.deepEqual([...h.selections[0]],[h.product.id]);assert.equal(JSON.stringify(h.product),before);
});
test('only the captured entry is archived through its own handler',async()=>{
 const archived=[],deleted=[];const h=boardHarness({sources:[sourceItem],onArchiveSource:async item=>archived.push(item),onDelete:async product=>deleted.push(product)});
 const button=elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='새 수집 상품 삭제')[0];await button.props.onClick();assert.equal(archived[0],sourceItem);assert.equal(deleted.length,0);
});

test('checked source rows publish their exact saved capture identity independently of product selection and stable rerenders',()=>{
 const published=[],h=boardHarness({sources:[sourceItem],onSourceSelectionChange:refs=>published.push(refs)});
 h.render();assert.deepEqual(published.map(refs=>refs.length),[0]);
 const checkbox=elements(h.render(),node=>node.type==='input'&&node.props['aria-label']==='새 수집 상품 선택')[0];
 assert.match(checkbox.props.title,/작업개시.*카테고리/);checkbox.props.onChange({target:{checked:true}});h.render();
 assert.equal(h.selections.length,0,'source identity never enters the ordinary product-ID selection');assert.equal(published.length,2);
 const [selected]=published.at(-1);assert.deepEqual(JSON.parse(JSON.stringify(selected)),{ownerId:'owner',company:{code:'A01464742',name:'와이홉'},id:sourceItem.id,fingerprint:sourceItem.fingerprint,sourceUrl:sourceItem.snapshot.sourceUrl,revision:sourceItem.revision});
 h.render();h.update({onSourceSelectionChange:refs=>published.push(refs)});h.render();assert.equal(published.length,2,'inline parent callbacks and unchanged rerenders cannot republish indefinitely');
 selected.company.name='changed callback copy';h.render();assert.equal(published.length,2,'published values cannot mutate the internal selection');
 elements(h.render(),node=>node.type==='input'&&node.props['aria-label']==='새 수집 상품 선택')[0].props.onChange({target:{checked:false}});h.render();assert.equal(published.at(-1).length,0);
});

test('collected title preparation has inline progress/errors and completion returns the full SEO stage to waiting',()=>{
 const titlePreparation={format:'yoofam-collected-title-v1',fingerprint:sourceItem.fingerprint,revision:sourceItem.revision,sourceTitle:sourceItem.snapshot.title,state:'pending',translatedTitle:null,brand:'',attempts:0,retryable:true,message:'한국어 상품명 준비 대기'};
 const source={...sourceItem,titlePreparation},h=boardHarness({sources:[source]});
 const badge=()=>elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='새 수집 상품 SEO설정 열기')[0];
 assert.equal(nodeText(badge()),'번역 중');assert.match(badge().props.title,/전체 SEO 작업은 대기/);
 h.update({sources:[{...source,titlePreparation:{...titlePreparation,state:'failed',message:'번역 요청 제한'}}]});assert.equal(nodeText(badge()),'번역 오류');assert.match(badge().props.title,/번역 요청 제한/);
 h.update({sources:[{...source,titlePreparation:{...titlePreparation,state:'completed',translatedTitle:'새 수집 상품'}}]});assert.equal(nodeText(badge()),'대기');
 h.update({sources:[{...source,revision:2,titlePreparation:{...titlePreparation,state:'failed'}}]});assert.equal(nodeText(badge()),'대기','old preparation errors never attach to a different review revision');
});

test('published source selections persist through view filters but revoke changed capture, account and company identities',()=>{
 for(const change of ['revision','fingerprint','url','removed','owner','company']){
  const published=[],h=boardHarness({sources:[sourceItem],onSourceSelectionChange:refs=>published.push(refs)});
  const checkbox=elements(h.render(),node=>node.type==='input'&&node.props['aria-label']==='새 수집 상품 선택')[0];checkbox.props.onChange({target:{checked:true}});h.render();assert.equal(published.at(-1).length,1);
  openColumnFilter(h,'상품명').props.onApply({mode:'values',values:['수정한 상품명']});h.render();assert.equal(published.at(-1).length,1,'hiding a selected capture does not silently deselect it');
  if(change==='revision')h.update({sources:[{...sourceItem,revision:sourceItem.revision+1}]});
  if(change==='fingerprint')h.update({sources:[{...sourceItem,fingerprint:'b'.repeat(64)}]});
  if(change==='url')h.update({sources:[{...sourceItem,snapshot:{...sourceItem.snapshot,sourceUrl:'https://detail.1688.com/offer/700000000002.html'}}]});
  if(change==='removed')h.update({sources:[]});
  if(change==='owner')h.update({sourceOwnerId:'other-owner'});
  if(change==='company')h.update({sourceCompany:{code:'A01526306',name:'유앤채'}});
  assert.equal(published.at(-1).length,0,change);
  checkbox.props.onChange({target:{checked:true}});h.render();assert.equal(published.at(-1).length,0,'a stale checkbox cannot restore revoked work identity');h.close();
 }
});

test('captured checkboxes and page selection stay separate from AI/transmission product IDs and enable captured-only bulk archive',async()=>{
 const sources=Array.from({length:13},(_,i)=>({...sourceItem,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
  fingerprint:String(i+1).padStart(64,'0'),snapshot:{...sourceItem.snapshot,title:`수집 상품 ${i+1}`,offerId:String(700000000001+i),sourceUrl:`https://detail.1688.com/offer/${700000000001+i}.html`}}));
 const archived=[],deleted=[],h=boardHarness({sources,onArchiveSource:async item=>archived.push(item),onDelete:async item=>deleted.push(item)}),before=JSON.stringify(h.product);
 const check=()=>elements(h.render(),node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0];
 check().props.onChange({target:{checked:true}});assert.equal(h.selections.length,0,'source-only page never adds IDs to product selection');
 assert.match(elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='선택한 수집 상품 삭제')[0].props.title,/10건 삭제/);elements(h.render(),node=>node.type==='button'&&nodeText(node)==='다음')[0].props.onClick();
 check().props.onChange({target:{checked:true}});assert.deepEqual([...h.selections.at(-1)],[h.product.id]);assert.match(elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='선택한 수집 상품 삭제')[0].props.title,/13건 삭제/);
 const bulk=elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='선택한 수집 상품 삭제')[0];assert.equal(bulk.props.disabled,false);await bulk.props.onClick();
 assert.deepEqual(archived.map(item=>item.id),sources.map(item=>item.id));assert.equal(deleted.length,0);assert.equal(JSON.stringify(h.product),before);
 assert.equal(elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='선택한 수집 상품 삭제')[0].props.disabled,true);assert.match(nodeText(h.render()),/원문은 보존/);
});

test('captured trash ignores product removal locks, and failed bulk archive stops without retrying untouched or successful captures',async()=>{
 const other={...sourceItem,id:'00000000-0000-4000-8000-000000000002',fingerprint:'b'.repeat(64),snapshot:{...sourceItem.snapshot,sourceUrl:'https://detail.1688.com/offer/700000000002.html',title:'두번째 수집'}};
 const calls=[],h=boardHarness({sources:[sourceItem,other],onArchiveSource:async item=>{calls.push(item.id);if(item.id===other.id)throw Error('변경된 수집본');}});
 const trash=elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='새 수집 상품 삭제')[0];assert.equal(trash.props.disabled,false);
 for(const label of ['새 수집 상품 선택','두번째 수집 선택'])elements(h.render(),node=>node.type==='input'&&node.props['aria-label']===label)[0].props.onChange({target:{checked:true}});
 const bulk=()=>elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='선택한 수집 상품 삭제')[0];await bulk().props.onClick();
 assert.deepEqual(calls,[sourceItem.id,other.id]);assert.match(nodeText(h.render()),/1건 삭제됨.*변경된 수집본/);assert.match(bulk().props.title,/1건 삭제/);assert.equal(nodeText(bulk()),'삭제');assert.equal(h.selections.length,0);
});

test('a stale captured checkbox/archive action cannot act after source revision, account/company or disabled-state changes',async()=>{
 for(const kind of ['revision','owner','company','disabled']){
  const calls=[],h=boardHarness({sources:[sourceItem],onArchiveSource:async item=>calls.push(item)});
  const old=elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='새 수집 상품 삭제')[0];
  if(kind==='revision')h.update({sources:[{...sourceItem,revision:2}]});
  if(kind==='owner')h.update({sourceOwnerId:'other'});
  if(kind==='company')h.update({sourceCompany:{code:'A01526306',name:'유앤채'}});
  if(kind==='disabled')h.update({sourceArchiveDisabled:true});
  await old.props.onClick();assert.equal(calls.length,0,kind);h.close();
 }
});

test('account switches and unmounts during an archive stop the remaining batch and discard old success notices',async()=>{
 for(const change of ['owner','close']){
  const other={...sourceItem,id:'00000000-0000-4000-8000-000000000002',fingerprint:'b'.repeat(64)},calls=[];let release;
  const pending=new Promise(resolve=>{release=resolve;}),h=boardHarness({sources:[sourceItem,other],onArchiveSource:async item=>{calls.push(item.id);await pending;}});
  elements(h.render(),node=>node.type==='input'&&node.props['aria-label']==='현재 페이지 전체 선택')[0].props.onChange({target:{checked:true}});
  const operation=elements(h.render(),node=>node.type==='button'&&node.props['aria-label']==='선택한 수집 상품 삭제')[0].props.onClick();
  assert.deepEqual(calls,[sourceItem.id]);if(change==='owner')h.update({sourceOwnerId:'other'});else h.close();release();await operation;
  assert.deepEqual(calls,[sourceItem.id]);if(change==='owner')assert.doesNotMatch(nodeText(h.render()),/수집 상품 2건을 목록에서 삭제했습니다/);
 }
});
