/** The image signature contract reads at most the first 1024 bytes (AVIF).
 * Forward original chunks after that bounded prefix instead of copying the
 * entire private image into a second application buffer. */
export class PrivateImageStreamError extends Error {
  constructor(public readonly status: 413 | 503, message: string) { super(message); }
}
export async function privateImageStream(stream: ReadableStream<Uint8Array> | null, size: number, maxBytes: number) {
  if (!Number.isSafeInteger(size) || size < 0) throw new PrivateImageStreamError(503, 'Image storage unavailable');
  if (size > maxBytes) throw new PrivateImageStreamError(413, 'Image exceeds 10 MB');
  if (!stream) throw new PrivateImageStreamError(503, 'Image storage unavailable');
  const reader = stream.getReader(), prefix = new Uint8Array(Math.min(1024, size)), pending: Uint8Array[] = [];
  let received = 0, prefixLength = 0, finished = false, released = false;
  const release = () => { if (!released) { released = true; reader.releaseLock(); } };
  const cancel = async (reason?: unknown) => { try { await reader.cancel(reason); } catch { /* Preserve the original stream failure. */ } finally { release(); } };
  const next = async () => {
    const result = await reader.read();
    if (result.done) {
      finished = true;
      if (received !== size) throw new PrivateImageStreamError(503, 'Image storage length changed');
      release(); return null;
    }
    received += result.value.byteLength;
    if (received > maxBytes) throw new PrivateImageStreamError(413, 'Image exceeds 10 MB');
    if (received > size) throw new PrivateImageStreamError(503, 'Image storage length changed');
    return result.value;
  };
  try {
    while (prefixLength < prefix.length) {
      const chunk = await next(); if (chunk === null) break;
      const length = Math.min(chunk.byteLength, prefix.length - prefixLength);
      prefix.set(chunk.subarray(0, length), prefixLength); prefixLength += length;
      pending.push(chunk);
    }
  } catch (error) { await cancel(error); throw error; }
  return { prefix: prefix.subarray(0, prefixLength), body: new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (pending.length) { controller.enqueue(pending.shift()!); return; }
        if (finished) { controller.close(); return; }
        const chunk = await next();
        if (chunk === null) controller.close(); else controller.enqueue(chunk);
      } catch (error) { await cancel(error); controller.error(error); }
    },
    cancel,
  }) };
}
