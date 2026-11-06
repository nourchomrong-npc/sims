export const API_PREFIX = '/api';

export const apiRoutes = Object.freeze({
  live: `${API_PREFIX}/live`,
  ready: `${API_PREFIX}/ready`,
  health: `${API_PREFIX}/health`,
  dashboard: '/dashboard',
  meta: '/meta',
  search: '/search',
  auth: Object.freeze({
    login: '/auth/login',
    logout: '/auth/logout',
    me: '/auth/me',
    password: '/auth/password',
    passwordReset: '/auth/password/reset'
  }),
  trash: Object.freeze({
    collection: '/trash',
    item: '/trash/:entity/:id',
    restore: '/trash/:entity/:id/restore'
  }),
  students: Object.freeze({
    collection: '/students',
    item: '/students/:id',
    timetable: '/students/:id/timetable',
    archive: '/students/:id/archive',
    photo: '/student-photos/:filename'
  }),
  teachers: Object.freeze({
    collection: '/teachers',
    item: '/teachers/:id',
    generateAccount: '/teachers/:id/generate-account',
    assignments: '/teacher-assignments'
  }),
  classes: Object.freeze({
    collection: '/classes',
    item: '/classes/:id',
    results: '/classes/:id/results'
  }),
  classSchedules: Object.freeze({
    collection: '/class-schedules',
    item: '/class-schedules/:id',
    validate: '/class-schedules/validate',
    batch: '/class-schedules/batch',
    restore: '/class-schedules/:id/restore',
    timeSlots: '/class-schedule-time-slots'
  }),
  subjects: Object.freeze({
    collection: '/subjects',
    item: '/subjects/:id'
  }),
  attendance: Object.freeze({
    collection: '/attendance',
    item: '/attendance/:id'
  }),
  assessments: Object.freeze({
    collection: '/assessments',
    item: '/assessments/:id',
    scores: '/assessments/:id/scores'
  }),
  scores: '/scores',
  reports: '/reports/:type',
  decisionSupport: '/dss',
  users: Object.freeze({
    collection: '/users',
    item: '/users/:id',
    resetPassword: '/users/:id/reset-password',
    regeneratePassword: '/users/:id/regenerate-password'
  }),
  activityLogs: '/activity-logs',
  terms: Object.freeze({
    collection: '/terms',
    item: '/terms/:id'
  }),
  academicYears: Object.freeze({
    collection: '/academic-years',
    item: '/academic-years/:id',
    transitionOptions: '/academic-years/transition/options',
    transition: '/academic-years/transition'
  }),
  gradingScales: Object.freeze({
    collection: '/grading-scales',
    item: '/grading-scales/:id'
  }),
  sync: Object.freeze({
    base: '/sync',
    status: '/sync/status',
    history: '/sync/history',
    connectionsTest: '/sync/connections/test',
    mode: '/sync/mode',
    automatic: '/sync/automatic',
    run: '/sync/run',
    retry: '/sync/retry',
    event: '/sync/events/:id',
    resolveConflict: '/sync/conflicts/:id/resolve'
  }),
  visibility: Object.freeze({
    hide: '/:entity/:id/hide',
    delete: '/:entity/:id/delete',
    restore: '/:entity/:id/restore'
  })
});
