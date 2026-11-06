import test from 'node:test';
import assert from 'node:assert/strict';
import {extractRelatedKeywords,parseAutocomplete,collectSeoKeywords} from '../extensions/supplier-hub/seo-keywords-page.mjs';
const nodes=values=>values.map(innerText=>({innerText}));
test('both selectors preserve exact order, seed and >30 terms',()=>{
 const doc={querySelector:s=>s.startsWith('.search-')?{children:[{}, {children:nodes(['같음',' same ','같음'])}]}:{children:nodes(['heading','same',...Array.from({length:35},(_,i)=>'항목'+i)])}};
 const words=extractRelatedKeywords(doc,'씨앗');assert.deepEqual(words.slice(0,5),['씨앗','같음',' same ','same','항목0']);assert.equal(words.length,39);
});
test('JSONP is decoded inertly and only exact wrapper accepted',()=>{
 assert.deepEqual(parseAutocomplete('jQuery111104777436103598398_1683352433937([{"keyword":"양말"}])',true),['양말']);
 assert.throws(()=>parseAutocomplete('jQuery111104777436103598398_1683352433937([]);globalThis.pwned=true',true));
 assert.throws(()=>parseAutocomplete('{}'));assert.deepEqual(parseAutocomplete('[]'),[]);
});
test('empty primary never falls back; malformed primary does; six second spacing',async()=>{
 let now=0;const urls=[],pauses=[];
 const run=primary=>collectSeoKeywords({query:'양 말',fetcher:async url=>{urls.push(url);return {ok:true,text:async()=>url.includes('web-adapter')?primary:'jQuery111104777436103598398_1683352433937([{"keyword":"자동"}])'};},document:{querySelector:()=>null},now:()=>now,sleep:async ms=>{pauses.push(ms);now+=ms;},lastSearchAt:0});
 assert.deepEqual((await run('[]')).keywords,['양 말']);assert.equal(urls.length,1);assert.deepEqual(pauses,[6000]);
 urls.length=0;assert.deepEqual((await run('bad')).keywords,['양 말','자동']);assert.equal(urls.length,2);assert.match(urls[0],/keyword=%EC%96%91%20%EB%A7%90/);
});
