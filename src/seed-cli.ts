import { readConfig } from './config.js';
import { connectDatabase, disconnectDatabase } from './database.js';
import { ensureAdmin, seedDemo } from './seed.js';

const config = readConfig();
try {
  await connectDatabase(config);
  await ensureAdmin(config);
  await seedDemo({ ...config, seedDemo: true });
} finally {
  await disconnectDatabase();
}
