import { FREE_IMAGE_INPAINT_ASSET, validateFreeImageInpaintPixels, MAX_FREE_IMAGE_INPAINT_REGIONS, MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS, type InpaintPixels } from '@/app/free-image-inpaint';
type InpaintWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>;
type Options = { workerFactory?: () => InpaintWorker; timeoutMs?: number };
/** One lazy engine per render. Cancellation/timeouts terminate WASM execution;
 * errors never report a flat-color fallback as successful reconstruction. */
export function createFreeImageInpaintSession(signal: AbortSignal, options: Options = {}) {
  let worker: InpaintWorker | undefined, closed = false, sequence = 0, pixels = 0;
  let pending: ((reason: unknown) => void) | undefined;
  const close = () => { closed = true; worker?.terminate(); worker = undefined; signal.removeEventListener('abort', abort); };
  const fail = (reason: unknown) => { const reject = pending; pending = undefined; close(); reject?.(reason); };
  const abort = () => fail(signal.reason ?? Error('배경 복원을 취소했습니다.'));
  signal.throwIfAborted(); signal.addEventListener('abort', abort, { once: true });
  return {
    async restore(input: InpaintPixels): Promise<Uint8ClampedArray> {
      signal.throwIfAborted(); validateFreeImageInpaintPixels(input);
      if (closed || pending) throw Error('배경 복원 작업을 다시 시작해주세요.');
      const width=input.width,height=input.height,mask={...input.mask},original=input.data.slice();
      if (++sequence > MAX_FREE_IMAGE_INPAINT_REGIONS || (pixels += width * height) > MAX_FREE_IMAGE_INPAINT_TOTAL_PIXELS) {
        close(); throw Error('한 번에 복원할 영역이 너무 많습니다. 일부 영역의 선택을 해제해주세요.');
      }
      // Own both geometry and original RGBA before yielding. Caller buffers may
      // be edited or detached while the Worker runs; transfer a separate copy.
      const data = original.slice(), id = sequence;
      try { worker ??= (options.workerFactory ?? (() => new Worker(FREE_IMAGE_INPAINT_ASSET)))(); }
      catch { close(); throw Error('배경 복원 엔진을 열지 못했습니다. 브라우저에서 다시 시도해주세요.'); }
      const active = worker;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => fail(Error('배경 복원 시간이 초과됐습니다. 영역을 줄여 다시 시도해주세요.')), options.timeoutMs ?? 30000);
        const finish = () => { clearTimeout(timeout); pending = undefined; active.onmessage = null; active.onerror = null; active.onmessageerror = null; };
        pending = reason => { finish(); reject(reason); };
        active.onerror = active.onmessageerror = () => fail(Error('배경 복원 엔진을 읽지 못했습니다. 원본을 유지했습니다.'));
        active.onmessage = event => {
          const result = event.data;
          if (result?.id !== id || result.error || result.width !== width || result.height !== height
            || !(result.data instanceof Uint8ClampedArray) || result.data.length !== original.length) { fail(Error(result?.error || '배경 복원 결과를 확인하지 못했습니다.')); return; }
          // Worker output is untrusted. Retain every original outside pixel and alpha.
          const output = original.slice();
          for (let y = mask.y; y < mask.y + mask.height; y++) for (let x = mask.x; x < mask.x + mask.width; x++) {
            const index = (y * width + x) * 4; output.set(result.data.subarray(index, index + 3), index);
          }
          finish(); resolve(output);
        };
        try { active.postMessage({ width,height,mask:{...mask},data,id }, [data.buffer]); } catch { fail(Error('배경 복원 요청을 전달하지 못했습니다.')); }
      });
    },
    close() { if (pending) fail(Error('배경 복원을 종료했습니다.')); else close(); },
  };
}
