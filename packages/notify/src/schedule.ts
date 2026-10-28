// Постановка уведомлений в scheduled_notifications (SPEC §7.1). Источник правды — таблица;
// worker забирает созревшие строки и отправляет. Все функции принимают `now` явно.
import {
  and,
  eq,
  inArray,
  sql,
  schema,
  type DbOrTx,
  type Event,
  type Participation,
} from '@standup/db';
import {
  computeSlotWindows,
  isActive,
  localDate,
  noticesForTransition,
  planDayNotifications,
  type NotificationKind,
  type ParticipationAction,
  type ParticipationActor,
} from '@standup/domain';

const { scheduledNotifications: sn, participations, events, eventStaff, users } = schema;

const NEW_APPLICATION_WINDOW_MS = 15 * 60_000;

export interface NotificationRow {
  userId: string;
  kind: NotificationKind;
  participationId?: string | null;
  eventId?: string | null;
  sendAt: Date;
  dedupeKey: string;
  payload?: Record<string, unknown>;
}

/**
 * Ставит уведомление. Повтор с тем же dedupe_key переносит ожидающее (или отменённое)
 * на новое время; уже отправленное не трогает.
 */
export async function upsertNotification(db: DbOrTx, row: NotificationRow) {
  await db
    .insert(sn)
    .values({ ...row, payload: row.payload ?? {}, status: 'pending' })
    .onConflictDoUpdate({
      target: sn.dedupeKey,
      set: {
        sendAt: sql`excluded.send_at`,
        payload: sql`excluded.payload`,
        status: 'pending',
        attempts: 0,
        lastError: null,
      },
      setWhere: sql`${sn.status} in ('pending', 'cancelled')`,
    });
}

/** Отменяет ожидающие уведомления по условию. */
async function cancelWhere(db: DbOrTx, where: ReturnType<typeof and>) {
  await db
    .update(sn)
    .set({ status: 'cancelled' })
    .where(and(inArray(sn.status, ['pending', 'queued']), where));
}

export function cancelForEvent(db: DbOrTx, eventId: string) {
  return cancelWhere(db, eq(sn.eventId, eventId));
}

/** Получатели «для события»: организатор и ведущие. */
async function eventStaffIds(db: DbOrTx, event: Pick<Event, 'id' | 'organizerId'>) {
  const staff = await db
    .select({ userId: eventStaff.userId })
    .from(eventStaff)
    .where(eq(eventStaff.eventId, event.id));
  return [
    event.organizerId,
    ...staff.map((s) => s.userId).filter((id) => id !== event.organizerId),
  ];
}

// --- День выступления ---

const perParticipationDayKinds: NotificationKind[] = ['unconfirmed_alert', 'pre_show_reminder'];

/**
 * Пересчитывает уведомления дня выступления для участия: отменяет ожидающие и ставит заново
 * по текущему времени события, позиции и настройкам комика.
 */
