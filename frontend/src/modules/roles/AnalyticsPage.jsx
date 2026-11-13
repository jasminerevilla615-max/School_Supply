import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSalesAnalytics } from '../../lib/api.js'
import { downloadAnalyticsReport } from './analytics-export.js'
import './analytics.css'

const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const pageSize = 10

function localDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialFilters() {
  const today = new Date()
  return { start_date: localDate(new Date(today.getFullYear(), today.getMonth(), 1)), end_date: localDate(today) }
}

function periodFilters(period) {
  const end = new Date()
  const start = new Date(end)
  if (period === 'today') start.setDate(end.getDate())
  if (period === 'week') start.setDate(end.getDate() - ((end.getDay() + 6) % 7))
  if (period === 'month') start.setDate(1)
  if (period === 'year') start.setMonth(0, 1)
  return { start_date: localDate(start), end_date: localDate(end) }
}

function SummaryCard({ label, value, icon, tone }) {
  return <article className={`analytics-summary-card ${tone}`}><span aria-hidden="true">{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>
}

function SalesTrend({ points }) {
  const values = points.map(point => Number(point.total) || 0)
  const maximum = Math.max(...values, 1)
  const coordinates = values.map((value, index) => ({
    x: values.length < 2 ? 300 : 16 + (index * 568) / (values.length - 1),
    y: 138 - (value / maximum) * 112,
  }))
  const line = coordinates.map(point => `${point.x},${point.y}`).join(' ')
  return (
    <div className="analytics-line-wrap">
      {points.length ? <>
        <svg viewBox="0 0 600 160" role="img" aria-label="Sales total by day">
          {[26, 82, 138].map(y => <line key={y} x1="12" y1={y} x2="588" y2={y} className="analytics-grid-line" />)}
          {coordinates.length > 1 && <polyline points={line} className="analytics-line" />}
          {coordinates.map((point, index) => <circle key={points[index].date} cx={point.x} cy={point.y} r="4" className="analytics-point"><title>{`${points[index].date}: ${currency.format(values[index])}`}</title></circle>)}
        </svg>
        <div className="analytics-chart-labels"><span>{points[0].date}</span><span>{points[points.length - 1].date}</span></div>
      </> : <p className="analytics-empty">No sales data is available for this date range.</p>}
    </div>
  )
}

function MonthlySales({ points }) {
  const max = Math.max(...points.map(point => Number(point.total) || 0), 1)
  return <div className="analytics-monthly-chart">
    {points.map(point => <div className="analytics-month-column" key={point.month} title={`${point.month}: ${currency.format(point.total)}`}>
      <span>{currency.format(point.total)}</span><div><i style={{ height: `${Math.max((Number(point.total) / max) * 100, point.total ? 4 : 0)}%` }} /></div><small>{new Date(`${point.month}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' })}</small>
    </div>)}
    {!points.length && <p className="analytics-empty">No monthly sales data is available.</p>}
  </div>
}

function StatusChart({ statuses }) {
  const palette = ['#3788e7', '#25ad8f', '#f5a623', '#e35b68', '#805bd7', '#31aab8']
  const total = statuses.reduce((sum, item) => sum + Number(item.count), 0)
  let offset = 0
  const slices = statuses.map((item, index) => {
    const start = offset
    offset += total ? (Number(item.count) / total) * 100 : 0
    return `${palette[index % palette.length]} ${start}% ${offset}%`
  })
  return <div className="analytics-status-chart">
    <div className="analytics-donut" style={{ background: total ? `conic-gradient(${slices.join(',')})` : '#e8eef6' }} aria-label={`${total} orders in selected range`}><strong>{total}</strong><span>orders</span></div>
    <div className="analytics-legend">{statuses.map((item, index) => <div key={item.status}><i style={{ background: palette[index % palette.length] }} /><span>{item.status}</span><b>{item.count}</b></div>)}{!statuses.length && <p className="analytics-empty">No orders found.</p>}</div>
  </div>
}

function TopProducts({ products }) {
  const max = Math.max(...products.map(product => Number(product.quantity_sold) || 0), 1)
  return <div className="analytics-top-products">
    {products.map(product => <div className="analytics-top-product" key={`${product.product_name}-${product.category_name}`}>
      <div><strong>{product.product_name}</strong><span>{product.category_name} · {product.quantity_sold} sold</span><b>{currency.format(product.revenue)}</b></div>
      <i><span style={{ width: `${(Number(product.quantity_sold) / max) * 100}%` }} /></i>
    </div>)}
    {!products.length && <p className="analytics-empty">No product sales found.</p>}
  </div>
}

function AnalyticsPage() {
  const [draft, setDraft] = useState(initialFilters)
  const [filters, setFilters] = useState(initialFilters)
  const [period, setPeriod] = useState('month')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'order_date', direction: 'desc' })
  const [page, setPage] = useState(1)

  const loadReport = useCallback(async (activeFilters, active = () => true) => {
    setLoading(true)
    setError('')
    try {
      const data = await getSalesAnalytics(activeFilters)
      if (active()) setReport(data)
    } catch (loadError) {
      if (active()) setError(loadError.message)
    } finally {
      if (active()) setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => loadReport(filters, () => active), 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [filters, loadReport])

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = (report?.rows || []).filter(row => !query || [
      row.order_id, row.customer_name, row.product_name, row.category_name, row.order_status, row.sale_status,
    ].some(value => String(value ?? '').toLowerCase().includes(query)))
    rows.sort((left, right) => {
      const a = left[sort.key]
      const b = right[sort.key]
      const comparison = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a ?? '').localeCompare(String(b ?? ''), undefined, { numeric: true, sensitivity: 'base' })
      return sort.direction === 'asc' ? comparison : -comparison
    })
    return rows
  }, [report, search, sort])
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const visibleRows = filteredRows.slice((page - 1) * pageSize, page * pageSize)

  function applyFilters(event) {
    event.preventDefault()
    setPage(1)
    setFilters({ ...draft })
  }

  function resetFilters() {
    const next = initialFilters()
    setDraft(next)
    setFilters(next)
    setPeriod('month')
    setSearch('')
    setPage(1)
  }

  function choosePeriod(value) {
    setPeriod(value)
    if (value !== 'custom') setDraft(current => ({ ...current, ...periodFilters(value) }))
  }

  function changeSort(key) {
    setSort(current => current.key === key
      ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'order_date' ? 'desc' : 'asc' })
    setPage(1)
  }

  const summary = report?.summary || {}
  const products = report?.filters?.products || []
  const filteredProducts = draft.category_id
    ? products.filter(product => String(product.category_id) === draft.category_id)
    : products
  const columns = [
    ['order_id', 'Order ID'], ['order_date', 'Order Date'], ['customer_name', 'Customer'],
    ['product_name', 'Product'], ['category_name', 'Category'], ['quantity', 'Qty'],
    ['line_amount', 'Line Amount'], ['order_total', 'Order Total'],
    ['sale_status', 'Sale Status'], ['payment_method', 'Payment Method'], ['order_status', 'Order Status'],
  ]

  return <section className="analytics-page">
    <div className="analytics-heading"><div><p className="analytics-eyebrow">BUSINESS OVERVIEW</p><h2>Analytics &amp; Reports</h2><p>Review sales performance, orders, and product activity.</p></div>
      <button type="button" className="analytics-refresh" onClick={() => loadReport(filters)}>↻ Refresh data</button>
    </div>
    {error && <div className="analytics-error" role="alert">{error}<button type="button" onClick={() => loadReport(filters)}>Try again</button></div>}
    <form className="analytics-filters" onSubmit={applyFilters}>
      <div className="analytics-periods" aria-label="Date range">
        {[['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['year', 'This Year'], ['custom', 'Custom']].map(([value, label]) =>
          <button type="button" className={period === value ? 'selected' : ''} key={value} onClick={() => choosePeriod(value)}>{label}</button>)}
      </div>
      <label>From<input type="date" required value={draft.start_date} onChange={event => { setPeriod('custom'); setDraft({ ...draft, start_date: event.target.value }) }} /></label>
      <label>To<input type="date" required value={draft.end_date} onChange={event => { setPeriod('custom'); setDraft({ ...draft, end_date: event.target.value }) }} /></label>
      <label>Category<select value={draft.category_id || ''} onChange={event => setDraft({ ...draft, category_id: event.target.value, product_id: '' })}><option value="">All categories</option>{report?.filters?.categories?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label>Product<select value={draft.product_id || ''} onChange={event => setDraft({ ...draft, product_id: event.target.value })}><option value="">All products</option>{filteredProducts.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label>Order status<select value={draft.order_status || ''} onChange={event => setDraft({ ...draft, order_status: event.target.value })}><option value="">All statuses</option>{report?.filters?.order_statuses?.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
      <label>Sale status<select value={draft.sale_status || ''} onChange={event => setDraft({ ...draft, sale_status: event.target.value })}><option value="">All statuses</option>{report?.filters?.sale_statuses?.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
      <div className="analytics-filter-actions"><button className="analytics-apply" type="submit" disabled={loading}>Apply filters</button><button className="analytics-reset" type="button" onClick={resetFilters}>Reset</button></div>
    </form>

    {loading && !report ? <div className="analytics-loading" role="status">Loading report data…</div> : <>
      <div className="analytics-summary-grid">
        <SummaryCard label="Total Sales" value={currency.format(summary.total_sales || 0)} icon="₱" tone="blue" />
        <SummaryCard label="Total Revenue" value={currency.format(summary.total_revenue || 0)} icon="↗" tone="green" />
        <SummaryCard label="Total Orders" value={summary.total_orders || 0} icon="▤" tone="purple" />
        <SummaryCard label="Pending Orders" value={summary.pending_orders || 0} icon="◷" tone="orange" />
        <SummaryCard label="Completed Orders" value={summary.completed_orders || 0} icon="✓" tone="teal" />
        <SummaryCard label="Cancelled Orders" value={summary.cancelled_orders || 0} icon="×" tone="red" />
      </div>
      <div className="analytics-chart-grid">
        <article className="analytics-panel analytics-trend-panel"><div className="analytics-panel-heading"><div><h3>Sales Trend</h3><p>Order totals by day in the selected range</p></div></div><SalesTrend points={report?.sales_trend || []} /></article>
        <article className="analytics-panel"><div className="analytics-panel-heading"><div><h3>Monthly Sales</h3><p>Order totals by month in the selected range</p></div></div><MonthlySales points={report?.monthly_sales || []} /></article>
        <article className="analytics-panel"><div className="analytics-panel-heading"><div><h3>Order Status</h3><p>Distribution of matching orders</p></div></div><StatusChart statuses={report?.order_statuses || []} /></article>
        <article className="analytics-panel"><div className="analytics-panel-heading"><div><h3>Top-Selling Products</h3><p>Products ranked by units sold</p></div></div><TopProducts products={report?.top_products || []} /></article>
      </div>

      <section className="analytics-panel analytics-report-panel">
        <div className="analytics-report-heading"><div><h3>Sales Report</h3><p>{filteredRows.length} matching line items</p></div>
          <div className="analytics-export-actions">{['PDF', 'Excel', 'CSV', 'JSON'].map(format => <button key={format} type="button" onClick={() => downloadAnalyticsReport(format, filteredRows)}>{format}</button>)}</div>
        </div>
        <div className="analytics-table-toolbar"><label>Search report<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} placeholder="Order, customer, product…" /></label><span>{loading ? 'Updating report…' : `Showing ${filteredRows.length ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, filteredRows.length)} of ${filteredRows.length}`}</span></div>
        <div className="analytics-table-scroll"><table><thead><tr>{columns.map(([key, label]) => <th key={key}><button type="button" onClick={() => changeSort(key)}>{label}{sort.key === key ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>)}</tr></thead>
          <tbody>{visibleRows.map((row, index) => <tr key={`${row.order_id}-${row.product_name}-${index}`}>
            {columns.map(([key]) => <td key={key}>{key === 'line_amount' || key === 'order_total' ? currency.format(row[key] || 0) : key === 'order_date' ? new Date(row[key]).toLocaleString('en-PH') : row[key] ?? '—'}</td>)}
          </tr>)}
          {!visibleRows.length && <tr><td className="analytics-table-empty" colSpan={columns.length}>{error ? 'Report data could not be loaded.' : 'No sales records match these filters.'}</td></tr>}</tbody>
        </table></div>
        <div className="analytics-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(current => current - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button type="button" disabled={page >= pageCount} onClick={() => setPage(current => current + 1)}>Next</button></div>
      </section>
    </>}
  </section>
}

export default AnalyticsPage
