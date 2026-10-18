import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {companies,syntheticSnapshot,projectionFixture,module,plain} from './helpers/supplier-hub-single-projection.mjs';

const project=module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument;
const hidden=['productPage','unexposedAttributes'];
const fieldValue=(out,path,name)=>{
 let node=out.payload.jsonDocument[0];for(const key of path)node=node[key];
 return name===undefined?node:node.find(item=>item.attributeName===name||item.noticeItemName===name||item.name===name);
};
const nullable={type:['string','null']};
const entry=(name,node)=>({contains:{type:'object',properties:{attributeName:{type:'string',enum:[name],requirement:'필수'},attributeValue:node},required:['attributeName','attributeValue']}});
const withHidden=node=>{
 const snapshot=syntheticSnapshot(),raw=JSON.parse(snapshot.schemaString);
 raw.properties.productPage.properties.unexposedAttributes.allOf[1].contains.properties.attributeValue=node;
 snapshot.schemaString=JSON.stringify(raw);return projectionFixture(snapshot);
};
const recorded=new URL('../outputs/step650-official-81452-profile-after.json',import.meta.url);

for(const company of companies)test(`recorded 81452 default GTIN and manufacturer part placeholders retain typed null (${company.code})`,{skip:!fs.existsSync(recorded)},async()=>{
 const bytes=fs.readFileSync(recorded),beforeHash=createHash('sha256').update(bytes).digest('hex'),saved=JSON.parse(bytes);
 // Only Unand's schema was observed; the second company uses that same wire
 // contract in this isolated fixture, without claiming a live Waihop capture.
 const f=projectionFixture({...saved.hubSchema,company:{...company}});
 const fields=f.schema.fields.filter(field=>JSON.stringify(field.hubWire?.path)===JSON.stringify(hidden));
 assert.equal(fields.length,10);for(const field of fields)f.set(hidden,field.hubWire.name,'','couplus-default');
 const before=JSON.stringify(f.input),out=await project(f.input),values=out.payload.jsonDocument[0].productPage.unexposedAttributes;
 for(const name of ['Global Trade Item Number','Parent Manufacturer Part Number','Manufacturer Part Number']){
  assert.equal(values.find(item=>item.attributeName===name).attributeValue,null);
 }
 assert.equal(values.length,10);assert.ok(values.every(item=>item.attributeValue===null),'the seven existing enum-null placeholders also remain null');
 assert.deepEqual(plain(values.map(item=>item.attributeName)),fields.map(field=>field.hubWire.name));
 assert.ok(!out.review.issues.some(issue=>issue.code==='TYPE_OR_CONSTRAINT'&&fields.some(field=>field.id===issue.fieldId)));
 assert.equal(JSON.stringify(f.input),before);assert.equal(createHash('sha256').update(fs.readFileSync(recorded)).digest('hex'),beforeHash);
 assert.equal(out.registered,false);assert.equal(out.remoteWrites,false);assert.equal(out.submissionReady,false);
});

test('only untouched automatic hidden placeholders become null; manual, content and other empty sources remain strings',async()=>{
 for(const source of ['couplus-default','manual-common','manual-option','content','option','schema','empty','product','settings','pricing']){
  const f=projectionFixture(),id=f.set(hidden,'수동 공란','',source),before=JSON.stringify(f.input),out=await project(f.input);
  assert.equal(fieldValue(out,hidden,'수동 공란').attributeValue,source==='couplus-default'?null:'',source);
  const review=out.review.fields.find(field=>field.fieldId===id);assert.equal(review.source,source);assert.equal(review.savedValue,'');assert.equal(review.projected,true);
  assert.equal(JSON.stringify(f.input),before);
 }
});

test('default source does not erase real text, whitespace or explicit manual part numbers, and excluded rows stay excluded',async()=>{
 for(const [source,value]of [['couplus-default',' '],['couplus-default','PART-001'],['manual-option','PART-002'],['manual-common','0']]){
  const f=projectionFixture();f.set(hidden,'수동 공란',value,source);
  f.resolved.rows.push({...structuredClone(f.row),optionId:'excluded',included:false});
  const out=await project(f.input);assert.equal(fieldValue(out,hidden,'수동 공란').attributeValue,value);assert.equal(out.payload.jsonDocument.length,1);
 }
});

