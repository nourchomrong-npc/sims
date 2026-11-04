import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowLeft, BookOpen, CalendarCheck, CalendarDays, ChartNoAxesCombined,
  ClipboardList, GraduationCap, LayoutDashboard, LogOut, Menu, PanelRightClose, PanelRightOpen, Plus, Search, Shield, Trash2, Users, UserRound,
  X, Printer, LoaderCircle
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, BarChart, Bar
} from 'recharts';
import { createPortal } from 'react-dom';
import { api, useMutationMessage } from './services/api.js';
import { apiRoute, apiRoutes } from './services/apiRoutes.js';
import { consumeLoginQrHash } from './components/loginQr.js';
import GlobalSearch from './components/GlobalSearch.jsx';
import ActivityLogsPage from './pages/ActivityLogsPage.jsx';
import ClassesPage from './pages/ClassesPage.jsx';
import ClassSchedulePage from './pages/ClassSchedulePage.jsx';
import StudentsPage from './pages/StudentsPage.jsx';
import SubjectsPage from './pages/SubjectsPage.jsx';
import TeachersPage from './pages/TeachersPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import TrashPage from './pages/TrashPage.jsx';
import SyncManagementPanel from './components/SyncManagementPanel.jsx';
import Metric from './components/dashboard/Metric.jsx';
import InsightList from './components/dashboard/InsightList.jsx';
import { ActionMenu, dateInputValue, DetailsPage, Empty, ErrorPanel, FieldInput, formatDate, formatDateTime, formatDisplayValue, formatTime, inputMaxLengths, Loading, Modal, Notice, Pagination, PrintButton, SearchableSelect, SearchSuggestions, StatusBadge, StatusSelect, useDebouncedValue, useLoad } from './components/ui.jsx';

