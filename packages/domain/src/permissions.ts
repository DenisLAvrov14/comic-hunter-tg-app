// Права (SPEC §5). can() — единственная точка проверки; API вызывает её на каждом эндпоинте.
import { isActive, type ParticipationStatus } from './participation';

export const hostPermissionFlags = [
  'can_reorder',
  'can_mark_attendance',
  'can_call_reserve',
  'can_notify_lineup',
] as const;
export type HostPermissionFlag = (typeof hostPermissionFlags)[number];

/**
 * Флаги ведущего. Record, а не фиксированный набор полей: права клубов и менеджеров
 * (вне MVP) добавятся новыми ключами без изменения логики.
 */
export type StaffPermissions = Partial<Record<string, boolean>>;

export type EventStatus = 'draft' | 'recruiting' | 'lineup_locked' | 'finished' | 'cancelled';

export const eventActions = [
  'event.view',
  'event.apply',
  'invitation.respond',
  'applications.manage',
  'comedians.invite',
  'lineup.reorder',
  'attendance.mark',
  'reserve.call',
  'lineup.notify',
  'event.edit',
  'staff.assign',
] as const;
export type EventAction = (typeof eventActions)[number];

export interface EventResource {
  event: { organizerId: string; status: EventStatus; recruitmentOpen: boolean };
  /** Запись ведущего, если пользователь в штате события. */
  staff?: { permissions: StaffPermissions } | null;
  /** Участие этого пользователя в событии, если есть. */
  participation?: { status: ParticipationStatus } | null;
  /** Пользователь пришёл по действующей ссылке набора. */
  viaLink?: boolean;
}

export interface Subject {
  userId: string;
}

const organizerOnly: readonly EventAction[] = [
  'applications.manage',
  'comedians.invite',
  'event.edit',
  'staff.assign',
];

const hostFlagFor: Partial<Record<EventAction, HostPermissionFlag>> = {
  'lineup.reorder': 'can_reorder',
  'attendance.mark': 'can_mark_attendance',
  'reserve.call': 'can_call_reserve',
  'lineup.notify': 'can_notify_lineup',
};

export function can(user: Subject, action: EventAction, r: EventResource): boolean {
  const isOrganizer = r.event.organizerId === user.userId;
  const isStaff = !!r.staff;
  const ownActive = !!r.participation && isActive(r.participation.status);

  switch (action) {
    case 'event.view':
      if (isOrganizer || isStaff || r.participation) return true;
      // Черновик видят только организатор и штат.
      if (r.event.status === 'draft') return false;
      return r.event.recruitmentOpen || !!r.viaLink;

    case 'event.apply':
      return (
        !isOrganizer &&
        !ownActive &&
        r.event.status === 'recruiting' &&
        (r.event.recruitmentOpen || !!r.viaLink)
      );

    case 'invitation.respond':
      return r.participation?.status === 'invited';

    default: {
      if (isOrganizer) return true;
      if (organizerOnly.includes(action)) return false;
      const flag = hostFlagFor[action];
      return !!flag && r.staff?.permissions[flag] === true;
    }
  }
}

/** Права ведущего по умолчанию при назначении. */
export function defaultHostPermissions(): Record<HostPermissionFlag, boolean> {
  return {
    can_reorder: false,
    can_mark_attendance: true,
    can_call_reserve: false,
    can_notify_lineup: false,
  };
}
