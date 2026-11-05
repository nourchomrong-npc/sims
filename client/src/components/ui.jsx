import { isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, ChevronDown, LoaderCircle, MoreVertical, Printer, Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { api, useAcademicYearContext } from '../services/api.js';
import { dateInputValue, formatDate, formatDateTime, formatDisplayValue, formatTime } from './dateFormatting.js';
export { fuzzySearchScore } from './searchMatching.js';
import { fuzzySearchScore } from './searchMatching.js';

export { dateInputValue, formatDate, formatDateTime, formatDisplayValue, formatTime };

export function PrintButton({ label = 'Print', disabled = false, onClick = () => window.print() }) {
  return <button type="button" onClick={onClick} disabled={disabled}
    className="no-print inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
    <Printer size={16} />{label}
  </button>;
}

export const inputMaxLengths = {
  username: 80,
  password: 200,
  new_password: 200,
  confirm_password: 200,
  student_code: 30,
  teacher_code: 30,
  english_name: 150,
  khmer_name: 150,
  full_name: 150,
  place_of_birth: 255,
  address: 500,
  phone: 30,
  guardian_name: 150,
  guardian_phone: 30,
  email: 254,
  name: 120,
  grade_level: 50,
  description: 500,
  title: 150,
  label: 20,
  room: 80,
  comment: 255,
  note: 255
};

export function useDebouncedValue(value, delay = 500) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return debouncedValue;
}

export function SearchSuggestions({
  id,
  label,
  value,
  onChange,
  suggestions = [],
  pending = false,
  placeholder = 'Search...',
  maxSuggestions = 6,
  className = '',
  inputClassName = 'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500',
  inputProps = {}
}) {
  const [open, setOpen] = useState(false);
  const visible = open && Boolean(value.trim());
  const matchingSuggestions = useMemo(() => {
    if (!value.trim()) return suggestions;
    return suggestions.map((suggestion, index) => {
      const option = typeof suggestion === 'string'
        ? { key: suggestion, value: suggestion, label: suggestion }
        : suggestion;
      return {
        option,
        index,
        score: fuzzySearchScore(value, `${option.label || ''} ${option.description || ''} ${option.searchText || ''}`)
      };
    }).filter(match => match.score !== null)
      .sort((first, second) => first.score - second.score || first.index - second.index)
      .map(match => match.option);
  }, [suggestions, value]);
  return <div className={`relative min-w-0 ${className}`}>
    {label && <label htmlFor={id} className="block text-sm font-medium text-slate-700">{label}</label>}
    <input
      {...inputProps}
      id={id}
      type="search"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={visible}
      aria-controls={`${id}-suggestions`}
      maxLength={inputProps.maxLength || 100}
      value={value}
      placeholder={placeholder}
      onChange={event => { onChange(event.target.value); setOpen(true); }}
      onFocus={() => setOpen(true)}
      onBlur={event => {
        if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false);
      }}
      className={inputClassName}
    />
    {visible && <div
      id={`${id}-suggestions`}
      role="listbox"
      aria-label={`${label || 'Search'} suggestions`}
      className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
    >
      {pending
        ? <p role="status" className="px-3 py-2 text-sm font-normal text-slate-500">Searching...</p>
        : !matchingSuggestions.length
          ? <p className="px-3 py-2 text-sm font-normal text-slate-500">No matching suggestions.</p>
          : matchingSuggestions.slice(0, maxSuggestions).map((suggestion, index) => {
            const option = typeof suggestion === 'string'
              ? { key: suggestion, value: suggestion, label: suggestion }
              : suggestion;
            return <button
              key={option.key || `${option.value}-${index}`}
              type="button"
              role="option"
              aria-selected="false"
              onMouseDown={event => event.preventDefault()}
              onClick={() => { onChange(String(option.value ?? option.label)); setOpen(false); }}
              className="block w-full px-3 py-2 text-left hover:bg-blue-50"
            >
              <span className="block truncate text-sm font-semibold text-slate-800">{option.label}</span>
              {option.description && <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">{option.description}</span>}
            </button>;
          })}
    </div>}
  </div>;
}

