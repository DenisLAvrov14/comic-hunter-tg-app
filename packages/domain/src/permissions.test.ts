import { describe, expect, it } from 'vitest';
import {
  can,
  seesEventChat,
  defaultHostPermissions,
  eventActions,
  hostPermissionFlags,
  type EventAction,
  type EventResource,
  type HostPermissionFlag,
} from './permissions';

const ORG = { userId: 'org' };
const HOST = { userId: 'host' };
const COMIC = { userId: 'comic' };

const event = (patch: Partial<EventResource['event']> = {}): EventResource['event'] => ({
  organizerId: 'org',
  status: 'recruiting',
  recruitmentOpen: true,
  ...patch,
});

const hostWith = (...flags: HostPermissionFlag[]): EventResource => ({
  event: event(),
  staff: { permissions: Object.fromEntries(flags.map((f) => [f, true])) },
});

// Таблица SPEC §5, столбцы «Организатор» и «Ведущий» (комику — отдельные тесты ниже).
const table: Array<[EventAction, boolean, HostPermissionFlag | boolean]> = [
  ['event.view', true, true],
  ['applications.manage', true, false],
  ['comedians.invite', true, false],
  ['lineup.reorder', true, 'can_reorder'],
  ['attendance.mark', true, 'can_mark_attendance'],
  ['reserve.call', true, 'can_call_reserve'],
  ['lineup.notify', true, 'can_notify_lineup'],
  ['event.edit', true, false],
  ['staff.assign', true, false],
];

describe('can: организатор и ведущий', () => {
  it.each(table)('%s', (action, organizer, host) => {
    expect(can(ORG, action, { event: event() })).toBe(organizer);
    if (typeof host === 'boolean') {
      // Даже со всеми флагами ведущий не получает организаторских прав.
      expect(can(HOST, action, hostWith(...hostPermissionFlags))).toBe(host);
    } else {
      expect(can(HOST, action, hostWith(host))).toBe(true);
      expect(can(HOST, action, hostWith(...hostPermissionFlags.filter((f) => f !== host)))).toBe(
        false,
      );
    }
  });

  it('флаг со значением false не даёт права', () => {
    expect(
      can(HOST, 'lineup.reorder', {
        event: event(),
        staff: { permissions: { can_reorder: false } },
      }),
    ).toBe(false);
  });

  it('неизвестные флаги (задел под клубы) игнорируются', () => {
    expect(
      can(HOST, 'lineup.reorder', {
        event: event(),
        staff: { permissions: { club_admin: true } },
      }),
    ).toBe(false);
  });

  it('организатор может подать заявку на своё событие (как комик)', () => {
    expect(can(ORG, 'event.apply', { event: event() })).toBe(true);
    expect(can(ORG, 'event.apply', { event: event(), participation: { status: 'pending' } })).toBe(
      false,
    );
    expect(can(ORG, 'event.apply', { event: event({ status: 'draft' }) })).toBe(false);
  });

  it('организатор без приглашения не отвечает на него', () => {
    expect(can(ORG, 'invitation.respond', { event: event() })).toBe(false);
  });

  it('новый ведущий только смотрит: никаких прав на состав', () => {
    expect(defaultHostPermissions()).toEqual({
      can_reorder: false,
      can_mark_attendance: false,
      can_call_reserve: false,
      can_notify_lineup: false,
    });
  });
});

describe('can: комик', () => {
  const organizerActions = eventActions.filter(
    (a) => !['event.view', 'event.apply', 'invitation.respond'].includes(a),
  );

  it.each(organizerActions)('%s — нельзя, даже будучи в составе', (action) => {
    expect(can(COMIC, action, { event: event(), participation: { status: 'accepted' } })).toBe(
      false,
    );
  });

  describe('видеть событие', () => {
    it('открытый набор — да', () => {
      expect(can(COMIC, 'event.view', { event: event() })).toBe(true);
    });
    it('закрытый набор — да: событие видно на «Карте»', () => {
      expect(can(COMIC, 'event.view', { event: event({ recruitmentOpen: false }) })).toBe(true);
    });
    it('черновик — нет', () => {
      expect(can(COMIC, 'event.view', { event: event({ status: 'draft' }) })).toBe(false);
    });
    it('закрытый набор, но по ссылке — да', () => {
      expect(
        can(COMIC, 'event.view', { event: event({ recruitmentOpen: false }), viaLink: true }),
      ).toBe(true);
    });
    it('приглашён — да', () => {
      expect(
        can(COMIC, 'event.view', {
          event: event({ recruitmentOpen: false }),
          participation: { status: 'invited' },
        }),
      ).toBe(true);
    });
    it('черновик — нет, даже по ссылке', () => {
      expect(can(COMIC, 'event.view', { event: event({ status: 'draft' }), viaLink: true })).toBe(
        false,
      );
    });
  });

  describe('подать заявку', () => {
    it('открытый набор — да', () => {
      expect(can(COMIC, 'event.apply', { event: event() })).toBe(true);
    });
    it('по ссылке при закрытом наборе — да', () => {
      expect(
        can(COMIC, 'event.apply', { event: event({ recruitmentOpen: false }), viaLink: true }),
      ).toBe(true);
    });
    it('закрытый набор без ссылки — нет', () => {
      expect(can(COMIC, 'event.apply', { event: event({ recruitmentOpen: false }) })).toBe(false);
    });
    it.each(['draft', 'lineup_locked', 'finished', 'cancelled'] as const)(
      'событие в статусе %s — нет',
      (status) => {
        expect(can(COMIC, 'event.apply', { event: event({ status }) })).toBe(false);
      },
    );
    it('уже есть активное участие — нет', () => {
      expect(
        can(COMIC, 'event.apply', { event: event(), participation: { status: 'pending' } }),
      ).toBe(false);
    });
    it('после отзыва заявки — можно снова', () => {
      expect(
        can(COMIC, 'event.apply', { event: event(), participation: { status: 'withdrawn' } }),
      ).toBe(true);
    });
  });

  describe('ответить на приглашение', () => {
    it('своё приглашение — да', () => {
      expect(
        can(COMIC, 'invitation.respond', { event: event(), participation: { status: 'invited' } }),
      ).toBe(true);
    });
    it('без приглашения — нет', () => {
      expect(can(COMIC, 'invitation.respond', { event: event() })).toBe(false);
      expect(
        can(COMIC, 'invitation.respond', { event: event(), participation: { status: 'pending' } }),
      ).toBe(false);
    });
  });
});

describe('seesEventChat', () => {
  const none = { isOrganizer: false, staffStatus: null, participationStatus: null };
  it('организатор, ведущий, состав и резерв — видят', () => {
    expect(seesEventChat({ ...none, isOrganizer: true })).toBe(true);
    expect(seesEventChat({ ...none, staffStatus: 'accepted' })).toBe(true);
    expect(seesEventChat({ ...none, participationStatus: 'accepted' })).toBe(true);
    expect(seesEventChat({ ...none, participationStatus: 'reserve' })).toBe(true);
  });
  it('заявка, приглашение, отказ и посторонний — нет', () => {
    expect(seesEventChat(none)).toBe(false);
    expect(seesEventChat({ ...none, staffStatus: 'invited' })).toBe(false);
    for (const s of ['pending', 'invited', 'withdrawn', 'removed', 'rejected']) {
      expect(seesEventChat({ ...none, participationStatus: s })).toBe(false);
    }
  });
});
