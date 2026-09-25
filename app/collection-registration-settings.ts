import { savedRegistrationSettings, type WorkspaceSettings } from '@/app/workspace-settings';

/** Keep explicitly captured registration inputs with their product. Pricing and
 * workflow switches remain owned by their respective saved sources. */
export function collectionRegistrationSettings(current: WorkspaceSettings, captured: unknown): WorkspaceSettings {
  if (!captured || typeof captured !== 'object' || Array.isArray(captured)) return current;
  const stored = captured as Record<string, unknown>;
  const validated = savedRegistrationSettings(stored);
  const result = { ...current };
  for (const key of ['brand','manufacturer','importer','serviceContact','tradeType','importType','taxType','boxSkuQuantity'] as const) {
    if (Object.hasOwn(stored, key)) Object.assign(result, { [key]: validated[key] });
  }
  return result;
}
