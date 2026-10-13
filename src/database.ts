import mongoose from 'mongoose';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import type { Config } from './config.js';
import { ensureIndexes, backfillSearchTokens } from './models.js';

let localMongo: MongoMemoryServer | undefined;

export async function connectDatabase(config: Config): Promise<string> {
  let uri = config.mongoUri;
  if (!uri) {
    if (config.production) throw new Error('MONGODB_URI is required in production.');
    const { MongoMemoryServer: LocalMongoServer } = await import('mongodb-memory-server');
    const dbPath = resolve('.data', 'mongodb');
    await mkdir(dbPath, { recursive: true });
    localMongo = await LocalMongoServer.create({
      binary: { version: '8.0.16' },
      instance: { dbPath, storageEngine: 'wiredTiger', port: 27018, dbName: 'doctor_tracker' },
    });
    uri = localMongo.getUri('doctor_tracker');
    console.info('Local MongoDB is running with persistent data in .data/mongodb.');
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000, autoIndex: false });
  await ensureIndexes();
  await backfillSearchTokens();
  return uri;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
  if (localMongo) await localMongo.stop({ doCleanup: false });
}
