import { useEffect, useState } from 'react'
import { deleteNotification, getNotifications, markAllNotificationsRead, markNotificationRead } from '../../lib/api.js'
import './notifications.css'

function notificationCategory(notification) {
  const kind = String(notification.kind || '').toLowerCase()
  if (kind.startsWith('new-product-') || notification.product_id && notification.related_type === 'product' && kind !== 'product-feedback') return 'products'
  if (kind.includes('product-feedback')) return 'feedback'
  if (notification.related_type === 'order') return 'orders'
  if (['transaction', 'sale'].includes(notification.related_type)) return 'transactions'
  return 'system'
}

const categoryDetails = {
  products: { label: 'New products', icon: '▦' },
  orders: { label: 'Customer orders', icon: '▤' },
  feedback: { label: 'Product feedback', icon: '★' },
  transactions: { label: 'Transactions', icon: '₱' },
  system: { label: 'System updates', icon: '◉' },
}

function NotificationCenter({ onOpenProduct, onOpenNotification, panel = false }) {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(panel)
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [readFilter, setReadFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('newest')
  const [search, setSearch] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [referenceTime] = useState(() => Date.now())
  const unreadCount = items.filter(item => !item.read_at).length
  const readCount = items.length - unreadCount
  const recentCount = items.filter(item => {
    if (!item.created_at) return false
    const age = referenceTime - new Date(item.created_at).getTime()
    return Number.isFinite(age) && age >= 0 && age <= 7 * 86400000
  }).length

  useEffect(() => {
    let active = true
    const load = () => getNotifications()
      .then(notifications => {
        if (active) {
          setItems(notifications)
          setError('')
        }
      })
      .catch(loadError => {
        if (active) setError(loadError.message)
      })
    load()
    const interval = window.setInterval(load, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  async function markRead(notification) {
    if (notification.read_at) return true
    try {
      await markNotificationRead(notification.id)
      setItems(current => current.map(item => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item))
      setError('')
      return true
    } catch (markError) {
      setError(markError.message)
      return false
    }
  }

  async function markAllRead() {
    if (!unreadCount || busyAction) return
    setBusyAction('mark-all')
    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setItems(current => current.map(item => item.read_at ? item : { ...item, read_at: readAt }))
      setError('')
    } catch (markError) {
      setError(markError.message)
    } finally {
      setBusyAction('')
    }
  }

  async function removeNotification(notification) {
    setBusyAction(`delete:${notification.id}`)
    try {
      await deleteNotification(notification.id)
      setItems(current => current.filter(item => item.id !== notification.id))
      setError('')
    } catch (deleteError) {
      setError(deleteError.message)
    } finally {
      setBusyAction('')
    }
  }

  async function openNotification(notification) {
    if (!await markRead(notification)) return
    setOpen(false)
    if (onOpenNotification) onOpenNotification(notification)
    else onOpenProduct?.(notification)
  }

  function actionLabel(notification) {
    if (notification.kind === 'new-product-staff') return 'See Product'
    if (notification.kind?.includes('product-feedback')) return 'View Feedback'
    if (['transaction', 'sale'].includes(notification.related_type)) return 'View Transaction'
    if (notification.related_type === 'order') return 'View order'
    if (notification.related_type === 'report') return 'View report'
    if (notification.product_id) return notification.kind === 'new-product-customer' ? 'Check this new product' : 'View product'
    return ''
  }

  const categories = [...new Set(items.map(notificationCategory))]
  const visibleItems = items.filter(item => {
    const matchesSearch = `${item.title || ''} ${item.message || ''} ${item.related_id || ''} ${item.product_id || ''}`.toLowerCase().includes(search.trim().toLowerCase())
    const matchesCategory = categoryFilter === 'all' || notificationCategory(item) === categoryFilter
    const matchesRead = readFilter === 'all' || (readFilter === 'unread' ? !item.read_at : Boolean(item.read_at))
    return matchesSearch && matchesCategory && matchesRead
  }).sort((first, second) => {
    const difference = new Date(first.created_at || 0) - new Date(second.created_at || 0)
    return sortOrder === 'newest' ? -difference : difference
  })

  return <div className={`notification-center${panel ? ' is-panel' : ''}`}>
    {!panel && <button className="notification-bell" type="button" aria-label={`Notifications, ${unreadCount} unread`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span aria-hidden="true">🔔</span>{unreadCount > 0 && <b>{unreadCount > 99 ? '99+' : unreadCount}</b>}
    </button>}
    {panel && <section className="staff-notifications-page">
      <header className="staff-notifications-heading"><div><p className="eyebrow">STAFF WORKSPACE</p><h2>Notifications</h2><p>Stay up to date with store activity and customer updates.</p></div><button type="button" onClick={markAllRead} disabled={!unreadCount || busyAction === 'mark-all'}>{busyAction === 'mark-all' ? 'Marking…' : 'Mark all as read'}</button></header>
      <div className="staff-notification-summary" aria-label="Notification summary">
        <article><span aria-hidden="true">◉</span><small>Total</small><strong>{items.length}</strong><span>All notifications</span></article>
        <article className="is-unread"><span aria-hidden="true">●</span><small>Unread</small><strong>{unreadCount}</strong><span>Needs attention</span></article>
        <article className="is-read"><span aria-hidden="true">✓</span><small>Read</small><strong>{readCount}</strong><span>Already reviewed</span></article>
        <article><span aria-hidden="true">◷</span><small>Recent</small><strong>{recentCount}</strong><span>Last 7 days</span></article>
      </div>
      <section className="staff-notification-browser" aria-label="Notification list">
        <div className="staff-notification-toolbar">
          <div className="staff-notification-category-tabs" role="group" aria-label="Filter by notification category">
            {[['all', 'All notifications', '◉'], ...categories.map(category => [category, categoryDetails[category].label, categoryDetails[category].icon])].map(([key, label, icon]) => <button type="button" key={key} className={categoryFilter === key ? 'active' : ''} aria-pressed={categoryFilter === key} onClick={() => setCategoryFilter(key)}><span aria-hidden="true">{icon}</span>{label}{key === 'all' && <b>{items.length}</b>}</button>)}
          </div>
          <div className="staff-notification-filters">
            <label>Search notifications<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title or message" /></label>
            <label>Read status<select value={readFilter} onChange={event => setReadFilter(event.target.value)}><option value="all">All notifications</option><option value="unread">Unread</option><option value="read">Read</option></select></label>
            <label>Sort by<select value={sortOrder} onChange={event => setSortOrder(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
          </div>
          <span className="staff-notification-results">{visibleItems.length} of {items.length} notifications</span>
        </div>
        {error && <p className="notification-error" role="alert">{error}</p>}
        {!items.length && !error ? <div className="staff-notification-empty"><span aria-hidden="true">♧</span><h3>You’re all caught up!</h3><p>New store updates and customer activity will appear here.</p></div>
          : visibleItems.length ? <div className="staff-notification-list">{visibleItems.map(item => {
            const category = notificationCategory(item)
            const detail = categoryDetails[category]
            const action = actionLabel(item)
            return <article className={`staff-notification-card${item.read_at ? ' is-read' : ' is-unread'}`} key={item.id}>
              <span className={`staff-notification-icon is-${category}`} aria-hidden="true">{item.image_url ? <img src={item.image_url} alt="" onError={event => { event.currentTarget.hidden = true }} /> : detail.icon}</span>
              <div className="staff-notification-card-content">
                <header><div><span className={`staff-notification-category is-${category}`}>{detail.label}</span><strong>{item.title}</strong></div>{!item.read_at && <span className="staff-notification-unread-label"><i />Unread</span>}</header>
                <p>{item.message}</p>
                <div className="staff-notification-card-footer"><time dateTime={item.created_at || undefined}>{item.created_at ? new Date(item.created_at).toLocaleString() : 'Date unavailable'}</time><div className="staff-notification-actions">
                  {action && <button type="button" className="staff-notification-primary" onClick={() => openNotification(item)} aria-label={`${action}: ${item.title}`}>{action}<span aria-hidden="true">↗</span></button>}
                  {!item.read_at && <button type="button" onClick={() => markRead(item)} disabled={busyAction === `delete:${item.id}`}>Mark read</button>}
                  <button type="button" className="staff-notification-dismiss" onClick={() => removeNotification(item)} disabled={busyAction === `delete:${item.id}`} aria-label={`Dismiss notification: ${item.title}`}>{busyAction === `delete:${item.id}` ? 'Removing…' : 'Dismiss'}</button>
                </div></div>
              </div>
            </article>
          })}</div> : <div className="staff-notification-empty"><span aria-hidden="true">⌕</span><h3>No matching notifications</h3><p>Try changing your search or filters.</p></div>}
      </section>
    </section>}
    {!panel && open && <section className="notification-popover" aria-label="Notifications">
      <header><div><p className="eyebrow">UPDATES</p><h2>Notifications <span>{unreadCount} unread</span></h2></div>{!panel && <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications">×</button>}</header>
      {error && <p className="notification-error" role="alert">{error}</p>}
      {!items.length && !error && <p className="notification-empty">You’re all caught up.</p>}
      <div className="notification-list">
        {items.map(item => <article className={`notification-item${item.read_at ? ' is-read' : ''}`} key={item.id}>
          {item.image_url && <img src={item.image_url} alt="" onError={event => { event.currentTarget.hidden = true }} />}
          <div className="notification-item-copy">
            <div className="notification-item-heading"><strong>{item.title}</strong>{!item.read_at && <i aria-label="Unread" />}</div>
            <p>{item.message}</p>
            <time dateTime={item.created_at}>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</time>
            <div className="notification-actions">
              {actionLabel(item) && <button type="button" onClick={() => openNotification(item)} aria-label={`${actionLabel(item)}: ${item.title}`}>{actionLabel(item)} <span aria-hidden="true">↗</span></button>}
              {!item.read_at && <button type="button" className="notification-mark-read" onClick={() => markRead(item)} aria-label={`Mark ${item.title} as read`}>Mark as read</button>}
            </div>
          </div>
        </article>)}
      </div>
    </section>}
  </div>
}

export default NotificationCenter
