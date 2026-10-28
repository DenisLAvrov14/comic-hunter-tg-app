import { createDb } from '@standup/db';
import { buildApp } from './app';
import { loadConfig } from './config';
import { S3Storage } from './storage';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const storage = new S3Storage(config.s3);
const app = await buildApp({ config, db, storage });

if (config.devAuth) app.log.warn('DEV_AUTH включён: вход без подписи Telegram разрешён');
if (config.s3.createBucket) {
  await storage.ensureBucket().catch((err) => app.log.error({ err }, 'S3 bucket setup failed'));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
