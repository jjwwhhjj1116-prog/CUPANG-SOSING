/** Header dimensions only, not full decoding or proof of image quality. Unknown formats stay unverified. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, text: string) => offset + text.length <= bytes.length && [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  const result = (width: number, height: number) => Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 ? { width, height } : null;
  if (bytes.length >= 33 && bytes[0] === 137 && tag(1, 'PNG\r\n\u001a\n') && view.getUint32(8) === 13 && tag(12, 'IHDR')) return result(view.getUint32(16), view.getUint32(20));
  if (bytes.length >= 13 && (tag(0, 'GIF87a') || tag(0, 'GIF89a'))) return result(view.getUint16(6, true), view.getUint16(8, true));
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217 || marker === undefined) return null;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8 || bytes[offset + 7] < 1 || length !== 8 + 3 * bytes[offset + 7]) return null;
        return result(view.getUint16(offset + 5), view.getUint16(offset + 3));
      }
      offset += length;
    }
  }
  if (bytes.length >= 20 && tag(0, 'RIFF') && tag(8, 'WEBP')) {
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length) return null;
    for (let offset = 12; offset + 8 <= end;) {
      const size = view.getUint32(offset + 4, true), start = offset + 8;
      if (start + size > end) return null;
      const u24 = (i: number) => bytes[i] + bytes[i + 1] * 256 + bytes[i + 2] * 65536;
      if (tag(offset, 'VP8X') && size >= 10) return result(u24(start + 4) + 1, u24(start + 7) + 1);
      if (tag(offset, 'VP8 ') && size >= 10 && bytes[start + 3] === 157 && bytes[start + 4] === 1 && bytes[start + 5] === 42) return result(view.getUint16(start + 6, true) & 16383, view.getUint16(start + 8, true) & 16383);
      if (tag(offset, 'VP8L') && size >= 5 && bytes[start] === 47) {
        const bits = view.getUint32(start + 1, true);
        return result((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
      }
      offset = start + size + (size % 2);
    }
  }
  return null;
}

export function imageDimensionMetadata(bytes: Uint8Array): Record<string, string> {
  const dimensions = imageDimensions(bytes);
  return dimensions ? { dimensionValidation: 'header-v1', imageWidth: String(dimensions.width), imageHeight: String(dimensions.height) } : {};
}

/** Browser Image applies EXIF orientation before reporting natural dimensions.
 * Read only IFD0's orientation; never follow metadata pointers outside its chunk. */
export function imageDisplayDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const raw = imageDimensions(bytes); if (!raw) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) => offset >= 0 && offset + value.length <= bytes.length && [...value].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  let orientation: number | null = null, invalid = false;
  function exif(start: number, end: number) {
    if (tag(start, 'Exif\0\0')) start += 6;
    if (start + 8 > end) { invalid = true; return; }
    const little = tag(start, 'II');
    if (!little && !tag(start, 'MM') || view.getUint16(start + 2, little) !== 42) { invalid = true; return; }
    const relative = view.getUint32(start + 4, little);
    if (relative < 8 || relative > end - start - 2) { invalid = true; return; }
    const directory = start + relative, count = view.getUint16(directory, little);
    if (count > 4096 || count > Math.floor((end - directory - 6) / 12)) { invalid = true; return; }
    for (let index = 0; index < count; index++) {
      const offset = directory + 2 + index * 12;
      if (view.getUint16(offset, little) !== 0x0112) continue;
      const value = view.getUint16(offset + 8, little);
      if (view.getUint16(offset + 2, little) !== 3 || view.getUint32(offset + 4, little) !== 1 || value < 1 || value > 8
        || orientation !== null && orientation !== value) { invalid = true; return; }
      orientation = value;
    }
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 255) return null;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; if (marker === 218 || marker === 217 || marker === undefined) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) return null;
      const length = view.getUint16(offset); if (length < 2 || offset + length > bytes.length) return null;
      if (marker === 225 && tag(offset + 2, 'Exif\0\0')) exif(offset + 2, offset + length);
      offset += length;
    }
  } else if (tag(0, '\x89PNG\r\n\x1a\n')) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset), start = offset + 8;
      if (length > bytes.length - start - 4) return null;
      if (tag(offset + 4, 'eXIf')) exif(start, start + length);
      if (tag(offset + 4, 'IEND')) break;
      offset = start + length + 4;
    }
  } else if (tag(0, 'RIFF') && tag(8, 'WEBP')) {
    const end = view.getUint32(4, true) + 8;
    for (let offset = 12; offset + 8 <= end;) {
      const length = view.getUint32(offset + 4, true), start = offset + 8;
      if (length > end - start) return null;
      if (tag(offset, 'EXIF')) exif(start, start + length);
      offset = start + length + (length % 2);
    }
  }
  if (invalid) return null;
  return orientation !== null && orientation >= 5 ? { width: raw.height, height: raw.width } : raw;
}
