/** Local stacks and the bundled official Gmarket font need no external service. */
export const freeImageFontFamilies = {
  sans: { label: '고딕', css: 'Arial, "Noto Sans KR", sans-serif' },
  serif: { label: '명조', css: 'Georgia, "Noto Serif KR", serif' },
  mono: { label: '고정폭', css: '"Courier New", monospace' },
  gmarket: { label: 'Gmarket Sans Medium', css: '"Gmarket Sans", sans-serif' },
} as const;

export type FreeImageTextStyle = {
  fontFamily?: keyof typeof freeImageFontFamilies;
  bold?: boolean;
  italic?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
};

/** An older draft without styles keeps the exact previous drawing defaults.
 * Only the fixed stacks above are accepted; arbitrary CSS is never rendered. */
export function resolveFreeImageTextStyle(style: FreeImageTextStyle) {
  const invalid = () => { throw Error('글꼴·굵기·기울임·정렬·행간을 확인해주세요.'); };
  if (!style || typeof style !== 'object' || Array.isArray(style)) return invalid();
  const family = style.fontFamily ?? 'sans', align = style.textAlign ?? 'left', lineHeight = style.lineHeight ?? 1.2;
  if (style.fontFamily !== undefined && (typeof style.fontFamily !== 'string' || !Object.hasOwn(freeImageFontFamilies, style.fontFamily))
    || style.bold !== undefined && typeof style.bold !== 'boolean'
    || style.italic !== undefined && typeof style.italic !== 'boolean'
    || style.textAlign !== undefined && !['left', 'center', 'right'].includes(style.textAlign)
    || style.lineHeight !== undefined && (typeof style.lineHeight !== 'number' || !Number.isFinite(style.lineHeight) || style.lineHeight < 0.8 || style.lineHeight > 3)) return invalid();
  return { fontFamily: freeImageFontFamilies[family].css, bold: style.bold ?? false, italic: style.italic ?? false, textAlign: align, lineHeight };
}

/** Wait for the selected bundled face before measuring/drawing. Falling back
 * silently would save different text geometry from the user's chosen font. */
export async function ensureFreeImageTextFont(style: ReturnType<typeof resolveFreeImageTextStyle>, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (style.fontFamily !== freeImageFontFamilies.gmarket.css) return;
  const fonts = document.fonts, sample = '가나다 ABC 123';
  if (!fonts?.load || !fonts?.check) throw Error('이 브라우저에서 선택한 글꼴의 로딩을 확인할 수 없습니다. 다른 글꼴을 선택해주세요.');
  const descriptor = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}20px "Gmarket Sans"`;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason ?? Error('이미지 작업을 취소했습니다.'));
    const timer = setTimeout(() => finish(Error('글꼴을 불러오는 시간이 초과됐습니다. 원본과 편집값은 유지합니다.')), 10000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => fonts.load(descriptor, sample)).then(faces => {
      if (finished) return;
      if (!faces.length || !fonts.check(descriptor, sample)) finish(Error('선택한 Gmarket Sans를 불러오지 못했습니다. 다른 글꼴로 대신 저장하지 않습니다.'));
      else finish();
    }).catch(() => finish(Error('선택한 글꼴을 불러오지 못했습니다. 원본과 편집값은 유지합니다.')));
  });
  signal.throwIfAborted();
}
