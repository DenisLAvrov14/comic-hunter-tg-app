import { describe, expect, it } from 'vitest';
import {
  applyOrder,
  compactPositions,
  hasFreeSlot,
  initialStatus,
  isActive,
  nextPosition,
  participationActions,
  participationStatuses,
  transition,
  type ParticipationAction,
  type ParticipationActor,
  type ParticipationStatus,
} from './participation';

// Ожидаемые переходы выписаны из SPEC §4 вручную, независимо от таблицы в коде.
const allowed: Array<
  [ParticipationStatus, ParticipationAction, ParticipationActor, ParticipationStatus]
> = [
  ['pending', 'accept', 'organizer', 'accepted'],
  ['pending', 'reject', 'organizer', 'rejected'],
  ['pending', 'reserve', 'organizer', 'reserve'],
  ['reserve', 'promote', 'organizer', 'accepted'],
  ['invited', 'accept', 'comedian', 'accepted'],
  ['invited', 'decline', 'comedian', 'declined'],
  ['invited', 'counter_propose', 'comedian', 'counter_proposed'],
  ['counter_proposed', 'accept', 'organizer', 'accepted'],
  ['counter_proposed', 'reject', 'organizer', 'declined'],
  ['accepted', 'reserve', 'organizer', 'reserve'],
  ...(['pending', 'invited', 'counter_proposed', 'accepted', 'reserve'] as const).flatMap(
    (s) =>
      [
        [s, 'withdraw', 'comedian', 'withdrawn'],
        [s, 'remove', 'organizer', 'removed'],
      ] as Array<
        [ParticipationStatus, ParticipationAction, ParticipationActor, ParticipationStatus]
      >,
  ),
];

const key = (s: string, a: string, r: string) => `${s}|${a}|${r}`;
const allowedMap = new Map(allowed.map(([s, a, r, to]) => [key(s, a, r), to]));
const actors: ParticipationActor[] = ['comedian', 'organizer'];

describe('transition', () => {
  it.each(allowed)('%s --%s (%s)--> %s', (from, action, actor, to) => {
    expect(transition(from, action, actor)).toEqual({ ok: true, to });
  });

  const forbidden = participationStatuses.flatMap((s) =>
    participationActions.flatMap((a) =>
      actors.filter((r) => !allowedMap.has(key(s, a, r))).map((r) => [s, a, r] as const),
    ),
  );

  it('проверены все комбинации', () => {
    expect(forbidden.length + allowed.length).toBe(
      participationStatuses.length * participationActions.length * actors.length,
    );
  });

  it.each(forbidden)('%s --%s (%s)--> запрещено', (from, action, actor) => {
    expect(transition(from, action, actor)).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
  });

  it('из финальных статусов выхода нет', () => {
    for (const s of ['rejected', 'declined', 'withdrawn', 'removed'] as const) {
      for (const a of participationActions) {
        for (const r of actors) expect(transition(s, a, r).ok).toBe(false);
      }
    }
  });
});

describe('замена из резерва', () => {
  it('срочно позванный резервист принимает сам', () => {
    expect(transition('reserve', 'accept', 'comedian', { urgent: true })).toEqual({
      ok: true,
      to: 'accepted',
    });
  });
  it('отказ от срочного вызова оставляет в резерве', () => {
    expect(transition('reserve', 'decline', 'comedian', { urgent: true })).toEqual({
      ok: true,
      to: 'reserve',
    });
  });
  it('без срочного вызова резервист сам в состав не попадает', () => {
    expect(transition('reserve', 'accept', 'comedian').ok).toBe(false);
    expect(transition('reserve', 'accept', 'comedian', { urgent: false }).ok).toBe(false);
  });
  it('urgent не открывает другие переходы', () => {
    expect(transition('pending', 'accept', 'comedian', { urgent: true }).ok).toBe(false);
  });
});

describe('статусы', () => {
  it('initialStatus по способу набора', () => {
    expect(initialStatus('invitation')).toBe('invited');
    expect(initialStatus('application')).toBe('pending');
    expect(initialStatus('link')).toBe('pending');
  });

  it('isActive', () => {
    expect(isActive('accepted')).toBe(true);
    expect(isActive('reserve')).toBe(true);
    expect(isActive('withdrawn')).toBe(false);
    expect(isActive('rejected')).toBe(false);
  });

  it('hasFreeSlot', () => {
    expect(hasFreeSlot(4, 5)).toBe(true);
    expect(hasFreeSlot(5, 5)).toBe(false);
    expect(hasFreeSlot(6, 5)).toBe(false);
  });
});

describe('позиции в составе', () => {
  it('compactPositions уплотняет позиции после выхода из accepted', () => {
    const changed = compactPositions([
      { id: 'a', status: 'accepted', position: 1 },
      { id: 'b', status: 'withdrawn', position: 2 },
      { id: 'c', status: 'accepted', position: 3 },
      { id: 'd', status: 'accepted', position: 4 },
    ]);
    expect(changed).toEqual([
      { id: 'b', status: 'withdrawn', position: null },
      { id: 'c', status: 'accepted', position: 2 },
      { id: 'd', status: 'accepted', position: 3 },
    ]);
  });

  it('compactPositions ставит accepted без позиции в конец', () => {
    const changed = compactPositions([
      { id: 'x', status: 'accepted', position: null },
      { id: 'y', status: 'accepted', position: 5 },
    ]);
    expect(changed).toEqual([
      { id: 'x', status: 'accepted', position: 2 },
      { id: 'y', status: 'accepted', position: 1 },
    ]);
  });

  it('compactPositions ничего не меняет в уплотнённом составе', () => {
    expect(
      compactPositions([
        { id: 'a', status: 'accepted', position: 1 },
        { id: 'r', status: 'reserve', position: null },
      ]),
    ).toEqual([]);
  });

  it('nextPosition', () => {
    expect(nextPosition([])).toBe(1);
    expect(
      nextPosition([
        { id: 'a', status: 'accepted', position: 2 },
        { id: 'b', status: 'reserve', position: 7 },
        { id: 'c', status: 'accepted', position: null },
      ]),
    ).toBe(3);
  });

  it('applyOrder принимает перестановку текущего состава', () => {
    const res = applyOrder(['a', 'b', 'c'], ['c', 'a', 'b']);
    expect(res.ok && [...res.positions]).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ]);
  });

  it.each([[['a', 'b']], [['a', 'b', 'c', 'd']], [['a', 'a', 'b']], [['a', 'b', 'x']]])(
    'applyOrder отклоняет %j',
    (order) => {
      expect(applyOrder(['a', 'b', 'c'], order).ok).toBe(false);
    },
  );
});
