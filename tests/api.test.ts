import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { ensureAdmin } from '../src/seed.js';
import { ensureIndexes, Patient, Doctor, backfillSearchTokens } from '../src/models.js';
import { indexedSearch, searchTokens } from '../src/search.js';
import type { Config } from '../src/config.js';
import type { Express } from 'express';

const config: Config = {
  production: false,
  port: 4000,
  mongoUri: '',
  origins: ['http://localhost:3000'],
  sessionSecret: 'integration-test-secret-at-least-32-characters',
  adminEmail: 'admin@doctortracker.demo',
  adminName: 'Test Admin',
  adminPassword: 'DoctorDemo!2030',
  seedDemo: false,
};
let mongo: MongoMemoryServer;
let app: Express;
let agent: ReturnType<typeof request.agent>;
let doctorId: string;
let patientId: string;
const mutationHeaders = { 'X-Requested-With': 'DoctorTracker', Origin: 'http://localhost:3000' };
const doctor = {
  name: 'Dr. Integration Smith',
  specialization: 'Cardiology',
  hospital: 'Test Hospital',
  phone: '+880 1700 123456',
  email: 'smith@example.test',
};
const patient = {
  name: 'Taylor Test',
  age: 34,
  gender: 'Female',
  condition: 'Hypertension',
  status: 'Active',
  phone: '+880 1800 123456',
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({
    binary: { version: '8.0.16' },
    instance: { dbName: 'doctor_tracker_test' },
  });
  const mongoUri = mongo.getUri('doctor_tracker_test');
  await mongoose.connect(mongoUri, { autoIndex: false });
  await ensureIndexes();
  await ensureAdmin(config);
  app = createApp(config, mongoUri);
  await app.locals.sessionStoreReady;
  agent = request.agent(app);
});

