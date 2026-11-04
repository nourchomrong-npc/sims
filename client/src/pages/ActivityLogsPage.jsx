import { isValidElement, useEffect, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { ActionMenu, Empty, ErrorPanel, formatDateTime, formatDisplayValue, Loading, Pagination, PrintButton, SearchableSelect, SearchSuggestions, useDebouncedValue, useLoad } from '../components/ui.jsx';
import { apiAssetUrl } from '../services/api.js';
import { apiRoutes } from '../services/apiRoutes.js';

function normalizedDetails(details) {
  if (!details) return null;
  if (typeof details !== 'string') return details;
  try {
    return JSON.parse(details);
  } catch {
    return { message: 'Details unavailable (invalid legacy data)' };
  }
}

function label(value) {
  return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase());
}

function recordedLabel(value) {
  if (value === 'photo_url') return 'Photo';
  if (value === 'photo_url_text') return 'Photo';
  return label(value);
}

function isPhotoField(value) {
  return /(?:photo_url|photo_url_text)/i.test(value);
}

function photoStoragePath(value) {
  if (typeof value !== 'string') return null;
  const match = /(?:^|\/)student-photos\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|webp))$/i.exec(value.trim());
  return match ? `/student-photos/${match[1]}` : null;
}

function hidePhotoPaths(value) {
  return String(value).replace(/(?:https?:\/\/[^\s"'<>]+)?\/student-photos\/[^\s"'<>/?#]+/gi, 'Photo');
}

function safeDetailValue(key, value) {
  if (/(?:password|secret|token|hash|authorization|cookie)/i.test(key)) return null;
  if (key === 'fields' && Array.isArray(value)) {
    return value.filter(field => typeof field === 'string' && !/(?:password|secret|token|hash)/i.test(field)).map(label).join(', ');
  }
  if (typeof value === 'boolean') {
    if (key === 'active') return value ? 'Active' : 'Inactive';
    if (key === 'is_deleted') return value ? 'Deleted' : 'Not deleted';
    if (key === 'is_current' || key === 'current') return value ? 'Yes' : 'No';
    return value ? 'Yes' : 'No';
  }
  if (typeof value !== 'string') return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '—');
  return formatDisplayValue(key, value);
}

function RecordedPhoto({ title, value }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [value]);
  const photoUrl = photoStoragePath(value);
  return <figure className="space-y-1.5">
    <figcaption className="text-xs font-semibold text-slate-600">{title}</figcaption>
    {!photoUrl || failed
      ? <div className="grid h-24 w-24 place-items-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 text-center text-xs text-slate-500" role="img" aria-label={`${title} unavailable`}>No photo</div>
      : <img
        crossOrigin="use-credentials"
        src={apiAssetUrl(photoUrl)}
        alt={title}
        loading="lazy"
        className="h-24 w-24 rounded-lg border border-slate-200 bg-white object-cover"
        onError={() => setFailed(true)}
      />}
  </figure>;
}

function RecordedValue({ name, value, photoTitle }) {
  if (/(?:password|secret|token|hash|authorization|cookie)/i.test(name)) return null;
  if (isPhotoField(name)) return <RecordedPhoto title={photoTitle || 'Photo'} value={value} />;
  if (name === 'fields' && Array.isArray(value)) {
    return value.filter(field => typeof field === 'string' && !/(?:password|secret|token|hash)/i.test(field)).map(label).join(', ') || 'Not recorded';
  }
  if (Array.isArray(value)) {
    const items = value.filter(item => item !== null && typeof item === 'object'
      ? Object.keys(item).some(key => !/(?:password|secret|token|hash|authorization|cookie)/i.test(key))
      : true);
    return items.length
      ? <ul className="space-y-1">{items.map((item, index) => <li key={index}><RecordedValue name={name} value={item} /></li>)}</ul>
      : 'Not recorded';
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([key]) =>
      !/(?:password|secret|token|hash|authorization|cookie|photo_public_id)/i.test(key) &&
      !(key === 'photo_title' && Object.hasOwn(value, 'photo_url')) &&
      !(key === 'photo_url_text' && Object.hasOwn(value, 'photo_url'))
    );
    return entries.length
    ? <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">{entries.map(([key, item]) => <div key={key} className={`min-w-0 ${isPhotoField(key) ? 'sm:col-span-2' : ''}`}>
      {!isPhotoField(key) && <dt className="text-xs font-semibold text-slate-500">{recordedLabel(key)}</dt>}
        <dd className="break-words text-sm text-slate-800"><RecordedValue
          name={key}
          value={item}
          photoTitle={key === 'photo_url' ? value.photo_title || 'Photo' : undefined}
        /></dd>
      </div>)}</dl>
      : 'Not recorded';
  }
  return safeDetailValue(name, value);
}

