const activeWindows=new Set();

// App and popup deliveries share this worker-local lock. The persisted claim
// separately prevents replay after worker restart or an uncertain reply.
export function claimSupplierHubTransmissionWindow(windowId){
  if(!Number.isSafeInteger(windowId)||windowId<0)throw Error('전송할 Chrome 창을 확인해주세요.');
  if(activeWindows.has(windowId))throw Error('이 Chrome 창에서 다른 견적서를 전송 중입니다.');
  activeWindows.add(windowId);
  return ()=>activeWindows.delete(windowId);
}
