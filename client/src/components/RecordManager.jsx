import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plus, Search } from 'lucide-react';
import { api, apiAssetUrl } from '../services/api.js';
import { apiRoute, apiRoutes } from '../services/apiRoutes.js';
import { loginQrPayload } from './loginQr.js';
import { ActionMenu, dateInputValue, DetailsPage, Empty, ErrorPanel, formatDate, formatDateTime, formatDisplayValue, fuzzySearchScore, inputMaxLengths, Loading, Modal, Pagination, PrintButton, SearchableSelect, SearchSuggestions, StatusBadge, StatusSelect, useDebouncedValue, useLoad } from './ui.jsx';

const config = {
  Students: {
    endpoint: apiRoutes.students.collection,
    itemEndpoint: apiRoutes.students.item,
    columns: [['student_code', 'Code'], ['english_name', 'Student name'], ['gender', 'Gender'], ['class_name', 'Class'], ['grade_level', 'Grade'], ['phone', 'Phone'], ['status', 'Status'], ['created_at', 'Created']],
    fields: [['student_code', 'Student code', 'auto-code'], ['english_name', 'English name', 'text', true], ['khmer_name', 'Khmer name', 'text', true], ['gender', 'Gender', 'select', true, ['Female', 'Male', 'Other']], ['date_of_birth', 'Date of birth', 'date', true], ['place_of_birth', 'Place of birth', 'text', true], ['address', 'Address', 'text'], ['phone', 'Phone', 'text', true], ['email', 'Email', 'email'], ['guardian_name', 'Guardian name', 'text', true], ['guardian_phone', 'Guardian phone', 'text', true], ['enrollment_date', 'Enrollment date', 'date', true], ['status', 'Enrollment status', 'select', true, ['Active', 'Archived', 'Graduated', 'Withdrawn']], ['class_id', 'Current class', 'class', true]]
  },
  Teachers: {
    endpoint: apiRoutes.teachers.collection,
    itemEndpoint: apiRoutes.teachers.item,
    columns: [['teacher_code', 'Code'], ['full_name', 'Teacher'], ['email', 'Email'], ['phone', 'Phone'], ['employment_status', 'Status'], ['assignments', 'Teaching assignments'], ['account_username', 'Login account'], ['created_at', 'Created']],
    fields: [['teacher_code', 'Teacher code', 'auto-code'], ['full_name', 'Full name', 'text', true], ['email', 'Email', 'email'], ['phone', 'Phone', 'text'], ['hire_date', 'Hire date', 'date'], ['employment_status', 'Employment status', 'select', true, ['Active', 'On Leave', 'Inactive']]]
  },
  Classes: {
    endpoint: apiRoutes.classes.collection,
    itemEndpoint: apiRoutes.classes.item,
    columns: [['name', 'Class'], ['grade_level', 'Grade'], ['academic_year', 'Academic year'], ['student_count', 'Students'], ['capacity', 'Capacity'], ['homeroom_teacher', 'Homeroom teacher'], ['active', 'Status'], ['created_at', 'Created']],
    fields: [['name', 'Class name', 'text', true], ['grade_level', 'Grade level', 'grade-level', true], ['academic_year_id', 'Academic year', 'academic-year', true], ['capacity', 'Capacity', 'number', true], ['homeroom_teacher_id', 'Homeroom teacher', 'teacher']]
  },
  Subjects: {
    endpoint: apiRoutes.subjects.collection,
    itemEndpoint: apiRoutes.subjects.item,
    columns: [['code', 'Code'], ['name', 'Subject'], ['description', 'Description'], ['active', 'Status'], ['created_at', 'Created']],
    fields: [['code', 'Subject code', 'auto-code'], ['name', 'Subject name', 'text', true], ['description', 'Description', 'text'], ['active', 'Active', 'boolean']]
  },
  Users: {
    endpoint: apiRoutes.users.collection,
    itemEndpoint: apiRoutes.users.item,
    columns: [['username', 'Username'], ['full_name', 'Name'], ['role', 'Role'], ['teacher_full_name', 'Linked teacher'], ['teacher_code', 'Staff code'], ['teacher_assignments', 'Teacher classes / subjects'], ['active', 'Status'], ['created_at', 'Created']],
    fields: [['username', 'Username', 'text', true], ['full_name', 'Full name', 'text', true], ['role', 'Role', 'select', true, ['SuperAdmin', 'Admin', 'Teacher', 'School Manager']], ['teacher_id', 'Teacher profile', 'teacher'], ['password', 'Initial password (leave blank to generate)', 'password']]
  },
  'Activity Logs': {
    endpoint: apiRoutes.activityLogs,
    columns: [['created_at', 'Time'], ['full_name', 'User'], ['action', 'Action'], ['entity', 'Record type'], ['entity_id', 'Record ID'], ['details', 'Details']]
  }
};
const recordTypeLabels = { Students: 'Student', Teachers: 'Teacher', Classes: 'Class', Subjects: 'Subject', Users: 'User' };
const statusFilterOptions = {
  Students: ['Active', 'Archived', 'Graduated', 'Withdrawn'],
  Teachers: ['Active', 'On Leave', 'Inactive'],
  Classes: ['Active', 'Inactive'],
  Subjects: ['Active', 'Inactive'],
  Users: ['Active', 'Inactive']
};

function drawWrappedText(context, value, x, y, maxWidth, lineHeight) {
  let line = '';
  for (const character of value) {
    const candidate = line + character;
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, y);
      y += lineHeight;
      line = character.trim() ? character : '';
    } else {
      line = candidate;
    }
  }
  if (line) context.fillText(line, x, y);
}

