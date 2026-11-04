import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Cloud, Database, Eye,
  LoaderCircle, RefreshCw, RotateCcw, XCircle
} from 'lucide-react';
import { api } from '../services/api.js';
import { apiRoute, apiRoutes } from '../services/apiRoutes.js';
import { Modal, Pagination } from './ui.jsx';

const modes = [
  ['local_only', 'LOCAL'],
  ['cloud_only', 'CLOUD'],
  ['hybrid', 'HYBRID']
];
const syncDirections = [
  {
    value: 'local_to_cloud',
    label: 'Local to Cloud',
    description: 'Send local database changes and queued student photos to the cloud.'
  },
  {
    value: 'cloud_to_local',
    label: 'Cloud to Local',
    description: 'Bring cloud database changes and referenced student photos to this server.'
  },
  {
    value: 'both',
    label: 'Both Ways',
    description: 'Synchronize changes and student photos in both directions.'
  }
];

function formatDate(value) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function historyDateBounds(period, from, to) {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (period === '30' || period === '60') {
    const start = new Date(now);
    start.setDate(start.getDate() - Number(period));
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (period === 'custom' && from && to) {
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }
  return { from: '', to: '' };
}

function historyFilterKey(filters) {
  return [filters.status, filters.database, filters.period, filters.from, filters.to].join('|');
}

function ConnectionCard({ title, icon: Icon, status, onTest, testing, testResult }) {
  const connected = status?.connected;
  return <div className="rounded-lg border border-slate-200 bg-white p-4">
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-2 font-semibold text-slate-800">
        <Icon size={18} className="text-blue-700" />{title}
      </div>
      {connected
        ? status?.syncReady === false
          ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle size={15} />Sync migration required</span>
          : <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={15} />Connected</span>
        : <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><XCircle size={15} />{status?.configured ? 'Unavailable' : 'Not configured'}</span>}
    </div>
    {status?.error && <p className={`mt-2 text-xs ${connected ? 'text-amber-800' : 'text-red-700'}`}>Connection check: {status.error}</p>}
    {testResult && <p role="status" className={`mt-2 text-xs ${testResult.connected ? 'text-emerald-700' : 'text-red-700'}`}>
      {testResult.connected ? `Connection test passed (${testResult.latencyMs} ms)` : `Connection test failed: ${testResult.error}`}
    </p>}
    <button type="button" onClick={onTest} disabled={testing} className="mt-3 inline-flex items-center gap-2 rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50">
      {testing ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}Test connection
    </button>
  </div>;
}

function Metric({ label, value, icon: Icon }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-500"><Icon size={14} />{label}</div>
    <div className="mt-1 text-xl font-bold text-slate-900">{value ?? 0}</div>
  </div>;
}

export default function SyncManagementPanel({ onError, onSuccess }) {
  const [dashboard, setDashboard] = useState(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncDirection, setSyncDirection] = useState('both');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [details, setDetails] = useState(null);
  const [connectionTests, setConnectionTests] = useState({});
  const [history, setHistory] = useState({ history: [], page: 1, pageSize: 10, total: 0, pageCount: 0 });
  const [historyPage, setHistoryPage] = useState(1);
  const [historyStatus, setHistoryStatus] = useState('all');
  const [historyDatabase, setHistoryDatabase] = useState('all');
  const [historyPeriod, setHistoryPeriod] = useState('all');
  const [historyFrom, setHistoryFrom] = useState('');
  const [historyTo, setHistoryTo] = useState('');
  const [loadedHistoryKey, setLoadedHistoryKey] = useState('all|all|all||');
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRequestId = useRef(0);
  const loadedHistoryPage = useRef(1);
  const loadedHistoryFiltersRef = useRef({
    status: 'all', database: 'all', period: 'all', from: '', to: ''
  });
  const historyFilters = {
    status: historyStatus,
    database: historyDatabase,
    period: historyPeriod,
    from: historyFrom,
    to: historyTo
  };
  const historyKey = historyFilterKey(historyFilters);
  const customRangeIncomplete = historyPeriod === 'custom' && (!historyFrom || !historyTo);
  const customRangeInvalid = historyPeriod === 'custom' && historyFrom && historyTo &&
    new Date(historyFrom).getTime() > new Date(historyTo).getTime();
  const historyFiltersReady = !customRangeIncomplete && !customRangeInvalid;

  const refresh = useCallback(async () => {
    try {
      const result = await api(apiRoutes.sync.status);
      setDashboard(result);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshHistory = useCallback(async (page, filters) => {
    if (filters.period === 'custom' && (!filters.from || !filters.to ||
        new Date(filters.from).getTime() > new Date(filters.to).getTime())) return;
    const requestId = ++historyRequestId.current;
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        status: filters.status,
        database: filters.database
      });
      const bounds = historyDateBounds(filters.period, filters.from, filters.to);
      if (bounds.from && bounds.to) {
        params.set('from', bounds.from);
        params.set('to', bounds.to);
      }
      const result = await api(`${apiRoutes.sync.history}?${params}`);
      if (requestId === historyRequestId.current) {
        setHistory(result);
        setHistoryPage(result.page);
        setLoadedHistoryKey(historyFilterKey(filters));
        loadedHistoryPage.current = result.page;
        loadedHistoryFiltersRef.current = filters;
      }
    } catch (requestError) {
      if (requestId === historyRequestId.current) {
        setError(requestError.message);
        setHistoryPage(loadedHistoryPage.current);
        setHistoryStatus(loadedHistoryFiltersRef.current.status);
        setHistoryDatabase(loadedHistoryFiltersRef.current.database);
        setHistoryPeriod(loadedHistoryFiltersRef.current.period);
        setHistoryFrom(loadedHistoryFiltersRef.current.from);
        setHistoryTo(loadedHistoryFiltersRef.current.to);
      }
    } finally {
      if (requestId === historyRequestId.current) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 20000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!historyFiltersReady) return undefined;
    refreshHistory(historyPage, historyFilters);
    const timer = window.setInterval(() => refreshHistory(historyPage, historyFilters), 20000);
    return () => window.clearInterval(timer);
  }, [historyPage, historyStatus, historyDatabase, historyPeriod, historyFrom, historyTo, historyFiltersReady, refreshHistory]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), refreshHistory(historyPage, historyFilters)]);
  }, [historyPage, historyStatus, historyDatabase, historyPeriod, historyFrom, historyTo, refresh, refreshHistory]);

  async function perform(action, busyKey, successMessage) {
    setBusy(busyKey);
    setError('');
    try {
      await action();
      await refreshAll();
      if (successMessage) onSuccess(successMessage);
    } catch (requestError) {
      setError(requestError.message);
      onError(requestError.message);
    } finally {
      setBusy('');
    }
  }

  function selectMode(event) {
    const mode = event.target.value;
    if (mode === dashboard?.mode) return;
    perform(
      () => api(apiRoutes.sync.mode, { method: 'PATCH', body: JSON.stringify({ mode }) }),
      'mode',
      `Database mode changed to ${modes.find(([value]) => value === mode)?.[1]}. Existing data was not moved or deleted.`
    );
  }

  function syncNow() {
    const selectedDirection = syncDirections.find(item => item.value === syncDirection);
    if (!selectedDirection) return;
    setSyncDialogOpen(false);
    perform(
      () => api(apiRoutes.sync.run, { method: 'POST', body: JSON.stringify({ direction: selectedDirection.value }) }),
      `run:${selectedDirection.value}`,
      `${selectedDirection.label} synchronization finished. Review pending items or conflicts below.`
    );
  }

  function retryFailed() {
    perform(
      () => api(apiRoutes.sync.retry, { method: 'POST' }),
      'retry',
      'Failed synchronization changes were queued for retry.'
    );
  }

  async function testConnection(database) {
    setBusy(`test:${database}`);
    setError('');
    try {
      const result = await api(apiRoutes.sync.connectionsTest, {
        method: 'POST',
        body: JSON.stringify({ database })
      });
      setConnectionTests(current => ({ ...current, [database]: result }));
    } catch (requestError) {
      setError(requestError.message);
      onError(requestError.message);
    } finally {
      setBusy('');
    }
  }

  function setAutomaticSync(enabled) {
    perform(
      () => api(apiRoutes.sync.automatic, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
      'automatic',
      enabled ? 'Automatic synchronization enabled.' : 'Automatic synchronization paused. Manual Sync Both Ways remains available.'
    );
  }

  async function showDetails(eventId) {
    setBusy(`details:${eventId}`);
    try {
      const result = await api(apiRoute(apiRoutes.sync.event, { id: eventId }));
      setDetails({ eventId, events: result.events });
    } catch (requestError) {
      setError(requestError.message);
      onError(requestError.message);
    } finally {
      setBusy('');
    }
  }

  function resolveConflict(conflict, resolution) {
    const label = resolution === 'keep_local' ? 'local database' : 'cloud database';
    if (!window.confirm(`Keep the ${label} version and replace the conflicting version in the other database?`)) return;
    perform(
      () => api(apiRoute(apiRoutes.sync.resolveConflict, { id: conflict.conflict_id }), {
        method: 'POST',
        body: JSON.stringify({ resolution })
      }),
      `conflict:${conflict.conflict_id}`,
      `Conflict resolved using the ${label} version.`
    );
  }

  const modeName = modes.find(([mode]) => mode === dashboard?.mode)?.[1] || dashboard?.mode || 'Unknown';
  const hybrid = dashboard?.mode === 'hybrid';
  if (loading && !dashboard) return <section className="sims-panel"><div className="flex items-center gap-2 text-sm text-slate-600"><LoaderCircle size={17} className="animate-spin" />Loading synchronization status…</div></section>;
  if (dashboard?.mode === 'cloud_only') return null;

  return <section className="sims-panel space-y-5" aria-labelledby="sync-management-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="sync-management-title" className="font-semibold text-slate-900">Database and photo synchronization</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          In Hybrid Mode, the local backend synchronizes database changes and student photos in both directions. Local photos upload to Supabase; cloud photos download to the local photo folder. Switching modes never copies or deletes records.
        </p>
      </div>
      <button type="button" onClick={refreshAll} disabled={busy !== ''} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
        <RefreshCw size={15} className={busy === '' ? '' : 'animate-spin'} />Refresh
      </button>
    </div>

    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}

    <div className="grid gap-3 sm:grid-cols-2">
      <ConnectionCard
        title="Local PostgreSQL"
        icon={Database}
        status={dashboard?.local}
        onTest={() => testConnection('local')}
        testing={busy === 'test:local'}
        testResult={connectionTests.local}
      />
      <ConnectionCard
        title="Cloud PostgreSQL"
        icon={Cloud}
        status={dashboard?.cloud}
        onTest={() => testConnection('cloud')}
        testing={busy === 'test:cloud'}
        testResult={connectionTests.cloud}
      />
    </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <label className="block text-sm font-semibold text-slate-700">
        Active database mode
        <select value={dashboard?.mode || ''} onChange={selectMode} disabled={busy !== ''} className="mt-1 block w-full max-w-sm rounded-lg border border-slate-300 bg-white px-3">
          {modes.map(([value, label]) => {
            const available = value === 'local_only' ? dashboard?.local?.connected
              : value === 'cloud_only' ? dashboard?.cloud?.connected
                : dashboard?.local?.connected && dashboard?.cloud?.connected &&
                  dashboard?.local?.syncReady && dashboard?.cloud?.syncReady;
            return <option key={value} value={value} disabled={!available && value !== dashboard?.mode}>{label}</option>;
          })}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setSyncDialogOpen(true)}
          disabled={!hybrid || !dashboard?.syncEnabled || busy !== ''}
          className="primary-action inline-flex items-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
        >
          {busy.startsWith('run:') ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}Sync Now
        </button>
        <button type="button" onClick={retryFailed} disabled={!hybrid || busy !== '' || !(dashboard?.local?.failed || dashboard?.cloud?.failed || dashboard?.photoStorage?.failed)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">
          {busy === 'retry' ? <LoaderCircle size={16} className="animate-spin" /> : <RotateCcw size={16} />}Retry failed
        </button>
      </div>
    </div>

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div>
        <p className="font-semibold text-slate-800">Automatic synchronization</p>
        <p className="text-sm text-slate-500">
          {dashboard?.syncEnabled === false
            ? 'Synchronization is disabled by the local backend configuration.'
            : hybrid
              ? dashboard?.autoEnabled ? 'The local backend synchronizes database changes and student photos in both directions automatically.' : 'Automatic sync is paused; manual direction-specific sync remains available.'
              : `Automatic synchronization is available in HYBRID mode. Current mode: ${modeName}.`}
        </p>
      </div>
      <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
        <input
          type="checkbox"
          checked={Boolean(dashboard?.syncEnabled && dashboard?.autoEnabled)}
          onChange={event => setAutomaticSync(event.target.checked)}
          disabled={!hybrid || !dashboard?.syncEnabled || busy !== ''}
          className="h-4 w-4 rounded border-slate-300 text-blue-700"
        />
        {dashboard?.syncEnabled === false ? 'Unavailable' : dashboard?.autoEnabled ? 'Enabled' : 'Disabled'}
      </label>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Pending uploads" value={hybrid ? dashboard?.local?.pending : 0} icon={ArrowUp} />
      <Metric label="Pending downloads" value={hybrid ? dashboard?.cloud?.pending : 0} icon={ArrowDown} />
      <Metric label="Failed changes" value={(dashboard?.local?.failed || 0) + (dashboard?.cloud?.failed || 0)} icon={AlertTriangle} />
      <Metric label="Unresolved conflicts" value={(dashboard?.local?.conflicts || 0) + (dashboard?.cloud?.conflicts || 0)} icon={AlertTriangle} />
    </div>
    {dashboard?.photoStorage?.enabled && <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
      <span className="font-semibold">Student photos:</span> pending upload {dashboard.photoStorage.pendingUploads}; pending download {dashboard.photoStorage.pendingDownloads};
      {' '}failed upload {dashboard.photoStorage.failedUploads}; failed download {dashboard.photoStorage.failedDownloads}.
    </p>}

    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
      <p><span className="font-semibold">Last successful sync:</span> {formatDate(dashboard?.lastSuccessfulSync)}</p>
      <p><span className="font-semibold">Sync status:</span> {dashboard?.syncRunning ? 'Running' : !dashboard?.syncEnabled ? 'Disabled by configuration' : hybrid && dashboard?.autoEnabled ? 'Automatic' : hybrid ? 'Manual / paused' : 'Paused by mode'}</p>
      {dashboard?.lastError && <p className="text-red-700"><span className="font-semibold">Last error:</span> {dashboard.lastError}</p>}
    </div>
    {dashboard?.syncRunning && <div role="status" className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">Synchronization is processing pending changes.</div>}
    {!hybrid && <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
      Synchronization is paused in {modeName}. Each database retains its own data; select Hybrid Mode to resume two-way synchronization.
    </p>}

    {(dashboard?.failedEvents?.length > 0) && <div>
      <h3 className="mb-2 font-semibold text-slate-800">Failed synchronization records</h3>
      <div className="sims-table-panel">
        <table className="sims-table w-full text-left text-sm">
          <thead><tr>{['Database','Record','Operation','Attempts','Error','Details'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {dashboard.failedEvents.map(item => <tr key={`${item.database}:${item.event_id}`}>
              <td className="px-3 py-2 capitalize">{item.database}</td>
              <td className="px-3 py-2">{item.table_name}</td>
              <td className="px-3 py-2">{item.operation}</td>
              <td className="px-3 py-2">{item.attempts}</td>
              <td className="px-3 py-2">{item.last_error || item.status}</td>
              <td className="px-3 py-2"><button type="button" onClick={() => showDetails(item.event_id)} aria-label={`View details for ${item.table_name} event`} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 text-xs font-semibold"><Eye size={14} />View</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>}

    {(dashboard?.conflicts?.filter(item => item.status === 'unresolved').length > 0) && <div>
      <h3 className="mb-2 font-semibold text-slate-800">Unresolved conflicts</h3>
      <div className="space-y-3">
        {dashboard.conflicts.filter(item => item.status === 'unresolved').map(conflict => <article key={conflict.conflict_id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-900">{conflict.table_name} · {conflict.database} database</p>
              <p className="mt-1 break-all font-mono text-xs text-slate-600">{JSON.stringify(conflict.record_key)}</p>
              <p className="mt-1 text-xs text-slate-500">Detected {formatDate(conflict.created_at)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy !== ''} onClick={() => resolveConflict(conflict, 'keep_local')} className="rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">Keep local</button>
              <button type="button" disabled={busy !== ''} onClick={() => resolveConflict(conflict, 'keep_cloud')} className="rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">Keep cloud</button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <pre className="max-h-40 overflow-auto rounded bg-white p-2 text-xs"><b>Current on {conflict.database}:</b>{'\n'}{JSON.stringify(conflict.local_data, null, 2)}</pre>
            <pre className="max-h-40 overflow-auto rounded bg-white p-2 text-xs"><b>Incoming change:</b>{'\n'}{JSON.stringify(conflict.remote_data, null, 2)}</pre>
          </div>
        </article>)}
      </div>
    </div>}

    {details && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-slate-800">Synchronization event details</h3>
        <button type="button" onClick={() => setDetails(null)} className="rounded border border-slate-300 bg-white px-2 text-xs font-semibold">Close</button>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-slate-500">{details.eventId}</p>
      {details.events.length
        ? <div className="mt-3 grid gap-3 lg:grid-cols-2">{details.events.map(item => <pre key={item.database} className="max-h-72 overflow-auto rounded bg-white p-3 text-xs">{item.database} database{'\n'}{JSON.stringify(item, null, 2)}</pre>)}</div>
        : <p className="mt-2 text-sm text-slate-600">The event is currently unavailable from the connected databases.</p>}
    </div>}

    <div>
      <h3 className="mb-2 font-semibold text-slate-800">Synchronization history</h3>
      <div className="no-print sims-filter-grid mb-3">
        <label htmlFor="sync-history-database" className="block min-w-0 text-sm font-medium text-slate-700">Database
          <select
            id="sync-history-database"
            value={historyDatabase}
            onChange={event => {
              setHistoryPage(1);
              setHistoryDatabase(event.target.value);
            }}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All databases</option>
            <option value="local">Local</option>
            <option value="cloud">Cloud</option>
          </select>
        </label>
        <label htmlFor="sync-history-status" className="block min-w-0 text-sm font-medium text-slate-700">Status
          <select
            id="sync-history-status"
            value={historyStatus}
            onChange={event => {
              setHistoryPage(1);
              setHistoryStatus(event.target.value);
            }}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="partial">Partial</option>
            <option value="failed">Failed / error</option>
            <option value="running">Running</option>
          </select>
        </label>
        <label htmlFor="sync-history-period" className="block min-w-0 text-sm font-medium text-slate-700">Date and time
          <select
            id="sync-history-period"
            value={historyPeriod}
            onChange={event => {
              setHistoryPage(1);
              setHistoryPeriod(event.target.value);
            }}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="30">Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>
        {historyPeriod === 'custom' && <>
          <label htmlFor="sync-history-from" className="block min-w-0 text-sm font-medium text-slate-700">From
            <input
              id="sync-history-from"
              type="datetime-local"
              value={historyFrom}
              max={historyTo || undefined}
              onChange={event => {
                setHistoryPage(1);
                setHistoryFrom(event.target.value);
              }}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
            />
          </label>
          <label htmlFor="sync-history-to" className="block min-w-0 text-sm font-medium text-slate-700">To
            <input
              id="sync-history-to"
              type="datetime-local"
              value={historyTo}
              min={historyFrom || undefined}
              onChange={event => {
                setHistoryPage(1);
                setHistoryTo(event.target.value);
              }}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"
            />
          </label>
        </>}
        <button type="button" disabled={historyStatus === 'all' && historyDatabase === 'all' && historyPeriod === 'all'} onClick={() => {
          setHistoryPage(1);
          setHistoryStatus('all');
          setHistoryDatabase('all');
          setHistoryPeriod('all');
          setHistoryFrom('');
          setHistoryTo('');
        }} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Clear filters</button>
      </div>
      {customRangeIncomplete && <p className="mb-2 text-sm text-slate-600">Choose both date and time values to filter the custom range.</p>}
      {customRangeInvalid && <p role="alert" className="mb-2 text-sm text-red-700">The end date and time must be on or after the start.</p>}
      <div className="sims-table-panel"><div className="relative" aria-busy={historyLoading && (historyPage !== history.page || historyKey !== loadedHistoryKey)}>
          <table className="sims-table w-full text-left text-sm">
            <thead><tr>{['Started','Database','Direction','Status','Changes','Conflicts'].map(label => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{!historyFiltersReady
              ? <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Choose a valid start and end date and time to apply the custom range.</td></tr>
              : history.history.length ? history.history.map(item => <tr key={`${item.database}:${item.id}`}>
              <td className="px-3 py-2">{formatDate(item.started_at)}</td>
              <td className="px-3 py-2 capitalize">{item.database}</td>
              <td className="px-3 py-2">{item.direction.replaceAll('_', ' ')}</td>
              <td className="px-3 py-2">{item.status}</td>
              <td className="px-3 py-2">{item.sent_count}</td>
              <td className="px-3 py-2">{item.conflict_count}</td>
            </tr>) : <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">{historyLoading
              ? <span role="status" className="inline-flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />Loading synchronization history…</span>
              : historyStatus === 'all' && historyDatabase === 'all' && historyPeriod === 'all'
                ? 'No synchronization runs have been recorded.'
                : 'No synchronization runs match these filters.'}</td></tr>}</tbody>
          </table>
          {historyLoading && (historyPage !== history.page || historyKey !== loadedHistoryKey) && history.history.length > 0 && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <span role="status" className="inline-flex items-center gap-2 rounded bg-white px-3 py-2 text-sm text-slate-600 shadow"><LoaderCircle size={16} className="animate-spin" />Loading synchronization history…</span>
          </div>}
        </div>{historyFiltersReady && history.total > history.pageSize && <Pagination
          page={history.page}
          pageCount={history.pageCount}
          total={history.total}
          pageSize={history.pageSize}
          onPageChange={setHistoryPage}
          loading={historyLoading && (historyPage !== history.page || historyKey !== loadedHistoryKey)}
        />}</div>
    </div>
    {syncDialogOpen && <Modal title="Confirm synchronization" onClose={() => setSyncDialogOpen(false)}>
      <p className="mb-4 text-sm text-slate-600">Choose what to sync, then confirm to start. Student photos are included when local photo storage is enabled.</p>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-slate-800">Sync direction</legend>
        {syncDirections.map(option => <label
          key={option.value}
          className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${syncDirection === option.value ? 'border-blue-600 bg-blue-50' : 'border-slate-200 bg-white'}`}
        >
          <input
            type="radio"
            name="sync-direction"
            value={option.value}
            checked={syncDirection === option.value}
            onChange={() => setSyncDirection(option.value)}
            className="mt-1 h-4 w-4 text-blue-700"
          />
          <span>
            <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
            <span className="mt-0.5 block text-sm text-slate-600">{option.description}</span>
          </span>
        </label>)}
      </fieldset>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setSyncDialogOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button>
        <button type="button" onClick={syncNow} className="primary-action inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold">
          <RefreshCw size={16} />Confirm and Sync
        </button>
      </div>
    </Modal>}
  </section>;
}