const links = [
  ['Dashboard', LayoutDashboard, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['Class Schedule', CalendarDays, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['Students', GraduationCap, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['Teachers', UserRound, ['Admin', 'SuperAdmin', 'School Manager']],
  ['Classes', Users, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['Subjects', BookOpen, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['Attendance', CalendarCheck, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['Academic Results', ClipboardList, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['MIS Reports', ChartNoAxesCombined, ['Admin', 'SuperAdmin', 'Teacher', 'School Manager']],
  ['Decision Support', Shield, ['Admin', 'SuperAdmin']],
  ['Settings', Shield, ['Admin', 'SuperAdmin']],
  ['Users', Users, ['SuperAdmin', 'Admin', 'School Manager']],
  ['Trash', Trash2, ['Admin', 'SuperAdmin', 'School Manager']],
  ['Activity Logs', Activity, ['Admin', 'SuperAdmin']]
];

const assessmentColumns = [
  ['title', 'Assessment'], ['subject', 'Subject'], ['class_name', 'Class'], ['term_name', 'Term'],
  ['assessment_date', 'Assessment date'], ['maximum_score', 'Max score'], ['score_count', 'Scores entered'], ['created_at', 'Created']
];
const scoreCommentOptions = [
  { id: 'with-comment', label: 'Has comment' },
  { id: 'without-comment', label: 'No comment' }
];
const scoreSortOptions = [
  { id: 'name', label: 'Student name' },
  { id: 'score-high', label: 'Highest score' },
  { id: 'score-low', label: 'Lowest score' }
];

const reportTypes = [
  ['enrollment', 'Student enrollment'], ['students-by-class', 'Students by class and grade'],
  ['attendance', 'Daily attendance history'], ['attendance-monthly', 'Monthly attendance summary'],
  ['frequent-absence', 'Frequent absences'],
  ['results', 'Academic results'], ['class-performance', 'Class performance comparison'],
  ['enrollment-trends', 'Enrollment trends']
];

const reportQuickFilterFields = {
  enrollment: ['class_name', 'grade_level', 'gender'],
  attendance: ['class_name', 'subject_name', 'status'],
  'attendance-monthly': ['month', 'class_name', 'subject_name'],
  'frequent-absence': ['class_name', 'subject_name'],
  results: ['grade_level', 'class_name', 'subject', 'term'],
  'class-performance': ['grade_level', 'class_name', 'subject'],
  'students-by-class': ['grade_level', 'class_name'],
  'enrollment-trends': ['month']
};
const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444'];
const localDate = new Date();
localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
const today = localDate.toISOString().slice(0, 10);

export default function App() {
  return <MutationLock><AppContent /></MutationLock>;
}

function MutationLock({ children }) {
  const mutationMessage = useMutationMessage();
  return <>
    {children}
    {mutationMessage && createPortal(
      <div role="status" aria-live="polite" className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/20 backdrop-blur-[1px]">
        <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 text-sm font-semibold text-slate-800 shadow-xl">
          <LoaderCircle size={20} className="animate-spin text-blue-600" />
          {mutationMessage}
        </div>
      </div>,
      document.body
    )}
  </>;
}

function AppContent() {
  const [qrResult] = useState(() => {
    const result = consumeLoginQrHash(window.location.hash);
    if (result.found) {
      window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
    }
    return result;
  });
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [page, setPage] = useState('Dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(() => localStorage.getItem('school-mis-sidebar-pinned') !== 'false');
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [notice, setNotice] = useState(null);
  const [authMessage, setAuthMessage] = useState('');
  const [globalSearchResult, setGlobalSearchResult] = useState(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const setError = message => setNotice(message ? { message, type: 'error' } : null);
  const setSuccess = message => setNotice(message ? { message, type: 'success' } : null);
  function navigateTo(label) {
    if (hasUnsavedChanges && !window.confirm('Discard unsaved timetable changes?')) return;
    setHasUnsavedChanges(false);
    setPage(label);
    setGlobalSearchResult(null);
    setMobileOpen(false);
    setError('');
    setSuccess('');
  }

  useEffect(() => {
    if (qrResult.found) {
      setAuthReady(true);
      return;
    }
    api(apiRoutes.auth.me, { suppressSessionExpired: true }).then(({ user: current }) => {
      setUser(current);
      setPasswordRequired(current.must_change_password);
    }).catch(error => {
      if (error.code === 'ACCOUNT_DISABLED') setAuthMessage(error.message);
    }).finally(() => setAuthReady(true));
  }, [qrResult.found]);
  useEffect(() => {
    const handleAccountDisabled = event => {
      setAuthMessage(event.detail);
      setUser(null);
      setPasswordRequired(false);
    };
    const handleSessionExpired = () => {
      setAuthMessage('Your session has expired. Please sign in again.');
      setUser(null);
      setPasswordRequired(false);
    };
    window.addEventListener('sims:account-disabled', handleAccountDisabled);
    window.addEventListener('sims:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('sims:account-disabled', handleAccountDisabled);
      window.removeEventListener('sims:session-expired', handleSessionExpired);
    };
  }, []);
  useEffect(() => {
    if (!user) return undefined;
    const timer = window.setInterval(() => {
      api(apiRoutes.auth.me).catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [user?.id]);
  useEffect(() => {
    localStorage.setItem('school-mis-sidebar-pinned', String(sidebarPinned));
  }, [sidebarPinned]);
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = event => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen]);

  async function login(values) {
    const result = await api(apiRoutes.auth.login, { method: 'POST', body: JSON.stringify(values) });
    setUser(result.user);
    setPasswordRequired(result.user.must_change_password);
    setPage('Dashboard');
    setAuthMessage('');
    setError('');
  }
  async function logout() {
    if (hasUnsavedChanges && !window.confirm('Discard unsaved timetable changes?')) return;
    setHasUnsavedChanges(false);
    await api(apiRoutes.auth.logout, { method: 'POST' });
    setUser(null);
    setPasswordRequired(false);
  }
  async function changePassword(values) {
    await api(apiRoutes.auth.password, { method: 'POST', body: JSON.stringify(values) });
    setPasswordRequired(false);
    setUser({ ...user, must_change_password: false });
    setSuccess('Password changed successfully.');
  }
  if (!authReady) return <div className="grid min-h-screen place-items-center text-slate-500"><LoaderCircle className="animate-spin" /></div>;
  if (!user) return <Login onLogin={login} message={authMessage} initialQr={qrResult} />;
  if (passwordRequired) return <PasswordChange onSubmit={changePassword} />;

  const allowedLinks = links.filter(([, , roles]) => roles.includes(user.role));
  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      {mobileOpen && <button type="button" className="mobile-nav-backdrop fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-[1px] lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside id="app-sidebar" aria-label="Main navigation" role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} className={`no-print fixed inset-y-0 left-0 z-50 flex w-[258px] max-w-[calc(100vw-3rem)] flex-col border-r border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-xl transition-transform duration-200 motion-reduce:transition-none lg:translate-x-0 lg:shadow-none ${sidebarPinned ? 'lg:w-[258px]' : 'lg:w-[76px]'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className={`flex h-[76px] shrink-0 items-center gap-3 border-b border-slate-100 ${sidebarPinned || mobileOpen ? 'px-4 sm:px-6' : 'justify-center px-2 lg:px-0'}`}>
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white"><GraduationCap size={23} /></div>
          <div className={sidebarPinned || mobileOpen ? '' : 'lg:hidden'}><div className="font-bold tracking-tight text-navy">SCHOOL MIS</div><div className="text-[11px] font-medium tracking-wide text-slate-400">STUDENT INFORMATION</div></div>
          <button type="button" onClick={() => setSidebarPinned(value => !value)} aria-label={sidebarPinned ? 'Collapse sidebar' : 'Expand sidebar'} aria-pressed={sidebarPinned} title={sidebarPinned ? 'Collapse sidebar' : 'Expand sidebar'} className={`hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 lg:flex ${sidebarPinned ? 'ml-auto' : 'absolute right-2 top-5'}`}>
            {sidebarPinned ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
          <button type="button" className="ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <nav className={`scrollbar flex-1 space-y-1 overflow-y-auto overscroll-contain py-5 ${sidebarPinned || mobileOpen ? 'px-3' : 'px-2 lg:px-1'}`}>
          <div className={`px-3 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-400 ${sidebarPinned || mobileOpen ? '' : 'lg:hidden'}`}>Workspace</div>
          {allowedLinks.map(([label, Icon]) => <button key={label} onClick={() => navigateTo(label)}
            aria-current={page === label ? 'page' : undefined}
            aria-label={label}
            title={label}
            style={page === label ? { borderLeftColor: '#2563eb', backgroundColor: '#eff6ff', color: '#1d4ed8' } : undefined}
            className={`relative flex w-full items-center gap-3 rounded-lg border-l-4 py-2.5 text-left text-[13px] font-medium transition ${sidebarPinned || mobileOpen ? 'px-3' : 'justify-center px-2 lg:px-0'} ${page === label ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-navy'}`}>
            <Icon className="shrink-0" size={17} strokeWidth={page === label ? 2.2 : 1.9} />{(sidebarPinned || mobileOpen) && <span className="truncate">{label}</span>}
          </button>)}
        </nav>
        <div className={`border-t border-slate-100 ${sidebarPinned || mobileOpen ? 'p-4' : 'p-2 lg:px-1 lg:py-3'}`}>
          <div className={`mb-3 flex items-center gap-3 ${sidebarPinned || mobileOpen ? '' : 'justify-center'}`}>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">{user.full_name?.[0]?.toUpperCase()}</div>
            {(sidebarPinned || mobileOpen) && <div className="min-w-0"><div className="truncate text-sm font-semibold">{user.full_name}</div><div className="text-xs text-slate-500">{user.role}</div></div>}
          </div>
          <button type="button" onClick={logout} aria-label="Sign out" title="Sign out" className={`flex w-full items-center gap-2 rounded-lg py-2 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600 ${sidebarPinned || mobileOpen ? 'px-3' : 'justify-center px-2 lg:px-0'}`}><LogOut size={16} />{(sidebarPinned || mobileOpen) && 'Sign out'}</button>
        </div>
      </aside>
      <div className={`${sidebarPinned ? 'lg:pl-[258px]' : 'lg:pl-[76px]'} print-content ${page === 'Class Schedule' ? 'print-page-schedule' : page === 'MIS Reports' ? 'print-page-mis-report' : page === 'Decision Support' ? 'print-page-decision-support' : page === 'Academic Results' ? 'print-page-academic-results' : ['Students', 'Teachers', 'Classes', 'Subjects', 'Users'].includes(page) ? 'print-page-record-list' : ''}`}>
        <header className="no-print sticky top-0 z-10 grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:flex sm:h-[76px] sm:px-8">
          <button type="button" className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="app-sidebar"><Menu size={21} /></button>
          <div className="min-w-0"><div className="truncate text-[11px] font-medium text-slate-400 sm:text-xs">School administration / <span className="text-slate-600">{page}</span></div><h1 className="mt-0.5 truncate text-lg font-bold text-navy">{page}</h1></div>
          <div className="col-span-2 flex min-w-0 items-center gap-2 sm:ml-auto sm:w-auto sm:gap-3"><div className="min-w-0 flex-1 sm:w-[min(360px,28vw)] sm:flex-none"><GlobalSearch onSelect={result => {
            if (hasUnsavedChanges && !window.confirm('Discard unsaved timetable changes?')) return;
            setHasUnsavedChanges(false);
            setPage(result.page);
            setGlobalSearchResult(result);
          }} /></div><span className="hidden text-sm text-slate-500 sm:block">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</span><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-navy"><UserRound size={17} /></div></div>
        </header>
        {!['Dashboard', 'Class Schedule', 'Students', 'Teachers', 'Classes', 'Subjects', 'Users', 'Trash', 'Activity Logs', 'Settings', 'Attendance', 'Academic Results', 'MIS Reports', 'Decision Support'].includes(page) && <h1 className="print-only mx-auto mb-4 mt-2 max-w-[1500px] text-xl font-bold">{page}</h1>}
        <main className="mx-auto max-w-[1500px] p-4 sm:p-7">
          {globalSearchResult ? <DetailsPage
            title={`${globalSearchResult.category} details`}
            details={Object.entries(globalSearchResult)
              .filter(([key]) => !['page', 'category', 'searchTerm'].includes(key))
              .map(([key, value]) => [
                key.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()), value
              ])}
            onBack={() => setGlobalSearchResult(null)}
          /> : page === 'Dashboard' ? <Dashboard user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'MIS Reports' ? <Reports /> :
            page === 'Decision Support' ? <DecisionSupport /> :
            page === 'Settings' ? <SettingsPage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Attendance' ? <AttendancePage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Academic Results' ? <ResultsPage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Students' ? <StudentsPage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Teachers' ? <TeachersPage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Classes' ? <ClassesPage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Class Schedule' ? <ClassSchedulePage user={user} onError={setError} onSuccess={setSuccess} onDraftChange={setHasUnsavedChanges} /> :
            page === 'Subjects' ? <SubjectsPage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Users' ? <UsersPage user={user} onError={setError} onSuccess={setSuccess} /> :
            page === 'Trash' ? <TrashPage user={user} onError={setError} onSuccess={setSuccess} /> :
            <ActivityLogsPage user={user} onError={setError} onSuccess={setSuccess} />}
        </main>
      </div>
      {notice && <Notice message={notice.message} type={notice.type} onClose={() => setNotice(null)} />}
    </div>
  );
}

function Login({ onLogin, message, initialQr }) {
  const [username, setUsername] = useState(initialQr.credentials?.username || '');
  const [password, setPassword] = useState(initialQr.credentials?.password || '');
  const [error, setError] = useState(initialQr.error);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    try { await onLogin({ username, password }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4">
    <form onSubmit={submit} className="sims-panel w-full max-w-md !p-8">
      <div className="mb-7 flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-600 text-white"><GraduationCap /></div><div><h1 className="text-xl font-bold">School MIS</h1><p className="text-sm text-slate-500">Sign in to your account</p></div></div>
      {message && <Notice type="error" message={message} />}
      {error && <Notice type="error" message={error} />}
      {initialQr.credentials && <p role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">Credentials filled from the QR code. Select Sign in to continue.</p>}
      <label className="mb-4 block text-sm font-medium">Username<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" required /></label>
      <label className="mb-6 block text-sm font-medium">Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" required /></label>
      <button type="submit" disabled={busy} className="primary-action flex w-full items-center justify-center gap-2 rounded-lg py-2.5 font-bold disabled:cursor-wait disabled:opacity-60">{busy && <LoaderCircle size={16} className="animate-spin" />}Sign in</button>
    </form>
  </div>;
}

function PasswordChange({ onSubmit }) {
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    if (form.get('new_password') !== form.get('confirm_password')) return setError('New passwords do not match');
    try { await onSubmit({ new_password: form.get('new_password') }); } catch (err) { setError(err.message); }
  }
  return <div className="grid min-h-screen place-items-center bg-[#f5f7fb] p-4"><form onSubmit={submit} className="w-full max-w-md space-y-4 border-y border-slate-200 bg-white/70 px-6 py-8">
    <h1 className="text-xl font-bold">Change your password</h1><p className="text-sm text-slate-500">This account must set a new password before continuing.</p>
    {error && <Notice type="error" message={error} />}
    <p className="text-sm text-slate-500">You signed in with your temporary password. Choose a new password to continue.</p>
    <FieldInput name="new_password" label="New password (at least 12 characters)" type="password" required minLength={12} maxLength={null} />
    <FieldInput name="confirm_password" label="Confirm new password" type="password" required minLength={12} maxLength={null} />
    <button type="submit" className="primary-action w-full rounded-lg py-2.5 font-bold">Save new password</button>
  </form></div>;
}



function dateInPhnomPenh() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Phnom_Penh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDashboardDate(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dashboardMonthLabel(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return String(value || '—');
  }
  const date = new Date(`${value}-01T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .format(date);
}

function dashboardDateLabel(value, interval) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value)) {
    return String(value || '—');
  }
  const date = new Date(`${value.length === 7 ? `${value}-01` : value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: interval === 'month' ? undefined : 'numeric',
    year: interval === 'month' ? '2-digit' : undefined, timeZone: 'UTC'
  }).format(date);
}

function DashboardChartTooltip({ active, payload, label, type, interval }) {
  if (!active || !payload?.length) return null;
  const record = payload[0].payload;
  const labelText = type === 'enrollment'
    ? dashboardMonthLabel(label)
    : type === 'attendance' || type === 'rate'
      ? dashboardDateLabel(label, interval)
      : String(label ?? record.subject ?? '—');
  return <div className="rounded border border-slate-200 bg-white px-3 py-2 text-sm shadow-lg">
    <div className="mb-1 font-semibold text-slate-800">{labelText}</div>
    {type === 'enrollment' && <div className="text-slate-700">New enrollments: {record.total}</div>}
    {type === 'attendance' && payload.map(item => <div key={item.dataKey} className="text-slate-700">{item.name}: {item.value}</div>)}
    {type === 'rate' && <div className="text-slate-700">{record.rate == null ? 'No recorded attendance' : `Attendance rate: ${record.rate}%`}</div>}
    {type === 'performance' && <>
      <div className="text-slate-700">Average: {record.average}%</div>
      <div className="text-slate-700">Scores: {record.score_count}</div>
      <div className="text-slate-700">Assessments: {record.assessment_count}</div>
    </>}
  </div>;
}

function Dashboard({ user }) {
  const allTeacherScores = user.role === 'Teacher';
  const [period, setPeriod] = useState('180');
  const [classId, setClassId] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [attendanceStatus, setAttendanceStatus] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const { data: meta } = useLoad(apiRoutes.meta);
  const dashboardParams = new URLSearchParams({ period });
  if (classId) dashboardParams.set('class_id', classId);
  if (gradeLevel) dashboardParams.set('grade_level', gradeLevel);
  if (academicYearId) dashboardParams.set('academic_year_id', academicYearId);
  if (termId) dashboardParams.set('term_id', termId);
  if (subjectId) dashboardParams.set('subject_id', subjectId);
  if (period === 'custom') {
    if (customFrom) dashboardParams.set('from', customFrom);
    if (customTo) dashboardParams.set('to', customTo);
  }
  const dashboardUrl = useDebouncedValue(`${apiRoutes.dashboard}?${dashboardParams.toString()}`, 500);
  const { data, error, loading } = useLoad(dashboardUrl);
  if (loading) return <Loading />;
  if (error) return <ErrorPanel message={error} />;
  const totals = data.totals;
  const periodLabel = period === 'custom'
    ? `${customFrom} to ${customTo}`
    : ({ '1': 'today', '30': '30 days', '180': '6 months', '365': '12 months' })[period];
  const attendanceMetricLabel = period === 'custom'
    ? `Attendance (${customFrom} to ${customTo})`
    : ({ '1': "Today's attendance", '30': '30-day attendance', '180': '6-month attendance', '365': '12-month attendance' })[period] || 'Selected-period attendance';
  const attendanceMetricScope = period === 'custom'
    ? `${customFrom} to ${customTo}`
    : ({ '1': 'today', '30': 'the last 30 days', '180': 'the last 6 months', '365': 'the last 12 months' })[period] || 'the selected date range';
  const gradeOptions = [...new Set((meta?.classes || []).map(row => row.grade_level))].sort();
  const dashboardTerms = (meta?.dashboardTerms || []).filter(term =>
    !academicYearId || term.academic_year_id === academicYearId
  );
  const filteredClasses = (meta?.classes || []).filter(row =>
    (!academicYearId || row.academic_year_id === academicYearId) &&
    (!gradeLevel || row.grade_level === gradeLevel)
  );
  const schoolYearLabel = (meta?.academicYears || []).find(row => row.id === academicYearId)?.name;
  const selectedTermLabel = dashboardTerms.find(row => row.id === termId)?.name;
  const cards = [
    ['Total students', totals.students, GraduationCap, classId ? 'Active in selected class' : 'Currently active'],
    ['Teachers', totals.teachers, UserRound, classId ? 'Assigned to selected class' : 'Active staff'],
    ['Classes', totals.classes, Users, classId ? 'Selected class' : 'Academic groups'],
    ['Subjects', totals.subjects, BookOpen, classId ? 'Scheduled in selected class' : 'Active subjects']
  ];
  const visibleStatuses = attendanceStatus ? [attendanceStatus] : ['present', 'late', 'absent', 'excused'];
  const resetFilters = () => {
    setPeriod('180');
    setClassId('');
    setGradeLevel('');
    setAcademicYearId('');
    setTermId('');
    setSubjectId('');
    setAttendanceStatus('');
    setCustomFrom('');
    setCustomTo('');
  };
  const hasFilters = period !== '180' || classId || gradeLevel || academicYearId || termId || subjectId || attendanceStatus;
  const rangeLabel = data.range ? `${data.range.from} – ${data.range.to}` : periodLabel;
  const attendanceTotals = data.attendance.reduce((totals, row) => ({
    present: totals.present + row.present,
    late: totals.late + row.late,
    absent: totals.absent + row.absent,
    excused: totals.excused + row.excused
  }), { present: 0, late: 0, absent: 0, excused: 0 });
  const printFilters = [
    ['Class', classId ? filteredClasses.find(row => row.id === classId)?.name : 'All classes'],
    ['Subject', subjectId ? meta?.subjects.find(row => row.id === subjectId)?.name : 'All subjects'],
    ['Grade', gradeLevel || 'All grades'],
    ['Academic year', schoolYearLabel || 'All years'],
    ['Term', selectedTermLabel || 'All terms']
  ];
  const hasEnrollment = data.enrollment.some(row => row.total > 0);
  const hasAttendance = data.attendance.some(row => row.present + row.late + row.absent + row.excused > 0);
  const attendanceLeaderGroups = [
    ['present', 'Most Present records', 'text-green-700'],
    ['absent', 'Most Absent records', 'text-red-700'],
    ['late', 'Most Late records', 'text-sky-700'],
    ['excused', 'Most Excused records', 'text-amber-700']
  ];
  return <>
  <div className="dashboard-screen space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-2xl font-bold tracking-tight">Good day, welcome back</h2><p className="mt-1 text-sm text-slate-500">A live overview of your school records.</p></div><span className="rounded-full bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700">● Database connected</span></div>
    <section className="sims-panel space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <div className="min-w-0">
        <SearchableSelect name="dashboard_period" label="Reporting period" options={[
          { id: '1', label: 'Today (1 day)' },
          { id: '30', label: 'Last 30 days' },
          { id: '180', label: 'Last 6 months' },
          { id: '365', label: 'Last 12 months' },
          { id: 'custom', label: 'Custom date range' }
        ]} value={period} onChange={value => {
          setPeriod(value);
          if (value === 'custom' && (!customFrom || !customTo)) {
            const end = dateInPhnomPenh();
            setCustomTo(end);
            setCustomFrom(shiftDashboardDate(end, -29));
          }
        }} getOptionId={option => option.id} getOptionLabel={option => option.label}
        getOptionSearchText={option => option.label} emptyValueLabel="Last 6 months" debounceDelay={500} />
      </div>
      {period === 'custom' && <>
        <label className="min-w-0 text-sm font-semibold text-slate-700">From
          <input type="date" value={customFrom} max={customTo || undefined} onChange={event => { if (event.target.value) setCustomFrom(event.target.value); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" />
        </label>
        <label className="min-w-0 text-sm font-semibold text-slate-700">To
          <input type="date" value={customTo} min={customFrom || undefined} onChange={event => { if (event.target.value) setCustomTo(event.target.value); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" />
        </label>
      </>}
      <div className="min-w-0">
        <SearchableSelect name="dashboard_class" label="Class" options={filteredClasses} value={classId}
          onChange={setClassId} getOptionLabel={row => `${row.grade_level} · ${row.name}`}
          getOptionSearchText={row => `${row.grade_level} ${row.name}`} placeholder="Search classes..."
          emptyValueLabel="All available classes" noneLabel="All available classes" debounceDelay={500} />
      </div>
      <div className="min-w-0">
        <SearchableSelect name="dashboard_subject" label="Subject" options={meta?.subjects || []} value={subjectId}
          onChange={setSubjectId} getOptionLabel={row => row.name} getOptionSearchText={row => row.name}
          placeholder="Search subjects..." emptyValueLabel="All subjects" noneLabel="All subjects" debounceDelay={500} />
      </div>
      <div className="min-w-0">
        <SearchableSelect name="dashboard_grade" label="Grade" options={gradeOptions} value={gradeLevel}
          onChange={value => { setGradeLevel(value); setClassId(''); }}
          getOptionId={option => option} getOptionLabel={option => option} getOptionSearchText={option => option}
          placeholder="Search grades..." emptyValueLabel="All grades" noneLabel="All grades" debounceDelay={500} />
      </div>
      <div className="min-w-0">
        <SearchableSelect name="dashboard_year" label="Academic year" options={meta?.academicYears || []} value={academicYearId}
          onChange={value => { setAcademicYearId(value); setClassId(''); setTermId(''); }}
          getOptionLabel={row => row.name} getOptionSearchText={row => row.name} placeholder="Search years..."
          emptyValueLabel="All years" noneLabel="All years" debounceDelay={500} />
      </div>
      <div className="min-w-0">
        <SearchableSelect name="dashboard_term" label="Term" options={dashboardTerms} value={termId}
          onChange={setTermId} getOptionLabel={row => row.name} getOptionSearchText={row => row.name}
          placeholder="Search terms..." emptyValueLabel="All terms" noneLabel="All terms" debounceDelay={500} />
      </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="w-full text-xs leading-relaxed text-slate-600 sm:min-w-0 sm:flex-1">Selected range: <strong>{rangeLabel}</strong>. Filters apply to relevant metrics; term filters academic results. {allTeacherScores ? 'Teacher performance uses available scores for active classes and subjects.' : ''} Review alerts use the last 30 days.</p>
        <div className="grid w-full gap-2 sm:flex sm:w-auto sm:shrink-0">
          <button type="button" onClick={resetFilters} disabled={!hasFilters} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Clear filters</button>
          <PrintButton label="Print dashboard" />
        </div>
      </div>
    </section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon, sub]) => <div key={label} className="sims-panel !p-4"><div className="flex items-start justify-between"><span className="text-sm font-semibold text-slate-600">{label}</span><Icon size={19} className="text-blue-600" /></div><div className="mt-2 text-3xl font-bold tracking-tight text-navy">{value}</div><div className="mt-1 text-xs text-slate-500">{sub}</div></div>)}</div>
    <div className="grid gap-4 sm:grid-cols-2"><Metric title={attendanceMetricLabel} value={totals.attendance_rate == null ? '—' : `${totals.attendance_rate}%`} detail={totals.attendance_rate == null ? `No attendance recorded in ${attendanceMetricScope} for these filters` : `Present and late / recorded in ${attendanceMetricScope}, scoped by class, grade, year, and subject`} /><Metric title="Average performance" value={totals.average_performance == null ? '—' : `${totals.average_performance}%`} detail={totals.average_performance == null ? allTeacherScores ? 'No valid scores for your active classes and subjects' : `No valid scores in ${periodLabel}` : allTeacherScores ? `Valid score percentages across all available scores${selectedTermLabel ? ` · ${selectedTermLabel}` : ''}${schoolYearLabel ? ` · ${schoolYearLabel}` : ''}` : `Valid score percentages in ${periodLabel}${selectedTermLabel ? ` · ${selectedTermLabel}` : ''}${schoolYearLabel ? ` · ${schoolYearLabel}` : ''}`} /></div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <ChartCard title="Enrollment trends" subtitle={hasEnrollment ? `New student enrollments by month · ${rangeLabel}` : `No enrollment history in the selected range · ${rangeLabel}`}>
        <ResponsiveContainer width="100%" height={260}><AreaChart data={data.enrollment} margin={{ left: 2, right: 12, top: 8 }}>
          <defs><linearGradient id="enrollmentFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.2} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tickFormatter={dashboardMonthLabel} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><Tooltip content={<DashboardChartTooltip type="enrollment" />} />
          <Area type="monotone" dataKey="total" name="New enrollments" stroke="#2563eb" strokeWidth={2.5} fill="url(#enrollmentFill)" dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </AreaChart></ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Attendance by status" subtitle={`Recorded attendance entries · ${rangeLabel}`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-slate-600">Display status
            <span className="ml-2 inline-block w-40 align-middle">
              <SearchableSelect name="dashboard_attendance_status" label="Display status" options={[
                { id: 'present', label: 'Present' }, { id: 'late', label: 'Late' },
                { id: 'absent', label: 'Absent' }, { id: 'excused', label: 'Excused' }
              ]} value={attendanceStatus} onChange={setAttendanceStatus}
              getOptionId={option => option.id} getOptionLabel={option => option.label}
              getOptionSearchText={option => option.label} emptyValueLabel="All statuses"
              noneLabel="All statuses" debounceDelay={500} />
            </span>
          </label>
          <span className="text-xs text-slate-500">Showing {data.range.attendance_interval} totals; school days follow active timetables when available.</span>
        </div>
        {hasAttendance ? <ResponsiveContainer width="100%" height={260}><BarChart data={data.attendance} margin={{ left: 2, right: 12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={value => dashboardDateLabel(value, data.range.attendance_interval)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><Tooltip content={<DashboardChartTooltip type="attendance" interval={data.range.attendance_interval} />} /><Legend />
          {visibleStatuses.includes('present') && <Bar dataKey="present" name="Present" stackId="attendance" fill="#16a34a" />}
          {visibleStatuses.includes('late') && <Bar dataKey="late" name="Late" stackId="attendance" fill="#0ea5e9" />}
          {visibleStatuses.includes('absent') && <Bar dataKey="absent" name="Absent" stackId="attendance" fill="#ef4444" />}
          {visibleStatuses.includes('excused') && <Bar dataKey="excused" name="Excused" stackId="attendance" fill="#f59e0b" />}
        </BarChart></ResponsiveContainer> : <Empty text="No recorded attendance entries in the selected range." />}
      </ChartCard>
      <ChartCard title="Attendance percentage" subtitle="Present and Late divided by all recorded attendance entries">
        {hasAttendance ? <ResponsiveContainer width="100%" height={240}><LineChart data={data.attendance} margin={{ left: 2, right: 12, top: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={value => dashboardDateLabel(value, data.range.attendance_interval)} tickLine={false} axisLine={false} tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} unit="%" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><Tooltip content={<DashboardChartTooltip type="rate" interval={data.range.attendance_interval} />} />
          <Line type="monotone" dataKey="rate" name="Attendance rate" stroke="#2563eb" strokeWidth={2.5} connectNulls={false} dot={{ r: 3 }} activeDot={{ r: 5 }} />
        </LineChart></ResponsiveContainer> : <Empty text="No recorded attendance entries in the selected range." />}
      </ChartCard>
      <ChartCard title="Academic performance by subject" subtitle={data.performance.length ? `Mean of valid score percentages · up to 12 subjects by score count · ${allTeacherScores ? 'all available scores for your active assignments' : rangeLabel}` : allTeacherScores ? 'No valid scores for your active assignments and filters' : `No valid scores in the selected range · ${rangeLabel}`}>
        {data.performance.length ? <ResponsiveContainer width="100%" height={Math.max(260, data.performance.length * 38)}><BarChart data={data.performance} layout="vertical" margin={{ left: 12, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" domain={[0, 100]} unit="%" tickLine={false} axisLine={false} />
          <YAxis dataKey="subject" type="category" width={110} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><Tooltip content={<DashboardChartTooltip type="performance" />} />
          <Bar dataKey="average" name="Average %" fill="#6366f1" radius={[0, 5, 5, 0]} />
        </BarChart></ResponsiveContainer> : <Empty text="No valid assessment scores are available for these filters." />}
      </ChartCard>
      <section className="sims-panel min-w-0 xl:col-span-2" aria-labelledby="attendance-leaders-title">
        <div className="mb-4">
          <h3 id="attendance-leaders-title" className="font-semibold text-navy">Attendance leaders</h3>
          <p className="mt-0.5 text-sm text-slate-600">Students with the most attendance records by status · {rangeLabel}</p>
          <p className="mt-1 text-xs text-slate-500">A student may have multiple records for different lessons or dates. Lists use the selected filters.</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
          {attendanceLeaderGroups.map(([status, title, color]) => {
            const students = data.attendanceLeaders?.[status] || [];
            return <div key={status} className="min-w-0">
              <h4 className={`mb-2 text-sm font-semibold ${color}`}>{title}</h4>
              {students.length ? <ol className="divide-y divide-slate-100">
                {students.map((student, index) => <li key={student.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">{index + 1}.</span>
                    <div className="min-w-0"><div className="truncate font-medium text-slate-800">{student.english_name}</div><div className="truncate text-xs text-slate-500">{student.student_code}</div></div>
                  </div>
                  <span className={`shrink-0 font-semibold ${color}`}>{student.total} records</span>
                </li>)}
              </ol> : <p className="py-2 text-sm text-slate-500">No records in this range.</p>}
            </div>;
          })}
        </div>
      </section>
      <div className="sims-panel min-w-0"><div className="mb-4 flex items-center gap-2"><AlertTriangle size={18} className="text-amber-500" /><div><h3 className="font-semibold">Attendance review list</h3><p className="text-xs text-slate-600">Under 80% of recorded entries in the recent 30 days</p></div></div>{data.lowAttendance.length ? <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto">{data.lowAttendance.map(student => <div key={student.id} className="flex items-center justify-between py-3 text-sm"><div><div className="font-medium">{student.english_name}</div><div className="text-xs text-slate-600">{student.student_code}</div></div><span className="text-sm font-semibold text-amber-800">{student.attendance_rate}%</span></div>)}</div> : <Empty text="No students are below the default threshold." />}</div>
    </div>
  </div>
  <div className="print-only dashboard-print">
    <header className="dashboard-print-header">
      <div>
        <p className="dashboard-print-kicker">School MIS · Management report</p>
        <h1>Dashboard</h1>
      </div>
      <div className="dashboard-print-meta">
        <strong>{formatDateTime(new Date())}</strong>
        <span>Reporting period: {formatDate(data.range?.from)} – {formatDate(data.range?.to)}</span>
      </div>
    </header>
    <div className="dashboard-print-filters">
      {printFilters.map(([label, value]) => <span key={label}><strong>{label}:</strong> {value}</span>)}
    </div>
    <section className="dashboard-print-metrics" aria-label="School totals">
      {cards.map(([label, value, , detail]) => <div className="dashboard-print-card" key={label}>
        <span>{label}</span><strong>{value}</strong><small>{detail}</small>
      </div>)}
      <div className="dashboard-print-card">
        <span>{attendanceMetricLabel}</span>
        <strong>{totals.attendance_rate == null ? '—' : `${totals.attendance_rate}%`}</strong>
        <small>Present and late divided by recorded entries</small>
      </div>
      <div className="dashboard-print-card">
        <span>Average performance</span>
        <strong>{totals.average_performance == null ? '—' : `${totals.average_performance}%`}</strong>
        <small>{allTeacherScores ? 'Valid score percentages across all available scores for active assignments' : `Valid score percentages for ${periodLabel}`}</small>
      </div>
    </section>
    <section className="dashboard-print-tables">
      <div>
        <h2>Enrollment by month</h2>
        {data.enrollment.length ? <table>
          <thead><tr><th>Month</th><th>New enrollments</th><th className="print-other-column">Other</th></tr></thead>
          <tbody>{data.enrollment.map(row => <tr key={row.month}>
            <td>{dashboardMonthLabel(row.month)}</td><td>{row.total}</td><td className="print-other-column"></td>
          </tr>)}</tbody>
        </table> : <p>No enrollment history in this range.</p>}
      </div>
      <div>
        <h2>Attendance by status</h2>
        <table>
          <thead><tr><th>Status</th><th>Records</th><th className="print-other-column">Other</th></tr></thead>
          <tbody>{Object.entries(attendanceTotals).map(([status, count]) => <tr key={status}>
              <td>{status[0].toUpperCase() + status.slice(1)}</td><td>{count}</td><td className="print-other-column"></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div>
        <h2>Average performance by subject</h2>
        {data.performance.length ? <table>
          <thead><tr><th>Subject</th><th>Average</th><th>Scores</th><th className="print-other-column">Other</th></tr></thead>
          <tbody>{data.performance.map(row => <tr key={row.subject}>
            <td>{row.subject}</td><td>{row.average}%</td><td>{row.score_count}</td><td className="print-other-column"></td>
          </tr>)}</tbody>
        </table> : <p>{allTeacherScores ? 'No valid scores for active assignments and filters.' : 'No valid scores in this range.'}</p>}
      </div>
    </section>
  </div>
  </>;
}
function ChartCard({ title, subtitle, children }) { return <div className="sims-panel min-w-0"><h3 className="font-semibold text-navy">{title}</h3><p className="mt-0.5 text-sm text-slate-600">{subtitle}</p><div className="mt-4 min-w-0">{children}</div></div>; }



function AttendancePage({ user, onError, onSuccess }) {
  const { data: meta, error: metaError } = useLoad(apiRoutes.meta);
  const { data: scheduleRows, error: scheduleError } = useLoad(apiRoutes.classSchedules.collection);
  const [classId, setClassId] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [date, setDate] = useState(today);
  const [records, setRecords] = useState({});
  const [historyClassId, setHistoryClassId] = useState('');
  const [historySubjectId, setHistorySubjectId] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const debouncedHistorySearch = useDebouncedValue(historySearch);
  const [historyDate, setHistoryDate] = useState('');
  const [historyCreatedFrom, setHistoryCreatedFrom] = useState('');
  const [historyCreatedTo, setHistoryCreatedTo] = useState('');
  const [historySortOrder, setHistorySortOrder] = useState('latest');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [selectedAttendance, setSelectedAttendance] = useState(null);
  const [printClassSelection, setPrintClassSelection] = useState([]);
  const [printClassDialogOpen, setPrintClassDialogOpen] = useState(false);
  const [attendancePrint, setAttendancePrint] = useState(null);
  const [attendancePrintBusy, setAttendancePrintBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [updatingAttendanceId, setUpdatingAttendanceId] = useState('');
  const canEditAttendance = ['Admin', 'SuperAdmin', 'School Manager', 'Teacher'].includes(user.role);
  const students = useMemo(() => (meta?.students || []).filter(row => String(row.class_id) === String(classId)), [meta?.students, classId]);
  const dayOfWeek = new Date(`${date}T00:00:00`).getDay() || 7;
  const dailySchedules = useMemo(() => (scheduleRows || [])
    .filter(row => String(row.class_id) === String(classId) && Number(row.day_of_week) === dayOfWeek && row.active && !row.is_deleted),
  [scheduleRows, classId, dayOfWeek]);
  const selectedSchedule = dailySchedules.find(row => String(row.id) === String(scheduleId));
  const subjectId = selectedSchedule?.subject_id || '';
  const historySubjects = useMemo(() => (meta?.classSubjects || [])
    .filter(row => !historyClassId || String(row.class_id) === String(historyClassId))
    .map(row => meta?.subjects.find(subject => subject.id === row.subject_id))
    .filter((subject, index, list) => subject && list.findIndex(item => item.id === subject.id) === index), [meta?.classSubjects, meta?.subjects, historyClassId]);
  const historyParams = new URLSearchParams();
  if (historyClassId) historyParams.set('class_id', historyClassId);
  if (historySubjectId) historyParams.set('subject_id', historySubjectId);
  if (debouncedHistorySearch.trim()) historyParams.set('q', debouncedHistorySearch.trim());
  if (historyStatus) historyParams.set('status', historyStatus);
  if (historyDate) historyParams.set('date', historyDate);
  if (historySortOrder === 'custom' && historyCreatedFrom) historyParams.set('created_from', historyCreatedFrom);
  if (historySortOrder === 'custom' && historyCreatedTo) historyParams.set('created_to', historyCreatedTo);
  historyParams.set('sort_order', historySortOrder === 'oldest' ? 'oldest' : 'latest');
  historyParams.set('page', String(historyPage));
  historyParams.set('page_size', String(historyPageSize));
  const historyQuery = historyParams.toString();
  const attendance = useLoad(`${apiRoutes.attendance.collection}${historyQuery ? `?${historyQuery}` : ''}`);
  const entryParams = new URLSearchParams({ date });
  if (classId) entryParams.set('class_id', classId);
  if (subjectId) entryParams.set('subject_id', subjectId);
  if (scheduleId) entryParams.set('schedule_id', scheduleId);
  const entryAttendance = useLoad(`${apiRoutes.attendance.collection}?${entryParams.toString()}`);
  const existing = attendance.data?.rows || [];
  const historySuggestions = (meta?.students || [])
    .map(student => ({ student, score: debouncedHistorySearch.trim() ? fuzzySearchScore(debouncedHistorySearch, `${student.english_name} ${student.student_code}`) : 0 }))
    .filter(match => match.score !== null)
    .sort((first, second) => first.score - second.score)
    .slice(0, 6)
    .map(({ student }) => ({
      key: student.id,
      value: `${student.english_name} ${student.student_code}`,
      label: student.english_name,
      description: [student.student_code, student.class_name].filter(Boolean).join(' · '),
      searchText: `${student.english_name} ${student.student_code} ${student.class_name || ''}`
    }));
  const historyTotal = attendance.data?.total || 0;
  const historyPageCount = Math.max(1, Math.ceil(historyTotal / historyPageSize));
  const subjectName = selectedSchedule?.subject_name || 'Subject';
  async function updateAttendanceStatus(row, status) {
    setUpdatingAttendanceId(String(row.id));
    try {
      await api(apiRoute(apiRoutes.attendance.item, { id: row.id }), { method: 'PATCH', body: JSON.stringify({ status }) });
      setSelectedAttendance(current => current?.id === row.id ? { ...current, status } : current);
      onSuccess('Attendance status updated.');
      attendance.reload();
      entryAttendance.reload();
    } catch (error) {
      onError(error.message);
    } finally {
      setUpdatingAttendanceId('');
    }
  }
  async function fetchAllAttendance(params) {
    const pageSize = 100;
    let page = 1;
    let total = 0;
    const rows = [];
    do {
      params.set('page', String(page));
      params.set('page_size', String(pageSize));
      const result = await api(`${apiRoutes.attendance.collection}?${params.toString()}`);
      rows.push(...result.rows);
      total = Number(result.total);
      if (!result.rows.length && rows.length < total) {
        throw new Error('Could not load all attendance pages for printing.');
      }
      page += 1;
    } while (rows.length < total);
    return rows;
  }
  async function printClassAttendance(selectedClassIds) {
    if (!selectedClassIds.length) return onError('Select at least one class to print.');
    const selectedClasses = (meta?.classes || []).filter(row => selectedClassIds.includes(String(row.id)));
    if (selectedClasses.length !== selectedClassIds.length) return onError('One or more selected classes are not available.');
    setAttendancePrintBusy(true);
    setPrintClassDialogOpen(false);
    try {
      const params = new URLSearchParams({ class_ids: selectedClassIds.join(',') });
      if (historySubjectId) params.set('subject_id', historySubjectId);
      if (historyDate) params.set('date', historyDate);
      if (historyStatus) params.set('status', historyStatus);
      if (historySortOrder === 'custom' && historyCreatedFrom) params.set('created_from', historyCreatedFrom);
      if (historySortOrder === 'custom' && historyCreatedTo) params.set('created_to', historyCreatedTo);
      params.set('sort_order', historySortOrder === 'oldest' ? 'oldest' : 'latest');
      if (historySearch.trim()) params.set('q', historySearch.trim());
      const rows = await fetchAllAttendance(params);
      const groups = selectedClasses.map(selectedClass => ({
        id: selectedClass.id,
        title: `${selectedClass.grade_level} · ${selectedClass.name}`,
        rows: rows.filter(row => String(row.class_id) === String(selectedClass.id))
      }));
      setAttendancePrint({
        groups,
        type: 'class',
        title: groups.length === 1 ? groups[0].title : `${groups.length} classes`
      });
    } catch (error) {
      onError(error.message);
    } finally {
      setAttendancePrintBusy(false);
    }
  }
  async function printStudentAttendance() {
    if (!historySearch.trim()) return onError('Search for a student before printing student attendance.');
    setAttendancePrintBusy(true);
    try {
      const params = new URLSearchParams({ q: historySearch.trim() });
      if (historyClassId) params.set('class_id', historyClassId);
      if (historySubjectId) params.set('subject_id', historySubjectId);
      if (historyStatus) params.set('status', historyStatus);
      if (historyDate) params.set('date', historyDate);
      if (historySortOrder === 'custom' && historyCreatedFrom) params.set('created_from', historyCreatedFrom);
      if (historySortOrder === 'custom' && historyCreatedTo) params.set('created_to', historyCreatedTo);
      params.set('sort_order', historySortOrder === 'oldest' ? 'oldest' : 'latest');
      const rows = await api(`${apiRoutes.attendance.collection}?${params.toString()}`);
      const student = rows[0];
      setAttendancePrint({
        rows,
        type: 'student',
        title: student ? `${student.english_name} · ${student.student_code}` : historySearch.trim()
      });
    } catch (error) {
      onError(error.message);
    } finally {
      setAttendancePrintBusy(false);
    }
  }
  useEffect(() => {
    if (!attendancePrint) return undefined;
    const finishPrint = () => setAttendancePrint(null);
    window.addEventListener('afterprint', finishPrint);
    window.print();
    return () => window.removeEventListener('afterprint', finishPrint);
  }, [attendancePrint]);
  async function save() {
    if (!classId || !selectedSchedule || !students.length) return onError('Select a class and scheduled lesson with enrolled students.');
    setBusy(true);
    try {
      const markedCount = students.filter(student => records[student.id]).length;
      await api(apiRoutes.attendance.collection, { method: 'POST', body: JSON.stringify({ attendance_date: date, class_id: classId, subject_id: subjectId, schedule_id: scheduleId, records: students.map(student => ({ student_id: student.id, status: records[student.id] || null })) }) });
      onSuccess(`${subjectName} attendance saved for ${markedCount} of ${students.length} students.`); attendance.reload(); entryAttendance.reload();
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  }
  useEffect(() => {
    if (!classId || !scheduleId || !entryAttendance.data) return;
    setRecords(current => {
      const existingRecords = new Map(entryAttendance.data
        .filter(item => String(item.class_id) === String(classId)
          && String(item.subject_id) === String(subjectId)
          && String(item.schedule_id) === String(scheduleId))
        .map(item => [item.student_id, item.status]));
      return Object.fromEntries(students.map(student => [student.id, existingRecords.get(student.id) || '']));
    });
  }, [classId, subjectId, scheduleId, date, entryAttendance.data, students]);
  return <div className="space-y-5">
    {!selectedAttendance && <>
    {metaError && <div className="no-print"><ErrorPanel message={metaError} /></div>}
    {scheduleError && <div className="no-print"><ErrorPanel message={scheduleError} /></div>}
    {canEditAttendance ? <div className="no-print sims-panel">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium">Attendance date<input type="date" value={date} onChange={e => { setDate(e.target.value); setScheduleId(''); setRecords({}); }} className="mt-1.5 block rounded-lg border px-3 py-2" /></label>
        <SearchableSelect name="attendance_class" label="Class" options={meta?.classes || []} value={classId}
          onChange={value => { setClassId(value); setScheduleId(''); setRecords({}); }}
          getOptionLabel={row => `${row.grade_level} · ${row.name}`} getOptionSearchText={row => `${row.grade_level} ${row.name}`}
          placeholder="Search class..." required />
        <SearchableSelect name="attendance_schedule" label="Scheduled lesson" options={dailySchedules} value={scheduleId}
          onChange={value => { setScheduleId(value); setRecords({}); }}
          getOptionLabel={row => `${row.subject_name} · ${formatTime(row.start_time)}–${formatTime(row.end_time)}${row.room ? ` · ${row.room}` : ''}`}
          getOptionSearchText={row => `${row.subject_name} ${row.teacher_name} ${row.room || ''}`}
          placeholder="Search scheduled lessons..." required disabled={!classId || Boolean(scheduleError)} />
        <button disabled={busy || entryAttendance.loading || Boolean(entryAttendance.error) || !students.length || !selectedSchedule} onClick={save} className="primary-action rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{busy ? 'Saving...' : entryAttendance.loading ? 'Loading...' : 'Save lesson attendance'}</button>
        <button type="button" onClick={() => { setClassId(''); setScheduleId(''); setDate(today); setRecords({}); }}
          disabled={!classId && !scheduleId && date === today && !Object.keys(records).length}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Clear filters</button>
      </div>
      <p className="mb-3 text-xs text-slate-500">Choose a class and date, then select one of that day's scheduled lessons. The subject and teacher follow the selected schedule. Leave students as Not marked if attendance is unknown; no attendance record is saved for them.</p>
      {entryAttendance.error && <ErrorPanel message={entryAttendance.error} />}
      {!classId ? <Empty text="Choose a class to load its schedule." /> : !dailySchedules.length ? <Empty text="No scheduled lessons for this class on the selected weekday. Add a lesson under Class Schedule." /> : !selectedSchedule ? <Empty text="Choose a scheduled lesson to load the class roster and subject." /> : !students.length ? <Empty text="No active students are enrolled in this class." /> : <div className="scrollbar overflow-x-auto"><table className="sims-table w-full min-w-[700px] text-sm"><thead className="border-b border-slate-200 text-left text-xs uppercase"><tr><th className="px-3 py-3">Student</th><th className="px-3 py-3">Scheduled subject / teacher</th><th className="px-3 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{students.map(student => <tr key={student.id} className="hover:bg-slate-50/70"><td className="px-3 py-3"><span className="font-medium">{student.english_name}</span><span className="ml-2 text-xs text-slate-500">{student.student_code}</span></td><td className="px-3 py-3">{selectedSchedule.subject_name}<span className="ml-2 text-xs text-slate-600">{selectedSchedule.teacher_name}</span></td><td className="px-3 py-2"><StatusSelect label={`Attendance status for ${student.english_name}`} options={['Present', 'Absent', 'Late', 'Excused']} placeholder="Choose status" value={records[student.id] ?? ''} onChange={value => setRecords(current => ({ ...current, [student.id]: value }))} /></td></tr>)}</tbody></table></div>}
    </div> : <div className="no-print sims-panel text-sm text-slate-600">Attendance entry is available to teachers for their assigned classes and subjects. Attendance history remains available below.</div>}
    <div className="sims-panel">
      <h3 className="no-print mb-4 font-semibold">Student attendance history</h3>
      <div className="no-print sims-filter-grid mb-4">
        <SearchSuggestions id="attendance-history-search" label="Search student" value={historySearch}
          onChange={value => { setHistorySearch(value); setHistoryPage(1); }}
          suggestions={historySuggestions} pending={historySearch.trim() !== debouncedHistorySearch.trim()}
          placeholder="Name or student code" className="min-w-[220px] flex-1"
          inputClassName="mt-1.5 block w-full rounded-lg border bg-white px-3 py-2" />
        <label className="min-w-40 text-sm font-medium">Status<select value={historyStatus} onChange={e => { setHistoryStatus(e.target.value); setHistoryPage(1); }} className="mt-1.5 block w-full rounded-lg border bg-white px-3 py-2"><option value="">All statuses</option>{['Present', 'Absent', 'Late', 'Excused'].map(status => <option key={status} value={status}>{status}</option>)}</select></label>
        <div className="min-w-44">
          <SearchableSelect name="attendance_history_class" label="Class" options={meta?.classes || []} value={historyClassId}
            onChange={value => { setHistoryClassId(value); setHistorySubjectId(''); setHistoryPage(1); }}
            getOptionLabel={row => `${row.grade_level} · ${row.name}`} getOptionSearchText={row => `${row.grade_level} ${row.name}`}
            placeholder="Search classes..." emptyValueLabel="All classes" noneLabel="All classes" debounceDelay={500} />
        </div>
        <div className="min-w-44">
          <SearchableSelect name="attendance_history_subject" label="Subject" options={historySubjects} value={historySubjectId}
            onChange={value => { setHistorySubjectId(value); setHistoryPage(1); }}
            getOptionLabel={subject => subject.name} getOptionSearchText={subject => subject.name}
            placeholder="Search subjects..." emptyValueLabel="All subjects" noneLabel="All subjects" debounceDelay={500} />
        </div>
        <label className="text-sm font-medium">Date<input type="date" value={historyDate} onChange={e => { setHistoryDate(e.target.value); setHistoryPage(1); }} className="mt-1.5 block rounded-lg border px-3 py-2" /></label>
        <label className="text-sm font-medium">Date order<select value={historySortOrder} onChange={e => { setHistorySortOrder(e.target.value); if (e.target.value !== 'custom') { setHistoryCreatedFrom(''); setHistoryCreatedTo(''); } setHistoryPage(1); }} className="mt-1.5 block rounded-lg border bg-white px-3 py-2"><option value="latest">Latest</option><option value="oldest">Oldest</option><option value="custom">Custom range</option></select></label>
        {historySortOrder === 'custom' && <>
          <label className="text-sm font-medium">Created from<input type="date" value={historyCreatedFrom} max={historyCreatedTo || undefined} onChange={e => { setHistoryCreatedFrom(e.target.value); setHistoryPage(1); }} className="mt-1.5 block rounded-lg border px-3 py-2" /></label>
          <label className="text-sm font-medium">Created to<input type="date" value={historyCreatedTo} min={historyCreatedFrom || undefined} onChange={e => { setHistoryCreatedTo(e.target.value); setHistoryPage(1); }} className="mt-1.5 block rounded-lg border px-3 py-2" /></label>
        </>}
        <label className="text-sm font-medium">Rows per page<select value={historyPageSize} onChange={e => { setHistoryPageSize(Number(e.target.value)); setHistoryPage(1); }} className="mt-1.5 block rounded-lg border bg-white px-3 py-2"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label>
        <button type="button" disabled={!historySearch && !historyStatus && !historyClassId && !historySubjectId && !historyDate && !historyCreatedFrom && !historyCreatedTo && historySortOrder === 'latest' && historyPageSize === 25} onClick={() => {
          setHistorySearch(''); setHistoryStatus(''); setHistoryClassId(''); setHistorySubjectId('');
          setHistoryDate(''); setHistoryCreatedFrom(''); setHistoryCreatedTo('');
          setHistorySortOrder('latest'); setHistoryPageSize(25); setHistoryPage(1);
        }} className="self-end rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear filters</button>
        <button type="button" disabled={attendancePrintBusy || (historySearch.trim() ? false : !meta?.classes?.length)} onClick={() => {
          if (historySearch.trim()) printStudentAttendance();
          else {
            setPrintClassSelection(historyClassId ? [String(historyClassId)] : []);
            setPrintClassDialogOpen(true);
          }
        }} className="no-print flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><Printer size={16} /> {attendancePrintBusy ? 'Preparing...' : historySearch.trim() ? 'Print student attendance' : 'Print class attendance'}</button>
      </div>
      {attendance.error ? <ErrorPanel message={attendance.error} /> : attendance.loading ? <Loading /> : <div className="no-print sims-table-panel scrollbar overflow-x-auto">      <table className="sims-table w-full min-w-[1050px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Date','Student code','Student','Class','Schedule','Subject','Status','Created at','Actions'].map(s => <th className="px-3 py-3" key={s}>{s}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{existing.map(row => <tr key={row.id} className="hover:bg-slate-50/70"><td className="px-3 py-3">{formatDate(row.attendance_date)}</td><td className="px-3 py-3">{row.student_code}</td><td className="px-3 py-3">{row.english_name}</td><td className="px-3 py-3">{row.class_name}</td>      <td className="px-3 py-3">{row.schedule_time ? formatTime(row.schedule_time) : 'Legacy'}</td><td className="px-3 py-3">{row.subject_name || 'Daily (legacy)'}</td><td className="px-3 py-3">{canEditAttendance ? <StatusSelect label={`Change attendance status for ${row.english_name} on ${formatDate(row.attendance_date)}`} options={['Present', 'Absent', 'Late', 'Excused']} value={row.status} disabled={updatingAttendanceId === String(row.id)} onChange={status => updateAttendanceStatus(row, status)} /> : <StatusBadge>{row.status}</StatusBadge>}</td><td className="whitespace-nowrap px-3 py-3">{formatDateTime(row.created_at)}</td><td className="px-3 py-3"><ActionMenu label={`Actions for attendance record ${row.student_code}`} items={[{ label: 'View details', onClick: () => setSelectedAttendance(row) }]} /></td></tr>)}</tbody></table>{!existing.length && <Empty text="No attendance matches these filters." />}<Pagination page={historyPage} pageCount={historyPageCount} total={historyTotal} pageSize={historyPageSize} onPageChange={setHistoryPage} /></div>}
      {attendancePrint && <div className="print-only">
        <h1 className="mb-4 text-xl font-bold">Student Attendance — {attendancePrint.title}</h1>
        <p className="mb-3 text-sm">{attendancePrint.type === 'student' ? 'Student attendance history' : `Class attendance · ${attendancePrint.title}`} · Subject: {meta?.subjects.find(row => String(row.id) === String(historySubjectId))?.name || 'All subjects'} · Date: {historyDate ? formatDate(historyDate) : 'All dates'}</p>
        <AttendancePrintSummary rows={attendancePrint.type === 'student' ? attendancePrint.rows : attendancePrint.groups.flatMap(group => group.rows)} />
        {attendancePrint.type === 'student' ? <AttendancePrintTable rows={attendancePrint.rows} /> : attendancePrint.groups.map(group => <section key={group.id} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">{group.title}</h2>
          <AttendancePrintSummary rows={group.rows} />
          <AttendancePrintTable rows={group.rows} />
          {!group.rows.length && <p>No attendance records match these filters for this class.</p>}
        </section>)}
      </div>}
      {printClassDialogOpen && <Modal title="Print attendance by class" onClose={() => setPrintClassDialogOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Print all classes, or choose one or more classes. Current date, subject, status, and search filters will be applied.</p>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold">
            <input type="checkbox" checked={printClassSelection.length === (meta?.classes || []).length && Boolean(meta?.classes?.length)}
              onChange={() => setPrintClassSelection(current => current.length === (meta?.classes || []).length ? [] : (meta?.classes || []).map(row => String(row.id)))}
              className="h-4 w-4 accent-blue-600" />
            All classes
            <span className="ml-auto text-xs font-normal text-slate-500">{(meta?.classes || []).length} available</span>
          </label>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            {(meta?.classes || []).map(row => {
              const id = String(row.id);
              return <label key={row.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-sm last:border-0 hover:bg-blue-50">
                <input type="checkbox" checked={printClassSelection.includes(id)} onChange={() => setPrintClassSelection(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} className="h-4 w-4 accent-blue-600" />
                <span>{row.grade_level} · {row.name}</span>
              </label>;
            })}
            {!meta?.classes?.length && <p className="px-3 py-4 text-sm text-slate-500">No classes available.</p>}
          </div>
          <p className="text-xs text-slate-500">{printClassSelection.length} class{printClassSelection.length === 1 ? '' : 'es'} selected. Select one class for a single-class printout.</p>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
            <button type="button" onClick={() => setPrintClassDialogOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
            <button type="button" disabled={!printClassSelection.length || attendancePrintBusy} onClick={() => printClassAttendance(printClassSelection)} className="primary-action rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{printClassSelection.length === (meta?.classes || []).length ? 'Print all classes' : printClassSelection.length > 1 ? 'Print selected classes' : 'Print class'}</button>
          </div>
        </div>
      </Modal>}
    </div>
    </>}
    {selectedAttendance && <DetailsPage title="Attendance details" details={[
      ['Date', formatDate(selectedAttendance.attendance_date)], ['Student', selectedAttendance.english_name],
      ['Student code', selectedAttendance.student_code], ['Class', selectedAttendance.class_name],
      ['Subject', selectedAttendance.subject_name], ['Schedule time', selectedAttendance.schedule_time ? formatTime(selectedAttendance.schedule_time) : 'Legacy'],
      ['Weekday', selectedAttendance.day_of_week ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][selectedAttendance.day_of_week - 1] : 'Legacy'],
      ['Status', selectedAttendance.status], ['Note', selectedAttendance.note],
      ['Recorded at', formatDateTime(selectedAttendance.created_at)], ['Public ID', selectedAttendance.id]
    ]} onBack={() => setSelectedAttendance(null)} />}
  </div>;
}

function ResultsPage({ user, onError, onSuccess }) {
  const { data: meta } = useLoad(apiRoutes.meta);
  const { data: subjects } = useLoad(apiRoutes.subjects.collection);
  const [currentPage, setCurrentPage] = useState(1);
  const [classFilter, setClassFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [termFilter, setTermFilter] = useState('');
  const [assessmentStatus, setAssessmentStatus] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sortOrder, setSortOrder] = useState('latest');
  const [resultsView, setResultsView] = useState('assessments');
  const [classResultsSearch, setClassResultsSearch] = useState('');
  const [classResultsPage, setClassResultsPage] = useState(1);
  const [assessmentScoresPage, setAssessmentScoresPage] = useState(1);
  const pageSize = 25;
  const assessmentParams = new URLSearchParams({ page: String(currentPage), page_size: String(pageSize) });
  if (classFilter) assessmentParams.set('class_id', classFilter);
  if (subjectFilter) assessmentParams.set('subject_id', subjectFilter);
  if (termFilter) assessmentParams.set('term_id', termFilter);
  if (assessmentStatus) {
    assessmentParams.set('status', assessmentStatus);
    if (assessmentStatus === 'In Trash') assessmentParams.set('include_deleted', 'true');
  }
  if (sortOrder === 'custom' && createdFrom) assessmentParams.set('created_from', createdFrom);
  if (sortOrder === 'custom' && createdTo) assessmentParams.set('created_to', createdTo);
  assessmentParams.set('sort_order', sortOrder === 'oldest' ? 'oldest' : 'latest');
  const { data: assessmentData, error, loading, reload } = useLoad(`${apiRoutes.assessments.collection}?${assessmentParams}`);
  const printAssessmentParams = new URLSearchParams();
  if (classFilter) printAssessmentParams.set('class_id', classFilter);
  if (subjectFilter) printAssessmentParams.set('subject_id', subjectFilter);
  if (termFilter) printAssessmentParams.set('term_id', termFilter);
  if (assessmentStatus) {
    printAssessmentParams.set('status', assessmentStatus);
    if (assessmentStatus === 'In Trash') printAssessmentParams.set('include_deleted', 'true');
  }
  if (sortOrder === 'custom' && createdFrom) printAssessmentParams.set('created_from', createdFrom);
  if (sortOrder === 'custom' && createdTo) printAssessmentParams.set('created_to', createdTo);
  printAssessmentParams.set('sort_order', sortOrder === 'oldest' ? 'oldest' : 'latest');
  const printAssessmentQuery = printAssessmentParams.toString();
  const { data: printAssessmentData, error: printAssessmentError, loading: printAssessmentLoading } = useLoad(
    resultsView === 'assessments' ? `${apiRoutes.assessments.collection}${printAssessmentQuery ? `?${printAssessmentQuery}` : ''}` : null
  );
  const printAssessments = Array.isArray(printAssessmentData) ? printAssessmentData : [];
  const classResultsParams = new URLSearchParams();
  if (subjectFilter) classResultsParams.set('subject_id', subjectFilter);
  if (termFilter) classResultsParams.set('term_id', termFilter);
  const classResultsQuery = classResultsParams.toString();
  const classResultsPath = resultsView === 'scores' && classFilter
    ? `${apiRoute(apiRoutes.classes.results, { id: classFilter })}${classResultsQuery ? `?${classResultsQuery}` : ''}`
    : null;
  const { data: classResultsData, error: classResultsError, loading: classResultsLoading } = useLoad(classResultsPath);
  const debouncedClassResultsSearch = useDebouncedValue(classResultsSearch, 500);
  const classResults = Array.isArray(classResultsData) ? classResultsData : [];
  const visibleClassResults = classResults.filter(row =>
    !debouncedClassResultsSearch.trim() ||
    fuzzySearchScore(debouncedClassResultsSearch,
      [row.student_code, row.english_name, row.subject, row.assessment, row.term].join(' ')) !== null
  );
  const classResultsPageCount = Math.max(1, Math.ceil(visibleClassResults.length / pageSize));
  const pageClassResults = visibleClassResults.slice((classResultsPage - 1) * pageSize, classResultsPage * pageSize);
  useEffect(() => { setClassResultsPage(1); }, [debouncedClassResultsSearch, classFilter, subjectFilter, termFilter]);
  useEffect(() => {
    if (classResultsPage > classResultsPageCount) setClassResultsPage(classResultsPageCount);
  }, [classResultsPage, classResultsPageCount]);
  const classResultSuggestions = visibleClassResults.map(row => ({
    key: `${row.student_id}-${row.subject}-${row.assessment}`,
    value: `${row.english_name} ${row.student_code}`,
    label: row.english_name,
    description: [row.student_code, row.subject, row.assessment].filter(Boolean).join(' · '),
    searchText: [row.student_code, row.english_name, row.subject, row.assessment, row.term].join(' ')
  }));
  const assessments = Array.isArray(assessmentData) ? assessmentData : assessmentData?.rows || [];
  const totalAssessments = Array.isArray(assessmentData) ? assessments.length : Number(assessmentData?.total || 0);
  const pageCount = Math.max(1, Math.ceil(totalAssessments / pageSize));
  const pageAssessments = assessments;
  const [formOpen, setFormOpen] = useState(false);
  const [assessmentFieldErrors, setAssessmentFieldErrors] = useState({});
  const [assessmentFormError, setAssessmentFormError] = useState('');
  const [scoreOpen, setScoreOpen] = useState(false);
  const [selectedAssessment, setSelectedAssessment] = useState(null);
  const [scoreStudentSearch, setScoreStudentSearch] = useState('');
  const [selectedScoreStudentId, setSelectedScoreStudentId] = useState('');
  const [minimumScoreFilter, setMinimumScoreFilter] = useState('');
  const [maximumScoreFilter, setMaximumScoreFilter] = useState('');
  const [scoreCommentFilter, setScoreCommentFilter] = useState('');
  const [scoreSort, setScoreSort] = useState('name');
  const debouncedScoreStudentSearch = useDebouncedValue(scoreStudentSearch, 500);
  const { data: assessmentScores, error: assessmentScoresError, loading: assessmentScoresLoading } = useLoad(
    selectedAssessment ? apiRoute(apiRoutes.assessments.scores, { id: selectedAssessment.id }) : null
  );
  useEffect(() => {
    setScoreStudentSearch('');
    setSelectedScoreStudentId('');
    setMinimumScoreFilter('');
    setMaximumScoreFilter('');
    setScoreCommentFilter('');
    setScoreSort('name');
  }, [selectedAssessment?.id]);
  const [confirmAssessmentHide, setConfirmAssessmentHide] = useState(null);
  const [assessmentId, setAssessmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: scoreOptions } = useLoad(scoreOpen ? `${apiRoutes.assessments.collection}?options=true` : null);
  const canManageRecords = ['Admin', 'SuperAdmin'].includes(user.role);
  const scoreAssessment = (scoreOptions || []).find(row => String(row.id) === assessmentId && !row.is_deleted);
  const scoreStudents = scoreAssessment
    ? (meta?.students || []).filter(student => String(student.class_id) === String(scoreAssessment.class_id))
    : [];
  const scoreSearchQuery = debouncedScoreStudentSearch.trim().toLowerCase();
  const matchingAssessmentScores = (assessmentScores || []).filter(student =>
    !scoreSearchQuery || fuzzySearchScore(scoreSearchQuery, `${student.english_name} ${student.student_code}`) !== null
  );
  const selectedStudentScores = selectedScoreStudentId
    ? (assessmentScores || []).filter(student => student.student_id === selectedScoreStudentId)
    : matchingAssessmentScores;
  const visibleAssessmentScores = selectedStudentScores.filter(student =>
    (minimumScoreFilter === '' || Number(student.score) >= Number(minimumScoreFilter)) &&
    (maximumScoreFilter === '' || Number(student.score) <= Number(maximumScoreFilter)) &&
    (!scoreCommentFilter || (scoreCommentFilter === 'with-comment' ? Boolean(student.comment?.trim()) : !student.comment?.trim()))
  ).sort((first, second) => {
    if (scoreSort === 'score-high') return Number(second.score) - Number(first.score) || first.english_name.localeCompare(second.english_name);
    if (scoreSort === 'score-low') return Number(first.score) - Number(second.score) || first.english_name.localeCompare(second.english_name);
    return first.english_name.localeCompare(second.english_name) || first.student_code.localeCompare(second.student_code);
  });
  const assessmentScoresPageCount = Math.max(1, Math.ceil(visibleAssessmentScores.length / pageSize));
  const pageAssessmentScores = visibleAssessmentScores.slice((assessmentScoresPage - 1) * pageSize, assessmentScoresPage * pageSize);
  useEffect(() => { setAssessmentScoresPage(1); }, [
    selectedAssessment?.id, debouncedScoreStudentSearch, selectedScoreStudentId,
    minimumScoreFilter, maximumScoreFilter, scoreCommentFilter, scoreSort
  ]);
  useEffect(() => {
    if (assessmentScoresPage > assessmentScoresPageCount) setAssessmentScoresPage(assessmentScoresPageCount);
  }, [assessmentScoresPage, assessmentScoresPageCount]);
  const hasScoreFilters = Boolean(scoreStudentSearch || minimumScoreFilter || maximumScoreFilter || scoreCommentFilter || scoreSort !== 'name');
  const scoreSuggestions = scoreSearchQuery && !selectedScoreStudentId
    ? matchingAssessmentScores
    : [];
  function closeScoreModal() {
    setScoreOpen(false);
    setAssessmentId('');
  }
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);
  useEffect(() => { setCurrentPage(1); }, [classFilter, subjectFilter, termFilter, assessmentStatus, createdFrom, createdTo, sortOrder]);
  useEffect(() => {
    setClassResultsSearch('');
    setCurrentPage(1);
    setClassResultsPage(1);
  }, [classFilter, subjectFilter, termFilter]);
  async function createAssessment(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const errors = {};
    for (const key of ['title', 'subject_id', 'class_id', 'term_id', 'assessment_date', 'maximum_score']) {
      const input = form.elements.namedItem(key);
      if (['subject_id', 'class_id', 'term_id'].includes(key) && !formData.get(key)) errors[key] = 'Select an option.';
      else if (input && !input.validity.valid) errors[key] = input.validationMessage || 'This field is required.';
    }
    if (Object.keys(errors).length) {
      setAssessmentFieldErrors(errors);
      setAssessmentFormError('');
      return;
    }
    setAssessmentFieldErrors({});
    setAssessmentFormError('');
    const values = Object.fromEntries(formData);
    try {
      await api(apiRoutes.assessments.collection, { method: 'POST', body: JSON.stringify(values) });
      setFormOpen(false);
      reload();
      onSuccess('Assessment created.');
    } catch (err) {
      const match = err.message.match(/^([a-z_]+):\s*(.+)$/i);
      if (match && ['title', 'subject_id', 'class_id', 'term_id', 'assessment_date', 'maximum_score'].includes(match[1])) {
        setAssessmentFieldErrors({ [match[1]]: match[2] });
      } else setAssessmentFormError(err.message);
    }
  }
  async function saveScores(e) {
    e.preventDefault();
    if (!scoreAssessment) return onError('Search for and select an assessment first.');
    const fd = new FormData(e.currentTarget);
    const scores = scoreStudents.filter(student => fd.get(`score_${student.id}`) !== '').map(student => ({ student_id: student.id, score: Number(fd.get(`score_${student.id}`)) }));
    if (!scores.length) return onError('Enter at least one student score before saving.');
    const maximumScore = Math.min(100, Number(scoreAssessment.maximum_score));
    if (scores.some(row => !Number.isFinite(row.score) || row.score < 0 || row.score > maximumScore)) {
      return onError(`Scores must be between 0 and ${maximumScore}.`);
    }
    setBusy(true);
    try { await api(apiRoutes.scores, { method: 'POST', body: JSON.stringify({ assessment_id: assessmentId, scores }) }); closeScoreModal(); reload(); onSuccess(`Saved ${scores.length} scores.`); } catch (err) { onError(err.message); } finally { setBusy(false); }
  }
  async function setAssessmentHidden(row, hidden) {
    try {
      await api(apiRoute(hidden ? apiRoutes.visibility.delete : apiRoutes.visibility.restore, {
        entity: 'assessments',
        id: row.id
      }), { method: 'POST' });
      onSuccess(hidden ? 'Assessment moved to Trash.' : 'Assessment restored.');
      if (hidden) setSelectedAssessment(current => current?.id === row.id ? { ...current, is_deleted: true } : current);
      reload();
    } catch (err) { onError(err.message); }
  }
  return <div className="space-y-4">
    {!formOpen && !scoreOpen && !selectedAssessment && <>
    <div className="no-print flex w-full max-w-full overflow-x-auto" role="tablist" aria-label="Academic results sections">
      {[
        ['assessments', 'Manage assessments', ClipboardList],
        ['scores', 'Manage student scores', GraduationCap]
      ].map(([view, label, Icon]) => <button
        key={view}
        type="button"
        role="tab"
        aria-selected={resultsView === view}
        onClick={() => setResultsView(view)}
        style={{
          borderBottom: `3px solid ${resultsView === view ? '#2563eb' : 'transparent'}`,
          color: resultsView === view ? '#1d4ed8' : undefined
        }}
        className="flex min-w-40 flex-col items-center gap-1 bg-transparent px-5 py-2.5 text-xs font-semibold transition sm:min-w-48 sm:flex-row sm:justify-center sm:gap-2 sm:text-sm"
      ><Icon size={16} aria-hidden="true" />{label}</button>)}
    </div>
    <div className="no-print sims-toolbar space-y-3">
    <div className="sims-filter-grid">
      <div className="min-w-40">
        <SearchableSelect name="results_class_filter" label="Class" options={meta?.classes || []} value={classFilter}
          onChange={setClassFilter} getOptionLabel={row => `${row.grade_level} · ${row.name}`}
          getOptionSearchText={row => `${row.grade_level} ${row.name}`} placeholder="Search classes..."
          emptyValueLabel="All classes" noneLabel="All classes" debounceDelay={500} />
      </div>
      <div className="min-w-40">
        <SearchableSelect name="results_subject_filter" label="Subject" options={meta?.subjects || []} value={subjectFilter}
          onChange={setSubjectFilter} getOptionLabel={row => row.name} getOptionSearchText={row => row.name}
          placeholder="Search subjects..." emptyValueLabel="All subjects" noneLabel="All subjects" debounceDelay={500} />
      </div>
      <div className="min-w-40">
        <SearchableSelect name="results_term_filter" label="Term" options={meta?.dashboardTerms || meta?.terms || []} value={termFilter}
          onChange={setTermFilter} getOptionLabel={row => row.name} getOptionSearchText={row => row.name}
          placeholder="Search terms..." emptyValueLabel="All terms" noneLabel="All terms" debounceDelay={500} />
      </div>
      {resultsView === 'assessments' && <label className="text-sm font-medium text-slate-700">Status<select value={assessmentStatus} onChange={event => setAssessmentStatus(event.target.value)} className="mt-1.5 block w-full rounded-lg border bg-white px-3 py-2">
          <option value="">All statuses</option>
          <option value="Active">Active</option>
          {['Admin', 'SuperAdmin', 'School Manager'].includes(user.role) && <option value="In Trash">In Trash</option>}
        </select></label>}
      <label className="text-sm font-medium text-slate-700">Date order<select value={sortOrder} onChange={event => { setSortOrder(event.target.value); if (event.target.value !== 'custom') { setCreatedFrom(''); setCreatedTo(''); } }} className="mt-1.5 block rounded-lg border bg-white px-3 py-2"><option value="latest">Latest</option><option value="oldest">Oldest</option><option value="custom">Custom range</option></select></label>
      {sortOrder === 'custom' && <>
        <label className="text-sm font-medium text-slate-700">Created from<input type="date" value={createdFrom} max={createdTo || undefined} onChange={event => setCreatedFrom(event.target.value)} className="mt-1.5 block rounded-lg border px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">Created to<input type="date" value={createdTo} min={createdFrom || undefined} onChange={event => setCreatedTo(event.target.value)} className="mt-1.5 block rounded-lg border px-3 py-2" /></label>
      </>}
      <button type="button" onClick={() => { setClassFilter(''); setSubjectFilter(''); setTermFilter(''); setAssessmentStatus(''); setCreatedFrom(''); setCreatedTo(''); setSortOrder('latest'); setClassResultsSearch(''); }} disabled={!classFilter && !subjectFilter && !termFilter && !assessmentStatus && !createdFrom && !createdTo && sortOrder === 'latest' && !classResultsSearch} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">Clear filters</button>
    </div>
    <div className="flex flex-wrap justify-end gap-2">
    <PrintButton label={resultsView === 'assessments' ? 'Print assessments' : 'Print scores'}
      disabled={resultsView === 'assessments' ? printAssessmentLoading || Boolean(printAssessmentError) || !printAssessments.length : classResultsLoading || Boolean(classResultsError) || !visibleClassResults.length} />
    {resultsView === 'assessments' && canManageRecords && <button type="button" onClick={() => setFormOpen(true)} className="primary-action flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"><Plus size={16} /> Create assessment</button>}
    {resultsView === 'scores' && canManageRecords && <button type="button" onClick={() => { setAssessmentId(''); setScoreOpen(true); }} className="primary-action rounded-lg px-4 py-2.5 text-sm font-bold">Enter student scores</button>}
    </div>
  </div>
    {resultsView === 'assessments' && (error ? <div className="no-print"><ErrorPanel message={error} /></div> : loading ? <div className="no-print"><Loading /></div> : <div className="no-print sims-table-panel overflow-x-auto"><table className="sims-table w-full min-w-[850px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase"><tr>{assessmentColumns.map(([, label]) => <th className="px-4 py-3" key={label}>{label}</th>)}<th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{pageAssessments.map(row => <tr key={row.id} className="hover:bg-slate-50/70">    {assessmentColumns.map(([key]) => <td className="px-4 py-3" key={key}>{key === 'assessment_date' ? formatDate(row[key]) : key === 'created_at' ? formatDateTime(row[key]) : key === 'status' ? <StatusBadge>{row[key]}</StatusBadge> : row[key] ?? '—'}</td>)}<td className="px-4 py-3"><ActionMenu label={`Actions for ${row.title}`} items={[
      { label: 'View details', onClick: () => setSelectedAssessment(row) },
      { label: 'Delete', onClick: () => setConfirmAssessmentHide(row), visible: canManageRecords && !row.is_deleted, variant: 'danger' }
    ]} /></td></tr>)}</tbody></table>{!totalAssessments && <Empty text="No assessments have been recorded." />}<Pagination page={currentPage} pageCount={pageCount} total={totalAssessments} pageSize={pageSize} onPageChange={setCurrentPage} /></div>)}
    {resultsView === 'scores' && <section className="no-print sims-panel space-y-4">
      <div>
        <h2 className="font-semibold text-navy">Student scores</h2>
        <p className="text-sm text-slate-600">View recorded scores across the selected class’s subjects and assessments.</p>
      </div>
      {!classFilter && <Empty text="Select a class above to view its student scores." />}
      {classFilter && <>
      {classResults.length > 0 && <SearchSuggestions id="class-results-search" value={classResultsSearch}
        onChange={setClassResultsSearch} suggestions={classResultSuggestions}
        pending={classResultsSearch.trim() !== debouncedClassResultsSearch.trim()}
        placeholder="Search student, subject, or assessment" className="max-w-md"
        inputClassName="w-full rounded-lg border border-slate-300 bg-white py-2.5 px-3 text-sm outline-none focus:border-blue-500" />}
      {classResultsError ? <ErrorPanel message={classResultsError} /> : classResultsLoading ? <Loading /> : !visibleClassResults.length
        ? <Empty text={classResults.length ? 'No scores match your search.' : 'No scores have been entered for this class and filter selection.'} />
        : <div className="sims-table-panel overflow-x-auto">
          <table className="sims-table w-full min-w-[1050px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Student code', 'Student', 'Subject', 'Assessment', 'Term', 'Date', 'Score', 'Maximum', 'Percentage', 'Comment'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{pageClassResults.map((row, index) => <tr key={`${row.student_id}-${row.subject}-${row.assessment}-${row.assessment_date}-${index}`} className="hover:bg-slate-50/70">
              <td className="px-4 py-3">{row.student_code}</td>
              <td className="px-4 py-3">{row.english_name}</td>
              <td className="px-4 py-3">{row.subject}</td>
              <td className="px-4 py-3">{row.assessment}</td>
              <td className="px-4 py-3">{row.term}</td>
              <td className="px-4 py-3">{formatDate(row.assessment_date)}</td>
              <td className="px-4 py-3">{Number(row.score).toFixed(2)}</td>
              <td className="px-4 py-3">{Number(row.maximum_score).toFixed(2)}</td>
              <td className="px-4 py-3">{Number(row.percentage).toFixed(1)}%</td>
              <td className="px-4 py-3">{row.comment || '—'}</td>
            </tr>)}</tbody>
          </table>
          <Pagination page={classResultsPage} pageCount={classResultsPageCount} total={visibleClassResults.length} pageSize={pageSize} onPageChange={setClassResultsPage} />
        </div>}
      </>}
    </section>}
    {resultsView === 'assessments' && !printAssessmentError && !printAssessmentLoading && <div className="print-only results-print">
      <h1 className="mb-2 text-xl font-bold">Academic Assessments</h1>
      <p className="mb-4 text-sm text-slate-600">
        Filters: Class — {classFilter ? (meta?.classes || []).find(row => String(row.id) === String(classFilter))?.grade_level + ' · ' + (meta?.classes || []).find(row => String(row.id) === String(classFilter))?.name : 'All classes'}
        {' · '}Subject — {subjectFilter ? (meta?.subjects || []).find(row => String(row.id) === String(subjectFilter))?.name : 'All subjects'}
        {' · '}Term — {termFilter ? (meta?.dashboardTerms || meta?.terms || []).find(row => String(row.id) === String(termFilter))?.name : 'All terms'}
      </p>
      <table className="print-table">
        <thead><tr>{assessmentColumns.map(([, label]) => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
        <tbody>{printAssessments.map(row => <tr key={row.id}>
          {assessmentColumns.map(([key]) => <td key={key}>{formatDisplayValue(key, row[key])}</td>)}<td className="print-other-column"></td>
        </tr>)}</tbody>
      </table>
    </div>}
    {resultsView === 'scores' && classFilter && !classResultsLoading && !classResultsError && <div className="print-only results-print">
      <h1 className="mb-2 text-xl font-bold">Academic Student Scores</h1>
      <p className="mb-4 text-sm">
        Class — {(meta?.classes || []).find(row => String(row.id) === String(classFilter))?.grade_level} · {(meta?.classes || []).find(row => String(row.id) === String(classFilter))?.name}
        {' · '}Subject — {subjectFilter ? (meta?.subjects || []).find(row => String(row.id) === String(subjectFilter))?.name : 'All subjects'}
        {' · '}Term — {termFilter ? (meta?.dashboardTerms || meta?.terms || []).find(row => String(row.id) === String(termFilter))?.name : 'All terms'}
        {debouncedClassResultsSearch.trim() && ` · Search — ${debouncedClassResultsSearch.trim()}`}
      </p>
      {visibleClassResults.length ? <table className="print-table">
        <thead><tr>{['Student code', 'Student', 'Subject', 'Assessment', 'Term', 'Date', 'Score', 'Maximum', 'Percentage', 'Comment'].map(label => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
        <tbody>{visibleClassResults.map((row, index) => <tr key={`${row.student_id}-${row.subject}-${row.assessment}-${row.assessment_date}-${index}`}>
          <td>{row.student_code}</td>
          <td>{row.english_name}</td>
          <td>{row.subject}</td>
          <td>{row.assessment}</td>
          <td>{row.term}</td>
          <td>{formatDate(row.assessment_date)}</td>
          <td>{Number(row.score).toFixed(2)}</td>
          <td>{Number(row.maximum_score).toFixed(2)}</td>
          <td>{Number(row.percentage).toFixed(1)}%</td>
          <td>{row.comment || '—'}</td><td className="print-other-column"></td>
        </tr>)}</tbody>
      </table> : <p>No scores match the selected filters.</p>}
    </div>}
    </>}
    {selectedAssessment && <div className="space-y-5">
      <DetailsPage title="Assessment details" details={[
        ['Assessment', selectedAssessment.title], ['Subject', selectedAssessment.subject],
        ['Class', selectedAssessment.class_name], ['Term', selectedAssessment.term_name],
        ['Date', formatDate(selectedAssessment.assessment_date)], ['Maximum score', selectedAssessment.maximum_score],
        ['Scores entered', selectedAssessment.score_count], ['Status', selectedAssessment.is_deleted ? 'In Trash' : 'Active'],
        ['Public ID', selectedAssessment.id]
      ]} onBack={() => setSelectedAssessment(null)} />
      <section className="sims-panel space-y-3">
        <div>
          <h3 className="font-semibold text-navy">Students with scores</h3>
          <p className="text-sm text-slate-600">Showing {visibleAssessmentScores.length} of {assessmentScores?.length || 0} students · scores out of {Math.min(100, Number(selectedAssessment.maximum_score))}.</p>
        </div>
        {!assessmentScoresLoading && !assessmentScoresError && assessmentScores?.length > 0 && <div className="grid items-end gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 sm:grid-cols-2 xl:grid-cols-12">
          <div className="relative sm:col-span-2 xl:col-span-4">
            <label htmlFor="assessment-score-student-search" className="text-xs font-semibold uppercase tracking-wide text-slate-600">Find student</label>
            <div className="relative mt-1.5">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="assessment-score-student-search"
                type="search"
                autoComplete="off"
                role="combobox"
                aria-expanded={scoreSuggestions.length > 0}
                aria-controls="assessment-score-student-suggestions"
                aria-autocomplete="list"
                value={scoreStudentSearch}
                onChange={event => {
                  setScoreStudentSearch(event.target.value);
                  setSelectedScoreStudentId('');
                }}
                placeholder="Search name or student code"
                className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            {scoreSuggestions.length > 0 && <ul id="assessment-score-student-suggestions" role="listbox" className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {scoreSuggestions.map(student => <li key={student.student_id} role="option" aria-selected="false">
                <button type="button" onClick={() => {
                  setScoreStudentSearch(`${student.english_name} ${student.student_code}`);
                  setSelectedScoreStudentId(student.student_id);
                }} className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50">
                  <span className="block font-medium text-slate-800">{student.english_name}</span>
                  <span className="block text-xs text-slate-500">{student.student_code}</span>
                </button>
              </li>)}
            </ul>}
          </div>
          <div className="xl:col-span-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Score range</span>
            <div className="mt-1.5 flex items-center gap-2">
              <input aria-label="Minimum score" type="number" min="0" max={Math.min(100, Number(selectedAssessment.maximum_score))} step="any" value={minimumScoreFilter} onChange={event => setMinimumScoreFilter(event.target.value)} placeholder="From" className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
              <span className="text-sm text-slate-400">to</span>
              <input aria-label="Maximum score" type="number" min="0" max={Math.min(100, Number(selectedAssessment.maximum_score))} step="any" value={maximumScoreFilter} onChange={event => setMaximumScoreFilter(event.target.value)} placeholder="To" className="min-w-0 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
            </div>
          </div>
          <div className="xl:col-span-2">
            <SearchableSelect name="assessment_score_comment_filter" label="Comments" options={scoreCommentOptions} value={scoreCommentFilter}
              onChange={setScoreCommentFilter} getOptionId={option => option.id} getOptionLabel={option => option.label}
              getOptionSearchText={option => option.label} placeholder="Search comments..." emptyValueLabel="All students"
              noneLabel="All students" debounceDelay={500} />
          </div>
          <div className="xl:col-span-2">
            <SearchableSelect name="assessment_score_sort" label="Sort by" options={scoreSortOptions} value={scoreSort}
              onChange={setScoreSort} getOptionId={option => option.id} getOptionLabel={option => option.label}
              getOptionSearchText={option => option.label} placeholder="Search sort order..." emptyValueLabel="Student name"
              noneLabel="Student name" debounceDelay={500} />
          </div>
          <button type="button" disabled={!hasScoreFilters} onClick={() => {
            setScoreStudentSearch('');
            setSelectedScoreStudentId('');
            setMinimumScoreFilter('');
            setMaximumScoreFilter('');
            setScoreCommentFilter('');
            setScoreSort('name');
          }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-50 xl:col-span-1">Clear filters</button>
        </div>}
        {assessmentScoresError ? <ErrorPanel message={assessmentScoresError} /> : assessmentScoresLoading ? <Loading /> : assessmentScores?.length ? <div className="overflow-x-auto">
          <table className="sims-table w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Student code', 'Student', 'Score', 'Maximum', 'Percentage', 'Comment'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{pageAssessmentScores.map(student => <tr key={student.student_id}>
              <td className="px-4 py-3">{student.student_code}</td>
              <td className="px-4 py-3">{student.english_name}</td>
              <td className="px-4 py-3">{Number(student.score).toFixed(2)}</td>
              <td className="px-4 py-3">{Math.min(100, Number(selectedAssessment.maximum_score)).toFixed(2)}</td>
              <td className="px-4 py-3">{(100 * Number(student.score) / Number(selectedAssessment.maximum_score)).toFixed(1)}%</td>
              <td className="px-4 py-3">{student.comment || '—'}</td>
            </tr>)}</tbody>
          </table>
          {!visibleAssessmentScores.length && <Empty text="No students match these filters." />}
          <Pagination page={assessmentScoresPage} pageCount={assessmentScoresPageCount} total={visibleAssessmentScores.length} pageSize={pageSize} onPageChange={setAssessmentScoresPage} />
        </div> : <Empty text="No student scores have been entered for this assessment." />}
      </section>
    </div>}
    {formOpen && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to academic results"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">Create assessment</h2><p className="text-sm text-slate-500">Enter the assessment details below.</p></div>
      </div>
      <div className="sims-panel">
      <form noValidate onSubmit={createAssessment} onChange={event => {
        const key = event.target.name;
        if (key) setAssessmentFieldErrors(current => ({ ...current, [key]: '' }));
      }} className="grid gap-4 sm:grid-cols-2">
        <AssessmentInput name="title" label="Assessment title" maxLength={inputMaxLengths.title} required error={assessmentFieldErrors.title} />
        <AssessmentSelect name="subject_id" label="Subject" options={subjects || []} getLabel={row => row.name} error={assessmentFieldErrors.subject_id} />
        <AssessmentSelect name="class_id" label="Class" options={meta?.classes || []} getLabel={row => row.name} error={assessmentFieldErrors.class_id} />
        <AssessmentSelect name="term_id" label="Term" options={meta?.terms || []} getLabel={row => `${row.name} · ${row.academic_year}`} error={assessmentFieldErrors.term_id} />
        <AssessmentInput name="assessment_date" label="Date" type="date" defaultValue={today} required error={assessmentFieldErrors.assessment_date} />
        <AssessmentInput name="maximum_score" label="Maximum score (up to 100)" type="number" min="0.01" max="100" step="any" required error={assessmentFieldErrors.maximum_score} />
        {assessmentFormError && <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-2">{assessmentFormError}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 sm:col-span-2">
          <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
          <button type="submit" className="primary-action rounded-lg px-4 py-2 text-sm font-semibold">Create assessment</button>
        </div>
      </form>
      </div>
    </section>}
    {confirmAssessmentHide && <ConfirmActionModal
      title="Move assessment to Trash?"
      message={`Move "${confirmAssessmentHide.title}" to Trash? It can be restored later or permanently deleted from Trash.`}
      onCancel={() => setConfirmAssessmentHide(null)}
      onConfirm={async () => { const row = confirmAssessmentHide; setConfirmAssessmentHide(null); await setAssessmentHidden(row, true); }}
    />}
    {scoreOpen && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={closeScoreModal} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to academic results"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">Enter assessment scores</h2><p className="text-sm text-slate-500">Select an assessment and enter student scores.</p></div>
      </div>
      <div className="sims-panel">
      <form onSubmit={saveScores} className="space-y-4">
      {scoreOptions?.length ? <SearchableSelect
        name="score_assessment"
        label="Search and select an assessment"
        options={scoreOptions.filter(row => !row.is_deleted)}
        value={assessmentId}
        onChange={setAssessmentId}
        getOptionLabel={row => `${row.title} · ${row.class_name}`}
        getOptionSearchText={row => `${row.title} ${row.class_name} ${row.subject} ${row.term_name} ${row.assessment_date}`.toLowerCase()}
        getOptionDetails={row => [
          { label: 'Subject', value: row.subject },
          { label: 'Term', value: row.term_name },
          { label: 'Date', value: formatDate(row.assessment_date) },
          { label: 'Maximum', value: `${Math.min(100, Number(row.maximum_score))} points` }
        ]}
        placeholder="Search title, class, subject, or term..."
        required
      /> : <Empty text="No active assessments are available for score entry." />}
      {!scoreAssessment ? <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-600">Select an assessment to load its students and score inputs.</p> : <div className="space-y-3">
        <p className="text-sm text-slate-600">{scoreAssessment.class_name} · {scoreAssessment.subject} · {scoreAssessment.term_name}. Enter scores from 0 to {Math.min(100, Number(scoreAssessment.maximum_score))}.</p>
        {scoreStudents.length ? <div className="max-h-[50vh] divide-y divide-slate-200 overflow-y-auto border-y border-slate-200">
          {scoreStudents.map(student => <label key={student.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="font-medium text-slate-800">{student.english_name}<span className="ml-2 text-xs font-normal text-slate-600">{student.student_code}</span></span>
            <input type="number" name={`score_${student.id}`} min="0" max={Math.min(100, Number(scoreAssessment.maximum_score))} step="any" disabled={busy} className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-right" />
          </label>)}
        </div> : <Empty text="No students are enrolled in this assessment's class." />}
      </div>}
      <div className="flex justify-end gap-2 border-t border-slate-200 py-4">
        <button type="button" onClick={closeScoreModal} className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:bg-slate-100">Cancel</button>
        <button type="submit" disabled={busy || !scoreAssessment || !scoreStudents.length} className="primary-action rounded-lg px-4 py-2 font-bold disabled:cursor-wait disabled:opacity-50">{busy ? 'Saving...' : 'Save scores'}</button>
      </div>
      </form>
      </div>
    </section>}
  </div>;
}

function Reports() {
  const [type, setType] = useState('enrollment');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [reportStatus, setReportStatus] = useState('');
  const [quickFilters, setQuickFilters] = useState({});
  const [selectedReportRow, setSelectedReportRow] = useState(null);
  const debouncedSearch = useDebouncedValue(search, 500);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;
  const path = `${apiRoute(apiRoutes.reports, { type })}${type === 'attendance' && (from || to) ? `?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}` : ''}`;
  const { data, error, loading } = useLoad(path);
  const columns = data?.length ? Object.keys(data[0]) : [];
  const statusOptions = [...new Set((data || []).map(row => row.status).filter(Boolean))].sort();
  const quickFilterKeys = (reportQuickFilterFields[type] || []).filter(key => columns.includes(key) && key !== 'status');
  const quickFilterOptions = Object.fromEntries(quickFilterKeys.map(key => [
    key,
    [...new Set((data || []).map(row => row[key]).filter(value => value !== null && value !== undefined && String(value) !== '').map(String))].sort()
  ]));
  const filteredRows = (data || []).filter(row =>
    (!reportStatus || row.status === reportStatus) &&
    quickFilterKeys.every(key => !quickFilters[key] || String(row[key] ?? '') === quickFilters[key]) &&
    (!debouncedSearch.trim() || fuzzySearchScore(debouncedSearch, Object.values(row).join(' ')) !== null)
  );
  const reportSuggestions = filteredRows.map((row, index) => {
    const labelValue = row.english_name || row.student_name || row.class_name || row.subject || row.name || row.title || Object.values(row).find(value => value !== null && value !== undefined);
    const description = columns
      .filter(column => column !== 'id' && row[column] !== null && row[column] !== undefined && String(row[column]) !== String(labelValue))
      .slice(0, 3)
      .map(column => `${column.replaceAll('_', ' ')}: ${row[column]}`)
      .join(' · ');
    return {
      key: row.id || `${type}-${index}`,
      value: String(labelValue ?? ''),
      label: String(labelValue ?? 'Report record'),
      description,
      searchText: Object.values(row).join(' ')
    };
  });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setCurrentPage(1); }, [type, from, to, debouncedSearch, quickFilters, reportStatus]);
  useEffect(() => {
    setFrom('');
    setTo('');
    setSearch('');
    setQuickFilters({});
    setReportStatus('');
  }, [type]);
  function exportCsv() {
    if (!filteredRows.length) return;
    const escape = value => {
      const text = String(value ?? '');
      const safe = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const csv = [columns.map(escape).join(','), ...filteredRows.map(row => columns.map(key => escape(row[key])).join(','))].join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `sims-${type}-${today}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }
  function clearReportFilters() {
    setFrom('');
    setTo('');
    setSearch('');
    setReportStatus('');
    setQuickFilters({});
  }
  const reportTitle = reportTypes.find(([key]) => key === type)?.[1] || 'MIS report';
  const activeFilters = [
    ...(search.trim() ? [`Search: ${search.trim()}`] : []),
    ...(from ? [`From ${formatDate(from)}`] : []),
    ...(to ? [`To ${formatDate(to)}`] : []),
    ...(reportStatus ? [`Status: ${reportStatus}`] : []),
    ...quickFilterKeys.filter(key => quickFilters[key]).map(key => `${key.replaceAll('_', ' ')}: ${quickFilters[key]}`)
  ];
  return <div className="space-y-4">
    {!selectedReportRow && <>
    <section className="no-print sims-panel space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-navy">{reportTitle}</h2><p className="mt-1 text-sm text-slate-500">Choose a report, narrow the results, then search or print the matching rows.</p></div>
        <span className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700">{filteredRows.length} matching rows</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block min-w-0 text-sm font-medium text-slate-700">Report
          <select value={type} onChange={event => setType(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
            {reportTypes.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select>
        </label>
        {type === 'attendance' && <>
          <FieldInput label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)} />
          <FieldInput label="To date" type="date" value={to} onChange={event => setTo(event.target.value)} />
        </>}
        {statusOptions.length > 0 && <label className="block min-w-0 text-sm font-medium text-slate-700">Status
          <select value={reportStatus} onChange={event => setReportStatus(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
            <option value="">All statuses</option>{statusOptions.map(status => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>}
      </div>
      {quickFilterKeys.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {quickFilterKeys.map(key => <SearchableSelect key={key} name={`report_filter_${key}`} label={key.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())}
          options={quickFilterOptions[key]} value={quickFilters[key] || ''}
          onChange={value => setQuickFilters(current => ({ ...current, [key]: value }))}
          getOptionId={option => option} getOptionLabel={option => option} getOptionSearchText={option => option}
          placeholder={`Search ${key.replaceAll('_', ' ')}...`} emptyValueLabel={`All ${key.replaceAll('_', ' ')}`}
          noneLabel={`All ${key.replaceAll('_', ' ')}`} debounceDelay={500} />)}
      </div>}
      <div className="grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <SearchSuggestions id="report-search" label="Search report rows" value={search}
          onChange={setSearch} suggestions={reportSuggestions} pending={search.trim() !== debouncedSearch.trim() || loading}
          placeholder="Search names, classes, subjects, codes..."
          inputClassName="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={clearReportFilters} disabled={!search && !reportStatus && !Object.values(quickFilters).some(Boolean) && !from && !to}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Clear filters</button>
          <button type="button" onClick={exportCsv} disabled={!filteredRows.length} className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold disabled:opacity-40"><ArrowDownToLine size={16} /> Export CSV</button>
          <PrintButton label="Print report" disabled={!filteredRows.length || loading || Boolean(error)} />
        </div>
      </div>
    </section>
    {error ? <ErrorPanel message={error} /> : loading ? <Loading /> : !filteredRows.length ? <Empty text="No rows match the current search and filters." /> : <div className="no-print sims-table-panel overflow-x-auto"><table className="sims-table w-full min-w-[800px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase"><tr>{columns.map(key => <th key={key} className="px-4 py-3">{key.replaceAll('_',' ')}</th>)}<th className="px-4 py-3">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{pageRows.map((row,index) => <tr key={row.id || index} className="hover:bg-slate-50/70">{columns.map(key => <td key={key} className="px-4 py-3">{formatDisplayValue(key, row[key])}</td>)}<td className="px-4 py-3"><ActionMenu label="Report row actions" items={[{ label: 'View details', onClick: () => setSelectedReportRow(row) }]} /></td></tr>)}</tbody></table><div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-slate-600"><span>Showing {Math.min(filteredRows.length, (currentPage - 1) * pageSize + 1)}–{Math.min(filteredRows.length, currentPage * pageSize)} of {filteredRows.length} · <strong>Found: {filteredRows.length}</strong></span><div className="flex items-center gap-2"><button disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Previous</button><span>Page {currentPage} of {pageCount}</span><button disabled={currentPage >= pageCount} onClick={() => setCurrentPage(currentPage + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Next</button></div></div></div>}
    <section className="print-only mis-report-print">
      <header>
        <p>School MIS · Management Information System</p>
        <h1>{reportTitle}</h1>
        <p>Generated {new Date().toLocaleString()}</p>
        <p>Filters: {activeFilters.length ? activeFilters.join(' · ') : 'None'} · {filteredRows.length} records</p>
      </header>
      {filteredRows.length ? <table className="print-table">
        <thead><tr>{columns.map(key => <th key={key}>{key.replaceAll('_', ' ')}</th>)}<th className="print-other-column">Other</th></tr></thead>
        <tbody>{filteredRows.map((row, index) => <tr key={row.id || index}>
          {columns.map(key => <td key={key}>{formatDisplayValue(key, row[key])}</td>)}<td className="print-other-column"></td>
        </tr>)}</tbody>
      </table> : <p>No rows match the current search and filters.</p>}
    </section>
    </>}
    {selectedReportRow && <DetailsPage title="Report row details" details={columns.map(key => [
      key.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()), formatDisplayValue(key, selectedReportRow[key])
    ])} onBack={() => setSelectedReportRow(null)} />}
  </div>;
}

function AttendancePrintTable({ rows }) {
  return <table className="print-table">
    <thead><tr>{['Date', 'Student code', 'Student', 'Class', 'Schedule', 'Subject', 'Status'].map(label => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}>
      <td>{formatDate(row.attendance_date)}</td><td>{row.student_code}</td><td>{row.english_name}</td>
      <td>{row.class_name}</td><td>{row.schedule_time ? formatTime(row.schedule_time) : 'Legacy'}</td>
      <td>{row.subject_name || 'Daily (legacy)'}</td><td>{row.status}</td><td className="print-other-column"></td>
    </tr>)}</tbody>
  </table>;
}

function AttendancePrintSummary({ rows }) {
  const studentsByStatus = rows.reduce((summary, row) => {
    if (row.student_id && summary[row.status]) summary[row.status].add(row.student_id);
    return summary;
  }, { Present: new Set(), Absent: new Set(), Late: new Set(), Excused: new Set() });
  const studentCount = new Set(rows.map(row => row.student_id).filter(Boolean)).size;
  return <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
    <div><strong>Records:</strong> {rows.length}</div>
    <div><strong>Students:</strong> {studentCount}</div>
    {['Present', 'Absent', 'Late', 'Excused'].map(status => <div key={status}><strong>{status} students:</strong> {studentsByStatus[status].size}</div>)}
  </div>;
}


function DecisionSupport() {
  const { data: meta } = useLoad(apiRoutes.meta);
  const [attendanceThreshold, setAttendanceThreshold] = useState('80');
  const [performanceThreshold, setPerformanceThreshold] = useState('60');
  const [attendanceDays, setAttendanceDays] = useState('30');
  const [customAttendanceFrom, setCustomAttendanceFrom] = useState(() => {
    const date = new Date(localDate);
    date.setDate(date.getDate() - 29);
    return dateInputValue(date);
  });
  const [customAttendanceTo, setCustomAttendanceTo] = useState(today);
  const [classFilter, setClassFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [selectedInsight, setSelectedInsight] = useState(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const printSections = [
    ['attendance', 'Attendance review'],
    ['performance', 'Academic performance review'],
    ['averages', 'Class and subject averages'],
    ['trends', 'Enrollment trend']
  ];
  const [selectedPrintSections, setSelectedPrintSections] = useState(printSections.map(([id]) => id));
  const [printSelection, setPrintSelection] = useState(printSections.map(([id]) => id));
  const debouncedAttendanceThreshold = useDebouncedValue(attendanceThreshold, 500);
  const debouncedPerformanceThreshold = useDebouncedValue(performanceThreshold, 500);
  useEffect(() => {
    const resetPrintSelection = () => {
      setPrintSelection(printSections.map(([id]) => id));
    };
    window.addEventListener('afterprint', resetPrintSelection);
    return () => window.removeEventListener('afterprint', resetPrintSelection);
  }, []);
  const customRangeInvalid = attendanceDays === 'custom' &&
    (!customAttendanceFrom || !customAttendanceTo || customAttendanceFrom > customAttendanceTo);
  const attendancePeriodLabel = attendanceDays === 'custom'
    ? `${customAttendanceFrom} to ${customAttendanceTo}`
    : attendanceDays === '1' ? 'Today' : `Last ${attendanceDays} days`;
  const query = new URLSearchParams({
    attendance_threshold: debouncedAttendanceThreshold || '80',
    performance_threshold: debouncedPerformanceThreshold || '60'
  });
  if (attendanceDays === 'custom') {
    if (!customRangeInvalid) {
      query.set('attendance_from', customAttendanceFrom);
      query.set('attendance_to', customAttendanceTo);
    }
  } else {
    query.set('attendance_days', attendanceDays);
  }
  const path = customRangeInvalid ? null : `${apiRoutes.decisionSupport}?${query.toString()}`;
  const { data, error, loading } = useLoad(path);
  const classes = meta?.classes || [];
  const grades = [...new Set(classes.map(row => row.grade_level).filter(Boolean))].sort();
  const genders = ['Female', 'Male', 'Other'];
  const subjects = meta?.subjects || [];
  const matchesFilters = row =>
    (!classFilter || String(row.class_id) === String(classFilter)) &&
    (!gradeFilter || row.grade_level === gradeFilter) &&
    (!genderFilter || row.gender === genderFilter) &&
    (!subjectFilter || row.subject === subjectFilter);
  const attendanceRows = (data?.attendance || []).filter(matchesFilters);
  const performanceRows = (data?.performance || []).filter(matchesFilters);
  const hasFilters = attendanceDays !== '30' || classFilter || gradeFilter || genderFilter || subjectFilter;
  function clearFilters() {
    setAttendanceDays('30');
    setCustomAttendanceFrom(() => {
      const date = new Date(localDate);
      date.setDate(date.getDate() - 29);
      return dateInputValue(date);
    });
    setCustomAttendanceTo(today);
    setClassFilter('');
    setGradeFilter('');
    setGenderFilter('');
    setSubjectFilter('');
  }
  function updateThreshold(setter, value) {
    if (value === '') return setter('');
    const number = Number(value);
    if (Number.isFinite(number)) setter(String(Math.round(Math.min(100, Math.max(0, number)))));
  }
  function printDecisionData() {
    if (!selectedPrintSections.length) return;
    setPrintModalOpen(false);
    setPrintSelection([...selectedPrintSections]);
    window.requestAnimationFrame(() => window.print());
  }
  function togglePrintSection(section) {
    setSelectedPrintSections(current => current.includes(section)
      ? current.filter(item => item !== section)
      : [...current, section]);
  }
  function toggleAllPrintSections() {
    setSelectedPrintSections(current => current.length === printSections.length
      ? []
      : printSections.map(([id]) => id));
  }
  const printAllSelected = selectedPrintSections.length === printSections.length;
  const printTitle = printAllSelected
    ? 'Decision support data'
    : selectedPrintSections.length === 1
      ? printSections.find(([id]) => id === selectedPrintSections[0])?.[1] || 'Decision support data'
      : 'Selected decision support data';
  const shouldPrint = section => printSelection.includes(section);
  if (selectedInsight) return <DetailsPage
    title={`${selectedInsight.title} details`}
    details={Object.entries(selectedInsight.row).map(([key, value]) => [
      key.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()), value
    ])}
    onBack={() => setSelectedInsight(null)}
  />;
  return <div className="space-y-4">
    <div className="no-print space-y-4">
    <section className="sims-panel space-y-3 !p-3 sm:!p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-navy">Decision support filters</h2>
          <p className="mt-1 text-sm text-slate-500">Choose a review period and student group, then set the thresholds.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!hasFilters} onClick={clearFilters} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear filters</button>
          <button type="button" disabled={attendanceThreshold === '80' && performanceThreshold === '60'} onClick={() => { setAttendanceThreshold('80'); setPerformanceThreshold('60'); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Reset</button>
          <PrintButton label="Print options" onClick={() => setPrintModalOpen(true)} disabled={loading || Boolean(error) || !data || customRangeInvalid} />
        </div>
      </div>
      <div className="grid gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm font-medium text-slate-700">Attendance period
          <select value={attendanceDays} onChange={event => setAttendanceDays(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom date range</option>
          </select>
        </label>
        {attendanceDays === 'custom' && <>
          <label className="block text-sm font-medium text-slate-700">From
            <input aria-label="Attendance start date" type="date" value={customAttendanceFrom} max={customAttendanceTo || today} onChange={event => setCustomAttendanceFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </label>
          <label className="block text-sm font-medium text-slate-700">To
            <input aria-label="Attendance end date" type="date" value={customAttendanceTo} min={customAttendanceFrom || undefined} max={today} onChange={event => setCustomAttendanceTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </label>
        </>}
        <label className="block text-sm font-medium text-slate-700">Class
          <select value={classFilter} onChange={event => setClassFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">All classes</option>{classes.map(row => <option key={row.id} value={row.id}>{row.grade_level} · {row.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Grade
          <select value={gradeFilter} onChange={event => setGradeFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">All grades</option>{grades.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Gender
          <select value={genderFilter} onChange={event => setGenderFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">All genders</option>{genders.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">Subject
          <select value={subjectFilter} onChange={event => setSubjectFilter(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="">All subjects</option>{subjects.map(row => <option key={row.id} value={row.name}>{row.name}</option>)}
          </select>
        </label>
      </div>
      {customRangeInvalid && <p role="alert" className="text-sm text-red-700">{!customAttendanceFrom || !customAttendanceTo ? 'Choose both dates for the custom range.' : 'The end date must be on or after the start date.'}</p>}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Review thresholds</h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 sm:w-80">
            <span>Attendance <span className="block text-xs font-normal text-slate-500">{attendancePeriodLabel}</span></span>
            <span className="flex w-24 shrink-0 items-center rounded-lg border border-slate-300 bg-white pr-2 focus-within:border-blue-500">
              <input aria-label="Attendance review threshold percent" type="number" min="0" max="100" step="1" value={attendanceThreshold} onChange={event => updateThreshold(setAttendanceThreshold, event.target.value)} onBlur={() => { if (attendanceThreshold === '') setAttendanceThreshold('80'); }} className="w-full rounded-lg border-0 bg-transparent px-2 py-2 text-right text-sm focus:outline-none focus:ring-0" />
              <span className="text-sm text-slate-500">%</span>
            </span>
          </label>
          <label className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 sm:w-80">
            <span>Academic performance <span className="block text-xs font-normal text-slate-500">Current term</span></span>
            <span className="flex w-24 shrink-0 items-center rounded-lg border border-slate-300 bg-white pr-2 focus-within:border-blue-500">
              <input aria-label="Academic performance threshold percent" type="number" min="0" max="100" step="1" value={performanceThreshold} onChange={event => updateThreshold(setPerformanceThreshold, event.target.value)} onBlur={() => { if (performanceThreshold === '') setPerformanceThreshold('60'); }} className="w-full rounded-lg border-0 bg-transparent px-2 py-2 text-right text-sm focus:outline-none focus:ring-0" />
              <span className="text-sm text-slate-500">%</span>
            </span>
          </label>
        </div>
      </div>
      {(attendanceThreshold !== debouncedAttendanceThreshold || performanceThreshold !== debouncedPerformanceThreshold) && <p role="status" className="text-xs text-slate-500">Updating indicators…</p>}
    </section>
    {customRangeInvalid ? null : error ? <ErrorPanel message={error} /> : loading || !data ? <Loading /> : <>
      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <ChartCard title="Class and subject averages" subtitle="Use differences as a prompt to review context">
          <ResponsiveContainer width="100%" height={250}><BarChart data={data.classAverages.slice(0, 20)} margin={{ top: 8, right: 12, left: 0, bottom: 45 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="class_name" tickLine={false} axisLine={false} angle={-30} textAnchor="end" interval="preserveStartEnd" height={55} /><YAxis domain={[0, 100]} /><Tooltip /><Legend /><Bar dataKey="average" name="Average %" fill="#2563eb" />
          </BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Enrollment trend" subtitle="Monthly counts from student records">
          <ResponsiveContainer width="100%" height={250}><LineChart data={data.enrollmentTrends} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} /><Tooltip /><Line dataKey="enrollments" name="Enrollments" stroke="#16a34a" strokeWidth={3} />
          </LineChart></ResponsiveContainer>
        </ChartCard>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <InsightList title="Attendance review" rows={attendanceRows} empty="No attendance indicators match these filters." onSelect={row => setSelectedInsight({ title: 'Attendance review', row })} />
        <InsightList title="Academic performance review" rows={performanceRows} empty="No performance indicators match these filters." onSelect={row => setSelectedInsight({ title: 'Academic performance review', row })} />
      </div>
      <p className="text-xs text-slate-500"><AlertTriangle size={14} className="mr-1 inline" />Indicators support staff review and do not make decisions about students.</p>
    </>}
    </div>
    {!error && data && <section className="print-only decision-support-print">
      <header>
        <p>School MIS · Decision support</p>
        <h1>{printTitle}</h1>
        <p>Generated {new Date().toLocaleString()}</p>
        <p>Attendance period: {attendancePeriodLabel} · Attendance threshold: {debouncedAttendanceThreshold}% · Academic performance threshold: {debouncedPerformanceThreshold}%</p>
        <p>Filters: {[classFilter && `Class: ${classes.find(row => String(row.id) === String(classFilter))?.name || classFilter}`, gradeFilter && `Grade: ${gradeFilter}`, genderFilter && `Gender: ${genderFilter}`, subjectFilter && `Subject: ${subjectFilter}`].filter(Boolean).join(' · ') || 'None'}</p>
        <p>Indicators prompt staff review and are not decisions about students.</p>
      </header>
      {[...(shouldPrint('attendance') ? [['Attendance review', attendanceRows]] : []), ...(shouldPrint('performance') ? [['Academic performance review', performanceRows]] : [])].map(([title, rows]) => <section key={title}>
        <h2>{title} · {rows.length} records</h2>
        {rows.length ? <table className="print-table">
          <thead><tr>{['Student', 'Student code', 'Class', 'Subject', 'Value', 'Reason'].map(name => <th key={name}>{name}</th>)}<th className="print-other-column">Other</th></tr></thead>
          <tbody>{rows.map((row, index) => <tr key={`${row.id}-${row.subject || index}`}>
            <td>{row.english_name}</td><td>{row.student_code}</td><td>{row.class_name || '—'}{row.grade_level ? ` · ${row.grade_level}` : ''}</td>
            <td>{row.subject || '—'}</td><td>{row.value}%</td><td>{row.reason}</td><td className="print-other-column"></td>
          </tr>)}</tbody>
        </table> : <p>No indicators at the selected threshold.</p>}
      </section>)}
      {shouldPrint('averages') && <>
        <section>
          <h2>Class and subject averages · {data.classAverages.length} records</h2>
          <table className="print-table">
            <thead><tr><th>Class</th><th>Subject</th><th>Average</th><th className="print-other-column">Other</th></tr></thead>
            <tbody>{data.classAverages.map((row, index) => <tr key={`${row.class_name}-${row.subject}-${index}`}><td>{row.class_name}</td><td>{row.subject}</td><td>{row.average}%</td><td className="print-other-column"></td></tr>)}</tbody>
          </table>
        </section>
      </>}
      {shouldPrint('trends') && <>
        <section>
          <h2>Enrollment trend · {data.enrollmentTrends.length} months</h2>
          <table className="print-table">
            <thead><tr><th>Month</th><th>Enrollments</th><th className="print-other-column">Other</th></tr></thead>
            <tbody>{data.enrollmentTrends.map(row => <tr key={row.month}><td>{row.month}</td><td>{row.enrollments}</td><td className="print-other-column"></td></tr>)}</tbody>
          </table>
        </section>
      </>}
    </section>}
    {printModalOpen && <Modal title="Choose print sections" onClose={() => setPrintModalOpen(false)}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Select one or more sections to include in the printout.</p>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800">
          <input type="checkbox" checked={printAllSelected} onChange={toggleAllPrintSections} className="h-4 w-4 accent-blue-600" />
          All sections
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {printSections.map(([id, label]) => <label key={id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700 hover:bg-blue-50">
            <input type="checkbox" checked={selectedPrintSections.includes(id)} onChange={() => togglePrintSection(id)} className="h-4 w-4 accent-blue-600" />
            {label}
          </label>)}
        </div>
        <p className="text-xs text-slate-500">{selectedPrintSections.length} of {printSections.length} sections selected.</p>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
          <button type="button" onClick={() => setPrintModalOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
          <button type="button" disabled={!selectedPrintSections.length} onClick={printDecisionData} className="primary-action rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Print selected</button>
        </div>
      </div>
    </Modal>}
  </div>;
}

function ConfirmActionModal({ title, message, onCancel, onConfirm }) {
  return <Modal title={title} onClose={onCancel}>
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
        <button type="button" onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Confirm</button>
      </div>
    </div>
  </Modal>;
}

function SettingsPage({ user, onError, onSuccess }) {
  const { data: meta, reload: reloadMeta } = useLoad(apiRoutes.meta);
  const { data, error, loading, reload } = useLoad(apiRoutes.gradingScales.collection);
  const terms = useLoad(apiRoutes.terms.collection);
  const [selectedTerm, setSelectedTerm] = useState(null);
  const [selectedScale, setSelectedScale] = useState(null);
  const [selectedYear, setSelectedYear] = useState(null);
  const [academicYearStatus, setAcademicYearStatus] = useState('');
  const [yearSearch, setYearSearch] = useState('');
  const [termSearch, setTermSearch] = useState('');
  const [scaleSearch, setScaleSearch] = useState('');
  const [termYearFilter, setTermYearFilter] = useState('');
  const [scaleYearFilter, setScaleYearFilter] = useState('');
  const [yearPage, setYearPage] = useState(1);
  const [termPage, setTermPage] = useState(1);
  const [scalePage, setScalePage] = useState(1);
  const [yearFormOpen, setYearFormOpen] = useState(false);
  const [yearFormItem, setYearFormItem] = useState(null);
  const [yearIsCurrent, setYearIsCurrent] = useState(false);
  const [termFormOpen, setTermFormOpen] = useState(false);
  const [scaleFormOpen, setScaleFormOpen] = useState(false);
  const [termFormItem, setTermFormItem] = useState(null);
  const [scaleFormItem, setScaleFormItem] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [settingsFormError, setSettingsFormError] = useState('');
  const [termYearId, setTermYearId] = useState('');
  const [scaleYearId, setScaleYearId] = useState('');
  const isAdministrator = ['Admin', 'SuperAdmin'].includes(user.role);
  const debouncedYearSearch = useDebouncedValue(yearSearch, 500);
  const debouncedTermSearch = useDebouncedValue(termSearch, 500);
  const debouncedScaleSearch = useDebouncedValue(scaleSearch, 500);
  const settingsPageSize = 25;
  function printSettingsTable(target) {
    document.body.dataset.printTarget = target;
    const cleanup = () => {
      delete document.body.dataset.printTarget;
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }
  useEffect(() => {
    if (scaleFormOpen && !scaleYearId && meta?.academicYear?.id) setScaleYearId(meta.academicYear.id);
  }, [scaleFormOpen, scaleYearId, meta?.academicYear?.id]);
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    values.minimum_percentage = Number(values.minimum_percentage);
    values.maximum_percentage = Number(values.maximum_percentage);
    if (values.maximum_percentage < values.minimum_percentage) {
      setSettingsFormError('Maximum percentage must be greater than or equal to minimum percentage.');
      return;
    }
    setSettingsFormError('');
    try {
      await api(scaleFormItem
        ? apiRoute(apiRoutes.gradingScales.item, { id: scaleFormItem.id })
        : apiRoutes.gradingScales.collection, {
        method: scaleFormItem ? 'PATCH' : 'POST',
        body: JSON.stringify(values)
      });
      form.reset();
      setScaleFormOpen(false);
      setScaleFormItem(null);
      onSuccess(`Grading scale ${scaleFormItem ? 'updated' : 'added'}.`);
      reload();
    } catch (err) { setSettingsFormError(err.message); onError(err.message); }
  }
  async function submitTerm(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(e.currentTarget));
    values.academic_year_id = termYearId;
    setSettingsFormError('');
    try {
      await api(termFormItem
        ? apiRoute(apiRoutes.terms.item, { id: termFormItem.id })
        : apiRoutes.terms.collection, {
        method: termFormItem ? 'PATCH' : 'POST',
        body: JSON.stringify(values)
      });
      form.reset();
      setTermFormOpen(false);
      setTermFormItem(null);
      onSuccess(`Academic term ${termFormItem ? 'updated' : 'created'}.`);
      terms.reload();
    } catch (err) { setSettingsFormError(err.message); onError(err.message); }
  }
  async function submitYear(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.is_current = yearIsCurrent;
    setSettingsFormError('');
    try {
      await api(yearFormItem
        ? apiRoute(apiRoutes.academicYears.item, { id: yearFormItem.id })
        : apiRoutes.academicYears.collection, {
        method: yearFormItem ? 'PATCH' : 'POST',
        body: JSON.stringify(values)
      });
      form.reset();
      setYearFormOpen(false);
      setYearFormItem(null);
      onSuccess(`Academic year ${yearFormItem ? 'updated' : 'created'}.`);
      reloadMeta();
      terms.reload();
      reload();
    } catch (err) { setSettingsFormError(err.message); onError(err.message); }
  }
  function openYearForm(row = null) {
    setSelectedYear(null);
    setYearFormItem(row);
    setYearIsCurrent(Boolean(row?.is_current));
    setSettingsFormError('');
    setYearFormOpen(true);
  }
  function openTermForm(row = null) {
    setSelectedTerm(null);
    setTermFormItem(row);
    setTermYearId(row?.academic_year_id || '');
    setSettingsFormError('');
    setTermFormOpen(true);
  }
  function openScaleForm(row = null) {
    setSelectedScale(null);
    setScaleFormItem(row);
    setScaleYearId(row?.academic_year_id || meta?.academicYear?.id || '');
    setSettingsFormError('');
    setScaleFormOpen(true);
  }
  async function deleteSetting() {
    if (!pendingDelete) return;
    const { type, row } = pendingDelete;
    try {
      const endpoint = type === 'term' ? apiRoutes.terms.item
        : type === 'academic year' ? apiRoutes.academicYears.item
          : apiRoutes.gradingScales.item;
      await api(apiRoute(endpoint, { id: row.id }), { method: 'DELETE' });
      setPendingDelete(null);
      onSuccess(type === 'term' ? 'Academic term deleted.' : type === 'academic year' ? 'Academic year deleted.' : 'Grading scale deleted.');
      if (type === 'term') terms.reload();
      else if (type === 'academic year') reloadMeta();
      else reload();
    } catch (err) { onError(err.message); }
  }
  async function updateAcademicYearStatus(row, value) {
    const isCurrent = value === 'Current';
    if (isCurrent === Boolean(row.is_current)) return;
    try {
      await api(apiRoute(apiRoutes.academicYears.item, { id: row.id }), {
        method: 'PATCH',
        body: JSON.stringify({
          name: row.name,
          start_date: String(row.start_date).slice(0, 10),
          end_date: String(row.end_date).slice(0, 10),
          is_current: isCurrent
        })
      });
      onSuccess(`${row.name} ${isCurrent ? 'set as current' : 'removed as current'} academic year.`);
      reloadMeta();
    } catch (err) {
      onError(err.message);
      reloadMeta();
    }
  }
  const formPage = yearFormOpen || termFormOpen || scaleFormOpen;
  const visibleAcademicYears = (meta?.academicYears || []).filter(year =>
    (!academicYearStatus || (year.is_current ? 'Current' : 'Not current') === academicYearStatus) &&
    (!debouncedYearSearch.trim() || fuzzySearchScore(debouncedYearSearch, `${year.name} ${year.start_date} ${year.end_date}`) !== null)
  );
  const visibleTerms = (terms.data || []).filter(term =>
    (!termYearFilter || String(term.academic_year_id) === String(termYearFilter)) &&
    (!debouncedTermSearch.trim() || fuzzySearchScore(debouncedTermSearch, `${term.name} ${term.academic_year} ${term.start_date} ${term.end_date}`) !== null)
  );
  const visibleScales = (data || []).filter(scale =>
    (!scaleYearFilter || String(scale.academic_year_id) === String(scaleYearFilter)) &&
    (!debouncedScaleSearch.trim() || fuzzySearchScore(debouncedScaleSearch, `${scale.academic_year} ${scale.label} ${scale.description || ''} ${scale.minimum_percentage} ${scale.maximum_percentage}`) !== null)
  );
  const yearPageCount = Math.max(1, Math.ceil(visibleAcademicYears.length / settingsPageSize));
  const termPageCount = Math.max(1, Math.ceil(visibleTerms.length / settingsPageSize));
  const scalePageCount = Math.max(1, Math.ceil(visibleScales.length / settingsPageSize));
  const pageAcademicYears = visibleAcademicYears.slice((yearPage - 1) * settingsPageSize, yearPage * settingsPageSize);
  const pageTerms = visibleTerms.slice((termPage - 1) * settingsPageSize, termPage * settingsPageSize);
  const pageScales = visibleScales.slice((scalePage - 1) * settingsPageSize, scalePage * settingsPageSize);
  useEffect(() => { setYearPage(1); }, [academicYearStatus, debouncedYearSearch]);
  useEffect(() => { setTermPage(1); }, [termYearFilter, debouncedTermSearch]);
  useEffect(() => { setScalePage(1); }, [scaleYearFilter, debouncedScaleSearch]);
  useEffect(() => {
    if (yearPage > yearPageCount) setYearPage(yearPageCount);
  }, [yearPage, yearPageCount]);
  useEffect(() => {
    if (termPage > termPageCount) setTermPage(termPageCount);
  }, [termPage, termPageCount]);
  useEffect(() => {
    if (scalePage > scalePageCount) setScalePage(scalePageCount);
  }, [scalePage, scalePageCount]);
  const yearSuggestions = visibleAcademicYears.map(year => ({
    key: year.id, value: year.name, label: year.name,
    description: `${formatDate(year.start_date)} – ${formatDate(year.end_date)}`,
    searchText: `${year.name} ${year.start_date} ${year.end_date}`
  }));
  const termSuggestions = visibleTerms.map(term => ({
    key: term.id, value: term.name, label: term.name,
    description: [term.academic_year, `${formatDate(term.start_date)} – ${formatDate(term.end_date)}`].filter(Boolean).join(' · '),
    searchText: `${term.name} ${term.academic_year} ${term.start_date} ${term.end_date}`
  }));
  const scaleSuggestions = visibleScales.map(scale => ({
    key: scale.id, value: scale.label, label: `${scale.label} · ${scale.minimum_percentage}%–${scale.maximum_percentage}%`,
    description: [scale.academic_year, scale.description].filter(Boolean).join(' · '),
    searchText: `${scale.academic_year} ${scale.label} ${scale.description || ''} ${scale.minimum_percentage} ${scale.maximum_percentage}`
  }));
  return <div className="space-y-5">
    {isAdministrator && !formPage && <SyncManagementPanel onError={onError} onSuccess={onSuccess} />}
    {!formPage && !selectedYear && !selectedTerm && !selectedScale && <>
    {isAdministrator && <div className="no-print sims-panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Academic years</h2><p className="mt-1 text-sm text-slate-500">Manage school-year dates and choose the current year.</p></div>
        <div className="flex flex-wrap gap-2"><PrintButton label="Print academic years" disabled={!meta || !visibleAcademicYears.length} onClick={() => printSettingsTable('settings-years')} /><button type="button" onClick={() => openYearForm()} className="primary-action flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"><Plus size={16} /> Add academic year</button></div>
      </div>
      <div className="sims-filter-grid mb-4">
      <SearchSuggestions id="settings-year-search" label="Search academic years" value={yearSearch}
        onChange={setYearSearch} suggestions={yearSuggestions} pending={yearSearch.trim() !== debouncedYearSearch.trim()}
        placeholder="Search year or date..." inputClassName="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" />
      <label className="block min-w-0 text-sm font-medium text-slate-700">Status
        <select value={academicYearStatus} onChange={event => setAcademicYearStatus(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5">
          <option value="">All statuses</option><option value="Current">Current</option><option value="Not current">Not current</option>
        </select>
      </label>
      <button type="button" disabled={!yearSearch && !academicYearStatus} onClick={() => { setYearSearch(''); setAcademicYearStatus(''); }} className="self-end rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear filters</button>
      </div>
      {!meta ? <Loading /> : <div className="sims-table-panel overflow-x-auto"><table className="sims-table w-full min-w-[700px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Academic year','Start date','End date','Status','Actions'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{pageAcademicYears.map(row => <tr key={row.id} className="hover:bg-slate-50/70">
          <td className="px-4 py-3 font-medium">{row.name}</td><td className="px-4 py-3">{formatDate(row.start_date)}</td><td className="px-4 py-3">{formatDate(row.end_date)}</td>
          <td className="px-4 py-3"><StatusSelect label={`Change status for academic year ${row.name}`} value={row.is_current ? 'Current' : 'Not current'} options={['Current', 'Not current']} onChange={value => updateAcademicYearStatus(row, value)} /></td>
          <td className="px-4 py-3"><ActionMenu label={`Actions for academic year ${row.name}`} items={[
            { label: 'View details', onClick: () => setSelectedYear(row) },
            { label: 'Edit', onClick: () => openYearForm(row) },
            { label: 'Delete', variant: 'danger', onClick: () => setPendingDelete({ type: 'academic year', row }) }
          ]} /></td>
        </tr>)}</tbody>
      </table>{!visibleAcademicYears.length && <Empty text={meta.academicYears.length ? 'No academic years match your search and status filters.' : 'No academic years have been configured.'} />}<Pagination page={yearPage} pageCount={yearPageCount} total={visibleAcademicYears.length} pageSize={settingsPageSize} onPageChange={setYearPage} /></div>}
    </div>}
    <div className="no-print sims-panel">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Academic terms</h2><p className="mt-1 text-sm text-slate-500">Add school terms to an existing academic year.</p></div>
        <div className="flex flex-wrap gap-2"><PrintButton label="Print academic terms" disabled={terms.loading || !visibleTerms.length} onClick={() => printSettingsTable('settings-terms')} />{isAdministrator && <button type="button" onClick={() => openTermForm()} className="primary-action flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"><Plus size={16} /> Add term</button>}</div>
      </div>
      <div className="sims-filter-grid mb-4">
        <SearchSuggestions id="settings-term-search" label="Search terms" value={termSearch}
          onChange={setTermSearch} suggestions={termSuggestions} pending={termSearch.trim() !== debouncedTermSearch.trim()}
          placeholder="Search term or academic year..." inputClassName="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" />
        <SearchableSelect name="settings_term_year_filter" label="Academic year" options={meta?.academicYears || []} value={termYearFilter} onChange={setTermYearFilter}
          getOptionLabel={year => year.name} getOptionSearchText={year => year.name} placeholder="Search years..."
          emptyValueLabel="All years" noneLabel="All years" />
        <button type="button" disabled={!termSearch && !termYearFilter} onClick={() => { setTermSearch(''); setTermYearFilter(''); }} className="self-end rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear filters</button>
      </div>
      {terms.error ? <ErrorPanel message={terms.error} /> : terms.loading ? <Loading /> : <div className="sims-table-panel scrollbar mt-4 overflow-x-auto"><table className="sims-table w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Academic year','Term','Start date','End date','Actions'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{pageTerms.map(row => <tr key={row.id} className="hover:bg-slate-50/70"><td className="px-4 py-3">{row.academic_year}</td><td className="px-4 py-3">{row.name}</td><td className="px-4 py-3">{formatDate(row.start_date)}</td><td className="px-4 py-3">{formatDate(row.end_date)}</td><td className="px-4 py-3"><ActionMenu label={`Actions for term ${row.name}`} items={[
        { label: 'View details', onClick: () => setSelectedTerm(row) },
        { label: 'Edit', onClick: () => openTermForm(row), visible: isAdministrator },
        { label: 'Delete', variant: 'danger', onClick: () => setPendingDelete({ type: 'term', row }), visible: isAdministrator }
      ]} /></td></tr>)}</tbody></table>{!visibleTerms.length && <Empty text={terms.data?.length ? 'No academic terms match these filters.' : 'No academic terms have been configured.'} />}<Pagination page={termPage} pageCount={termPageCount} total={visibleTerms.length} pageSize={settingsPageSize} onPageChange={setTermPage} /></div>}
    </div>
    <div className="no-print sims-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Grading scales</h2><p className="mt-1 text-sm text-slate-500">Configure non-overlapping percentage bands for each academic year.</p></div>
        <div className="flex flex-wrap gap-2"><PrintButton label="Print grading scales" disabled={loading || !visibleScales.length} onClick={() => printSettingsTable('settings-scales')} />{isAdministrator && <button type="button" onClick={() => openScaleForm()} className="primary-action flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"><Plus size={16} /> Add grading band</button>}</div>
      </div>
    <div className="sims-filter-grid mb-4">
      <SearchSuggestions id="settings-scale-search" label="Search grading scales" value={scaleSearch}
        onChange={setScaleSearch} suggestions={scaleSuggestions} pending={scaleSearch.trim() !== debouncedScaleSearch.trim()}
        placeholder="Search grade, range, or description..." inputClassName="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" />
      <SearchableSelect name="settings_scale_year_filter" label="Academic year" options={meta?.academicYears || []} value={scaleYearFilter} onChange={setScaleYearFilter}
        getOptionLabel={year => year.name} getOptionSearchText={year => year.name} placeholder="Search years..."
        emptyValueLabel="All years" noneLabel="All years" />
      <button type="button" disabled={!scaleSearch && !scaleYearFilter} onClick={() => { setScaleSearch(''); setScaleYearFilter(''); }} className="self-end rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear filters</button>
    </div>
    {error ? <ErrorPanel message={error} /> : loading ? <Loading /> : <div className="sims-table-panel overflow-x-auto"><table className="sims-table w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Academic year','Grade','Minimum','Maximum','Description','Actions'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{pageScales.map(row => <tr key={row.id} className="hover:bg-slate-50/70"><td className="px-4 py-3">{row.academic_year}</td><td className="px-4 py-3 font-semibold">{row.label}</td><td className="px-4 py-3">{row.minimum_percentage}%</td><td className="px-4 py-3">{row.maximum_percentage}%</td><td className="px-4 py-3">{row.description || '—'}</td><td className="px-4 py-3"><ActionMenu label={`Actions for grade ${row.label}`} items={[
        { label: 'View details', onClick: () => setSelectedScale(row) },
        { label: 'Edit', onClick: () => openScaleForm(row), visible: isAdministrator },
        { label: 'Delete', variant: 'danger', onClick: () => setPendingDelete({ type: 'grading scale', row }), visible: isAdministrator }
      ]} /></td></tr>)}</tbody></table>{!visibleScales.length && <Empty text={data?.length ? 'No grading scales match these filters.' : 'No grading scales have been configured.'} />}<Pagination page={scalePage} pageCount={scalePageCount} total={visibleScales.length} pageSize={settingsPageSize} onPageChange={setScalePage} /></div>}
    </div>
    <div className="no-print sims-panel sims-panel--metric"><h3 className="font-semibold text-blue-900">System information</h3><p className="mt-2 text-sm text-slate-700">Session and database credentials are configured in the server-only <code>server/.env</code> file. Never share or commit that file. The application session expires after eight hours.</p></div>
    </>}
    {!formPage && !selectedYear && !selectedTerm && !selectedScale && <>
      {isAdministrator && <section className="print-only settings-print-output settings-print-years">
        <h1 className="mb-1 text-xl font-bold">Academic years</h1><p className="mb-3 text-xs">Printed {formatDateTime(new Date())} · {visibleAcademicYears.length} matching records</p>
        <table className="print-table"><thead><tr>{['Academic year', 'Start date', 'End date', 'Status'].map(label => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
          <tbody>{visibleAcademicYears.map(row => <tr key={row.id}><td>{row.name}</td><td>{formatDate(row.start_date)}</td><td>{formatDate(row.end_date)}</td><td>{row.is_current ? 'Current' : 'Not current'}</td><td className="print-other-column"></td></tr>)}</tbody>
        </table>
      </section>}
      <section className="print-only settings-print-output settings-print-terms">
        <h1 className="mb-1 text-xl font-bold">Academic terms</h1><p className="mb-3 text-xs">Printed {formatDateTime(new Date())} · {visibleTerms.length} matching records</p>
        <table className="print-table"><thead><tr>{['Academic year', 'Term', 'Start date', 'End date'].map(label => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
          <tbody>{visibleTerms.map(row => <tr key={row.id}><td>{row.academic_year}</td><td>{row.name}</td><td>{formatDate(row.start_date)}</td><td>{formatDate(row.end_date)}</td><td className="print-other-column"></td></tr>)}</tbody>
        </table>
      </section>
      <section className="print-only settings-print-output settings-print-scales">
        <h1 className="mb-1 text-xl font-bold">Grading scales</h1><p className="mb-3 text-xs">Printed {formatDateTime(new Date())} · {visibleScales.length} matching records</p>
        <table className="print-table"><thead><tr>{['Academic year', 'Grade', 'Minimum', 'Maximum', 'Description'].map(label => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
          <tbody>{visibleScales.map(row => <tr key={row.id}><td>{row.academic_year}</td><td>{row.label}</td><td>{row.minimum_percentage}%</td><td>{row.maximum_percentage}%</td><td>{row.description || '—'}</td><td className="print-other-column"></td></tr>)}</tbody>
        </table>
      </section>
    </>}
    {selectedYear && <DetailsPage title="Academic year details" details={[
      ['Academic year', selectedYear.name], ['Start date', formatDate(selectedYear.start_date)],
      ['End date', formatDate(selectedYear.end_date)], ['Current', selectedYear.is_current ? 'Yes' : 'No'],
      ['Public ID', selectedYear.id]
    ]} onBack={() => setSelectedYear(null)} actions={<button type="button" onClick={() => openYearForm(selectedYear)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">Edit</button>} />}
    {selectedTerm && <DetailsPage title="Academic term details" details={[
      ['Term', selectedTerm.name], ['Academic year', selectedTerm.academic_year],
      ['Start date', formatDate(selectedTerm.start_date)], ['End date', formatDate(selectedTerm.end_date)], ['Public ID', selectedTerm.id]
    ]} onBack={() => setSelectedTerm(null)} />}
    {selectedScale && <DetailsPage title="Grading scale details" details={[
      ['Academic year', selectedScale.academic_year], ['Grade', selectedScale.label],
      ['Minimum percentage', selectedScale.minimum_percentage], ['Maximum percentage', selectedScale.maximum_percentage],
      ['Description', selectedScale.description], ['Public ID', selectedScale.id]
    ]} onBack={() => setSelectedScale(null)} />}
    {yearFormOpen && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => { setYearFormOpen(false); setYearFormItem(null); }} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to settings"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">{yearFormItem ? 'Edit academic year' : 'Add academic year'}</h2><p className="text-sm text-slate-500">Set the year name and calendar dates.</p></div>
      </div>
      <div className="sims-panel">
        <form onSubmit={submitYear} className="grid gap-3 sm:grid-cols-2">
          {settingsFormError && <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-2">{settingsFormError}</p>}
          <FieldInput name="name" label="Academic year name" maxLength={30} required defaultValue={yearFormItem?.name || ''} />
          <FieldInput name="start_date" label="Start date" type="date" required defaultValue={yearFormItem?.start_date || ''} />
          <FieldInput name="end_date" label="End date" type="date" required defaultValue={yearFormItem?.end_date || ''} />
          <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium text-slate-700"><input type="checkbox" checked={yearIsCurrent} onChange={event => setYearIsCurrent(event.target.checked)} className="h-4 w-4 accent-blue-600" /> Set as current academic year</label>
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 sm:col-span-2">
            <button type="button" onClick={() => { setYearFormOpen(false); setYearFormItem(null); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Cancel</button>
            <button type="submit" className="primary-action rounded-lg px-4 py-2.5 text-sm font-semibold">{yearFormItem ? 'Save changes' : 'Save academic year'}</button>
          </div>
        </form>
      </div>
    </section>}
    {termFormOpen && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => { setTermFormOpen(false); setTermFormItem(null); }} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to settings"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">{termFormItem ? 'Edit academic term' : 'Add academic term'}</h2><p className="text-sm text-slate-500">Manage a term for an academic year.</p></div>
      </div>
      <div className="sims-panel">
      <form onSubmit={submitTerm} className="grid gap-3 sm:grid-cols-2">
        {settingsFormError && <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-2">{settingsFormError}</p>}
        <SearchableSelect name="academic_year_id" label="Academic year" options={meta?.academicYears || []} value={termYearId} onChange={setTermYearId} getOptionLabel={year => year.name} getOptionSearchText={year => year.name} placeholder="Search academic year..." required />
        <FieldInput name="name" label="Term name" maxLength={80} required defaultValue={termFormItem?.name || ''} />
        <FieldInput name="start_date" label="Start date" type="date" required defaultValue={termFormItem?.start_date || ''} />
        <FieldInput name="end_date" label="End date" type="date" required defaultValue={termFormItem?.end_date || ''} />
        <div className="flex justify-end gap-2 sm:col-span-2"><button type="button" onClick={() => { setTermFormOpen(false); setTermFormItem(null); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Cancel</button><button className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">{termFormItem ? 'Save changes' : 'Add term'}</button></div>
      </form>
      </div>
    </section>}
    {scaleFormOpen && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => { setScaleFormOpen(false); setScaleFormItem(null); }} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to settings"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">{scaleFormItem ? 'Edit grading band' : 'Add grading band'}</h2><p className="text-sm text-slate-500">Configure a percentage band for an academic year.</p></div>
      </div>
      <div className="sims-panel">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {settingsFormError && <p role="alert" className="text-sm font-medium text-red-700 sm:col-span-2">{settingsFormError}</p>}
        <SearchableSelect name="academic_year_id" label="Academic year" options={meta?.academicYears || []} value={scaleYearId} onChange={setScaleYearId} getOptionLabel={year => year.name} getOptionSearchText={year => year.name} placeholder="Search academic year..." required />
        <FieldInput name="label" label="Grade label" required defaultValue={scaleFormItem?.label || ''} />
        <FieldInput name="minimum_percentage" label="Minimum %" type="number" min="0" max="100" step="0.01" required defaultValue={scaleFormItem?.minimum_percentage ?? ''} />
        <FieldInput name="maximum_percentage" label="Maximum %" type="number" min="0" max="100" step="0.01" required defaultValue={scaleFormItem?.maximum_percentage ?? ''} />
        <FieldInput name="description" label="Description" maxLength={100} defaultValue={scaleFormItem?.description || ''} />
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 sm:col-span-2"><button type="button" onClick={() => { setScaleFormOpen(false); setScaleFormItem(null); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Cancel</button><button type="submit" className="primary-action rounded-lg px-4 py-2.5 text-sm font-semibold">{scaleFormItem ? 'Save changes' : 'Save grading band'}</button></div>
      </form>
      </div>
    </section>}
    {pendingDelete && <Modal title={`Delete ${pendingDelete.type}?`} onClose={() => setPendingDelete(null)}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Delete {pendingDelete.type === 'term' ? `the term “${pendingDelete.row.name}”` : pendingDelete.type === 'academic year' ? `academic year “${pendingDelete.row.name}”` : `grading band “${pendingDelete.row.label}”`}? This cannot be undone.
          {pendingDelete.type === 'term' && ' Terms used by assessments cannot be deleted.'}
          {pendingDelete.type === 'academic year' && ' The current year cannot be deleted, and years referenced by school records cannot be deleted.'}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setPendingDelete(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
          <button type="button" onClick={deleteSetting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Delete</button>
        </div>
      </div>
    </Modal>}
  </div>;
}

function AssessmentInput({ name, label, type = 'text', required = false, defaultValue, min, max, step, maxLength, error = '' }) {
  const maximum = maxLength ?? inputMaxLengths[name];
  return <div>
    <label className="block text-sm font-medium text-slate-700">{label}
      <input name={name} type={type} required={required} defaultValue={defaultValue} min={min} max={max} step={step} maxLength={maximum} aria-invalid={Boolean(error)} aria-describedby={maximum ? `${name}-length-help` : undefined} className={`mt-1.5 block w-full rounded-lg border px-3 py-2.5 text-sm ${error ? 'border-red-400' : 'border-slate-300'}`} />
    </label>
    {maximum && <p id={`${name}-length-help`} className="mt-1 text-xs text-slate-500">Maximum {maximum} characters.</p>}
    {error && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{error}</p>}
  </div>;
}

function AssessmentSelect({ name, label, options, getLabel, error = '' }) {
  const [value, setValue] = useState('');
  return <SearchableSelect
    name={name}
    label={label}
    options={options}
    value={value}
    onChange={setValue}
    getOptionLabel={getLabel}
    getOptionSearchText={row => Object.values(row).filter(Boolean).join(' ')}
    placeholder={`Search ${label.toLowerCase()}...`}
    required
    error={error}
  />;
}
