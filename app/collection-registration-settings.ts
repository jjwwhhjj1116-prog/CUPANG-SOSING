import { savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';

/** Keep explicitly captured registration inputs with their product. Pricing and
 * workflow switches remain owned by their respective saved sources. Missing
 * legacy registration fields use the empty/default snapshot values, never
 * registration facts added to workspace settings after this product was created. */
export function collectionRegistrationSettings(current: WorkspaceSettings, captured: unknown): WorkspaceSettings {
  if (!captured || typeof captured !== 'object' || Array.isArray(captured)) return current;
  const stored = captured as Record<string, unknown>;
  const validated = savedRegistrationSettings(stored);
  const result = { ...current };
  for (const key of ['brand','manufacturer','importer','serviceContact','tradeType','importType','taxType','boxSkuQuantity'] as const) {
    Object.assign(result, { [key]: validated[key] });
  }
  return result;
}
