export type FreeImagePhoto = {
  rotation: 0 | 90 | 180 | 270;
  flipX: boolean;
  flipY: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
};

export const neutralFreeImagePhoto: Readonly<FreeImagePhoto> = Object.freeze({
  rotation: 0, flipX: false, flipY: false, brightness: 100, contrast: 100, saturation: 100, hue: 0,
});

export const freeImagePhotoTones = [
  { key: 'brightness', label: '밝기', min: 0, max: 200 },
  { key: 'contrast', label: '대비', min: 0, max: 200 },
  { key: 'saturation', label: '채도', min: 0, max: 200 },
  { key: 'hue', label: '색조', min: -180, max: 180 },
] as const;

export function validateFreeImagePhoto(value: unknown): FreeImagePhoto {
  const photo = value as FreeImagePhoto;
  if (!photo || typeof photo !== 'object' || Array.isArray(photo)
    || Reflect.ownKeys(photo).length !== Object.keys(neutralFreeImagePhoto).length
    || !Object.keys(neutralFreeImagePhoto).every(key => Object.hasOwn(photo, key))
    || ![0, 90, 180, 270].includes(photo.rotation)
    || typeof photo.flipX !== 'boolean' || typeof photo.flipY !== 'boolean'
    || freeImagePhotoTones.some(({ key, min, max }) => !Number.isInteger(photo[key]) || photo[key] < min || photo[key] > max)) {
    throw Error('이미지 회전·반전과 밝기·대비·채도·색조 값을 확인해주세요.');
  }
  const { rotation, flipX, flipY, brightness, contrast, saturation, hue } = photo;
  return { rotation, flipX, flipY, brightness, contrast, saturation, hue };
}

export function hasFreeImagePhotoEdits(photo: FreeImagePhoto) {
  return photo.rotation !== 0 || photo.flipX || photo.flipY || freeImagePhotoTones.some(({ key }) => photo[key] !== neutralFreeImagePhoto[key]);
}

export function rotateFreeImagePhoto(photo: FreeImagePhoto, degrees: -90 | 90): FreeImagePhoto {
  return { ...photo, rotation: ((photo.rotation + degrees + 360) % 360) as FreeImagePhoto['rotation'], flipX: photo.flipY, flipY: photo.flipX };
}

export function freeImagePhotoFilter(photo: FreeImagePhoto) {
  return freeImagePhotoTones.some(({ key }) => photo[key] !== neutralFreeImagePhoto[key])
    ? `brightness(${photo.brightness}%) contrast(${photo.contrast}%) saturate(${photo.saturation}%) hue-rotate(${photo.hue}deg)` : 'none';
}

/** Original pixel edge coordinates map into the oriented display or PNG. */
export function freeImagePhotoGeometry(width: number, height: number, photo: Pick<FreeImagePhoto, 'rotation' | 'flipX' | 'flipY'> = neutralFreeImagePhoto) {
  const quarterTurn = photo.rotation === 90 || photo.rotation === 270;
  const outputWidth = quarterTurn ? height : width, outputHeight = quarterTurn ? width : height;
  const [a, b, c, d, e, f] = photo.rotation === 90 ? [0, 1, -1, 0, height, 0]
    : photo.rotation === 180 ? [-1, 0, 0, -1, width, height]
      : photo.rotation === 270 ? [0, -1, 1, 0, 0, width] : [1, 0, 0, 1, 0, 0];
  const matrix: [number, number, number, number, number, number] = [
    photo.flipX ? -a : a, photo.flipY ? -b : b, photo.flipX ? -c : c, photo.flipY ? -d : d,
    photo.flipX ? outputWidth - e : e, photo.flipY ? outputHeight - f : f,
  ];
  return { width: outputWidth, height: outputHeight, matrix };
}

export function freeImagePhotoSourcePoint(xRatio: number, yRatio: number, width: number, height: number, photo?: FreeImagePhoto) {
  if (!photo || !photo.rotation && !photo.flipX && !photo.flipY) return { x: xRatio * width, y: yRatio * height };
  const geometry = freeImagePhotoGeometry(width, height, photo);
  const [a, b, c, d, e, f] = geometry.matrix;
  const x = xRatio * geometry.width - e, y = yRatio * geometry.height - f;
  const determinant = a * d - b * c;
  return { x: (d * x - c * y) / determinant, y: (a * y - b * x) / determinant };
}
