const API_BASE = '/api'

async function apiFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, credentials: 'include' })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error('The server is not running. Start Flask, then try again.', { cause: error })
    }
    throw error
  }
}

export async function createManagedUser(name, username, email, password, confirmPassword, position) {
  return request(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, name, email, password, confirm_password: confirmPassword, position }),
  }, 'Unable to create the account. Please try again.')
}
async function readResponse(response, fallbackMessage) {
  const body = await response.text()
  let payload = {}
  if (body.trim()) {
    try {
      payload = JSON.parse(body)
    } catch {
      if (response.status >= 500) {
        throw new Error('The server could not complete your request. Check that the backend and database are running, then try again.')
      }
      throw new Error(response.ok ? fallbackMessage : 'The server sent an unexpected response. Please try again.')
    }
  }
  if (!response.ok) {
    const error = new Error(payload.error || fallbackMessage)
    error.details = payload
    throw error
  }
  return payload
}

export async function getProducts() {
  const response = await apiFetch(`${API_BASE}/products`)
  const products = await readResponse(response, 'Unable to load products. Please try again.')
  return products.map(product => ({
    ...product,
    category_id: product.category,
    category: categoryKey(product.category_name),
    image_url: product.image_url || '',
  }))
}

export async function getCategories() {
  const payload = await request(`${API_BASE}/categories`, {}, 'Unable to load product categories.')
  return payload.items || []
}

export async function getNotifications() {
  const payload = await request(`${API_BASE}/notifications`, {}, 'Unable to load notifications.')
  return payload.items || []
}

export async function markNotificationRead(notificationId) {
  return request(`${API_BASE}/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' }, 'Unable to mark this notification as read.')
}

export async function markAllNotificationsRead() {
  return request(`${API_BASE}/notifications/read-all`, { method: 'PATCH' }, 'Unable to mark all notifications as read.')
}

export async function deleteNotification(notificationId) {
  return request(`${API_BASE}/notifications/${encodeURIComponent(notificationId)}`, { method: 'DELETE' }, 'Unable to delete this notification.')
}

export async function getInventory() {
  const payload = await request(`${API_BASE}/inventory`, {}, 'Unable to load inventory.')
  return payload.items || []
}

export async function getOrders() {
  const payload = await request(`${API_BASE}/orders`, {}, 'Unable to load orders.')
  return payload.items || []
}

export async function getOrderDetails(orderId) {
  const payload = await request(`${API_BASE}/orders/${encodeURIComponent(orderId)}`, {}, 'Unable to load order details.')
  return payload.order
}

export async function cancelCustomerOrder(orderId) {
  return request(`${API_BASE}/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
  }, 'Unable to cancel this order.')
}

export async function submitProductFeedback(orderId, productId, rating, review) {
  return request(`${API_BASE}/orders/${encodeURIComponent(orderId)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: productId, rating, review }),
  }, 'Unable to submit product feedback.')
}

export async function getProductReviews(productId) {
  return request(`${API_BASE}/products/${encodeURIComponent(productId)}/reviews`, {}, 'Unable to load product reviews.')
}

export async function getProductFeedback() {
  const payload = await request(`${API_BASE}/product-feedback`, {}, 'Unable to load product feedback.')
  return payload.items || []
}

export async function createOrder(order) {
  return request(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  }, 'Unable to place your order.')
}

export async function updateOrder(orderId, status, reason = '') {
  return request(`${API_BASE}/orders/${encodeURIComponent(orderId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, reason }),
  }, 'Unable to update the order.')
}

export async function updateOrderPayment(orderId, paymentStatus) {
  return request(`${API_BASE}/orders/${encodeURIComponent(orderId)}/payment`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment_status: paymentStatus }),
  }, 'Unable to update payment status.')
}

export async function getSales() {
  const payload = await request(`${API_BASE}/sales`, {}, 'Unable to load sales.')
  return payload.items || []
}

export async function getAdminDashboardOverview() {
  return request(`${API_BASE}/admin/dashboard/overview`, {}, 'Unable to load the admin dashboard.')
}

