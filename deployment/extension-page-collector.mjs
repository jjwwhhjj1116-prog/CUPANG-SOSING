import {extractPageSource,pageSourceUrl,readPageSourceDomOptions,readPageSourceElementImage} from '../extensions/supplier-hub/page-source.mjs';
// Only an actual click in the top-level product document starts a capture.
// No background source request or page/global code execution is used.
if(window===window.top&&!document.getElementById('yoofam-page-collector')){
 try{pageSourceUrl(location.href);}catch{throw Error('Not a product document');}
 const host=document.createElement('div');host.id='yoofam-page-collector';host.style.cssText='position:fixed;right:22px;bottom:86px;z-index:2147483646;';
 const root=host.attachShadow({mode:'closed'}),style=document.createElement('style');style.textContent='button{border:0;border-radius:12px;background:#2563eb;color:white;padding:14px 20px;font:600 14px system-ui;cursor:pointer;box-shadow:0 4px 16px #0003}button:disabled{opacity:.65;cursor:wait}p{background:white;color:#172554;border:1px solid #cbd5e1;padding:10px;border-radius:8px;max-width:300px;font:13px/1.5 system-ui}';
 const button=document.createElement('button'),status=document.createElement('p');button.type='button';button.textContent='YOOFAM 스튜디오 상품 수집';status.setAttribute('role','status');status.hidden=true;root.append(style,button,status);document.documentElement.append(host);
 let pending=false,retrySnapshot=null;
 button.addEventListener('click',async event=>{
  if(!event.isTrusted||pending)return;pending=true;button.disabled=true;button.textContent=retrySnapshot?'앱 전송 중…':'수집 중…';status.hidden=false;status.textContent=retrySnapshot?'처음 보관한 원문을 앱에 다시 전달합니다.':'현재 페이지의 상품정보를 확인합니다.';
  try{
   const before=pageSourceUrl(location.href).sourceUrl;
   if(retrySnapshot&&retrySnapshot.sourceUrl!==before){retrySnapshot=null;throw Error('상품 페이지가 변경되었습니다. 이전 보관본은 확장에 유지됩니다. 현재 상품은 아직 수집하지 않았습니다. 상품 수집 버튼을 다시 눌러주세요.');}
   let snapshot=retrySnapshot;
   if(!snapshot){
    const text=selector=>document.querySelector(selector)?.textContent?.trim()??'';
    const urls=selector=>[...document.querySelectorAll(selector)].slice(0,200).map(node=>readPageSourceElementImage(node,{preferDataSource:true})).filter(Boolean);
    const scripts=[];let size=0;for(const script of document.scripts){const raw=script.textContent??'';if(!/"(?:skuModel|subject|offerTitle|offerSubject|productTitle|productName|offerBaseInfo|tempModel|offerImgList|mainImageList|propsList)"\s*:/.test(raw))continue;size+=raw.length;if(size>4*1024*1024)throw Error('상품 데이터가 수집 크기를 초과했습니다.');scripts.push(raw);}
    const productTitle=text('h1.d-title,.detail-title h1,.offer-title,[data-module-name="title"] h1,[data-plg-name="title"] h1');
    snapshot=extractPageSource({sourceUrl:before,scripts,domOptions:readPageSourceDomOptions(document,before,scripts),title:productTitle||document.querySelector('meta[property="og:title"]')?.content||document.title,
     description:text('#desc-lazyload-container')||text('.offer-description'),
     gallery:urls('.detail-gallery img,.gallery img,[class*="gallery"] img'),detailImages:urls('#desc-lazyload-container img,.offer-description img'),
     priceText:text('.price-container')||text('[class*="price-module"]')||text('[class*="price-component"]'),
     minimumOrderText:text('.price-container')||text('[class*="price-module"]')||text('[class*="price-component"]')});
   }
   if(pageSourceUrl(location.href).sourceUrl!==before)throw Error('상품 페이지가 변경되었습니다. 다시 수집해주세요.');
   const result=await chrome.runtime.sendMessage({type:'YOOFAM_SAVE_PAGE_SOURCE',snapshot});
   if(result?.ok!==true)throw Error(result?.error||'수집 결과를 확인하지 못했습니다. 다시 누르면 저장 결과를 확인합니다.');
   const deliveryMessage=typeof result.message==='string'&&result.message.trim()?result.message:'앱의 저장 확인 응답을 받지 못했습니다.';
   if(pageSourceUrl(location.href).sourceUrl!==before){
    retrySnapshot=null;const previous=result.delivered===true?'이전 상품은 앱 수집함에 저장되었습니다.':result.delivered===false?'이전 상품은 확장에 보관했습니다. '+deliveryMessage:'이전 상품의 앱 저장 결과를 확인하지 못했습니다.';
    throw Error(previous+' 상품 페이지가 변경되어 현재 상품은 아직 수집하지 않았습니다. 상품 수집 버튼을 다시 눌러주세요.');
   }
   if(result.delivered===true){
    retrySnapshot=null;status.textContent=result.duplicate===true?'이미 수집함에 담긴 상품입니다. 처음 저장한 원문과 검토 내용을 유지했습니다.':'YOOFAM 스튜디오 AI상품등록 목록에 담았습니다. 앱에서 카테고리를 선택하고 초안을 작성하세요.';button.textContent='수집 완료';
   }else if(result.delivered===false){
    // Keep the first click's payload even if the visible page data changes.
    retrySnapshot=snapshot;status.textContent='확장에 보관했습니다. 앱 수집함의 저장을 확인하지 못했습니다. '+deliveryMessage+' 같은 창의 YOOFAM 앱에서 상태를 확인한 뒤 이 버튼으로 다시 시도하거나 수집함에서 불러오세요.';button.textContent='앱 전송 다시 시도';
   }else throw Error('앱 수집함의 저장 결과를 확인하지 못했습니다. 다시 누르면 저장 결과를 확인합니다.');
  }catch(error){status.textContent=error?.message||'상품 수집 실패';button.textContent=retrySnapshot?'앱 전송 다시 시도':'YOOFAM 스튜디오 상품 수집';}
  finally{pending=false;button.disabled=false;}
 });
}
