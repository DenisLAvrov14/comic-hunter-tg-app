import { eq } from 'drizzle-orm';
import { createDb, runMigrations } from './client';
import { listCities, syncCities } from './repositories/reference';
import { setUserRoles, updateUser, upsertComedianProfile } from './repositories/profiles';
import { upsertTelegramUser } from './repositories/users';
import { comedianTrips } from './schema';

// Каталог для ручной проверки: реальные площадки (адреса из 2ГИС, Яндекс Афиши и сайтов клубов)
// и публичные комики. Это демо-профили, а не аккаунты самих комиков: контактов нет,
// города комиков приблизительные. Идемпотентно: повторный запуск ничего не дублирует.

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

// Настоящие telegram_id намного меньше: реальный пользователь не войдёт под демо-профилем.
const DEMO_TELEGRAM_ID_BASE = 9_000_000_000_000;
const DEMO_CONTACT = 'демо-профиль, контакта нет';
const DEMO_BIO = 'Демо-профиль для проверки приложения. Это не аккаунт комика.';

// Площадки — не здесь: каталог площадок загружается `pnpm seed:venues` (apps/api).

// Порядок не менять: от позиции в списке зависит telegram_id профиля.
const comedianSeeds = [
  { stageName: 'Руслан Белый', city: 'Москва', category: 'media' },
  { stageName: 'Стас Старовойтов', city: 'Москва', category: 'media' },
  { stageName: 'Виктор Комаров', city: 'Москва', category: 'media' },
  { stageName: 'Юлия Ахмедова', city: 'Москва', category: 'media' },
  { stageName: 'Алексей Щербаков', city: 'Москва', category: 'media' },
  { stageName: 'Дмитрий Романов', city: 'Москва', category: 'media' },
  { stageName: 'Тимур Каргинов', city: 'Москва', category: 'media' },
  { stageName: 'Нурлан Сабуров', city: 'Москва', category: 'media' },
  { stageName: 'Павел Дедищев', city: 'Москва', category: 'media' },
  { stageName: 'Иван Абрамов', city: 'Москва', category: 'media' },
  { stageName: 'Гурам Амарян', city: 'Москва', category: 'media' },
  { stageName: 'Расул Чабдаров', city: 'Москва', category: 'media' },
  { stageName: 'Денис Дорохов', city: 'Москва', category: 'media' },
  { stageName: 'Евгений Чебатков', city: 'Москва', category: 'media' },
  { stageName: 'Андрей Атлас', city: 'Москва', category: 'media' },
  { stageName: 'Галым Калиакбаров', city: 'Астана', category: 'media' },
  { stageName: 'Джамбул Кульдеев', city: 'Астана', category: 'experienced' },
  { stageName: 'Шынгыс Ермек', city: 'Алматы', category: 'media' },
  { stageName: 'Вероника Ким', city: 'Алматы', category: 'media' },
  { stageName: 'Миша Зейферт', city: 'Алматы', category: 'experienced' },
  { stageName: 'Аманжан Махметов', city: 'Алматы', category: 'experienced' },
  { stageName: 'Тілеген Еркінбеков', city: 'Алматы', category: 'experienced' },
  { stageName: 'Биржан Кабылбаев', city: 'Алматы', category: 'experienced' },
  { stageName: 'Даурен Тогисов', city: 'Алматы', category: 'experienced' },
  { stageName: 'Асет Уваев', city: 'Алматы', category: 'experienced' },
  { stageName: 'Айна Мусина', city: 'Алматы', category: 'experienced' },
  { stageName: 'Асхат Ибитанов', city: 'Алматы', category: 'experienced' },
  { stageName: 'Алексей Луговской', city: 'Алматы', category: 'experienced' },
  { stageName: 'Рахат Мелсов', city: 'Алматы', category: 'experienced' },
  { stageName: 'Сырым Искаков', city: 'Алматы', category: 'experienced' },
  { stageName: 'Томирис Бостанбекова', city: 'Алматы', category: 'experienced' },
  { stageName: 'Махаббат Сарсимбаева', city: 'Алматы', category: 'experienced' },
] as const;

const { db, close } = createDb(url);
await runMigrations(db);
await syncCities(db);

const cityByName = new Map((await listCities(db)).map((c) => [c.name, c]));
const city = (name: string) => {
  const c = cityByName.get(name);
  if (!c) throw new Error(`Город ${name} не найден`);
  return c;
};

// Демо-поездки, чтобы в поиске было видно приехавших комиков.
const demoTrips = new Map<number, { city: string; inDays: number; days: number }>();
const fromKazakhstan = comedianSeeds.flatMap((s, i) => (s.city === 'Алматы' ? [i] : []));
[
  { city: 'Санкт-Петербург', inDays: 7, days: 4 },
  { city: 'Санкт-Петербург', inDays: 11, days: 2 },
  { city: 'Москва', inDays: 14, days: 3 },
].forEach((trip, n) => demoTrips.set(fromKazakhstan[n]!, trip));
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

for (const [i, comedian] of comedianSeeds.entries()) {
  const c = city(comedian.city);
  const user = await upsertTelegramUser(db, {
    id: DEMO_TELEGRAM_ID_BASE + i,
    first_name: comedian.stageName.split(' ')[0]!,
  });
  await setUserRoles(db, user.id, ['comedian']);
  await upsertComedianProfile(db, user.id, {
    stageName: comedian.stageName,
    cityId: c.id,
    contact: DEMO_CONTACT,
    category: comedian.category,
    bio: DEMO_BIO,
    links: [],
    defaultSetMinutes: 10,
  });
  await updateUser(db, user.id, { timezone: c.timezone });

  await db.delete(comedianTrips).where(eq(comedianTrips.comedianId, user.id));
  const trip = demoTrips.get(i);
  if (trip) {
    await db.insert(comedianTrips).values({
      comedianId: user.id,
      cityId: city(trip.city).id,
      startsOn: inDays(trip.inDays),
      endsOn: inDays(trip.inDays + trip.days - 1),
    });
  }
}

await close();
console.log(`catalog done: ${comedianSeeds.length} comedians`);
