type RecordData = Record<string, any>;

export function serializeDoctor(record: RecordData, patientCount = 0) {
  return {
    id: record._id.toString(),
    name: record.name,
    specialization: record.specialization,
    hospital: record.hospital,
    phone: record.phone,
    email: record.email,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    patientCount,
  };
}

export function serializePatient(record: RecordData) {
  const doctor = record.doctorId;
  const populated = doctor && typeof doctor === 'object' && 'name' in doctor;
  const doctorId = (populated ? doctor._id : doctor)?.toString() || '';
  return {
    id: record._id.toString(),
    name: record.name,
    age: record.age,
    gender: record.gender,
    condition: record.condition,
    status: record.status,
    phone: record.phone,
    ...(record.email ? { email: record.email } : {}),
    doctorId,
    doctor: populated
      ? { id: doctorId, name: doctor.name, specialization: doctor.specialization }
      : null,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  };
}

export function serializeUser(user: RecordData) {
  return { id: user._id.toString(), name: user.name, email: user.email, role: user.role };
}

export const pagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});
