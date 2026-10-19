const status=document.querySelector('#sales-status');
document.querySelector('#sales-start').addEventListener('click',async()=>{
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.url || new URL(tab.url).origin!=='https://www.coupang.com') {
      status.textContent='쿠팡에서 상품을 검색한 뒤 판매량 조회를 눌러주세요.';
      await chrome.tabs.create({url:'https://www.coupang.com/'});return;
    }
    const result=await chrome.tabs.sendMessage(tab.id,{type:'YF_SALES_UI_START'});
    if(!result?.ok) throw Error(result?.error || '쿠팡 검색 결과에서 실행해주세요.');
    window.close();
  } catch { status.textContent='쿠팡 검색·상품 화면을 새로고침한 뒤 다시 실행해주세요.'; }
});
document.querySelector('#sales-wing').addEventListener('click',async()=>{
  const tabs=await chrome.tabs.query({currentWindow:true,url:'https://wing.coupang.com/*'});
  if(tabs.length) await chrome.tabs.update(tabs[0].id,{active:true});
  else await chrome.tabs.create({url:'https://wing.coupang.com/tenants/rfm/coupang-trends/popularity-search'});
});
