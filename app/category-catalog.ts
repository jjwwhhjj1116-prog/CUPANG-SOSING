import type { CategoryProfile, CategoryProfileInput } from './category-profiles';
import observation from '../docs/couplus-category-dom-2026-09-22.json';
import hubObservation from '../docs/supplier-hub-category-ids-2026-09-22.json';

export type CategoryChoice = {
  key: string; categoryId: string; path: string[]; profileId?: string; profileName?: string;
  evidence: 'observed' | 'saved'; isLeaf: boolean; childrenObserved: boolean; templateLinked: boolean;
  codeEvidence: 'supplier-hub' | 'couplus' | 'saved' | 'unconfirmed'; codeObservedAt: string | null;
};
export type CategoryAdvancedSeed = { categoryPath: string[]; categoryId: string; profileId?: string };
const pathKey = (path: readonly string[]) => JSON.stringify(path);
const samePath = (left: readonly string[], right: readonly string[]) => pathKey(left) === pathKey(right);
// This leaf and ID were read from the user's Couplus quotation screen. Other
// leaves must come from an observed catalog or the owner's saved profiles.
const knownCodes: { categoryId: string; path: string[]; observedAt: string; codeEvidence?: 'supplier-hub' | 'couplus' }[] = [
  { categoryId: '81452', path: ['스포츠/레져', '헬스/요가', '헬스기구/용품', '헬스보호대'], observedAt: '2026-09-24', codeEvidence: 'supplier-hub' },
  { categoryId: '80719', path: ['주방용품', '주방수납/정리', '주방수납바구니/바스켓'], observedAt: observation.observedAt },
  // Full breadcrumb and code observed in saved Couplus quotation; siblings are not fully observed.
  { categoryId: '77442', path: ['완구/취미', '보드게임', '바둑/체스/윷놀이', '바둑', '바둑알+바둑판'], observedAt: '2026-09-23' },
];
const observedLeafPaths = new Set(observation.nodes.flatMap(node => node.children.filter(child => child.isLeaf).map(child => pathKey([...node.path, child.label]))));
// Only connect a code to a leaf whose entire path was independently observed.
// Conflicting evidence for a path is excluded, rather than taking the last ID.
function hubCodes() {
  const byPath = new Map<string, { categoryId: string; observedAt: string }>();
  const conflicts = new Set<string>();
  for (const record of hubObservation.categoryIds) {
    const key = pathKey(record.path);
    if (!observedLeafPaths.has(key) || !/^[1-9]\d{0,19}$/.test(record.categoryId)) continue;
    if (byPath.has(key) && byPath.get(key)?.categoryId !== record.categoryId) conflicts.add(key);
    byPath.set(key, { categoryId: record.categoryId, observedAt: record.observedAt });
  }
  for (const key of conflicts) byPath.delete(key);
  return byPath;
}
const confirmedHubCodes = hubCodes();
function observedChoices(): CategoryChoice[] {
  const branches = new Set(observation.nodes.map(node => pathKey(node.path)));
  const items = new Map<string, CategoryChoice>();
  const add = (path: string[], isLeaf: boolean) => {
    const hubCode = isLeaf ? confirmedHubCodes.get(pathKey(path)) : undefined;
    const couplusCode = isLeaf ? knownCodes.find(record => samePath(path, record.path)) : undefined;
    const id = hubCode?.categoryId ?? (couplusCode?.categoryId ?? '');
    items.set(pathKey(path), { key: id ? `observed:${id}` : `observed-path:${pathKey(path)}`, categoryId: id, path,
      evidence: 'observed', isLeaf, childrenObserved: branches.has(pathKey(path)), templateLinked: false,
      codeEvidence: hubCode ? 'supplier-hub' : couplusCode ? couplusCode.codeEvidence ?? 'couplus' : 'unconfirmed', codeObservedAt: hubCode?.observedAt ?? (couplusCode?.observedAt ?? null) });
  };
  for (const root of observation.rootLabels) add([root], false);
  for (const node of observation.nodes) for (const child of node.children) add([...node.path, child.label], child.isLeaf);
  for (const record of knownCodes) {
    for (let depth = 1; depth <= record.path.length; depth++) {
      const path = record.path.slice(0, depth);
      if (!items.has(pathKey(path))) add(path, depth === record.path.length);
    }
  }
  return [...items.values()];
}
export const observedCategories: CategoryChoice[] = observedChoices();
export const categoryObservationScope = {
  observedAt: observation.observedAt, roots: observation.rootLabels.length,
  rootsWithSecondLevel: observation.nodes.filter(node => node.path.length === 1).length,
  secondLevel: observation.nodes.filter(node => node.path.length === 1).reduce((sum, node) => sum + node.children.length, 0),
  completeSubtree: '주방용품 > 주방수납/정리', completeSubtreeLeaves: observedCategories.filter(choice => choice.isLeaf && choice.path[0] === '주방용품' && choice.path[1] === '주방수납/정리').length,
  knownCodes: observedCategories.filter(choice => choice.isLeaf && choice.categoryId).length,
  supplierHubCodes: observedCategories.filter(choice => choice.codeEvidence === 'supplier-hub').length,
  supplierHubObservedDate: hubObservation.observedDate,
  fullCatalogVerified: false, supplierHubMappingVerified: false,
} as const;
export function categoryChoices(profiles: CategoryProfile[]): CategoryChoice[] {
  const saved: CategoryChoice[] = profiles.map(profile => {
    const matched = observedCategories.find(choice => samePath(choice.path, profile.categoryPath) && choice.categoryId === profile.categoryId);
    return { key: profile.id, categoryId: profile.categoryId, path: [...profile.categoryPath], profileId: profile.id, profileName: profile.name,
      evidence: 'saved', isLeaf: true, childrenObserved: false, templateLinked: Boolean(profile.template?.storageKey),
      codeEvidence: matched?.codeEvidence ?? (profile.categoryId.trim() ? 'saved' : 'unconfirmed'), codeObservedAt: matched?.codeObservedAt ?? null };
  });
  // Keep distinct IDs/profiles at the same path. A saved profile never changes
  // the code of another observed path, including leaves with the same label.
  return [...saved, ...observedCategories.filter(choice => !saved.some(profile => samePath(profile.path, choice.path)
    && (profile.categoryId === choice.categoryId || (!choice.categoryId && choice.isLeaf && profile.categoryId.trim()))))];
}
export function canConfirmCategory(choice: CategoryChoice | undefined): boolean { return Boolean(choice?.isLeaf && choice.categoryId.trim()); }
export function categoryProfileForChoice(choice: CategoryChoice): CategoryProfileInput {
  if (!canConfirmCategory(choice)) throw new Error('분류 코드가 확인되지 않았습니다. 실제 코드와 견적서 양식을 먼저 연결해주세요.');
  return { name: choice.path.at(-1) ?? choice.categoryId, categoryId: choice.categoryId, categoryPath: [...choice.path], template: null, mappings: [] };
}
export function categoryLevel(choices: CategoryChoice[], path: readonly string[], depth: number): string[] {
  if (!Number.isInteger(depth) || depth < 0 || depth > path.length) return [];
  const names = choices.filter(choice => path.slice(0, depth).every((part, index) => choice.path[index] === part)).map(choice => choice.path[depth]).filter(Boolean);
  const observedOrder = observedCategories.filter(choice => choice.path.length === depth + 1 && path.slice(0, depth).every((part, index) => choice.path[index] === part)).map(choice => choice.path[depth]);
  return [...new Set([...observedOrder.filter(name => names.includes(name)), ...names])];
}
export function categoryChoicesAtPath(choices: CategoryChoice[], path: readonly string[]) { return choices.filter(choice => samePath(choice.path, path)); }
export function searchCategoryChoices(choices: CategoryChoice[], query: string) {
  const terms = query.trim().toLocaleLowerCase('ko-KR').split(/\s+/).filter(Boolean);
  return choices.filter(choice => { const text = `${choice.path.join(' ')} ${choice.categoryId} ${choice.profileName ?? ''}`.toLocaleLowerCase('ko-KR'); return terms.every(term => text.includes(term)); });
}
export function categoryAdvancedSeed(choice: CategoryChoice | undefined, path: readonly string[] = []): CategoryAdvancedSeed {
  return { categoryPath: [...(choice?.path ?? path)], categoryId: choice?.categoryId ?? '', ...(choice?.profileId ? { profileId: choice.profileId } : {}) };
}
