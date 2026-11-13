import { useEffect, useMemo, useState } from 'react'
import { deleteNotification, getNotifications, markAllNotificationsRead, markNotificationRead } from '../../lib/api.js'
import './customer-notifications.css'

const filters = [
  ['all', 'All'],
  ['orders', 'Orders'],
  ['payments', 'Payments'],
  ['account', 'Account'],
]

function notificationCategory(kind = '') {
  if (kind.startsWith('order-')) return 'orders'
  if (kind.startsWith('payment-')) return 'payments'
  if (kind.startsWith('account-')) return 'account'
  return 'all'
}

function notificationIcon(kind = '') {
  if (kind.startsWith('order-')) return '▣'
  if (kind.startsWith('payment-')) return '₱'
  if (kind.startsWith('account-')) return '♙'
  return '•'
}

function CustomerNotifications({ onOpenOrder, onViewAll, preview = false }) {
  const [items, setItems] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [savingAll, setSavingAll] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const unreadCount = items.filter(item => !item.read_at).length

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
      .finally(() => {
        if (active) setLoading(false)
      })
    load()
    const interval = window.setInterval(load, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const filteredItems = useMemo(
    () => items.filter(item => filter === 'all' || notificationCategory(item.kind) === filter),
    [filter, items],
  )
  const visibleItems = preview ? filteredItems.slice(0, 3) : filteredItems

  async function markRead(item) {
    if (item.read_at) return true
    try {
      await markNotificationRead(item.id)
      setItems(current => current.map(existing => existing.id === item.id
        ? { ...existing, read_at: new Date().toISOString() }
        : existing))
      setMessage('Notification marked as read.')
      setError('')
      return true
    } catch (saveError) {
      setError(saveError.message)
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
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingAll(false)
    }
  }

  async function removeNotification(item) {
    try {
      await deleteNotification(item.id)
      setItems(current => current.filter(existing => existing.id !== item.id))
      setMessage('Notification deleted.')
      setError('')
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  async function viewOrder(item) {
    if (!await markRead(item)) return
    onOpenOrder?.()
  }

  return <section className="customer-notifications" aria-label="Customer notifications">
    <header className="customer-notifications-heading">
      <div>
        <p className="eyebrow">YOUR UPDATES</p>
        <div className="customer-notifications-title">
          <h2>Notifications</h2>
          <span>{unreadCount} unread</span>
        </div>
        <p>Order progress and important account updates will appear here.</p>
      </div>
      {preview
        ? <button type="button" className="text-button" onClick={onViewAll}>View all <span aria-hidden="true">↗</span></button>
        : <button type="button" className="customer-notifications-mark-all" onClick={markAllRead} disabled={!unreadCount || savingAll}>
          {savingAll ? 'Marking…' : 'Mark all as read'}
        </button>}
    </header>

    {!preview && <div className="customer-notification-filters" role="group" aria-label="Filter notifications">
      {filters.map(([value, label]) => {
        const count = value === 'all' ? items.length : items.filter(item => notificationCategory(item.kind) === value).length
        return <button
          type="button"
          key={value}
          className={filter === value ? 'is-active' : ''}
          aria-pressed={filter === value}
          onClick={() => setFilter(value)}
        >
          {label}<span>{count}</span>
        </button>
      })}
    </div>}

    {error && <p className="customer-notifications-message is-error" role="alert">{error}</p>}
    {message && <p className="customer-notifications-message" role="status">{message}</p>}

    {loading && !items.length ? <p className="customer-notifications-empty" role="status">Loading your notifications…</p> : visibleItems.length ? (
      <div className={`customer-notification-list${preview ? ' is-preview' : ''}`}>
        {visibleItems.map(item => {
          const category = notificationCategory(item.kind)
          const createdAt = item.created_at ? new Date(item.created_at) : null
          return <article className={`customer-notification-card${item.read_at ? ' is-read' : ' is-unread'}`} key={item.id}>
            <span className={`customer-notification-icon is-${category}`} aria-hidden="true">{notificationIcon(item.kind)}</span>
            <div className="customer-notification-copy">
              <div className="customer-notification-title">
                <strong>{item.title}</strong>
                {!item.read_at && <span className="customer-notification-unread">Unread</span>}
              </div>
              <p>{item.message}</p>
              <time dateTime={item.created_at || undefined} title={createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : ''}>
                {createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : 'Time unavailable'}
              </time>
              {!preview && <div className="customer-notification-actions">
                {item.related_type === 'order' && <button type="button" onClick={() => viewOrder(item)}>View order</button>}
                {!item.read_at && <button type="button" onClick={() => markRead(item)}>Mark as read</button>}
                <button type="button" className="customer-notification-delete" onClick={() => removeNotification(item)}>Delete</button>
              </div>}
            </div>
          </article>
        })}
      </div>
    ) : <div className="customer-notifications-empty">
      <span aria-hidden="true">✓</span>
      <strong>{items.length ? 'No notifications in this category.' : 'You’re all caught up.'}</strong>
      <p>{items.length ? 'Try another filter to see your updates.' : 'Updates from your orders and account will appear here.'}</p>
    </div>}
    {preview && !loading && filteredItems.length > visibleItems.length && <button type="button" className="customer-notification-preview-more" onClick={onViewAll}>See all {filteredItems.length} notifications <span aria-hidden="true">→</span></button>}
  </section>
}

export default CustomerNotifications
