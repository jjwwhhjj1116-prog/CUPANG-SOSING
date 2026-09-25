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
