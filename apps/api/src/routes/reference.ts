import type { FastifyPluginAsync } from 'fastify';
import {
  createVenue,
  findCity,
  getUserRoles,
  listCities,
  listVenuesByCity,
  type Db,
  type Venue as VenueRow,
} from '@standup/db';
import { VenueInput, VenuesQuery, type City, type Venue } from '@standup/shared';
import { ApiError } from '../errors';

function toVenue(v: VenueRow): Venue {
  return { id: v.id, name: v.name, address: v.address, cityId: v.cityId, timezone: v.timezone };
}

export const referenceRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/cities', async (): Promise<City[]> => listCities(db));

  app.get('/venues', async (req): Promise<Venue[]> => {
    const { city } = VenuesQuery.parse(req.query);
    return (await listVenuesByCity(db, city)).map(toVenue);
  });

  app.post('/venues', async (req, reply): Promise<Venue> => {
    const body = VenueInput.parse(req.body);
    // Роль пользователя, а не право на событие — can() здесь не нужен.
    const roles = await getUserRoles(db, req.user.sub);
    if (!roles.includes('organizer')) throw new ApiError('FORBIDDEN');
    const city = await findCity(db, body.cityId);
    if (!city) throw new ApiError('VALIDATION', 'Город не найден', { field: 'cityId' });
    const venue = await createVenue(db, {
      ...body,
      timezone: city.timezone,
      createdBy: req.user.sub,
    });
    reply.status(201);
    return toVenue(venue);
  });
};
