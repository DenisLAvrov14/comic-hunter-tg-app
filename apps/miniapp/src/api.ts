import type {
  ApiErrorBody,
  AuthConfigResponse,
  AuthResponse,
  City,
  ComedianBrief,
  ComedianCard,
  ComedianProfileInput,
  ComediansQuery,
  DevAuthRequest,
  ErrorCode,
  EventDetails,
  EventFormat,
  EventInput,
  EventPatch,
  EventSummary,
  Inbox,
  InvitationsResponse,
  Lineup,
  Me,
  MyParticipation,
  ParticipationActionRequest,
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

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
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
};

function query(params: object): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  return q.toString();
}
