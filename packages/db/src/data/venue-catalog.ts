// Каталог площадок для бота — пока площадки не добавят себя сами: 8 площадок Алматы
// с данными от самих площадок (ноябрь 2026). Загружается `pnpm seed:venues`,
// убирается `pnpm seed:venues --remove`. Полный собранный список — data/venues.csv в корне.
import { fileURLToPath } from 'node:url';
import type { Venue } from '../schema';

export interface VenueCatalogItem {
  city: string;
  name: string;
  address: string;
  kind: NonNullable<Venue['kind']>;
  /** Мест в зале. */
  capacity?: number;
  /** Сайт площадки (полный URL). */
  website?: string;
  /** Прежние названия — чтобы найти уже загруженную площадку после переименования. */
  aliases?: string[];
  /** Файлы из data/venue-images: лого (квадрат) и фото зала. */
  logo?: string;
  photo?: string;
}

/** Путь к картинке каталога на диске. */
export function venueImagePath(file: string): string {
  return fileURLToPath(new URL(`./venue-images/${file}`, import.meta.url));
}

export const venueCatalog: VenueCatalogItem[] = [
  // Алматы: CENTRAL, PUNCH и бары Standup Camp — данные от площадок (ноябрь 2026).
  // У CENTRAL два зала: нижний на 140 и верхний на 200+ мест — указан больший.
  {
    city: 'Алматы',
    name: 'CENTRAL',
    address: 'ул. Кабанбай батыра, 71',
    kind: 'club',
    capacity: 200,
    website: 'https://www.standupclub.kz',
    aliases: ['Almaty Central Stand up Club'],
    logo: 'almaty-central-logo.jpg',
    photo: 'almaty-central-photo.jpg',
  },
  {
    city: 'Алматы',
    name: 'PUNCH',
    address: 'ул. Каирбекова, 35а',
    kind: 'club',
    capacity: 80,
    website: 'https://punchclub.kz',
    aliases: ['Punch StandUp Club'],
    logo: 'almaty-punch-logo.jpg',
    photo: 'almaty-punch-photo.jpg',
  },
  // Сайт баров — Standup Camp (организатор стендапа в них), как прислали площадки.
  {
    city: 'Алматы',
    name: 'HM Lounge',
    address: 'ул. Жамбыла, 133',
    kind: 'bar',
    capacity: 50,
    website: 'https://standupcamp.kz',
  },
  {
    city: 'Алматы',
    name: 'Hoper’s',
    address: 'ул. Гагарина, 93а',
    kind: 'bar',
    capacity: 70,
    website: 'https://standupcamp.kz',
  },
  {
    city: 'Алматы',
    name: "Harat's Nurly Tau",
    address: 'пр. Аль-Фараби, 7, блок 5а',
    kind: 'bar',
    capacity: 40,
    website: 'https://standupcamp.kz',
  },
  {
    city: 'Алматы',
    name: "Harat's",
    address: 'ул. Бухар жырау, 26/1',
    kind: 'bar',
    capacity: 60,
    website: 'https://standupcamp.kz',
  },
  {
    city: 'Алматы',
    name: 'Grain',
    address: 'ул. Курмангазы, 97',
    kind: 'other',
    capacity: 50,
    website: 'https://standupcamp.kz',
  },
  {
    city: 'Алматы',
    name: 'Pinta',
    address: 'ул. Тулебаева, 38А',
    kind: 'bar',
    capacity: 60,
    website: 'https://standupcamp.kz',
    logo: 'almaty-pinta-logo.jpg',
  },
];
