import {quotationTitleLoader,quotationTitleUI,titleNodes,titleText} from './quotation-seo-title-ui.mjs';
export {quotationTitleLoader,quotationTitleUI,titleNodes,titleText};
const load=quotationTitleLoader();
export const plain=value=>JSON.parse(JSON.stringify(value));
export function quotationPresentationFixture({overrides,native=false}={}){
 const model=load('app/quotation-schema.ts'),content=load('app/product-content.ts').emptyProductContent('p1'),options=load('app/product-options.ts');
 content.seo.title.value='확인한 상품명';content.seo.keywords.value=['상품 태그'];
 const source={categoryId:'80719',product:{id:'p1',title:'원문 제목',supply_price:2000,sale_price:3000,msrp:4000,exchange_rate:200,supply_margin:0,coupang_margin:0,image_keys:'[]'},
  content,settings:load('app/workspace-settings.ts').defaultSettings,
  options:options.applyOptionRows(options.emptyProductOptions('p1'),['red','blue'].map(id=>({...options.emptyOptionInput(id),originalName:id,unitCostCny:4.5,included:true})),'2026-10-21T00:00:00.000Z')};
 const manual=overrides??model.emptyQuotationOverrides();
 const view=plain({revision:1,inputFingerprint:'a'.repeat(64),overrides:manual,resolved:model.resolveQuotationFields({...source,overrides:manual}),automatic:model.resolveQuotationFields(source),imageKeys:[],submissionReady:false,
  categoryContext:{source:'collection',profileId:null,categoryId:source.categoryId,categoryPath:[]},productVersion:'2026-10-21T00:00:00.000Z',contentRevision:0,optionRevision:1,updatedAt:null});
 if(native)for(const result of [view.resolved,view.automatic])for(const [id,path] of [['title',['startPage','productName']],['model',['productPage','modelNumber']]]){
  const field=result.schema.fields.find(item=>item.id===id);field.hubWire={path};field.hubInput=id;
 }
 return view;
}

/** Native closed <details> retains its descendants in the DOM but exposes only
 * its summary. No CSS-only hiding or fake unmounting is assumed here. */
export function visibleNodes(tree,opened=new Set()){
 if(Array.isArray(tree))return tree.flatMap(item=>visibleNodes(item,opened));
 if(!tree||typeof tree!=='object')return[];
 if(tree.type==='details'&&!tree.props.open&&!opened.has(tree))return[tree,...(Array.isArray(tree.props.children)?tree.props.children:[tree.props.children]).filter(item=>item?.type==='summary').flatMap(item=>visibleNodes(item,opened))];
 return[tree,...visibleNodes(tree.props?.children,opened)];
}
export const visibleText=(tree,opened)=>visibleNodes(tree,opened).filter(node=>typeof node.type==='string'&&['p','small','label','h3','h4','summary','strong','button','span'].includes(node.type)).map(node=>node.type==='summary'?titleText(node):titleText(node.props.children)).join('\n');
export const fieldContainer=(ui,id)=>ui.nodes().find(node=>node.props?.className?.split?.(' ').includes('quotation-field')&&titleNodes(node).some(item=>item.props?.id==='seo-title-test-'+id));
