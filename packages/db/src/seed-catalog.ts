import { and, eq } from 'drizzle-orm';
import { createDb, runMigrations } from './client';
import { listCities, syncCities } from './repositories/reference';
import { setUserRoles, updateUser, upsertComedianProfile } from './repositories/profiles';
import { upsertTelegramUser } from './repositories/users';
import { comedianTrips, venues } from './schema';

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

const venueSeeds = [
  { city: 'Москва', name: 'StandUp Store Moscow', address: 'ул. Петровка, 21, стр. 1' },
  { city: 'Москва', name: 'Стендап клуб на Трубной', address: 'Рождественский б-р, 10/7, стр. 1' },
  { city: 'Москва', name: 'Stand up Патрики', address: 'Садовая-Кудринская ул., 20' },
  { city: 'Москва', name: 'Comedy Hub', address: 'Садовая-Черногрязская ул., 22, стр. 1' },
  { city: 'Москва', name: 'The Hole', address: 'ул. Маросейка, 2/15, стр. 1' },
  { city: 'Москва', name: 'Comedy 34', address: 'ул. Сретенка, 34/1' },
  { city: 'Москва', name: 'GlavStandUp Hall', address: 'Садовая-Спасская ул., 21/1' },
  { city: 'Санкт-Петербург', name: 'Stage StandUp Club', address: 'ул. Восстания, 24/27' },
  { city: 'Санкт-Петербург', name: 'Stand Up Studio', address: 'ул. Белинского, 9' },
  { city: 'Санкт-Петербург', name: 'Comedy place', address: 'наб. канала Грибоедова, 36' },
  { city: 'Екатеринбург', name: 'StandUp Spot', address: 'ул. Вайнера, 10' },
  { city: 'Екатеринбург', name: 'Pravda', address: 'ул. Шейнкмана, 90' },
  { city: 'Новосибирск', name: 'Standup room', address: 'ул. Ленина, 10а' },
  { city: 'Казань', name: 'Stand Up Club Kazan', address: 'ул. Баумана, 44, 3 этаж' },
  { city: 'Нижний Новгород', name: 'Стендап Клуб', address: 'ул. Рождественская, 10' },
  { city: 'Краснодар', name: 'Маяковский', address: 'ул. Калинина, 269' },
  { city: 'Краснодар', name: 'Standup Bar Krasnodar', address: 'ул. Красная, 118' },
  { city: 'Ростов-на-Дону', name: 'Stand Up City', address: 'Московская ул., 57' },
  { city: 'Ростов-на-Дону', name: 'Flash', address: 'ул. Седова, 5' },
  { city: 'Алматы', name: 'Almaty Central Stand up Club', address: 'ул. Кабанбай батыра, 71' },
  { city: 'Алматы', name: 'Punch StandUp Club', address: 'ул. Каирбекова, 35а, 3 этаж' },
  { city: 'Алматы', name: 'Alau Comedy Space', address: 'ул. Толе би, 72' },
];

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

let venuesAdded = 0;
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
      status: 'approved',
    });
    venuesAdded += 1;
  }
}

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
console.log(`catalog done: +${venuesAdded} venues, ${comedianSeeds.length} comedians`);
