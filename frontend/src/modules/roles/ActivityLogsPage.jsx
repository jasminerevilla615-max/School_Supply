import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAdminActivityLogs } from '../../lib/api.js'
import './activity-logs.css'

const pageSize = 10
const actionFilters = [
  ['login', 'Login / Logout'],
  ['create', 'Create / Add'],
  ['update', 'Update / Edit'],
  ['delete', 'Delete'],
  ['view', 'View'],
  ['order', 'Order'],
  ['inventory_update', 'Inventory Update'],
  ['report', 'Report Generation'],
  ['other', 'Other'],
]

function localDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function emptyFilters() {
  return { search: '', user_id: '', role: '', action: '', module: '', start_date: '', end_date: '' }
}

function dateRangeFor(preset) {
  const end = new Date()
  const start = new Date(end)
  if (preset === 'today') start.setHours(0, 0, 0, 0)
  if (preset === 'week') {
    start.setDate(end.getDate() - ((end.getDay() + 6) % 7))
    start.setHours(0, 0, 0, 0)
  }
  if (preset === 'month') {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }
  return { start_date: localDate(start), end_date: localDate(end) }
}

function roleLabel(role) {
  return ({ admin: 'Administrator', staff: 'Staff', customer: 'Customer' })[role] || 'Unknown'
}

function actionStyle(action) {
  const value = String(action || '').toLowerCase()
  if (value === 'login' || value === 'logout') return 'login'
  if (value.includes('delete')) return 'delete'
  if (value.includes('order')) return 'order'
  if (value.includes('report')) return 'report'
  if (value.includes('stock') || value.includes('inventory')) return 'inventory_update'
  if (value.includes('update') || value.includes('edit') || value.includes('change')) return 'update'
  if (value.includes('create') || value.includes('add') || value.includes('register')) return 'create'
  if (value.includes('view')) return 'view'
  return 'other'
}

function formatAction(action) {
  return String(action || 'Other').replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase())
}

function formatTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

