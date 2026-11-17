import type { FastifyPluginAsync } from 'fastify';
import {
  countVenueEvents,
  deletePendingVenue,
  findUserById,
  findVenue,
  listAdmins,
  listPendingVenues,
  searchUsers,
  setAdminRights,
  setVenueReview,
  type Db,
  type PersonRow,
} from '@standup/db';
import {
  adminChangeError,
  adminGrantNotice,
  applyAdminChange,
  reviewVenue,
  type AdminChange,
  type VenueReviewAction,
} from '@standup/domain';
import {
  AdminUserParams,
  AdminUsersQuery,
  RejectVenueRequest,
  type AdminPerson,
  type PendingVenue,
  type VenueReviewResult,
} from '@standup/shared';
import { upsertNotification } from '@standup/notify';
import { z } from 'zod';
import { ApiError } from '../errors';
import type { Config } from '../config';
import type { FileStorage } from '../storage';
import { toVenue } from './reference';

const VenueParams = z.object({ id: z.string().uuid() });

const changeErrors = {
  forbidden: 'Назначать админов может только админ с этим правом',
  self: 'Свои права менять нельзя — попросите другого админа',
  owner: 'Права главного админа задаются в настройках сервера',
} as const;

/** Админка: проверка площадок и назначение админов. Только для админов. */
export const adminRoutes: FastifyPluginAsync<{
  db: Db;
  storage: FileStorage;
  config: Pick<Config, 'adminTelegramIds'>;
}> = async (app, { db, storage, config }) => {
  const isOwner = (telegramId: number) => config.adminTelegramIds.includes(telegramId);

  function toPerson(p: PersonRow): AdminPerson {
    const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
    return {
      id: p.id,
      name: p.displayName ?? fullName,
      telegramUsername: p.telegramUsername,
      contact: p.contact,
      isAdmin: p.isAdmin,
      canManageAdmins: p.isAdmin && p.canManageAdmins,
      isOwner: isOwner(p.telegramId),
    };
  }

  app.addHook('onRequest', app.authenticate);
  app.addHook('preHandler', async (req) => {
    const user = await findUserById(db, req.user.sub);
    // Не админ — 404: раздел не должен светиться.
    if (!user?.isAdmin) throw new ApiError('NOT_FOUND');
  });

  app.get('/admin/venues', async (req): Promise<PendingVenue[]> =>
    (await listPendingVenues(db)).map((r) => ({
      venue: toVenue(storage, r.venue, req.user.sub),
      cityName: r.cityName,
      author: r.author ? toPerson(r.author) : null,
      createdAt: r.venue.createdAt.toISOString(),
    })),
  );

  async function review(
    adminId: string,
    venueId: string,
    action: VenueReviewAction,
    reason: string | null,
  ): Promise<VenueReviewResult> {
    const now = new Date();
    const { outcome, venue } = await db.transaction(async (tx) => {
      const venue = await findVenue(tx, venueId);
      if (!venue) throw new ApiError('NOT_FOUND');
      const outcome = reviewVenue(venue.status, action, await countVenueEvents(tx, venueId));
      if (outcome.kind === 'error') {
        throw new ApiError('INVALID_TRANSITION', 'Площадку уже проверили');
      }
      // Условие status = pending в запросах: второй админ одновременно не проверит ту же площадку.
      const done =
        outcome.kind === 'deleted'
          ? await deletePendingVenue(tx, venueId)
          : await setVenueReview(tx, venueId, {
              status: outcome.kind,
              reviewedBy: adminId,
              reviewedAt: now,
              rejectReason: outcome.kind === 'rejected' ? reason : null,
            });
      if (!done) throw new ApiError('INVALID_TRANSITION', 'Площадку уже проверили');
      if (venue.createdBy && venue.createdBy !== adminId) {
        await upsertNotification(tx, {
          userId: venue.createdBy,
          kind: outcome.kind === 'approved' ? 'venue_approved' : 'venue_rejected',
          sendAt: now,
          dedupeKey: `venue_review:${venue.id}`,
          payload: { name: venue.name, reason, hidden: outcome.kind === 'rejected' },
        });
      }
      return { outcome, venue };
    });
    if (outcome.kind === 'deleted') {
      const keys = [venue.logoS3Key, venue.photoS3Key, venue.photoPreviewS3Key];
      const existing = keys.filter((k): k is string => !!k);
      if (existing.length) await storage.delete(existing).catch(() => {});
    }
    return { result: outcome.kind };
  }

  app.post('/admin/venues/:id/approve', async (req) => {
    const { id } = VenueParams.parse(req.params);
    return review(req.user.sub, id, 'approve', null);
  });

  app.post('/admin/venues/:id/reject', async (req) => {
    const { id } = VenueParams.parse(req.params);
    const { reason } = RejectVenueRequest.parse(req.body ?? {});
    return review(req.user.sub, id, 'reject', reason || null);
  });

  app.get('/admin/admins', async (): Promise<AdminPerson[]> =>
    (await listAdmins(db)).map(toPerson),
  );

  app.get('/admin/users', async (req): Promise<AdminPerson[]> => {
    const { q } = AdminUsersQuery.parse(req.query);
    return (await searchUsers(db, q)).map(toPerson);
  });

  /** Меняет права админа; о новых правах человеку приходит сообщение в боте. */
  async function changeAdmin(actorId: string, targetId: string, change: AdminChange) {
    await db.transaction(async (tx) => {
      const actor = await findUserById(tx, actorId);
      const target = await findUserById(tx, targetId);
      if (!actor || !target || target.deletedAt) throw new ApiError('NOT_FOUND');
      const before = {
        isAdmin: target.isAdmin,
        canManageAdmins: target.isAdmin && target.canManageAdmins,
      };
      const error = adminChangeError(
        actor,
        { id: target.id, ...before, isOwner: isOwner(target.telegramId) },
        change,
      );
      if (error === 'not_admin') throw new ApiError('NOT_FOUND');
      if (error === 'forbidden') throw new ApiError('FORBIDDEN', changeErrors.forbidden);
      if (error) throw new ApiError('INVALID_TRANSITION', changeErrors[error]);
      const after = applyAdminChange(before, change);
      await setAdminRights(tx, target.id, after);
      const notice = adminGrantNotice(before, after);
      if (notice) {
        const now = new Date();
        await upsertNotification(tx, {
          userId: target.id,
          kind: 'admin_granted',
          sendAt: now,
          dedupeKey: `admin_granted:${target.id}:${now.getTime()}`,
          payload: { canManageAdmins: notice.canManageAdmins },
        });
      }
    });
  }

  const routes: Array<['put' | 'delete', string, AdminChange]> = [
    ['put', '/admin/admins/:id', 'grant'],
    ['delete', '/admin/admins/:id', 'revoke'],
    ['put', '/admin/admins/:id/manage', 'grant_manage'],
    ['delete', '/admin/admins/:id/manage', 'revoke_manage'],
  ];
  for (const [method, url, change] of routes) {
    app[method](url, async (req, reply) => {
      const { id } = AdminUserParams.parse(req.params);
      await changeAdmin(req.user.sub, id, change);
      return reply.status(204).send();
    });
  }
};
