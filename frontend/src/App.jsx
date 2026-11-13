import { useEffect, useState } from 'react'
import { catalog as fallbackCatalog, categories } from './modules/catalog/data.js'
import AuthForm from './modules/auth/components/AuthForm.jsx'
import CustomerPage from './modules/roles/CustomerPage.jsx'
import StaffPage from './modules/roles/StaffPage.jsx'
import AdminPage from './modules/roles/AdminPage.jsx'
import { getCategories, getCurrentUser, getProducts, heartbeat, logout } from './lib/api.js'
import ProductPhoto from './modules/products/ProductPhoto.jsx'
import './App.css'
import './modules/products/catalog.css'
import './landing-page.css'
import './modules/roles/role-dashboards.css'

const dashboardByRole = {
  admin: 'admin/dashboard',
  staff: 'staff/dashboard',
  customer: 'customer/dashboard',
}

function SearchBox({ value, onChange, onSelect, label, products = fallbackCatalog }) {
  const suggestions = value.trim() ? products.filter(product => `${product.name} ${categories[product.category] || product.category_name || ''}`.toLowerCase().includes(value.toLowerCase())).slice(0, 5) : []

  return <div className="search-box"><div className="search-wrap"><span>⌕</span><input aria-label={label} value={value} onChange={event => onChange(event.target.value)} placeholder="Search supplies" /></div>{suggestions.length > 0 && <div className="search-suggestions">{suggestions.map(product => <button type="button" key={product.id} onClick={() => onSelect(product)}><span className="suggestion-icon">{product.icon}</span><span><strong>{product.name}</strong><small>{categories[product.category]}</small></span><b>↗</b></button>)}</div>}{value.trim() && suggestions.length === 0 && <div className="search-suggestions no-results">No related supplies found.</div>}</div>
}

function LandingPage({ onLogin, initialRegisterMode = false }) {
  return (
    <section className="landing-page" aria-label="SchoolSupply welcome">
      <header className="landing-header">
        <a className="landing-brand" href="#/home" aria-label="SchoolSupply home">
          <svg className="landing-brand-icon" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M14 6h23a3 3 0 0 1 3 3v30a3 3 0 0 1-3 3H14a3 3 0 0 1-3-3V9a3 3 0 0 1 3-3Z" />
            <path d="M5 14h8M5 22h8M5 30h8M5 38h8" />
            <path className="landing-brand-pencil" d="m19 32 15-15 5 5-15 15-7 2 2-7Z" />
            <path d="m31 20 5 5" />
          </svg>
          <span>School<span>Supply</span></span>
        </a>
        <p className="landing-tagline">Better Supplies <span aria-hidden="true">•</span> Brighter Futures</p>
      </header>
      <main className="landing-content">
        <div className="landing-copy">
          <p className="landing-welcome"><span aria-hidden="true">◆</span> Welcome to SchoolSupply</p>
          <h1>Your One Stop Shop<br />for <span>School Supplies</span></h1>
          <p className="landing-description">Quality school supplies for students, teachers, and classrooms. Everything you need to learn, create, and achieve.</p>
          <div className="landing-benefits">
            <div className="landing-benefit">
              <span className="landing-benefit-icon" aria-hidden="true">✓</span>
              <span><strong>Trusted Quality</strong><small>Reliable and durable products</small></span>
            </div>
            <div className="landing-benefit">
              <span className="landing-benefit-icon" aria-hidden="true">↗</span>
              <span><strong>Fast &amp; Convenient</strong><small>Get what you need, when you need it</small></span>
            </div>
          </div>
        </div>
        <AuthForm onLogin={onLogin} initialRegisterMode={initialRegisterMode} />
      </main>
    </section>
  )
}

