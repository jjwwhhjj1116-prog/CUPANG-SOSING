import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';

const native=createRequire(import.meta.url);
const nodes=tree=>Array.isArray(tree)?tree.flatMap(nodes):tree&&typeof tree==='object'?[tree,...nodes(tree.props?.children)]:[];
const text=tree=>Array.isArray(tree)?tree.map(text).join(''):tree&&typeof tree==='object'?text(tree.props?.children):tree==null?'':String(tree);
const same=(before,after)=>before&&after&&before.length===after.length&&before.every((value,index)=>Object.is(value,after[index]));

/** Execute both real React components, including child keys and effect cleanup.
 * Rendering PNG pixels is a fixture; all saves use the supplied real API. */
export function quotationLabelFormUI({productId,load,request,renderDocument}){
 const modules=new Map(),form={slots:[],pending:[],cursor:0};let current=form,child=null,childKey=null,remounts=0,savedNotifications=0;
 const hooks={
  useState(initial){const target=current,i=target.cursor++;if(!(i in target.slots))target.slots[i]=typeof initial==='function'?initial():initial;return[target.slots[i],value=>target.slots[i]=typeof value==='function'?value(target.slots[i]):value];},
  useRef(initial){const target=current,i=target.cursor++;return target.slots[i]??(target.slots[i]={current:initial});},
  useCallback(fn,deps){const target=current,i=target.cursor++,previous=target.slots[i];if(!previous||!same(previous.deps,deps))target.slots[i]={value:fn,deps};return target.slots[i].value;},
  useId(){const target=current,i=target.cursor++;return target.slots[i]??(target.slots[i]='test-label');},
  useEffect(fn,deps){const target=current,i=target.cursor++,previous=target.slots[i];if(!previous||!same(previous.deps,deps)){target.slots[i]={deps,cleanup:previous?.cleanup};target.pending.push(()=>{previous?.cleanup?.();target.slots[i].cleanup=fn();});}},
 };
 function component(file){
  if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
   {exports,Error,AbortController,URL,window:{addEventListener(){},removeEventListener(){}},document:{getElementById:()=>null},fetch:request,require(name){
    if(name==='react')return hooks;if(name.endsWith('.css'))return{};
    if(name==='@/app/document-image-render')return{renderDocument};
    if(name==='@/app/quotation-label-attachment')return{...load('app/quotation-label-attachment.ts'),attachQuotationLabel:input=>load('app/quotation-label-attachment.ts').attachQuotationLabel(input,request)};
    if(name==='@/app/quotation-label-batch')return{...load('app/quotation-label-batch.ts'),attachQuotationLabels:input=>load('app/quotation-label-batch.ts').attachQuotationLabels(input,request)};
    if(name==='@/app/components/quotation-label-panel')return component('app/components/quotation-label-panel.tsx');
    if(name.startsWith('@/app/components/'))return{[{'quotation-translated-attributes':'QuotationTranslatedAttributes','quotation-choice-input':'QuotationChoiceInput'}[name.split('/').at(-1)]]:name};
    return name.startsWith('@/')?load(name.slice(2)+'.ts'):native(name);
   }});return exports;
 }
 const Form=component('app/components/quotation-fields-editor.tsx').QuotationFieldsEditor;
 const Panel=component('app/components/quotation-label-panel.tsx').QuotationLabelPanel;
 const props={productId,navigationTarget:{optionId:'collected-1',fieldId:'salePrice',categoryId:'80719'},onSaved(){savedNotifications++;}};
 const finish=instance=>{const effects=instance.pending.splice(0);effects.forEach(fn=>fn());};
 const cleanup=instance=>instance?.slots.forEach(value=>value?.cleanup?.());
 function render(){
  current=form;form.cursor=0;const wrapper=Form(props),tree=wrapper.type(wrapper.props);finish(form);
  const boundary=nodes(tree).find(node=>node.type===Panel);
  let panel=null;
  if(boundary){
   if(childKey!==boundary.key){cleanup(child);child={slots:[],pending:[],cursor:0};childKey=boundary.key;remounts++;}
   current=child;child.cursor=0;panel=Panel(boundary.props);finish(child);
  }
  return{tree,panel,boundary};
 }
 const all=()=>{const value=render();return[...nodes(value.tree),...nodes(value.panel)];};
 const button=label=>all().find(node=>node.type==='button'&&text(node.props.children).startsWith(label));
 async function idle(){
  const deadline=Date.now()+20000;
  for(;;){const value=render();if(!value.tree.props['aria-busy']&&!value.panel?.props['aria-busy'])break;if(Date.now()>deadline)throw Error('Quotation label UI timeout');await new Promise(resolve=>setTimeout(resolve,1));}
  await new Promise(resolve=>setImmediate(resolve));render();
 }
 function start(label){const node=button(label);if(!node||node.props.disabled)throw Error('Button unavailable: '+label);node.props.onClick();}
 return{render,idle,start,button,async click(label){start(label);await idle();},stop(){start('일괄 작업 중지');},
  get view(){return render().boundary?.props.view;},get remounts(){return remounts;},get savedNotifications(){return savedNotifications;},
  field(id){return all().find(node=>['input','textarea'].includes(node.type)&&node.props.id?.endsWith('-'+id));},
  fieldDisabled(id){return all().some(node=>node.type==='fieldset'&&node.props.disabled&&nodes(node).some(field=>field.props?.id?.endsWith('-'+id)));},
  section(title){const node=all().find(node=>node.type==='button'&&nodes(node.props.children).some(item=>item.type==='span'&&item.props.children===title));if(!node||node.props.disabled)throw Error('Section unavailable');node.props.onClick();},
  alerts:()=>all().filter(node=>node.props?.role==='alert').map(node=>text(node.props.children)),
  close(){cleanup(child);cleanup(form);},
 };
}
