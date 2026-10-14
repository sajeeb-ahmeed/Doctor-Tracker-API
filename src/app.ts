import express, { type Request } from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import type { Config } from './config.js';
import { Doctor, Patient, User } from './models.js';
import { ApiError, errorHandler } from './errors.js';
import {
  doctorInput,
  doctorQuery,
  patientInput,
  patientPatch,
  patientQuery,
  loginInput,
  dashboardQuery,
  dateFilter,
  requireId,
} from './validation.js';
import { serializeDoctor, serializePatient, serializeUser, pagination } from './serializers.js';
import { indexedSearch } from './search.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

const sortNewest = { createdAt: -1, _id: -1 } as const;

export function createApp(config: Config, mongoUrl: string) {
  const app = express();
  app.disable('x-powered-by');
  if (config.production) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, done) => {
        if (!origin || config.origins.includes(origin)) done(null, true);
        else done(new ApiError(403, 'This origin is not allowed.'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Requested-With'],
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_request, response) => {
    const connected = mongoose.connection.readyState === 1;
    response.status(connected ? 200 : 503).json({
      data: {
        status: connected ? 'ok' : 'unavailable',
        database: connected ? 'connected' : 'disconnected',
        service: 'doctor-tracker-api',
      },
    });
  });

  const store = MongoStore.create({
    mongoUrl,
    collectionName: 'sessions',
    ttl: 28800,
    autoRemove: 'native',
  });
  store.on('error', (error) => console.error('Session store error:', error.message));
  app.locals.sessionStore = store;
  // Wait for both the client and TTL-index creation before serving requests or closing the store.
  app.locals.sessionStoreReady = new Promise<void>((resolve, reject) =>
    store.get('__readiness_check__', (error) => (error ? reject(error) : resolve())),
  );
  app.use(
    session({
      name: 'dt.sid',
      secret: config.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.production,
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
      },
    }),
  );
  app.use('/api', (request, _response, next) => {
    if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) return next();
    if (request.get('X-Requested-With') !== 'DoctorTracker')
      return next(new ApiError(403, 'Missing request verification header.'));
    const origin = request.get('Origin');
    if (origin && !config.origins.includes(origin))
      return next(new ApiError(403, 'This origin is not allowed.'));
    next();
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: { message: 'Too many login attempts. Please try again in 15 minutes.' } },
  });
  app.post('/api/auth/login', loginLimiter, async (request, response) => {
    const input = loginInput.parse(request.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    // A fixed-cost hash check prevents a quick response from revealing whether an email exists.
    const valid = await bcrypt.compare(
      input.password,
      user?.passwordHash || '$2b$12$VeqGvYEfmtdVJeKINNM86.xlnAyMUuqwPmnbOzFwH9EjtUF9X9kri',
    );
    if (!user || !valid) throw new ApiError(401, 'Email or password is incorrect.');
    await new Promise<void>((resolve, reject) =>
      request.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    request.session.userId = user._id.toString();
    await new Promise<void>((resolve, reject) =>
      request.session.save((error) => (error ? reject(error) : resolve())),
    );
    response.json({ data: serializeUser(user.toObject()) });
  });

  app.use('/api', async (request, response, next) => {
    if (!request.session.userId) throw new ApiError(401, 'Please sign in to continue.');
    const user = await User.findById(request.session.userId);
    if (!user) throw new ApiError(401, 'Your session has expired. Please sign in again.');
    if (user.role !== 'admin') throw new ApiError(403, 'Administrator access is required.');
    response.locals.user = user;
    next();
  });
  app.get('/api/auth/me', (_request, response) =>
    response.json({ data: serializeUser(response.locals.user.toObject()) }),
  );
  app.post('/api/auth/logout', async (request, response) => {
    await new Promise<void>((resolve, reject) =>
      request.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    response.clearCookie('dt.sid', {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.production,
      path: '/',
    });
    response.json({ data: { message: 'Signed out successfully.' } });
  });

  app.get('/api/doctors', async (request, response) => {
    const query = doctorQuery.parse(request.query);
    const filter: Record<string, unknown> = { ...dateFilter(query.from, query.to) };
    if (query.specialization) filter.specialization = query.specialization;
    if (query.hospital) filter.hospital = query.hospital;
    if (query.q) {
      Object.assign(filter, indexedSearch(query.q));
    }
    const [doctors, total] = await Promise.all([
      Doctor.find(filter)
        .sort(sortNewest)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Doctor.countDocuments(filter),
    ]);
    const counts = await Patient.aggregate<{ _id: Types.ObjectId; patients: number }>([
      { $match: { doctorId: { $in: doctors.map((doctor) => doctor._id) } } },
      { $group: { _id: '$doctorId', patients: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((item) => [item._id.toString(), item.patients]));
    response.json({
      data: doctors.map((doctor) =>
        serializeDoctor(doctor, countMap.get(doctor._id.toString()) || 0),
      ),
      pagination: pagination(query.page, query.limit, total),
    });
  });

  app.post('/api/doctors', async (request, response) => {
    const doctor = await Doctor.create(doctorInput.parse(request.body));
    response.status(201).json({ data: serializeDoctor(doctor.toObject()) });
  });

  app.get('/api/doctors/:id', async (request, response) => {
    const id = requireId(request.params.id);
    const [doctor, count] = await Promise.all([
      Doctor.findById(id).lean(),
      Patient.countDocuments({ doctorId: id }),
    ]);
    if (!doctor) throw new ApiError(404, 'Doctor not found.');
    response.json({ data: serializeDoctor(doctor, count) });
  });

  async function patientList(request: Request, doctorId?: string) {
    const query = patientQuery.parse({ ...request.query, ...(doctorId ? { doctorId } : {}) });
    const filter: Record<string, unknown> = { ...dateFilter(query.from, query.to) };
    if (query.doctorId) filter.doctorId = new Types.ObjectId(query.doctorId);
    if (query.condition) filter.condition = query.condition;
    if (query.status) filter.status = query.status;
    if (query.q) {
      Object.assign(filter, indexedSearch(query.q));
    }
    const [patients, total] = await Promise.all([
      Patient.find(filter)
        .populate('doctorId', 'name specialization')
        .sort(sortNewest)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      Patient.countDocuments(filter),
    ]);
    return {
      data: patients.map(serializePatient),
      pagination: pagination(query.page, query.limit, total),
    };
  }
  app.get('/api/doctors/:id/patients', async (request, response) => {
    const id = requireId(request.params.id);
    if (!(await Doctor.exists({ _id: id }))) throw new ApiError(404, 'Doctor not found.');
    response.json(await patientList(request, id.toString()));
  });
  app.get('/api/patients', async (request, response) => response.json(await patientList(request)));
  app.post('/api/patients', async (request, response) => {
    const input = patientInput.parse(request.body);
    if (!(await Doctor.exists({ _id: input.doctorId })))
      throw new ApiError(400, 'Please choose an existing doctor.', {
        doctorId: 'Doctor not found.',
      });
    const patient = await Patient.create(input);
    await patient.populate('doctorId', 'name specialization');
    response.status(201).json({ data: serializePatient(patient.toObject()) });
  });
  app.patch('/api/patients/:id', async (request, response) => {
    const id = requireId(request.params.id);
    const input = patientPatch.parse(request.body);
    if (input.doctorId && !(await Doctor.exists({ _id: input.doctorId })))
      throw new ApiError(400, 'Please choose an existing doctor.', {
        doctorId: 'Doctor not found.',
      });
    const patient = await Patient.findById(id);
    if (!patient) throw new ApiError(404, 'Patient not found.');
    patient.set(input);
    await patient.save();
    await patient.populate('doctorId', 'name specialization');
    response.json({ data: serializePatient(patient.toObject()) });
  });
  app.delete('/api/patients/:id', async (request, response) => {
    const patient = await Patient.findByIdAndDelete(requireId(request.params.id));
    if (!patient) throw new ApiError(404, 'Patient not found.');
    response.json({
      data: { id: patient._id.toString(), message: 'Patient deleted successfully.' },
    });
  });

  app.get('/api/meta', async (_request, response) => {
    const [specializations, hospitals, conditions, doctors] = await Promise.all([
      Doctor.distinct('specialization'),
      Doctor.distinct('hospital'),
      Patient.distinct('condition'),
      Doctor.find().select('name specialization').sort({ name: 1 }).lean(),
    ]);
    response.json({
      data: {
        specializations: specializations.sort(),
        hospitals: hospitals.sort(),
        conditions: conditions.sort(),
        doctors: doctors.map((doctor) => ({
          id: doctor._id.toString(),
          name: doctor.name,
          specialization: doctor.specialization,
        })),
      },
    });
  });

  app.get('/api/dashboard', async (request, response) => {
    const query = dashboardQuery.parse(request.query);
    const filter = dateFilter(query.from, query.to);
    const end = new Date((query.to || new Date().toISOString().slice(0, 10)) + 'T00:00:00.000Z');
    const start = query.from
      ? new Date(query.from + 'T00:00:00.000Z')
      : new Date(end.getTime() - 29 * 86400000);
    const monthly = (end.getTime() - start.getTime()) / 86400000 > 90;
    const trendFilter = dateFilter(
      start.toISOString().slice(0, 10),
      end.toISOString().slice(0, 10),
    );
    const groupTrend = [
      { $match: trendFilter },
      {
        $group: {
          _id: {
            $dateToString: {
              format: monthly ? '%Y-%m-01' : '%Y-%m-%d',
              date: '$createdAt',
              timezone: 'UTC',
            },
          },
          count: { $sum: 1 },
        },
      },
    ];
    const [
      doctors,
      patients,
      activePatients,
      hospitals,
      perDoctor,
      conditions,
      recent,
      doctorTrend,
      patientTrend,
    ] = await Promise.all([
      Doctor.countDocuments(filter),
      Patient.countDocuments(filter),
      Patient.countDocuments({ ...filter, status: { $in: ['Active', 'Critical'] } }),
      Doctor.distinct('hospital', filter),
      Doctor.aggregate([
        {
          $lookup: {
            from: 'patients',
            let: { doctorId: '$_id' },
            pipeline: [
              { $match: { ...filter, $expr: { $eq: ['$doctorId', '$$doctorId'] } } },
              { $count: 'total' },
            ],
            as: 'patientTotal',
          },
        },
        {
          $project: {
            _id: 0,
            doctorId: { $toString: '$_id' },
            name: 1,
            specialization: 1,
            patients: { $ifNull: [{ $first: '$patientTotal.total' }, 0] },
          },
        },
        { $sort: { patients: -1, name: 1 } },
      ]),
      Patient.aggregate([
        { $match: filter },
        { $group: { _id: '$condition', patients: { $sum: 1 } } },
        { $project: { _id: 0, condition: '$_id', patients: 1 } },
        { $sort: { patients: -1, condition: 1 } },
      ]),
      Patient.find(filter)
        .populate('doctorId', 'name specialization')
        .sort(sortNewest)
        .limit(5)
        .lean(),
      Doctor.aggregate(groupTrend),
      Patient.aggregate(groupTrend),
    ]);
    const doctorMap = new Map(doctorTrend.map((row) => [row._id, row.count]));
    const patientMap = new Map(patientTrend.map((row) => [row._id, row.count]));
    const registrations: { date: string; label: string; patients: number; doctors: number }[] = [];
    const cursor = new Date(start);
    if (monthly) cursor.setUTCDate(1);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      registrations.push({
        date,
        label: cursor.toLocaleDateString('en-US', {
          month: 'short',
          ...(monthly ? { year: '2-digit' } : { day: 'numeric' }),
          timeZone: 'UTC',
        }),
        patients: patientMap.get(date) || 0,
        doctors: doctorMap.get(date) || 0,
      });
      if (monthly) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      else cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    response.json({
      data: {
        totals: { doctors, patients, activePatients, hospitals: hospitals.length },
        registrations,
        patientsPerDoctor: perDoctor,
        conditions,
        recentPatients: recent.map(serializePatient),
      },
    });
  });
  app.use((_request, _response, next) => next(new ApiError(404, 'Endpoint not found.')));
  app.use(errorHandler);
  return app;
}
