import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as parse5 from 'parse5';
import {readSeoKeywordsInPage} from '../extensions/supplier-hub/seo-keywords-page.mjs';
test('actual Chrome executeScript function survives toString serialization in isolated inert browser globals',async()=>{
 const query='양 말&기호',requests=[],html=parse5.parse('<script>throw new Error("never execute seller HTML")</script><div class="search-related-keyword"><h3>heading</h3><ul><a>연관 하나</a><a> 같이 </a></ul></div><div class="srp_relatedKeywords__DJiuK"><span>heading</span><a>연관 둘</a><a>연관 하나</a></div>');
 const text=node=>node.nodeName==='#text'?node.value:(node.childNodes??[]).map(text).join(''),find=(node,name)=>node.attrs?.some(attr=>attr.name==='class'&&attr.value.split(' ').includes(name))?node:(node.childNodes??[]).map(child=>find(child,name)).find(Boolean),element=node=>({innerText:text(node),children:(node.childNodes??[]).filter(child=>child.tagName).map(element)}),document={querySelector:selector=>{const node=find(html,selector.slice(1));return node?element(node):null;}};
 const isolated={location:{origin:'https://www.coupang.com',pathname:'/np/search',href:'https://www.coupang.com/np/search?q='+encodeURIComponent(query)},document,URL,AbortController,setTimeout,clearTimeout,fetch:async(path,init)=>{requests.push(path);assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');return {ok:true,text:async()=>JSON.stringify([{keyword:'자동완성'}])};}};
 const injected=vm.runInNewContext('('+readSeoKeywordsInPage.toString()+')',isolated),result=await injected(query);assert.deepEqual(Array.from(result.keywords),[query,'연관 하나',' 같이 ','연관 둘','자동완성']);assert.equal(requests.length,1);assert.match(requests[0],/keyword=%EC%96%91%20%EB%A7%90%26%EA%B8%B0%ED%98%B8/);assert.equal(result.rawHtml,undefined);
 await assert.rejects(injected('foreign query'),/query mismatch/);
});
