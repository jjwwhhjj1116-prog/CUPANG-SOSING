export type GoogleTranslationBlock = {
  kind: 'block';
  text: string;
  entries: { id: string; original: string }[];
};
export type GoogleTranslationRequest = GoogleTranslationBlock | { kind: 'single'; text: string };

const MAX_CHARACTERS = 5000;
const marker = /^\[\[YFTR\d{6}\]\]$/u;
const ambiguousSource = /[\r\n\u2028\u2029]|\[\[|\]\]/u;

/** Long descriptions retain every source character. Prefer paragraph endings
 * and never divide a surrogate pair or CRLF at the request boundary. */
export function splitGoogleTranslationText(text: string): string[] {
  if (text.length <= MAX_CHARACTERS) return [text];
  const parts: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + MAX_CHARACTERS, text.length);
    if (end < text.length) {
      if (/[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end--;
      if (text[end - 1] === '\r' && text[end] === '\n') end--;
      for (let index = end - 1; index >= start + Math.floor(MAX_CHARACTERS / 2); index--) {
        if (/[\n\u2028\u2029]/u.test(text[index])) { end = index + 1; break; }
      }
    }
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}

/** Plain text only: IDs identify independent source strings, not instructions.
 * Keep ambiguous or large source text intact as an individual request. */
export function planGoogleTranslationRequests(texts: readonly string[]): GoogleTranslationRequest[] {
  const requests: GoogleTranslationRequest[] = [];
  let entries: GoogleTranslationBlock['entries'] = [], lines: string[] = [], characters = 0;
  const flush = () => {
    if (entries.length === 1) requests.push({ kind: 'single', text: entries[0].original });
    else if (entries.length) requests.push({ kind: 'block', text: lines.join('\n'), entries });
    entries = []; lines = []; characters = 0;
  };
  [...new Set(texts.filter(Boolean))].forEach((original, index) => {
    const id = `[[YFTR${String(index + 1).padStart(6, '0')}]]`, line = `${id} ${original}`;
    if (ambiguousSource.test(original) || line.length > MAX_CHARACTERS || !marker.test(id)) {
      flush(); requests.push({ kind: 'single', text: original }); return;
    }
    const added = line.length + (entries.length ? 1 : 0);
    if (characters + added > MAX_CHARACTERS) flush();
    characters += line.length + (entries.length ? 1 : 0);
    entries.push({ id, original }); lines.push(line);
  });
  flush();
  return requests;
}

/** Bind by exact ID, including reordered lines. A damaged block cannot supply
 * a positional translation or leak marker numbers into field evidence. */
export function parseGoogleTranslationBlock(text: string, block: GoogleTranslationBlock): Map<string, string> | null {
  const expected = new Map(block.entries.map(entry => [entry.id, entry.original]));
  if (!block.entries.length || expected.size !== block.entries.length
    || new Set(block.entries.map(entry => entry.original)).size !== block.entries.length
    || block.entries.some(entry => !marker.test(entry.id)) || !text.trim()) return null;
  const lines = text.trim().split(/\r\n|[\r\n\u2028\u2029]/u);
  if (lines.length !== expected.size) return null;
  const values = new Map<string, string>(), seen = new Set<string>();
  for (const line of lines) {
    const matched = /^(\[\[YFTR\d{6}\]\])[ \t]+(.+)$/u.exec(line.trim());
    if (!matched || !expected.has(matched[1]) || seen.has(matched[1])) return null;
    const value = matched[2].trim();
    if (!value || /\[\[|\]\]/u.test(value)) return null;
    seen.add(matched[1]); values.set(expected.get(matched[1])!, value);
  }
  return seen.size === expected.size ? values : null;
}
