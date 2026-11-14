import { describe, expect, it } from 'vitest';
import { filterCityNames, regionOf, socialUrl } from './profiles';

describe('socialUrl', () => {
  it.each([
    ['telegram', '@stand_up', 'https://t.me/stand_up'],
    ['telegram', 't.me/stand_up', 'https://t.me/stand_up'],
    ['instagram', 'comic', 'https://instagram.com/comic'],
    ['youtube', '@channel', 'https://youtube.com/@channel'],
    ['tiktok', '@comic', 'https://www.tiktok.com/@comic'],
    ['vk', 'vk.com/comic', 'https://vk.com/comic'],
    ['vk', 'https://vk.com/comic', 'https://vk.com/comic'],
  ] as const)('%s: «%s» → %s', (type, raw, url) => {
    expect(socialUrl(type, raw)).toBe(url);
  });

  it('пустое поле — null', () => {
    expect(socialUrl('telegram', '   ')).toBeNull();
  });
});

describe('регионы', () => {
  it('Казахстан и соседи — Центральная Азия, остальное не-РФ — Европа', () => {
    expect(regionOf('RU')).toBe('RU');
    expect(['KZ', 'UZ', 'KG', 'TJ'].map((c) => regionOf(c as 'KZ'))).toEqual([
      'CA',
      'CA',
      'CA',
      'CA',
    ]);
    expect(regionOf('GE')).toBe('EU');
    expect(regionOf('ES')).toBe('EU');
  });

  it('в фильтрах нет дублей', () => {
    const all = Object.values(filterCityNames).flat();
    expect(new Set(all).size).toBe(all.length);
  });
});
