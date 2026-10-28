import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processPhoto, UnsupportedImageError } from './images';

function image(width: number, height: number, format: 'png' | 'jpeg' = 'png') {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    [format]()
    .toBuffer();
}

describe('processPhoto', () => {
  it('делает превью шириной 400px и сохраняет пропорции', async () => {
    const res = await processPhoto(await image(1200, 900));
    expect(res.width).toBe(1200);
    expect(res.height).toBe(900);
    const preview = await sharp(res.preview).metadata();
    expect(preview.format).toBe('jpeg');
    expect(preview.width).toBe(400);
    expect(preview.height).toBe(300);
  });

  it('не увеличивает маленькие картинки', async () => {
    const res = await processPhoto(await image(200, 100, 'jpeg'));
    expect((await sharp(res.preview).metadata()).width).toBe(200);
  });

  it('ограничивает оригинал 4096px по большей стороне', async () => {
    const res = await processPhoto(await image(5000, 1000));
    expect(res.width).toBe(4096);
  });

  it('учитывает EXIF-поворот', async () => {
    const rotated = await sharp(await image(600, 300, 'jpeg'))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const res = await processPhoto(rotated);
    expect(res.width).toBe(300);
    expect(res.height).toBe(600);
    expect((await sharp(res.original).metadata()).orientation).toBeUndefined();
  });

  it('отклоняет не-картинки', async () => {
    await expect(processPhoto(Buffer.from('hello'))).rejects.toBeInstanceOf(UnsupportedImageError);
  });
});
