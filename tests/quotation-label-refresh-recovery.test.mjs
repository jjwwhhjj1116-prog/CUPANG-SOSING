import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mobileIntakeHarness} from './helpers/mobile-intake.mjs';
import {quotationWorkbook} from './helpers/quotation-workbook.mjs';
import {quotationLabelFormUI} from './helpers/quotation-label-form-ui.mjs';

const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
async function fixture(company={companyCode:'A01464742',companyName:'와이홉'}){
 const h=mobileIntakeHarness(company);
 const fields=['skuId',...h.load('app/quotation-schema.ts').getQuotationSchema('80719').fields.map(field=>field.id)];
 const bytes=quotationWorkbook(fields),sha256=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const storageKey=h.load('db/category-templates.ts').templateKey('owner',sha256,'xlsx');h.objects.set(storageKey,bytes);
 await h.load('db/category-profiles.ts').createCategoryProfile('owner',{name:'읽기 복구 콜백 시험',categoryId:'80719',categoryPath:h.context.category.categoryPath,
  template:{name:'synthetic.xlsx',format:'xlsx',sha256,storageKey,sheetName:'견적서',headerRow:1,headers:fields},mappings:fields.map((field,column)=>({field,column,required:false}))},'cat');
 await h.intake();const product=h.sqlite.prepare('SELECT * FROM products').get(),endpoint='/api/products/'+product.id+'/quotation-fields';
 const calls=[];let fail=false,hold=null,writeHold=null;
 const request=async(url,init={})=>{calls.push({url,method:init.method??'GET',body:init.body});if(url===endpoint&&init.method==='PUT'&&writeHold)return writeHold.promise;if(url===endpoint&&!init.method){if(hold)return hold.promise;if(fail)return Response.json({error:'synthetic recovery GET unavailable'},{status:503});}return h.route(url,{method:init.method??'GET',...(init.body?{body:JSON.parse(init.body)}:{})});};
 const ui=quotationLabelFormUI({productId:product.id,load:h.load,request,renderDocument:()=>assert.fail('read-only recovery must not render or upload PNG')});await ui.idle();
 return{h,ui,calls,endpoint,setFail:value=>{fail=value;},setHold:value=>{hold=value;},setWriteHold:value=>{writeHold=value;},
  async latch(){const boundary=ui.render().boundary;boundary.props.onBusyChange(true);fail=true;await boundary.props.onFailed('synthetic label failure');boundary.props.onBusyChange(false);await ui.idle();},
  close(){ui.close();h.close();}};
}
for(const company of [{companyCode:'A01464742',companyName:'와이홉'},{companyCode:'A01526306',companyName:'유앤채'}])test('explicit label recovery retries GET while editing stays locked, then releases only after success ('+company.companyCode+')',async()=>{
 const f=await fixture(company);try{
  await f.latch();assert.equal(f.ui.fieldDisabled('salePrice'),true);assert.equal(f.ui.button('전체 포함 옵션 라벨 생성·연결').props.disabled,true);assert.equal(f.ui.button('기본값 다시 반영').props.disabled,false);
  const before=f.calls.length;await f.ui.click('기본값 다시 반영');assert.equal(f.calls.length,before+1);assert.ok(f.ui.alerts().some(value=>value.includes('synthetic recovery GET unavailable')));assert.equal(f.ui.fieldDisabled('salePrice'),true);
  f.setFail(false);await f.ui.click('기본값 다시 반영');assert.equal(f.calls.length,before+2);assert.equal(f.ui.fieldDisabled('salePrice'),false);assert.equal(f.ui.button('전체 포함 옵션 라벨 생성·연결').props.disabled,false);
  assert.ok(f.calls.every(call=>call.url===f.endpoint&&call.method==='GET'));
 }finally{f.close();}
});
test('captured explicit refresh refuses same-tick task, split, option, draft and unmounted actions',async()=>{
 const f=await fixture();try{
  for(const lock of ['label','ai','split','split-draft']){
   const old=f.ui.button('기본값 다시 반영').props.onClick,value=f.ui.render(),tree=nodes(value.tree);
   const props=lock==='label'?value.boundary.props:lock==='ai'?tree.find(node=>node.props?.onApply&&node.props?.onBusyChange).props:tree.find(node=>node.props?.onDraftChange&&node.props?.onBusyChange).props;
   const toggle=lock==='split-draft'?props.onDraftChange:props.onBusyChange,before=f.calls.length;toggle(true);old();assert.equal(f.calls.length,before,lock+' starts before React commits its disabled state');toggle(false);await f.ui.idle();
  }
  let old=f.ui.button('기본값 다시 반영').props.onClick,before=f.calls.length;
  const select=nodes(f.ui.render().tree).find(node=>node.type==='select'&&nodes(node).some(item=>item.type==='option'&&item.props.value==='collected-2'));
  select.props.onChange({target:{value:'collected-2'}});old();assert.equal(f.calls.length,before);await f.ui.idle();old();assert.equal(f.calls.length,before,'a committed different option also rejects the old callback');
  old=f.ui.button('기본값 다시 반영').props.onClick;f.ui.field('salePrice').props.onChange({target:{value:'23456'}});old();assert.equal(f.calls.length,before,'same-tick field draft is never lost to an old refresh');await f.ui.idle();
  await f.ui.click('기본값 다시 반영');assert.equal(f.ui.field('salePrice').props.value,'23456','ordinary explicit refresh reconciles and preserves the current unsaved draft');
  await f.latch();assert.equal(f.ui.button('기본값 다시 반영').props.disabled,true,'recovery exception cannot bypass an unsaved field draft');assert.equal(f.ui.field('salePrice').props.value,'23456');
  old=f.ui.button('기본값 다시 반영').props.onClick;before=f.calls.length;f.ui.close();old();assert.equal(f.calls.length,before);
 }finally{f.close();}
});
test('an explicit recovery read synchronously blocks duplicate and loading callbacks without mutations',async()=>{
 const f=await fixture();try{
  await f.latch();f.setFail(false);let resolve;const promise=new Promise(done=>{resolve=done;});f.setHold({promise});
  const old=f.ui.button('기본값 다시 반영').props.onClick,before=f.calls.length;old();old();assert.equal(f.calls.length,before+1);assert.equal(f.ui.button('기본값 다시 반영').props.disabled,true);old();assert.equal(f.calls.length,before+1);
  f.setHold(null);resolve(await f.h.route(f.endpoint));await f.ui.idle();assert.equal(f.ui.fieldDisabled('salePrice'),false);old();assert.equal(f.calls.length,before+1,'a handler captured for a different saved view cannot start another read');assert.ok(f.calls.every(call=>call.method==='GET'));
 }finally{f.close();}
});
test('a captured refresh cannot interrupt a current write or act on its superseded saved view',async()=>{
 const f=await fixture();try{
  f.ui.field('salePrice').props.onChange({target:{value:'23456'}});await f.ui.idle();
  const old=f.ui.button('기본값 다시 반영').props.onClick;let resolve;const promise=new Promise(done=>{resolve=done;});f.setWriteHold({promise});
  f.ui.start('견적 입력 저장');const write=f.calls.at(-1),before=f.calls.length;assert.equal(write.method,'PUT');old();assert.equal(f.calls.length,before,'activeWrite blocks even before the busy render');assert.equal(f.ui.button('기본값 다시 반영').props.disabled,true);
  f.setWriteHold(null);resolve(await f.h.route(f.endpoint,{method:'PUT',body:JSON.parse(write.body)}));await f.ui.idle();const after=f.calls.length;old();assert.equal(f.calls.length,after,'the completed write changed the captured view/draft basis');assert.equal(f.ui.field('salePrice').props.value,'23456');assert.equal(f.calls.filter(call=>call.method==='PUT').length,1);
 }finally{f.close();}
});
