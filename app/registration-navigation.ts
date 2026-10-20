import type { RegistrationLayout } from '@/app/registration-layout';

/** Unclassified and size-optional categories retain the seven-step wizard. */
export const registrationSteps: readonly string[] = ['SEO','가격','대표 이미지','추가 이미지','상세 이미지','표시사항','견적서'];
export const allRegistrationSteps: readonly string[] = ['SEO','가격','대표 이미지','추가 이미지','상세 이미지','사이즈표','표시사항','견적서'];
export type CollectionEditorTab = 'SEO'|'가격'|'대표 이미지'|'추가 이미지'|'상세 이미지'|'사이즈표'|'표시사항'|'견적서'|'옵션';
export function registrationStepsForLayout(layout: RegistrationLayout | null): readonly string[] {
  return layout?.sizeChartRequired === true ? allRegistrationSteps : registrationSteps;
}
export function initialRegistrationStep(tab: string, steps: readonly string[] = allRegistrationSteps): string {
  return steps.includes(tab) ? tab : 'SEO';
}
