import bcrypt from 'bcryptjs';
import type { Config } from './config.js';
import { Doctor, Patient, User } from './models.js';
import { searchTokens } from './search.js';

export async function ensureAdmin(config: Config) {
  if (!(await User.exists({ email: config.adminEmail }))) {
    await User.create({
      name: config.adminName,
      email: config.adminEmail,
      passwordHash: await bcrypt.hash(config.adminPassword, 12),
      role: 'admin',
    });
    console.info('Administrator account created.');
  }
}

const doctorData = [
  ['Dr. Sarah Mitchell', 'Cardiology', 'Evercare Hospital'],
  ['Dr. James Wilson', 'Neurology', 'United Hospital'],
  ['Dr. Emily Chen', 'Pediatrics', 'Square Hospital'],
  ['Dr. Michael Roberts', 'Orthopedics', 'Evercare Hospital'],
  ['Dr. Sophia Rahman', 'Dermatology', 'Labaid Hospital'],
  ['Dr. Arif Hassan', 'General Medicine', 'United Hospital'],
  ['Dr. Olivia Bennett', 'Oncology', 'Square Hospital'],
  ['Dr. Daniel Kim', 'Pulmonology', 'Evercare Hospital'],
  ['Dr. Maya Ahmed', 'Endocrinology', 'Labaid Hospital'],
  ['Dr. Ryan Clarke', 'Psychiatry', 'United Hospital'],
  ['Dr. Aisha Khan', 'Gastroenterology', 'Square Hospital'],
  ['Dr. Noah Brooks', 'Ophthalmology', 'Evercare Hospital'],
  ['Dr. Zara Islam', 'Nephrology', 'Labaid Hospital'],
  ['Dr. Leo Anderson', 'Cardiology', 'United Hospital'],
];
const firstNames = [
  'Avery',
  'Jordan',
  'Taylor',
  'Morgan',
  'Samira',
  'Riley',
  'Nadia',
  'Alex',
  'Sofia',
  'Adam',
  'Priya',
  'Lucas',
  'Layla',
  'Ethan',
  'Mira',
  'Owen',
  'Alina',
  'Liam',
  'Hana',
  'Theo',
];
const lastNames = [
  'Parker',
  'Ahmed',
  'Hughes',
  'Rahman',
  'Campbell',
  'Khan',
  'Foster',
  'Islam',
  'Reed',
  'Patel',
  'Wright',
  'Ali',
  'Bennett',
  'Hasan',
  'Cooper',
  'Das',
];
const conditions = [
  'Hypertension',
  'Migraine',
  'Seasonal allergy',
  'Joint pain',
  'Dermatitis',
  'Routine checkup',
  'Follow-up care',
  'Asthma',
  'Type 2 diabetes',
  'Anxiety',
  'Gastritis',
  'Vision screening',
  'Kidney monitoring',
  'Hypertension',
];

export async function seedDemo(config: Config) {
  if (!config.seedDemo) return;
  if ((await Doctor.countDocuments()) > 0) {
    console.info('Demo data already present; existing records preserved.');
    return;
  }
  const now = Date.now();
  const doctors = await Doctor.insertMany(
    doctorData.map(([name, specialization, hospital], index) => ({
      name,
      specialization,
      hospital,
      phone: `+880 1700 000${String(index).padStart(3, '0')}`,
      searchTokens: searchTokens(
        name,
        specialization,
        hospital,
        `+880 1700 000${String(index).padStart(3, '0')}`,
        `doctor${index + 1}@doctortracker.demo`,
      ),
      email: `doctor${index + 1}@doctortracker.demo`,
      createdAt: new Date(now - (65 - index * 4) * 86400000),
      updatedAt: new Date(now - index * 86400000),
    })),
    { timestamps: false },
  );
  await Patient.insertMany(
    Array.from({ length: 84 }, (_, index) => {
      const doctorIndex = (index * 3 + Math.floor(index / 7)) % doctors.length;
      const daysAgo = (index * 7 + Math.floor(index / 3)) % 90;
      const name = `${firstNames[index % firstNames.length]} ${lastNames[(Math.floor(index / firstNames.length) * 3) % lastNames.length]}`;
      return {
        name,
        age: 18 + ((index * 7) % 62),
        gender: index % 3 === 0 ? 'Male' : 'Female',
        condition: conditions[doctorIndex],
        status: index % 11 === 0 ? 'Critical' : index % 4 === 0 ? 'Recovered' : 'Active',
        phone: `+880 1800 000${String(index).padStart(3, '0')}`,
        email: `patient${index + 1}@doctortracker.demo`,
        doctorId: doctors[doctorIndex]._id,
        searchTokens: searchTokens(
          name,
          conditions[doctorIndex],
          `+880 1800 000${String(index).padStart(3, '0')}`,
          `patient${index + 1}@doctortracker.demo`,
        ),
        createdAt: new Date(now - daysAgo * 86400000),
        updatedAt: new Date(now - daysAgo * 86400000),
      };
    }),
    { timestamps: false },
  );
  console.info('Created 14 doctors and 84 synthetic patients for the local demo.');
}
