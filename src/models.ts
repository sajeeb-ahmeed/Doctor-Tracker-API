import { Schema, model } from 'mongoose';
import { searchTokens } from './search.js';

const options = { timestamps: true, versionKey: false } as const;
const userSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin'], default: 'admin' },
  },
  options,
);

const doctorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    specialization: { type: String, required: true, trim: true },
    hospital: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    searchTokens: { type: [String], default: undefined, select: false },
  },
  options,
);
doctorSchema.pre('save', function () {
  this.searchTokens = searchTokens(
    this.name,
    this.specialization,
    this.hospital,
    this.phone,
    this.email,
  );
});
doctorSchema.index({ createdAt: -1, _id: -1 });
doctorSchema.index({ specialization: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ hospital: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ specialization: 1, hospital: 1, createdAt: -1, _id: -1 });
doctorSchema.index({ searchTokens: 1 });
doctorSchema.index({ searchTokens: 1, specialization: 1, hospital: 1, createdAt: -1, _id: -1 });

const patientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    age: { type: Number, required: true, min: 0, max: 120 },
    gender: { type: String, enum: ['Female', 'Male', 'Other'], required: true },
    condition: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['Active', 'Recovered', 'Critical'],
      required: true,
      default: 'Active',
    },
    phone: { type: String, required: true, trim: true },
    email: { type: String, lowercase: true, trim: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    searchTokens: { type: [String], default: undefined, select: false },
  },
  options,
);
patientSchema.pre('save', function () {
  this.searchTokens = searchTokens(this.name, this.condition, this.phone, this.email);
});
patientSchema.index({ createdAt: -1, _id: -1 });
patientSchema.index({ doctorId: 1, createdAt: -1, _id: -1 });
patientSchema.index({ condition: 1, createdAt: -1, _id: -1 });
patientSchema.index({ status: 1, createdAt: -1, _id: -1 });
patientSchema.index({ doctorId: 1, condition: 1, createdAt: -1, _id: -1 });
patientSchema.index({ searchTokens: 1 });
patientSchema.index({ searchTokens: 1, doctorId: 1, condition: 1, createdAt: -1, _id: -1 });

export const User = model('User', userSchema);
export const Doctor = model('Doctor', doctorSchema);
export const Patient = model('Patient', patientSchema);

export async function ensureIndexes() {
  await Promise.all([User.createIndexes(), Doctor.createIndexes(), Patient.createIndexes()]);
}

export async function backfillSearchTokens() {
  for await (const doctor of Doctor.find({ searchTokens: { $exists: false } })
    .lean()
    .cursor()) {
    await Doctor.collection.updateOne(
      { _id: doctor._id },
      {
        $set: {
          searchTokens: searchTokens(
            doctor.name,
            doctor.specialization,
            doctor.hospital,
            doctor.phone,
            doctor.email,
          ),
        },
      },
    );
  }
  for await (const patient of Patient.find({ searchTokens: { $exists: false } })
    .lean()
    .cursor()) {
    await Patient.collection.updateOne(
      { _id: patient._id },
      {
        $set: {
          searchTokens: searchTokens(patient.name, patient.condition, patient.phone, patient.email),
        },
      },
    );
  }
}
