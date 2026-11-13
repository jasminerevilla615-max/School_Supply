import { useEffect, useMemo, useRef, useState } from 'react'
import { cancelCustomerOrder, changeCustomerPassword, createOrder, getCategories, getCustomerProfile, getOrderDetails, getOrders, getProductReviews, getProducts, removeCustomerProfilePhoto, submitProductFeedback, updateCustomerEmail, updateCustomerProfile, uploadCustomerProfilePhoto } from '../../lib/api.js'
import ProductPhoto from '../products/ProductPhoto.jsx'
import NotificationCenter from '../notifications/NotificationCenter.jsx'
import CustomerNotifications from '../notifications/CustomerNotifications.jsx'
import RoleBackButton from '../dashboard/components/RoleBackButton.jsx'
import './customer-orders.css'

const customerSections = [
  ['home', 'Dashboard'],
  ['catalog', 'Product catalog'],
  ['new-arrivals', 'New arrivals'],
  ['categories', 'Categories'],
  ['notifications', 'Notifications'],
  ['cart', 'Cart'],
  ['orders', 'My orders'],
  ['profile', 'My Account'],
]

function normalizeOrderStatus(value) {
  const status = String(value || '').toLowerCase().replace(/[\s_-]/g, '')
  return { pendingconfirmation: 'pending', approved: 'confirmed', ready: 'readyforpickup', canceled: 'cancelled' }[status] || status
}

function orderStatusGroup(value) {
  const status = normalizeOrderStatus(value)
  if (status === 'pending') return 'pending'
  if (status === 'confirmed') return 'confirmed'
  if (status === 'processing') return 'processing'
  if (['readyforpickup', 'outfordelivery'].includes(status)) return 'ready'
  if (['completed', 'received'].includes(status)) return 'completed'
  if (['cancelled', 'rejected'].includes(status)) return 'cancelled'
  return 'other'
}

function cancellationSecondsRemaining(order, now = Date.now()) {
  const createdAt = order.created_at ? new Date(order.created_at).getTime() : Number.NaN
  if (!Number.isFinite(createdAt)) return 0
  return Math.max(0, Math.ceil((createdAt + 5 * 60 * 1000 - now) / 1000))
}

