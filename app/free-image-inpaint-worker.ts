import { inpaintFreeImagePixels, validateFreeImageInpaintPixels, type InpaintPixels, type OpenCvInpaint } from './free-image-inpaint';
type Scope = { cv?: OpenCvInpaint | Promise<OpenCvInpaint>; importScripts(url: string): void; onmessage: ((event: MessageEvent) => void) | null; postMessage(value: unknown, transfer: Transferable[]): void };
const scope = globalThis as unknown as Scope;
let runtime: Promise<OpenCvInpaint> | undefined, busy = false;
function openCv(): Promise<OpenCvInpaint> {
  if (!runtime) runtime = Promise.resolve().then(async () => {
    scope.importScripts('/inpaint/5.0.0-release.1/opencv.js');
    const cv = await scope.cv;
    if (!cv || typeof cv.inpaint !== 'function' || cv.INPAINT_TELEA !== 1) throw Error('배경 복원 엔진을 읽지 못했습니다.');
    return cv;
  });
  return runtime;
}
scope.onmessage = event => {
  const request = event.data as InpaintPixels & { id: number };
  if (busy) { scope.postMessage({ id: request?.id, error: '배경 복원은 한 영역씩 처리합니다.' }, []); return; }
  busy = true;
  void (async () => {
    try {
      if (!Number.isSafeInteger(request?.id) || request.id < 1) throw Error('배경 복원 요청을 확인해주세요.');
      validateFreeImageInpaintPixels(request);
      const data = inpaintFreeImagePixels(await openCv(), request);
      scope.postMessage({ id: request.id, width: request.width, height: request.height, data }, [data.buffer]);
    } catch { scope.postMessage({ id: request?.id, error: '배경 복원을 완료하지 못했습니다. 원본을 유지했습니다. 영역을 조정한 뒤 다시 미리보기를 만들어주세요.' }, []); }
    finally { busy = false; }
  })();
};
