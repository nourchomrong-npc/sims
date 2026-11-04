export function dateInputValue(value) {
  if (!value) return '';
  const dateOnly = typeof value === 'string' ? value.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/) : null;
  if (dateOnly) return dateOnly[1];
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(value) {
  if (value == null || value === '') return '—';
  const dateOnly = typeof value === 'string' ? value.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/) : null;
  const date = dateOnly
    ? new Date(`${dateOnly[1]}T00:00:00`)
    : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

export function formatTime(value) {
  if (value == null || value === '') return '—';
  const range = typeof value === 'string' ? value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?\s*[–-]\s*([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/) : null;
  if (range) return `${formatTime(`${range[1]}:${range[2]}`)}–${formatTime(`${range[3]}:${range[4]}`)}`;
  const time = typeof value === 'string' ? value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/) : null;
  if (!time) return String(value);
  const [hours, minutes] = time.slice(1).map(Number);
  const date = new Date(2000, 0, 1, hours, minutes);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }).format(date);
}

export function formatDateTime(value) {
  if (value == null || value === '') return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

export function formatDisplayValue(key, value) {
  if (value == null || value === '') return '—';
  const normalizedKey = String(key).toLowerCase();
  if (normalizedKey === 'date' || normalizedKey.endsWith('_date') || normalizedKey === 'day') {
    return formatDate(value);
  }
  if (normalizedKey.endsWith('_at') || normalizedKey.includes('datetime') || normalizedKey === 'timestamp' ||
      (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && normalizedKey.includes('time'))) {
    return formatDateTime(value);
  }
  if (normalizedKey.endsWith('_time') || normalizedKey === 'time') {
    return formatTime(value);
  }
  return value;
}