export function SearchableSelect({
  name,
  label,
  options = [],
  value = '',
  onChange,
  getOptionLabel,
  getOptionSelectedLabel,
  getOptionId = option => option.id,
  getOptionDetails = () => [],
  getOptionSearchText,
  placeholder = 'Search by name or code...',
  emptyLabel = 'No matching options',
  emptyValueLabel = '',
  noneLabel,
  debounceDelay = 500,
  disabled = false,
  required = false,
  error = '',
  hideLabel = false
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const inputRef = useRef(null);
  const debouncedQuery = useDebouncedValue(query, debounceDelay);
  const selectedOption = options.find(option => String(getOptionId(option)) === String(value));
  const selectedLabel = selectedOption
    ? (getOptionSelectedLabel?.(selectedOption) || getOptionLabel(selectedOption))
    : emptyValueLabel;
  const selectedDetails = selectedOption ? getOptionDetails(selectedOption).filter(detail => detail.value) : [];
  const filteredOptions = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter(option => (getOptionSearchText?.(option) || getOptionLabel(option)).toLowerCase().includes(normalizedQuery));
  }, [options, debouncedQuery, getOptionLabel, getOptionSearchText]);

  useLayoutEffect(() => {
    if (!open || disabled) return undefined;

    function updateMenuPosition() {
      const bounds = inputRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const spacing = 4;
      const maxMenuHeight = 240;
      const availableAbove = Math.max(0, bounds.top - spacing);
      const availableBelow = Math.max(0, window.innerHeight - bounds.bottom - spacing);
      const opensAbove = availableBelow < maxMenuHeight && availableAbove > availableBelow;
      const availableHeight = opensAbove ? availableAbove : availableBelow;
      const width = Math.min(bounds.width, window.innerWidth - spacing * 2);

      setMenuPosition({
        left: Math.max(spacing, Math.min(bounds.left, window.innerWidth - width - spacing)),
        width,
        top: opensAbove ? undefined : bounds.bottom + spacing,
        bottom: opensAbove ? window.innerHeight - bounds.top + spacing : undefined,
        maxHeight: Math.min(maxMenuHeight, availableHeight)
      });
    }

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, disabled]);

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'Enter' && open && filteredOptions.length === 1) {
      event.preventDefault();
      onChange(String(getOptionId(filteredOptions[0])));
      setQuery('');
      setOpen(false);
    }
  }

  return <div className="relative text-sm font-medium text-slate-700">
    <label htmlFor={`searchable-${name}`} className={hideLabel ? 'sr-only' : undefined}>{label}</label>
    <input type="hidden" name={name} value={value || ''} data-searchable-select="true" required={required} />
    <div className="relative mt-1.5">
      {open && <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />}
      <input
        type="search"
        id={`searchable-${name}`}
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${name}-options`}
        value={open ? query : selectedLabel}
        placeholder={placeholder}
        maxLength={100}
        disabled={disabled}
        onClick={() => {
          if (!open) {
            setQuery('');
            setOpen(true);
          }
        }}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onBlur={event => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false);
        }}
        onKeyDown={handleKeyDown}
        onChange={event => {
          setQuery(event.target.value);
          onChange('');
          setOpen(true);
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className={`block w-full rounded-lg border bg-white py-2.5 pr-10 text-sm outline-none focus:border-blue-500 disabled:bg-slate-100 ${open ? 'cursor-text pl-9' : 'cursor-pointer pl-3'} ${error ? 'border-red-400' : 'border-slate-300'}`}
      />
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
    {error && <span id={`${name}-error`} role="alert" className="mt-1 block text-xs font-medium text-red-700">{error}</span>}
    {!open && selectedDetails.length > 0 && <dl className="mt-1.5 grid gap-x-3 gap-y-1 rounded-md bg-slate-50 px-2.5 py-2 text-xs sm:grid-cols-2">
      {selectedDetails.map(detail => <div key={detail.label} className="min-w-0">
        <dt className="inline font-medium text-slate-500">{detail.label}: </dt>
        <dd className="inline break-words font-normal text-slate-700">{detail.value}</dd>
      </div>)}
    </dl>}
    {open && !disabled && menuPosition && createPortal(<div
      id={`${name}-options`}
      role="listbox"
      aria-label={`${label} options`}
      className="fixed z-[100] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
      style={{
        left: menuPosition.left,
        width: menuPosition.width,
        top: menuPosition.top,
        bottom: menuPosition.bottom,
        maxHeight: menuPosition.maxHeight
      }}
    >
      <button type="button" role="option" aria-selected={!value} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(''); setQuery(''); setOpen(false); }} className="w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50">
        {noneLabel || (required ? 'Select...' : 'None')}
      </button>
      {filteredOptions.map(option => <button
        key={getOptionId(option)}
        type="button"
        role="option"
        aria-selected={String(getOptionId(option)) === String(value)}
        onMouseDown={event => event.preventDefault()}
        onClick={() => { onChange(String(getOptionId(option))); setQuery(''); setOpen(false); }}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm text-slate-800 hover:bg-blue-50"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{getOptionLabel(option)}</span>
          {getOptionDetails(option).filter(detail => detail.value).length > 0 && <span className="mt-1 grid gap-x-3 gap-y-0.5 text-xs font-normal text-slate-500 sm:grid-cols-2">
            {getOptionDetails(option).filter(detail => detail.value).map(detail => <span key={detail.label} className="min-w-0 break-words"><span className="font-medium text-slate-600">{detail.label}:</span> {detail.value}</span>)}
          </span>}
        </span>
        {String(getOptionId(option)) === String(value) && <Check size={15} className="mt-0.5 shrink-0 text-blue-700" />}
      </button>)}
      {!filteredOptions.length && <div className="px-3 py-2 text-sm text-slate-500">{emptyLabel}</div>}
    </div>, document.body)}
  </div>;
}

export function Notice({ message, type, onClose }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const timeout = setTimeout(() => {
      setVisible(false);
      onClose?.();
    }, 500);
    return () => clearTimeout(timeout);
  }, [message, type]);
  if (!visible) return null;

  return <div role={type === 'error' ? 'alert' : 'status'} aria-live={type === 'error' ? 'assertive' : 'polite'}
    className={`fixed right-4 top-4 z-[100] flex w-[calc(100%-2rem)] max-w-md items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-green-200 bg-green-50 text-green-700'}`}>
    {type === 'error' && <AlertCircle size={16} className="mt-0.5 shrink-0" />}
    <span className="flex-1">{message}</span>{onClose && <button onClick={onClose} aria-label="Dismiss"><X size={16} /></button>}
  </div>;
}