function identityName(identity) {
  return identity?.display_name || 'Historical identity unavailable';
}

function identityRole(identity) {
  return identity?.roles?.filter(Boolean).join(', ') || 'Role not recorded';
}

function formatWeekday(value) {
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return weekdays[Number(value) - 1] || null;
}

function changeDescription(change) {
  if (isPhotoField(change.field)) return 'Photo updated';
  return `${change.label || label(change.field)}: ${safeDetailValue(change.field, change.before) ?? 'Not recorded'} → ${safeDetailValue(change.field, change.after) ?? 'Not recorded'}`;
}

function recordTimestamps(details) {
  const saved = details?.record_timestamps || {
    created_at: details?.record_after?.created_at ?? details?.record_before?.created_at,
    updated_at: details?.record_after?.updated_at ?? details?.record_before?.updated_at
  };
  if (saved.created_at || saved.updated_at) {
    return {
      created_at: { value: saved.created_at, count: saved.created_at ? 1 : 0 },
      updated_at: { value: saved.updated_at, count: saved.updated_at ? 1 : 0 }
    };
  }

  const affectedStudents = Array.isArray(details?.affected_students) ? details.affected_students : [];
  const summarize = field => {
    const values = [...new Set(affectedStudents.map(student => student[field]).filter(Boolean))];
    return { value: values.length === 1 ? values[0] : null, count: values.length };
  };
  return {
    created_at: summarize('created_at'),
    updated_at: summarize('updated_at')
  };
}

function formatRecordTimestamp(timestamp) {
  if (timestamp.count > 1) return `${timestamp.count} distinct times`;
  return timestamp.value ? formatDateTime(timestamp.value) : 'Not recorded';
}

function ActivityRecordTimestamps({ details }) {
  const timestamps = recordTimestamps(details);
  if (!timestamps.created_at.count && !timestamps.updated_at.count) return null;
  const prefix = details?.record_timestamps_source === 'current_record' ? 'Current record' : 'Record';
  return <p className="mt-1 text-xs leading-5 text-slate-500">
    {prefix} created: {formatRecordTimestamp(timestamps.created_at)} · {prefix} updated: {formatRecordTimestamp(timestamps.updated_at)}
  </p>;
}

function visibleChanges(row, details) {
  const technicalAttendanceFields = new Set([
    'student_id', 'class_id', 'subject_id', 'schedule_id', 'recorded_by',
    'attendance_schedule_scope'
  ]);
  return (Array.isArray(details?.changes) ? details.changes : []).filter(change =>
    !/(?:password|secret|token|hash|authorization|cookie)/i.test(change.field || '') &&
    !(row.entity === 'attendance_record' && technicalAttendanceFields.has(change.field))
  );
}

function ActorSummary({ actor }) {
  return <div className="min-w-0">
    <div className="truncate font-semibold text-slate-900">{identityName(actor)}</div>
    <div className="break-all text-xs text-slate-600">{actor?.username || 'Username not recorded'}</div>
    <div className="mt-1 text-xs text-slate-500">{identityRole(actor)}</div>
  </div>;
}

function InfoSection({ title, children }) {
  return <section className="sims-panel min-w-0">
    <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">{title}</h3>
    {children}
  </section>;
}

function DefinitionList({ entries }) {
  return <dl className="grid gap-x-6 sm:grid-cols-2">
    {entries.map(([name, value]) => <div key={name} className="min-w-0 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{name}</dt>
      <dd className="mt-1 break-words text-sm font-medium leading-6 text-slate-900">
        {value === null || value === undefined || value === ''
          ? '—'
          : value instanceof Date
            ? formatDateTime(value)
            : isValidElement(value)
              ? value
              : typeof value === 'object'
                ? <RecordedValue name={name} value={value} />
                : value}
      </dd>
    </div>)}
  </dl>;
}

