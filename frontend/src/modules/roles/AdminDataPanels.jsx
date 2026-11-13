import { useEffect, useState } from 'react'
import { categories as categoryLabels } from '../catalog/data.js'
import { createCategory, deleteCategory, getAdminSettings, getCategories, getMonitoringUsers, getOrderDetails, getOrders, getProductFeedback, getProducts, getSales, updateCategory, updateOrder, updateOrderPayment } from '../../lib/api.js'
import ProductPhoto from '../products/ProductPhoto.jsx'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(date)
}

function DataPanel({ title, description, headings, rows, loading, error, empty }) {
  return (
    <section className="admin-data-page">
      {(title || description) && <header className="admin-data-heading"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div></header>}
      {error && <p className="admin-overview-error" role="alert">{error}</p>}
      <section className="admin-overview-panel admin-table-panel">
        <div className="admin-overview-table-scroll">
          <table className="admin-overview-table">
            <thead><tr>{headings.map(item => <th key={item}>{item}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={headings.length} className="admin-empty-cell">Loading…</td></tr> : rows.length ? rows.map((row, index) => <tr key={row.key ?? index}>{row.cells.map((cell, cellIndex) => <td key={`${row.key ?? index}-${cellIndex}`}>{cell}</td>)}</tr>) : <tr><td colSpan={headings.length} className="admin-empty-cell">{empty}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function CategoriesPanel() {
  const [items, setItems] = useState([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  function load() {
    return getCategories().then(setItems).catch(loadError => setError(loadError.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    createCategory(name, description).then(result => {
      setMessage(result.message)
      setName('')
      setDescription('')
      return load()
    }).catch(actionError => setError(actionError.message)).finally(() => setBusy(false))
  }
  function edit(item) {
    const nextName = window.prompt('Category name', item.name)
    if (nextName === null) return
    const nextDescription = window.prompt('Description', item.description || '')
    if (nextDescription === null) return
    updateCategory(item.id, nextName, nextDescription).then(result => {
      setMessage(result.message)
      return load()
    }).catch(actionError => setError(actionError.message))
  }
  function remove(item) {
    if (!window.confirm(`Delete category “${item.name}”?`)) return
    deleteCategory(item.id).then(result => {
      setMessage(result.message)
      return load()
    }).catch(actionError => setError(actionError.message))
  }
  const rows = items.map(item => ({ key: item.id, cells: [item.name, item.description || '—', item.created_at ? formatDate(item.created_at) : '—', <span className="admin-row-actions" key="actions"><button type="button" onClick={() => edit(item)}>Edit</button><button type="button" onClick={() => remove(item)}>Delete</button></span>] }))
  return (
    <section className="admin-data-page">
      <header className="admin-data-heading"><div><h2>Categories</h2><p>{items.length} categories from the database.</p></div></header>
      <form className="admin-category-form" onSubmit={submit}>
        <label>Category name<input value={name} onChange={event => setName(event.target.value)} required /></label>
        <label>Description<input value={description} onChange={event => setDescription(event.target.value)} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add category'}</button>
      </form>
      {message && <p className="admin-operation-message" role="status">{message}</p>}
      {error && <p className="admin-overview-error" role="alert">{error}</p>}
      <section className="admin-overview-panel admin-table-panel"><div className="admin-overview-table-scroll"><table className="admin-overview-table"><thead><tr>{['Category', 'Description', 'Created', 'Actions'].map(item => <th key={item}>{item}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan="4" className="admin-empty-cell">Loading…</td></tr> : rows.length ? rows.map(row => <tr key={row.key}>{row.cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>) : <tr><td colSpan="4" className="admin-empty-cell">No categories have been created.</td></tr>}</tbody></table></div></section>
    </section>
  )
}

function InventoryPanel() {
  const [items, setItems] = useState([])
  const [lowStockThreshold, setLowStockThreshold] = useState(10)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    getProducts().then(setItems).catch(loadError => setError(loadError.message)).finally(() => setLoading(false))
    getAdminSettings().then(result => setLowStockThreshold(result.settings.inventory.low_stock_threshold)).catch(loadError => setError(loadError.message))
  }, [])
  const filtered = items.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()))
  const rows = filtered.map(item => ({ key: item.id, cells: [<ProductPhoto key="photo" className="admin-product-thumb" src={item.image_url} alt={item.name} />, item.name, item.category_name || categoryLabels[item.category] || '—', item.stock, item.stock <= 0 ? 'Out of Stock' : item.stock <= lowStockThreshold ? 'Low Stock' : 'In Stock'] }))
  return (
    <section className="admin-data-page">
      <header className="admin-data-heading"><div><h2>Inventory Management</h2><p>Product stock levels. Low stock follows your saved System Settings threshold of {lowStockThreshold} units.</p></div><label className="admin-search-label"><span>Search inventory</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search products" /></label></header>
      {error && <p className="admin-overview-error" role="alert">{error}</p>}
      <DataPanel title="" description="" headings={['Photo', 'Product', 'Category', 'Current Stock', 'Status']} rows={rows} loading={loading} error="" empty="No products match your search." />
    </section>
  )
}

function OrdersPanel() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [orderDetails, setOrderDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  function load() {
    return getOrders().then(setItems).catch(loadError => setError(loadError.message)).finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    const interval = window.setInterval(load, 15000)
    return () => window.clearInterval(interval)
  }, [])
  async function changeStatus(order, status) {
    const reason = status === 'Rejected'
      ? window.prompt('Enter the reason for rejecting this order:')
      : status === 'Cancelled'
        ? window.prompt('Enter an optional reason for cancelling this order:') || ''
        : ''
    if (status === 'Rejected' && !reason?.trim()) {
      setError('A reason is required to reject an order.')
      return
    }
    setSavingId(order.id)
    setError('')
    setMessage('')
    try {
      await updateOrder(order.id, status, reason || '')
      setMessage(`Order #${order.id} updated to ${status}.`)
      await load()
    } catch (updateError) {
      setError(updateError.message)
    } finally {
      setSavingId(null)
    }
  }
  async function markPaid(order) {
    setSavingId(order.id)
    setError('')
    setMessage('')
    try {
      await updateOrderPayment(order.id, 'Paid')
      setMessage(`Payment for order #${order.id} recorded.`)
      await load()
    } catch (updateError) {
      setError(updateError.message)
    } finally {
      setSavingId(null)
    }
  }
  async function viewDetails(order) {
    setError('')
    try {
      setOrderDetails(await getOrderDetails(order.id))
    } catch (loadError) {
      setError(loadError.message)
    }
  }
  const nextStatus = {
    'Pending Confirmation': ['Confirmed', 'Rejected', 'Cancelled'],
    Pending: ['Confirmed', 'Rejected', 'Cancelled'],
    pending: ['Confirmed', 'Rejected', 'Cancelled'],
    Confirmed: ['Processing', 'Cancelled'],
    Approved: ['Processing', 'Cancelled'],
    approved: ['Processing', 'Cancelled'],
    confirmed: ['Processing', 'Cancelled'],
    Processing: ['Ready for Pickup', 'Out for Delivery', 'Cancelled'],
    processing: ['Ready for Pickup', 'Out for Delivery', 'Cancelled'],
  }
  const rows = items.map(item => ({
    key: item.id,
    cells: [
      `ORD-${item.id}`,
      <span key="customer">{item.customer_name || `Customer #${item.user_id ?? '—'}`}<small className="admin-order-email">{item.customer_email}</small></span>,
      formatDate(item.created_at),
      peso.format(Number(item.total) || 0),
      `${item.payment_method === 'cash_on_pickup' ? 'Cash on Pickup' : item.payment_method || 'Unknown'} · ${item.payment_status || 'Unknown'}`,
      <span className={`admin-status-badge ${String(item.status).toLowerCase().replace(/\s+/g, '-')}`} key="status">{item.status}</span>,
      <div className="admin-order-actions" key="actions">
        <button type="button" onClick={() => viewDetails(item)}>View details</button>
        {nextStatus[item.status] && <select aria-label={`Update order ${item.id} status`} defaultValue="" disabled={savingId === item.id} onChange={event => { if (event.target.value) changeStatus(item, event.target.value); event.target.value = '' }}><option value="" disabled>Update status</option>{nextStatus[item.status].map(status => <option key={status}>{status}</option>)}</select>}
        {String(item.status).toLowerCase() === 'completed' && String(item.payment_status).toLowerCase() !== 'paid' && <button type="button" disabled={savingId === item.id} onClick={() => markPaid(item)}>{savingId === item.id ? 'Saving…' : 'Record payment'}</button>}
      </div>,
    ],
  }))
  return <section className="admin-data-page">
    <header className="admin-data-heading"><div><h2>Customer Orders</h2><p>Review and update live customer orders and pickup payment collection.</p></div></header>
    {error && <p className="admin-overview-error" role="alert">{error}</p>}
    {message && <p className="admin-overview-success" role="status">{message}</p>}
    <DataPanel title="" description="" headings={['Order #', 'Customer', 'Order Date', 'Total', 'Payment', 'Order Status', 'Actions']} rows={rows} loading={loading} error="" empty="No customer orders have been recorded." />
    {orderDetails && <div className="admin-order-details-backdrop" role="presentation" onClick={() => setOrderDetails(null)}><section className="admin-order-details-modal" role="dialog" aria-modal="true" aria-labelledby="admin-order-details-title" onClick={event => event.stopPropagation()}><button type="button" onClick={() => setOrderDetails(null)} aria-label="Close order details">×</button><h3 id="admin-order-details-title">Order #{orderDetails.id}</h3><p>{orderDetails.customer_name} · {orderDetails.customer_email}</p><p>Order status: {orderDetails.status} · Total: {peso.format(Number(orderDetails.total) || 0)}</p><p>{orderDetails.payment_method === 'cash_on_pickup' ? 'Cash on Pickup' : orderDetails.payment_method} · {orderDetails.payment_status}</p>{orderDetails.rejection_reason && <p>Reason: {orderDetails.rejection_reason}</p>}{orderDetails.items.map(item => <article key={`${item.product_id}-${item.name}`}><ProductPhoto src={item.image_url} alt={item.name} /><span><strong>{item.name}</strong><small>Qty {item.quantity} · {peso.format(Number(item.unit_price))} each</small></span><b>{peso.format(Number(item.subtotal))}</b></article>)}</section></div>}
  </section>
}

function SalesPanel() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => { getSales().then(setItems).catch(loadError => setError(loadError.message)).finally(() => setLoading(false)) }, [])
  const rows = items.map(item => ({ key: item.id, cells: [`SALE-${item.id}`, item.user_id ?? 'Guest', formatDate(item.created_at), peso.format(Number(item.total) || 0), item.payment_method || '—', <span className={`admin-status-badge ${String(item.status).toLowerCase()}`} key="status">{item.status}</span>] }))
  return <DataPanel title="Sales and Transactions" description="Sales records and payment fields currently stored by the application." headings={['Sale #', 'Customer ID', 'Date', 'Amount', 'Payment Method', 'Status']} rows={rows} loading={loading} error={error} empty="No sales have been recorded." />
}

function CustomersPanel() {
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loadedSearch, setLoadedSearch] = useState(null)
  useEffect(() => {
    let active = true
    const load = () => getMonitoringUsers({ role: 'customer', search })
      .then(users => { if (active) { setItems(users); setError('') } })
      .catch(loadError => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setLoadedSearch(search) })
    load()
    const interval = window.setInterval(load, 15000)
    return () => { active = false; window.clearInterval(interval) }
  }, [search])
  const loading = loadedSearch !== search
  const rows = items.map(item => ({ key: item.id, cells: [
    <span className="admin-customer-name" key="name">
      {item.profile_image_url ? <img src={item.profile_image_url} alt="" /> : <span className="admin-customer-avatar" aria-hidden="true">{(item.name || item.username || '?').slice(0, 1).toUpperCase()}</span>}
      <span>{item.name || item.username}</span>
    </span>,
    `#${item.id}`,
    item.username || '—',
    item.email,
    item.account_status,
    formatDate(item.created_at),
    formatDate(item.updated_at),
  ] }))
  return (
    <section className="admin-data-page">
      <header className="admin-data-heading"><div><h2>Customer Management</h2><p>Customer accounts from the existing user-monitoring service.</p></div><label className="admin-search-label"><span>Search customers</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, username, or email" /></label></header>
      <DataPanel title="" description="" headings={['Customer / Display Name', 'ID', 'Username', 'Email', 'Account Status', 'Registered', 'Last Updated']} rows={rows} loading={loading} error={error} empty="No customer accounts found." />
    </section>
  )
}

function FeedbackPanel() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    const load = () => getProductFeedback()
      .then(reviews => { if (active) { setItems(reviews); setError('') } })
      .catch(loadError => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setLoading(false) })
    load()
    const interval = window.setInterval(load, 15000)
    return () => { active = false; window.clearInterval(interval) }
  }, [])
  const rows = items.map(item => ({
    key: item.id,
    cells: [
      <span className="admin-feedback-customer" key="customer">
        {item.customer_profile_image_url ? <img src={item.customer_profile_image_url} alt="" /> : <span className="admin-customer-avatar">{(item.customer_name || '?').slice(0, 1).toUpperCase()}</span>}
        <span>{item.customer_name || `Customer #${item.customer_id}`}</span>
      </span>,
      <span className="admin-feedback-product" key="product">{item.product_image_url && <ProductPhoto src={item.product_image_url} alt="" />}<span>{item.product_name}</span></span>,
      `#${item.order_id}`,
      <span className="admin-feedback-stars" key="rating" aria-label={`${item.rating} out of 5 stars`}>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</span>,
      item.review || '—',
      formatDate(item.created_at),
    ],
  }))
  return <section className="admin-data-page">
    <header className="admin-data-heading"><div><h2>Product Feedback</h2><p>Customer reviews are read-only and can only be submitted after receipt confirmation.</p></div></header>
    {error && <p className="admin-overview-error" role="alert">{error}</p>}
    <DataPanel title="" description="" headings={['Customer', 'Product', 'Order', 'Rating', 'Feedback', 'Submitted']} rows={rows} loading={loading} error="" empty="No customer feedback has been submitted." />
  </section>
}

export { CategoriesPanel, CustomersPanel, FeedbackPanel, InventoryPanel, OrdersPanel, SalesPanel }