export function useLoad(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(null);
  const academicYearContext = useAcademicYearContext();
  const reload = useCallback(() => {
    request.current?.abort();
    if (!path) {
      request.current = null;
      setData(null);
      setError('');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    api(path, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(err => { if (err.name !== 'AbortError' && !controller.signal.aborted) setError(err.message); })
      .finally(() => {
        if (request.current === controller) setLoading(false);
      });
  }, [academicYearContext, path]);
  useEffect(() => {
    reload();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [reload]);
  return { data, error, loading, reload };
}

export function Loading() {
  return <div role="status" aria-live="polite" className="flex min-h-48 items-center justify-center gap-3 text-sm text-slate-500">
    <LoaderCircle size={20} className="animate-spin text-blue-600" />
    <span>Loading data…</span>
  </div>;
}

export function ErrorPanel({ message }) {
  return <div role="alert" className="border-l-2 border-red-400 bg-red-50/60 px-4 py-3 text-sm text-red-700">{message}</div>;
}

function statusColor(status) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (['active', 'present', 'passed', 'completed', 'complete'].includes(normalized)) {
    return { badge: 'bg-green-50 text-green-800 ring-green-200', select: 'border-green-200 bg-green-50 text-green-900 focus:border-green-500 focus:ring-green-100' };
  }
  if (['absent', 'inactive', 'withdrawn', 'failed', 'deleted', 'disabled'].includes(normalized)) {
    return { badge: 'bg-red-50 text-red-800 ring-red-200', select: 'border-red-200 bg-red-50 text-red-900 focus:border-red-500 focus:ring-red-100' };
  }
  if (['late', 'excused', 'on leave', 'pending', 'in progress'].includes(normalized)) {
    return { badge: 'bg-amber-50 text-amber-900 ring-amber-200', select: 'border-amber-200 bg-amber-50 text-amber-950 focus:border-amber-500 focus:ring-amber-100' };
  }
  if (['graduated', 'current'].includes(normalized)) {
    return { badge: 'bg-blue-50 text-blue-800 ring-blue-200', select: 'border-blue-200 bg-blue-50 text-blue-900 focus:border-blue-500 focus:ring-blue-100' };
  }
  return { badge: 'bg-slate-100 text-slate-700 ring-slate-200', select: 'border-slate-300 bg-white text-slate-800 focus:border-slate-500 focus:ring-slate-100' };
}

export function StatusBadge({ children }) {
  const color = statusColor(children);
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${color.badge}`}>{children}</span>;
}

export function StatusSelect({ value, options, onChange, disabled = false, label, placeholder }) {
  const color = statusColor(value);
  return <select
    aria-label={label}
    value={value}
    disabled={disabled}
    onChange={event => onChange(event.target.value)}
    className={`min-w-[132px] rounded-full border px-3 py-2 text-sm outline-none transition hover:brightness-[0.98] focus:ring-2 disabled:cursor-wait disabled:opacity-60 ${color.select} ${disabled ? 'disabled:bg-slate-50 disabled:text-slate-500' : ''}`}
  >
    {placeholder && <option value="">{placeholder}</option>}
    {options.map(option => <option key={option.value ?? option} value={option.value ?? option}>{option.label ?? option}</option>)}
  </select>;
}

export function Empty({ text }) {
  return <div className="py-8 text-center text-sm text-slate-400">{text}</div>;
}

export function Pagination({ page, pageCount, total, pageSize, onPageChange, loading = false }) {
  const firstRecord = total ? (page - 1) * pageSize + 1 : 0;
  const lastRecord = Math.min(page * pageSize, total);
  return <div aria-busy={loading} className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
    <span>Showing {firstRecord}–{lastRecord} of {total} <span className="ml-2 font-semibold text-slate-700">Found: {total}</span></span>
    <div className="flex items-center gap-2">
      <button type="button" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Previous</button>
      <span>Page {page} of {pageCount}</span>
      <button type="button" disabled={loading || page >= pageCount} onClick={() => onPageChange(page + 1)} className="rounded border px-3 py-1.5 disabled:opacity-40">Next</button>
    </div>
  </div>;
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const fn = event => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-xl sm:p-6">
      <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button onClick={onClose} aria-label="Close"><X size={19} /></button></div>
      {children}
    </div>
  </div>;
}

export function DetailsPage({ title, details, onBack, actions }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  return <section className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-50" aria-label="Back to list"><ArrowLeft size={18} /></button>
        <h2 className="text-xl font-bold text-navy">{title}</h2>
      </div>
      <div className="no-print flex flex-wrap gap-2"><PrintButton label="Print details" />{actions}</div>
    </div>
    <div className="sims-panel">
      <dl className="grid gap-x-8 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
        {details.map(([label, value]) => <div key={label} className="min-w-0 border-b border-slate-100 py-3 last:border-0 sm:border-b">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-sm font-medium leading-6 text-slate-900">
            {value === null || value === undefined || value === '' ? '—' : isValidElement(value) ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </dd>
        </div>)}
      </dl>
    </div>
  </section>;
}

export function DetailsModal({ title, details, onClose, actions }) {
  return <Modal title={title} onClose={onClose}>
    <dl className="grid gap-x-8 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0">
      {details.map(([label, value]) => <div key={label} className="min-w-0 border-b border-slate-100 py-3 last:border-0 sm:border-b">
        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
        <dd className="mt-1 break-words text-sm font-medium leading-6 text-slate-900">
          {value === null || value === undefined || value === '' ? '—' : isValidElement(value) ? value : typeof value === 'object' ? JSON.stringify(value) : String(value)}
        </dd>
      </div>)}
    </dl>
    {actions && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">{actions}</div>}
  </Modal>;
}

export function ActionMenu({ items, label = 'Open actions' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const container = useRef(null);
  const trigger = useRef(null);
  const menu = useRef(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const triggerRect = trigger.current.getBoundingClientRect();
    const menuRect = menu.current.getBoundingClientRect();
    setPosition({
      top: Math.max(8, Math.min(triggerRect.bottom + 4, window.innerHeight - menuRect.height - 8)),
      left: Math.max(8, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - 8))
    });
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = event => {
      if (!container.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') setOpen(false);
    };
    const closeMenu = () => setOpen(false);
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [open]);
  return <>
    <div ref={container} className="sims-action-menu inline-block text-left">
    <button ref={trigger} type="button" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} className="sims-action-trigger rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-800">
      <MoreVertical size={17} />
    </button>
    </div>
    {open && createPortal(<div ref={menu} role="menu" style={position} className="fixed z-[60] max-h-[70vh] min-w-44 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
      {items.filter(item => item && item.visible !== false).map(item => <button
        key={item.label}
        type="button"
        role="menuitem"
        disabled={item.disabled}
        onClick={() => { setOpen(false); item.onClick(); }}
        className={`block w-full px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${item.variant === 'danger' ? 'text-red-700 hover:bg-red-50' : item.variant === 'success' ? 'text-green-700 hover:bg-green-50' : item.variant === 'accent' ? 'text-violet-700 hover:bg-violet-50' : item.variant === 'warning' ? 'text-amber-800 hover:bg-amber-50' : 'text-slate-700 hover:bg-slate-50'}`}
      >{item.label}</button>)}
    </div>, document.body)}
  </>;
}

export function FieldInput({ label, type = 'text', name, required, defaultValue, min, max, minLength, maxLength, step, value, onChange }) {
  const maximum = maxLength === undefined ? inputMaxLengths[name] : maxLength;
  const normalizedDefaultValue = type === 'date' ? dateInputValue(defaultValue) : defaultValue;
  const normalizedValue = type === 'date' && value !== undefined ? dateInputValue(value) : value;
  return <div>
    <label className="block text-sm font-medium text-slate-700">{label}<input name={name} type={type} required={required} defaultValue={normalizedDefaultValue} min={min} max={max} minLength={minLength} maxLength={maximum} step={step} value={normalizedValue} onChange={onChange} aria-describedby={maximum ? `${name}-limit` : undefined} className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" /></label>
    {maximum && <p id={`${name}-limit`} className="mt-1 text-xs font-normal text-slate-500">Maximum {maximum} characters.</p>}
    {type === 'number' && (min !== undefined || max !== undefined) && <p className="mt-1 text-xs font-normal text-slate-500">Enter a number from {min ?? 'any'} to {max ?? 'any'}.</p>}
  </div>;
}
