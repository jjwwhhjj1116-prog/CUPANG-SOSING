import type { SeoWorkspaceDraftMemo } from '@/app/seo-workspace-draft';

export type SeoGuidanceSession = Readonly<{ ownerId: string; productId: string; sourceKey: string; ownerEpoch: number; epoch: number }>;
type Entry = { sourceKey: string; values: Partial<SeoWorkspaceDraftMemo>; session?: SeoGuidanceSession };
let currentOwner: string | null = null, ownerEpoch = 0, sessionEpoch = 0;
const entries = new Map<string, Entry>();
const owner = (value: unknown) => typeof value === 'string' && Boolean(value.trim()) ? value : null;

/** Memory belongs to the current authenticated workspace. Closing a product
 * releases its ticket, while leaving that owner's finalized fields available. */
export function setSeoGuidanceSessionOwner(value?: string): void {
  const next = owner(value);
  if (next === currentOwner) return;
  currentOwner = next; ownerEpoch++; entries.clear();
}
export function seoGuidanceSessionSourceKey(supplierIdentity: string, defaults: SeoWorkspaceDraftMemo): string {
  return JSON.stringify([supplierIdentity, defaults.brand, defaults.features, defaults.keywords]);
}
export function openSeoGuidanceSession(ownerId: string | undefined, productId: string, sourceKey: string): SeoGuidanceSession | null {
  const scope = owner(ownerId);
  if (!scope || !productId || !sourceKey) return null;
  setSeoGuidanceSessionOwner(scope);
  const previous = entries.get(productId), entry: Entry = previous?.sourceKey === sourceKey ? previous : { sourceKey, values: {} };
  const session = Object.freeze({ ownerId: scope, productId, sourceKey, ownerEpoch, epoch: ++sessionEpoch });
  entry.session = session; entries.set(productId, entry); return session;
}
function current(session: SeoGuidanceSession | null): Entry | null {
  if (!session || session.ownerId !== currentOwner || session.ownerEpoch !== ownerEpoch) return null;
  const entry = entries.get(session.productId);
  return entry?.session === session && entry.sourceKey === session.sourceKey ? entry : null;
}
export function readSeoGuidanceSession(session: SeoGuidanceSession | null): Partial<SeoWorkspaceDraftMemo> | null {
  const entry = current(session); return entry ? { ...entry.values } : null;
}
export function commitSeoGuidanceSession(session: SeoGuidanceSession | null, key: keyof SeoWorkspaceDraftMemo, value: string): boolean {
  const entry = current(session);
  if (!entry) return false;
  if (!['brand', 'features', 'keywords'].includes(key) || typeof value !== 'string' || value.length > (key === 'brand' ? 100 : 2000)
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw Error('SEO 참고 입력의 길이와 문자를 확인해주세요. 입력 원문은 유지됩니다.');
  entry.values = { ...entry.values, [key]: value }; return true;
}
export function releaseSeoGuidanceSession(session: SeoGuidanceSession | null): void {
  const entry = current(session); if (entry) delete entry.session;
}
/** Vendor initialization prefers a nonempty default brand and its first comma
 * segment. Features and target preserve a finalized explicit blank. */
export function initialSeoGuidanceMemo(defaults: SeoWorkspaceDraftMemo, saved: Partial<SeoWorkspaceDraftMemo> | null): SeoWorkspaceDraftMemo {
  return { brand: (defaults.brand || saved?.brand || '').split(',')[0],
    features: saved && Object.hasOwn(saved, 'features') ? saved.features! : defaults.features,
    keywords: saved && Object.hasOwn(saved, 'keywords') ? saved.keywords! : defaults.keywords };
}
