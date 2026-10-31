import test from 'node:test';
import assert from 'node:assert/strict';
import {module,projectionFixture,syntheticSnapshot,plain} from './helpers/supplier-hub-single-projection.mjs';
import {imageBytes,sha} from './helpers/supplier-hub-single-assets.mjs';
import {createProductDocumentPacket,validateProductDocumentPacket} from '../extensions/supplier-hub/product-document.mjs';
const {projectNativeRequiredForm:project,NATIVE_FORM_SERIALIZATION_POLICY:policy}=module('app/supplier-hub-native-form-projection.ts');
const scalar=(type='string',example='')=>({type,examples:[example]});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required});
const named=(name,entries)=>({type:'array',allOf:entries.map(([label,value])=>({contains:object({[name]:{type:'string',enum:[label]},value})})),examples:[entries.map(([label])=>({[name]:label,value:''}))]});
function fixture(){
 const attributes=named('name',[['empty',scalar(['string','null'])],['nullable-enum',{...scalar(['string','null']),enum:['valid',null]}]]);
 const schema=object({startPage:object({productName:scalar(),categoryPath:scalar()}),productPage:object({brand:scalar(),commonAttributes:object({purchasePrice:scalar(),coupangSalePrice:scalar(),msrp:scalar(['string','null']),osrp:scalar(['string','null']),exposedAttributes:named('name',[['color',scalar()]])},['purchasePrice','coupangSalePrice','msrp','exposedAttributes']),unexposedAttributes:attributes}),
  imagePage:object({images:object({mainImage:scalar(),additionalImage:scalar(['string','null']),sizeChartImage:scalar(['string','null']),labelImages:named('label',[['Korean',scalar()]])},['mainImage','additionalImage','labelImages']),details:object({detailedImage:scalar(),htmlProductDetailContent:scalar(['string','null'])}),msrpAgree:scalar('boolean',false),labelContactAgreed:scalar('boolean',false)}),
  legalPage:object({productNoticeName:{...scalar(),prefilled:true},certificates:named('certificate',[['cert',scalar(['string','null'])]]),notices:named('notice',[['material',scalar()]])},['certificates','notices']),
  logisticsPage:object({packagedWeight:scalar()}),sourcingPage:object({sourcingChannelId:scalar(['string','null']),sourcingChannelType:scalar(['string','null'])})});
 const member={startPage:{productName:'saved product',categoryPath:'saved category'},productPage:{brand:'saved brand',commonAttributes:{purchasePrice:'100',coupangSalePrice:'200',msrp:'300',osrp:'400',exposedAttributes:[{name:'color',value:'black'}]},unexposedAttributes:[{name:'empty',value:null},{name:'nullable-enum',value:null}]},imagePage:{images:{mainImage:'main.jpg',additionalImage:'extra.jpg',labelImages:[{label:'Korean',value:'label.jpg'}]},details:{detailedImage:'detail-1.jpg,detail-2.jpg',htmlProductDetailContent:''},msrpAgree:false,labelContactAgreed:false},legalPage:{productNoticeName:'saved notice',certificates:[{certificate:'cert',value:'해당사항없음'}],notices:[{notice:'material',value:'saved material'}]},logisticsPage:{packagedWeight:'10'},sourcingPage:{sourcingChannelId:null,sourcingChannelType:null}};
 return {schema,payload:{docId:null,productName:'saved product',jsonDocument:[member,structuredClone(member),structuredClone(member)]}};
}
test('opt-in native model projects schema-defined optional fields, nullable defaults and all option images without changing local sources',()=>{
 const f=fixture(),before=JSON.stringify(f),out=project(f.schema,f.payload);assert.equal(JSON.stringify(f),before);
 for(const row of out.jsonDocument){assert.equal(Object.hasOwn(row.productPage.commonAttributes,'osrp'),false);assert.equal(Object.hasOwn(row.legalPage,'productNoticeName'),false);assert.equal(row.imagePage.details.htmlProductDetailContent,null);assert.equal(row.imagePage.images.sizeChartImage,'');assert.deepEqual(plain(row.productPage.unexposedAttributes.map(row=>row.value)),['',null]);assert.equal(row.imagePage.details.detailedImage,'detail-1.jpg,detail-2.jpg');assert.equal(row.imagePage.images.mainImage,'main.jpg');assert.equal(row.imagePage.images.labelImages[0].value,'label.jpg');assert.equal(row.legalPage.certificates[0].value,'해당사항없음');assert.equal(row.imagePage.msrpAgree,false);}
 assert.deepEqual(plain(out.jsonDocument.map(row=>row.sourcingPage)),[{sourcingChannelId:null,sourcingChannelType:null},{sourcingChannelId:'',sourcingChannelType:''},{sourcingChannelId:'',sourcingChannelType:''}]);
});
test('native projection retains required osrp/notice and rejects meaningful shared-field, false/zero and ambiguous model losses',()=>{
 const f=fixture();f.schema.properties.productPage.properties.commonAttributes.required.push('osrp');f.schema.properties.legalPage.required.push('productNoticeName');const out=project(f.schema,f.payload);assert.equal(out.jsonDocument[0].productPage.commonAttributes.osrp,'400');assert.equal(out.jsonDocument[0].legalPage.productNoticeName,'saved notice');
 for(const edit of [f=>f.payload.jsonDocument[1].productPage.brand='different saved brand',f=>f.payload.jsonDocument[0].productPage.commonAttributes.msrp=0,f=>f.payload.jsonDocument[0].productPage.unexposedAttributes[0].value=false,f=>f.schema.properties.productPage.examples=[{}],f=>f.schema.properties.productPage.examples=[],f=>f.schema.properties.imagePage.properties.details.default={},f=>f.schema.properties.productPage.properties.unexposedAttributes.examples[0].reverse(),f=>f.schema.properties.productPage.properties.unexposedAttributes.examples.push([]),f=>delete f.schema.properties.productPage.properties.commonAttributes.properties.msrp.examples,f=>{const n=f.schema.properties.productPage.properties.commonAttributes.properties.msrp;delete n.examples;n.default=null;},f=>f.schema.properties.productPage.$ref='#/unobserved',f=>f.schema.properties.productPage.properties.brand.oneOf=[]]){
  const next=fixture();edit(next);const before=JSON.stringify(next);assert.throws(()=>project(next.schema,next.payload));assert.equal(JSON.stringify(next),before);
 }
});

