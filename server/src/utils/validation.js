import { z } from 'zod';

export const publicId = z.string().uuid().transform(value => value.toLowerCase());
export const idParam = z.object({ id: publicId });
const optionalPublicId = publicId.nullable().optional();

export function titleCaseDisplayName(value) {
  return value.toLocaleLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, separator, character) =>
    `${separator}${character.toLocaleUpperCase()}`
  );
}

export function displayNameSchema(maxLength) {
  return z.string().trim().min(1).max(maxLength).transform(titleCaseDisplayName);
}

export const studentInput = z.object({
  student_code: z.string().trim().min(1).max(30).optional(),
  english_name: displayNameSchema(150),
  khmer_name: displayNameSchema(150),
  gender: z.enum(['Female', 'Male', 'Other']),
  date_of_birth: z.string().date(),
  place_of_birth: z.string().trim().min(1).max(255),
  address: z.string().trim().max(500).optional().nullable(),
  phone: z.string().trim().min(1).max(30),
  email: z.string().trim().max(254).email().optional().nullable().or(z.literal('')),
  guardian_name: displayNameSchema(150),
  guardian_phone: z.string().trim().min(1).max(30),
  enrollment_date: z.string().date(),
  photo_title: z.string().trim().min(1).max(150).optional(),
  status: z.enum(['Active', 'Archived', 'Graduated', 'Withdrawn']).default('Active'),
  photo_data: z.string().max(1_400_000).optional(),
  remove_photo: z.boolean().optional(),
  class_id: publicId
});

export const loginInput = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200)
});

export const academicYearInput = z.object({
  name: z.string().trim().min(1).max(30),
  start_date: z.string().date(),
  end_date: z.string().date(),
  is_current: z.boolean().default(false)
}).refine(value => value.end_date > value.start_date, {
  path: ['end_date'], message: 'End date must be after start date'
});

function formatValidationIssue(issue) {
  const field = issue.path.join('.') || 'Input';
  if (issue.code === 'too_big' && issue.origin === 'string') {
    return `${field}: Must be no more than ${issue.maximum} characters.`;
  }
  if (issue.code === 'too_small' && issue.origin === 'string') {
    return `${field}: ${issue.minimum === 1 ? 'This field is required.' : `Must be at least ${issue.minimum} characters.`}`;
  }
  if (issue.code === 'too_big' && issue.origin === 'number') {
    return `${field}: Must be no more than ${issue.maximum}.`;
  }
  if (issue.code === 'too_small' && issue.origin === 'number') {
    return `${field}: Must be at least ${issue.minimum}.`;
  }
  if (issue.code === 'invalid_format' && issue.format === 'email') {
    return `${field}: Enter a valid email address.`;
  }
  if (issue.code === 'invalid_format' && issue.format === 'date') {
    return `${field}: Enter a valid date.`;
  }
  return `${field}: ${issue.message}`;
}

export function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error(result.error.issues.map(formatValidationIssue).join(' '));
    error.status = 400;
    throw error;
  }
  return result.data;
}
