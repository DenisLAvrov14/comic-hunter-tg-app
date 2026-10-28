import sharp from 'sharp';
import { PHOTO_PREVIEW_WIDTH } from '@standup/shared';

export interface ProcessedPhoto {
  original: Buffer;
  preview: Buffer;
  width: number;
  height: number;
}

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);
const MAX_SIDE = 4096;

export class UnsupportedImageError extends Error {}

/**
 * Готовит фото к хранению: разворачивает по EXIF, срезает метаданные (в т.ч. геометку),
 * ограничивает размер оригинала и делает превью шириной 400px. Всё сохраняется в JPEG.
 */
export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new UnsupportedImageError('not an image');
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new UnsupportedImageError(`unsupported format: ${meta.format}`);
  }

  const { data: original, info } = await sharp(input)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });

  const preview = await sharp(original)
    .resize({ width: PHOTO_PREVIEW_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();

  return { original, preview, width: info.width, height: info.height };
}
