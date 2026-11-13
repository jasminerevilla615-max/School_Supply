import { useEffect, useMemo, useRef, useState } from 'react'
import { categories as legacyCategories } from '../catalog/data.js'
import { createProduct, deleteProduct, getAdminSettings, getCategories, getProducts, updateProduct } from '../../lib/api.js'
import ProductPhoto from './ProductPhoto.jsx'
import './products-page.css'

const FALLBACK_IMAGE = '/product-images/fallback.svg'
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_SIZE = 5 * 1024 * 1024
function stockState(stock, threshold) {
  if (Number(stock) <= 0) return { label: 'Out of stock', className: 'is-out' }
  if (Number(stock) <= threshold) return { label: 'Low stock', className: 'is-low' }
  return { label: 'In stock', className: 'is-in' }
}

function ProductImage({ product, className = '' }) {
  return <ProductPhoto className={className} src={product.image_url} alt={product.name} />
}

function ProductsPage() {
  const [products, setProducts] = useState([])
  const [lowStockThreshold, setLowStockThreshold] = useState(10)
  const [databaseCategories, setDatabaseCategories] = useState([])
  const [query, setQuery] = useState('')
  const [stockFilter, setStockFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('newest')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 12
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState({ name: '', description: '', price: '', unit_cost: '', stock: '', reorder_level: '0', product_code: '', category_id: '', status: 'active', image: null })
  const [preview, setPreview] = useState(FALLBACK_IMAGE)
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newDraft, setNewDraft] = useState({ name: '', description: '', price: '', unit_cost: '', stock: '', reorder_level: '0', product_code: '', category_id: '', status: 'active', image: null })
  const [newPreview, setNewPreview] = useState(FALLBACK_IMAGE)
  const busyRef = useRef(false)
  const productDraft = product => ({
    name: product.name,
    description: product.description || '',
    price: product.price,
    unit_cost: product.unit_cost ?? '',
    stock: product.stock,
    reorder_level: product.reorder_level ?? 0,
    product_code: product.product_code || '',
    category_id: product.category_id ?? '',
    status: product.status || 'active',
    image: null,
  })

  useEffect(() => {
    let active = true
    const loadProducts = () => getProducts()
      .then(nextProducts => { if (active) setProducts(nextProducts) })
      .catch(error => { if (active) { setMessage(error.message); setMessageIsError(true) } })
    loadProducts()
    getCategories().then(categories => { if (active) setDatabaseCategories(categories) }).catch(error => {
      if (active) { setMessage(error.message); setMessageIsError(true) }
    })
    getAdminSettings().then(result => {
      if (active) setLowStockThreshold(result.settings.inventory.low_stock_threshold)
    }).catch(error => {
      if (active) { setMessage(error.message); setMessageIsError(true) }
    })
    const interval = window.setInterval(loadProducts, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  const groups = useMemo(() => {
    const categories = databaseCategories.map(category => ({
      key: String(category.id),
      label: category.name,
      products: products.filter(product => String(product.category_id) === String(category.id)),
    }))
    const knownIds = new Set(databaseCategories.map(category => String(category.id)))
    const uncategorized = products.filter(product => !knownIds.has(String(product.category_id)))
    return uncategorized.length ? [...categories, { key: 'uncategorized', label: 'Uncategorized', products: uncategorized }] : categories
  }, [databaseCategories, products])
  const PRODUCT_GROUPS = groups
  const groupedProducts = useMemo(() => Object.fromEntries(groups.map(group => [group.key, group.products])), [groups])
  const filtered = useMemo(() => {
    const matches = (groupedProducts[selectedGroup] || []).filter(product => {
      const searchMatch = `${product.name} ${product.id} ${product.product_code || ''} ${product.category_name || ''}`.toLowerCase().includes(query.trim().toLowerCase())
      const threshold = Number(product.reorder_level) || lowStockThreshold
      const stockMatch = stockFilter === 'all'
        || (stockFilter === 'out' && Number(product.stock) <= 0)
        || (stockFilter === 'low' && Number(product.stock) > 0 && Number(product.stock) <= threshold)
        || (stockFilter === 'available' && Number(product.stock) > threshold)
        || (stockFilter === 'inactive' && product.status === 'inactive')
      return searchMatch && stockMatch
    })
    return matches.sort((a, b) => {
      if (sortOrder === 'name') return a.name.localeCompare(b.name)
      if (sortOrder === 'price-low') return Number(a.price) - Number(b.price)
      if (sortOrder === 'price-high') return Number(b.price) - Number(a.price)
      if (sortOrder === 'stock-low') return Number(a.stock) - Number(b.stock)
      if (sortOrder === 'stock-high') return Number(b.stock) - Number(a.stock)
      return new Date(b.created_at || 0) - new Date(a.created_at || 0) || Number(b.id) - Number(a.id)
    })
  }, [groupedProducts, lowStockThreshold, query, selectedGroup, sortOrder, stockFilter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const visiblePage = Math.min(currentPage, pageCount)
  const pageProducts = filtered.slice((visiblePage - 1) * pageSize, visiblePage * pageSize)
  const editing = products.find(product => String(product.id) === String(editingId))
  const lowStockCount = products.filter(product => Number(product.stock) > 0 && Number(product.stock) <= (Number(product.reorder_level) || lowStockThreshold)).length
  const outOfStockCount = products.filter(product => Number(product.stock) <= 0).length
  const visibleGroups = groups.filter(group => !query.trim() || group.products.some(product => `${product.name} ${product.id} ${product.product_code || ''} ${product.category_name || ''}`.toLowerCase().includes(query.trim().toLowerCase()))).map(group => ({ ...group, image: group.products[0]?.image_url || FALLBACK_IMAGE }))

  function chooseProduct(product) {
    setSelectedProduct(product)
    setEditingId(null)
    setDraft(productDraft(product))
    setPreview(product.image_url || FALLBACK_IMAGE)
    setMessage('')
  }

  function chooseImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!ALLOWED_PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_SIZE) {
      setMessage('Choose a JPG, PNG, or WEBP photo up to 5 MB.')
      setMessageIsError(true)
      event.target.value = ''
      return
    }
    setDraft(current => ({ ...current, image: file }))
    setPreview(URL.createObjectURL(file))
  }

  function save(event) {
    event.preventDefault()
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const form = new FormData()
    form.append('name', draft.name)
    form.append('description', draft.description)
    form.append('price', draft.price)
    form.append('unit_cost', draft.unit_cost)
    form.append('stock', draft.stock)
    form.append('reorder_level', draft.reorder_level)
    form.append('product_code', draft.product_code)
    form.append('status', draft.status)
    if (draft.category_id !== '') form.append('category_id', draft.category_id)
    if (draft.image) form.append('image', draft.image)
    updateProduct(editingId, form).then(updatedProduct => {
      const selectedCategory = databaseCategories.find(item => String(item.id) === String(draft.category_id))
      const nextProduct = { ...editing, ...updatedProduct, name: draft.name, description: draft.description, price: Number(draft.price), unit_cost: Number(draft.unit_cost), stock: Number(draft.stock), status: draft.status, category_id: draft.category_id || editing.category_id, category_name: selectedCategory?.name || editing.category_name, image_url: updatedProduct.image_url || editing.image_url }
      setProducts(items => items.map(product => String(product.id) === String(editingId) ? nextProduct : product))
      setSelectedProduct(nextProduct)
      setEditingId(null)
      setMessage('Product updated successfully.')
      setMessageIsError(false)
    }).catch(error => { setMessage(error.message); setMessageIsError(true) }).finally(() => { busyRef.current = false; setBusy(false) })
  }

  function chooseNewImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!ALLOWED_PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_SIZE) {
      setMessage('Choose a JPG, PNG, or WEBP photo up to 5 MB.')
      setMessageIsError(true)
      event.target.value = ''
      return
    }
    setNewDraft(current => ({ ...current, image: file }))
    setNewPreview(URL.createObjectURL(file))
  }

  async function create(event) {
    event.preventDefault()
    if (busyRef.current) return
    if (!newDraft.image) {
      setMessage('Upload a product photo before creating this product.')
      setMessageIsError(true)
      return
    }
    busyRef.current = true
    setBusy(true)
    const form = new FormData()
    Object.entries(newDraft).forEach(([key, value]) => {
      if (key !== 'image' && value !== '') form.append(key, value)
    })
    if (newDraft.image) form.append('image', newDraft.image)
    try {
      const result = await createProduct(form)
      setProducts(items => [result.product, ...items])
      setSelectedGroup(String(result.product.category_id))
      setQuery('')
      setCreating(false)
      setMessage('Product created successfully.')
      setMessageIsError(false)
      setNewDraft({ name: '', description: '', price: '', unit_cost: '', stock: '', reorder_level: '0', product_code: '', category_id: '', status: 'active', image: null })
      setNewPreview(FALLBACK_IMAGE)
    } catch (error) {
      setMessage(error.message)
      setMessageIsError(true)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function removeProduct(product) {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await deleteProduct(product.id)
      setProducts(items => items.filter(item => String(item.id) !== String(product.id)))
      if (String(selectedProduct?.id) === String(product.id)) setSelectedProduct(null)
      setMessage(`${product.name} deleted.`)
      setMessageIsError(false)
    } catch (error) {
      setMessage(error.message)
      setMessageIsError(true)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const startEdit = product => {
    setDraft(productDraft(product))
    setPreview(product.image_url || FALLBACK_IMAGE)
    setEditingId(product.id)
    setMessage('')
  }

  return <main className="dash-main admin-products-page">
    <div className="page-head admin-products-head"><div><p className="eyebrow">CATALOG MANAGEMENT</p><h1>Products</h1><p>Browse supplies by category, review stock, and manage product details.</p></div><div className="admin-products-head-actions"><div className="admin-products-summary"><span><strong>{products.length}</strong> products</span><span><strong>{lowStockCount}</strong> low stock</span><span><strong>{outOfStockCount}</strong> out of stock</span></div><button className="admin-product-primary" onClick={() => { setCreating(true); setMessage('') }}>＋ Add product</button></div></div>
    {message && <div className={`admin-product-message ${messageIsError ? 'is-error' : ''}`} role={messageIsError ? 'alert' : 'status'}><span>{message}</span><button onClick={() => setMessage('')} aria-label="Dismiss message">×</button></div>}
    {!selectedGroup ? <section className="admin-product-categories" aria-label="Product categories">
      <div className="admin-product-section-heading">
        <div><p className="eyebrow">EXPLORE THE CATALOG</p><h2>Choose a category</h2><span>Select a collection to view and manage its products.</span></div>
        <label className="admin-product-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setCurrentPage(1) }} placeholder="Search all products" aria-label="Search all products" /></label>
      </div>
      <div className="admin-category-grid">{visibleGroups.length ? visibleGroups.map((group, index) => <button className="admin-category-card" key={group.key} onClick={() => { setSelectedGroup(group.key); setCurrentPage(1) }}><span className="admin-category-index">{String(index + 1).padStart(2, '0')}</span><span className="admin-category-art"><img src={group.image} alt="" /></span><span className="admin-category-copy"><strong>{group.label}</strong><small>{query.trim() ? groupedProducts[group.key].filter(product => `${product.name} ${product.id} ${product.product_code || ''} ${product.category_name || ''}`.toLowerCase().includes(query.trim().toLowerCase())).length : groupedProducts[group.key]?.length || 0} products</small></span><span className="admin-category-arrow" aria-hidden="true">↗</span></button>) : <div className="admin-products-empty"><p>No matching products.</p><button onClick={() => setQuery('')}>Clear search</button></div>}</div>
    </section> : <section className="admin-products-results">
      <div className="admin-products-breadcrumb"><button onClick={() => { setSelectedGroup(null); setQuery(''); setCurrentPage(1) }}>Products</button><span aria-hidden="true">/</span><strong>{PRODUCT_GROUPS.find(group => group.key === selectedGroup)?.label}</strong></div>
      <div className="admin-product-section-heading">
        <div><p className="eyebrow">{PRODUCT_GROUPS.find(group => group.key === selectedGroup)?.label.toUpperCase()}</p><h2>{PRODUCT_GROUPS.find(group => group.key === selectedGroup)?.label}</h2><span>{filtered.length} matching products</span></div>
        <label className="admin-product-search"><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={event => { setQuery(event.target.value); setCurrentPage(1) }} placeholder="Search this category" aria-label="Search products in this category" /></label>
      </div>
      <div className="admin-product-filters">
        <label>Stock status<select value={stockFilter} onChange={event => { setStockFilter(event.target.value); setCurrentPage(1) }}><option value="all">All products</option><option value="available">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option><option value="inactive">Inactive</option></select></label>
        <label>Sort by<select value={sortOrder} onChange={event => { setSortOrder(event.target.value); setCurrentPage(1) }}><option value="newest">Newest added</option><option value="name">Name</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="stock-low">Stock: low to high</option><option value="stock-high">Stock: high to low</option></select></label>
      </div>
      {filtered.length ? <>
        <div className="admin-product-grid">{pageProducts.map(product => { const stock = stockState(product.stock, Number(product.reorder_level) || lowStockThreshold); return <article className={`admin-product-card ${product.status === 'inactive' ? 'is-inactive' : ''}`} key={product.id}><button className="admin-product-card-main" onClick={() => chooseProduct(product)} aria-label={`View ${product.name}`}><span className="admin-product-image"><ProductImage product={product} /></span><span className="admin-product-card-copy"><span className="admin-product-overline"><small>SKU {product.product_code || product.id}</small><span className={`admin-stock-badge ${stock.className}`}><i />{product.status === 'inactive' ? 'Inactive' : stock.label}</span></span><strong className="admin-product-name">{product.name}</strong><span className="admin-product-category">{product.category_name || legacyCategories[product.category] || 'School Supplies'}</span><span className="admin-product-facts"><b>₱{Number(product.price).toFixed(2)}</b><span>{Number(product.stock)} units · min {Number(product.reorder_level) || lowStockThreshold}</span></span><small className="admin-product-date">Added {product.created_at ? new Date(product.created_at).toLocaleDateString() : '—'}</small></span></button><div className="admin-product-card-actions"><button onClick={() => chooseProduct(product)}>View details</button><button className="admin-product-edit" onClick={() => startEdit(product)}>Edit product</button><button className="admin-product-delete" onClick={() => removeProduct(product)}>Delete</button></div></article> })}</div>
        <nav className="admin-product-pagination" aria-label="Product pages"><span>Showing {(visiblePage - 1) * pageSize + 1}–{Math.min(visiblePage * pageSize, filtered.length)} of {filtered.length}</span><button disabled={visiblePage === 1} onClick={() => setCurrentPage(page => Math.max(1, page - 1))}>Previous</button><span>Page {visiblePage} of {pageCount}</span><button disabled={visiblePage >= pageCount} onClick={() => setCurrentPage(page => Math.min(pageCount, page + 1))}>Next</button></nav>
      </> : <div className="admin-products-empty"><p>No products match these filters.</p><button onClick={() => { setQuery(''); setStockFilter('all') }}>Clear filters</button></div>}
    </section>}
    {(selectedProduct || editing || creating) && <div className="admin-product-modal-backdrop" role="presentation" onClick={() => { setSelectedProduct(null); setEditingId(null); setCreating(false); setMessage('') }}>
      <section className="admin-product-modal" role="dialog" aria-modal="true" aria-labelledby="admin-product-dialog-title" onClick={event => event.stopPropagation()}>
        <button className="admin-product-modal-close" onClick={() => { setSelectedProduct(null); setEditingId(null); setCreating(false) }} aria-label="Close product details">×</button>
        {creating ? <form onSubmit={create}>
          <div className="admin-product-modal-heading"><p className="eyebrow">CATALOG MANAGEMENT</p><h2 id="admin-product-dialog-title">Add product</h2><span>New school supply</span></div>
          <img className="admin-edit-preview" src={newPreview} alt="New product image preview" onError={event => { event.currentTarget.src = FALLBACK_IMAGE }} />
          <label>Product image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseNewImage} required /></label>
          <label>Product name<input value={newDraft.name} onChange={event => setNewDraft({ ...newDraft, name: event.target.value })} required /></label>
          <label>Product code / SKU<input value={newDraft.product_code} onChange={event => setNewDraft({ ...newDraft, product_code: event.target.value })} maxLength="100" pattern="[A-Za-z0-9._-]+" required /></label>
          <label>Category<select value={newDraft.category_id} onChange={event => setNewDraft({ ...newDraft, category_id: event.target.value })} required><option value="">Choose category</option>{databaseCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Description<textarea value={newDraft.description} onChange={event => setNewDraft({ ...newDraft, description: event.target.value })} required /></label>
          <div className="admin-edit-fields">
            <label>Selling price<input type="number" min="0" step="0.01" value={newDraft.price} onChange={event => setNewDraft({ ...newDraft, price: event.target.value })} required /></label>
            <label>Unit cost<input type="number" min="0" step="0.01" value={newDraft.unit_cost} onChange={event => setNewDraft({ ...newDraft, unit_cost: event.target.value })} required /></label>
            <label>Opening stock<input type="number" min="0" step="1" value={newDraft.stock} onChange={event => setNewDraft({ ...newDraft, stock: event.target.value })} required /></label>
            <label>Minimum stock level<input type="number" min="0" step="1" value={newDraft.reorder_level} onChange={event => setNewDraft({ ...newDraft, reorder_level: event.target.value })} required /></label>
            <label>Product status<select value={newDraft.status} onChange={event => setNewDraft({ ...newDraft, status: event.target.value })} required><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          </div>
          <div className="admin-product-modal-actions"><button type="button" className="admin-product-secondary" onClick={() => setCreating(false)}>Cancel</button><button type="submit" className="admin-product-primary" disabled={busy}>{busy ? 'Creating...' : 'Create product'}</button></div>
        </form> : editing ? <form onSubmit={save}>
          <div className="admin-product-modal-heading"><p className="eyebrow">PRODUCT MANAGEMENT</p><h2 id="admin-product-dialog-title">Edit product</h2><span>SKU {editing.product_code || editing.id}</span></div>
          <img className="admin-edit-preview" src={preview} alt={`Preview of ${draft.name}`} onError={event => { event.currentTarget.src = FALLBACK_IMAGE }} />
          <label>Product image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseImage} /></label>
          <label>Product name<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} required /></label>
          <label>Product code / SKU<input value={draft.product_code} onChange={event => setDraft({ ...draft, product_code: event.target.value })} maxLength="100" pattern="[A-Za-z0-9._-]+" required /></label>
          <label>Category<select value={draft.category_id} onChange={event => setDraft({ ...draft, category_id: event.target.value })} required><option value="">Choose category</option>{databaseCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Description<textarea value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} required /></label>
          <div className="admin-edit-fields">
            <label>Selling price<input type="number" min="0" step="0.01" value={draft.price} onChange={event => setDraft({ ...draft, price: event.target.value })} required /></label>
            <label>Unit cost<input type="number" min="0" step="0.01" value={draft.unit_cost} onChange={event => setDraft({ ...draft, unit_cost: event.target.value })} required /></label>
            <label>Stock quantity<input type="number" min="0" step="1" value={draft.stock} onChange={event => setDraft({ ...draft, stock: event.target.value })} required /></label>
            <label>Minimum stock level<input type="number" min="0" step="1" value={draft.reorder_level} onChange={event => setDraft({ ...draft, reorder_level: event.target.value })} required /></label>
            <label>Product status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })} required><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
          </div>
          <div className="admin-product-modal-actions"><button type="button" className="admin-product-secondary" onClick={() => setEditingId(null)}>Cancel</button><button type="submit" className="admin-product-primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button></div>
        </form> : <>
          <div className="admin-product-detail-image"><ProductImage product={selectedProduct} /></div><div className="admin-product-detail-content">
            <p className="eyebrow">PRODUCT DETAILS</p><span className="admin-product-sku">SKU {selectedProduct.product_code || selectedProduct.id}</span><h2 id="admin-product-dialog-title">{selectedProduct.name}</h2><p className="admin-product-detail-category">{selectedProduct.category_name || legacyCategories[selectedProduct.category] || 'School Supplies'}</p>
            <div className="admin-product-detail-stats"><div><small>UNIT PRICE</small><strong>₱{Number(selectedProduct.price).toFixed(2)}</strong></div><div><small>UNIT COST</small><strong>₱{Number(selectedProduct.unit_cost || 0).toFixed(2)}</strong></div><div><small>STOCK</small><strong>{Number(selectedProduct.stock)} units</strong></div><div><small>MINIMUM STOCK</small><strong>{Number(selectedProduct.reorder_level) || lowStockThreshold} units</strong></div><div><small>PRODUCT STATUS</small><strong><span className={`admin-stock-badge ${selectedProduct.status === 'active' ? 'is-in' : 'is-out'}`}><i />{selectedProduct.status || 'active'}</span></strong></div></div>
            <p className="admin-product-description">{selectedProduct.description || 'No product description has been added.'}</p><div className="admin-product-modal-actions"><button className="admin-product-secondary" onClick={() => setSelectedProduct(null)}>Close</button><button className="admin-product-danger" onClick={() => removeProduct(selectedProduct)}>Delete product</button><button className="admin-product-primary" onClick={() => startEdit(selectedProduct)}>Edit product</button></div>
          </div>
        </>}
      </section>
    </div>}
  </main>
}

export default ProductsPage