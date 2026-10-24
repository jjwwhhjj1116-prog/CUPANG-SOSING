import {parseFragment,type DefaultTreeAdapterMap} from 'parse5';
import type {projectSupplierHubSingleDocument} from '@/app/supplier-hub-single-projection';
import type {SubmissionIssue} from '@/app/submission-review';

type Projection=Awaited<ReturnType<typeof projectSupplierHubSingleDocument>>;
const detailPath=['imagePage','details','detailedImage'];
const htmlPath=['imagePage','details','htmlProductDetailContent'];
const samePath=(left:readonly string[],right:readonly string[])=>JSON.stringify(left)===JSON.stringify(right);

/** Content presence only. HTML remains inert and existing transport/media
 * validation still applies. A logo/banner image alone is never a product body. */
function hasHtmlBody(html:string){
 if(!html.trim()||html.length>150000)return false;
 const nodes:DefaultTreeAdapterMap['node'][]=[parseFragment(html)];let count=0,element=false,text=false;
 while(nodes.length){
  const node=nodes.pop()!;if(++count>20000)return false;
  if('tagName'in node){
   if(['script','style','template','noscript','textarea','title','iframe','object','embed','svg','math'].includes(node.tagName))return false;
   if(node.attrs.some(attr=>attr.name.startsWith('on')||attr.name==='hidden'||/^(?:javascript|vbscript):/iu.test(attr.value.trim())))return false;
   if(node.attrs.some(attr=>attr.name==='style'&&/(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attr.value)))continue;
   if(node.tagName!=='img'&&node.tagName!=='br')element=true;
  }
  if('nodeName'in node&&node.nodeName==='#text'&&'value'in node&&String(node.value).replace(/[\s\u200b-\u200f\ufeff]/gu,'').length)text=true;
  if('childNodes'in node)nodes.push(...node.childNodes);
 }
 return element&&text;
}

/** Inspect the exact final native targets, including per-option overrides.
 * Candidate images, excluded options and canonical shadow cells cannot qualify. */
export function quotationDetailBodyIssues(projection:Projection,protectedKeys:readonly string[]):SubmissionIssue[]{
 const protectedImages=new Set(protectedKeys),issues:SubmissionIssue[]=[],members=projection.review.fields.filter(field=>field.name===undefined&&samePath(field.path,['startPage','productName']));
 for(const [documentIndex,document]of projection.payload.jsonDocument.entries()){
  const member=members[documentIndex];
  if(!member)continue;
  const references=projection.review.unresolvedImages.filter(reference=>reference.optionId===member.optionId&&reference.wire?.name===undefined&&reference.wire&&samePath(reference.wire.path,detailPath));
  const bodyImage=references.some(reference=>reference.keys.some(key=>!protectedImages.has(key)));
  const html=projection.review.fields.find(field=>field.optionId===member.optionId&&field.name===undefined&&samePath(field.path,htmlPath));
  const page=document.imagePage as {details?:{htmlProductDetailContent?:unknown}}|undefined;
  const value=page?.details?.htmlProductDetailContent;
  const invalid=html&&projection.review.issues.some(issue=>issue.level==='error'&&issue.optionId===member.optionId&&issue.fieldId===html.fieldId);
  if(bodyImage||html&&!invalid&&typeof value==='string'&&hasHtmlBody(value))continue;
  issues.push({kind:'error',code:'DETAIL_BODY_MISSING',optionId:member.optionId,optionLabel:member.savedValue,fieldId:references[0]?.fieldId??html?.fieldId??null,
   message:'상품 상세 본문 이미지 또는 직접 작성한 상세 HTML을 확인해주세요. 상단·하단 설정 이미지만으로는 전송할 수 없습니다.'});
 }
 return issues;
}
