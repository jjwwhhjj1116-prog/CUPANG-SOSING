export function workspaceEditState(root: Pick<ParentNode, 'querySelector'> | null, ignoreFreeImageEditor = false, ignoreSeoGenerationInput = false) {
  const otherEditors = (ignoreFreeImageEditor ? ':not([data-free-image-editor])' : '')
    + (ignoreSeoGenerationInput ? ':not([data-seo-generation-input])' : '');
  return {
    busy: !!root?.querySelector(`[data-workspace-saving="true"]${otherEditors}`),
    dirty: !!root?.querySelector(`[data-workspace-dirty="true"]${otherEditors}`),
  };
}

export type WorkspaceSourceWrite = 'additional-upload' | 'detail-upload' | 'size-chart';
/** A source operation may consume its own draft, while every other mounted
 * editor, including hidden stages and nested document tools, remains guarded. */
export function workspaceSourceWriteState(root: Pick<ParentNode, 'querySelector'> | null, source: WorkspaceSourceWrite) {
  const exclusions: Record<WorkspaceSourceWrite, string> = {
    'additional-upload': ':not([data-image-upload-queue="additional"])',
    'detail-upload': ':not([data-image-upload-queue="detail"])',
    'size-chart': ':not([data-size-chart-workspace])',
  };
  const exclude = Object.hasOwn(exclusions, source) ? exclusions[source] : null;
  if (!root || !exclude) return { busy: true, dirty: true };
  return {
    busy: !!root.querySelector(`[data-workspace-saving="true"]${exclude}`),
    dirty: !!root.querySelector(`[data-workspace-dirty="true"]${exclude}`),
  };
}

export function requestWorkspaceClose(root: Pick<ParentNode, 'querySelector'> | null, confirmDiscard: () => boolean): 'close' | 'busy' | 'cancel' {
  const state = workspaceEditState(root);
  if (state.busy) return 'busy';
  if (state.dirty && !confirmDiscard()) return 'cancel';
  return 'close';
}

/** Read retained drafts, including hidden stages, before showing saved quotation values. */
export function quotationSourceState(root: (Pick<ParentNode, 'querySelector' | 'querySelectorAll'>) | null) {
  const steps: string[] = [];
  for (const element of Array.from(root?.querySelectorAll('[data-quotation-source-step]') ?? [])) {
    const step = element.getAttribute('data-quotation-source-step');
    if (step && (element.getAttribute('data-workspace-dirty') === 'true' || element.querySelector('[data-workspace-dirty="true"]')) && !steps.includes(step)) steps.push(step);
  }
  return { busy: workspaceEditState(root).busy, steps };
}
