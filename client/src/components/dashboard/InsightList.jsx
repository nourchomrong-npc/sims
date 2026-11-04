import { useEffect, useState } from 'react';
import { ActionMenu, Empty, SearchSuggestions, fuzzySearchScore, useDebouncedValue } from '../ui.jsx';

export default function InsightList({ title, rows, empty, onSelect }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 500);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;
  const filteredRows = rows.filter(row => !debouncedSearch.trim() ||
    fuzzySearchScore(debouncedSearch,
      `${row.english_name} ${row.student_code} ${row.class_name || ''} ${row.subject || ''} ${row.reason || ''}`) !== null
  );
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const suggestions = filteredRows.map(row => ({
    key: `${row.id}-${row.subject || ''}`,
    value: `${row.english_name} ${row.student_code}`,
    label: row.english_name,
    description: [row.student_code, row.class_name, row.subject, `${row.value}%`].filter(Boolean).join(' · '),
    searchText: `${row.english_name} ${row.student_code} ${row.class_name || ''} ${row.subject || ''} ${row.reason || ''}`
  }));
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch]);
  return <section className="sims-panel min-w-0 space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold text-navy">{title}</h3><p className="mt-1 text-xs text-slate-500">{filteredRows.length} of {rows.length} flagged records</p></div>
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Review only</span>
    </div>
    {rows.length > 0 && <div className="flex flex-wrap items-end gap-2">
      <SearchSuggestions id={`insight-search-${title.toLowerCase().replaceAll(' ', '-')}`}
        label={`Search ${title.toLowerCase()}`} value={search} onChange={setSearch}
        suggestions={suggestions} pending={search.trim() !== debouncedSearch.trim()}
        placeholder="Search student, class, subject..." className="min-w-[220px] flex-1"
        inputClassName="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
      <button type="button" disabled={!search} onClick={() => setSearch('')} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear</button>
    </div>}
    {!filteredRows.length ? <Empty text={rows.length ? 'No indicators match this search.' : empty} /> : <>
      <div className="divide-y divide-slate-100">
        {pageRows.map(row => <article key={`${row.id}-${row.subject || ''}`} className="flex min-w-0 items-start justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-800">
              <span className="break-words">{row.english_name}</span>
              <span className="font-normal text-slate-500">{row.student_code}</span>
              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800">{row.value}%</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{row.reason}</p>
            <p className="mt-1 text-xs text-slate-500">{[row.class_name, row.grade_level, row.gender, row.subject].filter(Boolean).join(' · ')}</p>
          </div>
          <ActionMenu label={`Actions for ${row.english_name}`} items={[{ label: 'View details', onClick: () => onSelect(row) }]} />
        </article>)}
      </div>
      {pageCount > 1 && <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <span>Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredRows.length)} of {filteredRows.length} · <strong>Found: {filteredRows.length}</strong></span>
        <div className="flex items-center gap-2">
          <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage(page => page - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Previous</button>
          <span>Page {currentPage} of {pageCount}</span>
          <button type="button" disabled={currentPage === pageCount} onClick={() => setCurrentPage(page => page + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>}
    </>}
  </section>;
}
