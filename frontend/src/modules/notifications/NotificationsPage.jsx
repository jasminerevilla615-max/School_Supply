import { useCallback, useEffect, useMemo, useState } from 'react'
import { getNotifications, markAllNotificationsRead, markNotificationRead } from '../../lib/api.js'
import './notifications-page.css'

const pageSize = 8
const filters = [
  ['all', 'All Notifications'],
  ['unread', 'Unread'],
  ['read', 'Read'],
  ['low-stock', 'Low Stock'],
  ['customer-order', 'Customer Orders'],
  ['supplier-order', 'Supplier Orders'],
  ['inventory-updated', 'Inventory Updates'],
  ['daily-sales-report', 'Sales Reports'],
]

const notificationTypes = {
  'low-stock': { icon: '⚠', label: 'Low stock alert', tone: 'orange', destination: 'inventory' },
  'customer-order': { icon: '🛒', label: 'New customer order received', tone: 'blue', destination: 'orders' },
  'supplier-order': { icon: '🚚', label: 'Supplier order update', tone: 'green', destination: 'orders' },
  'inventory-updated': { icon: '▦', label: 'Inventory updated', tone: 'purple', destination: 'inventory' },
  'daily-sales-report': { icon: '▤', label: 'Daily sales report ready', tone: 'teal', destination: 'reports' },
}

function notificationType(item) {
  if (notificationTypes[item.kind]) return notificationTypes[item.kind]
  if (item.kind?.startsWith('new-product-')) return { icon: '▣', label: item.title, tone: 'blue', destination: 'products' }
  return { icon: '•', label: item.title, tone: 'blue', destination: null }
}

function relativeTime(value) {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

function NotificationsPage({ onNavigate }) {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [viewAll, setViewAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savingAll, setSavingAll] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const unreadCount = items.filter(item => !item.read_at).length

  const loadNotifications = useCallback(async (active = () => true) => {
    try {
      const notifications = await getNotifications()
      if (!active()) return
      setItems(notifications)
      setError('')
    } catch (loadError) {
      if (active()) setError(loadError.message)
    } finally {
      if (active()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => loadNotifications(() => active), 0)
    const interval = window.setInterval(() => loadNotifications(() => active), 15000)
    return () => {
      active = false
      window.clearTimeout(timer)
      window.clearInterval(interval)
    }
  }, [loadNotifications])

  const filteredItems = useMemo(() => items.filter(item => {
    if (filter === 'unread') return !item.read_at
    if (filter === 'read') return Boolean(item.read_at)
    return filter === 'all' || item.kind === filter
  }), [filter, items])
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize))
  const pageItems = viewAll ? filteredItems : filteredItems.slice((page - 1) * pageSize, page * pageSize)

  async function markRead(item) {
    if (item.read_at) return true
    try {
      await markNotificationRead(item.id)
      setItems(current => current.map(existing => existing.id === item.id ? { ...existing, read_at: new Date().toISOString() } : existing))
      setMessage('Notification marked as read.')
      setError('')
      return true
    } catch (markError) {
      setError(markError.message)
      return false
    }
  }

  async function markAllRead() {
    setSavingAll(true)
    setError('')
    setMessage('')
    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setItems(current => current.map(item => item.read_at ? item : { ...item, read_at: readAt }))
      setMessage('All notifications marked as read.')
    } catch (markError) {
      setError(markError.message)
    } finally {
      setSavingAll(false)
    }
  }

  async function openNotification(item) {
    if (!await markRead(item)) return
    const destination = notificationType(item).destination
    if (destination) onNavigate(destination)
  }

  function setActiveFilter(value) {
    setFilter(value)
    setPage(1)
    setViewAll(false)
    setMessage('')
  }

  return <section className="admin-notifications">
    <header className="admin-notifications-heading">
      <div>
        <p className="admin-notifications-eyebrow">NOTIFICATIONS</p>
        <div className="admin-notifications-title"><h2>Notifications</h2><span className="admin-notifications-count">{unreadCount} unread</span></div>
        <p className="admin-notifications-subtitle">Stay up to date with store activity and important updates.</p>
      </div>
      <div className="admin-notifications-actions">
        <button type="button" className="notifications-mark-all" onClick={markAllRead} disabled={!unreadCount || savingAll}>{savingAll ? 'Marking…' : 'Mark all as read'}</button>
        <button type="button" className="notifications-view-all" onClick={() => { setViewAll(value => !value); setPage(1) }}>{viewAll ? 'Show pages' : 'View all'}</button>
        <label className="notifications-filter-label"><span className="sr-only">Filter notifications</span>
          <select value={filter} onChange={event => setActiveFilter(event.target.value)} aria-label="Filter notifications">
            {filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
    </header>

    {error && <div className="admin-notifications-alert is-error" role="alert"><span>{error}</span><button type="button" onClick={() => loadNotifications()}>Try again</button></div>}
    {message && <p className="admin-notifications-alert is-success" role="status">{message}</p>}

    {loading && !items.length ? <div className="admin-notifications-state" role="status">Loading notifications…</div> : <>
      <div className="admin-notifications-list">
        {pageItems.map(item => {
          const type = notificationType(item)
          return <article className={`admin-notification-card${item.read_at ? ' is-read' : ' is-unread'}`} key={item.id}>
            <button type="button" className="admin-notification-open" onClick={() => openNotification(item)} aria-label={`${item.title}. ${item.message}. ${item.read_at ? 'Read' : 'Unread'}`}>
              <span className={`admin-notification-icon ${type.tone}`} aria-hidden="true">{type.icon}</span>
              <span className="admin-notification-copy">
                <strong>{item.title || type.label}</strong>
                <span className="admin-notification-message">{item.message}</span>
                <time dateTime={item.created_at} title={item.created_at ? new Date(item.created_at).toLocaleString() : ''}>{relativeTime(item.created_at)}</time>
              </span>
              <span className="admin-notification-end">
                {!item.read_at && <i className={`admin-notification-unread-dot ${type.tone}`} aria-label="Unread" />}
                <span className="admin-notification-arrow" aria-hidden="true">›</span>
              </span>
            </button>
            {!item.read_at && <button className="admin-notification-mark-one" type="button" onClick={() => markRead(item)}>Mark as read</button>}
          </article>
        })}
        {!pageItems.length && <div className="admin-notifications-state">
          <span aria-hidden="true">✓</span>
          <strong>{items.length ? 'No notifications match this filter.' : 'You’re all caught up.'}</strong>
          <small>{items.length ? 'Try another notification filter.' : 'New updates will appear here.'}</small>
        </div>}
      </div>
      {!viewAll && filteredItems.length > pageSize && <nav className="admin-notifications-pagination" aria-label="Notification pages">
        <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredItems.length)} of {filteredItems.length}</span>
        <button type="button" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</button>
        <span>Page {page} of {totalPages}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => setPage(current => current + 1)}>Next</button>
      </nav>}
    </>}
  </section>
}

export default NotificationsPage
