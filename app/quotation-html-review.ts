/** Observed Supplier Hub bulk-upload restriction, 2026-09-24.
 * Static hints only: never fetch or execute HTML. This is not an HTML sanitizer.
 */
export function unsupportedQuotationMedia(html: string): string[] {
  const unsupported = new Set<string>();
  const tags = /<!--[\s\S]*?-->|<(\/?)([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (const tag of html.matchAll(tags)) {
    if (!tag[2] || tag[1]) continue;
    const name = tag[2].toLowerCase();
    if (name === 'video') unsupported.add('동영상');
    if (!['img', 'source', 'embed', 'object', 'video'].includes(name)) continue;
    const attributes = /(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    for (const attribute of tag[3].matchAll(attributes)) {
      if (!['src', 'data', 'type'].includes(attribute[1].toLowerCase())) continue;
      const value = (attribute[2] ?? attribute[3] ?? attribute[4]).trim();
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
