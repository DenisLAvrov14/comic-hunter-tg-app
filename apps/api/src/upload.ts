import type { FastifyRequest } from 'fastify';
import { PHOTO_MAX_BYTES } from '@standup/shared';
import { ApiError } from './errors';
import { UnsupportedImageError } from './images';

/** Один файл из multipart-запроса, не больше 10 МБ. */
export async function readUpload(req: FastifyRequest): Promise<Buffer> {
  const file = await req.file({ limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } });
  if (!file) throw new ApiError('VALIDATION', 'Файл не передан');
  return file.toBuffer().catch((err: { code?: string }) => {
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new ApiError('VALIDATION', 'Файл больше 10 МБ');
    }
    throw err;
  });
}

/** Обработка картинки с понятной ошибкой на неподдерживаемый формат. */
export async function processImage<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof UnsupportedImageError) {
      throw new ApiError('VALIDATION', 'Поддерживаются JPEG, PNG, WebP и HEIC');
    }
    throw err;
  }
}
