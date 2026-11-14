import { describe, expect, it } from 'vitest';
import { LIST_LIMIT, renderProfile, renderSchedule, renderSlots } from './commands';

const at = (iso: string) => new Date(iso);
const tz = 'Europe/Moscow';

describe('/schedule', () => {
  it('выступления по времени, свои — с пометкой; события организатора со счётчиками', () => {
    const text = renderSchedule({
      gigs: [
        {
          title: 'Опен',
          venue: 'Подвал',
          startsAt: at('2026-11-12T17:00:00Z'),
          timezone: tz,
          position: 3,
        },
        {
          manual: true,
          title: null,
          venue: 'Бар',
          startsAt: at('2026-11-11T16:00:00Z'),
          timezone: tz,
        },
      ],
      events: [
        {
          title: 'Шоу',
          venue: 'Клуб',
          startsAt: at('2026-11-13T17:00:00Z'),
          timezone: tz,
          accepted: 2,
          slots: 6,
          awaiting: 4,
        },
      ],
    });
    expect(text.indexOf('Выступление, Бар (своё)')).toBeGreaterThan(0);
    expect(text.indexOf('Выступление, Бар')).toBeLessThan(text.indexOf('Опен, Подвал, №3'));
    expect(text).toContain('20:00 — Шоу, Клуб · 2/6 мест · заявок: 4');
  });

  it('пусто — так и пишет', () => {
    expect(renderSchedule({ gigs: [], events: null })).toContain('выступлений нет');
  });
});

describe('/slots', () => {
  it('только события со свободными местами, длинный список обрезается', () => {
    const many = Array.from({ length: LIST_LIMIT + 3 }, (_, i) => ({
      title: `Опен ${i}`,
      venue: 'Зал',
      startsAt: at('2026-11-12T17:00:00Z'),
      timezone: tz,
      free: i === 0 ? 0 : 2,
    }));
    const text = renderSlots('Места', many);
    expect(text).not.toContain('Опен 0,');
    expect(text).toContain('свободно 2');
    expect(text).toContain('…и ещё 2');
  });

  it('нет мест — пустой ответ', () => {
    expect(renderSlots('Места', [])).toContain('Свободных мест не нашли');
  });
});

describe('/profile', () => {
  it('комик и организатор', () => {
    const text = renderProfile({
      comedian: {
        stageName: 'Джордан',
        city: 'Москва',
        category: 'Опытный',
        contact: '@j',
        bio: null,
        links: [{ label: 'Telegram', url: 'https://t.me/j' }],
        photos: 2,
      },
      organizer: { displayName: 'Орг', city: 'Казань', projectName: null, contact: null },
    });
    expect(text).toContain('🎤 Джордан — Комик');
    expect(text).toContain('• Telegram: https://t.me/j');
    expect(text).toContain('📋 Орг — Организатор\nГород: Казань');
    expect(text).not.toContain('Проект:');
  });

  it('без профилей', () => {
    expect(renderProfile({ comedian: null, organizer: null })).toBe('Профиль ещё не заполнен.');
  });
});
