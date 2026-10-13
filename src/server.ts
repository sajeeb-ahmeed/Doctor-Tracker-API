import { readConfig } from './config.js';
import { connectDatabase, disconnectDatabase } from './database.js';
import { createApp } from './app.js';
import { ensureAdmin, seedDemo } from './seed.js';

const config = readConfig();
try {
  const mongoUri = await connectDatabase(config);
  await ensureAdmin(config);
  await seedDemo(config);
  const app = createApp(config, mongoUri);
  await app.locals.sessionStoreReady;
  const server = app.listen(config.port, '0.0.0.0', () =>
    console.info(`Doctor Tracker API listening on http://localhost:${config.port}`),
  );
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.sessionStore.close();
    await disconnectDatabase();
    process.exit(0);
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch (error) {
  console.error(
    'Could not start Doctor Tracker API:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  await disconnectDatabase();
  process.exit(1);
}
