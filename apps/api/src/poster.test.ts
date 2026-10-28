import { describe, expect, it } from 'vitest';
import { buildPosterText } from './poster';

describe('buildPosterText', () => {
  const base = {
    title: 'Пятничный open mic',
    startsAt: new Date('2026-11-06T17:00:00Z'),
    timezone: 'Europe/Moscow',
    venue: { name: 'Подвал', address: 'ул. Мясницкая, 13' },
  };

  it('полный текст: ведущий, состав со ссылками, условия', () => {
    expect(
      buildPosterText({
        ...base,
        hosts: ['Ольга'],
        lineup: [
          { stageName: 'Лиза Шторм', link: 'https://youtube.com/1' },
          { stageName: 'Артём Белый', link: null },
        ],
        conditions: 'Вход свободный',
      }),
    ).toBe(
      [
        '🎤 Пятничный open mic',
        '📅 пятница, 6 ноября в 20:00',
        '📍 Подвал, ул. Мясницкая, 13',
        '🎙 Ведущий: Ольга',
        '',
        'Состав:',
        '1. Лиза Шторм — https://youtube.com/1',
        '2. Артём Белый',
        '',
        'Условия:',
        'Вход свободный',
      ].join('\n'),
    );
  });

  it('без ведущего, состава и условий — только шапка; время по таймзоне площадки', () => {
    const text = buildPosterText({
      ...base,
      timezone: 'Asia/Almaty',
      hosts: [],
      lineup: [],
      conditions: '  ',
    });
    expect(text).toBe(
      [
        '🎤 Пятничный open mic',
        '📅 пятница, 6 ноября в 22:00',
        '📍 Подвал, ул. Мясницкая, 13',
      ].join('\n'),
    );
  });
});
