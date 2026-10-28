import { createDb, runMigrations } from './client';
import { syncCities } from './repositories/reference';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, close } = createDb(url);
await runMigrations(db);
await syncCities(db);
await close();
console.log('migrations applied, cities synced');