afterAll(async () => {
  if (app) await app.locals.sessionStore.close();
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

describe('administrator security', () => {
  it('exposes database readiness and protects business endpoints', async () => {
    expect((await request(app).get('/api/health')).body.data.database).toBe('connected');
    for (const path of [
      '/api/doctors',
      '/api/patients',
      '/api/dashboard',
      '/api/auth/me',
      '/api/meta',
    ]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(401);
      expect(response.body.error.message).toBeTruthy();
    }
  });
  it('rejects missing verification headers and untrusted origins', async () => {
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .send({ email: config.adminEmail, password: config.adminPassword })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/auth/login')
          .set({ ...mutationHeaders, Origin: 'https://attacker.example' })
          .send({ email: config.adminEmail, password: config.adminPassword })
      ).status,
    ).toBe(403);
  });
  it('rejects invalid credentials and returns an HttpOnly session on login', async () => {
    expect(
      (
        await agent
          .post('/api/auth/login')
          .set(mutationHeaders)
          .send({ email: config.adminEmail, password: 'wrong password' })
      ).status,
    ).toBe(401);
    const response = await agent
      .post('/api/auth/login')
      .set(mutationHeaders)
      .send({ email: config.adminEmail, password: config.adminPassword });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ email: config.adminEmail, role: 'admin' });
    expect(response.body.data.passwordHash).toBeUndefined();
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('doctor and patient workflows', () => {
  it('validates doctor inputs and prevents duplicate emails', async () => {
    const invalid = await agent
      .post('/api/doctors')
      .set(mutationHeaders)
      .send({ ...doctor, email: 'bad-email', extra: 'not allowed' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.fields.email).toBeTruthy();
    const created = await agent.post('/api/doctors').set(mutationHeaders).send(doctor);
    expect(created.status).toBe(201);
    doctorId = created.body.data.id;
    expect(created.body.data.patientCount).toBe(0);
    expect((await agent.post('/api/doctors').set(mutationHeaders).send(doctor)).status).toBe(409);
    expect((await agent.get(`/api/doctors/${doctorId}`)).body.data.name).toBe(doctor.name);
  });

  it('rejects invalid ids, excessive pagination, invalid dates, and operator injection', async () => {
    expect((await agent.get('/api/doctors/not-an-id')).status).toBe(400);
    expect((await agent.get('/api/doctors/000000000000000000000000')).status).toBe(404);
    expect((await agent.get('/api/patients?limit=51')).status).toBe(400);
    expect((await agent.get('/api/doctors?page=0')).status).toBe(400);
    expect((await agent.get('/api/patients?from=2026-02-30')).status).toBe(400);
    expect((await agent.get('/api/patients?from=2026-10-10&to=2026-10-01')).status).toBe(400);
    expect(
      (
        await agent
          .post('/api/doctors')
          .set(mutationHeaders)
          .send({ ...doctor, email: { $ne: null } })
      ).status,
    ).toBe(400);
  });

  it('creates a patient only with a valid doctor and rejects invalid fields', async () => {
    expect(
      (
        await agent
          .post('/api/patients')
          .set(mutationHeaders)
          .send({ ...patient, doctorId: '000000000000000000000000' })
      ).status,
    ).toBe(400);
    expect(
      (
        await agent
          .post('/api/patients')
          .set(mutationHeaders)
          .send({ ...patient, age: -1, doctorId })
      ).status,
    ).toBe(400);
    const created = await agent
      .post('/api/patients')
      .set(mutationHeaders)
      .send({ ...patient, doctorId });
    expect(created.status).toBe(201);
    patientId = created.body.data.id;
    expect(created.body.data.doctor).toMatchObject({ id: doctorId, name: doctor.name });
    expect((await agent.get(`/api/doctors/${doctorId}`)).body.data.patientCount).toBe(1);
  });

  it('combines patient filters, inclusive dates, and stable pagination using database counts', async () => {
    const date = '2026-09-20';
    await Patient.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(patientId) },
      { $set: { createdAt: new Date(date + 'T23:59:59.999Z') } },
    );
    for (let i = 0; i < 3; i++) {
      const created = await agent
        .post('/api/patients')
        .set(mutationHeaders)
        .send({ ...patient, name: `Taylor Test ${i + 1}`, doctorId });
      await Patient.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(created.body.data.id) },
        { $set: { createdAt: new Date(date + 'T00:00:00.000Z') } },
      );
    }
    await agent
      .post('/api/patients')
      .set(mutationHeaders)
      .send({ ...patient, name: 'Different Patient', condition: 'Migraine', doctorId });
    const query = `q=Taylor&doctorId=${doctorId}&condition=Hypertension&status=Active&from=${date}&to=${date}&limit=2`;
    const first = await agent.get(`/api/patients?${query}&page=1`);
    const second = await agent.get(`/api/patients?${query}&page=2`);
    expect(first.status).toBe(200);
    expect(first.body.pagination).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
    expect(second.body.data).toHaveLength(2);
    const allIds = [...first.body.data, ...second.body.data].map((row: { id: string }) => row.id);
    expect(new Set(allIds).size).toBe(4);
    const assigned = await agent.get(`/api/doctors/${doctorId}/patients?${query}`);
    expect(assigned.body.pagination.total).toBe(4);
    const literal = await agent.get('/api/patients?q=%5B.*%5D');
    expect(literal.status).toBe(200);
    expect(literal.body.pagination.total).toBe(0);
    const doctors = await agent.get(
      '/api/doctors?q=Integration&specialization=Cardiology&hospital=Test%20Hospital&limit=1',
    );
    expect(doctors.body.pagination.total).toBe(1);
    expect(doctors.body.data[0].patientCount).toBe(5);
    const prefixes = await agent.get(`/api/patients?${query.replace('q=Taylor', 'q=tAY%20hyPe')}`);
    expect(prefixes.body.pagination.total).toBe(4);
    expect((await agent.get('/api/patients?q=aylor')).body.pagination.total).toBe(0);
  });

  it('supports partial updates, real analytics, and permanent deletion', async () => {
    const before = await agent.get('/api/dashboard');
    expect(before.body.data.totals).toMatchObject({
      doctors: 1,
      patients: 5,
      activePatients: 5,
      hospitals: 1,
    });
    expect(before.body.data.patientsPerDoctor[0].patients).toBe(5);
    expect(
      (
        await agent
          .patch(`/api/patients/${patientId}`)
          .set(mutationHeaders)
          .send({ condition: 'Follow-up care', status: 'Recovered' })
      ).status,
    ).toBe(200);
    const renamed = await agent
      .patch(`/api/patients/${patientId}`)
      .set(mutationHeaders)
      .send({ name: 'Updated Taylor' });
    expect(renamed.body.data.status).toBe('Recovered');
    expect((await agent.get('/api/patients?q=Updated%20Follow')).body.pagination.total).toBe(1);
    expect(
      (await agent.patch(`/api/patients/${patientId}`).set(mutationHeaders).send({})).status,
    ).toBe(400);
    const meta = await agent.get('/api/meta');
    expect(meta.body.data.conditions).toContain('Follow-up care');
    expect(meta.body.data.doctors[0].id).toBe(doctorId);
    const dated = await agent.get('/api/dashboard?from=2026-09-20&to=2026-09-20');
    expect(dated.body.data.totals.patients).toBe(4);
    expect(dated.body.data.registrations[0].patients).toBe(4);
    const deleted = await agent.delete(`/api/patients/${patientId}`).set(mutationHeaders);
    expect(deleted.status).toBe(200);
    expect(await Patient.exists({ _id: patientId })).toBeNull();
    expect((await agent.get(`/api/doctors/${doctorId}`)).body.data.patientCount).toBe(4);
    expect((await agent.get('/api/dashboard')).body.data.totals.patients).toBe(4);
    expect((await agent.delete(`/api/patients/${patientId}`).set(mutationHeaders)).status).toBe(
      404,
    );
    expect(
      (await agent.patch('/api/patients/invalid').set(mutationHeaders).send({ status: 'Active' }))
        .status,
    ).toBe(400);
    expect(await Doctor.countDocuments()).toBe(1);
  });

  it('destroys authentication on logout', async () => {
    expect((await agent.post('/api/auth/logout').set(mutationHeaders)).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    expect((await agent.get('/api/patients')).status).toBe(401);
  });
});

