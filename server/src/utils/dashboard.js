export function dashboardDateInPhnomPenh() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dashboardShiftDate(date, days) {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function dashboardMonthStart(date, offset = 0) {
  const shifted = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  shifted.setUTCMonth(shifted.getUTCMonth() + offset);
  return shifted.toISOString().slice(0, 10);
}

export function dashboardBucket(date, interval) {
  if (interval === 'month') return date.slice(0, 7);
  if (interval === 'day') return date;
  const dateObject = new Date(`${date}T00:00:00Z`);
  const mondayOffset = (dateObject.getUTCDay() + 6) % 7;
  return dashboardShiftDate(date, -mondayOffset);
}

function dashboardWeekday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day || 7;
}

export function buildDashboardEnrollment(startDate, endDate, enrollmentRows) {
  const totalsByMonth = new Map(enrollmentRows.map(row => [row.month, Number(row.total)]));
  const enrollment = [];
  for (let month = dashboardMonthStart(startDate); month <= dashboardMonthStart(endDate); month = dashboardMonthStart(month, 1)) {
    enrollment.push({ month: month.slice(0, 7), total: totalsByMonth.get(month.slice(0, 7)) || 0 });
  }
  return enrollment;
}

export function buildDashboardAttendance(startDate, endDate, interval, attendanceRows, schoolDays = []) {
  const buckets = new Map();
  const scheduledDays = new Set(schoolDays.map(Number));
  for (let date = startDate; date <= endDate; date = dashboardShiftDate(date, 1)) {
    if (scheduledDays.size && !scheduledDays.has(dashboardWeekday(date))) continue;
    const key = dashboardBucket(date, interval);
    if (!buckets.has(key)) {
      buckets.set(key, { date: key, present: 0, late: 0, absent: 0, excused: 0, rate: null });
    }
  }
  for (const row of attendanceRows) {
    const date = row.date instanceof Date
      ? `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}-${String(row.date.getDate()).padStart(2, '0')}`
      : String(row.date).slice(0, 10);
    const key = dashboardBucket(date, interval);
    if (!buckets.has(key)) {
      buckets.set(key, { date: key, present: 0, late: 0, absent: 0, excused: 0, rate: null });
    }
    buckets.get(key)[row.status.toLowerCase()] += Number(row.total);
  }
  for (const bucket of buckets.values()) {
    const recorded = bucket.present + bucket.late + bucket.absent + bucket.excused;
    bucket.rate = recorded ? Math.round((bucket.present + bucket.late) / recorded * 1000) / 10 : null;
  }
  return [...buckets.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function buildDashboardAttendanceLeaders(rows, limit = 5) {
  const statuses = ['present', 'absent', 'late', 'excused'];
  return Object.fromEntries(statuses.map(status => [
    status,
    rows
      .filter(row => Number(row[status]) > 0)
      .sort((left, right) => Number(right[status]) - Number(left[status]) ||
        String(left.english_name).localeCompare(String(right.english_name)))
      .slice(0, limit)
      .map(row => ({ ...row, total: Number(row[status]) }))
  ]));
}