function CredentialDialog({ credentials, onClose }) {
  const [qrImage, setQrImage] = useState('');
  const [error, setError] = useState('');
  const websiteUrl = new URL(window.location.href);
  websiteUrl.search = '';
  websiteUrl.hash = '';
  const website = `${websiteUrl.origin}${websiteUrl.pathname}`;
  const qrValue = loginQrPayload(credentials, website);

  useEffect(() => {
    let active = true;
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(qrValue, { width: 256, margin: 1, errorCorrectionLevel: 'M' }))
      .then(value => { if (active) setQrImage(value); })
      .catch(generationError => { if (active) setError(`Could not create the credential QR code: ${generationError.message}`); });
    return () => { active = false; };
  }, [qrValue]);

  async function downloadCard() {
    setError('');
    try {
      const image = new Image();
      image.src = qrImage;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 560;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare the credential card.');

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#1d4ed8';
      context.fillRect(0, 0, canvas.width, 82);
      context.fillStyle = '#ffffff';
      context.font = 'bold 30px Arial, sans-serif';
      context.fillText(document.title || 'School MIS', 36, 54);
      context.drawImage(image, 48, 142, 300, 300);
      context.fillStyle = '#0f172a';
      context.font = 'bold 19px Arial, sans-serif';
      context.fillText('Website', 390, 148);
      context.font = '18px Arial, sans-serif';
      drawWrappedText(context, website, 390, 178, 450, 25);
      context.font = 'bold 19px Arial, sans-serif';
      context.fillText('Username', 390, 242);
      context.font = '20px Arial, sans-serif';
      drawWrappedText(context, credentials.username, 390, 272, 450, 28);
      context.font = 'bold 19px Arial, sans-serif';
      context.fillText('Temporary password', 390, 336);
      context.font = '20px Arial, sans-serif';
      drawWrappedText(context, credentials.temporary_password, 390, 366, 450, 28);
      context.fillStyle = '#92400e';
      context.font = '16px Arial, sans-serif';
      context.fillText('Scan to open the website and fill in these credentials.', 390, 438);
      context.fillText('Select Sign in, then change the temporary password.', 390, 466);
      context.fillText('Keep this card private and delete it when no longer needed.', 390, 494);

      const link = document.createElement('a');
      link.download = `${credentials.username.replace(/[^a-zA-Z0-9_-]/g, '_')}-login.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (downloadError) {
      setError(`Could not download the credential card: ${downloadError.message}`);
    }
  }

  return <Modal title={credentials.accountType === 'user' ? 'User account created' : credentials.created ? 'Teacher sign-in account created' : 'Sign-in credentials regenerated'} onClose={onClose}>
    <div className="space-y-4">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This card contains a temporary password. Scanning the QR opens the website and fills the login fields; the user must select Sign in and change the password afterward. Keep the card private.</p>
      <div className="grid items-center gap-4 sm:grid-cols-[auto_1fr]">
        {qrImage ? <img src={qrImage} alt="QR code for temporary sign-in credentials" className="mx-auto h-52 w-52" /> : <div className="grid h-52 w-52 place-items-center rounded-lg border border-slate-200 text-sm text-slate-500">Creating QR code…</div>}
        <dl className="divide-y divide-slate-100">
          <div className="py-3"><dt className="text-xs font-semibold uppercase text-slate-500">Username</dt><dd className="mt-1 break-all font-mono text-sm">{credentials.username}</dd></div>
          <div className="py-3"><dt className="text-xs font-semibold uppercase text-slate-500">Temporary password</dt><dd className="mt-1 break-all font-mono text-sm">{credentials.temporary_password}</dd></div>
        </dl>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={!qrImage} onClick={downloadCard} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Download credential card</button>
        <button type="button" onClick={onClose} className="primary-action rounded-lg px-4 py-2 text-sm font-semibold">Done</button>
      </div>
    </div>
  </Modal>;
}

function statusOptionsFor(page, key) {
  if (page === 'Students' && key === 'status') return ['Active', 'Archived', 'Graduated', 'Withdrawn'];
  if (page === 'Teachers' && key === 'employment_status') return ['Active', 'On Leave', 'Inactive'];
  if (['Classes', 'Subjects', 'Users'].includes(page) && key === 'active') return ['Active', 'Inactive'];
  return null;
}

function selectDetails(type, item) {
  if (type === 'teacher') return [
    { label: 'Public ID', value: item.id },
    { label: 'Staff code', value: item.teacher_code },
    { label: 'Status', value: item.employment_status },
    { label: 'Email', value: item.email },
    { label: 'Phone', value: item.phone },
    { label: 'Classes / subjects', value: item.assignments }
  ];
  if (type === 'class') return [
    { label: 'Public ID', value: item.id },
    { label: 'Grade', value: item.grade_level },
    { label: 'Academic year', value: item.academic_year },
    { label: 'Homeroom teacher', value: item.homeroom_teacher },
    { label: 'Students / capacity', value: `${item.student_count ?? 0} / ${item.capacity ?? '—'}` }
  ];
  if (type === 'subject') return [
    { label: 'Public ID', value: item.id },
    { label: 'Subject code', value: item.code },
    { label: 'Description', value: item.description }
  ];
  if (type === 'term') return [
    { label: 'Public ID', value: item.id },
    { label: 'Academic year', value: item.academic_year },
    { label: 'Dates', value: `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`.trim() }
  ];
  return [
    { label: 'Public ID', value: item.id },
    { label: 'Dates', value: `${formatDate(item.start_date)} – ${formatDate(item.end_date)}`.trim() },
    { label: 'Status', value: item.is_current ? 'Current academic year' : null }
  ];
}

function recordDetails(page, item) {
  const fields = {
    Students: [
      ['Photo', 'photo_url'],
      ['Photo public ID', 'photo_public_id'],
      ['Photo URL', 'photo_url_text'],
      ['Student code', 'student_code'], ['English name', 'english_name'], ['Khmer name', 'khmer_name'],
      ['Gender', 'gender'], ['Date of birth', 'date_of_birth'], ['Place of birth', 'place_of_birth'],
      ['Address', 'address'], ['Phone', 'phone'], ['Email', 'email'], ['Guardian', 'guardian_name'],
      ['Guardian phone', 'guardian_phone'], ['Enrollment date', 'enrollment_date'],
      ['Class', 'class_name'], ['Grade', 'grade_level'], ['Status', 'status']
    ],
    Teachers: [
      ['Teacher code', 'teacher_code'], ['Full name', 'full_name'], ['Email', 'email'], ['Phone', 'phone'],
      ['Hire date', 'hire_date'], ['Employment status', 'employment_status'],
      ['Teaching assignments', 'assignments'], ['Login account', 'account_username']
    ],
    Classes: [
      ['Class', 'name'], ['Grade', 'grade_level'], ['Academic year', 'academic_year'],
      ['Students', 'student_count'], ['Capacity', 'capacity'], ['Homeroom teacher', 'homeroom_teacher'], ['Status', 'active']
    ],
    Subjects: [
      ['Subject code', 'code'], ['Subject', 'name'], ['Description', 'description'], ['Active', 'active']
    ],
    Users: [
      ['Username', 'username'], ['Full name', 'full_name'], ['Role', 'role'],
      ['Linked teacher', 'teacher_full_name'], ['Staff code', 'teacher_code'],
      ['Teacher classes / subjects', 'teacher_assignments'], ['Active', 'active']
    ]
  };
  return [
    ['Public ID', item.id],
    ...(fields[page] || []).map(([label, key]) => [
      label,
      key === 'photo_url'
        ? item.photo_url ? <PhotoPreview photoUrl={item.photo_url} name={item.english_name} /> : 'No photo uploaded'
        : key === 'photo_url_text' ? item.photo_url : key === 'photo_public_id' ? item.photo_public_id || '—'
        : key === 'active' ? (item[key] ? 'Active' : 'Inactive')
        : ['date_of_birth', 'enrollment_date', 'hire_date'].includes(key) ? formatDate(item[key])
          : item[key]
    ]),
    ['Created At', formatDateTime(item.created_at)],
    ['Updated At', formatDateTime(item.updated_at)]
  ];
}

function recordSuggestionLabel(page, row) {
  if (page === 'Students') return row.english_name;
  if (page === 'Teachers') return row.full_name;
  if (page === 'Users') return row.full_name || row.username;
  return row.name;
}

function recordSuggestionSearchText(page, row) {
  if (page === 'Students') return `${row.english_name} ${row.khmer_name || ''} ${row.student_code}`;
  if (page === 'Teachers') return `${row.full_name} ${row.teacher_code} ${row.email || ''}`;
  if (page === 'Classes') return `${row.name} ${row.grade_level} ${row.academic_year || ''}`;
  if (page === 'Subjects') return `${row.name} ${row.code} ${row.description || ''}`;
  if (page === 'Users') return `${row.full_name} ${row.username} ${row.role}`;
  return `${recordSuggestionLabel(page, row) || ''} ${row.code || ''}`;
}

function RecordSearchField({ page, query, suggestionQuery, setQuery, rows, suggestionRows, loading, queryPending }) {
  const sourceRows = suggestionRows.length ? suggestionRows : rows;
  const matches = suggestionQuery.trim()
    ? sourceRows.map(row => ({ row, score: fuzzySearchScore(suggestionQuery, recordSuggestionSearchText(page, row)) }))
      .filter(match => match.score !== null)
      .sort((first, second) => first.score - second.score)
      .map(match => match.row)
    : sourceRows;
  const suggestions = matches.map(row => {
    const label = recordSuggestionLabel(page, row);
    const description = page === 'Students' ? row.student_code
      : page === 'Teachers' ? row.teacher_code
        : page === 'Classes' ? [row.grade_level, row.academic_year].filter(Boolean).join(' · ')
          : page === 'Subjects' ? row.code
            : page === 'Users' ? row.username
              : row.code || row.status;
    return {
      key: row.id,
      value: label || '',
      label: label || 'Unnamed record',
      description,
      searchText: recordSuggestionSearchText(page, row)
    };
  });
  return <SearchSuggestions
    id={`record-search-${page}`}
    label={`Search ${page.toLowerCase()}`}
    value={query}
    onChange={setQuery}
    suggestions={suggestions}
    pending={queryPending || loading}
    placeholder={`Search ${page.toLowerCase()}...`}
    inputClassName="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-3 pr-3 text-sm outline-none focus:border-blue-500"
  />;
}

export default function RecordManager({ page, user, onError, onSuccess }) {
  const cfg = config[page];
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query);
  const [status, setStatus] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [gender, setGender] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sortOrder, setSortOrder] = useState('latest');
  const [screen, setScreen] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [generatedCredentials, setGeneratedCredentials] = useState(null);
  const [generatingAccountId, setGeneratingAccountId] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [savingStatusId, setSavingStatusId] = useState('');
  const pageSize = 25;
  const { data: filterMeta } = useLoad(apiRoutes.meta);
  const params = new URLSearchParams();
  params.set('page', String(currentPage));
  params.set('page_size', String(pageSize));
  if (statusFilterOptions[page] && statusFilterOptions[page].includes(status)) params.set('status', status);
  if (page === 'Users' && roleFilter) params.set('role', roleFilter);
  if (page === 'Students' && gender) params.set('gender', gender);
  if (page === 'Students' && classFilter) params.set('class_id', classFilter);
  if (page === 'Teachers' && classFilter) params.set('class_id', classFilter);
  if (page === 'Teachers' && subjectFilter) params.set('subject_id', subjectFilter);
  if (page === 'Classes' && gradeFilter) params.set('grade', gradeFilter);
  if (page === 'Classes' && teacherFilter) params.set('teacher_id', teacherFilter);
  if (debouncedQuery) params.set('q', debouncedQuery);
  params.set('sort_order', sortOrder === 'oldest' ? 'oldest' : 'latest');
  if (sortOrder === 'custom' && createdFrom) params.set('created_from', createdFrom);
  if (sortOrder === 'custom' && createdTo) params.set('created_to', createdTo);
  const queryString = params.toString();
  const path = `${cfg.endpoint}${queryString ? `?${queryString}` : ''}`;
  const { data, error, loading, reload } = useLoad(path);
  const timetablePath = page === 'Students' && screen?.type === 'timetable'
    ? apiRoute(apiRoutes.students.timetable, { id: screen.row.id })
    : null;
  const studentTimetable = useLoad(timetablePath);
  const canEdit = (['Admin', 'SuperAdmin'].includes(user.role) ||
    user.role === 'School Manager' && ['Students', 'Teachers', 'Classes', 'Subjects', 'Users'].includes(page))
    && page !== 'Activity Logs';
  const canManageUsers = user.role === 'SuperAdmin';
  const rows = useMemo(() => Array.isArray(data) ? data : data?.rows || [], [data]);
  const total = Array.isArray(data) ? rows.length : Number(data?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = rows;
  const studentGenderTotals = page === 'Students' ? pageRows.reduce((counts, row) => {
    const genderValue = String(row.gender || '').trim().toLowerCase();
    if (genderValue === 'female') counts.female += 1;
    else if (genderValue === 'male') counts.male += 1;
    else counts.other += 1;
    return counts;
  }, { female: 0, male: 0, other: 0 }) : null;
  const isFullPageScreen = ['form', 'assignment', 'detail', 'timetable'].includes(screen?.type);
  useEffect(() => { setCurrentPage(1); }, [debouncedQuery, status, roleFilter, gender, classFilter, subjectFilter, gradeFilter, teacherFilter, createdFrom, createdTo, sortOrder, page]);
  useEffect(() => {
    setStatus('');
    setRoleFilter('');
    setGender('');
    setClassFilter('');
    setSubjectFilter('');
    setGradeFilter('');
    setTeacherFilter('');
  }, [page]);
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  async function generateTeacherAccount(row) {
    setGeneratingAccountId(row.id);
    try {
      const account = await api(apiRoute(apiRoutes.teachers.generateAccount, { id: row.id }), { method: 'POST' });
      setGeneratedCredentials(account);
      onSuccess(account.created ? `Login account created for ${row.full_name}.` : `Login credentials regenerated for ${row.full_name}.`);
      reload();
    } catch (err) {
      onError(err.message);
    } finally {
      setGeneratingAccountId('');
    }
  }

  async function regenerateUserPassword(row) {
    setGeneratingAccountId(row.id);
    try {
      const credentials = await api(apiRoute(apiRoutes.users.resetPassword, { id: row.id }), { method: 'POST' });
      setGeneratedCredentials({ ...credentials, full_name: row.full_name });
      onSuccess(`Temporary credentials regenerated for ${row.full_name}.`);
    } catch (err) {
      onError(err.message);
    } finally {
      setGeneratingAccountId('');
    }
  }

  async function setHidden(row, hidden) {
    const action = hidden ? 'delete' : 'restore';
    try {
      await api(apiRoute(action === 'delete' ? apiRoutes.visibility.delete : apiRoutes.visibility.restore, {
        entity: cfg.endpoint.slice(1),
        id: row.id
      }), { method: 'POST' });
      onSuccess(hidden ? 'Record moved to Trash.' : 'Record restored.');
      reload();
    } catch (err) {
      onError(err.message);
    }
  }

  async function updateRecordStatus(row, field, nextValue) {
    if (!nextValue) return;
    const currentValue = field === 'active' ? (row.active ? 'Active' : 'Inactive') : row[field];
    if (nextValue === currentValue) return;
    if (page === 'Users' && field === 'active') {
      setConfirmAction({ type: 'user-status', row, active: nextValue === 'Active' });
      return;
    }
    setSavingStatusId(row.id);
    try {
      await api(apiRoute(cfg.itemEndpoint, { id: row.id }), {
        method: 'PATCH',
        body: JSON.stringify({ [field]: field === 'active' ? nextValue === 'Active' : nextValue })
      });
      const displayName = row.english_name || row.full_name || row.name || row.username || 'Record';
      onSuccess(`${displayName} status changed to ${nextValue}.`);
      reload();
    } catch (requestError) {
      onError(requestError.message);
      reload();
    } finally {
      setSavingStatusId('');
    }
  }

  async function saveRecord(values, row) {
    const saved = row
      ? await api(apiRoute(cfg.itemEndpoint, { id: row.id }), { method: 'PATCH', body: JSON.stringify(values) })
      : await api(cfg.endpoint, { method: 'POST', body: JSON.stringify(values) });
    const generatedCode = saved.student_code || saved.teacher_code || saved.code;
    if (page === 'Users' && !row && saved.temporary_password) {
      setGeneratedCredentials({ ...saved, created: true, accountType: 'user' });
      onSuccess(`User account created for ${values.full_name}.`);
    } else {
      const cleanupWarning = saved.photo_cleanup_pending ? ' Photo cleanup could not be completed; the old file was retained safely.' : '';
      onSuccess(`${recordTypeLabels[page]} ${row ? 'updated' : 'created'} successfully.${generatedCode ? ` Code: ${generatedCode}` : ''}${cleanupWarning}`);
    }
    setScreen(null);
    reload();
  }

  async function confirmCurrentAction() {
    const { type, row } = confirmAction;
    setConfirmAction(null);
    if (type === 'hide') return setHidden(row, true);
    if (type === 'user-status') {
      try {
        await api(apiRoute(apiRoutes.users.item, { id: row.id }), { method: 'PATCH', body: JSON.stringify({ active: confirmAction.active }) });
        onSuccess(`User account ${confirmAction.active ? 'enabled' : 'disabled'}.`);
        reload();
      } catch (error) {
        onError(error.message);
      }
      return;
    }
    if (type === 'regenerate-user-password') return regenerateUserPassword(row);
    return generateTeacherAccount(row);
  }

  const actionDialogs = <>
    {generatedCredentials && <CredentialDialog credentials={generatedCredentials} onClose={() => setGeneratedCredentials(null)} />}
    {confirmAction && <Modal
      title={confirmAction.type === 'hide' ? 'Move record to Trash?' : confirmAction.type === 'user-status' ? `${confirmAction.active ? 'Enable' : 'Disable'} user account?` : confirmAction.type === 'regenerate-user-password' ? 'Regenerate user credentials?' : confirmAction.row.account_username ? 'Regenerate teacher login?' : 'Generate teacher login?'}
      onClose={() => setConfirmAction(null)}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {confirmAction.type === 'hide'
            ? 'This record will be removed from its normal list and moved to Trash. You can restore it later or permanently delete it from Trash.'
              : confirmAction.type === 'user-status'
                ? confirmAction.active
                  ? `${confirmAction.row.full_name} will be able to sign in again.`
                  : `${confirmAction.row.full_name} will be signed out on every device the next time it makes a request. The user will see that access was disabled and be told to contact the administrator.`
                : confirmAction.type === 'regenerate-user-password'
                  ? `A new temporary password will replace the current password for ${confirmAction.row.full_name}. The user must change it at next sign-in.`
              : confirmAction.row.account_username
                ? `A new temporary password will replace the current password for ${confirmAction.row.full_name}. The teacher must change it at next sign-in.`
                : `A login account and one-time temporary password will be created for ${confirmAction.row.full_name}.`}
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmAction(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
          <button type="button" disabled={Boolean(generatingAccountId)} onClick={confirmCurrentAction} className="primary-action rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60">{generatingAccountId ? 'Processing...' : confirmAction.type === 'hide' ? 'Move to Trash' : confirmAction.type === 'user-status' ? confirmAction.active ? 'Enable account' : 'Disable account' : confirmAction.type === 'regenerate-user-password' || confirmAction.row.account_username ? 'Regenerate credentials' : 'Confirm'}</button>
        </div>
      </div>
    </Modal>}
  </>;

  const manageableRoles = user.role === 'SuperAdmin'
    ? ['Admin', 'Teacher', 'School Manager']
    : user.role === 'Admin' ? ['School Manager', 'Teacher'] : ['Teacher'];
  const userRoleOptions = [...new Set([
    ...(screen?.row?.role && !manageableRoles.includes(screen.row.role) ? [screen.row.role] : []),
    ...manageableRoles
  ])];
  const formFields = page !== 'Users' ? cfg.fields : screen?.row
    ? [['username', 'Username', 'text', true], ['full_name', 'Full name', 'text', true], ['role', 'Role', 'select', true, userRoleOptions], ['teacher_id', 'Teacher profile', 'teacher'], ['active', 'Active', 'boolean']]
    : [['username', 'Username', 'text', true], ['full_name', 'Full name', 'text', true], ['role', 'Role', 'select', true, userRoleOptions], ['teacher_id', 'Teacher profile', 'teacher'], ['password', 'Initial password (leave blank to generate)', 'password']];

  return <div className="space-y-4">
    {!isFullPageScreen && <>
    <div className="no-print sims-toolbar space-y-3">
    {page === 'Students' ? <>
      <div aria-busy={loading} className="sims-filter-grid sims-student-filter-grid">
        <RecordSearchField page={page} query={query} suggestionQuery={debouncedQuery} setQuery={setQuery} rows={rows}
          suggestionRows={filterMeta?.[({ Students: 'students', Teachers: 'teachers', Classes: 'classes', Subjects: 'subjects' })[page]] || []}
          loading={loading} queryPending={query.trim() !== debouncedQuery.trim()} />
        <label className="block min-w-0 text-sm font-medium text-slate-700">Enrollment status
          <select aria-label="Filter students by enrollment status" value={status} onChange={event => setStatus(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500">
            <option value="">All statuses</option>
            {['Active', 'Archived', 'Graduated', 'Withdrawn'].map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="block min-w-0 text-sm font-medium text-slate-700">Gender
          <select aria-label="Filter students by gender" value={gender} onChange={event => setGender(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500">
            <option value="">All genders</option>
            {['Female', 'Male', 'Other'].map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <SearchableSelect name="student_class_filter" label="Class" options={filterMeta?.classes || []} value={classFilter} onChange={setClassFilter}
          getOptionLabel={row => `${row.grade_level} · ${row.name}`} getOptionSearchText={row => `${row.grade_level} ${row.name}`}
          placeholder="Search classes..." emptyValueLabel="All classes" noneLabel="All classes" />
        <label className="block min-w-0 text-sm font-medium text-slate-700">Date order
          <select value={sortOrder} onChange={event => {
            setSortOrder(event.target.value);
            if (event.target.value !== 'custom') { setCreatedFrom(''); setCreatedTo(''); }
          }} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="latest">Latest</option>
            <option value="oldest">Oldest</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {sortOrder === 'custom' && <>
          <label className="block min-w-0 text-sm font-medium text-slate-700">Created from
            <input type="date" value={createdFrom} max={createdTo || undefined} onChange={event => setCreatedFrom(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="block min-w-0 text-sm font-medium text-slate-700">Created to
            <input type="date" value={createdTo} min={createdFrom || undefined} onChange={event => setCreatedTo(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
          </label>
        </>}
      </div>
      <div className="sims-filter-actions">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setQuery(''); setStatus(''); setGender(''); setClassFilter(''); setCreatedFrom(''); setCreatedTo(''); setSortOrder('latest'); }} disabled={!query && !status && !gender && !classFilter && !createdFrom && !createdTo && sortOrder === 'latest'} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Clear filters</button>
          <PrintButton label="Print students" disabled={loading || Boolean(error) || !pageRows.length} />
          {canEdit && <button type="button" onClick={() => setScreen({ type: 'form', row: null })} className="primary-action flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"><Plus size={16} /> Add student</button>}
        </div>
      </div>
    </> : <>
      <div className="sims-filter-grid sims-record-filter-grid">
        <RecordSearchField page={page} query={query} suggestionQuery={debouncedQuery} setQuery={setQuery} rows={rows}
          suggestionRows={filterMeta?.[({ Students: 'students', Teachers: 'teachers', Classes: 'classes', Subjects: 'subjects' })[page]] || []}
          loading={loading} queryPending={query.trim() !== debouncedQuery.trim()} />
        {statusFilterOptions[page] && <label className="block min-w-0 text-sm font-medium text-slate-700">Status
          <select aria-label={`Filter ${page.toLowerCase()} by status`} value={status} onChange={event => setStatus(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="">All statuses</option>
            {statusFilterOptions[page].map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>}
        {page === 'Users' && <label className="block min-w-0 text-sm font-medium text-slate-700">Role
          <select aria-label="Filter users by role" value={roleFilter} onChange={event => setRoleFilter(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="">All roles</option>
            {(user.role === 'SuperAdmin' ? ['Admin', 'School Manager', 'Teacher'] : user.role === 'Admin' ? ['School Manager', 'Teacher'] : ['Teacher'])
              .map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>}
        {page === 'Teachers' && <>
          <SearchableSelect name="teacher_class_filter" label="Class" options={filterMeta?.classes || []} value={classFilter} onChange={setClassFilter}
            getOptionLabel={row => `${row.grade_level} · ${row.name}`} getOptionSearchText={row => `${row.grade_level} ${row.name}`}
            placeholder="Search classes..." emptyValueLabel="All classes" noneLabel="All classes" />
          <SearchableSelect name="teacher_subject_filter" label="Subject" options={filterMeta?.subjects || []} value={subjectFilter} onChange={setSubjectFilter}
            getOptionLabel={row => row.name} getOptionSearchText={row => `${row.code} ${row.name}`}
            placeholder="Search subjects..." emptyValueLabel="All subjects" noneLabel="All subjects" />
        </>}
        {page === 'Classes' && <>
          <label className="block min-w-0 text-sm font-medium text-slate-700">Grade
            <select value={gradeFilter} onChange={event => setGradeFilter(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
              <option value="">All grades</option>
              {(filterMeta?.gradeLevels || []).map(grade => <option key={grade.id} value={grade.name}>{grade.name}</option>)}
            </select>
          </label>
          <SearchableSelect name="class_teacher_filter" label="Homeroom teacher" options={filterMeta?.teachers || []} value={teacherFilter} onChange={setTeacherFilter}
            getOptionLabel={row => `${row.full_name} · ${row.teacher_code}`} getOptionSearchText={row => `${row.full_name} ${row.teacher_code}`}
            placeholder="Search teachers..." emptyValueLabel="All teachers" noneLabel="All teachers" />
        </>}
        <label className="block min-w-0 text-sm font-medium text-slate-700">Date order
          <select value={sortOrder} onChange={event => {
            setSortOrder(event.target.value);
            if (event.target.value !== 'custom') { setCreatedFrom(''); setCreatedTo(''); }
          }} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
            <option value="latest">Latest</option>
            <option value="oldest">Oldest</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {sortOrder === 'custom' && <>
          <label className="block min-w-0 text-sm font-medium text-slate-700">Created from
            <input type="date" value={createdFrom} max={createdTo || undefined} onChange={event => setCreatedFrom(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="block min-w-0 text-sm font-medium text-slate-700">Created to
            <input type="date" value={createdTo} min={createdFrom || undefined} onChange={event => setCreatedTo(event.target.value)} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />
          </label>
        </>}
      </div>
      <div className="sims-filter-actions">
        <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setQuery(''); setStatus(''); setRoleFilter(''); setClassFilter(''); setSubjectFilter(''); setGradeFilter(''); setTeacherFilter(''); setCreatedFrom(''); setCreatedTo(''); setSortOrder('latest'); }} disabled={!query && !status && !roleFilter && !classFilter && !subjectFilter && !gradeFilter && !teacherFilter && !createdFrom && !createdTo && sortOrder === 'latest'} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Clear filters</button>
        {page !== 'Users' && <PrintButton label={`Print ${page.toLowerCase()}`} disabled={loading || Boolean(error) || !pageRows.length} />}
        {page === 'Teachers' && canEdit && <button type="button" onClick={() => setScreen({ type: 'assignment' })} className="rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-sm font-semibold text-blue-700">Assign subject &amp; class</button>}
        {canEdit && <button type="button" onClick={() => setScreen({ type: 'form', row: null })} className="primary-action flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"><Plus size={16} /> Add {recordTypeLabels[page].toLowerCase()}</button>}
        </div>
      </div>
    </>}
    {error ? <div className="no-print"><ErrorPanel message={error} /></div> : loading ? <div className="no-print"><Loading /></div> : <div className="no-print sims-table-panel overflow-x-auto">
      <table className="sims-table w-full min-w-[850px] text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-wide"><tr>{cfg.columns.map(([, title]) => <th key={title} className="px-4 py-3 font-semibold">{title}</th>)}<th className="px-4 py-3">Actions</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {pageRows.map(row => <tr key={row.id} className="hover:bg-slate-50/70">
            {cfg.columns.map(([key]) => <td key={key} className="max-w-[240px] truncate px-4 py-3.5 text-slate-600">
              {page === 'Students' && key === 'english_name' ? <span className="flex items-center gap-2.5"><StudentAvatar photoUrl={row.photo_url} name={row.english_name} />{row.english_name}</span>
                : page === 'Teachers' && key === 'account_username' ? row[key] ? <span className="text-green-700">{row[key]}</span> : <span className="text-slate-400">Not generated</span>
                  : key === 'created_at' ? formatDateTime(row[key])
                  : statusOptionsFor(page, key) && canEdit ? <StatusSelect
                    label={`Change ${key === 'employment_status' ? 'employment' : 'record'} status for ${row.english_name || row.full_name || row.name || row.username || 'record'}`}
                    value={key === 'active' ? (row.active ? 'Active' : 'Inactive') : row[key]}
                    options={statusOptionsFor(page, key)}
                    disabled={savingStatusId === row.id || (page === 'Users' && row.id === user.id)}
                    onChange={value => updateRecordStatus(row, key, value)}
                  />
                  : key === 'active' ? <StatusBadge>{row[key] ? 'Active' : 'Inactive'}</StatusBadge>
                    : ['status', 'employment_status'].includes(key) ? <StatusBadge>{row[key] || 'Unknown'}</StatusBadge>
                    : key === 'entity_id' && row.entity_id_unavailable ? 'Record no longer exists'
                      : key === 'details' ? (typeof row[key] === 'string' ? row[key] : JSON.stringify(row[key]))
                        : formatDisplayValue(key, row[key])}
            </td>)}
            <td className="px-4 py-3"><div className="flex items-center gap-2 whitespace-nowrap"><ActionMenu label={`Actions for ${row.english_name || row.full_name || row.name || row.username || 'record'}`} items={[
              { label: 'View details', onClick: () => setScreen({ type: 'detail', row }) },
              { label: 'View complete timetable', onClick: () => setScreen({ type: 'timetable', row }), visible: page === 'Students' && !row.is_deleted },
              { label: 'Edit', onClick: () => setScreen({ type: 'form', row }), visible: canEdit && !row.is_deleted },
              { label: row.account_username ? 'Regenerate account' : 'Generate account', onClick: () => setConfirmAction({ type: 'regenerate-account', row }), visible: canManageUsers && page === 'Teachers' && !row.is_deleted, variant: 'accent' },
              { label: 'Regenerate account', onClick: () => setConfirmAction({ type: 'regenerate-user-password', row }), visible: canManageUsers && page === 'Users' && !row.is_deleted && row.id !== user.id, variant: 'accent' },
              { label: 'Delete', onClick: () => setConfirmAction({ type: 'hide', row }), visible: canEdit && (page !== 'Users' || canManageUsers) && !row.is_deleted && !(page === 'Users' && row.id === user.id), variant: 'danger' }
            ]} /></div></td>
          </tr>)}
        </tbody>
      </table>
      {!total && <Empty text="No matching records found." />}
      <Pagination page={currentPage} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={setCurrentPage} />
    </div>}
    </div>
    {['Students', 'Teachers', 'Classes', 'Subjects'].includes(page) && <div className={`print-only record-list-print ${page === 'Teachers' ? 'teacher-list-print' : ''}`}>
      <h1 className="mb-4 text-xl font-bold">{page}</h1>
      <p className="mb-3 text-sm text-slate-600">Showing {rows.length} records on page {currentPage} of {pageCount} · {total} matching records</p>
      {studentGenderTotals && <p className="mb-3 text-sm font-semibold text-slate-700">
        Female: {studentGenderTotals.female} · Male: {studentGenderTotals.male} · Other / unspecified: {studentGenderTotals.other} · Total: {rows.length}
      </p>}
      <table className="print-table">
        <thead><tr>{cfg.columns.map(([, title]) => <th key={title}>{title}</th>)}<th className="print-other-column">Other</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}>{cfg.columns.map(([key]) => <td key={key}>{key === 'active' ? row[key] ? 'Active' : 'Inactive' : formatDisplayValue(key, row[key])}</td>)}<td className="print-other-column"></td></tr>)}</tbody>
      </table>
    </div>}
    </>}
    {isFullPageScreen && screen?.type === 'form' && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setScreen(null)} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label={`Back to ${page.toLowerCase()}`}><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">{screen.row ? 'Edit' : 'Add'} {recordTypeLabels[page].toLowerCase()}</h2><p className="text-sm text-slate-500">Enter the {recordTypeLabels[page].toLowerCase()} details below.</p></div>
      </div>
      <div className="sims-panel">
        <RecordForm page={page} fields={formFields} initial={screen.row} onCancel={() => setScreen(null)} onError={onError} onSave={values => saveRecord(values, screen.row)} />
      </div>
    </section>}
    {screen?.type === 'timetable' && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setScreen(null)} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to students"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">Complete student timetable</h2><p className="text-sm text-slate-500">{screen.row.english_name} · {screen.row.student_code}</p></div>
      </div>
      {studentTimetable.error ? <ErrorPanel message={studentTimetable.error} /> : studentTimetable.loading ? <Loading /> : <div className="space-y-4">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Main homeroom grade</p>
          <p className="mt-1 text-lg font-bold text-blue-950">{studentTimetable.data?.main_grade || 'Not enrolled'}{studentTimetable.data?.homeroom_class ? ` · ${studentTimetable.data.homeroom_class}` : ''}</p>
        </div>
        <div className="sims-table-panel overflow-x-auto">
          <table className="sims-table w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Enrollment', 'Grade', 'Subject', 'Class', 'Teacher', 'Day', 'Time', 'Classroom'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{(studentTimetable.data?.enrollments || []).map((item, index) => <tr key={`${item.id}-${item.schedule_id || index}`}>
              <td className="px-4 py-3 font-semibold">{item.enrollment_type === 'Homeroom' ? 'Homeroom' : 'Subject class'}</td>
              <td className="px-4 py-3">{item.grade_level || '—'}</td>
              <td className="px-4 py-3">{item.subject_name || 'General class'}</td>
              <td className="px-4 py-3">{item.class_name}</td>
              <td className="px-4 py-3">{item.teacher_name || 'Unassigned'}</td>
              <td className="px-4 py-3">{item.day_of_week ? ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][item.day_of_week - 1] : '—'}</td>
              <td className="px-4 py-3">{item.start_time ? `${String(item.start_time).slice(0, 5)}–${String(item.end_time).slice(0, 5)}` : '—'}</td>
              <td className="px-4 py-3">{item.room || '—'}</td>
            </tr>)}</tbody>
          </table>
          {!studentTimetable.data?.enrollments?.length && <Empty text="No enrollments are configured for the current academic year." />}
        </div>
      </div>}
    </section>}
    {screen?.type === 'assignment' && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setScreen(null)} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to teachers"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">Assign teacher to subjects and class</h2><p className="text-sm text-slate-500">Choose one or more subjects for this teacher and class.</p></div>
      </div>
      <div className="sims-panel">
        <TeacherAssignmentForm onCancel={() => setScreen(null)} onSave={async values => {
          await api(apiRoutes.teachers.assignments, { method: 'POST', body: JSON.stringify(values) });
          setScreen(null);
          onSuccess(`Teacher assigned to ${values.subject_ids.length} subject${values.subject_ids.length === 1 ? '' : 's'} and class.`);
          reload();
        }} />
      </div>
    </section>}
    {screen?.type === 'detail' && <DetailsPage title={`${recordTypeLabels[page]} details`} details={recordDetails(page, screen.row)} onBack={() => setScreen(null)} actions={<>
      {canEdit && !screen.row.is_deleted && <button type="button" onClick={() => setScreen({ type: 'form', row: screen.row })} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">Edit</button>}
      {page === 'Teachers' && canManageUsers && !screen.row.is_deleted && <button type="button" onClick={() => setConfirmAction({ type: 'regenerate-account', row: screen.row })} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800">{screen.row.account_username ? 'Regenerate account' : 'Generate account'}</button>}
      {page === 'Users' && canManageUsers && !screen.row.is_deleted && screen.row.id !== user.id && <button type="button" onClick={() => setConfirmAction({ type: 'regenerate-user-password', row: screen.row })} className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-semibold text-violet-800">Regenerate account</button>}
      {canEdit && (page !== 'Users' || canManageUsers) && !screen.row.is_deleted && !(page === 'Users' && screen.row.id === user.id) && <button type="button" onClick={() => setConfirmAction({ type: 'hide', row: screen.row })} className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">Delete</button>}
    </>} />}
    {actionDialogs}
  </div>;
}

function RecordForm({ page, fields, initial, onCancel, onError, onSave }) {
  const { data: meta, error: metaError } = useLoad(apiRoutes.meta);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [roleValue, setRoleValue] = useState(initial?.role || '');
  const [enumValues, setEnumValues] = useState(() => ({
    active: initial?.active === false || initial?.active === 0 ? 'false' : 'true',
    gender: initial?.gender || '',
    status: initial?.status || 'Active'
  }));
  const [selectionValues, setSelectionValues] = useState(() => ({
    teacher: initial?.teacher_id || initial?.homeroom_teacher_id || '',
    class: initial?.class_id || '',
    subject: initial?.subject_id || '',
    term: initial?.term_id || '',
    'academic-year': initial?.academic_year_id || '',
    'grade-level': initial?.grade_level || ''
  }));
  const [photoData, setPhotoData] = useState('');
  const [photoSource, setPhotoSource] = useState('');
  const [photoDimensions, setPhotoDimensions] = useState(null);
  const [photoOffset, setPhotoOffset] = useState({ x: 0, y: 0 });
  const [photoZoom, setPhotoZoom] = useState(1);
  const [photoError, setPhotoError] = useState('');
  const [photoTitle, setPhotoTitle] = useState(initial?.photo_title || 'Student profile photo');
  const [removePhoto, setRemovePhoto] = useState(false);
  const fileInput = useRef(null);
  const dragStart = useRef(null);

  useEffect(() => {
    setRoleValue(initial?.role || '');
    setPhotoTitle(initial?.photo_title || 'Student profile photo');
    setEnumValues({
      active: initial?.active === false || initial?.active === 0 ? 'false' : 'true',
      gender: initial?.gender || '',
      status: initial?.status || 'Active'
    });
    setSelectionValues({
      teacher: initial?.teacher_id || initial?.homeroom_teacher_id || '',
      class: initial?.class_id || '',
      subject: initial?.subject_id || '',
      term: initial?.term_id || '',
      'academic-year': initial?.academic_year_id || '',
      'grade-level': initial?.grade_level || ''
    });
    setFieldErrors({});
    setFormError('');
  }, [initial]);

  useEffect(() => {
    if (!photoSource) return undefined;
    return () => URL.revokeObjectURL(photoSource);
  }, [photoSource]);

  async function submit(event) {
    event.preventDefault();
    if (page === 'Students' && photoSource) {
      setPhotoError('Click “Use this crop” before saving the student photo.');
      return;
    }
    if (page === 'Students' && (photoData || initial?.photo_url && !removePhoto) && !photoTitle.trim()) {
      setPhotoError('Enter a title for the student photo.');
      return;
    }
    const form = event.currentTarget;
    const errors = {};
    for (const [key, label, type, required] of fields) {
      if (type === 'auto-code') continue;
      if (['teacher', 'class', 'subject', 'term', 'academic-year', 'grade-level'].includes(type)) {
        const selected = selectionValues[type] || (type === 'academic-year' ? meta?.academicYear?.id : '');
        const existingStudentWithoutClass = page === 'Students' && key === 'class_id' && initial && !initial.class_id;
        if (required && !selected && !existingStudentWithoutClass) errors[key] = `Select ${label.toLowerCase()}.`;
        continue;
      }
      if (type === 'select' || type === 'boolean') {
        const selected = key === 'role' ? roleValue : enumValues[key] || '';
        if (required && !selected) errors[key] = `Select ${label.toLowerCase()}.`;
        continue;
      }
      const input = form.elements.namedItem(key);
      if (input && !input.validity.valid) errors[key] = input.validationMessage || `${label} is invalid.`;
    }
    if (page === 'Users' && roleValue === 'Teacher' && !selectionValues.teacher) errors.teacher_id = 'Select the teacher profile linked to this account.';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setFormError('');
      return;
    }
    setFieldErrors({});
    setFormError('');
    setBusy(true);
    const formData = new FormData(form);
    const values = {};
    for (const [key, , type] of fields) {
      if (type === 'auto-code') continue;
      const value = formData.get(key);
      if (page === 'Students' && key === 'class_id' && initial && !initial.class_id && !value) continue;
      if (type === 'number') values[key] = value ? Number(value) : null;
      else if (type === 'boolean') values[key] = value === 'true';
      else values[key] = value || null;
    }
    if (photoData) values.photo_data = photoData.slice(photoData.indexOf(',') + 1);
    if (page === 'Students' && (photoData || initial?.photo_url && !removePhoto)) {
      values.photo_title = photoTitle.trim();
    }
    if (removePhoto) values.remove_photo = true;
    try {
      await onSave(values);
    } catch (error) {
      const message = error.message || 'The server could not save this record. Please try again.';
      const match = error.message.match(/^([a-z_]+):\s*(.+)$/i);
      if (match && fields.some(([key]) => key === match[1])) setFieldErrors({ [match[1]]: match[2] });
      setFormError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  function selectPhoto(file) {
    setPhotoError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setPhotoError('Choose an image smaller than 10 MB.');
      return;
    }
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 6000 || image.naturalHeight > 6000 || image.naturalWidth * image.naturalHeight > 30_000_000) {
        URL.revokeObjectURL(source);
        setPhotoError('Image dimensions must be no larger than 6000 pixels per side or 30 megapixels.');
        return;
      }
      setPhotoSource(source);
      setPhotoDimensions({ width: image.naturalWidth, height: image.naturalHeight });
      setPhotoOffset({ x: 0, y: 0 });
      setPhotoZoom(1);
      setPhotoData('');
      setRemovePhoto(false);
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      setPhotoError('The selected image could not be opened.');
    };
    image.src = source;
  }

  async function applyPhotoCrop() {
    if (!photoSource || !photoDimensions) return;
    try {
      const image = new Image();
      image.src = photoSource;
      await image.decode();
      const frameSize = 280;
      const scale = frameSize / Math.min(photoDimensions.width, photoDimensions.height) * photoZoom;
      const cropSize = frameSize / scale;
      const cropX = (photoDimensions.width - cropSize) / 2 - photoOffset.x / scale;
      const cropY = (photoDimensions.height - cropSize) / 2 - photoOffset.y / scale;
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 1200;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare the photo.');
      context.drawImage(image, cropX, cropY, cropSize, cropSize, 0, 0, 1200, 1200);
      let compressedPhoto = null;
      let bestTargetPhoto = null;
      let fallbackPhoto = null;
      for (const size of [1200, 1024, 900, 768, 640, 512]) {
        const output = document.createElement('canvas');
        output.width = size;
        output.height = size;
        const outputContext = output.getContext('2d');
        if (!outputContext) throw new Error('Your browser could not prepare the photo.');
        outputContext.drawImage(canvas, 0, 0, 1200, 1200, 0, 0, size, size);
        let bestUnder100Kb = null;
        for (const quality of [0.78, 0.75, 0.72, 0.68, 0.65]) {
          const webp = output.toDataURL('image/webp', quality);
          const candidates = webp.startsWith('data:image/webp,')
            ? [webp, output.toDataURL('image/jpeg', quality)]
            : [output.toDataURL('image/jpeg', quality)];
          const withinUploadLimit = candidates.find(dataUrl => {
            const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
            return Math.ceil(base64.length * 3 / 4) - padding <= 1024 * 1024;
          });
          if (!withinUploadLimit) continue;
          if (!fallbackPhoto) fallbackPhoto = withinUploadLimit;
          const base64 = withinUploadLimit.slice(withinUploadLimit.indexOf(',') + 1);
          const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
          const byteSize = Math.ceil(base64.length * 3 / 4) - padding;
          if (byteSize <= 100 * 1024 && !bestUnder100Kb) bestUnder100Kb = withinUploadLimit;
          if (byteSize <= 50 * 1024) {
            compressedPhoto = withinUploadLimit;
            break;
          }
        }
        if (compressedPhoto) break;
        if (bestUnder100Kb && !bestTargetPhoto) bestTargetPhoto = bestUnder100Kb;
      }
      compressedPhoto ||= bestTargetPhoto || fallbackPhoto;
      if (!compressedPhoto) throw new Error('The cropped photo could not be compressed below 1 MB.');
      setPhotoData(compressedPhoto);
      setPhotoSource('');
      setPhotoDimensions(null);
      setPhotoError('');
    } catch (err) {
      setPhotoError(err.message || 'The photo could not be cropped.');
    }
  }

  function startPhotoDrag(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { x: event.clientX, y: event.clientY, offset: photoOffset };
  }

  function movePhoto(event) {
    if (!dragStart.current) return;
    const frameSize = 280;
    const scale = frameSize / Math.min(photoDimensions.width, photoDimensions.height) * photoZoom;
    const width = photoDimensions.width * scale;
    const height = photoDimensions.height * scale;
    const x = dragStart.current.offset.x + event.clientX - dragStart.current.x;
    const y = dragStart.current.offset.y + event.clientY - dragStart.current.y;
    setPhotoOffset({
      x: Math.max(frameSize / 2 - width / 2, Math.min(width / 2 - frameSize / 2, x)),
      y: Math.max(frameSize / 2 - height / 2, Math.min(height / 2 - frameSize / 2, y))
    });
  }

  function updatePhotoZoom(value) {
    const zoom = Number(value);
    setPhotoZoom(zoom);
    if (!photoDimensions) return;
    const frameSize = 280;
    const scale = frameSize / Math.min(photoDimensions.width, photoDimensions.height) * zoom;
    const width = photoDimensions.width * scale;
    const height = photoDimensions.height * scale;
    setPhotoOffset(offset => ({
      x: Math.max(frameSize / 2 - width / 2, Math.min(width / 2 - frameSize / 2, offset.x)),
      y: Math.max(frameSize / 2 - height / 2, Math.min(height / 2 - frameSize / 2, offset.y))
    }));
  }

  const cropScale = photoDimensions ? 280 / Math.min(photoDimensions.width, photoDimensions.height) * photoZoom : 1;
  return <form noValidate onSubmit={submit} onChange={event => {
    const key = event.target.name;
    if (key) setFieldErrors(current => ({ ...current, [key]: '' }));
  }} className="space-y-4">
    {metaError && <ErrorPanel message={metaError} />}
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(([key, label, type, required, options]) => {
        if (page === 'Users' && key === 'teacher_id' && roleValue !== 'Teacher') return null;
        if (['teacher', 'class', 'subject', 'term', 'academic-year', 'grade-level'].includes(type)) {
          const optionSets = {
            teacher: { options: meta?.teachers || [], label: item => `${item.full_name} · ${item.teacher_code}`, placeholder: 'Search staff name or code...' },
            class: { options: meta?.classes || [], label: item => `${item.grade_level} · ${item.name}`, placeholder: 'Search class name or grade...' },
            subject: { options: meta?.subjects || [], label: item => `${item.name} · ${item.code}`, placeholder: 'Search subject name or code...' },
            term: { options: meta?.terms || [], label: item => `${item.name} · ${item.academic_year || ''}`, placeholder: 'Search term or academic year...' },
            'academic-year': { options: meta?.academicYear ? [meta.academicYear] : [], label: item => item.name, placeholder: 'Search academic year...' },
            'grade-level': {
              options: meta?.gradeLevels || [],
              label: item => item.name,
              getOptionId: item => item.name,
              placeholder: 'Search grade levels...',
              emptyLabel: 'No grade levels are configured for this school.'
            }
          };
          const optionSet = optionSets[type];
          const selectedValue = selectionValues[type] || (type === 'academic-year' ? meta?.academicYear?.id || '' : '');
          return <SearchableSelect
            key={key}
            name={key}
            label={label}
            options={optionSet.options}
            value={selectedValue}
            onChange={value => {
              setSelectionValues(current => ({ ...current, [type]: value }));
              setFieldErrors(current => ({ ...current, [key]: '' }));
            }}
            getOptionLabel={optionSet.label}
            getOptionId={optionSet.getOptionId}
            getOptionDetails={item => selectDetails(type, item)}
            getOptionSearchText={item => [item.id, ...Object.values(item)].filter(Boolean).join(' ')}
            placeholder={optionSet.placeholder}
            emptyLabel={optionSet.emptyLabel}
            required={required}
            error={fieldErrors[key] || ''}
          />;
        }
        if (type === 'select' && key === 'status') {
          return <label key={key} className="block text-sm font-medium text-slate-700">{label}
            <select name={key} value={enumValues[key] || 'Active'} onChange={event => {
              setEnumValues(current => ({ ...current, [key]: event.target.value }));
              setFieldErrors(current => ({ ...current, [key]: '' }));
            }} required={required} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100">
              {(options || []).map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal text-slate-500">Changing enrollment status updates the student's active enrollment history.</span>
          </label>;
        }
        if (type === 'select') {
          return <div key={key}>
            <SearchableSelect
              name={key}
              label={label}
              options={(options || []).map(option => ({ value: option }))}
              getOptionId={option => option.value}
              getOptionLabel={option => option.value}
              getOptionSearchText={option => option.value}
              value={key === 'role' ? roleValue : enumValues[key] || ''}
              onChange={value => {
                if (key === 'role') setRoleValue(value);
                else setEnumValues(current => ({ ...current, [key]: value }));
                setFieldErrors(current => ({ ...current, [key]: '' }));
              }}
              placeholder={`Search ${label.toLowerCase()}...`}
              required={required}
              error={fieldErrors[key] || ''}
            />
            {page === 'Users' && key === 'role' && <p className="mt-1 text-xs font-normal text-slate-500">SuperAdmin access can only be granted directly in the database.</p>}
          </div>;
        }
        if (type === 'boolean') {
          return <SearchableSelect
            key={key}
            name={key}
            label={label}
            options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
            getOptionId={option => option.value}
            getOptionLabel={option => option.label}
            getOptionSearchText={option => option.label}
            value={enumValues[key] || 'true'}
            onChange={value => setEnumValues(current => ({ ...current, [key]: value }))}
            placeholder={`Search ${label.toLowerCase()}...`}
          />;
        }
        const maxLength = page === 'Classes' && key === 'name' ? 80
          : page === 'Users' && key === 'username' ? 80
            : inputMaxLengths[key];
        const minLength = page === 'Users' && key === 'username' ? 3 : key === 'password' && required ? 12 : undefined;
        return <div key={key} className="block text-sm font-medium text-slate-700"><label>{label}
          {type === 'auto-code' ? <><input type="text" value={initial?.[key] || 'Generated automatically when saved'} readOnly className="mt-1.5 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2.5 text-sm text-slate-700" /><span className="mt-1 block text-xs font-normal text-slate-600">A unique code is assigned automatically.</span></> :
            <input name={key} type={type} required={required} minLength={minLength} maxLength={maxLength} aria-invalid={Boolean(fieldErrors[key])} aria-describedby={maxLength ? `${key}-length-help` : undefined} defaultValue={type === 'date' ? dateInputValue(initial?.[key] ?? (key === 'enrollment_date' ? new Date() : '')) : initial?.[key] ?? ''} min={type === 'number' ? 1 : undefined} max={key === 'capacity' ? 500 : undefined} step={key === 'capacity' ? 1 : undefined} className={`mt-1.5 w-full rounded-lg border px-3 py-2.5 text-sm outline-none focus:border-blue-500 ${fieldErrors[key] ? 'border-red-400' : 'border-slate-300'}`} />}
        </label>{key === 'password' && page === 'Users' && !initial && <span className="mt-1 block text-xs font-normal text-slate-500">Leave blank to generate a secure one-time password.</span>}{maxLength && type !== 'auto-code' && <span id={`${key}-length-help`} className="mt-1 block text-xs font-normal text-slate-500">Maximum {maxLength} characters.</span>}{key === 'capacity' && <span className="mt-1 block text-xs font-normal text-slate-500">Enter a whole number from 1 to 500.</span>}{fieldErrors[key] && <span role="alert" className="mt-1 block text-xs font-medium text-red-700">{fieldErrors[key]}</span>}</div>;
      })}
    </div>
    {formError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800">Could not save: {formError}</p>}
    {page === 'Students' && <section className="border-t border-slate-200 pt-4">
      <div className="mb-3"><h3 className="text-sm font-semibold text-slate-800">Student photo</h3><p className="mt-1 text-xs text-slate-600">Choose a JPEG, PNG, or WebP image (up to 10 MB), then drag and zoom to crop it. The saved photo is resized to at most 1200 × 1200 and compressed to about 50–100 KB in WebP when supported.</p></div>
      <label className="mb-3 block max-w-xl text-sm font-medium text-slate-700">Photo title
        <input
          type="text"
          value={photoTitle}
          onChange={event => { setPhotoTitle(event.target.value); setPhotoError(''); }}
          maxLength={150}
          required={Boolean(photoData || initial?.photo_url && !removePhoto)}
          disabled={removePhoto && !photoData}
          placeholder="e.g. Student profile photo"
          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100"
        />
      </label>
      <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => { selectPhoto(event.target.files?.[0]); event.target.value = ''; }} />
      {photoSource && photoDimensions ? <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="h-[280px] w-[280px] shrink-0 touch-none overflow-hidden rounded-2xl border-2 border-white bg-slate-200 shadow" onPointerDown={startPhotoDrag} onPointerMove={movePhoto} onPointerUp={() => { dragStart.current = null; }} onPointerCancel={() => { dragStart.current = null; }} role="img" aria-label="Drag the photo to position the crop">
          <img src={photoSource} alt="" draggable="false" className="pointer-events-none relative left-1/2 top-1/2 max-w-none select-none" style={{ width: photoDimensions.width * cropScale, height: photoDimensions.height * cropScale, transform: `translate(calc(-50% + ${photoOffset.x}px), calc(-50% + ${photoOffset.y}px))` }} />
        </div>
        <div className="space-y-3"><label className="block text-sm font-medium text-slate-700">Zoom<input type="range" min="1" max="3" step="0.01" value={photoZoom} onChange={event => updatePhotoZoom(event.target.value)} className="mt-2 block w-full accent-blue-600" /></label>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={applyPhotoCrop} className="primary-action rounded-lg px-3 py-2 text-sm font-semibold">Use this crop</button><button type="button" onClick={() => { setPhotoSource(''); setPhotoDimensions(null); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700">Cancel crop</button></div>
        </div>
      </div> : <div className="flex flex-wrap items-center gap-3">
        {photoData
          ? <img src={photoData} alt="Cropped student photo preview" className="h-16 w-16 rounded-full object-cover ring-2 ring-white" />
          : initial?.photo_url && !removePhoto && <StudentAvatar photoUrl={initial.photo_url} name={initial.english_name} size="large" />}
        <button type="button" onClick={() => fileInput.current?.click()} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">{photoData ? 'Choose a different photo' : initial?.photo_url && !removePhoto ? 'Replace photo' : 'Choose photo'}</button>
        {(photoData || (initial?.photo_url && !removePhoto)) && <button type="button" onClick={() => { setPhotoData(''); setPhotoSource(''); setPhotoDimensions(null); setRemovePhoto(Boolean(initial?.photo_url)); }} className="rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">Remove photo</button>}
        {removePhoto && <button type="button" onClick={() => setRemovePhoto(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50">Undo remove</button>}
      </div>}
      {photoError && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{photoError}</p>}
    </section>}
    <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-100">Cancel</button><button type="submit" disabled={busy} className="primary-action min-w-32 rounded-lg px-4 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60">{busy ? 'Saving...' : initial ? 'Save changes' : `Create ${page === 'Students' ? 'student' : page === 'Teachers' ? 'teacher' : page === 'Classes' ? 'class' : page === 'Subjects' ? 'subject' : 'user'}`}</button></div>
  </form>;
}

function StudentAvatar({ photoUrl, name, size = 'small' }) {
  const dimensions = size === 'large' ? 'h-16 w-16 text-lg' : 'h-8 w-8 text-xs';
  return <span className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-700 ${dimensions}`}>
    {(name || '?').slice(0, 1).toUpperCase()}
    {photoUrl && <img crossOrigin="use-credentials" src={apiAssetUrl(photoUrl)} alt="" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none'; }} />}
  </span>;
}

function PhotoPreview({ photoUrl, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photoUrl]);
  if (failed) return <span className="font-normal text-red-700">Photo could not be loaded.</span>;
  return <img
    crossOrigin="use-credentials"
    src={apiAssetUrl(photoUrl)}
    alt={`${name || 'Student'} photo`}
    className="h-40 w-40 rounded-xl border border-slate-200 object-cover"
    onError={() => setFailed(true)}
  />;
}

