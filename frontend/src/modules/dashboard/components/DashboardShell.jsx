import { useState } from 'react'

const links = [
  { group: 'Store Operations', items: [['products', 'Products'], ['inventory', 'Inventory'], ['orders', 'Orders'], ['transactions', 'Transactions'], ['customers', 'Customers'], ['history', 'Order History']] },
  { group: 'Notifications', items: [['notifications', 'Notifications']] },
  { group: 'Account', items: [['profile', 'My Profile']] },
]

function DashboardShell({ activePage, onNavigate, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toast, setToast] = useState('')

  function showToast(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  function handleNavigate(page) {
    if (['dashboard', 'products', 'inventory'].includes(page)) onNavigate(page)
    else showToast(`${page[0].toUpperCase()}${page.slice(1)} is coming next.`)
    setSidebarOpen(false)
  }

  return (
    <div className="dash-shell">
      <div className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><span className="logo-mark">SS</span> SCHOOL SUPPLY</div>
        <div className="sidebar-role">Staff console</div>
        <nav>
          <button className={`sidebar-link ${activePage === 'dashboard' ? 'active' : ''}`} onClick={() => handleNavigate('dashboard')}><span>H</span> Dashboard</button>
          {links.map(({ group, items }) => <div className="sidebar-group" key={group}>
            <div className="sidebar-group-label">{group}</div>
            {items.map(([page, label]) => <button className={`sidebar-link ${activePage === page ? 'active' : ''}`} key={page} onClick={() => handleNavigate(page)}><span>{label[0]}</span> {label}{page === 'orders' && <b>6</b>}{page === 'notifications' && <b>4</b>}</button>)}
          </div>)}
          <div className="sidebar-restricted">Staff accounts do not have access to user management, staff management, system settings, or full admin reports.</div>
          <button className="sidebar-link" onClick={() => showToast('Logout will return to the storefront.')}> <span>L</span> Logout</button>
        </nav>
      </aside>
      <div className="dash-content">
        <header className="topbar">
          <div className="topbar-left"><button className="sidebar-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open navigation">=</button><div><div className="topbar-title">{activePage[0].toUpperCase() + activePage.slice(1)}</div><div className="topbar-sub">Staff operations workspace</div></div></div>
          <div className="topbar-right"><button className="topbar-icon-btn" onClick={() => showToast('4 unread notifications')} aria-label="Notifications">!</button><div className="topbar-user"><div className="topbar-avatar">RC</div><div><div className="topbar-user-name">Rina Cabrera</div><div className="topbar-user-role">Staff</div></div></div></div>
        </header>
        {children}
      </div>
      {toast && <div className="toast visible">{toast}</div>}
    </div>
  )
}

export default DashboardShell