export async function rescheduleForParticipation(db: DbOrTx, participationId: string, now: Date) {
  await cancelWhere(
    db,
    and(eq(sn.participationId, participationId), inArray(sn.kind, perParticipationDayKinds)),
  );

  const [row] = await db
    .select({ p: participations, event: events, user: users })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .innerJoin(users, eq(users.id, participations.comedianId))
    .where(eq(participations.id, participationId));
  if (!row) return;
  const { p, event, user } = row;
  // Дайджест и повтор — на комика и день; лишние отсеет отправка (нет выступлений — не шлём).
  if (p.status !== 'accepted' || p.dayConfirmation === 'declined') return;
  if (event.status === 'cancelled' || event.status === 'finished' || event.status === 'draft')
    return;

  const lineup = await db
    .select({
      id: participations.id,
      position: participations.position,
      setMinutesOverride: participations.setMinutesOverride,
    })
    .from(participations)
    .where(and(eq(participations.eventId, event.id), eq(participations.status, 'accepted')));
  const stage = computeSlotWindows(event, lineup).get(p.id)!;
  const plan = planDayNotifications({
    eventStartsAt: event.startsAt,
    stageStartsAt: stage.start,
    timezone: user.timezone,
    digestTime: user.digestTime,
    preShowMinutes: user.preShowMinutes,
    now,
  });

  const staff = await eventStaffIds(db, event);
  for (const n of plan.notifications) {
    const base = { kind: n.kind, eventId: event.id, sendAt: n.sendAt };
    if (n.kind === 'day_digest' || n.kind === 'day_digest_repeat') {
      const key = `${n.kind}:${user.id}:${plan.date}`;
      const [existing] = await db.select().from(sn).where(eq(sn.dedupeKey, key));
      const covered = (existing?.payload.participationIds as string[] | undefined) ?? [];
      if (existing && existing.status === 'sent' && !covered.includes(p.id)) {
        // Приняли после отправки дайджеста — отдельный дайджест сразу (только основной).
        if (n.kind === 'day_digest') {
          await upsertNotification(db, {
            ...base,
            userId: user.id,
            participationId: p.id,
            dedupeKey: `${key}:${p.id}`,
            payload: { date: plan.date },
          });
        }
        continue;
      }
      await upsertNotification(db, {
        ...base,
        userId: user.id,
        participationId: existing?.participationId ?? p.id,
        dedupeKey: key,
        payload: { date: plan.date },
      });
    } else if (n.kind === 'unconfirmed_alert') {
      // Уже подтвердил — эскалировать нечего.
      if (p.dayConfirmation === 'confirmed') continue;
      for (const recipient of staff) {
        await upsertNotification(db, {
          ...base,
          userId: recipient,
          participationId: p.id,
          dedupeKey: `unconfirmed_alert:${recipient}:${p.id}`,
        });
      }
    } else {
      await upsertNotification(db, {
        ...base,
        userId: user.id,
        participationId: p.id,
        dedupeKey: `${n.kind}:${user.id}:${p.id}`,
      });
    }
  }
}

/** Пересчёт для всего состава (перенос события, смена порядка, длительностей). */
export async function rescheduleForEvent(db: DbOrTx, eventId: string, now: Date) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) return;
  if (event.status === 'cancelled') {
    await cancelForEvent(db, eventId);
    return;
  }
  const accepted = await db
    .select({ id: participations.id })
    .from(participations)
    .where(and(eq(participations.eventId, eventId), eq(participations.status, 'accepted')));
  for (const p of accepted) await rescheduleForParticipation(db, p.id, now);
}

/** Пересчёт будущих выступлений пользователя (сменил время дайджеста или напоминания). */
export async function rescheduleForUser(db: DbOrTx, userId: string, now: Date) {
  const rows = await db
    .select({ id: participations.id })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .where(
      and(
        eq(participations.comedianId, userId),
        eq(participations.status, 'accepted'),
        sql`${events.startsAt} > ${now.toISOString()}::timestamptz`,
      ),
    );
  for (const r of rows) await rescheduleForParticipation(db, r.id, now);
}

// --- Мгновенные уведомления ---

