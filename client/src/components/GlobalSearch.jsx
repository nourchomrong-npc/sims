import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { api } from '../services/api.js';
import { apiRoutes } from '../services/apiRoutes.js';
import { resultDescription, resultLabel } from './GlobalSearch.helpers.js';
import { useDebouncedValue } from './ui.jsx';

export default function GlobalSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedQuery = useDebouncedValue(query, 500);
  const flatResults = useMemo(() => results.flatMap(group => group.results), [results]);

  useEffect(() => {
    const term = debouncedQuery.trim();
    if (term.length < 2) {
      setResults([]);
      setError('');
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setError('');
    api(`${apiRoutes.search}?q=${encodeURIComponent(term)}`)
      .then(response => {
        if (active) setResults(response.groups || []);
      })
      .catch(requestError => {
        if (active) {
          setResults([]);
          setError(requestError.message || 'Search is unavailable.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [debouncedQuery]);

  function choose(result) {
    onSelect({ ...result, searchTerm: debouncedQuery.trim() });
    setQuery('');
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === 'ArrowDown' && flatResults.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => (index + 1) % flatResults.length);
    } else if (event.key === 'ArrowUp' && flatResults.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(index => (index <= 0 ? flatResults.length - 1 : index - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0 && flatResults[activeIndex]) {
      event.preventDefault();
      choose(flatResults[activeIndex]);
    }
  }

  const showResults = open && query.trim().length >= 2;
  let resultIndex = 0;
  return <div className="relative w-full max-w-[360px]">
    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400" />
    <input
      type="search"
      role="combobox"
      aria-label="Search school records"
      aria-autocomplete="list"
      aria-expanded={showResults}
      aria-controls="global-search-results"
      value={query}
      maxLength={100}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
      onFocus={() => setOpen(true)}
      onBlur={event => {
        if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={handleKeyDown}
      placeholder="Search students, classes, results..."
      className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
    />
    {showResults && <div id="global-search-results" role="listbox" aria-label="Search suggestions" className="absolute left-0 top-full z-[70] mt-2 max-h-[min(70vh,520px)] w-[min(92vw,520px)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white py-2 shadow-xl">
      {query.trim().length < 2 ? <p className="px-4 py-3 text-sm text-slate-600">Type at least 2 characters to search.</p>
        : loading ? <p className="flex items-center gap-2 px-4 py-3 text-sm text-slate-600"><LoaderCircle size={16} className="animate-spin" /> Searching records...</p>
          : error ? <p role="alert" className="px-4 py-3 text-sm text-red-700">{error}</p>
            : !flatResults.length ? <p className="px-4 py-3 text-sm text-slate-600">No matching records found.</p>
              : results.map(group => <section key={group.category} aria-label={group.category}>
                <h2 className="border-t border-slate-100 px-4 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-slate-500 first:border-0">{group.category}</h2>
                {group.results.map(result => {
                  const index = resultIndex++;
                  return <button
                    key={`${group.category}-${result.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => choose(result)}
                    className={`block w-full px-4 py-2 text-left ${index === activeIndex ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                  >
                    <span className="block truncate text-sm font-semibold text-slate-900">{resultLabel(result)}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-600">{resultDescription(result)}</span>
                  </button>;
                })}
              </section>)}
      {showResults && !loading && !error && flatResults.length > 0 && <p className="border-t border-slate-100 px-4 pt-2 text-xs text-slate-500">Use ↑ and ↓ to choose a result, then press Enter.</p>}
    </div>}
  </div>;
}
