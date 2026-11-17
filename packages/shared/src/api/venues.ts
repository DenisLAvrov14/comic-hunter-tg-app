import { z } from 'zod';
import { EventFormat } from './events';
import { Venue } from './profiles';

/** Событие в афише площадки. */
export const AfishaEvent = z.object({
  id: z.string().uuid(),
  title: z.string(),
  format: EventFormat,
  startsAt: z.string(),
});
export type AfishaEvent = z.infer<typeof AfishaEvent>;

/** Площадка в списке: кто добавил (чтобы связаться) и ближайшие события. */
export const VenueListItem = Venue.extend({
  /** null — площадка из каталога или автор удалил аккаунт. */
  owner: z
    .object({
      name: z.string(),
      telegramUsername: z.string().nullable(),
      contact: z.string().nullable(),
    })
    .nullable(),
  afisha: z.object({ total: z.number().int(), items: z.array(AfishaEvent) }),
});
export type VenueListItem = z.infer<typeof VenueListItem>;
