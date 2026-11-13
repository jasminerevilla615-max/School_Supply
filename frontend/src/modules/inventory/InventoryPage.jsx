import { useEffect, useState } from 'react'
import { addStock, getProducts } from '../../lib/api.js'
import ProductPhoto from '../products/ProductPhoto.jsx'
import './inventory.css'

function InventoryPage() {
  const [products, setProducts] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function loadProducts() {
    return getProducts().then(setProducts).catch(loadError => setError(loadError.message))
  }

  useEffect(() => {
    loadProducts()
  }, [])

  async function stockIn(event) {
    event.preventDefault()
    setMessage('')
    setError('')
    try {
      const result = await addStock(selectedId, quantity)
      setMessage(result.message || 'Stock received.')
      setQuantity(1)
      await loadProducts()
    } catch (stockError) {
      setError(stockError.message)
    }
  }

  return (
    <div className="inventory-page">
      <header className="inventory-header">
        <div><h1>Inventory</h1><p>Track available stock and receive new items.</p></div>
        <form className="stock-form" onSubmit={stockIn}>
          <label>Product
            <select value={selectedId} onChange={event => setSelectedId(event.target.value)} required>
              <option value="">Select a product</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label>Quantity
            <input type="number" min="1" value={quantity} onChange={event => setQuantity(event.target.value)} required />
          </label>
          <button type="submit">Receive Stock</button>
        </form>
      </header>
      {message && <p className="inventory-message">{message}</p>}
      {error && <p className="inventory-error" role="alert">{error}</p>}
      <div className="inventory-table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Status</th></tr></thead>
          <tbody>
            {products.map(product => (
              <tr key={product.id}>
                <td><span className="inventory-product-name"><ProductPhoto className="inventory-product-photo" src={product.image_url} alt={product.name} />{product.name}</span></td>
                <td>{product.category_name || product.category || '—'}</td>
                <td>{product.stock}</td>
                <td><span className={product.stock <= 6 ? 'stock-low' : 'stock-ok'}>{product.stock <= 6 ? 'Low Stock' : 'In Stock'}</span></td>
              </tr>
            ))}
            {!products.length && <tr><td colSpan="4">No products found.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default InventoryPage
