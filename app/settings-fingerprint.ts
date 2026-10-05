import type { WorkspaceSettings } from '@/app/workspace-settings';

const bundleCriteria = ['bundleCriterion', 'bundleMinimumSupplyMargin', 'bundleMinimumCoupangMargin'] as const;

/** Bundle recommendations affect saved products only after unitsPerPack changes.
 * Adding their normalized defaults must not rename an existing quotation or
 * invalidate a saved workflow. Raw settings payloads and captured intake
 * snapshots remain separate source guards and are deliberately not filtered. */
export function savedProductFingerprintSettings(settings: WorkspaceSettings) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => !bundleCriteria.some(field => field === key))) as Omit<WorkspaceSettings, typeof bundleCriteria[number]>;
}
