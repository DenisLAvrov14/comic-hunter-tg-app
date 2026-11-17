import { describe, expect, it } from 'vitest';
import {
  normalizeHalls,
  normalizeWebsite,
  catalogVenuePatch,
  adminChangeError,
  adminGrantNotice,
  applyAdminChange,
  canSeeVenue,
  canUseVenue,
  groupAfisha,
  parseAdminTelegramIds,
  reviewVenue,
} from './venues';

const author = 'author';
const other = 'other';

describe('canSeeVenue', () => {
  it('проверенную видят все', () => {
    expect(canSeeVenue(other, { status: 'approved', createdBy: author })).toBe(true);
    expect(canSeeVenue(other, { status: 'approved', createdBy: null })).toBe(true);
  });

  it('на проверке и отклонённую видит только автор', () => {
    for (const status of ['pending', 'rejected'] as const) {
      expect(canSeeVenue(author, { status, createdBy: author })).toBe(true);
      expect(canSeeVenue(other, { status, createdBy: author })).toBe(false);
    }
  });

  it('без автора непроверенную не видит никто', () => {
    expect(canSeeVenue(other, { status: 'pending', createdBy: null })).toBe(false);
  });
});

describe('canUseVenue', () => {
  it('проверенную может выбрать любой', () => {
    expect(canUseVenue(other, { status: 'approved', createdBy: author })).toBe(true);
  });

  it('на проверке — только автор', () => {
    expect(canUseVenue(author, { status: 'pending', createdBy: author })).toBe(true);
    expect(canUseVenue(other, { status: 'pending', createdBy: author })).toBe(false);
  });

  it('отклонённую нельзя выбрать даже автору', () => {
    expect(canUseVenue(author, { status: 'rejected', createdBy: author })).toBe(false);
  });

  it('площадка, которая уже стоит в событии, остаётся при любом статусе', () => {
    expect(canUseVenue(author, { status: 'rejected', createdBy: author }, true)).toBe(true);
    expect(canUseVenue(other, { status: 'pending', createdBy: author }, true)).toBe(true);
  });
});

describe('reviewVenue', () => {
  it('одобрение', () => {
    expect(reviewVenue('pending', 'approve', 3)).toEqual({ kind: 'approved' });
  });

  it('отказ без событий — удаление', () => {
    expect(reviewVenue('pending', 'reject', 0)).toEqual({ kind: 'deleted' });
  });

  it('отказ при событиях — площадка скрывается', () => {
    expect(reviewVenue('pending', 'reject', 2)).toEqual({ kind: 'rejected' });
  });

  it('проверить можно только площадку на проверке', () => {
    for (const status of ['approved', 'rejected'] as const) {
      for (const action of ['approve', 'reject'] as const) {
        expect(reviewVenue(status, action, 0)).toEqual({ kind: 'error', reason: 'not_pending' });
      }
    }
  });
});

describe('adminChangeError', () => {
  const manager = { id: 'm', isAdmin: true, canManageAdmins: true };
  const person = (over: Partial<Parameters<typeof adminChangeError>[1]> = {}) => ({
    id: 'p',
    isAdmin: false,
    canManageAdmins: false,
    isOwner: false,
    ...over,
  });

  it('обычный админ права не меняет', () => {
    const admin = { id: 'a', isAdmin: true, canManageAdmins: false };
    expect(adminChangeError(admin, person(), 'grant')).toBe('forbidden');
    expect(adminChangeError(admin, person({ isAdmin: true }), 'revoke')).toBe('forbidden');
  });

  it('право назначать без админства не работает', () => {
    const ex = { id: 'x', isAdmin: false, canManageAdmins: true };
    expect(adminChangeError(ex, person(), 'grant')).toBe('forbidden');
  });

  it('свои права менять нельзя', () => {
    expect(adminChangeError(manager, person({ id: 'm', isAdmin: true }), 'revoke')).toBe('self');
  });

  it('главного из настройки не трогают', () => {
    const owner = person({ isAdmin: true, canManageAdmins: true, isOwner: true });
    expect(adminChangeError(manager, owner, 'revoke_manage')).toBe('owner');
  });

  it('снять можно только админа', () => {
    expect(adminChangeError(manager, person(), 'revoke')).toBe('not_admin');
    expect(adminChangeError(manager, person(), 'revoke_manage')).toBe('not_admin');
  });

  it('назначающий назначает и снимает', () => {
    expect(adminChangeError(manager, person(), 'grant')).toBeNull();
    expect(adminChangeError(manager, person(), 'grant_manage')).toBeNull();
    expect(adminChangeError(manager, person({ isAdmin: true }), 'revoke')).toBeNull();
  });
});