test('native agreement controls still reject nonboolean, missing and mixed per-option values without changing saved inputs',()=>{
 for(const key of ['msrpAgree','labelContactAgreed']){
  for(const value of [null,undefined,'true','false',0,1,{},[]]){
   const f=fixture();for(const row of f.payload.jsonDocument){if(value===undefined)delete row.imagePage[key];else row.imagePage[key]=value;}
   const before=JSON.stringify(f);assert.throws(()=>project(f.schema,f.payload));assert.equal(JSON.stringify(f),before);
  }
  const f=fixture();f.payload.jsonDocument[0].imagePage[key]=true;
  const before=JSON.stringify(f);assert.throws(()=>project(f.schema,f.payload));assert.equal(JSON.stringify(f),before);
 }
});

test('optional declared native agreement controls remain shared across options while preserving uniform saved true or false',()=>{
 for(const key of ['msrpAgree','labelContactAgreed'])for(const value of [true,false]){
  const f=fixture();f.schema.properties.imagePage.required=f.schema.properties.imagePage.required.filter(name=>name!==key);
  for(const row of f.payload.jsonDocument)row.imagePage[key]=value;
  const before=JSON.stringify(f),out=project(f.schema,f.payload);assert.equal(JSON.stringify(f),before);
  assert.deepEqual(plain(out.jsonDocument.map(row=>row.imagePage[key])),[value,value,value]);
  f.payload.jsonDocument[1].imagePage[key]=!value;const mixed=JSON.stringify(f);
  assert.throws(()=>project(f.schema,f.payload));assert.equal(JSON.stringify(f),mixed);
 }
});
function projectionInput(){
 const snapshot=syntheticSnapshot(),raw=JSON.parse(snapshot.schemaString);
 function fill(node){if(node.properties){node.required=Object.keys(node.properties);for(const child of Object.values(node.properties))fill(child);}else if(node.allOf){for(const entry of node.allOf)fill(entry.contains);const [nameKey,valueKey]=Object.keys(node.allOf[0].contains.properties);node.examples=[node.allOf.map(entry=>({[nameKey]:entry.contains.properties[nameKey].enum[0],[valueKey]:''}))];}else if(!node.enum)node.examples=[Object.hasOwn(node,'default')?node.default:node.type==='integer'?7:node.type==='boolean'?false:''];}
 fill(raw);raw.properties.productPage.properties.commonAttributes.properties.osrp=scalar(['string','null']);raw.properties.legalPage.properties.productNoticeName={...scalar(),prefilled:true,minLength:1};raw.properties.imagePage.properties.images.properties.sizeChartImage=scalar(['string','null']);raw.properties.imagePage.properties.images.properties.labelImages.allOf[0].contains.properties.labelImageType.enum=['제품 한글 표시사항 라벨 또는 도안 이미지'];raw.properties.imagePage.properties.images.properties.labelImages.examples[0][0].labelImageType='제품 한글 표시사항 라벨 또는 도안 이미지';snapshot.schemaString=JSON.stringify(raw);
 const f=projectionFixture(snapshot);
 for(const field of f.schema.fields){const wire=field.hubWire;if(!wire||!wire.name)continue;const choice=field.choices?.find(choice=>choice.value!=='');f.set(wire.path,wire.name,choice?.value??'saved named value');}
 f.set(['productPage','commonAttributes','count'],undefined,'7');f.set(['productPage','commonAttributes','booleanValue'],undefined,'true');
 f.set(['logisticsPage','totalSKUsInBox'],undefined,'50');
 f.set(['productPage','commonAttributes','osrp'],undefined,'39930');f.set(['legalPage','productNoticeName'],undefined,'saved notice');f.set(['imagePage','msrpAgree'],undefined,'false');f.set(['imagePage','labelContactAgreed'],undefined,'false');f.set(['productPage','unexposedAttributes'],'수동 공란','','couplus-default');
 return f;
}
test('real saved-value projector keeps legacy output stable and binds only explicitly marked new projection to its exact schema SHA',async()=>{
 const f=projectionInput(),project=module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument,before=JSON.stringify(f.input),legacy=await project(f.input);
 assert.equal(Object.hasOwn(legacy,'nativeSerializationPolicy'),false);assert.equal(legacy.payload.jsonDocument[0].productPage.commonAttributes.osrp,'39930');assert.equal(legacy.payload.jsonDocument[0].legalPage.productNoticeName,'saved notice');
 const native=await project({...f.input,nativeSerializationPolicy:policy});assert.equal(native.nativeSerializationPolicy.format,policy);assert.equal(native.nativeSerializationPolicy.schemaSha256,legacy.schemaSha256);assert.equal(Object.hasOwn(native.payload.jsonDocument[0].productPage.commonAttributes,'osrp'),false);assert.equal(Object.hasOwn(native.payload.jsonDocument[0].legalPage,'productNoticeName'),false);
 for(const path of [['productPage','commonAttributes','osrp'],['legalPage','productNoticeName']]){const field=native.review.fields.find(field=>JSON.stringify(field.path)===JSON.stringify(path));assert.equal(field.projected,false);assert.ok(field.savedValue);assert.ok(native.review.issues.some(issue=>issue.code==='NATIVE_FORM_FIELD_OMITTED'&&issue.fieldId===field.fieldId));}
 assert.deepEqual(plain(await project(f.input)),plain(legacy));assert.equal(JSON.stringify(f.input),before);
 const captured={...f.input,snapshot:{...f.snapshot,nativeSerializationPolicy:policy}};assert.deepEqual(plain(await project(captured)),plain(native));
 await assert.rejects(project({...f.input,nativeSerializationPolicy:'unknown'}),error=>error.code==='SINGLE_NATIVE_SERIALIZATION_POLICY');
});

