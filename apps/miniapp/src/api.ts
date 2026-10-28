import type {
  ApiErrorBody,
  AuthConfigResponse,
  AuthResponse,
  AutoAcceptRule,
  AutoAcceptRuleInput,
  BusySlotInput,
  CalendarBusy,
  CalendarFeed,
  CalendarResponse,
  BroadcastResponse,
  City,
  ComedianBrief,
  ComedianCard,
  ComedianProfileInput,
  ComediansQuery,
  DevAuthRequest,
  ErrorCode,
  EventDetails,
  EventPost,
  EventFormat,
  EventInput,
  EventPatch,
  EventSummary,
  HostCandidate,
  Inbox,
  InvitationsResponse,
  Lineup,
  Me,
  MyParticipation,
  OrganizerCandidate,
  ParticipationActionRequest,
  PublishPostsResponse,
  StaffPermissionsRequest,
  TelegramChatView,
  OrganizerProfileInput,
  PatchMeRequest,
  Photo,
  UserRole,
  Venue,
  VenueInput,
} from '@standup/shared';
import { ru } from '@standup/shared';

const BASE = '/api/v1';
let token: string | null = null;

export function setToken(value: string | null) {
  token = value;
}

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    // Нет сети или сервер недоступен — понятное сообщение вместо «Failed to fetch».
    throw new ApiRequestError(0, 'INTERNAL', ru.errors.NETWORK);
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as ApiErrorBody | null;
    const code = err?.error.code ?? 'INTERNAL';
    throw new ApiRequestError(
      res.status,
      code,
      err?.error.message ?? ru.errors[code],
      err?.error.details,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  authConfig: () => request<AuthConfigResponse>('GET', '/auth/config'),
  authTelegram: (initData: string) => request<AuthResponse>('POST', '/auth/telegram', { initData }),
  authDev: (body: DevAuthRequest) => request<AuthResponse>('POST', '/auth/dev', body),
  me: () => request<Me>('GET', '/me'),
  patchMe: (body: PatchMeRequest) => request<Me>('PATCH', '/me', body),
  putRoles: (roles: UserRole[]) => request<Me>('PUT', '/me/roles', { roles }),
  putComedianProfile: (body: ComedianProfileInput) =>
    request<Me>('PUT', '/me/comedian-profile', body),
  putOrganizerProfile: (body: OrganizerProfileInput) =>
    request<Me>('PUT', '/me/organizer-profile', body),
  uploadPhoto: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<Photo>('POST', '/me/photos', form);
  },
  deletePhoto: (id: string) => request<void>('DELETE', `/me/photos/${id}`),
  cities: () => request<City[]>('GET', '/cities'),
  venues: (cityId: number) => request<Venue[]>('GET', `/venues?city=${cityId}`),
  createVenue: (body: VenueInput) => request<Venue>('POST', '/venues', body),

  openEvents: (q: { city: number; from?: string; format?: EventFormat }) =>
    request<EventSummary[]>('GET', `/events?${query(q)}`),
  myEvents: (when: 'upcoming' | 'past') =>
    request<EventSummary[]>('GET', `/me/events?when=${when}`),
  event: (id: string) => request<EventDetails>('GET', `/events/${id}`),
  eventByLink: (token: string) =>
    request<EventDetails>('GET', `/events/by-link/${encodeURIComponent(token)}`),
  createEvent: (body: EventInput) => request<EventDetails>('POST', '/events', body),
  updateEvent: (id: string, body: EventPatch) =>
    request<EventDetails>('PATCH', `/events/${id}`, body),
  cancelEvent: (id: string) => request<EventDetails>('POST', `/events/${id}/cancel`, {}),
  duplicateEvent: (id: string) => request<EventDetails>('POST', `/events/${id}/duplicate`, {}),
  rotateLink: (id: string) => request<EventDetails>('POST', `/events/${id}/link/rotate`, {}),
  apply: (id: string, body: { token?: string; message?: string }) =>
    request<MyParticipation>('POST', `/events/${id}/applications`, body),
  invite: (id: string, comedianIds: string[]) =>
    request<InvitationsResponse>('POST', `/events/${id}/invitations`, { comedianIds }),
  lineup: (id: string) => request<Lineup>('GET', `/events/${id}/lineup`),
  participationAction: (id: string, body: ParticipationActionRequest) =>
    request<MyParticipation>('POST', `/participations/${id}/actions`, body),
  inbox: () => request<Inbox>('GET', '/me/inbox'),
  comedians: (q: ComediansQuery) =>
    request<Array<ComedianBrief & { cityId: number }>>('GET', `/comedians?${query(q)}`),
  comedian: (id: string) => request<ComedianCard>('GET', `/comedians/${id}`),

  reorder: (id: string, order: string[], version: number) =>
    request<Lineup>('PATCH', `/events/${id}/lineup/order`, { order, version }),
  attendance: (participationId: string, value: 'unknown' | 'present' | 'absent') =>
    request<MyParticipation>('POST', `/participations/${participationId}/attendance`, { value }),
  replacement: (id: string, participationId: string, reserveIds: string[]) =>
    request<Lineup>('POST', `/events/${id}/replacement`, { participationId, reserveIds }),
  broadcast: (id: string, text: string) =>
    request<BroadcastResponse>('POST', `/events/${id}/broadcast`, { text }),
  dayConfirmation: (participationId: string, value: 'confirmed' | 'declined') =>
    request<MyParticipation>('POST', `/participations/${participationId}/day-confirmation`, {
      value,
    }),
  posterText: (id: string) => request<{ text: string }>('GET', `/events/${id}/poster-text`),
  hosts: (q: string) => request<HostCandidate[]>('GET', `/hosts?${query({ q })}`),
  putStaff: (id: string, userId: string, permissions: StaffPermissionsRequest['permissions']) =>
    request<Lineup>('PUT', `/events/${id}/staff/${userId}`, { permissions }),
  deleteStaff: (id: string, userId: string) =>
    request<Lineup>('DELETE', `/events/${id}/staff/${userId}`),
  hosting: () => request<EventSummary[]>('GET', '/me/hosting'),

  calendar: (from: string, to: string) =>
    request<CalendarResponse>('GET', `/me/calendar?${query({ from, to })}`),
  addBusy: (body: BusySlotInput) => request<CalendarBusy>('POST', '/me/busy-slots', body),
  deleteBusy: (id: string) => request<void>('DELETE', `/me/busy-slots/${id}`),
  rules: () => request<AutoAcceptRule[]>('GET', '/me/auto-accept-rules'),
  putRule: (organizerId: string, body: AutoAcceptRuleInput) =>
    request<AutoAcceptRule[]>('PUT', `/me/auto-accept-rules/${organizerId}`, body),
  deleteRule: (organizerId: string) =>
    request<AutoAcceptRule[]>('DELETE', `/me/auto-accept-rules/${organizerId}`),
  organizers: (q: string) => request<OrganizerCandidate[]>('GET', `/organizers?${query({ q })}`),
  calendarFeed: () => request<CalendarFeed>('GET', '/me/calendar-feed'),
  rotateCalendarFeed: () => request<CalendarFeed>('POST', '/me/calendar-feed/rotate', {}),
  myChats: () => request<TelegramChatView[]>('GET', '/me/chats'),
  eventPosts: (id: string) => request<EventPost[]>('GET', `/events/${id}/posts`),
  publishPosts: (id: string, chatIds: string[]) =>
    request<PublishPostsResponse>('POST', `/events/${id}/posts`, { chatIds }),
};

function query(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  return q.toString();
}
