import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createManagedUser, deleteStaffAccount, getCurrentUser, getMonitoringActivity, getMonitoringSessions, getMonitoringStats, getMonitoringUsers, updateStaffAccount, updateUserStatus } from '../../lib/api.js'
import ProductsPage from '../products/ProductsPage.jsx'
import AdminDashboard from './AdminDashboard.jsx'
import AdminProfilePage from './AdminProfilePage.jsx'
import AnalyticsPage from './AnalyticsPage.jsx'
import { CategoriesPanel, CustomersPanel, FeedbackPanel, InventoryPanel, OrdersPanel, SalesPanel } from './AdminDataPanels.jsx'
import NotificationCenter from '../notifications/NotificationCenter.jsx'
import NotificationsPage from '../notifications/NotificationsPage.jsx'
import ActivityLogsPage from './ActivityLogsPage.jsx'
import RoleBackButton from '../dashboard/components/RoleBackButton.jsx'

const sections = [
  ['dashboard', 'Dashboard', '▦'],
  ['profile', 'Admin Profile', '♙'],
  ['users', 'User Management', '♧'],
  ['staff', 'Staff Management', '♙'],
  ['customers', 'Customer Management', '♧'],
  ['products', 'Product Management', '▣'],
  ['categories', 'Categories', '▦'],
  ['inventory', 'Inventory Management', '▤'],
  ['orders', 'Customer Orders', '🛒'],
  ['feedback', 'Product Feedback', '★'],
  ['sales', 'Sales and Transactions', '▥'],
  ['reports', 'Reports and Analytics', '▧'],
  ['notifications', 'Notifications', '♧'],
  ['activity', 'Activity Logs', '◷'],
  ['sessions', 'Login History', '◷'],
]

function formatDuration(seconds = 0) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

function statusLabel(status) {
  return <span className={`monitor-status ${status}`}><i />{status}</span>
}

