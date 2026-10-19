document.querySelector('#open-workspace').addEventListener('click',async()=>{
 const tabs=await chrome.tabs.query({currentWindow:true,url:'https://sourceflow.jjwwhhjj1116.workers.dev/*'});
 if(tabs.length)await chrome.tabs.update(tabs[0].id,{active:true});
 else await chrome.tabs.create({url:'https://sourceflow.jjwwhhjj1116.workers.dev/'});
});