function formatCancellationCountdown(seconds) {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function ProductCard({ product, onDetails, onAdd, detailsLabel = 'View details' }) {
  return <article className="product-card customer-product-card"><button className="customer-product-image" type="button" onClick={() => onDetails(product)} aria-label={`View ${product.name} details`}><ProductPhoto src={product.image_url} alt={product.name} /></button><div className="product-info"><p>{product.category_name || 'School Supplies'}</p><h3>{product.name}</h3><span className="customer-product-description">{product.description || 'No product description available.'}</span>{Number(product.review_count) > 0 && <span className="customer-product-rating" aria-label={`${Number(product.average_rating).toFixed(1)} out of 5 from ${product.review_count} reviews`}>★ {Number(product.average_rating).toFixed(1)} <small>({product.review_count} reviews)</small></span>}<strong>₱{Number(product.price).toFixed(2)}</strong><span className={`stock-label ${product.stock > 0 ? 'in-stock' : 'out-of-stock'}`}>{product.stock > 0 ? `${product.stock} in stock` : 'Out of stock'}</span><div className="customer-product-actions"><button className="outline-button" type="button" onClick={() => onDetails(product)}>{detailsLabel}</button><button className="primary-button product-order-button" type="button" disabled={!product.stock} onClick={() => onAdd(product)}>{product.stock ? 'Add to cart' : 'Unavailable'}</button></div></div></article>
}

function CustomerProductDetails({ product, categoryName, onClose, onAdd }) {
  const [reviews, setReviews] = useState([])
  const [reviewError, setReviewError] = useState('')
  useEffect(() => {
    let active = true
    getProductReviews(product.id)
      .then(result => { if (active) setReviews(result.items || []) })
      .catch(error => { if (active) setReviewError(error.message) })
    return () => { active = false }
  }, [product.id])
  const average = reviews.length
    ? reviews.reduce((total, review) => total + Number(review.rating), 0) / reviews.length
    : Number(product.average_rating || 0)
  const count = reviews.length || Number(product.review_count || 0)
  return <div className="customer-modal-backdrop" role="presentation" onClick={onClose}>
    <section className="customer-product-modal" role="dialog" aria-modal="true" aria-labelledby="customer-product-title" onClick={event => event.stopPropagation()}>
      <button className="customer-modal-close" type="button" onClick={onClose} aria-label="Close product details">×</button>
      <ProductPhoto src={product.image_url} alt={product.name} />
      <div className="customer-product-detail-copy">
        <p className="eyebrow">{product.category_name || categoryName || 'SCHOOL SUPPLIES'}</p>
        <h2 id="customer-product-title">{product.name}</h2>
        <strong>₱{Number(product.price).toFixed(2)}</strong>
        <p>{product.description || 'A dependable essential for class, projects, and everyday learning.'}</p>
        <span className={`stock-label ${product.stock > 0 ? 'in-stock' : 'out-of-stock'}`}>{product.stock > 0 ? `${product.stock} available` : 'Out of stock'}</span>
        <div className="customer-product-review-summary"><strong>★ {count ? average.toFixed(1) : 'No ratings yet'}</strong>{count > 0 && <span>{count} {count === 1 ? 'review' : 'reviews'}</span>}</div>
        {reviewError && <p className="customer-dashboard-error" role="alert">{reviewError}</p>}
        <section className="customer-product-reviews"><h3>Customer reviews</h3>{reviews.length ? reviews.map(review => <article key={review.id}><div><strong>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</strong><small>{review.customer_name || 'Customer'} · {review.created_at ? new Date(review.created_at).toLocaleDateString() : 'Date unavailable'}</small></div>{review.review && <p>{review.review}</p>}</article>) : !reviewError && <p>No customer reviews yet.</p>}</section>
        <button className="primary-button" type="button" disabled={!product.stock} onClick={() => { onAdd(product); onClose() }}>{product.stock ? 'Add to cart' : 'Unavailable'} <span aria-hidden="true">→</span></button>
      </div>
    </section>
  </div>
}

function CustomerOrderDetails({ order, onClose }) {
  const [details, setDetails] = useState(null)
  const [error, setError] = useState('')
  const [feedbackDrafts, setFeedbackDrafts] = useState({})
  const [savingFeedbackId, setSavingFeedbackId] = useState(null)
  useEffect(() => {
    let active = true
    getOrderDetails(order.id)
      .then(value => { if (active) setDetails(value) })
      .catch(loadError => { if (active) setError(loadError.message) })
    return () => { active = false }
  }, [order.id])
  if (!order) return null
  const shownOrder = details || order
  const date = shownOrder.created_at ? new Date(shownOrder.created_at) : null
  const normalizedStatus = normalizeOrderStatus(shownOrder.status)
  const regularSteps = [
    { label: 'Order Placed', matches: ['pending', 'pendingconfirmation'] },
    { label: 'Order Confirmed', matches: ['confirmed', 'approved'] },
    { label: 'Preparing Order', matches: ['processing'] },
    { label: 'Ready for Pickup', matches: ['readyforpickup', 'outfordelivery'] },
    { label: 'Completed', matches: ['completed', 'received'] },
  ]
  const statusStep = regularSteps.findIndex(step => step.matches.includes(normalizedStatus))
  const terminalStatus = ['rejected', 'cancelled', 'canceled'].includes(normalizedStatus)
  const timeline = shownOrder.timeline || []
  const eventForStep = step => timeline.find(event => step.matches.includes(normalizeOrderStatus(event.status)))
  const timelineStep = Math.max(-1, ...timeline.map(event => regularSteps.findIndex(step => step.matches.includes(normalizeOrderStatus(event.status)))))
  const currentStep = terminalStatus ? Math.max(0, timelineStep) : statusStep >= 0 ? statusStep : timelineStep
  const canLeaveFeedback = normalizedStatus === 'completed'
  async function handleSubmitFeedback(productId) {
    const draft = feedbackDrafts[productId] || { rating: '', review: '' }
    setSavingFeedbackId(productId)
    setError('')
    try {
      const result = await submitProductFeedback(order.id, productId, Number(draft.rating), draft.review)
      setDetails(current => current ? {
        ...current,
        items: current.items.map(item => item.product_id === productId ? { ...item, feedback: result.feedback } : item),
      } : current)
    } catch (feedbackError) {
      setError(feedbackError.message)
    } finally {
      setSavingFeedbackId(null)
    }
  }
  return <div className="customer-modal-backdrop" role="presentation" onClick={onClose}>
    <section className="customer-order-modal" role="dialog" aria-modal="true" aria-labelledby="customer-order-title" onClick={event => event.stopPropagation()}>
      <button className="customer-modal-close" type="button" onClick={onClose} aria-label="Close order details">×</button>
      <p className="eyebrow">ORDER TRACKING</p>
      <h2 id="customer-order-title">Order #{shownOrder.id}</h2>
      {error && <p role="alert" className="customer-dashboard-error">{error}</p>}
      <div className="customer-order-detail-grid">
        <div><small>CUSTOMER</small><strong>{shownOrder.customer_name || 'Customer'}</strong></div>
        <div><small>CONTACT EMAIL</small><strong>{shownOrder.customer_email || 'Not provided'}</strong></div>
        <div><small>ORDER DATE</small><strong>{date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Date unavailable'}</strong></div>
        <div><small>ITEMS</small><strong>{details ? details.items.reduce((count, item) => count + Number(item.quantity), 0) : Number(order.item_count) || 0}</strong></div>
        <div><small>TOTAL</small><strong>₱{Number(shownOrder.total || 0).toFixed(2)}</strong></div>
        <div><small>PAYMENT METHOD</small><strong>{shownOrder.payment_method === 'cash_on_pickup' ? 'Cash on Pickup' : shownOrder.payment_method || 'Not recorded'}</strong></div>
        <div><small>PAYMENT STATUS</small><strong>{shownOrder.payment_status || 'Not recorded'}</strong></div>
        <div><small>CURRENT STATUS</small><strong className={`customer-order-status status-${String(shownOrder.status || '').toLowerCase().replace(/[\s_]+/g, '-')}`}>{shownOrder.status}</strong></div>
        <div><small>CONTACT NUMBER</small><strong>{shownOrder.contact_number || 'Not provided'}</strong></div>
        <div><small>DELIVERY ADDRESS</small><strong>{[shownOrder.address_line, shownOrder.barangay, shownOrder.city, shownOrder.province, shownOrder.postal_code].filter(Boolean).join(', ') || 'Not provided'}</strong></div>
      </div>
      {terminalStatus && <section className={`customer-order-terminal is-${normalizedStatus}`}><strong>Order {shownOrder.status}</strong>{(shownOrder.rejection_reason || [...timeline].reverse().find(item => item.reason)?.reason) && <p>{shownOrder.rejection_reason || [...timeline].reverse().find(item => item.reason)?.reason}</p>}</section>}
      <section className="customer-order-tracking"><h3>Order progress</h3><ol>{regularSteps.map((step, index) => {
          const event = eventForStep(step)
          const isCurrent = currentStep === index
          const isComplete = Boolean(event)
          return <li className={`${isComplete ? 'is-complete' : ''}${isCurrent ? ' is-current' : ''}`} key={step.label}><span className="customer-order-step-dot">{isComplete ? '✓' : index + 1}</span><div><strong>{step.label}</strong><small>{event?.created_at ? new Date(event.created_at).toLocaleString() : isCurrent && shownOrder.created_at ? new Date(shownOrder.created_at).toLocaleString() : 'Waiting'}</small>{event?.reason && <p>{event.reason}</p>}</div></li>
        })}</ol></section>
      {canLeaveFeedback && <p className="customer-received-at">Staff marked this pickup as completed{shownOrder.received_at ? ` on ${new Date(shownOrder.received_at).toLocaleString()}` : ''}. You can now leave feedback for purchased products.</p>}
      <section className="customer-order-items"><h3>Items</h3>{details ? details.items.map(item => <article key={`${item.product_id}-${item.name}`}><ProductPhoto src={item.image_url} alt={item.name} /><div><strong>{item.name}</strong><small>{item.category_name || 'School Supplies'} · Qty {item.quantity} · ₱{Number(item.unit_price).toFixed(2)} each</small>{canLeaveFeedback && (item.feedback ? <span className="customer-feedback-submitted">{'★'.repeat(item.feedback.rating)}{'☆'.repeat(5 - item.feedback.rating)} · Feedback submitted</span> : <form className="customer-product-feedback-form" onSubmit={event => { event.preventDefault(); handleSubmitFeedback(item.product_id) }}><fieldset className="customer-rating-stars"><legend>Rate this product</legend><div>{[1, 2, 3, 4, 5].map(rating => <button type="button" key={rating} aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`} aria-pressed={Number(feedbackDrafts[item.product_id]?.rating || 0) >= rating} onClick={() => setFeedbackDrafts(current => ({ ...current, [item.product_id]: { ...current[item.product_id], rating: String(rating), review: current[item.product_id]?.review || '' } }))}>★</button>)}</div></fieldset><label>Written feedback (optional)<textarea maxLength={1500} value={feedbackDrafts[item.product_id]?.review || ''} onChange={event => setFeedbackDrafts(current => ({ ...current, [item.product_id]: { rating: current[item.product_id]?.rating || '', review: event.target.value } }))} placeholder="Share your experience (up to 1,500 characters)" /></label><button type="submit" className="outline-button" disabled={savingFeedbackId === item.product_id || !feedbackDrafts[item.product_id]?.rating}>{savingFeedbackId === item.product_id ? 'Submitting…' : 'Submit feedback'}</button></form>)}</div><b>₱{Number(item.subtotal).toFixed(2)}</b></article>) : <p>Loading ordered items…</p>}
        {details && <footer className="customer-order-total-summary"><span>Items subtotal <strong>₱{details.items.reduce((total, item) => total + Number(item.subtotal || 0), 0).toFixed(2)}</strong></span><span>Order total <strong>₱{Number(shownOrder.total || 0).toFixed(2)}</strong></span></footer>}
      </section>
      <button className="primary-button" type="button" onClick={onClose}>Back to My Orders</button>
    </section>
  </div>
}

function CustomerAccount({ onProfileUpdated }) {
  const [profile, setProfile] = useState(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState(false)
  const [selectedPhoto, setSelectedPhoto] = useState(null)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState({ message: '', error: false })
  const photoInput = useRef(null)
  const previewUrl = useMemo(() => selectedPhoto ? URL.createObjectURL(selectedPhoto) : '', [selectedPhoto])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  useEffect(() => {
    let active = true
    getCustomerProfile()
      .then(value => {
        if (!active) return
        setProfile(value)
        setDisplayName(value.name || '')
        setEmail(value.email || '')
      })
      .catch(error => {
        if (active) setFeedback({ message: error.message, error: true })
      })
      .finally(() => {
        if (active) setLoadingProfile(false)
      })
    return () => { active = false }
  }, [])

  function applyProfile(nextProfile, message) {
    setProfile(nextProfile)
    setDisplayName(nextProfile.name || '')
    setEmail(nextProfile.email || '')
    setFeedback({ message, error: false })
    onProfileUpdated?.(nextProfile)
  }

  async function saveName(event) {
    event.preventDefault()
    setSaving(true)
    setFeedback({ message: '', error: false })
    try {
      const result = await updateCustomerProfile({ name: displayName })
      applyProfile(result.profile, result.message)
      setEditingName(false)
    } catch (error) {
      setFeedback({ message: error.message, error: true })
    } finally {
      setSaving(false)
    }
  }

  async function saveEmail(event) {
    event.preventDefault()
    setSaving(true)
    setFeedback({ message: '', error: false })
    try {
      const result = await updateCustomerEmail({ email, confirm_email: confirmEmail, current_password: emailPassword })
      applyProfile(result.profile, result.message)
      setConfirmEmail('')
      setEmailPassword('')
    } catch (error) {
      setFeedback({ message: error.message, error: true })
    } finally {
      setSaving(false)
    }
  }

  async function savePassword(event) {
    event.preventDefault()
    setSaving(true)
    setFeedback({ message: '', error: false })
    try {
      const result = await changeCustomerPassword({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      if (result.profile) setProfile(result.profile)
      setFeedback({ message: result.message, error: false })
    } catch (error) {
      setFeedback({ message: error.message, error: true })
    } finally {
      setSaving(false)
    }
  }

  function selectPhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFeedback({ message: 'Choose a JPG, PNG, or WEBP image.', error: true })
      event.target.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setFeedback({ message: 'The uploaded image exceeds the 5 MB limit.', error: true })
      event.target.value = ''
      return
    }
    setFeedback({ message: '', error: false })
    setSelectedPhoto(file)
  }

  async function savePhoto() {
    if (!selectedPhoto) return
    setSaving(true)
    setFeedback({ message: '', error: false })
    try {
      const result = await uploadCustomerProfilePhoto(selectedPhoto)
      setSelectedPhoto(null)
      if (photoInput.current) photoInput.current.value = ''
      applyProfile(result.profile, result.message)
    } catch (error) {
      setFeedback({ message: error.message, error: true })
    } finally {
      setSaving(false)
    }
  }

  async function removePhoto() {
    if (!window.confirm('Remove your current profile picture?')) return
    setSaving(true)
    setFeedback({ message: '', error: false })
    try {
      const result = await removeCustomerProfilePhoto()
      setSelectedPhoto(null)
      if (photoInput.current) photoInput.current.value = ''
      applyProfile(result.profile, result.message)
    } catch (error) {
      setFeedback({ message: error.message, error: true })
    } finally {
      setSaving(false)
    }
  }

  if (loadingProfile) return <section className="customer-account-page"><p role="status">Loading your account…</p></section>
  if (!profile) return <section className="customer-account-page"><p className="customer-account-alert is-error" role="alert">{feedback.message || 'Unable to load your account.'}</p></section>

  const initials = (profile.name || profile.username || 'S').trim().slice(0, 1).toUpperCase()
  const formatDate = value => {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-PH', { dateStyle: 'medium' })
  }

  return <section className="customer-account-page">
    {feedback.message && <p className={`customer-account-alert${feedback.error ? ' is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
    <header className="customer-account-hero">
      <div className="customer-account-photo-wrap">
        {previewUrl || profile.profile_image_url
          ? <img className="customer-account-photo" src={previewUrl || profile.profile_image_url} alt={`${profile.name}'s profile`} />
          : <span className="customer-account-photo is-default" aria-label="Default profile picture">{initials}</span>}
      </div>
      <div className="customer-account-hero-copy">
        <p className="eyebrow">CUSTOMER ACCOUNT</p>
        <h2>{profile.name || 'School Supply customer'}</h2>
        <span>{profile.email}</span>
        <small>Customer ID #{profile.id}</small>
      </div>
      <div className="customer-account-photo-actions">
        <label className="outline-button" htmlFor="customer-profile-photo">{selectedPhoto ? 'Choose another photo' : profile.profile_image_url ? 'Change photo' : 'Upload photo'}</label>
        <input ref={photoInput} id="customer-profile-photo" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={selectPhoto} />
        {selectedPhoto && <>
          <button type="button" className="primary-button" disabled={saving} onClick={savePhoto}>{saving ? 'Saving…' : 'Save photo'}</button>
          <button type="button" className="customer-account-secondary" disabled={saving} onClick={() => { setSelectedPhoto(null); if (photoInput.current) photoInput.current.value = '' }}>Cancel</button>
        </>}
        {!selectedPhoto && profile.profile_image_url && <button type="button" className="customer-account-secondary" disabled={saving} onClick={removePhoto}>Remove photo</button>}
        <small>JPG, PNG, or WEBP · Up to 5 MB</small>
      </div>
    </header>

    <div className="customer-account-sections">
      <section className="customer-account-card customer-account-personal">
        <header><div><p className="eyebrow">PERSONAL INFORMATION</p><h3>Profile and contact details</h3></div></header>
        <div className="customer-account-personal-grid">
          <div className="customer-account-subsection">
            <div className="customer-account-subheading"><h4>Profile details</h4>{!editingName && <button type="button" className="outline-button" onClick={() => { setDisplayName(profile.name || ''); setEditingName(true) }}>Edit Profile</button>}</div>
            <form className="customer-account-form" onSubmit={saveName}>
              <label>Nickname / display name<input value={displayName} maxLength={50} readOnly={!editingName} onChange={event => setDisplayName(event.target.value)} /></label>
              <label>Username<input value={profile.username || ''} readOnly aria-readonly="true" /></label>
              {editingName && <div className="customer-account-form-actions">
                <button type="button" className="customer-account-secondary" disabled={saving} onClick={() => { setDisplayName(profile.name || ''); setEditingName(false) }}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
              </div>}
            </form>
          </div>
          <div className="customer-account-subsection">
            <div className="customer-account-subheading"><h4>Email address</h4></div>
            <form className="customer-account-form" onSubmit={saveEmail}>
              <label>Current email address<input type="email" value={profile.email || ''} readOnly aria-readonly="true" /></label>
              <label>New email address<input type="email" autoComplete="email" required maxLength={255} value={email} onChange={event => setEmail(event.target.value)} /></label>
              <label>Confirm new email address<input type="email" autoComplete="off" required maxLength={255} value={confirmEmail} onChange={event => setConfirmEmail(event.target.value)} /></label>
              <label>Current password<input type={showPasswords ? 'text' : 'password'} autoComplete="current-password" required value={emailPassword} onChange={event => setEmailPassword(event.target.value)} /></label>
              <p className="customer-account-note">Email verification is not configured. Any saved email change will not be independently verified.</p>
              <div className="customer-account-form-actions">
                <button type="button" className="customer-account-secondary" disabled={saving} onClick={() => { setEmail(profile.email || ''); setConfirmEmail(''); setEmailPassword('') }}>Cancel</button>
                <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save email changes'}</button>
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="customer-account-card">
        <header><div><p className="eyebrow">SECURITY SETTINGS</p><h3>Change password</h3></div><button type="button" className="customer-account-secondary" aria-pressed={showPasswords} onClick={() => setShowPasswords(value => !value)}>{showPasswords ? 'Hide passwords' : 'Show passwords'}</button></header>
        <form className="customer-account-form" onSubmit={savePassword}>
          <label>Current password<input type={showPasswords ? 'text' : 'password'} autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
          <label>New password<input type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label>
          <label>Confirm new password<input type={showPasswords ? 'text' : 'password'} autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label>
          <p className="customer-account-note">Use at least 8 characters, including uppercase, lowercase, and a number. Other signed-in sessions will be invalidated.</p>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save new password'}</button>
        </form>
      </section>

      <section className="customer-account-card customer-account-details">
        <header><div><p className="eyebrow">ACCOUNT INFORMATION</p><h3>Account details</h3></div></header>
        <dl>
          <div><dt>Customer ID</dt><dd>#{profile.id}</dd></div>
          <div><dt>Username</dt><dd>{profile.username || '—'}</dd></div>
          <div><dt>Registered</dt><dd>{formatDate(profile.created_at)}</dd></div>
          <div><dt>Last updated</dt><dd>{formatDate(profile.updated_at)}</dd></div>
          <div><dt>Account status</dt><dd><span className={`customer-account-status is-${profile.status}`}>{profile.status}</span></dd></div>
        </dl>
      </section>
    </div>
  </section>
}

function CustomerDashboardHome({ name, orders, loadingOrders, ordersError, products, loadingProducts, cartCount, onNavigate, onProductDetails, onAddToCart, onOrderDetails }) {
  const counts = orders.reduce((summary, order) => {
    const status = String(order.status || '').toLowerCase().replace(/[\s_-]/g, '')
    summary.total += 1
    if (status === 'pending' || status === 'pendingconfirmation') summary.pending += 1
    if (status === 'processing') summary.processing += 1
    if (status === 'completed' || status === 'complete') summary.completed += 1
    return summary
  }, { total: 0, pending: 0, processing: 0, completed: 0 })
  const summaryCards = [
    { key: 'total', label: 'Total orders', value: counts.total, icon: '▣', destination: 'orders' },
    { key: 'pending', label: 'Pending', value: counts.pending, icon: '◷', destination: 'orders' },
    { key: 'processing', label: 'Processing', value: counts.processing, icon: '↻', destination: 'orders' },
    { key: 'completed', label: 'Completed', value: counts.completed, icon: '✓', destination: 'orders' },
  ]
  const actions = [
    ['catalog', 'Browse products', '▦'],
    ['categories', 'View categories', '◫'],
    ['orders', 'My orders', '▣'],
    ['cart', `My cart${cartCount ? ` (${cartCount})` : ''}`, '□'],
    ['notifications', 'Notifications', '◉'],
    ['profile', 'My profile', '♙'],
  ]
  const recommendations = products.filter(product => Number(product.stock) > 0).slice(0, 4)

  return <div className="customer-dashboard">
    <section className="customer-welcome-panel">
      <div>
        <p className="eyebrow">YOUR SCHOOL SUPPLY STORE</p>
        <h2>Welcome back,<br /><em>{name || 'Shopper'}.</em></h2>
        <p>Everything you need for a great school day, all in one place.</p>
        <button className="primary-button" type="button" onClick={() => onNavigate('catalog')}>Browse the catalog <span aria-hidden="true">→</span></button>
      </div>
      <div className="customer-welcome-art"><img src="/product-images/product-04.jpeg" alt="School notebook and supplies" /></div>
    </section>

    <section className="customer-dashboard-summary" aria-label="Order summary">
      {summaryCards.map(card => <button className="customer-summary-card" type="button" key={card.key} onClick={() => onNavigate(card.destination)}>
        <span className="customer-summary-icon" aria-hidden="true">{card.icon}</span>
        <span className="customer-summary-label">{card.label}</span>
        <strong>{loadingOrders || ordersError ? '—' : card.value}</strong>
        <span className="customer-summary-link">View orders <span aria-hidden="true">→</span></span>
      </button>)}
    </section>

    <section className="customer-panel customer-dashboard-actions">
      <div className="customer-section-heading"><div><p className="eyebrow">YOUR SHORTCUTS</p><h2>Quick actions</h2></div></div>
      <div className="customer-quick-action-grid">{actions.map(([destination, label, icon]) => <button type="button" key={destination} onClick={() => onNavigate(destination)}>
        <span aria-hidden="true">{icon}</span><strong>{label}</strong><b aria-hidden="true">→</b>
      </button>)}</div>
    </section>

    <div className="customer-dashboard-columns">
      <section className="customer-panel customer-dashboard-orders">
        <div className="customer-section-heading">
          <div><p className="eyebrow">YOUR PURCHASES</p><h2>Recent orders</h2></div>
          <button type="button" className="text-button" onClick={() => onNavigate('orders')}>View all orders <span aria-hidden="true">↗</span></button>
        </div>
        {ordersError ? <p className="customer-dashboard-error" role="alert">{ordersError}</p> : loadingOrders ? <p className="customer-dashboard-state" role="status">Loading your orders…</p> : orders.length ? (
          <div className="customer-recent-orders">
            {orders.slice(0, 4).map(order => <article className="customer-recent-order" key={order.id}>
              <div className="customer-recent-order-main"><span className="customer-order-icon" aria-hidden="true">▣</span><div><strong>Order #{order.id}</strong><small>{order.created_at ? new Date(order.created_at).toLocaleDateString() : 'Date unavailable'} · {Number(order.item_count) || 0} items</small></div></div>
              <span className={`customer-order-status status-${String(order.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{order.status}</span>
              <strong className="customer-recent-order-total">₱{Number(order.total || 0).toFixed(2)}</strong>
              <button type="button" className="customer-order-details" onClick={() => onOrderDetails(order)}>View details</button>
            </article>)}
          </div>
        ) : <div className="customer-dashboard-state"><strong>No orders yet</strong><span>Your order history will appear here after checkout.</span><button type="button" className="text-button" onClick={() => onNavigate('catalog')}>Find your supplies <span aria-hidden="true">→</span></button></div>}
      </section>

      <section className="customer-panel customer-dashboard-notifications">
        <CustomerNotifications preview onViewAll={() => onNavigate('notifications')} />
      </section>
    </div>

    <section className="customer-panel customer-dashboard-recommendations">
      <div className="customer-section-heading">
        <div><p className="eyebrow">READY FOR YOUR NEXT CLASS</p><h2>Available supplies</h2></div>
        <button type="button" className="text-button" onClick={() => onNavigate('catalog')}>View all products <span aria-hidden="true">↗</span></button>
      </div>
      {loadingProducts ? <p className="customer-dashboard-state" role="status">Loading available products…</p> : recommendations.length
        ? <div className="product-grid customer-products">{recommendations.map(product => <ProductCard key={product.id} product={product} onDetails={onProductDetails} onAdd={onAddToCart} detailsLabel="View product" />)}</div>
        : <div className="customer-dashboard-state"><strong>No products are currently in stock.</strong><span>Check back soon for available school supplies.</span></div>}
    </section>
  </div>
}

function CustomerPage({ name, email, userId, onLogout, onProfileUpdated }) {
  const [displayName, setDisplayName] = useState(name || '')
  const [displayEmail, setDisplayEmail] = useState(email || '')
  const [products, setProducts] = useState([])
  const [databaseCategories, setDatabaseCategories] = useState([])
  const categories = useMemo(() => Object.fromEntries(databaseCategories.map(item => [String(item.id), item.name])), [databaseCategories])
  const [section, setSectionState] = useState('home')
  const sectionHistory = useRef([])
  const setSection = nextSection => {
    if (nextSection === section) return
    if (nextSection === 'home') sectionHistory.current = []
    else sectionHistory.current.push(section)
    setSectionState(nextSection)
  }
  const [category, setCategory] = useState('all')
  const [productQuery, setProductQuery] = useState('')
  const [cart, setCart] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('cash_on_pickup')
  const [checkoutInfo, setCheckoutInfo] = useState({
    full_name: name || '',
    email: email || '',
    contact_number: '',
    address_line: '',
    barangay: '',
    city: '',
    province: '',
    postal_code: '',
  })
  const [checkoutFieldErrors, setCheckoutFieldErrors] = useState({})
  const [saveContactToProfile, setSaveContactToProfile] = useState(false)
  const [checkoutProfileLoading, setCheckoutProfileLoading] = useState(true)
  const [confirmedOrder, setConfirmedOrder] = useState(null)
  const [orders, setOrders] = useState([])
  const [ordersClock, setOrdersClock] = useState(0)
  const orderListRequestVersion = useRef(0)
  const [ordersError, setOrdersError] = useState('')
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderStartDate, setOrderStartDate] = useState('')
  const [orderEndDate, setOrderEndDate] = useState('')
  const [orderActionId, setOrderActionId] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const checkoutKey = useRef('')

  useEffect(() => {
    const loadProducts = () => getProducts().then(setProducts).catch(loadError => setError(loadError.message)).finally(() => setLoading(false))
    const loadOrders = () => {
      const requestVersion = ++orderListRequestVersion.current
      return getOrders()
      .then(items => {
        if (requestVersion !== orderListRequestVersion.current) return
        setOrders(items.filter(order => String(order.user_id) === String(userId)))
        setOrdersError('')
      })
      .catch(loadError => {
        if (requestVersion === orderListRequestVersion.current) setOrdersError(loadError.message)
      })
      .finally(() => setLoadingOrders(false))
    }
    getCategories().then(setDatabaseCategories).catch(loadError => setError(loadError.message))
    loadProducts()
    loadOrders()
    const interval = window.setInterval(() => {
      loadProducts()
      loadOrders()
    }, 15000)
    return () => window.clearInterval(interval)
  }, [userId])

  useEffect(() => {
    if (!orders.some(order => orderStatusGroup(order.status) === 'pending' && cancellationSecondsRemaining(order) > 0)) return undefined
    const clockTimeout = window.setTimeout(() => setOrdersClock(Date.now()), 0)
    const interval = window.setInterval(() => setOrdersClock(Date.now()), 1000)
    return () => {
      window.clearTimeout(clockTimeout)
      window.clearInterval(interval)
    }
  }, [orders])

  useEffect(() => {
    let active = true
    getCustomerProfile()
      .then(profile => {
        if (!active) return
        setCheckoutInfo(current => ({
          ...current,
          full_name: profile.name || current.full_name,
          email: profile.email || current.email,
          contact_number: profile.contact_number || current.contact_number,
          address_line: profile.address_line || current.address_line,
          barangay: profile.barangay || current.barangay,
          city: profile.city || current.city,
          province: profile.province || current.province,
          postal_code: profile.postal_code || current.postal_code,
        }))
      })
      .catch(loadError => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setCheckoutProfileLoading(false) })
    return () => { active = false }
  }, [])

  const filteredProducts = useMemo(() => products.filter(product => {
    const matchesCategory = category === 'all' || String(product.category_id) === String(category)
    const searchable = `${product.name} ${product.category_name || ''} ${product.description || ''}`.toLowerCase()
    return matchesCategory && searchable.includes(productQuery.trim().toLowerCase())
  }), [category, productQuery, products])
  const newArrivals = useMemo(() => [...products].sort((first, second) => new Date(second.created_at || 0) - new Date(first.created_at || 0)).slice(0, 8), [products])
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0)
  const cartTotal = cart.reduce((total, item) => total + Number(item.product.price) * item.quantity, 0)
  const orderSummary = [
    { key: 'all', label: 'All', icon: '▤', count: orders.length },
    { key: 'pending', label: 'To Confirm', icon: '◷', count: orders.filter(order => orderStatusGroup(order.status) === 'pending').length },
    { key: 'to-process', label: 'To Process', icon: '↻', count: orders.filter(order => ['confirmed', 'processing'].includes(orderStatusGroup(order.status))).length },
    { key: 'ready', label: 'Ready for Pickup', icon: '⌖', count: orders.filter(order => orderStatusGroup(order.status) === 'ready').length },
    { key: 'completed', label: 'Completed', icon: '★', count: orders.filter(order => orderStatusGroup(order.status) === 'completed').length },
    { key: 'cancelled', label: 'Cancelled', icon: '×', count: orders.filter(order => orderStatusGroup(order.status) === 'cancelled').length },
  ]
  const filteredOrders = orders.filter(order => {
    const searchText = `#${order.id} ${order.id} ${order.product_names || ''} ${order.first_product_name || ''}`.toLowerCase()
    const orderDate = order.created_at ? new Date(order.created_at) : null
    const validDate = orderDate && Number.isFinite(orderDate.getTime())
    const matchesDate = (!orderStartDate || (validDate && orderDate >= new Date(`${orderStartDate}T00:00:00`)))
      && (!orderEndDate || (validDate && orderDate <= new Date(`${orderEndDate}T23:59:59.999`)))
    return searchText.includes(orderSearch.trim().toLowerCase())
      && (orderStatusFilter === 'all'
        || (orderStatusFilter === 'to-process' && ['confirmed', 'processing'].includes(orderStatusGroup(order.status)))
        || orderStatusGroup(order.status) === orderStatusFilter)
      && matchesDate
  }).sort((first, second) => new Date(second.created_at || 0) - new Date(first.created_at || 0) || Number(second.id) - Number(first.id))
  const title = section === 'checkout' ? 'Checkout'
    : section === 'confirmation' ? 'Order Confirmation'
      : customerSections.find(([key]) => key === section)?.[1] || 'Home'
  const goBack = () => setSectionState(sectionHistory.current.pop() || 'home')
  const openNotificationProduct = notification => {
    const existing = products.find(item => String(item.id) === String(notification.product_id))
    if (existing) {
      setSection('catalog')
      setSelectedProduct(existing)
      return
    }
    getProducts().then(freshProducts => {
      setProducts(freshProducts)
      const product = freshProducts.find(item => String(item.id) === String(notification.product_id))
      if (product) {
        setSection('catalog')
        setSelectedProduct(product)
      }
    }).catch(loadError => setError(loadError.message))
  }
  const addToCart = product => {
    setCart(current => {
      const existing = current.find(item => item.product.id === product.id)
      if (existing) return current.map(item => item.product.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) } : item)
      return [...current, { product, quantity: 1 }]
    })
    setMessage(`${product.name} added to your cart.`)
    setError('')
  }
  async function cancelOrder(order) {
    if (orderStatusGroup(order.status) !== 'pending') return
    if (cancellationSecondsRemaining(order) <= 0) {
      setOrdersError('The 5-minute cancellation period for this order has expired.')
      return
    }
    if (!window.confirm(`Cancel order #${order.id}? You can cancel only within 5 minutes after placing it, while it is waiting for Staff confirmation.`)) return
    setOrderActionId(order.id)
    setError('')
    setMessage('')
    try {
      const result = await cancelCustomerOrder(order.id)
      setOrders(current => current.map(item => item.id === order.id ? { ...item, ...result.order } : item))
      setMessage(result.message)
    } catch (cancelError) {
      setOrdersError(cancelError.message)
    } finally {
      setOrderActionId(null)
    }
  }
  async function buyOrderAgain(order) {
    setOrderActionId(order.id)
    setError('')
    setMessage('')
    try {
      const [details, currentProducts] = await Promise.all([getOrderDetails(order.id), getProducts()])
      setProducts(currentProducts)
      const currentById = new Map(currentProducts.map(product => [String(product.id), product]))
      const availableLines = (details?.items || []).flatMap(item => {
        const product = currentById.get(String(item.product_id))
        if (!product || product.status !== 'active' || Number(product.stock) <= 0) return []
        return [{ product, quantity: Math.max(1, Number(item.quantity) || 1) }]
      })
      if (!availableLines.length) {
        setError('None of the products in this order are currently available.')
        return
      }
      const nextCart = [...cart]
      let addedQuantity = 0
      for (const { product, quantity } of availableLines) {
        const index = nextCart.findIndex(item => String(item.product.id) === String(product.id))
        const previousQuantity = index >= 0 ? nextCart[index].quantity : 0
        const nextQuantity = Math.max(previousQuantity, Math.min(Number(product.stock), previousQuantity + quantity))
        if (index >= 0) nextCart[index] = { product, quantity: nextQuantity }
        else nextCart.push({ product, quantity: nextQuantity })
        addedQuantity += Math.max(0, nextQuantity - previousQuantity)
      }
      setCart(nextCart)
      if (!addedQuantity) {
        setError('The products from this order are already in your cart up to their available stock.')
      } else {
        const unavailableCount = (details?.items || []).length - availableLines.length
        setMessage(unavailableCount ? `${addedQuantity} item${addedQuantity === 1 ? '' : 's'} added. Some products are no longer available.` : `${addedQuantity} item${addedQuantity === 1 ? '' : 's'} added to your cart.`)
      }
    } catch (buyAgainError) {
      setError(buyAgainError.message)
    } finally {
      setOrderActionId(null)
    }
  }
  const updateQuantity = (productId, quantity) => setCart(current => current.map(item => {
    if (item.product.id !== productId) return item
    const stock = Math.max(0, Math.floor(Number(item.product.stock) || 0))
    const requested = Number(quantity)
    if (!Number.isFinite(requested)) return item
    return { ...item, quantity: Math.max(1, Math.min(Math.floor(requested), stock || 1)) }
  }))
  const removeFromCart = productId => setCart(current => current.filter(item => item.product.id !== productId))
  const clearCart = () => {
    if (window.confirm('Remove all items from your cart?')) setCart([])
  }

  async function beginCheckout() {
    if (!cart.length || busy) return
    setBusy(true)
    setError('')
    try {
      const currentProducts = await getProducts()
      const latestById = new Map(currentProducts.map(product => [String(product.id), product]))
      const refreshedCart = cart.map(item => ({
        ...item,
        product: latestById.get(String(item.product.id)) || item.product,
      }))
      setCart(refreshedCart)
      const unavailable = refreshedCart.find(item => {
        const latest = latestById.get(String(item.product.id))
        return !latest || latest.status !== 'active' || Number(latest.stock) < item.quantity
      })
      if (unavailable) {
        setError(`${unavailable.product.name} no longer has the requested quantity in stock. Review your cart and try again.`)
        return
      }
      const signature = JSON.stringify(refreshedCart.map(item => [item.product.id, item.quantity]))
      if (checkoutKey.current?.signature !== signature) {
        checkoutKey.current = {
          signature,
          key: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }
      }
      setPaymentMethod('cash_on_pickup')
      setCheckoutFieldErrors({})
      setSaveContactToProfile(false)
      setSection('checkout')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setBusy(false)
    }
  }

  function validateCheckout() {
    const errors = {}
    if (!checkoutInfo.full_name.trim() || checkoutInfo.full_name.trim().length > 255) errors.full_name = 'Enter your full name using no more than 255 characters.'
    if (checkoutInfo.email.trim().length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkoutInfo.email.trim())) errors.email = 'Enter a valid contact email address.'
    if (!/^(09\d{9}|\+639\d{9})$/.test(checkoutInfo.contact_number.trim())) errors.contact_number = 'Enter a valid Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).'
    if (!checkoutInfo.address_line.trim()) errors.address_line = 'Enter your house number, building, and street.'
    if (!checkoutInfo.barangay.trim()) errors.barangay = 'Enter your barangay.'
    if (!checkoutInfo.city.trim()) errors.city = 'Enter your city or municipality.'
    if (!checkoutInfo.province.trim()) errors.province = 'Enter your province.'
    if (checkoutInfo.postal_code.trim().length > 20) errors.postal_code = 'Postal code must be 20 characters or fewer.'
    if (paymentMethod !== 'cash_on_pickup') errors.payment_method = 'Cash on Pickup is the only supported payment method.'
    setCheckoutFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  async function placeOrder(event) {
    event?.preventDefault()
    if (!cart.length || busy || checkoutProfileLoading || !validateCheckout()) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const payload = await createOrder({
        items: cart.map(item => ({ product_id: item.product.id, quantity: item.quantity })),
        payment_method: 'cash_on_pickup',
        idempotency_key: checkoutKey.current.key,
        customer_info: {
          ...checkoutInfo,
          save_to_profile: saveContactToProfile,
        },
      })
      const placedOrder = { ...payload.order, item_count: cartCount }
      const requestVersion = ++orderListRequestVersion.current
      setCart([])
      setConfirmedOrder(placedOrder)
      setOrders(current => [placedOrder, ...current.filter(order => String(order.id) !== String(placedOrder.id))])
      getOrders()
        .then(items => {
          if (requestVersion !== orderListRequestVersion.current) return
          const customerOrders = items.filter(order => String(order.user_id) === String(userId))
          setOrders(customerOrders.some(order => String(order.id) === String(placedOrder.id))
            ? customerOrders
            : [placedOrder, ...customerOrders])
        })
        .catch(loadError => setOrdersError(loadError.message))
      setSection('confirmation')
      checkoutKey.current = null
    } catch (checkoutError) {
      setError(checkoutError.message)
      setCheckoutFieldErrors(checkoutError.details?.field_errors || {})
    } finally {
      setBusy(false)
    }
  }

  function updateCheckoutField(field, value) {
    setCheckoutInfo(current => ({ ...current, [field]: value }))
    setCheckoutFieldErrors(current => ({ ...current, [field]: '' }))
  }

  function renderProducts(list) {
    if (loading) return <p className="customer-empty-state" role="status">Loading products...</p>
    if (!list.length) return <p className="customer-empty-state">No products in this category yet.</p>
    return <div className="product-grid customer-products">{list.map(product => <ProductCard key={product.id} product={product} onDetails={setSelectedProduct} onAdd={addToCart} />)}</div>
  }

  function renderSection() {
    if (section === 'home') return <CustomerDashboardHome
      name={displayName}
      orders={orders}
      loadingOrders={loadingOrders}
      ordersError={ordersError}
      products={products}
      loadingProducts={loading}
      cartCount={cartCount}
      onNavigate={setSection}
      onProductDetails={setSelectedProduct}
      onAddToCart={addToCart}
      onOrderDetails={setSelectedOrder}
    />
    if (section === 'new-arrivals') return <section className="customer-panel"><div className="customer-section-heading"><div><p className="eyebrow">JUST ADDED</p><h2>New arrivals</h2></div></div>{loading ? <p className="customer-empty-state" role="status">Loading products...</p> : newArrivals.length ? <div className="product-grid customer-products">{newArrivals.map(product => <ProductCard key={product.id} product={product} onDetails={setSelectedProduct} onAdd={addToCart} detailsLabel="View product" />)}</div> : <p className="customer-empty-state">No new products are available yet.</p>}</section>
    if (section === 'notifications') return <section className="customer-panel"><CustomerNotifications onOpenOrder={() => setSection('orders')} /></section>
    if (section === 'catalog') return <section className="customer-panel"><div className="customer-section-heading"><div><p className="eyebrow">SHOP SCHOOL ESSENTIALS</p><h2>Product catalog</h2></div><div className="customer-catalog-filters"><label className="customer-filter">Category<select aria-label="Filter products by category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{databaseCategories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="customer-filter">Search<input type="search" aria-label="Search products" value={productQuery} onChange={event => setProductQuery(event.target.value)} placeholder="Name, category, or description" /></label></div></div>{renderProducts(filteredProducts)}</section>
    if (section === 'categories') return <section className="customer-panel customer-categories-panel"><div className="customer-section-heading"><div><p className="eyebrow">SHOP BY SUBJECT</p><h2>Categories</h2><p className="customer-categories-intro">Find the right essentials for every class, project, and idea.</p></div></div><div className="customer-category-grid">{databaseCategories.map((item, index) => {
      const categoryProducts = products.filter(product => String(product.category_id) === String(item.id))
      const featuredProduct = categoryProducts.find(product => product.image_url)
      return <button className="customer-category-card" type="button" key={item.id} aria-label={`Browse ${item.name}, ${categoryProducts.length} ${categoryProducts.length === 1 ? 'product' : 'products'}`} onClick={() => { setCategory(String(item.id)); setSection('catalog') }}>
        <span className="customer-category-art">
          {featuredProduct ? <ProductPhoto className="customer-category-image" src={featuredProduct.image_url} alt="" /> : <span className="customer-category-placeholder" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span>}
          <span className="customer-category-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          <span className="customer-category-arrow" aria-hidden="true">↗</span>
        </span>
        <span className="customer-category-copy">
          <strong>{item.name}</strong>
          <span className="customer-category-count">{categoryProducts.length} {categoryProducts.length === 1 ? 'product' : 'products'}</span>
          <b>Browse supplies <span aria-hidden="true">→</span></b>
        </span>
      </button>
    })}</div></section>
    if (section === 'cart') return <section className="customer-cart-page">
      <header className="customer-cart-heading">
        <div><p className="eyebrow">YOUR SELECTION</p><h2>Shopping cart</h2><p>Review your school essentials before placing your order.</p></div>
        <span className="customer-cart-count">{cartCount} {cartCount === 1 ? 'item' : 'items'}</span>
      </header>
      {cart.length ? <div className="customer-cart-layout">
        <div className="customer-cart-main">
          <div className="customer-cart-list">
            {cart.map(({ product, quantity }) => <article className="customer-cart-row" key={product.id}>
              <ProductPhoto src={product.image_url} alt={product.name} />
              <div className="customer-cart-product">
                <small>{product.category_name || categories[product.category] || 'School Supplies'}</small>
                <strong>{product.name}</strong>
                <span>₱{Number(product.price).toFixed(2)} <small>each</small></span>
              </div>
              <div className="customer-cart-quantity">
                <span>Quantity</span>
                <div className="customer-quantity-control" role="group" aria-label={`Quantity of ${product.name}`}>
                  <button type="button" aria-label={`Decrease ${product.name} quantity`} disabled={quantity <= 1} onClick={() => updateQuantity(product.id, quantity - 1)}>−</button>
                  <output aria-live="polite">{quantity}</output>
                  <button type="button" aria-label={`Increase ${product.name} quantity`} disabled={quantity >= Number(product.stock)} onClick={() => updateQuantity(product.id, quantity + 1)}>+</button>
                </div>
              </div>
              <div className="customer-cart-subtotal"><small>Subtotal</small><strong>₱{(Number(product.price) * quantity).toFixed(2)}</strong></div>
              <button className="customer-remove" type="button" onClick={() => removeFromCart(product.id)} aria-label={`Remove ${product.name} from cart`}>Remove</button>
            </article>)}
          </div>
          <div className="customer-cart-actions">
            <button type="button" className="outline-button" onClick={() => setSection('catalog')}>← Continue shopping</button>
            <button type="button" className="customer-cart-clear" onClick={clearCart}>Clear cart</button>
          </div>
        </div>
        <aside className="customer-cart-summary" aria-label="Order summary">
          <p className="eyebrow">READY WHEN YOU ARE</p>
          <h3>Order summary</h3>
          <div className="customer-cart-summary-line"><span>Subtotal</span><strong>₱{cartTotal.toFixed(2)}</strong></div>
          <div className="customer-cart-summary-line"><span>Total items</span><strong>{cartCount}</strong></div>
          <div className="customer-cart-summary-total"><span>Order total</span><strong>₱{cartTotal.toFixed(2)}</strong></div>
          <p className="customer-cart-summary-note">Delivery fees and discounts are not applied at checkout.</p>
          <button className="primary-button" type="button" disabled={busy} onClick={beginCheckout}>Proceed to Checkout <span aria-hidden="true">→</span></button>
          <span className="customer-cart-secure-note">Your order will be submitted for confirmation.</span>
        </aside>
      </div> : <div className="customer-cart-empty">
        <span className="customer-cart-empty-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M7 10h5l4.2 21.2a3 3 0 0 0 3 2.4h17.1a3 3 0 0 0 2.9-2.2L43 17H14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="21" cy="40" r="2.5" fill="currentColor"/><circle cx="35" cy="40" r="2.5" fill="currentColor"/></svg></span>
        <h3>Your cart is currently empty.</h3>
        <p>Browse our school supplies and add the essentials you need to get started.</p>
        <button className="primary-button" type="button" onClick={() => setSection('catalog')}>Browse products <span aria-hidden="true">→</span></button>
      </div>}
    </section>
    if (section === 'checkout') return <section className="customer-checkout-page">
      <header className="customer-cart-heading"><div><p className="eyebrow">FINAL REVIEW</p><h2>Checkout</h2><p>Confirm your order and choose how you will pay at pickup.</p></div></header>
      {!cart.length ? <div className="customer-empty-state"><p>Your cart is empty. Add products before checking out.</p><button className="primary-button" onClick={() => setSection('catalog')}>Browse products</button></div> : <div className="customer-checkout-layout">
        <form className="customer-checkout-layout" onSubmit={placeOrder} noValidate>
          <section className="customer-checkout-card">
            <h3>Customer Information</h3>
            {checkoutProfileLoading && <p className="customer-checkout-loading" role="status">Loading your saved account information…</p>}
            <div className="customer-checkout-fields">
              <label className="customer-checkout-field">Full Name
                <input autoComplete="name" maxLength={255} value={checkoutInfo.full_name} onChange={event => updateCheckoutField('full_name', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.full_name)} aria-describedby={checkoutFieldErrors.full_name ? 'checkout-full-name-error' : undefined} />
                {checkoutFieldErrors.full_name && <small className="customer-checkout-field-error" id="checkout-full-name-error">{checkoutFieldErrors.full_name}</small>}
              </label>
              <label className="customer-checkout-field">Gmail / Contact Email
                <input type="text" inputMode="email" autoComplete="email" maxLength={255} value={checkoutInfo.email} onChange={event => updateCheckoutField('email', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.email)} aria-describedby={checkoutFieldErrors.email ? 'checkout-email-error' : undefined} />
                {checkoutFieldErrors.email && <small className="customer-checkout-field-error" id="checkout-email-error">{checkoutFieldErrors.email}</small>}
              </label>
              <label className="customer-checkout-field">Contact Number
                <input type="tel" inputMode="tel" autoComplete="tel" maxLength={32} placeholder="09XXXXXXXXX or +639XXXXXXXXX" value={checkoutInfo.contact_number} onChange={event => updateCheckoutField('contact_number', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.contact_number)} aria-describedby={checkoutFieldErrors.contact_number ? 'checkout-phone-error' : undefined} />
                {checkoutFieldErrors.contact_number && <small className="customer-checkout-field-error" id="checkout-phone-error">{checkoutFieldErrors.contact_number}</small>}
              </label>
            </div>
            <h4 className="customer-checkout-subheading">Complete Address</h4>
            <div className="customer-checkout-fields customer-checkout-address-fields">
              <label className="customer-checkout-field customer-checkout-field-wide">House Number / Building / Street
                <input autoComplete="address-line1" maxLength={255} value={checkoutInfo.address_line} onChange={event => updateCheckoutField('address_line', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.address_line)} aria-describedby={checkoutFieldErrors.address_line ? 'checkout-address-error' : undefined} />
                {checkoutFieldErrors.address_line && <small className="customer-checkout-field-error" id="checkout-address-error">{checkoutFieldErrors.address_line}</small>}
              </label>
              <label className="customer-checkout-field">Barangay
                <input autoComplete="address-level3" maxLength={120} value={checkoutInfo.barangay} onChange={event => updateCheckoutField('barangay', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.barangay)} aria-describedby={checkoutFieldErrors.barangay ? 'checkout-barangay-error' : undefined} />
                {checkoutFieldErrors.barangay && <small className="customer-checkout-field-error" id="checkout-barangay-error">{checkoutFieldErrors.barangay}</small>}
              </label>
              <label className="customer-checkout-field">City / Municipality
                <input autoComplete="address-level2" maxLength={120} value={checkoutInfo.city} onChange={event => updateCheckoutField('city', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.city)} aria-describedby={checkoutFieldErrors.city ? 'checkout-city-error' : undefined} />
                {checkoutFieldErrors.city && <small className="customer-checkout-field-error" id="checkout-city-error">{checkoutFieldErrors.city}</small>}
              </label>
              <label className="customer-checkout-field">Province
                <input autoComplete="address-level1" maxLength={120} value={checkoutInfo.province} onChange={event => updateCheckoutField('province', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.province)} aria-describedby={checkoutFieldErrors.province ? 'checkout-province-error' : undefined} />
                {checkoutFieldErrors.province && <small className="customer-checkout-field-error" id="checkout-province-error">{checkoutFieldErrors.province}</small>}
              </label>
              <label className="customer-checkout-field">Postal Code <span>(optional)</span>
                <input autoComplete="postal-code" maxLength={20} value={checkoutInfo.postal_code} onChange={event => updateCheckoutField('postal_code', event.target.value)} aria-invalid={Boolean(checkoutFieldErrors.postal_code)} aria-describedby={checkoutFieldErrors.postal_code ? 'checkout-postal-error' : undefined} />
                {checkoutFieldErrors.postal_code && <small className="customer-checkout-field-error" id="checkout-postal-error">{checkoutFieldErrors.postal_code}</small>}
              </label>
            </div>
            <label className="customer-checkout-save-contact"><input type="checkbox" checked={saveContactToProfile} onChange={event => setSaveContactToProfile(event.target.checked)} /><span>Save this contact number and address to my account for next time.</span></label>
            <h3>Review Items</h3>
            <div className="customer-checkout-items">{cart.map(({ product, quantity }) => <article key={product.id}><ProductPhoto src={product.image_url} alt={product.name} /><div><strong>{product.name}</strong><small>Quantity {quantity} · ₱{Number(product.price).toFixed(2)} each</small></div><b><small>Subtotal</small>₱{(Number(product.price) * quantity).toFixed(2)}</b></article>)}</div>
            <h3>Payment Method</h3>
            <label className="customer-payment-option"><input type="radio" name="payment-method" value="cash_on_pickup" checked readOnly /><span><strong>Cash on Pickup (COP)</strong><small>Cash is collected by Staff when you pick up your order. Your payment remains unpaid until then.</small></span></label>
            {checkoutFieldErrors.payment_method && <small className="customer-checkout-field-error" role="alert">{checkoutFieldErrors.payment_method}</small>}
          </section>
          <aside className="customer-cart-summary">
            <p className="eyebrow">ORDER TOTAL</p><h3>Order Summary</h3>
            <div className="customer-cart-summary-line"><span>Subtotal</span><strong>₱{cartTotal.toFixed(2)}</strong></div>
            <div className="customer-cart-summary-line"><span>Total items</span><strong>{cartCount}</strong></div>
            <div className="customer-cart-summary-line"><span>Pickup Fee</span><strong>₱0.00</strong></div>
            <div className="customer-cart-summary-total"><span>Final Total</span><strong>₱{cartTotal.toFixed(2)}</strong></div>
            <p className="customer-cart-summary-note">No online payment or delivery is configured. Your payment remains unpaid until collected and confirmed by Staff.</p>
            <button className="primary-button" type="submit" disabled={busy || checkoutProfileLoading}>{busy ? 'Submitting order…' : 'Place Order'} <span aria-hidden="true">→</span></button>
            <button className="customer-checkout-back" type="button" disabled={busy} onClick={() => setSection('cart')}>Back to cart</button>
          </aside>
        </form>
      </div>}
    </section>
    if (section === 'confirmation' && confirmedOrder) return <section className="customer-checkout-confirmation">
      <span className="customer-confirmation-mark" aria-hidden="true">✓</span><p className="eyebrow">ORDER RECEIVED</p><h2>Your order has been placed!</h2><p>Your order has been successfully submitted and is now waiting for staff confirmation.</p>
      <div className="customer-confirmation-summary">
        <span>Order ID <strong>#{confirmedOrder.id}</strong></span>
        <span>Order date <strong>{confirmedOrder.created_at ? new Date(confirmedOrder.created_at).toLocaleString() : 'Just now'}</strong></span>
        <span>Total amount <strong>₱{Number(confirmedOrder.total).toFixed(2)}</strong></span>
        <span>Payment method <strong>Cash on Pickup</strong></span>
        <span>Order status <strong>{confirmedOrder.status || 'Pending Confirmation'}</strong></span>
      </div>
      <div><button className="primary-button" type="button" onClick={() => { setSelectedOrder(null); setOrderStatusFilter('all'); setSection('orders') }}>View My Orders</button><button className="outline-button" type="button" onClick={() => setSection('catalog')}>Continue Shopping</button></div>
    </section>
    if (section === 'orders') return <section className="customer-orders-page">
      <header className="customer-orders-heading">
        <div><p className="eyebrow">ORDER STATUS AND HISTORY</p><h2>My Orders</h2><p>Track and manage all your purchases in one place.</p></div>
        <span className="customer-orders-total">{orders.length} {orders.length === 1 ? 'order' : 'orders'}</span>
      </header>
      <div className="customer-order-tabs" role="tablist" aria-label="Filter orders by status">
        {orderSummary.map(card => <button type="button" role="tab" key={card.key} className={`customer-order-tab${orderStatusFilter === card.key ? ' is-selected' : ''}`} aria-selected={orderStatusFilter === card.key} onClick={() => setOrderStatusFilter(card.key)}>
          <span>{card.label}</span><b>{card.count}</b>
        </button>)}
      </div>
      <section className="customer-orders-browser" aria-label="Your orders">
        <div className="customer-orders-toolbar">
          <label className="customer-orders-search">Search orders<input type="search" value={orderSearch} onChange={event => setOrderSearch(event.target.value)} placeholder="Order ID or product name" /></label>
          <label>Status<select value={orderStatusFilter} onChange={event => setOrderStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="pending">To Confirm</option><option value="to-process">To Process</option><option value="ready">Ready for Pickup</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
          <label>From date<input type="date" value={orderStartDate} onChange={event => setOrderStartDate(event.target.value)} /></label>
          <label>To date<input type="date" value={orderEndDate} onChange={event => setOrderEndDate(event.target.value)} /></label>
          {(orderSearch || orderStatusFilter !== 'all' || orderStartDate || orderEndDate) && <button type="button" className="customer-orders-clear" onClick={() => { setOrderSearch(''); setOrderStatusFilter('all'); setOrderStartDate(''); setOrderEndDate('') }}>Clear filters</button>}
        </div>
        {ordersError && <p className="customer-dashboard-error" role="alert">{ordersError}</p>}
        {loadingOrders ? <p className="customer-empty-state" role="status">Loading your orders…</p> : !orders.length ? <div className="customer-orders-empty">
          <span className="customer-orders-empty-icon" aria-hidden="true">▤</span><h3>You haven't placed any orders yet.</h3><p>Your purchases will appear here once you place an order.</p><button className="primary-button" type="button" onClick={() => setSection('catalog')}>Browse products <span aria-hidden="true">→</span></button>
        </div> : filteredOrders.length ? <div className="customer-order-cards">
          {filteredOrders.map(order => {
            const group = orderStatusGroup(order.status)
            const secondsRemaining = cancellationSecondsRemaining(order, ordersClock)
            const cancelable = group === 'pending' && secondsRemaining > 0
            const productLabel = order.product_names || order.first_product_name || 'Order items'
            const date = order.created_at ? new Date(order.created_at) : null
            return <article className="customer-order-card" key={order.id}>
              <header className="customer-order-card-header">
                <div><small>School Supply Store</small><strong>Order #{order.id}</strong></div>
                <span className={`customer-order-status status-${group}`}>{order.status || 'Status unavailable'}</span>
              </header>
              <div className="customer-order-card-product">
                {order.first_product_image_url ? <ProductPhoto src={order.first_product_image_url} alt="" /> : <span className="customer-order-product-placeholder" aria-hidden="true">▤</span>}
                <div><small>{Number(order.item_count) || 0} {Number(order.item_count) === 1 ? 'item' : 'items'}</small><strong title={productLabel}>{productLabel}</strong><small>Qty {order.first_product_quantity || 1} · ₱{Number(order.first_product_unit_price || 0).toFixed(2)} each</small></div>
              </div>
              <div className="customer-order-card-meta">
                <div><small>ORDER DATE</small><strong>{date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString() : 'Date unavailable'}</strong></div>
                <div><small>PAYMENT</small><strong>Cash on Pickup</strong><span>{order.payment_status || 'Unpaid'}</span></div>
                <div><small>TOTAL</small><strong className="customer-order-card-total">₱{Number(order.total || 0).toFixed(2)}</strong></div>
              </div>
              <footer className="customer-order-card-actions">
                <button type="button" className="customer-order-action is-primary" onClick={() => setSelectedOrder(order)}>View details</button>
                <button type="button" className="customer-order-action" onClick={() => setSelectedOrder(order)}>Track order</button>
                <button type="button" className="customer-order-action" disabled={orderActionId === order.id} onClick={() => buyOrderAgain(order)}>{orderActionId === order.id ? 'Adding…' : 'Buy again'}</button>
                {group === 'completed' && <button type="button" className="customer-order-action" onClick={() => setSelectedOrder(order)}>Leave feedback</button>}
                {cancelable
                  ? <button type="button" className="customer-order-action is-danger" disabled={orderActionId === order.id} onClick={() => cancelOrder(order)}>{orderActionId === order.id ? 'Cancelling…' : `Cancel · ${formatCancellationCountdown(secondsRemaining)}`}</button>
                  : group === 'pending' && <span className="customer-order-cancel-expired">5-minute cancellation period ended</span>}
              </footer>
            </article>
          })}
        </div> : <div className="customer-orders-no-results"><span aria-hidden="true">⌕</span><h3>No matching orders</h3><p>Adjust your search, status, or date filters to see more orders.</p><button type="button" className="customer-order-action" onClick={() => { setOrderSearch(''); setOrderStatusFilter('all'); setOrderStartDate(''); setOrderEndDate('') }}>Reset filters</button></div>}
      </section>
    </section>
    if (section === 'profile') return <CustomerAccount onProfileUpdated={profile => { setDisplayName(profile.name || ''); setDisplayEmail(profile.email || ''); setCheckoutInfo(current => ({ ...current, full_name: profile.name || current.full_name, email: profile.email || current.email, contact_number: profile.contact_number || current.contact_number, address_line: profile.address_line || current.address_line, barangay: profile.barangay || current.barangay, city: profile.city || current.city, province: profile.province || current.province, postal_code: profile.postal_code || current.postal_code })); onProfileUpdated?.(profile) }} />
    return null
  }

  return <main className="customer-console"><aside className="customer-sidebar"><a className="customer-console-brand" href="#/home" onClick={event => { event.preventDefault(); setSection('home') }}><span className="logo-mark">SS</span><span>School Supply<small>Customer space</small></span></a><p className="customer-role">SHOP & MANAGE</p><nav aria-label="Customer navigation">{customerSections.map(([key, label]) => <button className={section === key ? 'active' : ''} key={key} onClick={() => setSection(key)}><span aria-hidden="true">{key === 'home' ? '⌂' : key === 'catalog' ? '▦' : key === 'categories' ? '◫' : key === 'cart' ? '□' : key === 'orders' ? '↗' : '○'}</span>{label}{key === 'cart' && cartCount > 0 && <b>{cartCount}</b>}</button>)}</nav><div className="customer-sidebar-footer"><span>{displayName || displayEmail}</span><button className="customer-logout" onClick={onLogout}>Logout <span aria-hidden="true">↗</span></button></div></aside><section className="customer-content"><header className="customer-topbar"><div><p className="eyebrow">CUSTOMER SPACE</p><h1>{title}</h1></div><div className="customer-top-actions"><NotificationCenter onOpenProduct={openNotificationProduct} /><span className="customer-user">{displayEmail}</span><button className="customer-cart-button" onClick={() => setSection('cart')} aria-label={`Open cart with ${cartCount} items`}>Cart <b>{cartCount}</b></button></div></header><div className="customer-body">{(message || error) && <div className={`customer-feedback ${error ? 'is-error' : 'is-success'}`} role={error ? 'alert' : 'status'}><span>{error || message}</span><button onClick={() => { setError(''); setMessage('') }} aria-label="Dismiss message">×</button></div>}{section !== 'home' && <RoleBackButton onClick={goBack} />}{renderSection()}</div></section>{selectedProduct && <CustomerProductDetails product={selectedProduct} categoryName={categories[selectedProduct.category]} onAdd={addToCart} onClose={() => setSelectedProduct(null)} />}{selectedOrder && <CustomerOrderDetails order={selectedOrder} onClose={() => setSelectedOrder(null)} />}</main>
}

export default CustomerPage