describe('applyAdminChange', () => {
  const none = { isAdmin: false, canManageAdmins: false };
  const admin = { isAdmin: true, canManageAdmins: false };
  const manager = { isAdmin: true, canManageAdmins: true };

  it('назначение не трогает право назначать', () => {
    expect(applyAdminChange(none, 'grant')).toEqual(admin);
    expect(applyAdminChange(manager, 'grant')).toEqual(manager);
  });

  it('право назначать делает админом', () => {
    expect(applyAdminChange(none, 'grant_manage')).toEqual(manager);
  });

  it('снятие забирает всё, отзыв права — только его', () => {
    expect(applyAdminChange(manager, 'revoke')).toEqual(none);
    expect(applyAdminChange(manager, 'revoke_manage')).toEqual(admin);
  });
});

describe('adminGrantNotice', () => {
  const none = { isAdmin: false, canManageAdmins: false };
  const admin = { isAdmin: true, canManageAdmins: false };
  const manager = { isAdmin: true, canManageAdmins: true };

  it('сообщает о новых правах', () => {
    expect(adminGrantNotice(none, admin)).toEqual(admin);
    expect(adminGrantNotice(admin, manager)).toEqual(manager);
  });

  it('молчит, если новых прав нет', () => {
    expect(adminGrantNotice(admin, admin)).toBeNull();
    expect(adminGrantNotice(manager, admin)).toBeNull();
    expect(adminGrantNotice(admin, none)).toBeNull();
  });
});

describe('parseAdminTelegramIds', () => {
  it('пусто — нет админов', () => {
    expect(parseAdminTelegramIds(undefined)).toEqual([]);
    expect(parseAdminTelegramIds('')).toEqual([]);
    expect(parseAdminTelegramIds(' ')).toEqual([]);
  });

  it('разделители — запятая, пробел, точка с запятой', () => {
    expect(parseAdminTelegramIds('123, 456;789  10')).toEqual([123, 456, 789, 10]);
  });

  it('не число — ошибка конфигурации', () => {
    expect(() => parseAdminTelegramIds('123,@me')).toThrow(/@me/);
    expect(() => parseAdminTelegramIds('-5')).toThrow();
  });
});

describe('groupAfisha', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 10, 20, h));
  const e = (id: string, venueId: string, h: number) => ({ id, venueId, startsAt: at(h) });

  it('ближайшие по времени, не больше заданного, и общее число', () => {
    const afisha = groupAfisha(
      [e('d', 'a', 22), e('b', 'a', 18), e('c', 'a', 20), e('x', 'z', 19), e('a', 'a', 17)],
      3,
    );
    expect(afisha.get('a')?.total).toBe(4);
    expect(afisha.get('a')?.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(afisha.get('z')).toEqual({ total: 1, items: [e('x', 'z', 19)] });
  });

  it('нет событий — нет площадки в результате', () => {
    expect(groupAfisha([]).size).toBe(0);
  });
});

