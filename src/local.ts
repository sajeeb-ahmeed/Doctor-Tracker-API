import 'dotenv/config';

process.env.NODE_ENV ||= 'development';
if (process.env.NODE_ENV === 'production')
  throw new Error('dev:local is only available in development.');
process.env.SEED_DEMO ||= 'true';
process.env.ADMIN_EMAIL ||= 'admin@doctortracker.demo';
process.env.ADMIN_PASSWORD ||= 'DoctorDemo!2030';
await import('./server.js');
