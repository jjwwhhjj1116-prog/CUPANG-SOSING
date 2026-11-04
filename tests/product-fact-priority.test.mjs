import test from 'node:test';
import assert from 'node:assert/strict';
import {providedOptionModule as module} from './helpers/provided-option-quotation.mjs';
import {aiFixture} from './helpers/quotation-ai.mjs';

const plain=value=>JSON.parse(JSON.stringify(value));
const priority=()=>module('app/product-fact-priority.ts');
const detail='85% 棉，10% 氨纶，5% 锦纶';

test('explicit detail composition wins over structured material while both raw sources remain unchanged',()=>{
 const m=priority(),attributes=[{name:'主面料成分',value:'聚酯纤维 80–90%',provenance:'collected'},{name:'颜色',value:'黑色',provenance:'collected'}],before=JSON.stringify(attributes);
 const facts=m.prioritizedProductAttributes(detail,attributes);
 assert.deepEqual(plain(facts),[{name:'主面料成分',value:detail,provenance:'detail-explicit',sourceName:'detail description'},{name:'颜色',value:'黑色',provenance:'collected'}]);
 assert.equal(JSON.stringify(attributes),before);
 assert.equal(m.productFactPriorityIssue('폴리에스테르 85%','material',detail),'상세페이지에 명시된 재질과 일치하지 않습니다');
 assert.equal(m.productFactPriorityIssue('면 80%, 스판덱스 10%, 나일론 5%','material',detail),'상세페이지에 명시된 성분 비율과 일치하지 않습니다');
 assert.equal(m.productFactPriorityIssue('면 85%, 스판덱스 10%, 나일론 5%','material',detail),null);
 assert.equal(m.productFactPriorityIssue('면 85%, 스판덱스 10%, 나일론 5%','material','材质:棉85%，氨纶10%，锦纶5%'),null);
 assert.match(m.productFactPriorityIssue('순면','material',detail),/성분 비율/);
});

test('HTML text is parsed inertly and hidden or executable marketing cannot supply detail facts',()=>{
 const m=priority(),attrs=[{name:'材质',value:'涤纶'}];
 assert.equal(m.prioritizedProductAttributes('<table><tr><td>材质</td><td>棉</td></tr></table>',attrs)[0].value,'棉');
 assert.equal(m.prioritizedProductAttributes('<script>材质: 棉</script><div hidden>材质: 棉</div><p>High cotton content</p>',attrs)[0].value,'涤纶');
});

test('missing or marketing-only detail keeps structured fallback and manual values including blanks always win',()=>{
 const m=priority(),attributes=[{name:'材质',value:'聚酯纤维',provenance:'collected'}];
 for(const description of ['', 'High cotton content\n高含棉量\n舒适防滑'])assert.deepEqual(plain(m.prioritizedProductAttributes(description,attributes)),attributes);
 for(const value of ['직접 검토 소재',''])assert.deepEqual(plain(m.prioritizedProductAttributes(detail,[{name:'material',value,provenance:'manual'}])),[{name:'material',value,provenance:'manual'}]);
});

test('exact named detail facts override only their matching whole product attribute, and ambiguous detail stays empty',()=>{
 const m=priority(),attributes=[{name:'材质',value:'涤纶'},{name:'产品尺寸',value:'30 cm'},{name:'包装材质',value:'纸'}];
 const result=m.prioritizedProductAttributes('材质：棉\n产品尺寸: 25 cm\n包装材质: 纸',attributes);
 assert.equal(result[0].value,'棉');assert.equal(result[1].value,'25 cm');assert.equal(result[2].value,'纸');
 assert.match(m.productFactPriorityIssue('30 cm','dimensions','产品尺寸: 25 cm'),/상세페이지.*숫자/);
 assert.match(m.productFactPriorityIssue('25 mm','dimensions','产品尺寸: 25 cm'),/상세페이지.*단위/);
 const conflicted=m.prioritizedProductAttributes('材质: 棉\n材质: 聚酯纤维',attributes);
 assert.equal(conflicted[0].value,'');assert.equal(conflicted[0].provenance,'detail-conflict');
 assert.match(m.productFactPriorityIssue('면','material','材质: 棉\n材质: 聚酯纤维'),/상세페이지.*상충/);
});

test('saved detail projection preserves manual fields and ignores generated description as new fact evidence',()=>{
 const m=priority(),content=module('app/product-content.ts').emptyProductContent('fact-priority');
 content.label.material={value:'聚酯纤维 80–90%',provenance:'collected',updatedAt:'source'};
 content.detail.description={value:detail,provenance:'translated',updatedAt:'detail'};
 const before=JSON.stringify(content),field=m.prioritizedContentLabelField(content,'material');
 assert.equal(field.value,detail);assert.equal(field.provenance,'translated');assert.equal(field.updatedAt,'detail');assert.equal(JSON.stringify(content),before);
 content.label.material={value:'',provenance:'manual',updatedAt:'manual'};assert.equal(m.prioritizedContentLabelField(content,'material').value,'');
 content.label.material={value:'聚酯纤维',provenance:'collected',updatedAt:'source'};content.detail.description.provenance='generated';
 assert.equal(m.prioritizedContentLabelField(content,'material').value,'聚酯纤维');
});

test('quotation and label projections share explicit detail values while manual option values and blanks stay protected',()=>{
 const f=aiFixture(),m=module('app/quotation-schema.ts'),labels=module('app/product-label.ts');
 f.content.label.material={value:'폴리에스테르 80%',provenance:'collected',updatedAt:'source'};
 f.content.label.dimensions={value:'30 cm',provenance:'collected',updatedAt:'source'};
 f.content.detail.description={value:'재질: 면 85%, 스판덱스 10%, 나일론 5%\n제품 치수: 25 cm\n색상: 빨강\n사이즈: L',provenance:'translated',updatedAt:'detail'};
 const option=f.options.rows[0];option.color='파랑';option.provenance.color='manual';option.size='';option.provenance.size='manual';
 const input={...f.saved,categoryId:f.snapshot.categoryId,categoryPath:f.snapshot.categoryPath,overrides:{common:{},options:{}}},before=JSON.stringify(f.saved);
 let resolved=m.resolveQuotationFields(input),row=resolved.rows.find(row=>row.optionId===option.id);
 const color=resolved.schema.fields.find(field=>field.label==='색상'),size=resolved.schema.fields.find(field=>field.label==='사이즈'),material=resolved.schema.fields.find(field=>field.label==='소재');
 assert.equal(row.fields[color.id].value,'파랑');assert.equal(row.fields[size.id].value,'');assert.equal(row.fields[material.id].value,'면 85%, 스판덱스 10%, 나일론 5%');
 assert.equal(JSON.stringify(f.saved),before);
 const state={schemaVersion:1,productId:f.product.id,revision:0,updatedAt:null,overrides:{common:{},options:{}}};
 let rows=labels.resolveProductLabels({productId:f.product.id,state,content:f.content,options:f.options,quotation:{resolved},settings:f.saved.settings});
 assert.ok(rows.every(row=>row.values.material==='면 85%, 스판덱스 10%, 나일론 5%'));
 f.content.label.material={value:'',provenance:'manual',updatedAt:'manual'};resolved=m.resolveQuotationFields(input);assert.equal(resolved.rows[0].fields[material.id].value,'');
 rows=labels.resolveProductLabels({productId:f.product.id,state,content:f.content,options:f.options,quotation:{resolved},settings:f.saved.settings});assert.ok(rows.every(row=>row.values.material===''));
 assert.equal(priority().prioritizedContentLabelField(f.content,'dimensions').value,'25 cm');
});
