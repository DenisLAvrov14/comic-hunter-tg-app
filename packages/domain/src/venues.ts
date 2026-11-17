// Проверка площадок и права админов. Чистые функции: всё нужное передаётся параметрами.

export const venueStatuses = ['pending', 'approved', 'rejected'] as const;
export type VenueStatus = (typeof venueStatuses)[number];

export interface VenueAccess {
  status: VenueStatus;
  /** Кто добавил; null — автор удалил аккаунт. */
  createdBy: string | null;
}

const isAuthor = (userId: string, v: VenueAccess) => v.createdBy !== null && v.createdBy === userId;

/**
 * Видна ли площадка в списках. Проверенная — всем; на проверке и отклонённая — только
 * автору (у отклонённой он видит причину).
 */
export function canSeeVenue(userId: string, v: VenueAccess): boolean {
  return v.status === 'approved' || isAuthor(userId, v);
}

/**
 * Можно ли поставить площадку в событие. Проверенную — всем, на проверке — только автору.
 * Отклонённую — никому, кроме события, где она уже стоит (`current`): старые события
 * не ломаются.
 */
export function canUseVenue(userId: string, v: VenueAccess, current = false): boolean {
  if (current) return true;
  return v.status === 'approved' || (v.status === 'pending' && isAuthor(userId, v));
}

export type VenueReviewAction = 'approve' | 'reject';

export type VenueReviewOutcome =
  | { kind: 'approved' }
  /** Событий на площадке нет — удаляется совсем. */
  | { kind: 'deleted' }
  /** На площадке есть события — скрывается, события остаются. */
  | { kind: 'rejected' }
  | { kind: 'error'; reason: 'not_pending' };

/** Итог проверки площадки админом. */
export function reviewVenue(
  status: VenueStatus,
  action: VenueReviewAction,
  eventsCount: number,
): VenueReviewOutcome {
  if (status !== 'pending') return { kind: 'error', reason: 'not_pending' };
  if (action === 'approve') return { kind: 'approved' };
  return eventsCount > 0 ? { kind: 'rejected' } : { kind: 'deleted' };
}

export interface AdminRights {
  isAdmin: boolean;
  /** Может назначать и снимать админов и давать это право другим. */
  canManageAdmins: boolean;
}

export interface AdminActor extends AdminRights {
  id: string;
}

export interface AdminTarget extends AdminRights {
  id: string;
  /** Главный админ из `ADMIN_TELEGRAM_IDS`: права ему возвращаются при каждом входе. */
  isOwner: boolean;
}

/**
 * grant — сделать админом; revoke — снять (вместе с правом назначать);
 * grant_manage / revoke_manage — дать или забрать право назначать админов.
 */
export type AdminChange = 'grant' | 'revoke' | 'grant_manage' | 'revoke_manage';
export type AdminChangeError = 'forbidden' | 'self' | 'owner' | 'not_admin';

/**
 * Можно ли поменять права админа. Менять может только админ с правом назначать.
 * Свои права менять нельзя — так всегда остаётся хотя бы один, кто назначает.
 * Главных (из настройки) не трогают: настройка всё равно вернёт им права.
 */
export function adminChangeError(
  actor: AdminActor,
  target: AdminTarget,
  change: AdminChange,
): AdminChangeError | null {
  if (!actor.isAdmin || !actor.canManageAdmins) return 'forbidden';
  if (target.id === actor.id) return 'self';
  if (target.isOwner) return 'owner';
  if ((change === 'revoke' || change === 'revoke_manage') && !target.isAdmin) return 'not_admin';
  return null;
}

/** Права после изменения. Право назначать бывает только у админа. */
export function applyAdminChange(target: AdminRights, change: AdminChange): AdminRights {
  switch (change) {
    case 'grant':
      return { isAdmin: true, canManageAdmins: target.isAdmin && target.canManageAdmins };
    case 'revoke':
      return { isAdmin: false, canManageAdmins: false };
    case 'grant_manage':
      return { isAdmin: true, canManageAdmins: true };
    case 'revoke_manage':
      return { isAdmin: target.isAdmin, canManageAdmins: false };
  }
}

/**
 * Сообщить ли человеку о новых правах: стал админом или получил право назначать.
 * Возвращает права, о которых сообщить, или null.
 */
export function adminGrantNotice(before: AdminRights, after: AdminRights): AdminRights | null {
  const becameAdmin = after.isAdmin && !before.isAdmin;
  const becameManager = after.canManageAdmins && !before.canManageAdmins;
  return becameAdmin || becameManager ? after : null;
}

/** Telegram ID первых админов из настройки `ADMIN_TELEGRAM_IDS` («123, 456»). */
export function parseAdminTelegramIds(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((part) => {
      const id = Number(part);
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error(`ADMIN_TELEGRAM_IDS: «${part}» — не Telegram ID`);
      }
      return id;
    });
}

/** Сколько ближайших событий отдавать в афишу карточки (лента листается вбок). */
export const AFISHA_SIZE = 50;

export interface Afisha<T> {
  /** Всего предстоящих событий на площадке. */
  total: number;
  /** Ближайшие — по времени начала. */
  items: T[];
}

/**
 * Афиша площадок: ближайшие события каждой площадки и их общее число.
 * На вход — уже отобранные предстоящие публичные события.
 */
export function groupAfisha<T extends { venueId: string; startsAt: Date }>(
  events: readonly T[],
  size = AFISHA_SIZE,
): Map<string, Afisha<T>> {
  const sorted = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const result = new Map<string, Afisha<T>>();
  for (const e of sorted) {
    const afisha = result.get(e.venueId) ?? { total: 0, items: [] };
    afisha.total += 1;
    if (afisha.items.length < size) afisha.items.push(e);
    result.set(e.venueId, afisha);
  }
  return result;
}
