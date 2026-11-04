import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, List, Plus, Printer, Trash2 } from 'lucide-react';
import { api } from '../services/api.js';
import { apiRoute, apiRoutes } from '../services/apiRoutes.js';
import { ActionMenu, DetailsPage, Empty, ErrorPanel, formatDateTime, formatTime, Loading, Modal, Pagination, SearchableSelect, StatusBadge, StatusSelect, useLoad } from '../components/ui.jsx';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const canManage = role => ['Admin', 'SuperAdmin', 'School Manager'].includes(role);

function getTimeSlots(rows) {
  return [...new Map(rows.map(row => {
    const start = String(row.start_time).slice(0, 5);
    const end = String(row.end_time).slice(0, 5);
    return [start, { start, end }];
  })).values()].sort((first, second) => first.start.localeCompare(second.start) || first.end.localeCompare(second.end));
}

function timeInMinutes(value) {
  const [hours, minutes] = String(value).slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
}

export default function ClassSchedulePage({ user, onError, onSuccess, onDraftChange }) {
  const [classFilter, setClassFilter] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sortOrder, setSortOrder] = useState('latest');
  const [layout, setLayout] = useState('table');
  const [screen, setScreen] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [confirmHide, setConfirmHide] = useState(null);
  const [savingStatusId, setSavingStatusId] = useState('');
  const [schedulePrint, setSchedulePrint] = useState(null);
  const [printDialog, setPrintDialog] = useState('');
  const [printBusy, setPrintBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftRows, setDraftRows] = useState(null);
  const [originalRows, setOriginalRows] = useState([]);
  const [draftDeletedIds, setDraftDeletedIds] = useState([]);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draggedScheduleId, setDraggedScheduleId] = useState('');
  const [dropPreview, setDropPreview] = useState(null);
  const [deleteDraft, setDeleteDraft] = useState(null);
  const [slotDialog, setSlotDialog] = useState(false);
  const [slotBusy, setSlotBusy] = useState(false);
  const pageSize = 25;
  const filterParams = new URLSearchParams();
  if (classFilter) filterParams.set('class_id', classFilter);
  if (dayFilter) filterParams.set('day_of_week', dayFilter);
  if (timeFrom) filterParams.set('time_from', timeFrom);
  if (timeTo) filterParams.set('time_to', timeTo);
  if (statusFilter) filterParams.set('status', statusFilter);
  if (sortOrder === 'custom' && createdFrom) filterParams.set('created_from', createdFrom);
  if (sortOrder === 'custom' && createdTo) filterParams.set('created_to', createdTo);
  const filterQuery = filterParams.toString();
  const invalidTimeRange = Boolean(timeFrom && timeTo && timeFrom >= timeTo);
  const tableParams = new URLSearchParams(filterParams);
  tableParams.set('page', String(currentPage));
  tableParams.set('page_size', String(pageSize));
  tableParams.set('sort_order', sortOrder === 'oldest' ? 'oldest' : 'latest');
  const schedules = useLoad(invalidTimeRange ? null : `${apiRoutes.classSchedules.collection}?${tableParams}`);
  const gridSchedules = useLoad(layout === 'grid' && classFilter && !invalidTimeRange ? `${apiRoutes.classSchedules.collection}${filterQuery ? `?${filterQuery}` : ''}` : null);
  const editableSchedules = useLoad(editing && classFilter ? `${apiRoutes.classSchedules.collection}?class_id=${encodeURIComponent(classFilter)}` : null);
  const scheduleTimeSlots = useLoad(layout === 'grid' && classFilter ? `${apiRoutes.classSchedules.timeSlots}?class_id=${encodeURIComponent(classFilter)}` : null);
  const { data: meta, error: metaError } = useLoad(apiRoutes.meta);
  const manageable = canManage(user.role);
  const canEditSchedule = manageable && layout === 'grid' && Boolean(classFilter);
  const gridRows = Array.isArray(gridSchedules.data) ? gridSchedules.data : [];
  const displayedRows = editing ? draftRows || editableSchedules.data || [] : gridRows;
  const timeSlots = getTimeSlots([...displayedRows, ...(scheduleTimeSlots.data || [])]);

  useEffect(() => {
    if (editing && draftRows === null && !editableSchedules.loading && Array.isArray(editableSchedules.data)) {
      setDraftRows(editableSchedules.data);
      setOriginalRows(editableSchedules.data);
    }
  }, [editing, draftRows, editableSchedules.data, editableSchedules.loading]);

  function discardScheduleDraft() {
    if (draftDirty && !window.confirm('Discard unsaved timetable changes?')) return false;
    setEditing(false);
    setDraftRows(null);
    setOriginalRows([]);
    setDraftDeletedIds([]);
    setDraftDirty(false);
    setDraggedScheduleId('');
    setDropPreview(null);
    setScreen(null);
    return true;
  }

  function changeClassFilter(value) {
    if (editing && !discardScheduleDraft()) return;
    setClassFilter(value);
  }

  function beginScheduleEdit() {
    if (!canEditSchedule) return;
    setDraftRows(null);
    setOriginalRows([]);
    setDraftDeletedIds([]);
    setDraftDirty(false);
    setEditing(true);
  }

  async function addOrUpdateDraft(values) {
    const existing = screen?.row;
    const currentDraftRows = draftRows || [];
    const timeConflict = currentDraftRows.find(row => row.id !== existing?.id &&
      Number(row.day_of_week) === Number(values.day_of_week) &&
      timeInMinutes(row.start_time) < timeInMinutes(values.end_time) &&
      timeInMinutes(row.end_time) > timeInMinutes(values.start_time));
    if (timeConflict) {
      throw new Error('This lesson overlaps another lesson for the selected class.');
    }
    await api(apiRoutes.classSchedules.validate, {
      method: 'POST',
      body: JSON.stringify({
        ...values,
        class_id: classFilter,
        ignored_schedule_ids: currentDraftRows.filter(row => !row._draftNew).map(row => row.id)
      })
    });
    const classRecord = meta?.classes.find(row => String(row.id) === String(classFilter));
    const subject = meta?.subjects.find(row => String(row.id) === String(values.subject_id));
    const assignment = meta?.teacherAssignments.find(row => String(row.teacher_id) === String(values.teacher_id) && String(row.subject_id) === String(values.subject_id));
    const next = {
      ...existing,
      ...values,
      id: existing?.id || `draft-${crypto.randomUUID()}`,
      _draftNew: existing?._draftNew || !existing,
      class_name: classRecord?.name || existing?.class_name || '',
      grade_level: classRecord?.grade_level || existing?.grade_level || '',
      subject_name: subject?.name || existing?.subject_name || '',
      subject_code: subject?.code || existing?.subject_code || '',
      teacher_name: assignment?.teacher_name || existing?.teacher_name || '',
      academic_year: classRecord?.academic_year || existing?.academic_year || ''
    };
    setDraftRows(rows => existing ? rows.map(row => row.id === existing.id ? next : row) : [...(rows || []), next]);
    setDraftDirty(true);
    setScreen(null);
  }

  async function saveScheduleDraft() {
    if (!draftRows) return;
    setPrintBusy(true);
    try {
      await api(apiRoutes.classSchedules.batch, {
        method: 'PUT',
        body: JSON.stringify({
          class_id: classFilter,
          updates: draftRows.filter(row => !row._draftNew && originalRows.some(original => original.id === row.id &&
            ['subject_id', 'teacher_id', 'day_of_week', 'start_time', 'end_time', 'room'].some(field =>
              String(original[field] ?? '') !== String(row[field] ?? '')
            )
          )).map(row => ({
            id: row.id,
            subject_id: row.subject_id,
            teacher_id: row.teacher_id,
            day_of_week: Number(row.day_of_week),
            start_time: String(row.start_time).slice(0, 5),
            end_time: String(row.end_time).slice(0, 5),
            room: row.room || null
          })),
          creates: draftRows.filter(row => row._draftNew).map(row => ({
            subject_id: row.subject_id,
            teacher_id: row.teacher_id,
            day_of_week: Number(row.day_of_week),
            start_time: String(row.start_time).slice(0, 5),
            end_time: String(row.end_time).slice(0, 5),
            room: row.room || null
          })),
          deletes: draftDeletedIds
        })
      });
      onSuccess('Timetable changes saved.');
      setEditing(false);
      setDraftRows(null);
      setOriginalRows([]);
      setDraftDeletedIds([]);
      setDraftDirty(false);
      gridSchedules.reload();
      schedules.reload();
    } catch (error) {
      onError(error.message);
    } finally {
      setPrintBusy(false);
    }
  }

  async function addTimeSlot(values) {
    setSlotBusy(true);
    try {
      await api(apiRoutes.classSchedules.timeSlots, {
        method: 'POST',
        body: JSON.stringify({ class_id: classFilter, ...values })
      });
      scheduleTimeSlots.reload();
      setSlotDialog(false);
      onSuccess('Time slot added.');
    } catch (error) {
      onError(error.message);
    } finally {
      setSlotBusy(false);
    }
  }

  async function removeTimeSlot(slot) {
    if (!window.confirm(`Remove the empty ${formatTime(slot.start)}–${formatTime(slot.end)} time slot?`)) return;
    setSlotBusy(true);
    try {
      await api(apiRoutes.classSchedules.timeSlots, {
        method: 'DELETE',
        body: JSON.stringify({ class_id: classFilter, start_time: slot.start, end_time: slot.end })
      });
      scheduleTimeSlots.reload();
      onSuccess('Time slot removed.');
    } catch (error) {
      onError(error.message);
    } finally {
      setSlotBusy(false);
    }
  }

  function moveDraftSchedule(row, dayNumber, slot) {
    if (!editing || !draftRows || !canEditSchedule) return;
    const oldStart = String(row.start_time).slice(0, 5);
    const oldEnd = String(row.end_time).slice(0, 5);
    if (Number(row.day_of_week) === dayNumber && oldStart === slot.start) {
      setDraggedScheduleId('');
      setDropPreview(null);
      return;
    }
    const occupants = draftRows.filter(item => item.id !== row.id && Number(item.day_of_week) === dayNumber &&
      String(item.start_time).slice(0, 5) === slot.start);
    let updatedRows;
    if (occupants.length === 1) {
      const other = occupants[0];
      updatedRows = draftRows.map(item => item.id === row.id
        ? { ...item, day_of_week: dayNumber, start_time: slot.start, end_time: slot.end }
        : item.id === other.id
          ? { ...item, day_of_week: Number(row.day_of_week), start_time: oldStart, end_time: oldEnd }
          : item);
    } else {
      updatedRows = draftRows.map(item => item.id === row.id
        ? { ...item, day_of_week: dayNumber, start_time: slot.start, end_time: slot.end }
        : item);
    }
    const moved = updatedRows.find(item => item.id === row.id);
    const conflict = updatedRows.find(item => item.id !== row.id && Number(item.day_of_week) === Number(moved.day_of_week) &&
      timeInMinutes(item.start_time) < timeInMinutes(moved.end_time) && timeInMinutes(item.end_time) > timeInMinutes(moved.start_time));
    if (conflict) {
      onError('Cannot move this lesson because it overlaps another lesson for this class.');
    } else {
      setDraftRows(updatedRows);
      setDraftDirty(true);
    }
    setDraggedScheduleId('');
    setDropPreview(null);
  }

  async function save(values) {
    try {
      if (screen?.row) {
        await api(apiRoute(apiRoutes.classSchedules.item, { id: screen.row.id }), { method: 'PATCH', body: JSON.stringify(values) });
      } else {
        await api(apiRoutes.classSchedules.collection, { method: 'POST', body: JSON.stringify(values) });
      }
      setScreen(null);
      onSuccess(screen?.row ? 'Class schedule updated.' : 'Class schedule created.');
      schedules.reload();
      gridSchedules.reload();
    } catch (error) {
      throw error;
    }
  }

  async function setHidden(row, hidden) {
    try {
      await api(apiRoute(hidden ? apiRoutes.visibility.delete : apiRoutes.visibility.restore, {
        entity: 'class-schedules',
        id: row.id
      }), { method: 'POST' });
      onSuccess(hidden ? 'Schedule moved to Trash.' : 'Schedule restored.');
      schedules.reload();
      gridSchedules.reload();
    } catch (error) {
      onError(error.message);
    }
  }

  async function updateScheduleStatus(row, value) {
    const active = value === 'Active';
    if (active === Boolean(row.active)) return;
    setSavingStatusId(row.id);
    try {
      await api(apiRoute(apiRoutes.classSchedules.item, { id: row.id }), { method: 'PATCH', body: JSON.stringify({ active }) });
      onSuccess(`${row.class_name} schedule set to ${value.toLowerCase()}.`);
      schedules.reload();
      gridSchedules.reload();
    } catch (error) {
      onError(error.message);
      schedules.reload();
      gridSchedules.reload();
    } finally {
      setSavingStatusId('');
    }
  }

  async function printSchedule(printLayout) {
    setPrintDialog('');
    setPrintBusy(true);
    try {
      const printRows = await api(`${apiRoutes.classSchedules.collection}${filterQuery ? `?${filterQuery}` : ''}`);
      setSchedulePrint({ rows: printRows, layout: printLayout });
    } catch (error) {
      onError(error.message);
    } finally {
      setPrintBusy(false);
    }
  }

  useEffect(() => {
    if (!schedulePrint) return undefined;
    const finishPrint = () => setSchedulePrint(null);
    window.addEventListener('afterprint', finishPrint);
    window.print();
    return () => window.removeEventListener('afterprint', finishPrint);
  }, [schedulePrint]);

  const rows = Array.isArray(schedules.data) ? schedules.data : schedules.data?.rows || [];
  const total = Array.isArray(schedules.data) ? rows.length : Number(schedules.data?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = rows;
  const visibleDays = days.map((_, index) => index + 1);
  useEffect(() => { setCurrentPage(1); }, [classFilter, dayFilter, timeFrom, timeTo]);
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);
  useEffect(() => {
    if (!draftDirty) return undefined;
    const warnBeforeLeave = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeave);
    return () => window.removeEventListener('beforeunload', warnBeforeLeave);
  }, [draftDirty]);
  useEffect(() => {
    onDraftChange?.(editing && draftDirty);
  }, [editing, draftDirty, onDraftChange]);
  return <div className="space-y-4">
    {!['form', 'detail'].includes(screen?.type) && <>
    <div className="no-print">
    <div className="sims-toolbar space-y-3">
      <p className="pb-2 text-sm text-slate-500">Weekly class timetable with teacher and subject assignments.</p>
      <div className="sims-filter-grid">
        <div className="min-w-44">
          <SearchableSelect name="schedule_class_filter" label="Class" options={meta?.classes || []} value={classFilter}
            onChange={changeClassFilter} getOptionLabel={row => `${row.grade_level} · ${row.name}`}
            getOptionSearchText={row => `${row.grade_level} ${row.name}`} placeholder="Search classes..."
            emptyValueLabel="All classes" noneLabel="All classes" debounceDelay={500} />
        </div>
        <div className="min-w-36">
          <SearchableSelect name="schedule_day_filter" label="Day" options={days.map((label, index) => ({ id: String(index + 1), label }))}
            value={dayFilter} onChange={setDayFilter} getOptionId={option => option.id}
            getOptionLabel={option => option.label} getOptionSearchText={option => option.label}
            placeholder="Search days..." emptyValueLabel="All days" noneLabel="All days" debounceDelay={500} />
        </div>
        <label className="text-sm font-medium">From<input aria-label="Filter schedules ending after this time" type="time" value={timeFrom} max={timeTo || undefined} onChange={event => setTimeFrom(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-medium">To<input aria-label="Filter schedules starting before this time" type="time" value={timeTo} min={timeFrom || undefined} onChange={event => setTimeTo(event.target.value)} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-medium">Status<select value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setCurrentPage(1); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="">All statuses</option><option value="Active">Active</option>{manageable && <option value="Inactive">Inactive</option>}</select></label>
        <label className="text-sm font-medium">Date order<select value={sortOrder} onChange={event => { setSortOrder(event.target.value); if (event.target.value !== 'custom') { setCreatedFrom(''); setCreatedTo(''); } setCurrentPage(1); }} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="latest">Latest</option><option value="oldest">Oldest</option><option value="custom">Custom range</option></select></label>
        {sortOrder === 'custom' && <>
          <label className="text-sm font-medium">Created from<input type="date" value={createdFrom} max={createdTo || undefined} onChange={event => { setCreatedFrom(event.target.value); setCurrentPage(1); }} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
          <label className="text-sm font-medium">Created to<input type="date" value={createdTo} min={createdFrom || undefined} onChange={event => { setCreatedTo(event.target.value); setCurrentPage(1); }} className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
        </>}
        <button type="button" disabled={!classFilter && !dayFilter && !timeFrom && !timeTo && !statusFilter && !createdFrom && !createdTo && sortOrder === 'latest'} onClick={() => {
          if (editing && !discardScheduleDraft()) return;
          setClassFilter(''); setDayFilter(''); setTimeFrom(''); setTimeTo(''); setStatusFilter('');
          setCreatedFrom(''); setCreatedTo(''); setSortOrder('latest');
        }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Clear filters</button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-slate-300 bg-white p-1" role="group" aria-label="Schedule layout">
            <button type="button" aria-pressed={layout === 'table'} onClick={() => { if (!editing || discardScheduleDraft()) setLayout('table'); }} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold ${layout === 'table' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}><List size={16} />Table</button>
            <button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold ${layout === 'grid' ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}><CalendarDays size={16} />Weekly</button>
          </div>
          {!editing && <>
            <button type="button" disabled={printBusy || schedules.loading || invalidTimeRange} onClick={() => setPrintDialog('table')} className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><Printer size={16} /> {printBusy ? 'Preparing...' : 'Print table'}</button>
            <button type="button" disabled={printBusy || schedules.loading || invalidTimeRange || !classFilter} onClick={() => setPrintDialog('grid')} className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"><CalendarDays size={16} /> Print weekly</button>
          </>}
        </div>
        {manageable && <div className="flex flex-wrap gap-2">
          {printDialog && <Modal title="Print class schedule" onClose={() => setPrintDialog('')}>
            <p className="text-sm text-slate-600">Open print preview for the {printDialog === 'grid' ? 'weekly timetable' : 'schedule table'} using your current filters?</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setPrintDialog('')} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="button" onClick={() => printSchedule(printDialog)} className="primary-action flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold"><Printer size={16} /> Print</button>
            </div>
          </Modal>}
          <button type="button" disabled={!meta} onClick={() => setScreen({ type: 'form', row: null })} className="primary-action flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"><Plus size={16} /> Add schedule</button>
        </div>}
      </div>
    </div>
    {metaError && <ErrorPanel message={metaError} />}
    {layout === 'grid' && !classFilter && <p className="text-sm text-slate-500">Select a class to load its weekly timetable{manageable ? ' and enable editing' : ''}.</p>}
    {layout === 'grid' && canEditSchedule && <div className={`no-print flex flex-col items-stretch gap-3 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 ${editing ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">{editing ? <><span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" /><strong className="text-amber-900">Edit mode</strong><span className="text-amber-800">Changes are not saved yet.</span></> : <span className="text-slate-600">Timetable is read-only.</span>}</div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
        {!editing ? <button type="button" onClick={beginScheduleEdit} className="primary-action whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold sm:px-4">Edit Schedule</button> : <>
          <button type="button" disabled={!draftDirty || printBusy} onClick={saveScheduleDraft} className="primary-action whitespace-nowrap rounded-lg px-2 py-2 text-xs font-semibold disabled:opacity-50 sm:px-4 sm:text-sm">{printBusy ? 'Saving...' : 'Save Changes'}</button>
          <button type="button" onClick={discardScheduleDraft} disabled={printBusy} className="whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-semibold text-slate-700 sm:px-4 sm:text-sm">Cancel</button>
          <button type="button" onClick={() => { setScreen({ type: 'form', row: null }); }} disabled={!draftRows || printBusy} className="flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-1.5 py-2 text-xs font-semibold text-slate-700 sm:px-4 sm:text-sm"><Plus size={16} className="shrink-0" />Add lesson</button>
          <button type="button" onClick={() => setSlotDialog(true)} disabled={slotBusy} className="flex min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-1.5 py-2 text-xs font-semibold text-slate-700 sm:px-4 sm:text-sm"><Plus size={16} className="shrink-0" />Add time slot</button>
        </>}
      </div>
    </div>}
    {editing && editableSchedules.error && <ErrorPanel message={editableSchedules.error} />}
    {layout === 'grid' && scheduleTimeSlots.error && <ErrorPanel message={scheduleTimeSlots.error} />}
    {editing && editableSchedules.loading && <Loading />}
    {invalidTimeRange && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">The end time must be later than the start time.</p>}
    {layout === 'table' && !invalidTimeRange && (schedules.error ? <ErrorPanel message={schedules.error} /> : schedules.loading ? <Loading /> : <div className="sims-table-panel overflow-x-auto">
      <table className="sims-table w-full min-w-[980px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase"><tr>{['Day', 'Time', 'Class', 'Subject', 'Teacher', 'Room', 'Academic year', 'Created', 'Status', 'Actions'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{pageRows.map(row => <tr key={row.id} className="hover:bg-slate-50/70">
          <td className="px-4 py-3">{days[row.day_of_week - 1] || '—'}</td>
          <td className="whitespace-nowrap px-4 py-3">{formatTime(row.start_time)}–{formatTime(row.end_time)}</td>
          <td className="px-4 py-3">{row.grade_level} · {row.class_name}</td>
          <td className="px-4 py-3">{row.subject_name}</td>
          <td className="px-4 py-3">{row.teacher_name}</td>
          <td className="px-4 py-3">{row.room || '—'}</td>
          <td className="px-4 py-3">{row.academic_year}</td>
          <td className="whitespace-nowrap px-4 py-3">{formatDateTime(row.created_at)}</td>
          <td className="px-4 py-3">{manageable
            ? <StatusSelect label={`Change schedule status for ${row.class_name} ${row.subject_name}`} value={row.active ? 'Active' : 'Inactive'} options={['Active', 'Inactive']} disabled={savingStatusId === row.id} onChange={value => updateScheduleStatus(row, value)} />
            : <StatusBadge>{row.active ? 'Active' : 'Inactive'}</StatusBadge>}</td>
          <td className="whitespace-nowrap px-4 py-3"><ActionMenu label={`Actions for ${row.class_name} ${row.subject_name}`} items={[
            { label: 'View details', onClick: () => setScreen({ type: 'detail', row }) },
            { label: 'Edit', onClick: () => setScreen({ type: 'form', row }), visible: manageable && !row.is_deleted },
            { label: 'Delete', onClick: () => setConfirmHide(row), visible: manageable && !row.is_deleted, variant: 'danger' }
          ]} /></td>
        </tr>)}</tbody>
      </table>
      {!total && <Empty text={classFilter || dayFilter || timeFrom || timeTo ? 'No schedule entries match these filters.' : 'No weekly schedule entries yet.'} />}
      <Pagination page={currentPage} pageCount={pageCount} total={total} pageSize={pageSize} onPageChange={setCurrentPage} />
    </div>)}
    {layout === 'grid' && !classFilter && !invalidTimeRange && <Empty text="Choose a class above to load its weekly timetable." />}
    {layout === 'grid' && classFilter && !invalidTimeRange && (!editing || (!editableSchedules.error && !editableSchedules.loading)) && (gridSchedules.error && !editing ? <ErrorPanel message={gridSchedules.error} /> : gridSchedules.loading && !editing ? <Loading /> : <ScheduleGrid
      rows={displayedRows}
      days={visibleDays}
      timeSlots={timeSlots}
      onSelect={row => setScreen({ type: editing ? 'form' : 'detail', row })}
      editing={editing}
      draggedScheduleId={draggedScheduleId}
      dropPreview={dropPreview}
      onDragStart={row => setDraggedScheduleId(row.id)}
      onDragEnd={() => { setDraggedScheduleId(''); setDropPreview(null); }}
      onDragOver={(dayNumber, slot) => setDropPreview({ dayNumber, start: slot.start, end: slot.end })}
      onDrop={moveDraftSchedule}
      onDelete={row => setDeleteDraft(row)}
      onAdd={(dayNumber, slot) => setScreen({ type: 'form', row: null, initial: { day_of_week: dayNumber, start_time: slot.start, end_time: slot.end } })}
      slotBusy={slotBusy}
      removableTimeSlots={editing ? timeSlots.filter(slot => !displayedRows.some(row =>
        Number(row.day_of_week) >= 1 && timeInMinutes(row.start_time) < timeInMinutes(slot.end) &&
        timeInMinutes(row.end_time) > timeInMinutes(slot.start)
      )) : []}
      onRemoveTimeSlot={removeTimeSlot}
    />)}
    </div>
    {schedulePrint && <div className="print-only schedule-print">
      <header className="schedule-print-header">
        <div><p className="schedule-print-kicker">School MIS · Weekly timetable</p><h1>Class Schedule</h1></div>
        <div className="schedule-print-meta"><strong>{classFilter ? meta?.classes.find(row => String(row.id) === classFilter)?.name || 'Selected class' : 'All classes'}</strong><span>{schedulePrint.layout === 'grid' ? 'Weekly view' : 'Table view'} · Printed {formatDateTime(new Date())}</span></div>
      </header>
      {schedulePrint.layout === 'grid' ? <ScheduleGrid
        rows={schedulePrint.rows}
        days={visibleDays}
        timeSlots={getTimeSlots(schedulePrint.rows)}
        printMode
      /> : <table className="print-table schedule-print-table">
        <thead><tr>{['Day', 'Time', 'Grade / Class', 'Subject', 'Teacher', 'Room', 'Academic year', 'Status'].map(label => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
        <tbody>{schedulePrint.rows.map(row => <tr key={row.id}>
          <td>{days[row.day_of_week - 1] || '—'}</td>
          <td className="schedule-print-time">{formatTime(row.start_time)}–{formatTime(row.end_time)}</td>
          <td>{row.grade_level} · {row.class_name}</td><td>{row.subject_name}</td>
          <td>{row.teacher_name}</td><td>{row.room || '—'}</td><td>{row.academic_year}</td><td>{row.active ? 'Active' : 'Inactive'}</td><td className="print-other-column"></td>
        </tr>)}</tbody>
      </table>}
      {!schedulePrint.rows.length && <p className="schedule-print-empty">No schedules match this selection.</p>}
      <footer className="schedule-print-footer">Generated by School MIS · {schedulePrint.rows.length} timetable entries</footer>
    </div>}
    </>}
    {screen?.type === 'form' && <section className="space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setScreen(null)} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to class schedule"><ArrowLeft size={18} /></button>
        <div><h2 className="text-xl font-bold text-navy">{screen.row ? 'Edit' : 'Add'} weekly class schedule</h2><p className="text-sm text-slate-500">Enter the lesson, day, time, and room details.</p></div>
      </div>
      <div className="sims-panel">
      <ScheduleForm meta={meta} initial={screen.row || screen.initial || (editing ? { day_of_week: 1, start_time: timeSlots[0]?.start || '08:00', end_time: timeSlots[0]?.end || '09:00' } : null)} fixedClassId={editing ? classFilter : ''} onCancel={() => setScreen(null)} onSave={editing ? addOrUpdateDraft : save} />
      </div>
    </section>}
    {screen?.type === 'detail' && <DetailsPage title="Class schedule details" details={[
      ['Day', days[screen.row.day_of_week - 1]], ['Start time', formatTime(screen.row.start_time)],
      ['End time', formatTime(screen.row.end_time)], ['Class', `${screen.row.grade_level} · ${screen.row.class_name}`],
      ['Subject', `${screen.row.subject_name} (${screen.row.subject_code})`], ['Teacher', screen.row.teacher_name],
      ['Room', screen.row.room], ['Academic year', screen.row.academic_year],
      ['Status', screen.row.active ? 'Active' : 'Inactive'], ['Public ID', screen.row.id]
    ]} onBack={() => setScreen(null)} actions={<>
      {manageable && !screen.row.is_deleted && <button type="button" onClick={() => setScreen({ type: 'form', row: screen.row })} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">Edit</button>}
      {manageable && !screen.row.is_deleted && <button type="button" onClick={() => setConfirmHide(screen.row)} className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">Delete</button>}
    </>} />}
    {confirmHide && <ConfirmHideModal row={confirmHide} onCancel={() => setConfirmHide(null)} onConfirm={async () => { const rowToHide = confirmHide; setConfirmHide(null); await setHidden(rowToHide, true); }} />}
    {deleteDraft && <ConfirmDraftDelete row={deleteDraft} onCancel={() => setDeleteDraft(null)} onConfirm={() => {
      setDraftRows(current => current.filter(row => row.id !== deleteDraft.id));
      if (!deleteDraft._draftNew) setDraftDeletedIds(ids => [...ids, deleteDraft.id]);
      setDraftDirty(true);
      setDeleteDraft(null);
    }} />}
    {slotDialog && <TimeSlotModal busy={slotBusy} onCancel={() => setSlotDialog(false)} onSave={addTimeSlot} />}
  </div>;
}

function ScheduleGrid({ rows, days: visibleDays, timeSlots, onSelect, printMode = false, editing = false,
  draggedScheduleId = '', dropPreview = null, onDragStart, onDragEnd, onDragOver, onDrop, onDelete, onAdd, slotBusy = false, removableTimeSlots = [], onRemoveTimeSlot }) {
  const stickyHeaderTable = useRef(null);
  if (!rows.length && !timeSlots.length && !printMode) return <Empty text="No schedules match these filters." />;
  const colors = [
    'schedule-lesson-blue',
    'schedule-lesson-green',
    'schedule-lesson-purple',
    'schedule-lesson-amber',
    'schedule-lesson-rose'
  ];
  const dayHeaders = ['schedule-day-monday', 'schedule-day-tuesday', 'schedule-day-wednesday', 'schedule-day-thursday', 'schedule-day-friday', 'schedule-day-saturday', 'schedule-day-sunday'];

  const headerRow = <tr>
    <th scope="col" className="schedule-grid-time-heading sticky left-0 z-[1] w-36 border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">Time</th>
    {visibleDays.map(dayNumber => <th scope="col" key={dayNumber} className={`border-b border-r border-slate-300 px-3 py-3 text-center text-xs font-bold uppercase tracking-wide last:border-r-0 ${dayHeaders[dayNumber - 1]}`}>{days[dayNumber - 1]}</th>)}
  </tr>;

  return <div className={`schedule-grid-shell rounded-xl border border-slate-200 bg-white${printMode ? ' schedule-grid-print' : ''}`}>
    {!printMode && <div className="schedule-grid-sticky-header">
      <table ref={stickyHeaderTable} className="schedule-grid w-full min-w-[1400px] border-collapse text-left text-sm" aria-hidden="true">
        <thead>{headerRow}</thead>
      </table>
    </div>}
    <div className={`schedule-grid-scroll overflow-x-auto${printMode ? ' schedule-grid-print-scroll' : ''}`}
      onScroll={event => {
        if (stickyHeaderTable.current) stickyHeaderTable.current.style.transform = `translateX(-${event.currentTarget.scrollLeft}px)`;
      }}>
      <table className={`schedule-grid w-full border-collapse text-left text-sm${printMode ? ' schedule-grid-print-table' : ' min-w-[1400px]'}`}>
      <thead className={printMode ? '' : 'schedule-grid-screen-header'}>
        {headerRow}
      </thead>
      <tbody>
        {timeSlots.map(slot => <tr key={`${slot.start}-${slot.end}`}>
          <th scope="row" className="schedule-grid-time-heading sticky left-0 z-[1] w-36 border-b border-r border-slate-300 bg-slate-50 px-3 py-4 text-left align-top font-bold text-slate-800">
            <span className="block">{formatTime(slot.start)}–{formatTime(slot.end)}</span>
            {editing && removableTimeSlots.some(item => item.start === slot.start && item.end === slot.end) && <button type="button" onClick={() => onRemoveTimeSlot?.(slot)} disabled={slotBusy} className="mt-2 text-xs font-semibold text-red-700 hover:underline disabled:opacity-50">Remove empty time</button>}
          </th>
          {visibleDays.map(dayNumber => {
            const lessons = rows.filter(row =>
              Number(row.day_of_week) === dayNumber &&
              String(row.start_time).slice(0, 5) === slot.start
            );
            const canSwap = lessons.length === 1 && String(lessons[0].id) !== String(draggedScheduleId);
            const hasOverlap = editing && draggedScheduleId && !canSwap && rows.some(row =>
              String(row.id) !== String(draggedScheduleId) && Number(row.day_of_week) === dayNumber &&
              timeInMinutes(row.start_time) < timeInMinutes(slot.end) && timeInMinutes(row.end_time) > timeInMinutes(slot.start)
            );
            const isDropTarget = dropPreview?.dayNumber === dayNumber && dropPreview.start === slot.start;
            return <td key={dayNumber}
              onDragOver={event => {
                if (!editing) return;
                event.preventDefault();
                onDragOver?.(dayNumber, slot);
              }}
              onDrop={event => {
                if (!editing) return;
                event.preventDefault();
                const draggedRow = rows.find(row => String(row.id) === String(draggedScheduleId));
                if (draggedRow) onDrop?.(draggedRow, dayNumber, slot);
              }}
              className={`border-b border-r border-slate-300 p-2 align-top last:border-r-0${printMode ? '' : ' min-w-[190px]'}${editing && isDropTarget ? hasOverlap ? ' schedule-drop-conflict' : ' schedule-drop-target' : ''}`}>
              <div className="grid content-start gap-2">
                {!lessons.length && editing && <button type="button" onClick={() => onAdd?.(dayNumber, slot)} className="rounded border border-dashed border-slate-300 px-2 py-3 text-xs font-semibold text-slate-500 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">Add lesson</button>}
                {lessons.map((row, index) => {
                  const colorKey = row.subject_code || row.subject_name || String(index);
                  const colorIndex = [...colorKey].reduce((total, character) => total + character.charCodeAt(0), 0) % colors.length;
                  const content = <div className="schedule-lesson-content">
                    <span className="schedule-grid-subject">{row.subject_name}</span>
                    <span className="schedule-grid-detail"><b>Class</b><span>{row.grade_level} · {row.class_name}</span></span>
                    <span className="schedule-grid-detail"><b>Teacher</b><span>{row.teacher_name}</span></span>
                    {row.room && <span className="schedule-grid-detail"><b>Room</b><span>{row.room}</span></span>}
                    {printMode && <span className="schedule-grid-detail"><b>Year</b><span>{row.academic_year}</span></span>}
                    {!row.active && <span className="schedule-grid-inactive">Inactive</span>}
                  </div>;
                  const className = `schedule-grid-lesson ${colors[colorIndex]}`;
                  return printMode
                    ? <div key={row.id} className={className}>{content}</div>
                    : <div key={row.id} className="grid gap-1">
                      <button
                        type="button"
                        draggable={editing}
                        onDragStart={event => {
                          if (!editing) { event.preventDefault(); return; }
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', String(row.id));
                          onDragStart?.(row);
                        }}
                        onDragEnd={onDragEnd}
                        onClick={() => onSelect(row)}
                        aria-label={`${row.subject_name}, ${row.class_name}, ${days[dayNumber - 1]} ${formatTime(row.start_time)} to ${formatTime(row.end_time)}. ${editing ? 'Edit lesson.' : 'View details.'}`}
                        className={`${className} transition hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${editing ? 'schedule-lesson-editable' : ''} ${String(row.id) === String(draggedScheduleId) ? 'opacity-50' : ''}`}
                      >{content}{editing && <span className="mt-2 block text-[11px] font-semibold text-slate-700">Drag to move · select to edit</span>}</button>
                      {editing && <button type="button" onClick={() => onDelete?.(row)} className="flex items-center justify-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"><Trash2 size={13} /> Delete lesson</button>}
                    </div>;
                })}
              </div>
            </td>;
          })}
        </tr>)}
      </tbody>
    </table>
    </div>
  </div>;
}

function ConfirmHideModal({ row, onCancel, onConfirm }) {
  return <Modal title="Move class schedule to Trash?" onClose={onCancel}>
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Move the {days[row.day_of_week - 1]} {row.subject_name} schedule for {row.class_name} to Trash? It can be restored later or permanently deleted from Trash.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold">Cancel</button>
        <button type="button" onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Move to Trash</button>
      </div>
    </div>
  </Modal>;
}

function ScheduleForm({ meta, initial, fixedClassId = '', onCancel, onSave }) {
  const [classId, setClassId] = useState(initial?.class_id || fixedClassId || '');
  const [subjectId, setSubjectId] = useState(initial?.subject_id || '');
  const [teacherId, setTeacherId] = useState(initial?.teacher_id || '');
  const [day, setDay] = useState(String(initial?.day_of_week || 1));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const availableSubjects = useMemo(() => (meta?.classSubjects || [])
    .filter(item => String(item.class_id) === String(classId))
    .map(item => meta?.subjects.find(subject => subject.id === item.subject_id))
    .filter(Boolean), [meta?.classSubjects, meta?.subjects, classId]);
  const availableTeachers = useMemo(() => (meta?.teacherAssignments || [])
    .filter(item => String(item.class_id) === String(classId) && String(item.subject_id) === String(subjectId)), [meta?.teacherAssignments, classId, subjectId]);
  const submit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const errors = {};
    if (!classId) errors.class_id = 'Select a class.';
    if (!subjectId) errors.subject_id = 'Select a subject.';
    if (!teacherId) errors.teacher_id = 'Select an assigned teacher.';
    const startTime = form.elements.start_time.value;
    const endTime = form.elements.end_time.value;
    if (!startTime) errors.start_time = 'Enter a start time.';
    if (!endTime) errors.end_time = 'Enter an end time.';
    else if (startTime && endTime <= startTime) errors.end_time = 'End time must be after start time.';
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setFormError('');
      return;
    }
    setBusy(true);
    setFieldErrors({});
    setFormError('');
    const formData = new FormData(form);
    try {
      await onSave({
        class_id: classId,
        subject_id: subjectId,
        teacher_id: teacherId,
        day_of_week: Number(day),
        start_time: formData.get('start_time'),
        end_time: formData.get('end_time'),
        room: formData.get('room') || null
      });
    } catch (error) {
      if (error.message.includes('end time must be after')) setFieldErrors({ end_time: error.message });
      else if (error.message.includes('overlaps another schedule') || error.message.includes('overlaps another lesson')) {
        setFieldErrors({ start_time: 'The class, teacher, or room already has a schedule at this time.' });
      }
      else if (error.message.includes('actively assigned')) setFieldErrors({ teacher_id: error.message });
      else setFormError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return <form noValidate onSubmit={submit} onChange={event => {
    const key = event.target.name;
    if (key) setFieldErrors(current => ({ ...current, [key]: '' }));
  }} className="space-y-4">
    {!meta ? <Loading /> : <div className="grid gap-4 sm:grid-cols-2">
      {fixedClassId ? <div className="text-sm font-medium text-slate-700">Class<span className="mt-1.5 block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">{meta.classes.find(row => String(row.id) === String(classId))?.grade_level} · {meta.classes.find(row => String(row.id) === String(classId))?.name}</span></div> : <SearchableSelect
        name="class_id" label="Class" options={meta.classes}
        value={classId} onChange={value => { setClassId(value); setSubjectId(''); setTeacherId(''); setFieldErrors(current => ({ ...current, class_id: '', subject_id: '', teacher_id: '' })); }}
        getOptionLabel={row => `${row.grade_level} · ${row.name}`}
        getOptionSearchText={row => `${row.grade_level} ${row.name}`}
        placeholder="Search class..." required error={fieldErrors.class_id || ''}
      />}
      <SearchableSelect
        name="subject_id" label="Subject" options={availableSubjects}
        value={subjectId} onChange={value => { setSubjectId(value); setTeacherId(''); setFieldErrors(current => ({ ...current, subject_id: '', teacher_id: '' })); }}
        getOptionLabel={row => row.name}
        getOptionSearchText={row => `${row.name} ${row.code || ''}`}
        placeholder="Search subject..." required disabled={!classId} error={fieldErrors.subject_id || ''}
      />
      <SearchableSelect
        name="teacher_id" label="Assigned teacher" options={availableTeachers}
        value={teacherId} onChange={value => { setTeacherId(value); setFieldErrors(current => ({ ...current, teacher_id: '' })); }}
        getOptionId={row => row.teacher_id}
        getOptionLabel={row => row.teacher_name}
        getOptionSearchText={row => row.teacher_name}
        placeholder="Search teacher..." required disabled={!subjectId} error={fieldErrors.teacher_id || ''}
      />
      <SearchableSelect
        name="day_of_week" label="Day" options={days.map((label, index) => ({ id: String(index + 1), label }))}
        value={day} onChange={setDay} getOptionLabel={row => row.label}
        getOptionSearchText={row => row.label} placeholder="Search day..." required
      />
      <div><label className="text-sm font-medium">Start time<input name="start_time" type="time" required aria-invalid={Boolean(fieldErrors.start_time)} defaultValue={initial ? String(initial.start_time).slice(0, 5) : '08:00'} className={`mt-1.5 block w-full rounded-lg border px-3 py-2.5 ${fieldErrors.start_time ? 'border-red-400' : 'border-slate-300'}`} /></label>{fieldErrors.start_time && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{fieldErrors.start_time}</p>}</div>
      <div><label className="text-sm font-medium">End time<input name="end_time" type="time" required aria-invalid={Boolean(fieldErrors.end_time)} defaultValue={initial ? String(initial.end_time).slice(0, 5) : '09:00'} className={`mt-1.5 block w-full rounded-lg border px-3 py-2.5 ${fieldErrors.end_time ? 'border-red-400' : 'border-slate-300'}`} /></label>{fieldErrors.end_time && <p role="alert" className="mt-1 text-xs font-medium text-red-700">{fieldErrors.end_time}</p>}</div>
      <label className="text-sm font-medium sm:col-span-2">Room (optional)<input name="room" maxLength="80" aria-describedby="room-length-help" defaultValue={initial?.room || ''} className="mt-1.5 block w-full rounded-lg border px-3 py-2.5" /><span id="room-length-help" className="mt-1 block text-xs font-normal text-slate-500">Maximum 80 characters.</span></label>
    </div>}
    {formError && <p role="alert" className="text-sm font-medium text-red-700">{formError}</p>}
    <div className="flex justify-end gap-2 border-t pt-4"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2">Cancel</button><button type="submit" disabled={busy || !meta} className="primary-action rounded-lg px-4 py-2 font-semibold disabled:opacity-60">{busy ? 'Saving...' : 'Save schedule'}</button></div>
  </form>;
}

function ConfirmDraftDelete({ row, onCancel, onConfirm }) {
  return <Modal title="Remove lesson from timetable?" onClose={onCancel}>
    <p className="text-sm text-slate-600">{row._draftNew ? 'This new lesson will be discarded.' : `The ${row.subject_name} lesson will be moved to Trash when you save.`}</p>
    <div className="mt-6 flex justify-end gap-2">
      <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
      <button type="button" onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white">Remove lesson</button>
    </div>
  </Modal>;
}

function TimeSlotModal({ busy, onCancel, onSave }) {
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start_time = form.get('start_time');
    const end_time = form.get('end_time');
    if (!start_time || !end_time || end_time <= start_time) {
      setError('Choose an end time later than the start time.');
      return;
    }
    onSave({ start_time, end_time });
  }
  return <Modal title="Add a class time slot" onClose={onCancel}>
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-slate-600">This creates an empty row in the selected class timetable. You can add lessons to it by day.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Start time<input name="start_time" type="time" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        <label className="text-sm font-medium">End time<input name="end_time" type="time" required className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        <button type="submit" disabled={busy} className="primary-action rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">{busy ? 'Adding...' : 'Add time slot'}</button>
      </div>
    </form>
  </Modal>;
}
