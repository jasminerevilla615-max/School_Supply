import { useEffect, useState } from 'react'
import { getAdminDashboardOverview, getMonitoringActivity } from '../../lib/api.js'
import ProductPhoto from '../products/ProductPhoto.jsx'
import './admin-dashboard.css'

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function shortDate(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-PH', options).format(date)
}

function ProductThumbnail({ src, name }) {
  return <ProductPhoto className="admin-product-thumb" src={src} alt={name} />
}

function SalesLineChart({ points }) {
  const values = points.map(point => Number(point.total) || 0)
  const max = Math.max(...values, 1)
  const coordinates = values.map((value, index) => ({
    x: values.length > 1 ? 10 + index * (380 / (values.length - 1)) : 200,
    y: 126 - (value / max) * 108,
  }))
  const line = coordinates.map(point => `${point.x},${point.y}`).join(' ')
  const area = coordinates.length ? `10,132 ${line} 390,132` : ''

  return (
    <div className="admin-line-chart">
      <div className="admin-chart-y-labels" aria-hidden="true">
        {[max, max / 2, 0].map((value, index) => <span key={index}>{currency.format(value)}</span>)}
      </div>
      <svg viewBox="0 0 400 140" role="img" aria-label="Completed sales over the last 14 days">
        {[18, 72, 126].map(y => <line key={y} x1="10" y1={y} x2="390" y2={y} className="admin-chart-gridline" />)}
        {coordinates.length > 1 && <polygon points={area} className="admin-chart-area" />}
        {coordinates.length > 1 && <polyline points={line} className="admin-chart-line" />}
        {coordinates.map((point, index) => <circle key={points[index].date} cx={point.x} cy={point.y} r="3" className="admin-chart-point"><title>{`${shortDate(points[index].date)}: ${currency.format(values[index])}`}</title></circle>)}
      </svg>
      <div className="admin-chart-x-labels">
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].filter((value, index, all) => all.indexOf(value) === index && value >= 0).map(index => <span key={points[index]?.date}>{shortDate(points[index]?.date)}</span>)}
      </div>
    </div>
  )
}

function MonthlyBarChart({ points }) {
  const max = Math.max(...points.map(point => Number(point.total) || 0), 1)
  return (
    <div className="admin-month-chart" role="img" aria-label="Completed sales by month this year">
      {points.map(point => (
        <div className="admin-month-column" key={point.month} title={`${monthNames[point.month - 1]}: ${currency.format(point.total)}`}>
          <span className="admin-month-value">{point.total ? currency.format(point.total) : ''}</span>
          <div className="admin-month-track"><i style={{ height: `${Math.max(point.total ? (point.total / max) * 100 : 0, point.total ? 4 : 0)}%` }} /></div>
          <small>{monthNames[point.month - 1]}</small>
        </div>
      ))}
      {!points.length && <p className="admin-empty">No completed sales have been recorded this year.</p>}
    </div>
  )
}

function OrderStatusChart({ statuses }) {
  const colors = ['#ffb02e', '#4295f5', '#2688eb', '#38c991', '#ed5260', '#8258e8', '#16afbd']
  const total = statuses.reduce((sum, item) => sum + Number(item.count || 0), 0)
  let offset = 0
  const gradient = statuses.map((item, index) => {
    const start = offset
    offset += total ? (Number(item.count || 0) / total) * 100 : 0
    return `${colors[index % colors.length]} ${start}% ${offset}%`
  }).join(', ')

  return (
    <div className="admin-order-status">
      <div className="admin-donut" style={{ background: total ? `conic-gradient(${gradient})` : '#e8eef6' }} role="img" aria-label={`Order status distribution, ${total} total orders`}>
        <div><strong>{total}</strong><span>Total Orders</span></div>
      </div>
      <div className="admin-order-legend">
        {statuses.map((item, index) => <div key={item.status}><i style={{ background: colors[index % colors.length] }} /><span>{item.status}</span><strong>{item.count}</strong></div>)}
        {!statuses.length && <p className="admin-empty">No orders have been recorded.</p>}
      </div>
    </div>
  )
}