export async function getSalesAnalytics(filters) {
  const query = new URLSearchParams(Object.entries(filters || {}).filter(([, value]) => value !== '' && value != null))
  return request(`${API_BASE}/admin/analytics${query.size ? `?${query.toString()}` : ''}`, {}, 'Unable to load the sales report.')
}

export async function getAdminProfile() {
  return request(`${API_BASE}/admin/profile`, {}, 'Unable to load your administrator profile.')
}

export async function updateAdminProfile(changes) {
  return request(`${API_BASE}/admin/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  }, 'Unable to update your administrator profile.')
}

export async function changeAdminPassword(currentPassword, newPassword, confirmPassword) {
  return request(`${API_BASE}/admin/profile/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword }),
  }, 'Unable to update your password.')
}

export async function getAdminProfileActivity() {
  return request(`${API_BASE}/admin/profile/activity`, {}, 'Unable to load your account activity.')
}

export async function getStaffProfile() {
  return request(`${API_BASE}/staff/profile`, {}, 'Unable to load your staff profile.')
}

export async function updateStaffProfile(changes) {
  return request(`${API_BASE}/staff/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  }, 'Unable to update your staff profile.')
}

export async function changeStaffPassword(currentPassword, newPassword, confirmPassword) {
  return request(`${API_BASE}/staff/profile/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword }),
  }, 'Unable to update your password.')
}

export async function getStaffProfileActivity() {
  const payload = await request(`${API_BASE}/staff/profile/activity`, {}, 'Unable to load your account activity.')
  return payload.items || []
}

export async function uploadStaffProfilePhoto(file) {
  const body = new FormData()
  body.append('photo', file)
  return request(`${API_BASE}/staff/profile/photo`, { method: 'PUT', body }, 'Unable to upload your profile picture.')
}

export async function removeStaffProfilePhoto() {
  return request(`${API_BASE}/staff/profile/photo`, { method: 'DELETE' }, 'Unable to remove your profile picture.')
}

export async function getAdminSettings() {
  return request(`${API_BASE}/admin/settings`, {}, 'Unable to load system settings.')
}

export async function saveAdminSettings(settings) {
  return request(`${API_BASE}/admin/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  }, 'Unable to save system settings.')
}

export async function uploadStoreLogo(file) {
  const formData = new FormData()
  formData.append('image', file)
  return request(`${API_BASE}/admin/settings/logo`, { method: 'POST', body: formData }, 'Unable to upload the store logo.')
}

export async function createCategory(name, description = '') {
  return request(`${API_BASE}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) }, 'Unable to create the category.')
}

export async function updateCategory(categoryId, name, description = '') {
  return request(`${API_BASE}/categories/${encodeURIComponent(categoryId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) }, 'Unable to update the category.')
}

export async function deleteCategory(categoryId) {
  return request(`${API_BASE}/categories/${encodeURIComponent(categoryId)}`, { method: 'DELETE' }, 'Unable to delete the category.')
}

export async function updateInventory(productId, quantity, reorderLevel, location) {
  return request(`${API_BASE}/inventory/${encodeURIComponent(productId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity, reorder_level: reorderLevel, location }) }, 'Unable to update inventory.')
}

function categoryKey(name = '') {
  const value = name.toLowerCase()
  if (value.includes('writing')) return 'writing'
  if (value.includes('paper') || value.includes('notebook')) return 'paper'
  if (value.includes('bag')) return 'bags'
  if (value.includes('art')) return 'art'
  if (value.includes('tech') || value.includes('calculator')) return 'tech'
  return 'all'
}

export async function createProduct(formData) {
  return request(`${API_BASE}/products`, { method: 'POST', body: formData }, 'Unable to create the product.')
}

export async function updateProduct(productId, changes) {
  const response = await apiFetch(`${API_BASE}/products/${productId}`, {
    method: 'PUT',
    ...(changes instanceof FormData ? { body: changes } : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }),
  })
  const product = await readResponse(response, 'Unable to update product. Please try again.')
  return product
}

export async function addStock(productId, amount) {
  const response = await apiFetch(`${API_BASE}/products/${productId}/stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  })
  return readResponse(response, 'Unable to add stock. Please try again.')
}

export async function login(email, password) {
  return request(`${API_BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }, 'Unable to sign in. Please try again.')
}

