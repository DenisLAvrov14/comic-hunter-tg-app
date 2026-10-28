import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { findEvent, listEventPosts, listUserChats, type Db } from '@standup/db';
import { can } from '@standup/domain';
import { publishEventPosts, type ChatPoster, type LinkConfig } from '@standup/notify';
import type { EventPost, PublishPostsResponse, TelegramChatView } from '@standup/shared';
import { ApiError } from '../errors';
import { eventResource } from '../services/events';

const IdParams = z.object({ id: z.string().uuid() });
const PublishRequest = z.object({ chatIds: z.array(z.string().uuid()).min(1).max(20) });

export const postRoutes: FastifyPluginAsync<{
  db: Db;
  poster: ChatPoster;
  links: LinkConfig;
}> = async (app, { db, poster, links }) => {
  app.addHook('onRequest', app.authenticate);

  async function requireEditor(userId: string, eventId: string) {
    const event = await findEvent(db, eventId);
    if (!event) throw new ApiError('NOT_FOUND');
    if (!can({ userId }, 'event.edit', await eventResource(db, event, userId))) {
      throw new ApiError(event.organizerId === userId ? 'FORBIDDEN' : 'NOT_FOUND');
    }
    return event;
  }

  const posts = async (eventId: string): Promise<EventPost[]> =>
    (await listEventPosts(db, eventId)).map((p) => ({
      chatId: p.chat.id,
      title: p.chat.title,
      messageId: p.post.telegramMessageId,
    }));

  /** Чаты, куда пользователь добавил бота (SPEC §7.4). */
  app.get('/me/chats', async (req): Promise<TelegramChatView[]> =>
    (await listUserChats(db, req.user.sub)).map((c) => ({
      id: c.id,
      title: c.title,
      type: c.type,
      botCanPost: c.botCanPost,
    })),
  );

  app.get('/events/:id/posts', async (req): Promise<EventPost[]> => {
    const { id } = IdParams.parse(req.params);
    await requireEditor(req.user.sub, id);
    return posts(id);
  });

  app.post('/events/:id/posts', async (req): Promise<PublishPostsResponse> => {
    const { id } = IdParams.parse(req.params);
    const { chatIds } = PublishRequest.parse(req.body);
    const event = await requireEditor(req.user.sub, id);
    if (event.status === 'draft')
      throw new ApiError('INVALID_TRANSITION', 'Сначала опубликуйте событие');
    // Только свои чаты, где бот может писать.
    const chats = (await listUserChats(db, req.user.sub)).filter(
      (c) => chatIds.includes(c.id) && c.botCanPost,
    );
    if (chats.length === 0)
      throw new ApiError('VALIDATION', 'Чаты не найдены', { field: 'chatIds' });
    const result = await publishEventPosts(db, poster, links, id, chats);
    if (result.failed.length) req.log.warn({ failed: result.failed }, 'some posts failed');
    return {
      published: result.published,
      failed: result.failed.map((f) => f.chatId),
      posts: await posts(id),
    };
  });
};