for(const agreementSource of ['compiled-default-true','manual-false'])test(`new projection placeholders and ${agreementSource} controls retain their original facts through private bytes, compiled review and deferred packet validation`,async()=>{
 const f=projectionInput(),keys=['owner/main.png','owner/add-1.png','owner/add-2.png','owner/detail-top.png','owner/detail-body.png','owner/detail-bottom.png','owner/label.png'];
 f.set(['imagePage','images','mainImage'],undefined,keys[0]);f.set(['imagePage','images','additionalImage'],undefined,keys.slice(1,3).join('\n'));f.set(['imagePage','details','detailedImage'],undefined,keys.slice(3,6).join('\n'));f.set(['imagePage','images','labelImages'],'제품 한글 표시사항 라벨 또는 도안 이미지',keys[6]);
 const agreementFields=f.schema.fields.filter(field=>field.hubWire?.path[0]==='imagePage'&&['msrpAgree','labelContactAgreed'].includes(field.hubWire.path[1]));
 assert.equal(agreementFields.length,2);const originalAgreement=agreementSource==='compiled-default-true';
 for(const field of agreementFields){assert.equal(field.draftDefault,'true');f.set(field.hubWire.path,undefined,originalAgreement?field.draftDefault:'false',originalAgreement?'couplus-default':'manual-option');}
 const second=structuredClone(f.row);second.optionId='synthetic-two';second.optionLabel='흰색';f.resolved.rows.push(second);
 const projectSaved=module('app/supplier-hub-single-projection.ts').projectSupplierHubSingleDocument,before=JSON.stringify(f.input),legacyBefore=JSON.stringify(await projectSaved(f.input)),projection=await projectSaved({...f.input,nativeSerializationPolicy:policy});
 assert.equal(projection.review.unresolvedImages.length,8);assert.equal(projection.payload.jsonDocument[0].imagePage.images.mainImage,' ');
 assert.equal(projection.humanAgreementsConfirmed,false);assert.equal(projection.remoteWrites,false);
 for(const row of projection.payload.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])assert.equal(row.imagePage[key],originalAgreement);
 const source={productVersion:'2026-10-31T00:00:00.000Z',contentRevision:1,optionRevision:2,quotationRevision:3,profileId:'captured-category',profileRevision:null},identity={ownerId:'owner',productId:'synthetic-native-policy',company:plain(f.input.company),categoryId:f.input.categoryId,categoryPath:[...f.input.categoryPath],schemaSha256:projection.schemaSha256,sourceFingerprint:'b'.repeat(64),inputFingerprint:'c'.repeat(64),source,members:f.resolved.rows.map((row,documentIndex)=>({optionId:row.optionId,optionLabel:row.optionLabel,documentIndex}))};
 const legal=await module('app/native-legal-attachment-plan.ts').buildNativeLegalAttachmentPlan({identity,applicability:'not-applicable',context:{schemaSha256:identity.schemaSha256,categoryId:identity.categoryId,company:identity.company,targets:[],issues:[],files:[],registered:false,remoteWrites:false,submissionReady:false}});
 const assets=keys.map((key,index)=>({key,name:'test.png',data:imageBytes(index),sha256:sha(imageBytes(index))})),metadata=new Map(assets.map(asset=>[asset.key,{size:asset.data.length,httpMetadata:{contentType:'image/png'},customMetadata:{sha256:asset.sha256}}]));
 const plan=await module('app/native-asset-source-plan.ts').buildNativeAssetSourcePlan({identity,projection,ownedKeys:keys,assets,metadata,nativeLegalAttachmentPlan:legal});assert.equal(plan.metadataValid,true,JSON.stringify(plan.issues));assert.equal(plan.images.length,7);
 const byKey=new Map(plan.images.map(file=>[file.key,file]));for(const row of plan.body.jsonDocument){assert.equal(row.imagePage.images.mainImage,byKey.get(keys[0]).transportName);assert.equal(row.imagePage.images.additionalImage,keys.slice(1,3).map(key=>byKey.get(key).transportName).join(','));assert.equal(row.imagePage.details.detailedImage,keys.slice(3,6).map(key=>byKey.get(key).transportName).join(','));assert.equal(row.imagePage.images.labelImages[0].labelImageFiles,byKey.get(keys[6]).transportName);}
 const quotationView={categoryContext:{categoryId:identity.categoryId,categoryPath:identity.categoryPath,profileId:source.profileId},productVersion:source.productVersion,contentRevision:source.contentRevision,optionRevision:source.optionRevision,revision:source.quotationRevision,inputFingerprint:identity.inputFingerprint,resolved:f.resolved,imageKeys:keys};
 const review=await module('app/supplier-hub-native-product-document.ts').compileNativeSupplierHubProductDocument({productId:identity.productId,profileId:source.profileId,quotationView,sourcePlan:plan,ownerId:'owner'}),packet=await createProductDocumentPacket(plain(review)),validated=await validateProductDocumentPacket(packet);
 assert.equal(review.body.jsonDocument.length,2);assert.equal(review.originalBodySha256,plan.originalBodySha256);assert.equal(review.preparedBodySha256,plan.preparedBodySha256);assert.equal(JSON.stringify(f.input),before);assert.equal(plan.remoteWrites,false);assert.equal(review.remoteWrites,false);assert.equal(review.registered,false);
 for(const body of [plan.body,review.body,packet.review.body])for(const row of body.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])assert.equal(row.imagePage[key],originalAgreement);
 for(const row of validated.preparedBody.jsonDocument)for(const key of ['msrpAgree','labelContactAgreed'])assert.equal(row.imagePage[key],false);
 const canonical=module('app/supplier-hub-product-document.ts').productDocumentReviewCanonical;
 assert.equal(plan.originalBodySha256,sha(canonical(plan.body)));assert.equal(plan.preparedBodySha256,sha(canonical(validated.preparedBody)));
 assert.equal(plan.originalBodySha256===plan.preparedBodySha256,!originalAgreement);
 for(const value of [plan,review,validated,validated.binding]){assert.equal(value.remoteWrites,false);assert.equal(value.registered,false);assert.equal(value.submissionReady,false);}
 assert.equal(JSON.stringify(await projectSaved(f.input)),legacyBefore);assert.equal(JSON.stringify(f.input),before);
});