export async function register(name, email, password, confirmPassword) {
  return request(`${API_BASE}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, confirm_password: confirmPassword }) }, 'Unable to create account. Please try again.')
}

export async function getRegistrationStatus() {
  return request(`${API_BASE}/auth/registration-status`, {}, 'Unable to check customer registration availability.')
}

export async function getCurrentUser() {
  const response = await apiFetch(`${API_BASE}/auth/me`)
  if (response.status === 401) return null
  return readResponse(response, 'Your session could not be verified.')
}

export async function getCustomerProfile() {
  const payload = await request(`${API_BASE}/customer/profile`, {}, 'Unable to load your profile.')
  return payload.profile
}

export async function updateCustomerProfile(changes) {
  return request(`${API_BASE}/customer/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }, 'Unable to update your profile.')
}

export async function updateCustomerEmail(changes) {
  return request(`${API_BASE}/customer/profile/email`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }, 'Unable to update your email address.')
}

export async function changeCustomerPassword(changes) {
  return request(`${API_BASE}/customer/profile/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }, 'Unable to change your password.')
}

export async function uploadCustomerProfilePhoto(file) {
  const body = new FormData()
  body.append('photo', file)
  return request(`${API_BASE}/customer/profile/photo`, { method: 'PUT', body }, 'Unable to upload your profile picture.')
}

export async function removeCustomerProfilePhoto() {
  return request(`${API_BASE}/customer/profile/photo`, { method: 'DELETE' }, 'Unable to remove your profile picture.')
}

export async function logout() {
  return request(`${API_BASE}/auth/logout`, { method: 'POST' }, 'Unable to sign out. Please try again.')
}

export async function heartbeat() {
  const response = await apiFetch(`${API_BASE}/auth/heartbeat`, { method: 'POST' })
  return readResponse(response, 'Your session could not be refreshed.')
}

export async function getMonitoringStats() {
  return readResponse(await apiFetch(`${API_BASE}/admin/monitoring/stats`), 'Unable to load monitoring statistics.')
}

export async function getMonitoringUsers(filters) {
  return readResponse(await apiFetch(`${API_BASE}/admin/monitoring/users${Object.keys(filters || {}).length ? `?${new URLSearchParams(filters).toString()}` : ''}`), 'Unable to load monitored users.')
}

export async function getMonitoringSessions(filters) {
  return readResponse(await apiFetch(`${API_BASE}/admin/monitoring/sessions${Object.keys(filters || {}).length ? `?${new URLSearchParams(filters).toString()}` : ''}`), 'Unable to load login history.')
}

export async function getMonitoringActivity(filters) {
  return readResponse(await apiFetch(`${API_BASE}/admin/monitoring/activity${Object.keys(filters || {}).length ? `?${new URLSearchParams(filters).toString()}` : ''}`), 'Unable to load activity logs.')
}

export async function getAdminActivityLogs(filters) {
  const query = new URLSearchParams(Object.entries(filters || {}).filter(([, value]) => value !== '' && value != null))
  return request(`${API_BASE}/admin/activity-logs${query.size ? `?${query.toString()}` : ''}`, {}, 'Unable to load activity logs.')
}

async function request(url, options, fallbackMessage) {
  try {
    const response = await apiFetch(url, options)
    return readResponse(response, fallbackMessage)
  } catch (error) {
    if (error instanceof TypeError) throw new Error('The server is not running. Start Flask, then try again.', { cause: error })
    throw new Error(error.message, { cause: error })
  }
}

export async function updateStaffAccount(email, changes) {
  return request(`${API_BASE}/admin/staff/${encodeURIComponent(email)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) }, 'Unable to update the staff account.')
}

export async function updateUserStatus(email, status) {
  return request(`${API_BASE}/admin/users/${encodeURIComponent(email)}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }, 'Unable to update account status.')
}

export async function deleteStaffAccount(email) {
  return request(`${API_BASE}/admin/staff/${encodeURIComponent(email)}`, { method: 'DELETE' }, 'Unable to delete the staff account.')
}

export async function deleteProduct(productId) {
  return request(`${API_BASE}/products/${encodeURIComponent(productId)}`, { method: 'DELETE' }, 'Unable to delete product.')
}