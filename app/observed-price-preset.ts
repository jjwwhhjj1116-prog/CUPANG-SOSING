import type { WorkspaceSettings } from '@/app/workspace-settings';

// Account settings observed on 2026-09-24, not service-wide defaults or FX quotes.
export const observedCouplusPricePreset = Object.freeze({
  exchangeRate: 350, supplyMargin: 50, coupangMargin: 40,
  roundingUnit: 10, roundingMode: 'nearest' as const,
  msrpMultiple: 1.3, minimumMarginEnabled: true, minimumMargin: 3000,
});

/** Updates the settings editor draft only; all non-price inputs remain untouched. */
export function applyObservedPricePreset(draft: WorkspaceSettings): WorkspaceSettings {
  return { ...draft, ...observedCouplusPricePreset };
}