describe('catalogVenuePatch', () => {
  const item = { name: 'PUNCH', address: 'ул. Каирбекова, 35а', kind: 'club', capacity: 80 };
  const old = {
    name: 'Punch StandUp Club',
    address: 'ул. Каирбекова, 35а, 3 этаж',
    kind: null,
    capacity: null,
    website: null,
    halls: null,
    priority: null,
  };

  it('площадку из каталога приводит к каталогу', () => {
    expect(catalogVenuePatch({ ...old, createdBy: null }, item)).toEqual({
      name: 'PUNCH',
      address: 'ул. Каирбекова, 35а',
      kind: 'club',
      capacity: 80,
    });
  });

  it('у площадки пользователя только дозаполняет пустое', () => {
    expect(catalogVenuePatch({ ...old, createdBy: 'u' }, item)).toEqual({
      kind: 'club',
      capacity: 80,
    });
    expect(catalogVenuePatch({ ...old, kind: 'bar', capacity: 30, createdBy: 'u' }, item)).toEqual(
      {},
    );
  });

  it('залы и приоритет из каталога', () => {
    const halls = [
      { name: 'Нижний зал', capacity: 140 },
      { name: 'Верхний зал', capacity: 200 },
    ];
    expect(
      catalogVenuePatch(
        {
          ...old,
          name: 'PUNCH',
          address: item.address,
          kind: 'club',
          capacity: 80,
          createdBy: null,
        },
        { ...item, capacity: 340, halls, priority: 1 },
      ),
    ).toEqual({ capacity: 340, halls, priority: 1 });
  });

  it('уже совпадает — менять нечего; без мест в каталоге места не стираются', () => {
    expect(
      catalogVenuePatch(
        { ...item, website: null, halls: null, priority: null, createdBy: null },
        item,
      ),
    ).toEqual({});
    const noCapacity = { name: item.name, address: item.address, kind: item.kind };
    expect(
      catalogVenuePatch(
        { ...item, capacity: 90, website: null, halls: null, priority: null, createdBy: null },
        noCapacity,
      ),
    ).toEqual({});
  });
});

describe('normalizeWebsite', () => {
  it('добавляет https и убирает слэш в конце', () => {
    expect(normalizeWebsite(' standupclub.kz/ ')).toBe('https://standupclub.kz');
    expect(normalizeWebsite('http://punchclub.kz/afisha')).toBe('http://punchclub.kz/afisha');
  });

  it('пусто — null, мусор — undefined', () => {
    expect(normalizeWebsite('  ')).toBeNull();
    expect(normalizeWebsite('клуб')).toBeUndefined();
    expect(normalizeWebsite('javascript:alert(1)')).toBeUndefined();
    expect(normalizeWebsite('ftp://site.kz')).toBeUndefined();
    expect(normalizeWebsite('my site.kz')).toBeUndefined();
  });
});

describe('normalizeHalls', () => {
  it('один зал — просто число мест', () => {
    expect(normalizeHalls([{ name: '', capacity: 80 }])).toEqual({
      ok: true,
      halls: null,
      capacity: 80,
    });
  });

  it('несколько залов — с названиями, места суммируются', () => {
    expect(
      normalizeHalls([
        { name: ' Нижний зал ', capacity: 140 },
        { name: 'Верхний зал', capacity: 200 },
      ]),
    ).toEqual({
      ok: true,
      halls: [
        { name: 'Нижний зал', capacity: 140 },
        { name: 'Верхний зал', capacity: 200 },
      ],
      capacity: 340,
    });
  });

  it('ошибки: нет залов, без названия, повтор, слишком много', () => {
    expect(normalizeHalls([])).toEqual({ ok: false, error: 'empty' });
    expect(
      normalizeHalls([
        { name: 'А', capacity: 1 },
        { name: '', capacity: 2 },
      ]),
    ).toEqual({ ok: false, error: 'names' });
    expect(
      normalizeHalls([
        { name: 'Зал', capacity: 1 },
        { name: 'зал', capacity: 2 },
      ]),
    ).toEqual({ ok: false, error: 'duplicate' });
    expect(
      normalizeHalls(Array.from({ length: 6 }, (_, i) => ({ name: `${i}`, capacity: 1 }))),
    ).toEqual({ ok: false, error: 'too_many' });
  });
});