function App() {
  const getRoute = () => window.location.hash.replace('#/', '') || window.location.pathname.replace(/^\//, '') || 'home'
  const [search, setSearch] = useState(() => new URLSearchParams(getRoute().split('?')[1]).get('search') || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('school-supply-theme') === 'dark')
  const [page, setPage] = useState(() => getRoute().split('?')[0])
  const [selectedCategory, setSelectedCategory] = useState(() => new URLSearchParams(getRoute().split('?')[1]).get('category') || 'all')
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [catalog, setCatalog] = useState(fallbackCatalog)
  const [databaseCategories, setDatabaseCategories] = useState([])
  const navigate = path => { window.location.hash = `/${path}` }
  const redirectToLogin = () => {
    const route = window.location.hash ? '#/login' : '/login'
    window.history.replaceState(null, '', route)
    setPage('login')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const replaceRoute = path => {
    const route = window.location.hash ? `#/${path}` : `/${path}`
    window.history.replaceState(null, '', route)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }
  useEffect(() => {
    getCurrentUser().then(currentUser => {
      const role = typeof currentUser?.role === 'string' ? currentUser.role.trim().toLowerCase() : ''
      setUser(currentUser ? { ...currentUser, role } : null)
    }).catch(error => {
      console.error('Unable to verify the current session.', error)
      setUser(null)
    }).finally(() => setAuthReady(true))
  }, [])
  useEffect(() => {
    if (page !== 'products') return
    getCategories().then(setDatabaseCategories).catch(error => console.error('Unable to load product categories.', error))
    getProducts().then(setCatalog).catch(error => console.error('Unable to load the product catalog.', error))
  }, [page])
  useEffect(() => {
    if (!user) return undefined
    heartbeat().catch(error => console.error('Unable to refresh the authenticated session.', error))
    const interval = window.setInterval(() => {
      heartbeat().catch(error => console.error('Unable to refresh the authenticated session.', error))
    }, 30000)
    return () => window.clearInterval(interval)
  }, [user])
  const protectedRole = page.endsWith('/dashboard') ? page.split('/')[0] : null
  const currentUserRole = typeof user?.role === 'string' ? user.role.trim().toLowerCase() : ''
  useEffect(() => {
    if (!authReady || (page !== 'products' && !protectedRole)) return
    if (!user) {
      replaceRoute('login')
    } else if (protectedRole && currentUserRole !== protectedRole) {
      const destination = dashboardByRole[currentUserRole]
      if (destination) replaceRoute(destination)
      else replaceRoute('login')
    }
  }, [authReady, page, protectedRole, user, currentUserRole])
  const matchingProducts = catalog.filter(product => product.name.toLowerCase().includes(search.toLowerCase()) && (selectedCategory === 'all' || String(product.category_id) === String(selectedCategory) || product.category === selectedCategory))
  const targetProductId = new URLSearchParams(getRoute().split('?')[1]).get('product_id')
  const targetProduct = catalog.find(product => String(product.id) === String(targetProductId))
  const closeMenu = () => setMenuOpen(false)
  const onLogin = account => {
    const role = typeof account?.role === 'string' ? account.role.trim().toLowerCase() : ''
    const expectedDestination = dashboardByRole[role]
    const destination = account?.dashboard_path === expectedDestination
      ? account.dashboard_path
      : expectedDestination
    if (!role || !destination) {
      console.error('Sign-in response did not contain a valid user role.')
      redirectToLogin()
      return
    }
    setUser({ ...account, role })
    setPage(destination)
    navigate(destination)
  }
  const onLogout = async () => {
    try {
      await logout()
      setUser(null)
      redirectToLogin()
    } catch (error) {
      console.error('Unable to sign out.', error)
    }
  }
  const roleNavigate = path => navigate(path)
  const selectSearchResult = product => {
    setSearch(product.name)
    setSelectedCategory('all')
    closeMenu()
    setPage('products')
    navigate(`products?search=${encodeURIComponent(product.name)}`)
  }
  const goHome = event => {
    event.preventDefault()
    closeMenu()
    if (page !== 'home') {
      navigate('home')
      return
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const goToCategories = event => {
    event.preventDefault()
    closeMenu()
    if (page !== 'home') {
      navigate('home')
      window.setTimeout(() => document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' }), 100)
      return
    }
    document.getElementById('categories')?.scrollIntoView({ behavior: 'smooth' })
  }
  useEffect(() => {
    const handleHashChange = () => {
      const route = getRoute()
      setPage(route.split('?')[0])
      setSelectedCategory(new URLSearchParams(route.split('?')[1]).get('category') || 'all')
      setSearch(new URLSearchParams(route.split('?')[1]).get('search') || '')
      closeMenu()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  const updateTheme = theme => {
    const nextMode = theme === 'dark'
    localStorage.setItem('school-supply-theme', nextMode ? 'dark' : 'light')
    setDarkMode(nextMode)
  }
  const toggleTheme = () => updateTheme(darkMode ? 'light' : 'dark')

  if (page === 'home' || page === 'login' || page === 'signup') {
    return <div className={`storefront ${darkMode ? 'dark-mode' : ''}`}><LandingPage onLogin={onLogin} initialRegisterMode={page === 'signup'} /></div>
  }

  return (
    <div className={`storefront ${darkMode ? 'dark-mode' : ''}`}>
      <header className="site-header"><a className="brand" href="#/home" onClick={goHome}><span className="brand-mark">SS</span><span>School<span>Supply</span></span></a><button className="menu-button" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}>{menuOpen ? '×' : '☰'}</button><div className={`header-content ${menuOpen ? 'open' : ''}`}><nav><a href="#/home" onClick={goHome}>Home</a>{user && <a href={`#/${user.role}/dashboard`} onClick={closeMenu}>{user.role[0].toUpperCase() + user.role.slice(1)} Dashboard</a>}<a href="#/products" onClick={closeMenu}>Products</a><a href="#categories" onClick={goToCategories}>Categories</a></nav><div className="header-actions"><SearchBox value={search} onChange={setSearch} onSelect={selectSearchResult} label="Search products" products={catalog} /><button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`}><span>{darkMode ? '☼' : '◐'}</span>{darkMode ? 'Light' : 'Dark'}</button>{user ? <button className="login" onClick={onLogout}>Sign out <span>↗</span></button> : <button className="login" onClick={() => { navigate('login'); closeMenu() }}>Log in <span>↗</span></button>}</div></div></header>
      <main>
        {page === 'products' && (
          <section className="products-page">
            <div className="products-page-heading">
              <div><p className="eyebrow">THE COMPLETE COLLECTION</p><h1>All the good<br /><em>school stuff.</em></h1><p className="hero-text">Find practical, thoughtful supplies for every project and every kind of learner.</p></div>
              <button className="text-button" onClick={() => navigate('home')}>← Back home</button>
            </div>
            <div className="catalog-toolbar">
              <span>{matchingProducts.length} products</span>
              <select aria-label="Filter products by category" value={selectedCategory} onChange={event => navigate(`products?category=${event.target.value}`)}>
                <option value="all">All categories</option>
                {databaseCategories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}
              </select>
              <SearchBox value={search} onChange={setSearch} onSelect={selectSearchResult} label="Search all products" products={catalog} />
            </div>
            {targetProduct && <section className="linked-product-details" aria-live="polite"><ProductPhoto src={targetProduct.image_url} alt={targetProduct.name} /><div><p className="eyebrow">{targetProduct.category_name || 'SCHOOL SUPPLIES'}</p><h2>{targetProduct.name}</h2><p>{targetProduct.description || 'No product description has been added.'}</p><strong>₱{Number(targetProduct.price).toFixed(2)}</strong><span>{Number(targetProduct.stock) > 0 ? `${targetProduct.stock} in stock` : 'Out of stock'}</span></div></section>}
            <div className="product-grid full-product-grid">
              {matchingProducts.map((product, index) => (
                <article className={`product-card card-${index % 4}`} key={product.id}>
                  <div className="product-visual"><ProductPhoto src={product.image_url} alt={product.name} /><small>{String(index + 1).padStart(2, '0')}</small></div>
                  <div className="product-info"><p>{product.category_name || categories[product.category] || 'School Supplies'}</p><h3>{product.name}</h3><strong>₱{Number(product.price).toFixed(2)}</strong><small>{Number(product.stock) > 0 ? `${product.stock} in stock` : 'Out of stock'}</small></div>
                </article>
              ))}
            </div>
            {!matchingProducts.length && <p className="empty-products">No products match your search.</p>}
          </section>
        )}
        {page === 'customer/dashboard' && user?.role === 'customer' && <CustomerPage name={user.name} email={user.email} userId={user.id} onProfileUpdated={profile => setUser(current => current ? { ...current, name: profile.name, email: profile.email, profile_image_url: profile.profile_image_url } : current)} onNavigate={roleNavigate} onLogout={onLogout} />}
        {page === 'staff/dashboard' && user?.role === 'staff' && <StaffPage name={user.name} username={user.username} email={user.email} position={user.position} contactNumber={user.contact_number} profileImageUrl={user.profile_image_url} darkMode={darkMode} onThemeChange={updateTheme} onProfileUpdated={updatedProfile => setUser(current => current ? { ...current, ...updatedProfile } : current)} onNavigate={roleNavigate} onLogout={onLogout} />}
        {page === 'admin/dashboard' && user?.role === 'admin' && <AdminPage email={user.email} onNavigate={roleNavigate} onLogout={onLogout} />}
        {page.endsWith('/dashboard') && !authReady && <p className="route-loading" role="status">Checking your session...</p>}
        {page !== 'products' && !page.endsWith('/dashboard') && (
          <section className="error-page">
            <p className="eyebrow">PAGE NOT FOUND</p>
            <h1>That page<br /><em>isn’t here.</em></h1>
            <p>We couldn’t find that destination. Return to the store to keep exploring.</p>
            <button className="primary-button" onClick={() => navigate('home')}>Return home <span>→</span></button>
          </section>
        )}
      </main>
      <footer><a className="brand" href="#/home"><span className="brand-mark">SS</span><span>School<span>Supply</span></span></a><p>Small tools. Big possibilities.</p><div><a href="mailto:hello@schoolsupply.test">hello@schoolsupply.test</a><a href="#categories">Explore categories</a></div><small>© 2026 School Supply Co.</small></footer>
    </div>
  )
}

export default App