function RequestDetails({ request }) {
  const fields = [
    ['IP address', request?.ip],
    ['Browser', request?.browser],
    ['Device', request?.device],
    ['Operating system', request?.os],
    ['HTTP method', request?.method],
    ['Route', request?.url],
    ['User agent', request?.userAgent],
    ['Request ID', request?.requestId]
  ];
  return fields.some(([, value]) => value)
    ? <DefinitionList entries={fields} />
    : <p className="text-sm text-slate-500">Technical metadata was not recorded for this event.</p>;
}

const noUserFilter = '__no_user__';

export default function ActivityLogsPage() {
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [action, setAction] = useState('');
  const [sortOrder, setSortOrder] = useState('latest');
  const [actorId, setActorId] = useState('');
  const [entity, setEntity] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ actions: [], entities: [], users: [] });
  const search = useDebouncedValue(query);
  const pageSize = 25;
  const params = new URLSearchParams({ page: String(currentPage), page_size: String(pageSize) });
  params.set('sort_order', sortOrder === 'oldest' ? 'oldest' : 'latest');
  if (search.trim()) params.set('q', search.trim());
  if (sortOrder === 'custom' && from) params.set('from', from);
  if (sortOrder === 'custom' && to) params.set('to', to);
  if (action) params.set('action', action);
  if (actorId) params.set('username', actorId);
  if (entity) params.set('entity', entity);
  const { data, error, loading } = useLoad(`${apiRoutes.activityLogs}?${params}`);
  const rows = data?.rows || [];
  const searchSuggestions = rows.map(row => {
    const details = normalizedDetails(row.details);
    const activityLabel = `${label(row.action)} ${recordName(row, details)}`;
    return {
      key: row.id,
      value: activityLabel,
      label: `${label(row.action)} · ${recordName(row, details)}`,
      description: [details?.actor?.display_name, details?.actor?.username, description(row, details)].filter(Boolean).join(' · '),
      searchText: `${activityLabel} ${JSON.stringify(details || {})}`
    };
  });
  const total = Number(data?.total || 0);
  useEffect(() => {
    if (data?.filterOptions) setFilterOptions(data.filterOptions);
  }, [data?.filterOptions]);
  const { actions, entities, users } = filterOptions;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { setCurrentPage(1); }, [search, from, to, action, sortOrder, actorId, entity]);
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  function resetFilters() {
    setQuery('');
    setFrom('');
    setTo('');
    setAction('');
    setSortOrder('latest');
    setActorId('');
    setEntity('');
  }

  function getDetails(row) {
    return normalizedDetails(row.details);
  }

  function description(row, details = getDetails(row)) {
    const changes = visibleChanges(row, details);
    if (changes.some(change => isPhotoField(change.field))) {
      return hidePhotoPaths(changes
        .map(changeDescription)
        .join(' · '));
    }
    if (details?.description || details?.summary) return hidePhotoPaths(details.description || details.summary);
    if (changes.length) {
      const summary = changes
        .filter(change => !isPhotoField(change.field))
        .map(changeDescription)
        .join(' · ');
      if (summary) return hidePhotoPaths(summary);
    }
    return hidePhotoPaths(`${label(row.action)} ${label(row.entity)}`);
  }

  function recordName(row, details = getDetails(row)) {
    if (row.entity === 'system') return details?.summary || 'System action';
    if (row.entity === 'user') {
      return [details?.affected_user?.display_name, details?.affected_user?.username].filter(Boolean).join(' · ') || 'Affected user identity unavailable';
    }
    return row.record_label || (row.entity_id_unavailable ? 'Record no longer exists' : row.entity_id || 'Name not recorded');
  }

  const selectedDetails = selected ? normalizedDetails(selected.details) : null;
  const changes = selected ? visibleChanges(selected, selectedDetails) : [];
  const selectedRecordTimestamps = recordTimestamps(selectedDetails);
  const affectedPeople = [...new Set(changes
    .filter(change => change.field === 'attendance_status')
    .map(change => String(change.label || '').replace(/\s+attendance status$/i, '').trim())
    .filter(Boolean))];
  const isAttendanceEvent = selected?.action === 'recorded_attendance' || selected?.entity === 'attendance_record';
  const isBatchAttendanceEvent = selected?.action === 'recorded_attendance';
  const affectedStudents = selectedDetails?.affected_students || (selectedDetails?.student ? [{
    name: selectedDetails.student,
    student_code: selectedDetails.student_code,
    status: changes.find(change => change.field === 'status')?.after
  }] : selected?.entity === 'attendance_record' && selected.record_label ? [{
    name: selected.record_label,
    status: changes.find(change => change.field === 'status')?.after
  }] : []);
  const attendanceDetailKeys = new Set(isAttendanceEvent
    ? ['class', 'grade', 'subject', 'subject_id', 'teacher', 'teacher_code', 'date', 'attendance_date', 'schedule_day',
      'class_schedule_id', 'start_time', 'end_time', 'room', 'records', 'unmarked', 'affected_students', 'student', 'student_code']
    : []);
  const extraDetails = Object.entries(selectedDetails || {}).filter(([key]) =>
    !['actor', 'affected_user', 'request', 'changes', 'summary', 'description', 'record_before', 'record_after'].includes(key) &&
    !attendanceDetailKeys.has(key) &&
    !attendanceDetailKeys.has(key) &&
    !/(?:password|secret|token|hash|authorization|cookie)/i.test(key)
  );
  const affectedUser = selectedDetails?.affected_user;

  return <div className="space-y-4">
    {!selected && <>
      <div className="no-print sims-toolbar sims-filter-grid">
        <SearchSuggestions id="activity-search" label="Search activity" value={query} onChange={setQuery}
          suggestions={searchSuggestions} pending={query.trim() !== search.trim()}
          placeholder="Actor, action, record, or details..." className="xl:col-span-2"
          inputClassName="mt-1 block w-full rounded-lg border border-slate-200 bg-white py-2.5 px-3 text-sm outline-none focus:border-blue-500" />
        <label className="text-sm font-medium text-slate-700">Date order
          <select value={sortOrder} onChange={event => { setSortOrder(event.target.value); if (event.target.value !== 'custom') { setFrom(''); setTo(''); } }} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
            <option value="latest">Latest</option>
            <option value="oldest">Oldest</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {sortOrder === 'custom' && <>
          <label className="text-sm font-medium text-slate-700">From date/time
            <input type="datetime-local" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" />
          </label>
          <label className="text-sm font-medium text-slate-700">To date/time
            <input type="datetime-local" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm" />
          </label>
        </>}
        <SearchableSelect name="activity_action_filter" label="Action"
          options={actions.map(value => ({ id: value, label: label(value) }))} value={action} onChange={setAction}
          getOptionId={option => option.id} getOptionLabel={option => option.label}
          getOptionSearchText={option => `${option.label} ${option.id}`} placeholder="Search actions..."
          emptyValueLabel="All actions" noneLabel="All actions" debounceDelay={500} />
        <SearchableSelect name="activity_user_filter" label="Actor"
          options={[
            { id: noUserFilter, label: 'System / unavailable' },
            ...users.map(([value, name]) => ({ id: value, label: name || `Account ${value}` }))
          ]} value={actorId} onChange={setActorId}
          getOptionId={option => option.id} getOptionLabel={option => option.label}
          getOptionSearchText={option => option.label} placeholder="Search actors..."
          emptyValueLabel="All actors" noneLabel="All actors" debounceDelay={500} />
        <SearchableSelect name="activity_entity_filter" label="Record type"
          options={entities.map(value => ({ id: value, label: label(value) }))} value={entity} onChange={setEntity}
          getOptionId={option => option.id} getOptionLabel={option => option.label}
          getOptionSearchText={option => `${option.label} ${option.id}`} placeholder="Search record types..."
          emptyValueLabel="All record types" noneLabel="All record types" debounceDelay={500} />
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" onClick={resetFilters} className="inline-flex min-w-max flex-none items-center justify-center whitespace-nowrap rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Clear filters</button>
        </div>
      </div>
      {error ? <ErrorPanel message={error} /> : loading ? <Loading /> : <>
        <div className="no-print space-y-3 md:hidden">
          {rows.map(row => {
            const details = getDetails(row);
            return <article key={row.id} className="sims-panel space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatDateTime(row.created_at)}</p>
                  <p className="mt-1 font-semibold text-slate-900">{label(row.action)}</p>
                </div>
                <ActionMenu label={`Actions for activity ${row.event_id || row.id}`} items={[
                  { label: 'View details', onClick: () => setSelected(row) }
                ]} />
              </div>
              <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Actor</p><ActorSummary actor={row.actor} /></div>
              <div className="border-t border-slate-100 pt-2"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Affected record</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{label(row.entity)} · {recordName(row, details)}</p>
                <ActivityRecordTimestamps details={details} />
              </div>
              <p className="text-sm leading-5 text-slate-600">{description(row, details)}</p>
            </article>;
          })}
          {!total && <Empty text="No activity matches these filters. Try changing the search or clearing the filters." />}
        </div>
        <div className="no-print hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>{['Date and time', 'Actor', 'Action and description', 'Affected record', 'Actions'].map(item => <th key={item} className="px-4 py-3">{item}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">{rows.map(row => {
              const details = getDetails(row);
              return <tr key={row.id} className="align-top hover:bg-slate-50/70">
                <td className="whitespace-nowrap px-4 py-4 text-slate-700">{formatDateTime(row.created_at)}</td>
                <td className="max-w-56 px-4 py-4"><ActorSummary actor={row.actor} /></td>
                <td className="max-w-sm px-4 py-4"><div className="font-semibold text-slate-900">{label(row.action)}</div><p className="mt-1 text-sm leading-5 text-slate-600">{description(row, details)}</p></td>
                <td className="max-w-xs px-4 py-4"><div className="font-medium text-slate-800">{label(row.entity)}</div><div className="mt-1 break-words text-sm text-slate-600">{recordName(row, details)}</div><ActivityRecordTimestamps details={details} /></td>
                <td className="px-4 py-4"><ActionMenu label={`Actions for activity ${row.event_id || row.id}`} items={[
                  { label: 'View details', onClick: () => setSelected(row) }
                ]} /></td>
              </tr>;
            })}</tbody>
          </table>
          {!total && <Empty text="No activity matches these filters. Try changing the search or clearing the filters." />}
        </div>
        <div className="no-print"><Pagination page={currentPage} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={setCurrentPage} /></div>
      </>}
      {!error && !loading && <div className="print-only activity-print">
        <h1 className="mb-1 text-xl font-bold">Activity Logs</h1>
        <p className="mb-3 text-xs">Printed {formatDateTime(new Date())} · {total} matching records (current page){from ? ` · From: ${formatDateTime(from)}` : ''}{to ? ` · To: ${formatDateTime(to)}` : ''}{action ? ` · Action: ${label(action)}` : ''}{actorId ? ` · Actor: ${users.find(([value]) => value === actorId)?.[1] || 'Historical identity unavailable'}` : ''}{entity ? ` · Record type: ${label(entity)}` : ''}{search.trim() ? ` · Search: ${search.trim()}` : ''}</p>
        {rows.length ? <table className="print-table activity-print-table">
          <thead><tr>{['Time', 'Actor', 'Action', 'Record type', 'Affected record', 'Device / OS'].map(column => <th key={column}>{column}</th>)}<th className="print-other-column">Other</th></tr></thead>
          <tbody>{rows.map(row => {
            const details = getDetails(row);
            const actor = row.actor;
            const request = details?.request;
            return <tr key={row.id}>
              <td>{formatDateTime(row.created_at)}</td>
              <td>{identityName(actor)}{actor?.username ? ` (${actor.username})` : ''}<br />{identityRole(actor)}</td>
              <td>{label(row.action)}<br />{description(row, details)}</td>
              <td>{label(row.entity)}</td>
              <td>{recordName(row, details)}</td>
              <td>{request ? [request.device, request.os].filter(Boolean).join(' · ') : 'Not recorded'}</td><td className="print-other-column"></td>
            </tr>;
          })}</tbody>
        </table> : <p>No activity matches these filters.</p>}
      </div>}
    </>}
    {selected && <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
        <button type="button" onClick={() => setSelected(null)} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to activity logs"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-slate-900">Activity details</h2><p className="text-sm text-slate-500">Recorded event information</p></div>
        </div>
        <div className="no-print"><PrintButton label="Print activity details" /></div>
      </div>
      <InfoSection title="Activity summary">
        <DefinitionList entries={[
          ['Action', label(selected.action)],
          ['Description', Array.isArray(selectedDetails?.changes) && selectedDetails.changes.length
            ? <ul className="space-y-1">
              {changes
                .map((change, index) => <li key={`${change.field}-${index}`} className="break-words">{changeDescription(change)}</li>)}
            </ul>
            : description(selected, selectedDetails)],
          ['Timestamp', formatDateTime(selected.created_at)],
          ['Outcome', selectedDetails?.outcome || 'Not recorded'],
          ['Event ID', selected.event_id || 'Not recorded']
        ]} />
      </InfoSection>
      {!isBatchAttendanceEvent && <InfoSection title="Affected record timestamps">
        <DefinitionList entries={[
          [`${selectedDetails?.record_timestamps_source === 'current_record' ? 'Current record' : 'Record'} created at`, formatRecordTimestamp(selectedRecordTimestamps.created_at)],
          [`${selectedDetails?.record_timestamps_source === 'current_record' ? 'Current record' : 'Record'} updated at`, formatRecordTimestamp(selectedRecordTimestamps.updated_at)]
        ]} />
      </InfoSection>}
      {isAttendanceEvent && <InfoSection title="Who / what was affected">
        <DefinitionList entries={[
          ['Record type', label(selected.entity)],
          ['Class / grade', [selectedDetails?.class, selectedDetails?.grade].filter(Boolean).join(' · ') || recordName(selected, selectedDetails)],
          ['Subject', selectedDetails?.subject],
          ['Teacher', [selectedDetails?.teacher, selectedDetails?.teacher_code].filter(Boolean).join(' · ')],
          ['Attendance date', selectedDetails?.date || selectedDetails?.attendance_date],
          ['Weekday', formatWeekday(selectedDetails?.schedule_day)],
          ['Schedule time', selectedDetails?.start_time && selectedDetails?.end_time
            ? `${selectedDetails.start_time}–${selectedDetails.end_time}`
            : null],
          ['Room', selectedDetails?.room],
          ...(affectedStudents.length ? [['Affected student(s)', <ul className="space-y-1">
            {affectedStudents.map((student, index) => <li key={`${student.student_code || student.name}-${index}`}>
              {[student.name, student.student_code].filter(Boolean).join(' · ') || 'Unknown student'}
              {student.status ? ` — ${student.status}` : ''}
              {(student.created_at || student.updated_at) && <div className="mt-1 text-xs text-slate-500">
                {student.created_at ? `${student.timestamps_source === 'current_record' ? 'Current created' : 'Created'} ${formatDateTime(student.created_at)}` : ''}
                {student.created_at && student.updated_at ? ' · ' : ''}
                {student.updated_at ? `${student.timestamps_source === 'current_record' ? 'Current updated' : 'Updated'} ${formatDateTime(student.updated_at)}` : ''}
              </div>}
            </li>)}
          </ul>]] : affectedPeople.length ? [['Affected student(s)', affectedPeople.join(', ')]] : []),
          ['Students marked', selectedDetails?.records ?? (affectedStudents.length ? affectedStudents.filter(student => student.status !== 'Unmarked').length : null)],
          ['Students unmarked', selectedDetails?.unmarked ?? (affectedStudents.length ? affectedStudents.filter(student => student.status === 'Unmarked').length : null)]
        ].filter(([, value]) => value !== null && value !== undefined && value !== '')} />
      </InfoSection>}
      <InfoSection title={`Before and after${changes.length ? ` · ${changes.length} ${changes.length === 1 ? 'field' : 'fields'}` : ''}`}>
        {changes.length ? <details>
          <summary className="cursor-pointer text-sm font-semibold text-blue-700 hover:text-blue-900">
            Show before/after details ({changes.length} {changes.length === 1 ? 'change' : 'changes'})
          </summary>
          <div className="mt-2 divide-y divide-slate-100">
            {changes.map((change, index) => {
              const photoChange = isPhotoField(change.field);
              return <div key={`${change.field}-${index}`} className="grid gap-2 py-3 sm:grid-cols-[minmax(8rem,.7fr)_1fr_auto_1fr] sm:items-center sm:gap-3">
                <span className="text-sm font-semibold text-slate-700">{change.label || recordedLabel(change.field)}</span>
                <div className="min-w-0 rounded-lg bg-rose-50 px-3 py-2">
                  {!photoChange && <span className="block text-xs font-semibold uppercase tracking-wide text-rose-700">Old value</span>}
                  <span className="break-words text-sm text-slate-800"><RecordedValue
                    name={change.field}
                    value={change.before}
                    photoTitle={photoChange ? `Previous Photo${change.before_title ? ` · ${change.before_title}` : ''}` : undefined}
                  /></span>
                </div>
                <span className="text-center text-slate-400" aria-hidden="true">→</span>
                <div className="min-w-0 rounded-lg bg-emerald-50 px-3 py-2">
                  {!photoChange && <span className="block text-xs font-semibold uppercase tracking-wide text-emerald-700">New value</span>}
                  <span className="break-words text-sm font-semibold text-slate-900"><RecordedValue
                    name={change.field}
                    value={change.after}
                    photoTitle={photoChange ? `New Photo${change.after_title ? ` · ${change.after_title}` : ''}` : undefined}
                  /></span>
                </div>
              </div>;
            })}
          </div>
        </details> : <p className="text-sm text-slate-500">{selected.action === 'created'
          ? 'This event created the record, so there are no previous values. Initial recorded values appear below when available.'
          : 'No before/after field values were recorded for this event.'}</p>}
      </InfoSection>
      {(selectedDetails?.record_before || selectedDetails?.record_after) && <InfoSection title="Full record data">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-blue-700 hover:text-blue-900">Show full record values</summary>
          <div className={`mt-3 grid gap-4 ${selectedDetails.record_before && selectedDetails.record_after ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
            {selectedDetails.record_before && <div className="min-w-0 rounded-lg border border-rose-100 bg-rose-50/50 p-3">
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-rose-800">Previous record values</h4>
              <RecordedValue name="record" value={selectedDetails.record_before} />
            </div>}
            {selectedDetails.record_after && <div className="min-w-0 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-emerald-800">{selected.action === 'created' ? 'New record values' : 'Current record values'}</h4>
              <RecordedValue name="record" value={selectedDetails.record_after} />
            </div>}
          </div>
        </details>
      </InfoSection>}
      <div className="grid gap-4 lg:grid-cols-2">
        <InfoSection title="Actor · identity at event time">
          <DefinitionList entries={[
            ['Display name', identityName(selected.actor || selectedDetails?.actor)],
            ['Username', selected.actor?.username || selectedDetails?.actor?.username || 'Not recorded'],
            ['Role(s)', identityRole(selected.actor || selectedDetails?.actor)],
            ['Public ID', selected.actor?.public_id || selectedDetails?.actor?.public_id || 'Not recorded']
          ]} />
        </InfoSection>
        {!isAttendanceEvent && <InfoSection title="Who / what was affected">
          <DefinitionList entries={[
            ['Record type', label(selected.entity)],
            ['Name', recordName(selected, selectedDetails)],
            ['Record public ID', selected.entity_id || 'Not recorded'],
            ...(affectedUser ? [
              ['Account display name', affectedUser.display_name || 'Historical identity unavailable'],
              ['Account username', affectedUser.username || 'Not recorded'],
              ['Account role(s)', identityRole(affectedUser)],
              ['Account public ID', affectedUser.public_id || 'Not recorded']
            ] : [])
          ]} />
        </InfoSection>}
      </div>
      {extraDetails.length > 0 && <InfoSection title="Recorded event data">
        <DefinitionList entries={extraDetails.map(([key, value]) => [label(key), <RecordedValue key={key} name={key} value={value} />])} />
      </InfoSection>}
      <details className="sims-panel">
        <summary className="cursor-pointer text-sm font-bold text-slate-700">Technical metadata</summary>
        <div className="mt-3"><RequestDetails request={selectedDetails?.request} /></div>
      </details>
    </section>}
  </div>;
}
