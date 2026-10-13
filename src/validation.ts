import { z } from 'zod';
import { Types } from 'mongoose';
import { ApiError } from './errors.js';

const text = (min = 2, max = 100) => z.string().trim().min(min).max(max);
const phone = z
  .string()
  .trim()
  .min(7)
  .max(25)
  .regex(/^[+\d\s().-]+$/, 'Use a valid phone number.')
  .refine((value) => {
    const digits = value.replace(/\D/g, '').length;
    return digits >= 7 && digits <= 15;
  }, 'Phone numbers must contain 7 to 15 digits.');
const normalizedEmail = z.string().trim().toLowerCase().max(254);
const email = normalizedEmail.pipe(z.email());
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Choose a valid doctor.');
export const doctorInput = z
  .object({ name: text(), specialization: text(), hospital: text(), phone, email })
  .strict();
export const patientInput = z
  .object({
    name: text(),
    age: z.number().int().min(0).max(120),
    gender: z.enum(['Female', 'Male', 'Other']),
    condition: text(),
    status: z.enum(['Active', 'Recovered', 'Critical']).default('Active'),
    phone,
    email: normalizedEmail.pipe(z.email().or(z.literal(''))).optional(),
    doctorId: objectId,
  })
  .strict();
// A create-only default must not reset status during a partial update.
export const patientPatch = patientInput
  .omit({ status: true })
  .extend({ status: z.enum(['Active', 'Recovered', 'Critical']) })
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Provide at least one field to update.');
export const loginInput = z.object({ email, password: z.string().min(1).max(128) }).strict();

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
  .refine((value) => {
    const date = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Choose a valid calendar date.');
const dateFields = { from: day.optional(), to: day.optional() };
const refineDate = (data: { from?: string; to?: string }) =>
  !data.from || !data.to || data.from <= data.to;
const paginationFields = {
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  ...dateFields,
};
export const doctorQuery = z
  .object({ ...paginationFields, specialization: text(1).optional(), hospital: text(1).optional() })
  .strict()
  .refine(refineDate, { path: ['to'], message: 'End date must be on or after start date.' });
export const patientQuery = z
  .object({
    ...paginationFields,
    doctorId: objectId.optional(),
    condition: text(1).optional(),
    status: z.enum(['Active', 'Recovered', 'Critical']).optional(),
  })
  .strict()
  .refine(refineDate, { path: ['to'], message: 'End date must be on or after start date.' });
export const dashboardQuery = z
  .object(dateFields)
  .strict()
  .refine(refineDate, { path: ['to'], message: 'End date must be on or after start date.' });

export function requireId(id: unknown) {
  if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))
    throw new ApiError(400, 'Invalid record ID.');
  return new Types.ObjectId(id);
}

export function dateFilter(from?: string, to?: string): Record<string, unknown> {
  if (!from && !to) return {};
  return {
    createdAt: {
      ...(from ? { $gte: new Date(from + 'T00:00:00.000Z') } : {}),
      ...(to ? { $lt: new Date(new Date(to + 'T00:00:00.000Z').getTime() + 86400000) } : {}),
    },
  };
}
