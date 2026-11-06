export const SEO_KEYWORD_CAPABILITY='couplus-consumer-keywords-v1';
export function extractRelatedKeywords(document,seed){
 const first=document.querySelector('.search-related-keyword'),second=document.querySelector('.srp_relatedKeywords__DJiuK');
 const values=[seed,...Array.from(first?.children?.[1]?.children??[],node=>node.innerText),...Array.from(second?.children??[]).slice(1).map(node=>node.innerText)];
 return [...new Set(values.filter(value=>typeof value==='string'&&value.trim()))];
}
export function parseAutocomplete(text,jsonp=false){
 if(jsonp){const match=/^\s*jQuery111104777436103598398_1683352433937\((\[[\s\S]*\])\);?\s*$/.exec(text);if(!match)throw Error('invalid JSONP');text=match[1];}
 const rows=JSON.parse(text);if(!Array.isArray(rows)||rows.some(row=>!row||typeof row.keyword!=='string'))throw Error('invalid autocomplete');
 return rows.map(row=>row.keyword);
}
export async function collectSeoKeywords({query,fetcher=fetch,document=globalThis.document,signal,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),lastSearchAt=0}){
 const wait=Math.max(0,6000-(now()-lastSearchAt));if(wait)await sleep(wait);if(signal?.aborted)throw Error('cancelled');
 const keywords=extractRelatedKeywords(document,query),warnings=[];
 const read=async path=>{if(signal?.aborted)throw Error('cancelled');const response=await fetcher('https://www.coupang.com'+path,{signal,credentials:'include',redirect:'error',cache:'no-store'});if(!response.ok)throw Error('unavailable');const text=await response.text();if(text.length>2*1024*1024)throw Error('oversize');return text;};
 try{let values;try{values=parseAutocomplete(await read('/n-api/web-adapter/search?keyword='+encodeURIComponent(query)+'&_=1747668595224'));}catch{if(signal?.aborted)throw Error('cancelled');values=parseAutocomplete(await read('/np/search/autoComplete?callback=jQuery111104777436103598398_1683352433937&keyword='+encodeURIComponent(query)+'&_=1683352433940'),true);}keywords.push(...values);}catch{warnings.push('자동완성 조회에 실패하여 확인된 연관어만 사용합니다.');}
 if(signal?.aborted)throw Error('cancelled');return {keywords:[...new Set(keywords.filter(value=>typeof value==='string'&&value.trim()))],warnings};
}
// Kept self-contained because Chrome serializes this function into the owned tab.
export async function readSeoKeywordsInPage(query){
 if(location.origin!=='https://www.coupang.com'||location.pathname!=='/np/search'||new URL(location.href).searchParams.get('q')!==query)throw Error('query mismatch');
 const first=document.querySelector('.search-related-keyword'),second=document.querySelector('.srp_relatedKeywords__DJiuK');
 const words=[query,...Array.from(first?.children?.[1]?.children??[],node=>node.innerText),...Array.from(second?.children??[]).slice(1).map(node=>node.innerText)],warnings=[];
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 const read=async path=>{const response=await fetch(path,{signal:controller.signal,credentials:'same-origin',redirect:'error',cache:'no-store'});if(!response.ok)throw Error('unavailable');const text=await response.text();if(text.length>2*1024*1024)throw Error('oversize');return text;};
 const decode=(text,jsonp=false)=>{if(jsonp){const m=/^\s*jQuery111104777436103598398_1683352433937\((\[[\s\S]*\])\);?\s*$/.exec(text);if(!m)throw Error('JSONP');text=m[1];}const rows=JSON.parse(text);if(!Array.isArray(rows)||rows.some(row=>!row||typeof row.keyword!=='string'))throw Error('shape');return rows.map(row=>row.keyword);};
 try{let auto;try{auto=decode(await read('/n-api/web-adapter/search?keyword='+encodeURIComponent(query)+'&_=1747668595224'));}catch{auto=decode(await read('/np/search/autoComplete?callback=jQuery111104777436103598398_1683352433937&keyword='+encodeURIComponent(query)+'&_=1683352433940'),true);}words.push(...auto);}catch{warnings.push('자동완성 조회에 실패하여 확인된 연관어만 사용합니다.');}finally{clearTimeout(timer);}
 const keywords=[...new Set(words.filter(word=>typeof word==='string'&&word.trim()))];
 if(keywords.length>1000||keywords.some(word=>word.length>200)||JSON.stringify(keywords).length>64000)throw Error('keyword bounds');
 return {keywords,warnings};
}
