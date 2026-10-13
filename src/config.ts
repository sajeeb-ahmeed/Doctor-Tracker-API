import 'dotenv/config';
import { randomBytes } from 'node:crypto';

export interface Config {
  production: boolean;
  port: number;
  mongoUri: string;
  origins: string[];
  sessionSecret: string;
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  seedDemo: boolean;
}

export function readConfig(): Config {
  const production = process.env.NODE_ENV === 'production';
  const mongoUri = process.env.MONGODB_URI?.trim() || '';
  const sessionSecret =
    process.env.SESSION_SECRET ||
    (production ? '' : 'local-doctor-tracker-' + randomBytes(24).toString('hex'));
  const adminPassword = process.env.ADMIN_PASSWORD || (production ? '' : 'DoctorDemo!2030');
  const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const port = Number(process.env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be a valid TCP port.');
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
      throw new Error('FRONTEND_ORIGIN must contain exact HTTP(S) origins without paths.');
    if (production && url.protocol !== 'https:')
      throw new Error('Production frontend origins must use HTTPS.');
  }
  if (production && (!mongoUri || sessionSecret.length < 32 || adminPassword.length < 12)) {
    throw new Error(
      'Production requires MONGODB_URI, SESSION_SECRET (32+ characters), and ADMIN_PASSWORD (12+ characters).',
    );
  }
  return {
    production,
    port,
    mongoUri,
    origins,
    sessionSecret,
    adminEmail: (process.env.ADMIN_EMAIL || 'admin@doctortracker.demo').trim().toLowerCase(),
    adminName: process.env.ADMIN_NAME || 'Alex Morgan',
    adminPassword,
    seedDemo: process.env.SEED_DEMO === 'true',
  };
}