function ActivityLogsPage() {
  const [draft, setDraft] = useState(emptyFilters)
  const [filters, setFilters] = useState(emptyFilters)
  const [datePreset, setDatePreset] = useState('all')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState({ sort_by: 'created_at', sort_direction: 'desc' })
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadLogs = useCallback(async (active = () => true) => {
    setLoading(true)
    setError('')
    try {
      const data = await getAdminActivityLogs({ ...filters, ...sort, page, page_size: pageSize })
      if (active()) setReport(data)
    } catch (loadError) {
      if (active()) setError(loadError.message)
    } finally {
      if (active()) setLoading(false)
    }
  }, [filters, page, sort])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => loadLogs(() => active), 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [loadLogs])

  const total = report?.total || 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const firstPageButton = Math.max(1, Math.min(page - 2, pageCount - 4))
  const pageButtons = useMemo(() => Array.from({ length: Math.min(pageCount, 5) }, (_, index) => firstPageButton + index), [firstPageButton, pageCount])
  const rangeStart = total ? (page - 1) * pageSize + 1 : 0
  const rangeEnd = Math.min(page * pageSize, total)
  const records = report?.items || []

  function updateDraft(key, value) {
    setDraft(current => ({ ...current, [key]: value }))
  }

  function selectDatePreset(preset) {
    setDatePreset(preset)
    if (preset === 'all') {
      setDraft(current => ({ ...current, start_date: '', end_date: '' }))
    } else if (preset !== 'custom') {
      setDraft(current => ({ ...current, ...dateRangeFor(preset) }))
    }
  }

  function applyFilters(event) {
    event.preventDefault()
    setPage(1)
    setFilters({ ...draft })
  }

  function resetFilters() {
    setDraft(emptyFilters())
    setFilters(emptyFilters())
    setDatePreset('all')
    setSort({ sort_by: 'created_at', sort_direction: 'desc' })
    setPage(1)
  }

  function changeSort(sortBy) {
    setSort(current => ({
      sort_by: sortBy,
      sort_direction: current.sort_by === sortBy && current.sort_direction === 'asc' ? 'desc' : 'asc',
    }))
    setPage(1)
  }

  function sortIndicator(sortBy) {
    if (sort.sort_by !== sortBy) return '↕'
    return sort.sort_direction === 'asc' ? '↑' : '↓'
  }

  return <section className="activity-logs-page" aria-labelledby="activity-logs-title">
    <header className="activity-logs-heading">
      <p className="activity-logs-eyebrow">ACTIVITY LOGS</p>
      <h2 id="activity-logs-title">Activity Logs</h2>
      <p>Track and monitor system activities, user actions, and important events.</p>
    </header>

    <form className="activity-logs-filters" onSubmit={applyFilters}>
      <label className="activity-log-search">
        <span aria-hidden="true">⌕</span>
        <span className="activity-log-sr-only">Search activity</span>
        <input type="search" value={draft.search} onChange={event => updateDraft('search', event.target.value)} placeholder="Search by user, action, description, or IP address…" />
      </label>
      <label><span>Date range</span><select value={datePreset} onChange={event => selectDatePreset(event.target.value)}>
        <option value="all">All dates</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom date range</option>
      </select></label>
      {datePreset === 'custom' && <>
        <label><span>From</span><input type="date" value={draft.start_date} onChange={event => updateDraft('start_date', event.target.value)} /></label>
        <label><span>To</span><input type="date" value={draft.end_date} onChange={event => updateDraft('end_date', event.target.value)} /></label>
      </>}
      <label><span>User</span><select value={draft.user_id} onChange={event => updateDraft('user_id', event.target.value)}>
        <option value="">All users</option>{report?.users?.map(user => <option key={user.id} value={user.id}>{user.name || user.username} ({roleLabel(user.role)})</option>)}
      </select></label>
      <label><span>Role</span><select value={draft.role} onChange={event => updateDraft('role', event.target.value)}>
        <option value="">All roles</option>{(report?.roles || []).map(role => <option value={role} key={role}>{roleLabel(role)}</option>)}
      </select></label>
      <label><span>Action</span><select value={draft.action} onChange={event => updateDraft('action', event.target.value)}>
        <option value="">All actions</option>{actionFilters.filter(([value]) => value === 'other' || report?.actions?.some(action => actionStyle(action) === value)).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select></label>
      <label><span>Module</span><select value={draft.module} onChange={event => updateDraft('module', event.target.value)}>
        <option value="">All modules</option>{report?.modules?.map(module => <option value={module} key={module}>{module}</option>)}
      </select></label>
      <div className="activity-logs-filter-actions"><button className="activity-logs-apply" type="submit" disabled={loading}>Apply filters</button><button type="button" className="activity-logs-reset" onClick={resetFilters}>Reset</button></div>
    </form>

    {error && <div className="activity-logs-error" role="alert"><span>{error}</span><button type="button" onClick={() => loadLogs()}>Try again</button></div>}

    <section className="activity-logs-table-card" aria-label="Activity records">
      <div className="activity-logs-table-topline"><strong>{total.toLocaleString()} {total === 1 ? 'activity' : 'activities'}</strong><button type="button" onClick={() => loadLogs()} disabled={loading}>↻ Refresh</button></div>
      <div className="activity-logs-table-scroll">
        <table className="activity-logs-table">
          <thead><tr>
            <th><button type="button" onClick={() => changeSort('created_at')}>Timestamp <i>{sortIndicator('created_at')}</i></button></th>
            <th><button type="button" onClick={() => changeSort('user')}>User <i>{sortIndicator('user')}</i></button></th>
            <th><button type="button" onClick={() => changeSort('role')}>Role <i>{sortIndicator('role')}</i></button></th>
            <th><button type="button" onClick={() => changeSort('action')}>Action <i>{sortIndicator('action')}</i></button></th>
            <th>Description</th>
            <th><button type="button" onClick={() => changeSort('module')}>Module <i>{sortIndicator('module')}</i></button></th>
            <th>IP Address</th>
          </tr></thead>
          <tbody>
            {loading && !report && <tr><td className="activity-logs-empty-row" colSpan="7">Loading activity records…</td></tr>}
            {!loading && !records.length && <tr><td className="activity-logs-empty-row" colSpan="7">{error ? 'Activity records could not be loaded.' : 'No activities match the selected filters.'}</td></tr>}
            {records.map(item => <tr key={item.id}>
              <td className="activity-logs-timestamp">{formatTimestamp(item.created_at)}</td>
              <td><div className="activity-logs-user"><span aria-hidden="true">{(item.name || item.username || '?').trim().slice(0, 1).toUpperCase()}</span><div><strong>{item.name || item.username || 'Deleted user'}</strong>{item.username && item.username !== item.name && <small>{item.username}</small>}</div></div></td>
              <td><span className={`activity-logs-role ${item.role}`}>{roleLabel(item.role)}</span></td>
              <td><span className={`activity-logs-action ${actionStyle(item.action)}`}>{formatAction(item.action)}</span></td>
              <td className="activity-logs-description">{item.description || '—'}</td>
              <td>{item.module || '—'}</td>
              <td className="activity-logs-ip">{item.ip_address || 'N/A'}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <footer className="activity-logs-table-footer">
        <span>{loading ? 'Loading activity…' : `Showing ${rangeStart} to ${rangeEnd} of ${total} entries`}</span>
        <nav aria-label="Activity log pages">
          <button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>‹</button>
          {pageButtons.map(pageNumber => <button type="button" key={pageNumber} aria-current={page === pageNumber ? 'page' : undefined} disabled={loading} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
          <button type="button" aria-label="Next page" disabled={page >= pageCount || loading} onClick={() => setPage(current => current + 1)}>›</button>
        </nav>
      </footer>
    </section>
  </section>
}

export default ActivityLogsPage
