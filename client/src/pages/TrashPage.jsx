import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api.js';
import { apiRoute, apiRoutes } from '../services/apiRoutes.js';
import { ActionMenu, Empty, ErrorPanel, formatDateTime, fuzzySearchScore, Loading, Modal, Pagination, PrintButton, SearchableSelect, SearchSuggestions, StatusBadge, useDebouncedValue, useLoad } from '../components/ui.jsx';

const entityLabels = {
  students: 'Student',
  teachers: 'Teacher',
  classes: 'Class',
  subjects: 'Subject',
  users: 'User',
  assessments: 'Assessment',
  'class-schedules': 'Class schedule'
};

export default function TrashPage({ user, onError, onSuccess }) {
  const canDeletePermanently = ['Admin', 'SuperAdmin'].includes(user.role);
  const [entityFilter, setEntityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [query, setQuery] = useState('');
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [sortOrder, setSortOrder] = useState('latest');
  const [currentPage, setCurrentPage] = useState(1);
  const [pendingAction, setPendingAction] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const debouncedQuery = useDebouncedValue(query, 500);
  const params = new URLSearchParams({ sort_order: sortOrder === 'oldest' ? 'oldest' : 'latest' });
  if (sortOrder === 'custom' && createdFrom) params.set('created_from', createdFrom);
  if (sortOrder === 'custom' && createdTo) params.set('created_to', createdTo);
  const { data, error, loading, reload } = useLoad(`${apiRoutes.trash.collection}?${params}`);
  const rows = Array.isArray(data) ? data : [];
  const statuses = useMemo(() => [...new Set(rows.map(row => row.status).filter(Boolean))].sort(), [rows]);
  const filteredRows = rows.filter(row =>
    (!entityFilter || row.entity === entityFilter) &&
    (!statusFilter || row.status === statusFilter) &&
    (!debouncedQuery.trim() || fuzzySearchScore(debouncedQuery,
      [row.display_name, row.description, row.status, entityLabels[row.entity], row.entity].join(' ')) !== null)
  );
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => { setCurrentPage(1); }, [entityFilter, statusFilter, debouncedQuery, createdFrom, createdTo, sortOrder]);
  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);
  const searchSuggestions = filteredRows.map(row => ({
    key: `${row.entity}-${row.id}`,
    value: row.display_name || '',
    label: row.display_name || entityLabels[row.entity] || row.entity,
    description: [entityLabels[row.entity], row.status, row.description].filter(Boolean).join(' · '),
    searchText: [row.display_name, row.description, row.status, entityLabels[row.entity], row.entity].join(' ')
  }));

  async function confirmAction() {
    if (!pendingAction || actionBusy) return;
    const { row, type } = pendingAction;
    setActionBusy(true);
    try {
      if (type === 'restore') {
        await api(apiRoute(apiRoutes.trash.restore, { entity: row.entity, id: row.id }), { method: 'POST' });
        onSuccess(`${entityLabels[row.entity]} restored to its original list.`);
      } else {
        await api(apiRoute(apiRoutes.trash.item, { entity: row.entity, id: row.id }), { method: 'DELETE' });
        onSuccess(`${entityLabels[row.entity]} permanently deleted.`);
      }
      setPendingAction(null);
      reload();
    } catch (requestError) {
      onError(requestError.message);
    } finally {
      setActionBusy(false);
    }
  }

  return <div className="space-y-4">
    <div className="no-print sims-toolbar sims-filter-grid">
      <SearchSuggestions id="trash-search" label="Search trash" value={query} onChange={setQuery}
        suggestions={searchSuggestions} pending={query.trim() !== debouncedQuery.trim()}
        placeholder="Search name, code, details..." inputClassName="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5" />
      <div className="min-w-[180px] flex-1">
        <SearchableSelect name="trash_type_filter" label="Record type"
          options={Object.entries(entityLabels).map(([id, label]) => ({ id, label }))} value={entityFilter}
          onChange={setEntityFilter} getOptionId={option => option.id} getOptionLabel={option => option.label}
          getOptionSearchText={option => `${option.label} ${option.id}`} placeholder="Search record types..."
          emptyValueLabel="All record types" noneLabel="All record types" debounceDelay={500} />
      </div>
      <div className="min-w-[180px] flex-1">
        <SearchableSelect name="trash_status_filter" label="Current status"
          options={statuses.map(status => ({ id: status, label: status }))} value={statusFilter}
          onChange={setStatusFilter} getOptionId={option => option.id} getOptionLabel={option => option.label}
          getOptionSearchText={option => option.label} placeholder="Search statuses..."
          emptyValueLabel="All statuses" noneLabel="All statuses" debounceDelay={500} />
      </div>
      <label className="min-w-[160px] text-sm font-medium text-slate-700">Date order
        <select value={sortOrder} onChange={event => { setSortOrder(event.target.value); if (event.target.value !== 'custom') { setCreatedFrom(''); setCreatedTo(''); } }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="latest">Latest</option><option value="oldest">Oldest</option><option value="custom">Custom range</option></select>
      </label>
      {sortOrder === 'custom' && <>
        <label className="min-w-[150px] text-sm font-medium text-slate-700">Moved from
          <input type="date" value={createdFrom} max={createdTo || undefined} onChange={event => setCreatedFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
        <label className="min-w-[150px] text-sm font-medium text-slate-700">Moved to
          <input type="date" value={createdTo} min={createdFrom || undefined} onChange={event => setCreatedTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        </label>
      </>}
      <p className="pb-2 text-sm text-slate-500">{filteredRows.length} trashed record{filteredRows.length === 1 ? '' : 's'}</p>
      <PrintButton label="Print trash" disabled={loading || Boolean(error) || !filteredRows.length} />
      <button type="button" disabled={!query && !entityFilter && !statusFilter && !createdFrom && !createdTo && sortOrder === 'latest'} onClick={() => {
        setQuery(''); setEntityFilter(''); setStatusFilter(''); setCreatedFrom(''); setCreatedTo(''); setSortOrder('latest');
      }} className="self-end rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear filters</button>
    </div>

    {error ? <div className="no-print"><ErrorPanel message={error} /></div> : loading ? <div className="no-print"><Loading /></div> : <div className="no-print sims-table-panel overflow-x-auto">
      <table className="sims-table w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-slate-200 text-xs uppercase tracking-wide">
          <tr>{['Type', 'Record', 'Details', 'Status', 'Moved to Trash', 'Actions'].map(label => <th key={label} className="px-4 py-3">{label}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {pageRows.map(row => <tr key={`${row.entity}-${row.id}`} className="hover:bg-slate-50/70">
            <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{entityLabels[row.entity] || row.entity}</td>
            <td className="px-4 py-3 font-medium text-slate-800">{row.display_name}</td>
            <td className="px-4 py-3 text-slate-600">{row.description || '—'}</td>
            <td className="px-4 py-3"><StatusBadge>{row.status || 'Unknown'}</StatusBadge></td>
            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(row.deleted_at)}</td>
            <td className="whitespace-nowrap px-4 py-3"><ActionMenu label={`Actions for ${row.display_name}`} items={[
              { label: 'Restore', onClick: () => setPendingAction({ row, type: 'restore' }), variant: 'success' },
              { label: 'Delete permanently', onClick: () => setPendingAction({ row, type: 'delete' }), visible: canDeletePermanently, variant: 'danger' }
            ]} /></td>
          </tr>)}
        </tbody>
      </table>
      {!filteredRows.length && <Empty text={rows.length ? 'No hidden records match these filters.' : 'Trash is empty.'} />}
      <Pagination page={currentPage} pageCount={pageCount} total={filteredRows.length} pageSize={pageSize} onPageChange={setCurrentPage} />
    </div>}
    {!error && !loading && <section className="print-only trash-print">
      <header>
        <h1 className="text-xl font-bold">Trash</h1>
        <p className="mb-3 text-sm text-slate-600">Printed {formatDateTime(new Date())} · {filteredRows.length} matching records</p>
      </header>
      {filteredRows.length ? <table className="print-table">
        <thead><tr>{['Type', 'Record', 'Details', 'Status', 'Moved to Trash'].map(label => <th key={label}>{label}</th>)}<th className="print-other-column">Other</th></tr></thead>
        <tbody>{filteredRows.map(row => <tr key={`${row.entity}-${row.id}`}>
          <td>{entityLabels[row.entity] || row.entity}</td><td>{row.display_name}</td>
          <td>{row.description || '—'}</td><td>{row.status || 'Unknown'}</td>
          <td>{formatDateTime(row.deleted_at)}</td><td className="print-other-column"></td>
        </tr>)}</tbody>
      </table> : <p>Trash is empty or no records match these filters.</p>}
    </section>}

    {pendingAction && <Modal title={pendingAction.type === 'restore' ? 'Restore this record?' : 'Permanently delete this record?'} onClose={() => !actionBusy && setPendingAction(null)}>
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{pendingAction.type === 'restore'
          ? <>Restore <strong>{pendingAction.row.display_name}</strong> to its original list?</>
          : <>This permanently removes <strong>{pendingAction.row.display_name}</strong> and cannot be undone. Records with linked school history will be blocked.</>}</p>
        <div className="flex justify-end gap-2">
          <button type="button" disabled={actionBusy} onClick={() => setPendingAction(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-60">Cancel</button>
          <button type="button" disabled={actionBusy} onClick={confirmAction} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${pendingAction.type === 'restore' ? 'bg-green-700 hover:bg-green-800' : 'bg-red-700 hover:bg-red-800'}`}>{actionBusy ? 'Processing...' : pendingAction.type === 'restore' ? 'Restore' : 'Delete permanently'}</button>
        </div>
      </div>
    </Modal>}
  </div>;
}
