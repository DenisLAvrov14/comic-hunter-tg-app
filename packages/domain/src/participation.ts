// Статусы участия и разрешённые переходы (SPEC §4). Всё остальное вызывает transition().

export const participationStatuses = [
  'pending',
  'invited',
  'counter_proposed',
  'accepted',
  'reserve',
  'rejected',
  'declined',
  'withdrawn',
  'removed',
] as const;
export type ParticipationStatus = (typeof participationStatuses)[number];

export const participationActions = [
  'accept',
  'reject',
  'reserve',
  'promote',
  'remove',
  'withdraw',
  'decline',
  'counter_propose',
] as const;
export type ParticipationAction = (typeof participationActions)[number];

/** Кто совершает действие над участием: сам комик или сторона события (организатор). */
export type ParticipationActor = 'comedian' | 'organizer';

export type ParticipationSource = 'application' | 'link' | 'invitation';

export const activeStatuses: readonly ParticipationStatus[] = [
  'pending',
  'invited',
  'counter_proposed',
  'accepted',
  'reserve',
];

export function isActive(status: ParticipationStatus): boolean {
  return activeStatuses.includes(status);
}

interface Rule {
  from: readonly ParticipationStatus[];
  action: ParticipationAction;
  actor: ParticipationActor;
  to: ParticipationStatus;
  /** Только для срочного вызова на замену (is_urgent). */
  urgentOnly?: boolean;
}

/** Единственная таблица разрешённых переходов. */
export const TRANSITIONS: readonly Rule[] = [
  // Заявки и запись по ссылке — решает организатор.
  { from: ['pending'], action: 'accept', actor: 'organizer', to: 'accepted' },
  { from: ['pending'], action: 'reject', actor: 'organizer', to: 'rejected' },
  { from: ['pending', 'accepted'], action: 'reserve', actor: 'organizer', to: 'reserve' },
  { from: ['reserve'], action: 'promote', actor: 'organizer', to: 'accepted' },
  // Замена: резервист, которого позвали срочно, соглашается сам; отказ оставляет его в резерве.
  { from: ['reserve'], action: 'accept', actor: 'comedian', to: 'accepted', urgentOnly: true },
  { from: ['reserve'], action: 'decline', actor: 'comedian', to: 'reserve', urgentOnly: true },
  // Приглашения — решает комик.
  { from: ['invited'], action: 'accept', actor: 'comedian', to: 'accepted' },
  { from: ['invited'], action: 'decline', actor: 'comedian', to: 'declined' },
  { from: ['invited'], action: 'counter_propose', actor: 'comedian', to: 'counter_proposed' },
  // Встречное предложение — решает организатор.
  { from: ['counter_proposed'], action: 'accept', actor: 'organizer', to: 'accepted' },
  { from: ['counter_proposed'], action: 'reject', actor: 'organizer', to: 'declined' },
  // Из любого активного.
  { from: activeStatuses, action: 'withdraw', actor: 'comedian', to: 'withdrawn' },
  { from: activeStatuses, action: 'remove', actor: 'organizer', to: 'removed' },
];

export type TransitionResult =
  { ok: true; to: ParticipationStatus } | { ok: false; error: 'INVALID_TRANSITION' };

export function transition(
  current: ParticipationStatus,
  action: ParticipationAction,
  actor: ParticipationActor,
  ctx: { urgent?: boolean } = {},
): TransitionResult {
  const rule = TRANSITIONS.find(
    (r) =>
      r.action === action &&
      r.actor === actor &&
      r.from.includes(current) &&
      (!r.urgentOnly || ctx.urgent === true),
  );
  return rule ? { ok: true, to: rule.to } : { ok: false, error: 'INVALID_TRANSITION' };
}

/** Начальный статус по способу набора. */
export function initialStatus(source: ParticipationSource): ParticipationStatus {
  return source === 'invitation' ? 'invited' : 'pending';
}

// --- Позиции в составе ---

export interface Positioned {
  id: string;
  status: ParticipationStatus;
  position: number | null;
}

/** Есть ли свободное место в составе. */
export function hasFreeSlot(acceptedCount: number, slotsCount: number): boolean {
  return acceptedCount < slotsCount;
}

/**
 * Перенумеровывает accepted-участия подряд с 1, сохраняя относительный порядок
 * (без позиции — в конец). У остальных статусов позиция сбрасывается в null.
 * Возвращает только изменившиеся записи.
 */
export function compactPositions<T extends Positioned>(items: readonly T[]): Array<T> {
  const accepted = items
    .filter((p) => p.status === 'accepted')
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  const next = new Map<string, number | null>();
  accepted.forEach((p, i) => next.set(p.id, i + 1));
  for (const p of items) if (p.status !== 'accepted') next.set(p.id, null);
  return items
    .filter((p) => next.get(p.id) !== p.position)
    .map((p) => ({ ...p, position: next.get(p.id)! }));
}

/** Позиция для нового участника состава — в конец. */
export function nextPosition(items: readonly Positioned[]): number {
  return (
    items.reduce((max, p) => (p.status === 'accepted' ? Math.max(max, p.position ?? 0) : max), 0) +
    1
  );
}

export type ReorderResult = { ok: true; positions: Map<string, number> } | { ok: false };

/** Новый порядок валиден, только если это перестановка ровно текущего состава. */
export function applyOrder(
  acceptedIds: readonly string[],
  order: readonly string[],
): ReorderResult {
  const current = new Set(acceptedIds);
  const unique = new Set(order);
  if (unique.size !== order.length || unique.size !== current.size) return { ok: false };
  for (const id of order) if (!current.has(id)) return { ok: false };
  return { ok: true, positions: new Map(order.map((id, i) => [id, i + 1])) };
}