/** Уведомления по переходу участия + пересчёт его расписания. */
export async function notifyTransition(
  db: DbOrTx,
  t: {
    participation: Participation;
    event: Pick<Event, 'id' | 'organizerId'>;
    from: Participation['status'] | null;
    action: ParticipationAction | 'apply' | 'invite';
    actor: ParticipationActor;
    payload?: Record<string, unknown>;
  },
  now: Date,
) {
  const p = t.participation;
  for (const notice of noticesForTransition({
    from: t.from,
    to: p.status,
    action: t.action,
    actor: t.actor,
  })) {
    const recipients =
      notice.audience === 'comedian'
        ? [p.comedianId]
        : notice.audience === 'organizer'
          ? [t.event.organizerId]
          : await eventStaffIds(db, t.event);
    for (const userId of recipients) {
      if (notice.kind === 'new_application') {
        // Не чаще раза в 15 минут на событие: одна строка на окно, текст собирается при отправке.
        const bucket = Math.floor(now.getTime() / NEW_APPLICATION_WINDOW_MS);
        await db
          .insert(sn)
          .values({
            userId,
            kind: 'new_application',
            eventId: t.event.id,
            sendAt: now,
            dedupeKey: `new_application:${userId}:${t.event.id}:${bucket}`,
          })
          .onConflictDoNothing({ target: sn.dedupeKey });
        continue;
      }
      await upsertNotification(db, {
        userId,
        kind: notice.kind,
        participationId: p.id,
        eventId: t.event.id,
        sendAt: now,
        dedupeKey: `${notice.kind}:${userId}:${p.id}:${now.getTime()}`,
        payload: t.payload,
      });
    }
  }
  if (t.from === 'accepted' || p.status === 'accepted') {
    await rescheduleForParticipation(db, p.id, now);
  }
}

/** Комик нажал «Не смогу» (или подтвердил) в день выступления. */
export async function notifyDayConfirmation(
  db: DbOrTx,
  p: Participation,
  event: Pick<Event, 'id' | 'organizerId'>,
  now: Date,
) {
  if (p.dayConfirmation === 'declined') {
    for (const userId of await eventStaffIds(db, event)) {
      await upsertNotification(db, {
        userId,
        kind: 'withdrawal_alert',
        participationId: p.id,
        eventId: event.id,
        sendAt: now,
        dedupeKey: `withdrawal_alert:${userId}:${p.id}:day`,
      });
    }
  }
  await rescheduleForParticipation(db, p.id, now);
}

/** Активным участникам события: изменилось время/площадка или событие отменено. */
export async function notifyEventParticipants(
  db: DbOrTx,
  event: Pick<Event, 'id'>,
  kind: 'event_changed' | 'event_cancelled',
  now: Date,
) {
  const rows = await db.select().from(participations).where(eq(participations.eventId, event.id));
  for (const p of rows.filter((x) => isActive(x.status))) {
    await upsertNotification(db, {
      userId: p.comedianId,
      kind,
      participationId: p.id,
      eventId: event.id,
      sendAt: now,
      dedupeKey: `${kind}:${p.comedianId}:${event.id}:${now.getTime()}`,
    });
  }
  if (kind === 'event_cancelled') await cancelForEvent(db, event.id);
}

/** Тем, у кого сменился номер в составе. */
export async function notifyPositionChanges(
  db: DbOrTx,
  eventId: string,
  changed: Array<Pick<Participation, 'id' | 'comedianId'>>,
  now: Date,
) {
  for (const p of changed) {
    await upsertNotification(db, {
      userId: p.comedianId,
      kind: 'lineup_position_changed',
      participationId: p.id,
      eventId,
      // Серия перестановок — одно сообщение через минуту с итоговым номером (не чаще раза в 5 минут).
      sendAt: new Date(now.getTime() + 60_000),
      dedupeKey: `lineup_position_changed:${p.comedianId}:${p.id}:${Math.floor(now.getTime() / 300_000)}`,
    });
  }
}

/** Срочный вызов на замену и рассылка — отправляются как обычные уведомления. */
export async function enqueueNow(
  db: DbOrTx,
  rows: Omit<NotificationRow, 'sendAt' | 'dedupeKey'>[],
  now: Date,
) {
  for (const r of rows) {
    await upsertNotification(db, {
      ...r,
      sendAt: now,
      dedupeKey: `${r.kind}:${r.userId}:${r.participationId ?? r.eventId}:${now.getTime()}`,
    });
  }
}

/** Дата выступления по таймзоне пользователя — для /today. */
export function todayFor(timezone: string, now: Date) {
  return localDate(now, timezone);
}
