import { and, eq } from 'drizzle-orm';
import { createDb, runMigrations } from './client';
import { listCities, syncCities } from './repositories/reference';
import {
  setUserRoles,
  updateUser,
  upsertComedianProfile,
  upsertOrganizerProfile,
} from './repositories/profiles';
import { upsertTelegramUser } from './repositories/users';
import { venues } from './schema';

// Демо-данные для разработки. Идемпотентно: повторный запуск ничего не дублирует.
// Под любым из пользователей можно войти dev-входом по его telegram_id.
// TODO(spec): 5 событий в разных статусах — на этапе 4, когда появится таблица events.

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, close } = createDb(url);
await runMigrations(db);
await syncCities(db);

const cityByName = new Map((await listCities(db)).map((c) => [c.name, c]));
const city = (name: string) => {
  const c = cityByName.get(name);
  if (!c) throw new Error(`Город ${name} не найден`);
  return c;
};

const organizers = [
  { telegramId: 100001, firstName: 'Ольга', project: 'Подвал Stand Up', city: 'Москва' },
  { telegramId: 100002, firstName: 'Ержан', project: 'Almaty Open Mic', city: 'Алматы' },
];

const organizerIds: string[] = [];
for (const o of organizers) {
  const user = await upsertTelegramUser(db, {
    id: o.telegramId,
    first_name: o.firstName,
    username: `org_${o.telegramId}`,
  });
  await setUserRoles(db, user.id, ['organizer', 'host']);
  await upsertOrganizerProfile(db, user.id, {
    displayName: o.firstName,
    projectName: o.project,
    cityId: city(o.city).id,
    contact: `@org_${o.telegramId}`,
  });
  await updateUser(db, user.id, { timezone: city(o.city).timezone });
  organizerIds.push(user.id);
}

const venueSeeds = [
  { name: 'Подвал', address: 'ул. Мясницкая, 13', city: 'Москва', createdBy: organizerIds[0]! },
  { name: 'Комеди Бар', address: 'Тверская ул., 7', city: 'Москва', createdBy: organizerIds[0]! },
  { name: 'Smoky Room', address: 'пр. Абая, 52', city: 'Алматы', createdBy: organizerIds[1]! },
];
for (const v of venueSeeds) {
  const c = city(v.city);
  const [existing] = await db
    .select({ id: venues.id })
    .from(venues)
    .where(and(eq(venues.name, v.name), eq(venues.cityId, c.id)));
  if (!existing) {
    await db.insert(venues).values({
      name: v.name,
      address: v.address,
      cityId: c.id,
      timezone: c.timezone,
      createdBy: v.createdBy,
    });
  }
}

const stageNames = [
  'Артём Белый',
  'Лиза Шторм',
  'Макс Тихий',
  'Даша Пан',
  'Игорь Кот',
  'Нурлан Сакен',
  'Айгерим Жан',
  'Тимур Остров',
  'Вера Смех',
  'Саша Ноль',
  'Олег Фокус',
  'Катя Ветер',
  'Рустам Арт',
  'Полина Док',
  'Гоша Март',
  'Динара Ай',
  'Кирилл Лис',
  'Аня Верх',
  'Бекзат Ок',
  'Женя Край',
];
const categories = ['newbie', 'experienced', 'media'] as const;

for (const [i, stageName] of stageNames.entries()) {
  const telegramId = 200001 + i;
  const cityName = i % 4 === 3 ? 'Алматы' : 'Москва';
  const user = await upsertTelegramUser(db, {
    id: telegramId,
    first_name: stageName.split(' ')[0]!,
    username: `comic_${telegramId}`,
  });
  await setUserRoles(db, user.id, ['comedian']);
  await upsertComedianProfile(db, user.id, {
    stageName,
    cityId: city(cityName).id,
    contact: `@comic_${telegramId}`,
    // Примерно: половина новичков, треть опытных, остальные медийные.
    category: categories[i % 6 === 5 ? 2 : i % 2],
    bio: i % 3 === 0 ? 'Пишу про семью, работу и метро.' : null,
    links:
      i % 2 === 0
        ? [{ type: 'video', url: `https://www.youtube.com/watch?v=demo${telegramId}` }]
        : [],
    defaultSetMinutes: i % 2 === 0 ? 5 : 7,
  });
  await updateUser(db, user.id, { timezone: city(cityName).timezone });
}

await close();
console.log(
  `seed done: ${organizers.length} organizers, ${venueSeeds.length} venues, ${stageNames.length} comedians`,
);
