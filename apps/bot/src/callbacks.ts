// callback_data кнопок в уведомлениях (собираются в packages/notify/render.ts).
// Лимит Telegram — 64 байта: «iv:<uuid>:a» — 41.

export type Callback =
  /** Подтверждение участия в день выступления. */
  | { kind: 'day'; participationId: string; value: 'confirmed' | 'declined' }
  /** Ответ на приглашение или срочный вызов на замену. */
  | { kind: 'invite'; participationId: string; action: 'accept' | 'decline' }
  /** «Позвать резерв» на место участника. */
  | { kind: 'reserve'; participationId: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const DAY = new RegExp(`^dc:(${UUID}):([yn])$`);
const INVITE = new RegExp(`^iv:(${UUID}):([ad])$`);
const RESERVE = new RegExp(`^rr:(${UUID})$`);

export function parseCallback(data: string | undefined): Callback | null {
  if (!data) return null;
  let m = DAY.exec(data);
  if (m)
    return { kind: 'day', participationId: m[1]!, value: m[2] === 'y' ? 'confirmed' : 'declined' };
  m = INVITE.exec(data);
  if (m)
    return { kind: 'invite', participationId: m[1]!, action: m[2] === 'a' ? 'accept' : 'decline' };
  m = RESERVE.exec(data);
  if (m) return { kind: 'reserve', participationId: m[1]! };
  return null;
}

/** Запрос к API от имени пользователя для этой кнопки. */
export function apiRequestFor(cb: Callback): { method: 'POST'; path: string; payload?: object } {
  switch (cb.kind) {
    case 'day':
      return {
        method: 'POST',
        path: `/participations/${cb.participationId}/day-confirmation`,
        payload: { value: cb.value },
      };
    case 'invite':
      return {
        method: 'POST',
        path: `/participations/${cb.participationId}/actions`,
        payload: { action: cb.action },
      };
    case 'reserve':
      return { method: 'POST', path: `/participations/${cb.participationId}/call-reserve` };
  }
}