test('nullable model, common text, exposed attributes and legal notices keep their independent blank meanings',async()=>{
 const snapshot=syntheticSnapshot(),raw=JSON.parse(snapshot.schemaString);
 raw.properties.productPage.properties.brand={...nullable,title:'브랜드'};
 raw.properties.productPage.properties.commonAttributes.properties.optionalText={...nullable,title:'일반 선택 입력'};
 raw.properties.productPage.properties.commonAttributes.properties.exposedAttributes.allOf.push(entry('다른 노출 자유 입력',nullable));
 raw.properties.legalPage.properties.notices.allOf.push({contains:{type:'object',properties:{noticeItemName:{type:'string',enum:['다른 고시 입력']},noticeItemValue:nullable},required:['noticeItemName','noticeItemValue']}});
 snapshot.schemaString=JSON.stringify(raw);const f=projectionFixture(snapshot);
 const paths=[[['productPage','modelNumber'],undefined],[['productPage','brand'],undefined],[['productPage','commonAttributes','optionalText'],undefined],
  [['productPage','commonAttributes','exposedAttributes'],'다른 노출 자유 입력'],[['legalPage','notices'],'다른 고시 입력']];
 for(const [path,name]of paths)f.set(path,name,'','couplus-default');
 const before=JSON.stringify(f.input),out=await project(f.input);
 for(const [path,name]of paths){const value=fieldValue(out,path,name);assert.equal(name===undefined?value:path[0]==='legalPage'?value.noticeItemValue:value.attributeValue,'',path.join('.')+':'+name);}
 assert.equal(JSON.stringify(f.input),before);
});

test('the default-null rule requires the exact two string/null types, while ordinary primitive conversion remains unchanged',async()=>{
 for(const [node,expected]of [[{type:['null','string']},null],[{type:'string'},''],[{type:['integer','null']},null],[{type:['boolean','null']},null]]){
  const f=withHidden(node);f.set(hidden,'수동 공란','','couplus-default');
  const out=await project(f.input);assert.equal(fieldValue(out,hidden,'수동 공란').attributeValue,expected);
 }
});

test('declared null and empty-string choices retain the enum primitive rather than receiving a free-text conversion',async()=>{
 for(const [node,expected]of [[{...nullable,enum:[null,'선택']},null],[{...nullable,enum:['','선택']},''],[{...nullable,dropdown:['','선택']},'']]){
  const f=withHidden(node);f.set(hidden,'수동 공란','','couplus-default');
  const out=await project(f.input);assert.equal(fieldValue(out,hidden,'수동 공란').attributeValue,expected);
 }
});

test('invalid duplicate or mixed type unions and ambiguous empty/null enum choices cannot bypass existing validation',async()=>{
 const duplicate=withHidden({type:['string','null','null']});duplicate.set(hidden,'수동 공란','','couplus-default');
 const out=await project(duplicate.input),id=duplicate.schema.fields.find(field=>field.hubWire?.name==='수동 공란').id;
 assert.ok(!Object.hasOwn(fieldValue(out,hidden,'수동 공란'),'attributeValue'));
 assert.ok(out.review.issues.some(issue=>issue.fieldId===id&&issue.code==='TYPE_OR_CONSTRAINT'));assert.equal(out.review.documentShapeComplete,false);
 for(const node of [{type:['string','null','boolean']},{...nullable,enum:[null,'']}]){
  const f=withHidden(node);
  assert.ok(f.schema.unsupportedFields.length,'the compiler must retain unsupported primitive diagnostics');
  await assert.rejects(project(f.input),error=>error.code==='SINGLE_UNSUPPORTED');
 }
});

test('hidden named-array key identity and ordering are retained without guessing attribute names',async()=>{
 const snapshot=syntheticSnapshot(),raw=JSON.parse(snapshot.schemaString),properties=raw.properties.productPage.properties.unexposedAttributes.allOf[1].contains.properties;
 const name=properties.attributeName,value=properties.attributeValue;
 raw.properties.productPage.properties.unexposedAttributes.allOf[1].contains={type:'object',properties:{name,value},required:['name','value']};
 snapshot.schemaString=JSON.stringify(raw);const f=projectionFixture(snapshot);f.set(hidden,'수동 공란','','couplus-default');
 const before=JSON.stringify(f.input),out=await project(f.input),result=fieldValue(out,hidden,'수동 공란');
 assert.deepEqual(plain(result),{name:'수동 공란',value:null});assert.equal(JSON.stringify(f.input),before);
});