function TeacherAssignmentForm({ onCancel, onSave }) {
  const { data: meta, error } = useLoad(apiRoutes.meta);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [values, setValues] = useState({ teacher_id: '', subject_ids: [], class_id: '', academic_year_id: '' });
  const [subjectQuery, setSubjectQuery] = useState('');
  const debouncedSubjectQuery = useDebouncedValue(subjectQuery, 500);
  const academicYearId = values.academic_year_id || meta?.academicYear?.id || '';
  async function submit(event) {
    event.preventDefault();
    const assignment = { ...values, academic_year_id: academicYearId };
    if (!assignment.teacher_id || !assignment.subject_ids.length || !assignment.class_id || !assignment.academic_year_id) {
      setFormError('Select a teacher, at least one subject, a class, and an academic year.');
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      await onSave(assignment);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setBusy(false);
    }
  }
  const selects = [
    ['teacher_id', 'Teacher / staff', meta?.teachers, row => `${row.full_name} · ${row.teacher_code}`, row => `${row.full_name} ${row.teacher_code}`, 'Search full name or staff code...', row => selectDetails('teacher', row)],
    ['class_id', 'Class', meta?.classes, row => `${row.grade_level} · ${row.name}`, row => `${row.grade_level} ${row.name}`, 'Search class...', row => selectDetails('class', row)],
    ['academic_year_id', 'Academic year', meta?.academicYear ? [meta.academicYear] : [], row => row.name, row => row.name, 'Selected academic year', row => selectDetails('academic-year', row)]
  ];
  const filteredSubjects = (meta?.subjects || []).map(row => ({
    row,
    score: debouncedSubjectQuery.trim() ? fuzzySearchScore(debouncedSubjectQuery, `${row.name} ${row.code}`) : 0
  })).filter(match => match.score !== null)
    .sort((first, second) => first.score - second.score)
    .map(match => match.row);
  if (error) return <ErrorPanel message={error} />;
  return <form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2">{selects.map(([name, label, options, getOptionLabel, getOptionSearchText, placeholder, getOptionDetails]) => <SearchableSelect key={name} name={name} label={label} options={options || []} value={name === 'academic_year_id' ? academicYearId : values[name]} onChange={value => setValues(current => ({ ...current, [name]: value }))} getOptionLabel={getOptionLabel} getOptionSearchText={getOptionSearchText} getOptionDetails={getOptionDetails} placeholder={placeholder} required />)}</div>
    <section className="text-sm font-medium text-slate-700">
      <SearchSuggestions id="assignment-subject-search" label="Subjects" value={subjectQuery}
        onChange={setSubjectQuery}
        suggestions={filteredSubjects.map(subject => ({
          key: subject.id,
          value: subject.name,
          label: subject.name,
          description: subject.code,
          searchText: `${subject.name} ${subject.code}`
        }))}
        pending={subjectQuery.trim() !== debouncedSubjectQuery.trim()}
        placeholder="Search subject..." inputClassName="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 outline-none focus:border-blue-500" />
      <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-slate-200">
        {filteredSubjects.map(subject => {
          const selected = values.subject_ids.includes(subject.id);
          const inactive = subject.active === false || subject.active === 0;
          return <label key={subject.id} className={`flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 last:border-0 ${inactive ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer hover:bg-blue-50'}`}>
            <input type="checkbox" checked={selected} disabled={inactive} onChange={() => setValues(current => ({
              ...current,
              subject_ids: selected ? current.subject_ids.filter(id => id !== subject.id) : [...current.subject_ids, subject.id]
            }))} className="h-4 w-4 accent-blue-600" />
            <span className="font-medium">{subject.name}<span className="ml-2 text-xs font-normal text-slate-500">{subject.code}</span>{inactive && <span className="ml-2 text-xs font-normal">Inactive</span>}</span>
          </label>;
        })}
        {!filteredSubjects.length && <p className="px-3 py-3 text-sm font-normal text-slate-500">No matching subjects.</p>}
      </div>
      <p className="mt-1.5 text-xs font-normal text-slate-500">{values.subject_ids.length} subject{values.subject_ids.length === 1 ? '' : 's'} selected</p>
    </section>
    {formError && <p role="alert" className="text-sm font-medium text-red-700">{formError}</p>}
    <div className="flex justify-end gap-2 border-t pt-4"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2">Cancel</button><button type="submit" disabled={busy} className="primary-action rounded-lg px-4 py-2 font-semibold disabled:opacity-60">{busy ? 'Saving...' : 'Save assignment'}</button></div>
  </form>;
}