function UserManagementPanel({ onAddUser, onManageStaff }) {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const pageSize = 10

  const loadUsers = useCallback(() => {
    setLoading(true)
    setError('')
    getMonitoringUsers({ include_admin: 'true' })
      .then(setUsers)
      .catch(loadError => setError(loadError.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    let active = true
    getMonitoringUsers({ include_admin: 'true' })
      .then(nextUsers => {
        if (active) setUsers(nextUsers)
      })
      .catch(loadError => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return users.filter(user => {
      const matchesRole = !role || user.role === role
      const matchesStatus = !status || user.account_status === status
      const matchesSearch = !needle || [user.name, user.email, user.username]
        .some(value => String(value || '').toLowerCase().includes(needle))
      return matchesRole && matchesStatus && matchesSearch
    })
  }, [users, search, role, status])
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / pageSize))
  const visibleUsers = filteredUsers.slice((page - 1) * pageSize, page * pageSize)
  const firstPageButton = Math.max(1, Math.min(page - 2, pageCount - 4))
  const pageButtons = Array.from({ length: Math.min(pageCount, 5) }, (_, index) => firstPageButton + index)
  const rangeStart = filteredUsers.length ? (page - 1) * pageSize + 1 : 0
  const rangeEnd = Math.min(page * pageSize, filteredUsers.length)
  const roleCounts = users.reduce((counts, user) => {
    counts[user.role] = (counts[user.role] || 0) + 1
    return counts
  }, {})

  function updateFilter(setter, value) {
    setter(value)
    setPage(1)
  }

  function changeStatus(user, nextStatus) {
    setSavingId(user.id)
    setError('')
    setMessage('')
    updateUserStatus(user.email, nextStatus)
      .then(result => {
        setMessage(result.message)
        setPage(1)
        loadUsers()
      })
      .catch(updateError => setError(updateError.message))
      .finally(() => setSavingId(null))
  }

  return (
    <section className="admin-users-page" aria-labelledby="admin-users-title">
      <header className="admin-users-heading">
        <div>
          <h2 id="admin-users-title">User Management</h2>
          <p>Manage all system users, including admins, staff, and customers.</p>
        </div>
        <button type="button" className="admin-users-add" onClick={onAddUser}>＋ <span>Add User</span></button>
      </header>

      <div className="admin-users-summary" aria-label="User counts">
        {[
          ['total', 'Total Users', users.length, 'All registered users', '♧'],
          ['admin', 'Admin Users', roleCounts.admin || 0, 'System administrators', '♙'],
          ['staff', 'Staff Users', roleCounts.staff || 0, 'Staff members', '♙'],
          ['customer', 'Customer Users', roleCounts.customer || 0, 'Registered customers', '♧'],
        ].map(([kind, label, count, description, icon]) => (
          <article className={`admin-users-summary-card ${kind}`} key={kind}>
            <span className="admin-users-summary-icon" aria-hidden="true">{icon}</span>
            <div><span>{label}</span><strong>{loading || error ? '—' : count}</strong><small>{description}</small></div>
          </article>
        ))}
      </div>

      {error && <p className="admin-users-feedback is-error" role="alert">{error}</p>}
      {message && <p className="admin-users-feedback" role="status">{message}</p>}

      <div className="admin-users-toolbar">
        <label><span>Role</span><select value={role} onChange={event => updateFilter(setRole, event.target.value)}>
          <option value="">All Roles</option><option value="admin">Admin</option><option value="staff">Staff</option><option value="customer">Customer</option>
        </select></label>
        <label><span>Status</span><select value={status} onChange={event => updateFilter(setStatus, event.target.value)}>
          <option value="">All Statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
        </select></label>
        <label className="admin-users-search"><span className="admin-users-search-icon" aria-hidden="true">⌕</span><span className="sr-only">Search users by name, email, or username</span>
          <input type="search" value={search} onChange={event => updateFilter(setSearch, event.target.value)} placeholder="Search by name, email, or username..." />
        </label>
      </div>

      <div className="admin-users-table-card">
        <div className="admin-users-table-scroll">
          <table className="admin-users-table">
            <thead><tr><th scope="col">ID</th><th scope="col">Name</th><th scope="col">Email / Username</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Created At</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan="7" className="admin-users-empty">Loading users…</td></tr>}
              {!loading && !visibleUsers.length && <tr><td colSpan="7" className="admin-users-empty">No users match the selected filters.</td></tr>}
              {!loading && visibleUsers.map(user => {
                const displayName = String(user.name || user.username || '').trim() || '?'
                const initials = displayName.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
                const createdAt = user.created_at ? new Date(user.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
                return <tr key={user.id}>
                  <td>{user.id}</td>
                  <td><div className="admin-users-name"><span className="admin-users-avatar" aria-hidden="true">{initials}</span><span><strong>{displayName}</strong><small>{user.username}</small></span></div></td>
                  <td><span className="admin-users-email">{user.email}</span></td>
                  <td><span className={`admin-users-role ${user.role}`}>{user.role}</span></td>
                  <td><span className={`admin-users-status ${user.account_status}`}>{user.account_status}</span></td>
                  <td>{createdAt}</td>
                  <td>{user.role === 'staff'
                    ? <button type="button" className="admin-users-action" onClick={onManageStaff}>Manage</button>
                    : user.role === 'customer'
                      ? <select className="admin-users-status-select" aria-label={`Change status for ${user.name || user.username}`} value={user.account_status} disabled={savingId === user.id} onChange={event => changeStatus(user, event.target.value)}>
                        <option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
                      </select>
                      : <span aria-label="No actions available">—</span>}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
        <footer className="admin-users-table-footer">
          <span>{loading ? 'Loading users…' : `Showing ${rangeStart} to ${rangeEnd} of ${filteredUsers.length} users`}</span>
          <nav aria-label="User table pages">
            <button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(current => current - 1)}>‹</button>
            {pageButtons.map(pageNumber => <button type="button" key={pageNumber} aria-current={page === pageNumber ? 'page' : undefined} disabled={loading} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
            <button type="button" aria-label="Next page" disabled={page >= pageCount || loading} onClick={() => setPage(current => current + 1)}>›</button>
          </nav>
        </footer>
      </div>
    </section>
  )
}

function MonitoringPanel({ mode, initialRole = '', initialSearch = '' }) {
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [sessions, setSessions] = useState([])
  const [activity, setActivity] = useState([])
  const [filters, setFilters] = useState({ search: initialSearch, role: initialRole, status: '', action: '', start_date: '', end_date: '' })
  const setFilter = (key, value) => setFilters(current => ({ ...current, [key]: value }))
  const load = useCallback(() => {
    if (mode === 'dashboard') return Promise.all([getMonitoringStats(), getMonitoringUsers(), getMonitoringActivity()]).then(([nextStats, nextUsers, nextActivity]) => { setStats(nextStats); setUsers(nextUsers); setActivity(nextActivity) })
    if (mode === 'monitoring') return getMonitoringUsers(filters).then(setUsers)
    if (mode === 'sessions') return getMonitoringSessions(filters).then(setSessions)
    return getMonitoringActivity(filters).then(setActivity)
  }, [mode, filters])
  useEffect(() => { load(); const interval = window.setInterval(load, 5000); return () => window.clearInterval(interval) }, [load])

  if (mode === 'dashboard') return <section className="monitoring-view"><div className="metric-grid admin-metrics">{[['TOTAL USERS', stats?.total_users ?? 0], ['ONLINE USERS', stats?.online_users ?? 0], ['OFFLINE USERS', stats?.offline_users ?? 0], ['ACTIVE STAFF', stats?.active_staff ?? 0], ['ACTIVE CUSTOMERS', stats?.active_customers ?? 0], ["TODAY'S ACTIONS", stats?.total_actions ?? 0]].map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong><span>Live database count</span></div>)}</div><div className="monitoring-columns"><section className="admin-panel"><div className="admin-panel-heading"><h3>Online users</h3><span className="live-indicator">Live</span></div>{users.filter(user => user.current_status === 'online').map(user => <div className="monitor-row" key={user.id}><div><strong>{user.name || user.username}</strong><small>{user.role} · {user.username || user.email}</small></div><span>{formatDuration(user.current_session_duration)}</span></div>)}{!users.some(user => user.current_status === 'online') && <p className="monitor-empty">No customers or staff are currently online.</p>}</section><section className="admin-panel"><div className="admin-panel-heading"><h3>Live activity</h3><span className="live-indicator">5 sec</span></div>{activity.slice(0, 8).map(item => <div className="monitor-activity" key={item.id}><strong>{item.name || item.username} <small>{item.role}</small></strong><span>{item.description}</span><time>{item.created_at}</time></div>)}{!activity.length && <p className="monitor-empty">No activity has been recorded yet.</p>}</section></div></section>

  const title = mode === 'monitoring' ? 'User Monitoring' : mode === 'sessions' ? 'Login History' : 'Activity Logs'
  return <section className="monitoring-view"><div className="monitor-heading"><div><p className="eyebrow">LIVE ADMIN MONITORING</p><h2>{title}</h2></div><span className="live-indicator">Updates every 5 seconds</span></div><div className="monitor-filters"><input placeholder="Search name, username, or email" value={filters.search} onChange={event => setFilter('search', event.target.value)} />{mode === 'monitoring' && <><select value={filters.role} onChange={event => setFilter('role', event.target.value)}><option value="">All roles</option><option value="customer">Customer</option><option value="staff">Staff</option></select><select value={filters.status} onChange={event => setFilter('status', event.target.value)}><option value="">All statuses</option><option value="online">Online</option><option value="offline">Offline</option></select></>}{mode === 'activity' && <select value={filters.action} onChange={event => setFilter('action', event.target.value)}><option value="">All actions</option><option value="login">Login</option><option value="logout">Logout</option><option value="product_viewed">Product viewed</option><option value="product_updated">Product updated</option><option value="stock_updated">Stock updated</option></select>}{(mode === 'sessions' || mode === 'activity') && <><input type="date" value={filters.start_date} onChange={event => setFilter('start_date', event.target.value)} /><input type="date" value={filters.end_date} onChange={event => setFilter('end_date', event.target.value)} /></>}</div>{mode === 'monitoring' ? <div className="admin-panel admin-table-panel"><div className="table-scroll"><table className="dash-table monitoring-table"><thead><tr><th>User</th><th>Role</th><th>Account</th><th>Current</th><th>Last login</th><th>Session</th><th>Total hours</th><th>Logins</th><th>Actions</th></tr></thead><tbody>{users.map(user => <tr key={user.id}><td><strong>{user.name || user.username}</strong><small>{user.username} / {user.email}</small></td><td>{user.role}</td><td>{statusLabel(user.account_status)}</td><td>{statusLabel(user.current_status)}</td><td>{user.last_login || 'Never'}</td><td>{formatDuration(user.current_session_duration)}</td><td>{formatDuration(user.total_login_seconds)}</td><td>{user.login_count}</td><td>{user.action_count}</td></tr>)}</tbody></table></div></div> : mode === 'sessions' ? <div className="admin-panel admin-table-panel"><div className="table-scroll"><table className="dash-table monitoring-table"><thead><tr><th>User</th><th>Role</th><th>Login</th><th>Logout</th><th>Duration</th><th>Status</th></tr></thead><tbody>{sessions.map(item => <tr key={item.id}><td>{item.name || item.username}<small>{item.email}</small></td><td>{item.role}</td><td>{item.login_time}</td><td>{item.logout_time || 'Current'}</td><td>{formatDuration(item.session_duration)}</td><td>{statusLabel(item.session_status)}</td></tr>)}</tbody></table></div></div> : <div className="admin-panel admin-table-panel"><div className="table-scroll"><table className="dash-table monitoring-table"><thead><tr><th>Timestamp</th><th>User</th><th>Role</th><th>Action</th><th>Description</th><th>Module</th><th>IP</th></tr></thead><tbody>{activity.map(item => <tr key={item.id}><td>{item.created_at}</td><td>{item.name || item.username}<small>{item.email}</small></td><td>{item.role}</td><td>{item.action}</td><td>{item.description}</td><td>{item.module}</td><td>{item.ip_address || 'Unavailable'}</td></tr>)}</tbody></table></div></div>}</section>
}

function ManagedAccountForm({ onCreated }) {
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '', confirmPassword: '', position: 'Cashier' })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  function submit(event) {
    event.preventDefault()
    setMessage('')
    if (form.password !== form.confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }
    setBusy(true)
    createManagedUser(form.name, form.username, form.email, form.password, form.confirmPassword, form.position).then(result => {
      setMessage(result.message)
      setForm({ username: '', name: '', email: '', password: '', confirmPassword: '', position: 'Cashier' })
      setShowPassword(false)
      setShowConfirmPassword(false)
      onCreated?.()
    }).catch(error => setMessage(error.message)).finally(() => setBusy(false))
  }
  return (
    <form className="admin-panel admin-account-form" onSubmit={submit}>
      <div className="admin-panel-heading">
        <div><p className="eyebrow">AUTHORIZED ACCOUNT CREATION</p><h3>Create Staff account</h3></div>
      </div>
      <div className="admin-account-field"><label htmlFor="staff-full-name">Full Name</label><input id="staff-full-name" value={form.name} onChange={event => update('name', event.target.value)} autoComplete="name" required /></div>
      <div className="admin-account-field"><label htmlFor="staff-username">Username</label><input id="staff-username" value={form.username} onChange={event => update('username', event.target.value)} autoComplete="username" required /></div>
      <div className="admin-account-field"><label htmlFor="staff-email">Gmail / Email Address</label><input id="staff-email" type="email" value={form.email} onChange={event => update('email', event.target.value)} autoComplete="email" required /></div>
      <div className="admin-account-field"><label htmlFor="staff-password">Password</label><span className="admin-password-field"><input id="staff-password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={event => update('password', event.target.value)} autoComplete="new-password" minLength={8} required /><button type="button" className="admin-password-toggle" onClick={() => setShowPassword(show => !show)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} disabled={busy}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg></button></span></div>
      <div className="admin-account-field"><label htmlFor="staff-confirm-password">Confirm Password</label><span className="admin-password-field"><input id="staff-confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={event => update('confirmPassword', event.target.value)} autoComplete="new-password" minLength={8} required /><button type="button" className="admin-password-toggle" onClick={() => setShowConfirmPassword(show => !show)} aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} aria-pressed={showConfirmPassword} disabled={busy}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg></button></span></div>
      <div className="admin-account-field"><label htmlFor="staff-position">Store Position</label><select id="staff-position" value={form.position} onChange={event => update('position', event.target.value)}>{['Cashier', 'Inventory Staff', 'Sales Staff', 'Stock Clerk', 'Customer Service Staff', 'Store Assistant'].map(position => <option key={position}>{position}</option>)}</select></div>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? 'Creating...' : 'Create Staff account'} <span>→</span></button>
      {message && <p className="auth-message" role="status">{message}</p>}
    </form>
  )
}

function StaffManagementPanel() {
  const [staff, setStaff] = useState([])
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [resetAccount, setResetAccount] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const load = useCallback(() => getMonitoringUsers({ role: 'staff', search }).then(setStaff), [search])
  useEffect(() => { load() }, [load])
  function edit(account) {
    const username = window.prompt('Username', account.username)
    const name = username === null ? null : window.prompt('Full name', account.name)
    const email = name === null ? null : window.prompt('Gmail/Email', account.email)
    const position = email === null ? null : window.prompt('Store position', account.position || 'Cashier')
    if ([username, name, email, position].some(value => value === null)) return
    updateStaffAccount(account.email, { username, name, email, position }).then(result => { setMessage(result.message); load() }).catch(error => setMessage(error.message))
  }
  function changeStatus(account) {
    const status = window.prompt('Status: active, inactive, or suspended', account.account_status)
    if (!status) return
    updateUserStatus(account.email, status.toLowerCase()).then(result => { setMessage(result.message); load() }).catch(error => setMessage(error.message))
  }
  function changePassword(account) {
    setResetAccount(account)
    setNewPassword('')
    setConfirmPassword('')
  }
  function resetPassword(event) {
    event.preventDefault()
    if (!resetAccount) return
    if (newPassword !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }
    setResetBusy(true)
    setMessage('')
    updateStaffAccount(resetAccount.email, {
      username: resetAccount.username,
      name: resetAccount.name,
      email: resetAccount.email,
      position: resetAccount.position || 'Cashier',
      password: newPassword,
      confirm_password: confirmPassword,
    }).then(result => {
      setMessage(result.message)
      setResetAccount(null)
      setNewPassword('')
      setConfirmPassword('')
      load()
    }).catch(error => setMessage(error.message)).finally(() => setResetBusy(false))
  }
  function remove(account) {
    if (!window.confirm(`Delete ${account.username}?`)) return
    deleteStaffAccount(account.email).then(result => { setMessage(result.message); load() }).catch(error => setMessage(error.message))
  }
  return (
    <section className="admin-panel admin-table-panel">
      <div className="admin-panel-heading"><div><p className="eyebrow">STAFF ACCOUNT MANAGEMENT</p><h2>Staff accounts</h2></div></div>
      {message && <p className="auth-message" role="status">{message}</p>}
      {resetAccount && (
        <form className="admin-account-form" onSubmit={resetPassword}>
          <h3>Reset password for {resetAccount.name}</h3>
          <label>New Password<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
          <label>Confirm Password<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label>
          <button type="submit" disabled={resetBusy}>{resetBusy ? 'Updating...' : 'Save new password'}</button>
          <button type="button" onClick={() => setResetAccount(null)} disabled={resetBusy}>Cancel</button>
        </form>
      )}
      <input placeholder="Search username, name, or Gmail" value={search} onChange={event => setSearch(event.target.value)} />
      <div className="table-scroll"><table className="dash-table"><thead><tr><th>Username</th><th>Name</th><th>Gmail/Email</th><th>Position</th><th>Status</th><th>Actions</th></tr></thead><tbody>{staff.map(account => <tr key={account.id}><td>{account.username}</td><td>{account.name}</td><td>{account.email}</td><td>{account.position || 'Not set'}</td><td>{account.account_status}</td><td><button type="button" onClick={() => edit(account)}>Edit</button><button type="button" onClick={() => changePassword(account)}>Password</button><button type="button" onClick={() => changeStatus(account)}>Status</button><button type="button" onClick={() => remove(account)}>Delete</button></td></tr>)}</tbody></table></div>
    </section>
  )
}

function AdminPage({ username: initialUsername, email, onLogout }) {
  const [section, setSection] = useState('dashboard')
  const sectionHistory = useRef([])
  const [profile, setProfile] = useState({ username: initialUsername || '', email: email || '', name: '' })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    let active = true
    getCurrentUser().then(user => {
      if (active && user) setProfile({ username: user.username || '', email: user.email || email || '', name: user.name || '' })
    }).catch(error => console.error('Unable to load the administrator profile.', error))
    const timer = window.setInterval(() => setToday(new Date()), 60000)
    return () => { active = false; window.clearInterval(timer) }
  }, [email])
  const username = profile.username || profile.name
  const title = sections.find(([key]) => key === section)?.[1] || 'Dashboard'
  const openSection = nextSection => {
    if (nextSection !== section) {
      if (nextSection === 'dashboard') sectionHistory.current = []
      else sectionHistory.current.push(section)
    }
    setSection(nextSection)
    setMobileOpen(false)
  }
  const goBack = () => setSection(sectionHistory.current.pop() || 'dashboard')
  const searchUsers = event => {
    event.preventDefault()
    openSection('monitoring')
  }
  const renderContent = () => {
    if (section === 'dashboard') return <AdminDashboard onNavigate={openSection} />
    if (section === 'profile') return <AdminProfilePage onProfileUpdated={updatedProfile => setProfile(current => ({ ...current, ...updatedProfile }))} />
    if (section === 'products') return <ProductsPage />
    if (section === 'monitoring') return <MonitoringPanel key={`monitoring:${search}`} mode="monitoring" initialSearch={search} />
    if (section === 'sessions') return <MonitoringPanel mode="sessions" />
    if (section === 'activity') return <ActivityLogsPage />
    if (section === 'users') return <UserManagementPanel onAddUser={() => openSection('staff')} onManageStaff={() => openSection('staff')} />
    if (section === 'staff') return <><ManagedAccountForm /><StaffManagementPanel /></>
    if (section === 'customers') return <CustomersPanel />
    if (section === 'categories') return <CategoriesPanel />
    if (section === 'inventory') return <InventoryPanel />
    if (section === 'orders') return <OrdersPanel />
    if (section === 'feedback') return <FeedbackPanel />
    if (section === 'sales') return <SalesPanel />
    if (section === 'reports') return <AnalyticsPage />
    if (section === 'notifications') return <NotificationsPage onNavigate={openSection} />
    return <section className="admin-panel admin-detail"><p className="eyebrow">ADMIN PROFILE</p><h2>Your administrator profile.</h2><div className="profile-card"><span className="admin-avatar">{(profile.name || username || 'A').slice(0, 1).toUpperCase()}</span><strong>{profile.name || username || 'Administrator'}</strong><small>{profile.email || email}</small><small>Administrator</small></div></section>
  }
  const date = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(today)
  const day = new Intl.DateTimeFormat('en-PH', { weekday: 'long' }).format(today)
  return (
    <main className={`admin-console${sidebarCollapsed ? ' is-collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}>
      <button type="button" className="admin-mobile-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand"><span className="logo-mark">SS</span><span>School<span>Supply</span></span></div>
        <p className="admin-sidebar-caption">Administrator</p>
        <nav aria-label="Admin navigation">
          {sections.map(([key, label, icon]) => <button className={section === key ? 'active' : ''} key={key} onClick={() => openSection(key)} title={sidebarCollapsed ? label : undefined}><span aria-hidden="true">{icon}</span>{label}</button>)}
        </nav>
        <div className="admin-sidebar-footer">
          <span>Better Supplies<br />Brighter Futures</span>
          <button className="admin-logout" type="button" onClick={onLogout}><span aria-hidden="true">↪</span> Logout</button>
        </div>
      </aside>
      <section className="admin-content">
        <header className="admin-topbar">
          <button type="button" className="admin-menu-toggle" aria-label="Toggle navigation" aria-expanded={mobileOpen} onClick={() => {
            if (window.matchMedia('(max-width: 760px)').matches) setMobileOpen(open => !open)
            else setSidebarCollapsed(collapsed => !collapsed)
          }}>☰</button>
          <span className="admin-current-page">{title}</span>
          <form className="admin-global-search" role="search" onSubmit={searchUsers}><span aria-hidden="true">⌕</span><input aria-label="Search users" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search users by name, username, or email…" /></form>
          <span className="admin-topbar-spacer" />
          <div className="admin-date"><span>{date}</span><small>{day}</small></div>
          <NotificationCenter onOpenProduct={notification => {
            if (notification.related_type === 'order') openSection('orders')
            else if (notification.related_type === 'report') openSection('reports')
            else if (notification.product_id) window.location.hash = `/products?product_id=${notification.product_id}`
          }} />
          <button type="button" className="admin-topbar-profile" onClick={() => openSection('profile')} aria-label="Open admin profile">
            <span className="admin-avatar">{(profile.name || username || 'A').slice(0, 1).toUpperCase()}</span>
            <span><strong>{profile.name || username || 'Administrator'}</strong><small>Administrator</small></span>
            <span aria-hidden="true">⌄</span>
          </button>
        </header>
        <div className="admin-body">
          {section !== 'dashboard' && <RoleBackButton onClick={goBack} />}
          {renderContent()}
        </div>
      </section>
    </main>
  )
}

export default AdminPage