function DataTable({ headings, rows, empty, children }) {
  return (
    <div className="admin-overview-table-scroll">
      <table className="admin-overview-table">
        <thead><tr>{headings.map(heading => <th key={heading}>{heading}</th>)}</tr></thead>
        <tbody>{rows.length ? children : <tr><td className="admin-empty-cell" colSpan={headings.length}>{empty}</td></tr>}</tbody>
      </table>
    </div>
  )
}

function AdminDashboard({ onNavigate }) {
  const [overview, setOverview] = useState(null)
  const [activity, setActivity] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const load = () => {
      Promise.all([getAdminDashboardOverview(), getMonitoringActivity()])
        .then(([data, events]) => {
          if (!active) return
          setOverview(data)
          setActivity(events)
          setError('')
        })
        .catch(loadError => {
          if (active) setError(loadError.message)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }
    load()
    const interval = window.setInterval(load, 60000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const metrics = overview?.metrics
  const cards = [
    ['▣', 'Total Products', metrics?.total_products, 'blue'],
    ['▦', 'Total Categories', metrics?.total_categories, 'green'],
    ['♙', 'Total Customers', metrics?.total_customers, 'blue'],
    ['♧', 'Total Staff', metrics?.total_staff, 'purple'],
    ['▤', 'Pending Orders', metrics?.pending_orders, 'orange'],
    ['✓', 'Completed Orders', metrics?.completed_orders, 'green'],
    ['⚠', 'Low-Stock Products', metrics?.low_stock_products, 'red'],
    ['₱', 'Total Sales', metrics ? currency.format(metrics.total_sales) : undefined, 'teal'],
  ]

  return (
    <section className="admin-overview">
      <div className="admin-overview-heading">
        <div>
          <h2>Dashboard</h2>
          <p>Welcome back! Here’s what’s happening with your store today.</p>
        </div>
        <button type="button" className="admin-refresh-button" onClick={() => window.location.reload()}>Refresh data</button>
      </div>
      {error && <p className="admin-overview-error" role="alert">{error}</p>}
      <div className="admin-overview-metrics">
        {cards.map(([icon, label, value, color]) => (
          <article className="admin-overview-metric" key={label}>
            <span className={`admin-metric-icon ${color}`} aria-hidden="true">{icon}</span>
            <div><small>{label}</small><strong>{loading ? '—' : value ?? 0}</strong></div>
          </article>
        ))}
      </div>
      <div className="admin-quick-actions">
        <button type="button" className="navy" onClick={() => onNavigate('products')}><span>＋</span> Add Product</button>
        <button type="button" className="mint" onClick={() => onNavigate('orders')}><span>🛒</span> Manage Orders</button>
        <button type="button" className="blue" onClick={() => onNavigate('reports')}><span>▥</span> View Reports</button>
        <button type="button" className="teal" onClick={() => onNavigate('inventory')}><span>⚠</span> Check Low Stock</button>
      </div>
      <div className="admin-overview-chart-grid">
        <section className="admin-overview-panel">
          <div className="admin-overview-panel-heading"><h3>Sales Overview</h3><span>Last 14 days · completed sales</span></div>
          <strong className="admin-panel-total">{currency.format(metrics?.total_sales || 0)}</strong>
          <SalesLineChart points={overview?.daily_sales || []} />
        </section>
        <section className="admin-overview-panel">
          <div className="admin-overview-panel-heading"><h3>Monthly Sales Trends</h3><span>Year to date · completed sales</span></div>
          <MonthlyBarChart points={overview?.monthly_sales || []} />
        </section>
        <section className="admin-overview-panel">
          <div className="admin-overview-panel-heading"><h3>Order Status Distribution</h3><span>Current order records</span></div>
          <OrderStatusChart statuses={overview?.order_statuses || []} />
        </section>
      </div>
      <div className="admin-overview-data-grid">
        <section className="admin-overview-panel admin-table-panel">
          <div className="admin-overview-panel-heading"><h3>Best-Selling Products</h3><button type="button" onClick={() => onNavigate('products')}>View all ↗</button></div>
          <DataTable headings={['#', 'Product', 'Sold', 'Revenue']} rows={overview?.best_sellers || []} empty="No completed product sales yet.">
            {overview?.best_sellers.map((product, index) => <tr key={product.id}><td>{index + 1}</td><td><span className="admin-product-cell"><ProductThumbnail key={product.image_url || product.name} src={product.image_url} name={product.name} />{product.name}</span></td><td>{product.quantity_sold}</td><td>{currency.format(product.revenue)}</td></tr>)}
          </DataTable>
        </section>
        <section className="admin-overview-panel admin-table-panel">
          <div className="admin-overview-panel-heading"><h3>Recent Customer Orders</h3><button type="button" onClick={() => onNavigate('orders')}>View all ↗</button></div>
          <DataTable headings={['Order #', 'Customer', 'Date', 'Total', 'Status']} rows={overview?.recent_orders || []} empty="No customer orders yet.">
            {overview?.recent_orders.map(order => <tr key={order.id}><td>ORD-{order.id}</td><td>{order.customer}</td><td>{shortDate(order.created_at)}</td><td>{currency.format(order.total)}</td><td><span className={`admin-status-badge ${String(order.status).toLowerCase()}`}>{order.status}</span></td></tr>)}
          </DataTable>
        </section>
        <section className="admin-overview-panel admin-table-panel">
          <div className="admin-overview-panel-heading"><h3>Low-Stock Alerts</h3><button type="button" onClick={() => onNavigate('inventory')}>View all ↗</button></div>
          <DataTable headings={['Product', 'Stock', 'Status']} rows={overview?.low_stock || []} empty="No products are currently below the low-stock threshold.">
            {overview?.low_stock.map(product => <tr key={product.id}><td><span className="admin-product-cell"><ProductThumbnail key={product.image_url || product.name} src={product.image_url} name={product.name} />{product.name}</span></td><td>{product.stock}</td><td><span className={`admin-status-badge ${product.stock <= 0 ? 'out' : 'low'}`}>{product.stock <= 0 ? 'Out of Stock' : 'Low Stock'}</span></td></tr>)}
          </DataTable>
        </section>
        <section className="admin-overview-panel admin-table-panel">
          <div className="admin-overview-panel-heading"><h3>Recent Transactions</h3><button type="button" onClick={() => onNavigate('sales')}>View all ↗</button></div>
          <DataTable headings={['Sale #', 'Customer', 'Date', 'Amount', 'Method', 'Status']} rows={overview?.recent_sales || []} empty="No sales transactions yet.">
            {overview?.recent_sales.map(sale => <tr key={sale.id}><td>SALE-{sale.id}</td><td>{sale.customer}</td><td>{shortDate(sale.created_at)}</td><td>{currency.format(sale.total)}</td><td>{sale.payment_method || '—'}</td><td><span className={`admin-status-badge ${String(sale.status).toLowerCase()}`}>{sale.status}</span></td></tr>)}
          </DataTable>
        </section>
      </div>
      <section className="admin-overview-panel admin-recent-activity">
        <div className="admin-overview-panel-heading"><h3>Recent Activities</h3><button type="button" onClick={() => onNavigate('activity')}>View all ↗</button></div>
        {activity.slice(0, 6).length ? activity.slice(0, 6).map(item => <article className="admin-activity-row" key={item.id}><span aria-hidden="true">•</span><div><strong>{item.description}</strong><small>{item.name || item.username || item.email} · {item.module}</small></div><time>{shortDate(item.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></article>) : <p className="admin-empty">{loading ? 'Loading activity…' : 'No activity has been recorded yet.'}</p>}
      </section>
    </section>
  )
}

export default AdminDashboard