describe('indexed search query plans', () => {
  it('uses a bounded index scan for token-prefix search with filters and backfills older records', async () => {
    const createdAt = new Date();
    const rows = Array.from({ length: 250 }, (_, index) => ({
      name: `Indexed Doctor ${index}`,
      specialization: index % 2 ? 'Performance' : 'Other',
      hospital: 'Benchmark Hospital',
      phone: '+880 1700 555555',
      email: `benchmark${index}@example.test`,
      createdAt,
      updatedAt: createdAt,
      searchTokens: searchTokens(
        `Indexed Doctor ${index}`,
        index % 2 ? 'Performance' : 'Other',
        'Benchmark Hospital',
        `benchmark${index}@example.test`,
      ),
    }));
    await Doctor.insertMany(rows);
    const plan = await Doctor.find({
      ...indexedSearch('benchmark249'),
      specialization: 'Performance',
      hospital: 'Benchmark Hospital',
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(10)
      .explain('executionStats');
    expect(JSON.stringify(plan.queryPlanner.winningPlan)).toContain('IXSCAN');
    expect(plan.executionStats.nReturned).toBe(1);
    expect(plan.executionStats.totalDocsExamined).toBeLessThan(10);
    console.info(
      'Indexed search evidence:',
      JSON.stringify({
        records: await Doctor.countDocuments(),
        returned: plan.executionStats.nReturned,
        keysExamined: plan.executionStats.totalKeysExamined,
        docsExamined: plan.executionStats.totalDocsExamined,
        winningPlan: plan.queryPlanner.winningPlan,
      }),
    );
    const old = await Doctor.collection.insertOne({
      name: 'Legacy Prefix',
      specialization: 'Legacy',
      hospital: 'Legacy Hospital',
      phone: '+880 1700 555555',
      email: 'legacy@example.test',
      createdAt,
      updatedAt: createdAt,
    });
    await backfillSearchTokens();
    expect(await Doctor.countDocuments(indexedSearch('lega pref'))).toBe(1);
    await Doctor.deleteOne({ _id: old.insertedId });
  });
});
