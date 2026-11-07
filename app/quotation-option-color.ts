import { seoCurrentLiterals } from '@/app/seo-current-literals';

const { Ke: translatedColors, oe: standardColors } = seoCurrentLiterals.modules['7d6a'];
const sourceColors = new Map([
  ...Object.entries(translatedColors).map(([name, color]) => [name + '色', color] as const),
  ['纯白', '화이트'], ['純白', '화이트'], ['玫瑰金色', '로즈골드'], ['玫瑰金', '로즈골드'],
]);
const colorAliases = new Map([
  ...Object.values(translatedColors).map(color => [color, color] as const),
  ...standardColors.flatMap(({ words }) => words.map(word => [word, words[0]] as const)),
  ['순백색', '화이트'], ['백색', '화이트'], ['하얀색', '화이트'], ['검은색', '블랙'],
]);
const alternatives = (names: Iterable<string>) => [...names].sort((a, b) => b.length - a.length)
  .map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
const chineseColor = new RegExp(alternatives(sourceColors.keys()), 'gu');
const koreanColor = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${alternatives(colorAliases.keys())})(?![\\p{L}\\p{N}])`, 'gu',
);
// These ordinary product words need source-color evidence in a combined name.
const ambiguousColorWords = new Set(['커피', '살구', '카멜', '카라멜', '와인', '민트', '오렌지']);
const mixedColor = /混色|多色|拼色|随机色|隨機色|撞色|双色|雙色|兩色|两色|혼합\s*색|다색|멀티\s*컬러|랜덤\s*(?:색|컬러)|색상\s*랜덤|투톤/u;

export function quotationOptionNameColor(originalName: string, translatedName: string, choices?: readonly { label: string; value: string }[]) {
  const original = originalName.normalize('NFKC');
  const translated = translatedName.normalize('NFKC');
  if (mixedColor.test(original) || mixedColor.test(translated)) return;
  const source = [...original.matchAll(chineseColor)].map(([word]) => sourceColors.get(word)!);
  const korean = [...`${original} / ${translated}`.matchAll(koreanColor)]
    .map(([word]) => colorAliases.get(word)!);
  const colors = new Set([...source, ...korean]);
  if (colors.size !== 1) return;
  const [color] = colors;
  if (!source.length && ambiguousColorWords.has(color)) return;
  if (!choices) return color;
  const matching = new Set(choices.filter(({ label, value }) =>
    [label, value].some(word => colorAliases.get(word.trim().normalize('NFKC')) === color)).map(({ value }) => value));
  if (matching.size === 1) return [...matching][0];
}
