import test from 'node:test';
import assert from 'node:assert/strict';
import { academicYearInput, displayNameSchema, loginInput, parse, studentInput } from '../src/utils/validation.js';

const student = {
  student_code: 'STU-TEST-001',
  english_name: 'Test Student',
  khmer_name: 'Test Student Khmer',
  gender: 'Female',
  date_of_birth: '2015-03-10',
  place_of_birth: 'Phnom Penh',
  phone: '012345678',
  guardian_name: 'Test Guardian',
  guardian_phone: '012345679',
  enrollment_date: '2026-09-01',
  class_id: 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190'
};

test('student input accepts valid core registration fields', () => {
  const result = parse(studentInput, student);
  assert.equal(result.student_code, student.student_code);
  assert.equal(result.status, 'Active');
});

test('display names use title case while preserving code and username values', () => {
  assert.equal(parse(displayNameSchema(150), "  sTUDENT o'NEIL-smITH  "), "Student O'Neil-Smith");
  const result = parse(studentInput, {
    ...student,
    student_code: 'stu-AbC-12',
    english_name: 'jANE DOE',
    guardian_name: 'guardian NAME'
  });
  assert.equal(result.english_name, 'Jane Doe');
  assert.equal(result.guardian_name, 'Guardian Name');
  assert.equal(result.student_code, 'stu-AbC-12');
  assert.equal(parse(loginInput, { username: 'stuUser', password: 'valid-password' }).username, 'stuUser');
});

test('student input allows the server to generate the student code', () => {
  const result = parse(studentInput, { ...student, student_code: undefined });
  assert.equal(result.student_code, undefined);
});

test('student input rejects invalid gender and malformed email', () => {
  assert.throws(() => parse(studentInput, { ...student, gender: 'Unknown' }), { status: 400 });
  assert.throws(() => parse(studentInput, { ...student, email: 'not-an-email' }), { status: 400 });
});

test('student input reports readable limits and rejects oversized text fields', () => {
  assert.throws(
    () => parse(studentInput, { ...student, english_name: 'x'.repeat(151) }),
    error => error.status === 400 && /english_name: Must be no more than 150 characters/.test(error.message)
  );
  assert.throws(
    () => parse(studentInput, { ...student, email: `${'a'.repeat(245)}@example.com` }),
    error => error.status === 400 && /email: Must be no more than 254 characters/.test(error.message)
  );
});

test('student input rejects malformed calendar dates', () => {
  assert.throws(() => parse(studentInput, { ...student, enrollment_date: '2026-02-30' }), { status: 400 });
  assert.throws(() => parse(studentInput, { ...student, date_of_birth: '2015-02-30' }), { status: 400 });
});

test('student input requires all fields except email, address, and photo', () => {
  for (const field of ['english_name', 'khmer_name', 'gender', 'date_of_birth', 'place_of_birth', 'phone', 'guardian_name', 'guardian_phone', 'enrollment_date', 'class_id']) {
    assert.throws(() => parse(studentInput, { ...student, [field]: undefined }), { status: 400 }, `${field} must be required`);
    assert.throws(() => parse(studentInput, { ...student, [field]: null }), { status: 400 }, `${field} must not be null`);
  }
  const optionalFields = parse(studentInput, { ...student, email: null, address: null, photo_data: undefined });
  assert.equal(optionalFields.email, null);
  assert.equal(optionalFields.address, null);
});

test('student updates may omit current class for a legacy unassigned student', () => {
  const { class_id, ...updates } = student;
  assert.equal(parse(studentInput.partial(), { english_name: updates.english_name }).english_name, updates.english_name);
  assert.throws(() => parse(studentInput.partial(), { class_id: null }), { status: 400 });
});

test('student input accepts cropped photo data but rejects oversized uploads', () => {
  const photoData = Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xd9]).toString('base64');
  assert.equal(parse(studentInput, { ...student, photo_data: photoData }).photo_data, photoData);
  assert.throws(() => parse(studentInput, { ...student, photo_data: 'a'.repeat(1_400_001) }), { status: 400 });
});

test('student photo titles are trimmed and validated when provided', () => {
  assert.equal(parse(studentInput, { ...student, photo_title: '  Portrait  ' }).photo_title, 'Portrait');
  assert.throws(() => parse(studentInput, { ...student, photo_title: '   ' }), { status: 400 });
  assert.throws(() => parse(studentInput, { ...student, photo_title: 'x'.repeat(151) }), { status: 400 });
});

test('login input rejects empty and oversized values', () => {
  assert.throws(() => parse(loginInput, { username: '', password: '' }), { status: 400 });
  assert.throws(() => parse(loginInput, { username: 'admin', password: 'x'.repeat(201) }), { status: 400 });
});

test('academic year input validates names, dates, and current-year selection', () => {
  const year = { name: '2026-2027', start_date: '2026-09-01', end_date: '2027-06-30' };
  assert.deepEqual(parse(academicYearInput, year), { ...year, is_current: false });
  assert.equal(parse(academicYearInput, { ...year, is_current: true }).is_current, true);
  assert.throws(
    () => parse(academicYearInput, { ...year, name: 'x'.repeat(31) }),
    error => error.status === 400 && /name: Must be no more than 30 characters/.test(error.message)
  );
  assert.throws(
    () => parse(academicYearInput, { ...year, end_date: '2026-08-31' }),
    error => error.status === 400 && /end_date: End date must be after start date/.test(error.message)
  );
});
