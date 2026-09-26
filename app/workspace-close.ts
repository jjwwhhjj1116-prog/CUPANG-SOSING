export function workspaceEditState(root: Pick<ParentNode, 'querySelector'> | null) {
  return {
    busy: !!root?.querySelector('[data-workspace-saving="true"]'),
    dirty: !!root?.querySelector('[data-workspace-dirty="true"]'),
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
