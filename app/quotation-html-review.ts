import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';

/** Observed Supplier Hub bulk-upload restriction, 2026-09-24.
 * Static hints only: never fetch or execute HTML. This is not an HTML sanitizer.
 */
export function unsupportedQuotationMedia(html: string): string[] {
  const unsupported = new Set<string>();
  const nodes: DefaultTreeAdapterMap['node'][] = [parseFragment(html)];
  while (nodes.length) {
    const node = nodes.pop()!;
    // Inert/raw-text content is not embedded media. parse5 also decodes
    // character references and resolves duplicate attributes like HTML does.
    if ('tagName' in node && ['script', 'style', 'template', 'noscript', 'textarea', 'title'].includes(node.tagName)) continue;
    if ('childNodes' in node) for (let i = node.childNodes.length - 1; i >= 0; i--) nodes.push(node.childNodes[i]);
    if (!('tagName' in node)) continue;
    const name = node.tagName;
    if (name === 'video') unsupported.add('동영상');
    if (!['img', 'source', 'embed', 'object', 'video'].includes(name)) continue;
    for (const attribute of node.attrs) {
      if (!['src', 'data', 'type'].includes(attribute.name)) continue;
      const value = attribute.value.trim();
      const mime = value.toLowerCase();
      if (/^(?:data:)?image\/gif(?:[;,]|$)/.test(mime)) unsupported.add('GIF');
      if (/^(?:data:)?application\/pdf(?:[;,]|$)/.test(mime)) unsupported.add('PDF');
      if (/^(?:data:)?(?:image\/(?:vnd\.adobe\.photoshop|psd))(?:[;,]|$)/.test(mime)) unsupported.add('PSD');
      if (/^(?:data:)?video\//.test(mime)) unsupported.add('동영상');
      let pathname = value.split(/[?#]/, 1)[0];
      try { pathname = decodeURIComponent(pathname); } catch { /* Unknown URL remains unverified. */ }
      const extension = pathname.match(/\.(gif|psd|pdf|mp4|webm|mov|avi|m4v|mpeg|mpg|ogv)$/i)?.[1].toLowerCase();
      if (extension) unsupported.add(['gif', 'psd', 'pdf'].includes(extension) ? extension.toUpperCase() : '동영상');
    }
  }
  return [...unsupported];
}
