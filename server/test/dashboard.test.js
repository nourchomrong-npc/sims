import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDashboardAttendance,
  buildDashboardAttendanceLeaders,
  buildDashboardEnrollment,
  dashboardBucket,
  dashboardMonthStart,
  dashboardShiftDate
} from '../src/utils/dashboard.js';

test('enrollment timeline includes chronological zero months and actual monthly totals', () => {
  assert.deepEqual(
    buildDashboardEnrollment('2025-12-15', '2026-03-10', [
      { month: '2025-12', total: '2' },
      { month: '2026-02', total: '3' }
    ]),
    [
      { month: '2025-12', total: 2 },
      { month: '2026-01', total: 0 },
      { month: '2026-02', total: 3 },
      { month: '2026-03', total: 0 }
    ]
  );
});

test('daily attendance fills missing dates and keeps each status separate', () => {
  assert.deepEqual(
    buildDashboardAttendance('2026-03-01', '2026-03-03', 'day', [
      { date: '2026-03-01', status: 'Present', total: '2' },
      { date: '2026-03-01', status: 'Late', total: '1' },
      { date: '2026-03-01', status: 'Absent', total: '1' },
      { date: '2026-03-03', status: 'Excused', total: '2' }
    ]),
    [
      { date: '2026-03-01', present: 2, late: 1, absent: 1, excused: 0, rate: 75 },
      { date: '2026-03-02', present: 0, late: 0, absent: 0, excused: 0, rate: null },
      { date: '2026-03-03', present: 0, late: 0, absent: 0, excused: 2, rate: 0 }
    ]
  );
});

test('attendance buckets aggregate longer date ranges by Monday-start week', () => {
  const rows = buildDashboardAttendance('2026-03-03', '2026-03-10', 'week', [
    { date: '2026-03-03', status: 'Present', total: 3 },
    { date: '2026-03-10', status: 'Absent', total: 1 }
  ]);
  assert.deepEqual(rows.map(row => row.date), ['2026-03-02', '2026-03-09']);
  assert.equal(rows[0].rate, 100);
  assert.equal(rows[1].rate, 0);
});

test('attendance buckets accept PostgreSQL DATE values parsed as local Date objects', () => {
  const rows = buildDashboardAttendance('2026-03-02', '2026-03-08', 'week', [
    { date: new Date(2026, 2, 3), status: 'Present', total: 2 }
  ]);
  assert.deepEqual(rows.map(row => row.date), ['2026-03-02']);
  assert.equal(rows[0].present, 2);
});

test('daily attendance fills active timetable weekdays and preserves unscheduled recorded dates', () => {
  const rows = buildDashboardAttendance('2026-03-02', '2026-03-08', 'day', [
    { date: '2026-03-08', status: 'Excused', total: 1 }
  ], [1, 3, 5]);
  assert.deepEqual(rows.map(row => row.date), [
    '2026-03-02', '2026-03-04', '2026-03-06', '2026-03-08'
  ]);
  assert.equal(rows[0].rate, null);
  assert.equal(rows[3].excused, 1);
});

test('long attendance ranges stay aggregated into monthly chart points', () => {
  const rows = buildDashboardAttendance('2025-01-01', '2025-12-31', 'month', []);
  assert.equal(rows.length, 12);
  assert.equal(rows[0].date, '2025-01');
  assert.equal(rows[11].date, '2025-12');
  assert.ok(rows.every(row => row.rate === null));
});

test('attendance leaders rank students by each status and omit zero-count results', () => {
  const leaders = buildDashboardAttendanceLeaders([
    { id: 'a', english_name: 'Nita', present: '3', absent: '0', late: '1', excused: '0' },
    { id: 'b', english_name: 'Bora', present: '5', absent: '2', late: '0', excused: '1' },
    { id: 'c', english_name: 'Dara', present: '5', absent: '1', late: '2', excused: '0' }
  ], 2);
  assert.deepEqual(leaders.present.map(row => [row.english_name, row.total]), [['Bora', 5], ['Dara', 5]]);
  assert.deepEqual(leaders.absent.map(row => [row.english_name, row.total]), [['Bora', 2], ['Dara', 1]]);
  assert.deepEqual(leaders.late.map(row => [row.english_name, row.total]), [['Dara', 2], ['Nita', 1]]);
  assert.deepEqual(leaders.excused.map(row => [row.english_name, row.total]), [['Bora', 1]]);
});

test('dashboard date helpers preserve calendar dates across month and year boundaries', () => {
  assert.equal(dashboardShiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(dashboardMonthStart('2026-01-31', -1), '2025-12-01');
  assert.equal(dashboardBucket('2026-03-01', 'week'), '2026-02-23');
});
