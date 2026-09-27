import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

/** Parse supplier markup as inert data. No browser, scripts, styles or remote
 * resources run. Only plain text and explicit image sources leave this module. */
export function parseAlibabaDescription(input: unknown): {text: string; images: string[]} {
  if (input == null || input === '') return {text: '', images: []};
  if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > 2 * 1024 * 1024) throw Error('상품 상세 설명은 2MB 이하의 HTML이어야 합니다.');
  const root = parseFragment(input);
  const skipped = new Set(['script','style','template','iframe','object','embed','noscript','svg','math']);
  const blocks = new Set(['p','div','br','li','tr','section','h1','h2','h3','h4','ul','ol','table']);
  const images: string[] = [], parts: string[] = [];
  const stack: (DefaultTreeAdapterMap['node'] | string)[] = [root];
  let count = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (++count > 100000) throw Error('상품 상세 설명의 항목이 너무 많습니다.');
    if (typeof node === 'string') { parts.push(node); continue; }
    if (node.nodeName === '#text' && 'value' in node) { parts.push(node.value); continue; }
    if ('tagName' in node) {
      if (skipped.has(node.tagName)) continue;
      if (node.tagName === 'img') {
        const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
        const source = attrs['data-src'] || attrs.src;
        if (!source) throw Error('상세 이미지 주소를 확인하지 못했습니다.');
        const url = new URL(source.startsWith('//') ? `https:${source}` : source);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !(url.hostname === 'alicdn.com' || url.hostname.endsWith('.alicdn.com'))) throw Error('상세 이미지는 HTTPS Alibaba CDN 주소만 허용합니다.');
        if (!images.includes(url.href)) images.push(url.href);
        if (images.length > 200) throw Error('상세 이미지 수가 수집 한도를 초과했습니다.');
      }
      if (blocks.has(node.tagName)) { parts.push('\n'); stack.push('\n'); }
      if (node.tagName === 'td' || node.tagName === 'th') stack.push(' ');
    }
    if ('childNodes' in node) for (let i=node.childNodes.length-1;i>=0;i--) stack.push(node.childNodes[i]);
  }
  const text = parts.join('').replace(/[\t\r ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if (text.length > 20000) throw Error('상품 상세 텍스트가 20,000자를 초과했습니다.');
  return {text, images};
}
