export function resultLabel(result) {
  const category = String(result?.category ?? '').trim().toLowerCase();
  if (category === 'student' || category === 'students') return result.english_name || result.full_name || result.student_code;
  if (category === 'teacher' || category === 'teachers') return result.full_name || result.teacher_code || result.english_name;
  if (category === 'class' || category === 'classes') return `${result.grade_level || ''}${result.grade_level && result.name ? ' · ' : ''}${result.name || result.class_name || ''}`.trim();
  if (category === 'subject' || category === 'subjects') return `${result.code || ''}${result.code && result.name ? ' · ' : ''}${result.name || ''}`.trim();
  if (category === 'class schedule' || category === 'class schedules') return `${result.class_name || result.name || ''}${(result.class_name || result.name) && result.subject ? ' · ' : ''}${result.subject || ''}`.trim();
  if (category === 'attendance') return `${result.english_name || result.student_code || ''}${(result.english_name || result.student_code) && result.status ? ' · ' : ''}${result.status || ''}`.trim();
  if (category === 'academic result' || category === 'academic results') return `${result.english_name || result.student_code || result.name || ''}${(result.english_name || result.student_code || result.name) && (result.assessment || result.title) ? ' · ' : ''}${result.assessment || result.title || ''}`.trim();
  return `${result.english_name || result.full_name || result.name || result.title || result.assessment || result.student_code || ''}${(result.english_name || result.full_name || result.name || result.title || result.assessment || result.student_code) && result.subject ? ' · ' : ''}${result.subject || ''}`.trim();
}

export function resultDescription(result) {
  const category = String(result?.category ?? '').trim().toLowerCase();
  if (category === 'student' || category === 'students') return [result.student_code, result.class_name, result.phone, result.email].filter(Boolean).join(' · ');
  if (category === 'teacher' || category === 'teachers') return [result.teacher_code, result.email, result.phone].filter(Boolean).join(' · ');
  if (category === 'class' || category === 'classes') return [result.academic_year, `${result.student_count} students`].filter(Boolean).join(' · ');
  if (category === 'subject' || category === 'subjects') return result.description || result.code;
  if (category === 'class schedule' || category === 'class schedules') {
    const now = [...Array(7).keys()];
    const weekday = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][result.day_of_week - 1];
    return [weekday, `${result.start_time || ''}–${result.end_time || ''}`.replace(/^–$|^\s*–\s*$/, ''), result.teacher_name].filter(Boolean).join(' · ');
  }
  if (category === 'attendance') return [result.student_code, result.class_name, result.subject, result.attendance_date].filter(Boolean).join(' · ');
  return [result.student_code, result.class_name, result.subject, result.term_name, `${result.score}/${result.maximum_score} (${result.percentage}%)`].filter(Boolean).join(' · ');
}
