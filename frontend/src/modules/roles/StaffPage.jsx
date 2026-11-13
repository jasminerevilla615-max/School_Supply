import { useEffect, useRef, useState } from 'react'
import { getCurrentUser, getOrderDetails, getOrders, getProductFeedback, getProducts, getSales, updateOrder, updateOrderPayment } from '../../lib/api.js'
import ProductPhoto from '../products/ProductPhoto.jsx'
import NotificationCenter from '../notifications/NotificationCenter.jsx'
import RoleBackButton from '../dashboard/components/RoleBackButton.jsx'
import StaffAccountPage from './StaffAccountPage.jsx'

const sections = [['dashboard', 'Dashboard'], ['tasks', 'Assigned Tasks'], ['products', 'Products'], ['orders', 'Customer / Orders'], ['feedback', 'Product Feedback'], ['transactions', 'Transactions'], ['reports', 'Reports'], ['notifications', 'Notifications'], ['profile', 'Profile / Account']]

function StaffPage({ name: initialName, username: initialUsername, email: initialEmail, position: initialPosition, contactNumber: initialContactNumber, profileImageUrl: initialProfileImageUrl, darkMode, onThemeChange, onProfileUpdated, onNavigate, onLogout }) {
  const [section, setSectionState] = useState('dashboard')
  const sectionHistory = useRef([])
  const selectedProductDetailsRef = useRef(null)
  const taskModalRef = useRef(null)
  const feedbackModalRef = useRef(null)
  const orderNotificationRef = useRef(null)
  const accountMenuRef = useRef(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [accountView, setAccountView] = useState('profile')
  const setSection = nextSection => {
    if (nextSection === section) return
    if (nextSection === 'dashboard') sectionHistory.current = []
    else sectionHistory.current.push(section)
    setSectionState(nextSection)
  }
  const [profile, setProfile] = useState({ name: initialName || '', username: initialUsername || '', email: initialEmail || '', position: initialPosition || '', contact_number: initialContactNumber || '', profile_image_url: initialProfileImageUrl || '' })
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [ordersList, setOrdersList] = useState([])
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')
  const [orderPaymentFilter, setOrderPaymentFilter] = useState('all')
  const [orderDateFilter, setOrderDateFilter] = useState('all')
  const [orderSort, setOrderSort] = useState('newest')
  const [ordersReferenceTime] = useState(() => Date.now())
  const [sales, setSales] = useState([])
  const [transactionSearch, setTransactionSearch] = useState('')
  const [transactionStatusFilter, setTransactionStatusFilter] = useState('all')
  const [transactionMethodFilter, setTransactionMethodFilter] = useState('all')
  const [transactionDateFilter, setTransactionDateFilter] = useState('all')
  const [transactionSort, setTransactionSort] = useState('newest')
  const [selectedTransaction, setSelectedTransaction] = useState(null)
  const [transactionsReferenceTime] = useState(() => Date.now())
  const transactionModalRef = useRef(null)
  const [reportPeriod, setReportPeriod] = useState('all')
  const [reportStartDate, setReportStartDate] = useState('')
  const [reportEndDate, setReportEndDate] = useState('')
  const [reportReferenceDate] = useState(() => new Date())
  const [feedback, setFeedback] = useState([])
  const [ordersError, setOrdersError] = useState('')
  const [salesError, setSalesError] = useState('')
  const [feedbackError, setFeedbackError] = useState('')
  const [ordersLoading, setOrdersLoading] = useState(true)
  const [salesLoading, setSalesLoading] = useState(true)
  const [feedbackLoading, setFeedbackLoading] = useState(true)
  const [savingOrderId, setSavingOrderId] = useState(null)
  const [expandedOrderId, setExpandedOrderId] = useState(null)
  const [expandedOrder, setExpandedOrder] = useState(null)
  const [notificationFeedbackTarget, setNotificationFeedbackTarget] = useState(null)
  const [notificationTransactionTarget, setNotificationTransactionTarget] = useState(null)
  const [productSearch, setProductSearch] = useState('')
  const [productAvailability, setProductAvailability] = useState('all')
  const [productCategory, setProductCategory] = useState('all')
  const [productSort, setProductSort] = useState('newest')
  const [loadError, setLoadError] = useState('')
  const [selectedProductId, setSelectedProductId] = useState(null)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskStatusFilter, setTaskStatusFilter] = useState('all')
  const [taskPriorityFilter, setTaskPriorityFilter] = useState('all')
  const [selectedTask, setSelectedTask] = useState(null)
  const [feedbackSearch, setFeedbackSearch] = useState('')
  const [feedbackProductFilter, setFeedbackProductFilter] = useState('all')
  const [feedbackRatingFilter, setFeedbackRatingFilter] = useState('all')
  const [feedbackDateFilter, setFeedbackDateFilter] = useState('all')
  const [selectedFeedback, setSelectedFeedback] = useState(null)
  const [feedbackReferenceTime] = useState(() => Date.now())
  useEffect(() => {
    if (!accountMenuOpen) return undefined
    function closeOnOutsideClick(event) {
      if (!accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false)
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountMenuOpen])
  const openStaffNotification = notification => {
    const kind = String(notification.kind || '').toLowerCase()
    if (kind.startsWith('new-product-') || notification.product_id && kind !== 'product-feedback') {
      setSelectedProductId(String(notification.product_id))
      navigateTo('products')
      return
    }
    if (kind.includes('product-feedback')) {
      setFeedbackProductFilter(String(notification.related_id || notification.product_id || 'all'))
      setSelectedFeedback(null)
      setNotificationFeedbackTarget(notification)
      navigateTo('feedback')
      return
    }
    if (notification.related_type === 'order' && notification.related_id) {
      const orderId = Number(notification.related_id)
      if (Number.isFinite(orderId)) {
        setOrdersError('')
        setExpandedOrderId(orderId)
        setExpandedOrder(null)
        getOrderDetails(orderId)
          .then(details => {
            if (!details) throw new Error(`Order #${orderId} could not be found.`)
            setExpandedOrder(details)
          })
          .catch(error => setOrdersError(error.message))
        navigateTo('orders')
      }
      return
    }
    if (['transaction', 'sale'].includes(notification.related_type) && notification.related_id) {
      setSelectedTransaction(null)
      setNotificationTransactionTarget(String(notification.related_id))
      if (!salesLoading && !sales.some(item => String(item.id) === String(notification.related_id))) {
        setSalesError(`Transaction #${notification.related_id} could not be found.`)
      } else {
        setSalesError('')
      }
      navigateTo('transactions')
      return
    }
    if (notification.related_type === 'report') navigateTo('reports')
  }
  useEffect(() => {
    if (section === 'orders' && expandedOrderId !== null && expandedOrder) {
      orderNotificationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [section, expandedOrderId, expandedOrder])
  useEffect(() => {
    if (!selectedTransaction) return undefined
    const dialog = transactionModalRef.current
    const previousFocus = document.activeElement
    const focusableElements = () => Array.from(dialog?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])
    focusableElements()[0]?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedTransaction(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault()
        focusable[focusable.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault()
        focusable[0].focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [selectedTransaction])
  useEffect(() => {
    if (!selectedTask) return undefined
    const dialog = taskModalRef.current
    const previousFocus = document.activeElement
    const focusableElements = () => Array.from(dialog?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])
    focusableElements()[0]?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedTask(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [selectedTask])
  useEffect(() => {
    if (!selectedFeedback) return undefined
    const dialog = feedbackModalRef.current
    const previousFocus = document.activeElement
    const focusableElements = () => Array.from(dialog?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])
    focusableElements()[0]?.focus()

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedFeedback(null)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = focusableElements()
      if (!focusable.length) {
        event.preventDefault()
        return
      }
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault()
        focusable[focusable.length - 1].focus()
      } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
        event.preventDefault()
        focusable[0].focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [selectedFeedback])
  useEffect(() => {
    getCurrentUser().then(user => {
      if (user) setProfile({ name: user.name || '', username: user.username || '', email: user.email || '', position: user.position || '' })
    }).catch(error => setLoadError(error.message))
    const loadProducts = () => getProducts()
      .then(nextProducts => {
        setProducts(nextProducts)
        setProductsLoading(false)
      })
      .catch(error => {
        setLoadError(error.message)
        setProductsLoading(false)
      })
    loadProducts()
    const interval = window.setInterval(loadProducts, 15000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    let active = true
    const loadSales = () => getSales().then(items => {
      if (active) {
        setSales(items)
        setSalesError('')
      }
    }).catch(error => {
      if (active) setSalesError(error.message)
    }).finally(() => {
      if (active) setSalesLoading(false)
    })
    loadSales()
    const interval = window.setInterval(loadSales, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])
  useEffect(() => {
    let active = true
    const loadFeedback = () => getProductFeedback().then(items => {
      if (active) {
        setFeedback(items)
        setFeedbackError('')
      }
    }).catch(error => {
      if (active) setFeedbackError(error.message)
    }).finally(() => {
      if (active) setFeedbackLoading(false)
    })
    loadFeedback()
    const interval = window.setInterval(loadFeedback, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])
  useEffect(() => {
    let active = true
    const loadOrders = () => getOrders().then(items => {
      if (active) {
        setOrdersList(items)
        setOrdersError('')
      }
    }).catch(error => {
      if (active) setOrdersError(error.message)
    }).finally(() => {
      if (active) setOrdersLoading(false)
    })
    loadOrders()
    const interval = window.setInterval(loadOrders, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])
  const username = profile.username
  const pendingOrders = ordersList.filter(order => ['pending', 'pendingconfirmation'].includes(String(order.status).toLowerCase().replace(/[\s_-]/g, '')))
  const normalizeOrderStatus = status => String(status || '').toLowerCase().replace(/[\s_-]/g, '')
  const orderStatusCounts = {
    total: ordersList.length,
    pending: ordersList.filter(order => normalizeOrderStatus(order.status).startsWith('pending')).length,
    processing: ordersList.filter(order => ['confirmed', 'approved', 'processing', 'readyforpickup', 'outfordelivery'].includes(normalizeOrderStatus(order.status))).length,
    completed: ordersList.filter(order => ['completed', 'received'].includes(normalizeOrderStatus(order.status))).length,
    cancelled: ordersList.filter(order => ['cancelled', 'canceled', 'rejected'].includes(normalizeOrderStatus(order.status))).length,
  }
  const visibleOrders = ordersList.filter(order => {
    const matchesSearch = `${order.id} ${order.customer_name || ''} ${order.customer_email || ''}`.toLowerCase().includes(orderSearch.trim().toLowerCase())
    const matchesStatus = orderStatusFilter === 'all' || normalizeOrderStatus(order.status) === normalizeOrderStatus(orderStatusFilter)
    const matchesPayment = orderPaymentFilter === 'all' || String(order.payment_status || 'unknown').toLowerCase() === orderPaymentFilter
    const ageDays = order.created_at ? (ordersReferenceTime - new Date(order.created_at).getTime()) / 86400000 : null
    const matchesDate = orderDateFilter === 'all' || (ageDays !== null && Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= Number(orderDateFilter))
    return matchesSearch && matchesStatus && matchesPayment && matchesDate
  }).sort((first, second) => {
    if (orderSort === 'oldest') return new Date(first.created_at || 0) - new Date(second.created_at || 0) || Number(first.id) - Number(second.id)
    if (orderSort === 'total-low') return Number(first.total || 0) - Number(second.total || 0)
    if (orderSort === 'total-high') return Number(second.total || 0) - Number(first.total || 0)
    return new Date(second.created_at || 0) - new Date(first.created_at || 0) || Number(second.id) - Number(first.id)
  })
  const normalizeTransactionStatus = status => String(status || '').trim().toLowerCase().replace(/[\s_-]/g, '')
  const successfulTransactions = sales.filter(sale => ['completed', 'complete', 'successful', 'success', 'paid'].includes(normalizeTransactionStatus(sale.status)))
  const pendingTransactions = sales.filter(sale => normalizeTransactionStatus(sale.status).includes('pending'))
  const failedTransactions = sales.filter(sale => ['failed', 'failure', 'cancelled', 'canceled', 'rejected'].includes(normalizeTransactionStatus(sale.status)))
  const transactionRevenue = successfulTransactions.reduce((sum, sale) => sum + Number(sale.total || 0), 0)
  const transactionMethods = [...new Set(sales.map(sale => sale.payment_method).filter(Boolean))].sort((first, second) => first.localeCompare(second))
  const transactionStatuses = [...new Set(sales.map(sale => sale.status).filter(Boolean))].sort((first, second) => first.localeCompare(second))
  const visibleTransactions = sales.filter(sale => {
    const matchesSearch = `sale-${sale.id} ${sale.id} ${sale.user_id ?? ''}`.toLowerCase().includes(transactionSearch.trim().toLowerCase())
    const matchesStatus = transactionStatusFilter === 'all' || normalizeTransactionStatus(sale.status) === normalizeTransactionStatus(transactionStatusFilter)
    const matchesMethod = transactionMethodFilter === 'all' || sale.payment_method === transactionMethodFilter
    const ageDays = sale.created_at ? (transactionsReferenceTime - new Date(sale.created_at).getTime()) / 86400000 : null
    const matchesDate = transactionDateFilter === 'all' || (ageDays !== null && Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= Number(transactionDateFilter))
    return matchesSearch && matchesStatus && matchesMethod && matchesDate
  }).sort((first, second) => {
    if (transactionSort === 'oldest') return new Date(first.created_at || 0) - new Date(second.created_at || 0) || Number(first.id) - Number(second.id)
    if (transactionSort === 'amount-low') return Number(first.total || 0) - Number(second.total || 0)
    if (transactionSort === 'amount-high') return Number(second.total || 0) - Number(first.total || 0)
    return new Date(second.created_at || 0) - new Date(first.created_at || 0) || Number(second.id) - Number(first.id)
  })
  const notificationSelectedTransaction = notificationTransactionTarget
    ? sales.find(item => String(item.id) === String(notificationTransactionTarget))
    : null
  const activeSelectedTransaction = selectedTransaction || notificationSelectedTransaction
  const reportStart = reportPeriod === 'custom' && reportStartDate
    ? new Date(`${reportStartDate}T00:00:00`)
    : reportPeriod === 'today'
      ? new Date(reportReferenceDate.getFullYear(), reportReferenceDate.getMonth(), reportReferenceDate.getDate())
      : reportPeriod === 'week'
        ? new Date(reportReferenceDate.getFullYear(), reportReferenceDate.getMonth(), reportReferenceDate.getDate() - ((reportReferenceDate.getDay() + 6) % 7))
        : reportPeriod === 'month'
          ? new Date(reportReferenceDate.getFullYear(), reportReferenceDate.getMonth(), 1)
          : reportPeriod === 'year'
            ? new Date(reportReferenceDate.getFullYear(), 0, 1)
            : null
  const reportEnd = reportPeriod === 'custom' && reportEndDate
    ? new Date(`${reportEndDate}T23:59:59.999`)
    : reportPeriod === 'all'
      ? null
      : new Date(reportReferenceDate.getFullYear(), reportReferenceDate.getMonth(), reportReferenceDate.getDate(), 23, 59, 59, 999)
  const isWithinReportRange = value => {
    if (!value) return false
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return false
    return (!reportStart || date >= reportStart) && (!reportEnd || date <= reportEnd)
  }
  const reportSales = sales.filter(sale => reportPeriod === 'all' || isWithinReportRange(sale.created_at))
  const reportOrders = ordersList.filter(order => reportPeriod === 'all' || isWithinReportRange(order.created_at))
  const reportPendingOrders = reportOrders.filter(order => normalizeOrderStatus(order.status).startsWith('pending'))
  const reportCompletedOrders = reportOrders.filter(order => ['completed', 'received'].includes(normalizeOrderStatus(order.status)))
  const reportTotalSales = reportSales.reduce((total, sale) => total + Number(sale.total || 0), 0)
  const reportOrderStatuses = [...new Set(reportOrders.map(order => order.status || 'Unknown'))].map(status => ({
    status,
    count: reportOrders.filter(order => (order.status || 'Unknown') === status).length,
  })).sort((first, second) => second.count - first.count || first.status.localeCompare(second.status))
  const reportUsesMonthlyBuckets = reportPeriod === 'year' || (reportPeriod === 'all' && reportSales.some(sale => sale.created_at && (reportReferenceDate.getTime() - new Date(sale.created_at).getTime()) / 86400000 > 60))
  const reportBuckets = new Map()
  for (const [items, kind] of [[reportSales, 'sales'], [reportOrders, 'orders']]) {
    for (const item of items) {
      if (!item.created_at) continue
      const date = new Date(item.created_at)
      if (!Number.isFinite(date.getTime())) continue
      const key = reportUsesMonthlyBuckets
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const bucket = reportBuckets.get(key) || { key, date, sales: 0, transactions: 0, orders: 0 }
      if (kind === 'sales') {
        bucket.sales += Number(item.total || 0)
        bucket.transactions += 1
      } else {
        bucket.orders += 1
      }
      reportBuckets.set(key, bucket)
    }
  }
  const reportTrend = [...reportBuckets.values()].sort((first, second) => first.date - second.date)
  const reportChartMax = Math.max(1, ...reportTrend.map(bucket => bucket.sales))
  const reportStatusMax = Math.max(1, ...reportOrderStatuses.map(status => status.count))
  const today = new Date().toDateString()
  const ordersToday = ordersList.filter(order => order.created_at && new Date(order.created_at).toDateString() === today).length
  const lowStockProducts = products.filter(product => product.status === 'active' && Number(product.stock) <= Number(product.stock_threshold ?? 5))
  const tasks = [['Restock low inventory', `${lowStockProducts.length} products at or below threshold`, 'products'], ['Process pending orders', `${pendingOrders.length} orders waiting`, 'orders'], ['Review product updates', 'Current product catalog', 'products']]
  const assignedTasks = tasks.map(([title, description, destination], index) => ({
    id: `${destination}-${index}`,
    title,
    description,
    destination,
    assignedDate: null,
    dueDate: null,
    priority: null,
    status: null,
  }))
  const title = sections.find(([key]) => key === section)?.[1] || 'Dashboard'
  const productCategories = [...new Map(products.map(product => {
    const key = product.category_id != null ? `id:${product.category_id}` : `name:${product.category_name || 'Uncategorized'}`
    return [key, { key, name: product.category_name || 'Uncategorized' }]
  })).values()].sort((first, second) => first.name.localeCompare(second.name))
  const visibleProducts = products.filter(product => {
    const matchesText = `${product.name} ${product.product_code || ''} ${product.category_name || ''} ${product.id}`.toLowerCase().includes(productSearch.trim().toLowerCase())
    const categoryKey = product.category_id != null ? `id:${product.category_id}` : `name:${product.category_name || 'Uncategorized'}`
    const matchesCategory = productCategory === 'all' || categoryKey === productCategory
    const matchesAvailability = productAvailability === 'all'
      || (productAvailability === 'active' && product.status === 'active' && Number(product.stock) > 0)
      || (productAvailability === 'out' && product.status === 'active' && Number(product.stock) <= 0)
      || (productAvailability === 'inactive' && product.status !== 'active')
    return matchesText && matchesCategory && matchesAvailability
  }).sort((first, second) => {
    if (productSort === 'name') return first.name.localeCompare(second.name)
    if (productSort === 'price-low') return Number(first.price) - Number(second.price)
    if (productSort === 'price-high') return Number(second.price) - Number(first.price)
    if (productSort === 'stock-low') return Number(first.stock) - Number(second.stock)
    if (productSort === 'stock-high') return Number(second.stock) - Number(first.stock)
    return new Date(second.created_at || 0) - new Date(first.created_at || 0) || Number(second.id) - Number(first.id)
  })
  const selectedProduct = products.find(product => String(product.id) === String(selectedProductId))
  const selectedProductInCatalogId = selectedProduct?.id
  const visibleTasks = assignedTasks.filter(task => {
    const matchesSearch = `${task.title} ${task.description}`.toLowerCase().includes(taskSearch.trim().toLowerCase())
    const matchesStatus = taskStatusFilter === 'all' || (taskStatusFilter === 'not-set' && !task.status)
    const matchesPriority = taskPriorityFilter === 'all' || (taskPriorityFilter === 'not-set' && !task.priority)
    return matchesSearch && matchesStatus && matchesPriority
  })
  const feedbackProducts = [...new Map(feedback.map(item => [String(item.product_id), { id: item.product_id, name: item.product_name || 'Unknown product' }])).values()]
  const feedbackRatings = feedback.map(item => Number(item.rating)).filter(rating => rating >= 1 && rating <= 5)
  const averageFeedbackRating = feedbackRatings.length ? feedbackRatings.reduce((sum, rating) => sum + rating, 0) / feedbackRatings.length : 0
  const positiveFeedbackCount = feedbackRatings.filter(rating => rating >= 4).length
  const neutralFeedbackCount = feedbackRatings.filter(rating => rating === 3).length
  const negativeFeedbackCount = feedbackRatings.filter(rating => rating <= 2).length
  const visibleFeedback = feedback.filter(item => {
    const searchText = `${item.customer_name || ''} ${item.customer_id || ''} ${item.product_name || ''} ${item.review || ''} ${item.order_id || ''}`.toLowerCase()
    const matchesSearch = searchText.includes(feedbackSearch.trim().toLowerCase())
    const matchesProduct = feedbackProductFilter === 'all' || String(item.product_id) === feedbackProductFilter
    const matchesRating = feedbackRatingFilter === 'all' || String(item.rating) === feedbackRatingFilter
    const ageDays = item.created_at ? (feedbackReferenceTime - new Date(item.created_at).getTime()) / 86400000 : null
    const matchesDate = feedbackDateFilter === 'all'
      || (ageDays !== null && Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= Number(feedbackDateFilter))
    return matchesSearch && matchesProduct && matchesRating && matchesDate
  })
  const notificationFeedbackProductId = notificationFeedbackTarget?.related_id || notificationFeedbackTarget?.product_id
  const notificationFeedbackOrderId = notificationFeedbackTarget?.message?.match(/order\s+#?(\d+)/i)?.[1]
  const notificationFeedbackMatches = notificationFeedbackTarget
    ? feedback.filter(item => String(item.product_id) === String(notificationFeedbackProductId))
    : []
  const notificationSelectedFeedback = (notificationFeedbackOrderId
    && notificationFeedbackMatches.find(item => String(item.order_id) === notificationFeedbackOrderId))
    || notificationFeedbackMatches[0]
  const activeSelectedFeedback = selectedFeedback || notificationSelectedFeedback
  useEffect(() => {
    if (section === 'products' && selectedProductInCatalogId) {
      selectedProductDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [section, selectedProductInCatalogId])
  const navigateTo = nextSection => {
    setAccountMenuOpen(false)
    if (sections.some(([key]) => key === nextSection)) {
      setSection(nextSection)
    } else {
      onNavigate(nextSection)
    }
  }
  const goBack = () => setSectionState(sectionHistory.current.pop() || 'dashboard')
  async function changeOrderStatus(order, status) {
    if (status === 'Completed' && !window.confirm('Confirm that the customer has collected this order and paid in cash before completing it.')) return
    const reason = status === 'Rejected'
      ? window.prompt('Enter the reason for rejecting this order:')
      : status === 'Cancelled'
        ? window.prompt('Enter an optional reason for cancelling this order:') || ''
        : ''
    if (status === 'Rejected' && !reason?.trim()) {
      setOrdersError('A reason is required to reject an order.')
      return
    }
    setSavingOrderId(order.id)
    setOrdersError('')
    try {
      const result = await updateOrder(order.id, status, reason || '')
      setOrdersList(items => items.map(item => item.id === order.id ? {
        ...item,
        ...result.order,
        status,
        rejection_reason: ['Rejected', 'Cancelled'].includes(status) ? reason : '',
      } : item))
      if (expandedOrderId === order.id) setExpandedOrder(await getOrderDetails(order.id))
    } catch (error) {
      setOrdersError(error.message)
    } finally {
      setSavingOrderId(null)
    }
  }
  async function recordOrderPayment(order) {
    setSavingOrderId(order.id)
    setOrdersError('')
    try {
      await updateOrderPayment(order.id, 'Paid')
      setOrdersList(items => items.map(item => item.id === order.id ? { ...item, payment_status: 'Paid' } : item))
      if (expandedOrderId === order.id) setExpandedOrder(await getOrderDetails(order.id))
    } catch (error) {
      setOrdersError(error.message)
    } finally {
      setSavingOrderId(null)
    }
  }
  async function toggleOrderDetails(order) {
    if (expandedOrderId === order.id) {
      setExpandedOrderId(null)
      setExpandedOrder(null)
      return
    }
    setExpandedOrderId(order.id)
    setExpandedOrder(null)
    try {
      setExpandedOrder(await getOrderDetails(order.id))
    } catch (error) {
      setOrdersError(error.message)
    }
  }
  const renderDashboard = () => <><div className="metric-grid"><div><small>ORDERS TODAY</small><strong>{ordersToday}</strong><span>From submitted customer orders</span></div><div><small>PENDING ORDERS</small><strong>{pendingOrders.length}</strong><span>Needs processing</span></div><div><small>LOW STOCK</small><strong>{lowStockProducts.length}</strong><span>At or below reorder threshold</span></div></div><section className="staff-panel"><div className="staff-panel-heading"><h3>Assigned today</h3><button type="button" onClick={() => navigateTo('tasks')}>View tasks</button></div>{tasks.map(([task, detail, page], index) => <button type="button" className="staff-task-row" key={task} onClick={() => navigateTo('tasks')} aria-label={`Open assigned tasks. Suggested task: ${task}. ${detail}`}><span aria-hidden="true">0{index + 1}</span><div><strong>{task}</strong><small>{detail}</small></div><b aria-hidden="true">{page === 'inventory' ? 'Stock' : page === 'orders' ? 'Open' : 'Review'}</b></button>)}</section></>
  const renderContent = () => {
    if (section === 'products') return <section className="staff-products-page">
      <header className="staff-products-heading">
        <div><p className="eyebrow">INVENTORY CATALOG</p><h2>Products</h2><p>Browse product details and check current availability.</p></div>
        <span className="staff-products-count">{products.length} products</span>
      </header>
      {loadError && <p role="alert" className="staff-products-error">{loadError}</p>}
      <section className="staff-products-browser" aria-label="Product catalog">
        <div className="staff-products-toolbar">
          <div><h3>Product catalog</h3><span>{visibleProducts.length} of {products.length} products</span></div>
          <div className="staff-product-filters">
            <label className="staff-product-search">Search products<input type="search" value={productSearch} onChange={event => setProductSearch(event.target.value)} placeholder="Name, category, or SKU" /></label>
            <label>Category<select value={productCategory} onChange={event => setProductCategory(event.target.value)}><option value="all">All categories</option>{productCategories.map(category => <option key={category.key} value={category.key}>{category.name}</option>)}</select></label>
            <label>Availability<select value={productAvailability} onChange={event => setProductAvailability(event.target.value)}><option value="all">All products</option><option value="active">In stock</option><option value="out">Out of stock</option><option value="inactive">Inactive</option></select></label>
            <label>Sort by<select value={productSort} onChange={event => setProductSort(event.target.value)}><option value="newest">Recently added</option><option value="name">Name</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="stock-low">Stock: low to high</option><option value="stock-high">Stock: high to low</option></select></label>
          </div>
        </div>
        {selectedProductId && <section className="staff-product-details" ref={selectedProductDetailsRef} aria-label="Selected product details" aria-live="polite">
          <div className="staff-product-details-heading"><div><p className="eyebrow">PRODUCT DETAILS</p><h3>Selected product</h3></div><button type="button" onClick={() => setSelectedProductId(null)} aria-label="Close selected product details">Close</button></div>
          {selectedProduct ? <div className="staff-product-detail-content">
            <div className="staff-product-detail-image"><ProductPhoto src={selectedProduct.image_url} alt={selectedProduct.name} /></div>
            <div className="staff-product-detail-info">
              <span className={`staff-product-status ${selectedProduct.status === 'active' ? 'is-active' : 'is-inactive'}`}>{selectedProduct.status === 'active' ? 'Active' : 'Inactive'}</span>
              <h4>{selectedProduct.name}</h4>
              <p>{selectedProduct.description || 'No product description has been added.'}</p>
              <dl><div><dt>Category</dt><dd>{selectedProduct.category_name || 'Uncategorized'}</dd></div><div><dt>Product code</dt><dd>{selectedProduct.product_code || `#${selectedProduct.id}`}</dd></div><div><dt>Price</dt><dd>PHP {Number(selectedProduct.price).toFixed(2)}</dd></div><div><dt>Available stock</dt><dd>{Number(selectedProduct.stock)} units</dd></div><div><dt>Stock status</dt><dd>{selectedProduct.status !== 'active' ? 'Inactive' : Number(selectedProduct.stock) <= 0 ? 'Out of stock' : Number(selectedProduct.stock) <= Number(selectedProduct.stock_threshold ?? 5) ? 'Low stock' : 'In stock'}</dd></div><div><dt>Added</dt><dd>{selectedProduct.created_at ? new Date(selectedProduct.created_at).toLocaleDateString() : '—'}</dd></div></dl>
            </div>
          </div> : <p role="status">{productsLoading ? 'Loading selected product…' : 'This product could not be found in the catalog.'}</p>}
        </section>}
        {productsLoading ? <p className="staff-products-message" role="status">Loading products…</p> : visibleProducts.length ? <div className="staff-product-grid">
          {visibleProducts.map(product => {
            const isLowStock = product.status === 'active' && Number(product.stock) > 0 && Number(product.stock) <= Number(product.stock_threshold ?? 5)
            const statusLabel = product.status !== 'active' ? 'Inactive' : Number(product.stock) <= 0 ? 'Out of stock' : isLowStock ? 'Low stock' : 'In stock'
            const statusClass = product.status !== 'active' ? 'is-inactive' : Number(product.stock) <= 0 ? 'is-out' : isLowStock ? 'is-low' : 'is-active'
            return <article key={product.id} className="staff-product-card">
              <div className="staff-product-card-image"><ProductPhoto src={product.image_url} alt={product.name} /></div>
              <div className="staff-product-card-body">
                <div className="staff-product-card-top"><span className="staff-product-category">{product.category_name || 'Uncategorized'}</span><span className={`staff-product-status ${statusClass}`}>{statusLabel}</span></div>
                <h4>{product.name}</h4>
                <p className="staff-product-sku">SKU {product.product_code || product.id}</p>
                <div className="staff-product-card-facts"><strong>PHP {Number(product.price).toFixed(2)}</strong><span>{Number(product.stock)} units</span></div>
                <footer><button type="button" onClick={() => setSelectedProductId(String(product.id))} aria-label={`View details for ${product.name}`}>View details <span aria-hidden="true">↗</span></button></footer>
              </div>
            </article>
          })}
        </div> : <p className="staff-products-message">{products.length ? 'No products match your search and filters.' : 'No products are available.'}</p>}
      </section>
    </section>
    if (section === 'dashboard') return renderDashboard()
    if (section === 'tasks') return <section className="staff-assigned-tasks">
      <header className="staff-assigned-heading">
        <div><p className="eyebrow">STAFF WORKSPACE</p><h2>Assigned tasks</h2><p>Review your current priorities and open the relevant workspace.</p></div>
        <span className="staff-task-count">{assignedTasks.length} tasks</span>
      </header>
      <div className="staff-task-summary" aria-label="Task summary">
        <article><span>Total tasks</span><strong>{assignedTasks.length}</strong><small>Current task list</small></article>
        <article><span>Pending</span><strong>—</strong><small>Status not available</small></article>
        <article><span>In progress</span><strong>—</strong><small>Status not available</small></article>
        <article><span>Completed</span><strong>—</strong><small>Status not available</small></article>
      </div>
      <section className="staff-task-browser" aria-label="Assigned task list">
        <div className="staff-task-browser-heading"><div><h3>Your task list</h3><span>{visibleTasks.length} of {assignedTasks.length} tasks</span></div></div>
        <div className="staff-task-controls">
          <label className="staff-task-search">Search tasks<input type="search" value={taskSearch} onChange={event => setTaskSearch(event.target.value)} placeholder="Search by task or description" /></label>
          <label>Status<select value={taskStatusFilter} onChange={event => setTaskStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="not-set">Not set</option></select></label>
          <label>Priority<select value={taskPriorityFilter} onChange={event => setTaskPriorityFilter(event.target.value)}><option value="all">All priorities</option><option value="not-set">Not set</option></select></label>
          <label>Sort by due date<select value="unavailable" disabled aria-describedby="staff-task-sort-note"><option value="unavailable">Due date unavailable</option></select></label>
        </div>
        <p className="staff-task-note" id="staff-task-sort-note">Task dates, priority, and status aren’t included in the current task data.</p>
        {visibleTasks.length ? <div className="staff-assigned-grid">{visibleTasks.map((task, index) => <article className="staff-assigned-card" key={task.id}>
          <header><span className="staff-task-index">{String(index + 1).padStart(2, '0')}</span><span className="staff-task-status is-unset">Status not set</span></header>
          <h4>{task.title}</h4>
          <p className="staff-assigned-description">{task.description}</p>
          <div className="staff-task-meta">
            <span><small>Assigned</small><strong>Not set</strong></span>
            <span><small>Due date</small><strong>Not set</strong></span>
            <span><small>Priority</small><strong>Not set</strong></span>
          </div>
          <footer><button type="button" onClick={() => setSelectedTask(task)} aria-label={`View details for ${task.title}`}>View details <span aria-hidden="true">↗</span></button></footer>
        </article>)}</div> : <p className="staff-task-empty">No tasks match your search or filters.</p>}
      </section>
      {selectedTask && <div className="staff-task-modal-backdrop" role="presentation" onClick={() => setSelectedTask(null)}>
        <section ref={taskModalRef} className="staff-task-modal" role="dialog" aria-modal="true" aria-labelledby="staff-task-modal-title" onClick={event => event.stopPropagation()}>
          <button type="button" className="staff-task-modal-close" onClick={() => setSelectedTask(null)} aria-label="Close task details">×</button>
          <p className="eyebrow">TASK DETAILS</p><h3 id="staff-task-modal-title">{selectedTask.title}</h3>
          <p>{selectedTask.description}</p>
          <dl><div><dt>Assigned date</dt><dd>Not set</dd></div><div><dt>Due date</dt><dd>Not set</dd></div><div><dt>Priority</dt><dd>Not set</dd></div><div><dt>Status</dt><dd>Not set</dd></div></dl>
          <footer><button type="button" className="staff-task-modal-secondary" onClick={() => setSelectedTask(null)}>Close</button><button type="button" className="staff-task-modal-primary" onClick={() => { const destination = selectedTask.destination; setSelectedTask(null); navigateTo(destination) }}>Open {selectedTask.destination === 'orders' ? 'Orders' : 'Products'} <span aria-hidden="true">↗</span></button></footer>
        </section>
      </div>}
    </section>
    if (section === 'orders') {
      const nextStatuses = {
        pendingconfirmation: ['Confirmed', 'Rejected', 'Cancelled'],
        pending: ['Confirmed', 'Rejected', 'Cancelled'],
        confirmed: ['Processing', 'Cancelled'],
        approved: ['Processing', 'Cancelled'],
        processing: ['Ready for Pickup', 'Out for Delivery', 'Cancelled'],
        readyforpickup: ['Completed', 'Cancelled'],
        outfordelivery: ['Completed', 'Cancelled'],
      }
      return <section className="staff-orders-page">
        <header className="staff-orders-heading"><div><p className="eyebrow">CUSTOMER ORDERS</p><h2>Orders</h2><p>Review customer purchases and keep orders moving.</p></div></header>
        {ordersError && <p role="alert" className="staff-orders-error">{ordersError}</p>}
        <div className="staff-orders-metrics" aria-label="Order summary">
          {[['Total orders', orderStatusCounts.total, '▤', ''], ['Pending', orderStatusCounts.pending, '◷', 'is-pending'], ['Processing', orderStatusCounts.processing, '↻', 'is-processing'], ['Completed', orderStatusCounts.completed, '✓', 'is-completed'], ['Cancelled', orderStatusCounts.cancelled, '×', 'is-cancelled']].map(([label, count, icon, tone]) => <article key={label}><span className={`staff-orders-metric-icon ${tone}`} aria-hidden="true">{icon}</span><small>{label}</small><strong>{count}</strong></article>)}
        </div>
        <section className="staff-orders-browser" aria-label="Customer order list">
          <div className="staff-orders-toolbar"><div><h3>All orders</h3><span>{visibleOrders.length} of {ordersList.length}</span></div>
            <div className="staff-orders-filters">
              <label className="staff-orders-search">Search orders<input type="search" value={orderSearch} onChange={event => setOrderSearch(event.target.value)} placeholder="Order ID or customer name" /></label>
              <label>Status<select value={orderStatusFilter} onChange={event => setOrderStatusFilter(event.target.value)}><option value="all">All statuses</option>{[...new Set(ordersList.map(order => order.status).filter(Boolean))].sort().map(status => <option key={status} value={status}>{status}</option>)}</select></label>
              <label>Payment<select value={orderPaymentFilter} onChange={event => setOrderPaymentFilter(event.target.value)}><option value="all">All payments</option>{[...new Set(ordersList.map(order => String(order.payment_status || 'Unknown').toLowerCase()))].sort().map(status => <option key={status} value={status}>{status[0].toUpperCase() + status.slice(1)}</option>)}</select></label>
              <label>Order date<select value={orderDateFilter} onChange={event => setOrderDateFilter(event.target.value)}><option value="all">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
              <label>Sort by<select value={orderSort} onChange={event => setOrderSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="total-high">Total: high to low</option><option value="total-low">Total: low to high</option></select></label>
            </div>
          </div>
          {ordersLoading ? <p role="status" className="staff-orders-empty">Loading customer orders…</p> : visibleOrders.length ? <div className="staff-orders-list">
            {visibleOrders.map(order => {
              const normalizedStatus = normalizeOrderStatus(order.status)
              const allowedNextStatuses = nextStatuses[normalizedStatus]
              const statusTone = normalizedStatus.startsWith('pending') ? 'is-pending' : ['confirmed', 'approved', 'processing', 'readyforpickup'].includes(normalizedStatus) ? 'is-processing' : ['outfordelivery', 'shipped'].includes(normalizedStatus) ? 'is-shipped' : ['completed', 'received'].includes(normalizedStatus) ? 'is-completed' : ['cancelled', 'canceled', 'rejected'].includes(normalizedStatus) ? 'is-cancelled' : ''
              const details = expandedOrderId === order.id && expandedOrder ? expandedOrder : null
              return <article ref={String(order.id) === String(expandedOrderId) ? orderNotificationRef : null} className="staff-order-card" key={order.id}>
                <header className="staff-order-card-header">
                  <div className="staff-order-customer">{order.customer_profile_image_url ? <img src={order.customer_profile_image_url} alt="" /> : <span className="staff-order-avatar" aria-hidden="true">{(order.customer_name || '?').slice(0, 1).toUpperCase()}</span>}<span><small>ORDER #{order.id}</small><strong>{order.customer_name || `Customer #${order.user_id}`}</strong><small>{order.created_at ? new Date(order.created_at).toLocaleString() : 'Date unavailable'}</small></span></div>
                  <span className={`staff-order-status ${statusTone}`}>{order.status || 'Unknown'}</span>
                </header>
                <div className="staff-order-summary"><span>Order total<strong>PHP {Number(order.total || 0).toFixed(2)}</strong></span><span>Payment method<strong>{order.payment_method === 'cash_on_pickup' ? 'Cash on Pickup' : order.payment_method || 'Unknown'}</strong></span><span>Payment status<strong className={`staff-payment-status ${String(order.payment_status).toLowerCase() === 'paid' ? 'is-paid' : ''}`}>{order.payment_status || 'Unknown'}</strong></span><span>Items<strong>{order.item_count ?? 0}</strong></span></div>
                <div className="staff-order-contact">
                  <span><small>Contact email</small><a href={order.customer_email ? `mailto:${order.customer_email}` : undefined}>{order.customer_email || 'Email unavailable'}</a></span>
                  <span><small>Contact number</small>{order.contact_number ? <a href={`tel:${order.contact_number}`}>{order.contact_number}</a> : <strong>Not provided</strong>}</span>
                  <span><small>Complete address</small><strong>{[order.address_line, order.barangay && `Brgy. ${order.barangay}`, order.city, order.province, order.postal_code].filter(Boolean).join(', ') || 'Address unavailable'}</strong></span>
                </div>
                <div className="staff-order-actions">
                  <button type="button" className="staff-order-details-button" onClick={() => toggleOrderDetails(order)} aria-expanded={expandedOrderId === order.id} aria-label={`${expandedOrderId === order.id ? 'Hide' : 'View'} details for order ${order.id}`}>{expandedOrderId === order.id ? 'Hide details' : 'View details'}</button>
                  {allowedNextStatuses && <select aria-label={`Update order ${order.id} status`} defaultValue="" disabled={savingOrderId === order.id} onChange={event => { if (event.target.value) changeOrderStatus(order, event.target.value); event.target.value = '' }}><option value="" disabled>Update status…</option>{allowedNextStatuses.map(status => <option key={status}>{status}</option>)}</select>}
                  {String(order.status).toLowerCase() === 'completed' && String(order.payment_status).toLowerCase() !== 'paid' && <button type="button" disabled={savingOrderId === order.id} onClick={() => recordOrderPayment(order)} aria-label={`Record cash collected for order ${order.id}`}>{savingOrderId === order.id ? 'Saving…' : 'Record cash collected'}</button>}
                </div>
                {expandedOrderId === order.id && (details ? <div className="staff-order-details">
                  <section className="staff-order-detail-section"><h4>Order items</h4>{details.items.map(item => <article key={`${item.product_id}-${item.name}`}><ProductPhoto src={item.image_url} alt={item.name} /><span><strong>{item.name}</strong><small>{item.category_name || 'School Supplies'} · Qty {item.quantity} · PHP {Number(item.unit_price).toFixed(2)} each</small></span><b>PHP {Number(item.subtotal).toFixed(2)}</b></article>)}<div className="staff-order-total-row"><span>Items subtotal</span><strong>PHP {details.items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0).toFixed(2)}</strong></div><div className="staff-order-total-row is-total"><span>Order total</span><strong>PHP {Number(details.total || 0).toFixed(2)}</strong></div></section>
                  <section className="staff-order-detail-section"><h4>Customer and payment</h4><div className="staff-order-detail-contact"><span><small>Customer</small><strong>{details.customer_name || `Customer #${details.user_id}`}</strong></span><span><small>Email</small><strong>{details.customer_email || 'Email unavailable'}</strong></span><span><small>Payment method</small><strong>{details.payment_method === 'cash_on_pickup' ? 'Cash on Pickup' : details.payment_method || 'Unknown'}</strong></span><span><small>Payment status</small><strong>{details.payment_status || 'Unknown'}</strong></span></div></section>
                  {details.timeline?.length > 0 && <section className="staff-order-detail-section"><h4>Order history</h4><ol className="staff-order-timeline">{details.timeline.map((event, index) => <li key={`${event.status}-${event.created_at || index}`}><span className="staff-order-timeline-marker" aria-hidden="true" /><div><strong>{event.status}</strong><small>{event.created_at ? new Date(event.created_at).toLocaleString() : 'Date unavailable'}</small>{event.reason && <small>{event.reason}</small>}</div></li>)}</ol></section>}
                </div> : <p role="status">Loading order details…</p>)}
                {order.rejection_reason && <p className="staff-order-reason">Reason: {order.rejection_reason}</p>}
              </article>
            })}
          </div> : <p className="staff-orders-empty">{ordersList.length ? 'No orders match your search and filters.' : 'No customer orders have been placed.'}</p>}
        </section>
      </section>
    }
    if (section === 'feedback') return <section className="staff-feedback-page">
      <header className="staff-feedback-heading">
        <div><p className="eyebrow">CUSTOMER PRODUCT REVIEWS</p><h2>Product feedback</h2><p>Understand what customers think about the products they purchased.</p></div>
      </header>
      {feedbackError && <p role="alert" className="staff-feedback-error">{feedbackError}</p>}
      <div className="staff-feedback-summary" aria-label="Feedback summary">
        <article><span className="staff-feedback-summary-icon" aria-hidden="true">▤</span><small>Total feedback</small><strong>{feedback.length}</strong><span>Customer reviews</span></article>
        <article><span className="staff-feedback-summary-icon is-positive" aria-hidden="true">↑</span><small>Positive</small><strong>{positiveFeedbackCount}</strong><span>4–5 star ratings</span></article>
        <article><span className="staff-feedback-summary-icon is-neutral" aria-hidden="true">•</span><small>Neutral</small><strong>{neutralFeedbackCount}</strong><span>3 star ratings</span></article>
        <article><span className="staff-feedback-summary-icon is-negative" aria-hidden="true">↓</span><small>Negative</small><strong>{negativeFeedbackCount}</strong><span>1–2 star ratings</span></article>
        <article className="staff-feedback-average"><span className="staff-feedback-summary-icon is-rating" aria-hidden="true">★</span><small>Average rating</small><strong>{feedbackRatings.length ? averageFeedbackRating.toFixed(1) : '—'}<span>/ 5</span></strong><span>{feedbackRatings.length ? `${feedbackRatings.length} rated reviews` : 'No ratings yet'}</span></article>
      </div>
      <section className="staff-feedback-browser" aria-label="Customer feedback">
        <div className="staff-feedback-toolbar"><div><h3>Customer reviews</h3><span>{visibleFeedback.length} of {feedback.length} reviews</span></div>
          <div className="staff-feedback-filters">
            <label className="staff-feedback-search">Search reviews<input type="search" value={feedbackSearch} onChange={event => setFeedbackSearch(event.target.value)} placeholder="Customer, product, or comment" /></label>
            <label>Product<select value={feedbackProductFilter} onChange={event => setFeedbackProductFilter(event.target.value)}><option value="all">All products</option>{feedbackProducts.map(product => <option key={product.id} value={String(product.id)}>{product.name}</option>)}</select></label>
            <label>Rating<select value={feedbackRatingFilter} onChange={event => setFeedbackRatingFilter(event.target.value)}><option value="all">All ratings</option>{[5, 4, 3, 2, 1].map(rating => <option key={rating} value={String(rating)}>{rating} {rating === 1 ? 'star' : 'stars'}</option>)}</select></label>
            <label>Date<select value={feedbackDateFilter} onChange={event => setFeedbackDateFilter(event.target.value)}><option value="all">Any time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
          </div>
        </div>
        <p className="staff-feedback-data-note">Feedback status isn’t provided by the current review data.</p>
        {feedbackLoading ? <p role="status" className="staff-feedback-empty">Loading customer feedback…</p> : visibleFeedback.length ? <div className="staff-feedback-list">{visibleFeedback.map(item => {
          const rating = Math.min(5, Math.max(0, Number(item.rating) || 0))
          const sentiment = rating >= 4 ? 'is-positive' : rating === 3 ? 'is-neutral' : 'is-negative'
          return <article className="staff-feedback-card" key={item.id}>
            <header className="staff-feedback-customer">
              {item.customer_profile_image_url ? <img src={item.customer_profile_image_url} alt="" /> : <span className="staff-order-avatar" aria-hidden="true">{(item.customer_name || '?').slice(0, 1).toUpperCase()}</span>}
              <div><strong>{item.customer_name || `Customer #${item.customer_id}`}</strong><small>Customer #{item.customer_id} · Order #{item.order_id}</small></div>
              <time dateTime={item.created_at || undefined}>{item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Date unavailable'}</time>
            </header>
            <div className="staff-feedback-product">
              {item.product_image_url && <ProductPhoto src={item.product_image_url} alt="" />}
              <strong>{item.product_name || 'Unknown product'}</strong>
            </div>
            <div className={`staff-feedback-rating ${sentiment}`} aria-label={`${rating} out of 5 stars`}>
              <span aria-hidden="true">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span><strong>{rating.toFixed(1)}</strong><small>/ 5</small>
            </div>
            <p className="staff-feedback-comment">{item.review || 'No written comment.'}</p>
            <footer><button type="button" onClick={() => { setNotificationFeedbackTarget(null); setSelectedFeedback(item) }} aria-label={`View feedback from ${item.customer_name || `customer ${item.customer_id}`} for ${item.product_name || 'product'}`}>View details <span aria-hidden="true">↗</span></button></footer>
          </article>
        })}</div> : <p className="staff-feedback-empty">{feedback.length ? 'No feedback matches your search and filters.' : 'No customer feedback has been submitted.'}</p>}
      </section>
      {notificationFeedbackTarget && !feedbackLoading && !notificationSelectedFeedback && <p role="alert" className="staff-feedback-empty">No feedback record matches this notification.</p>}
      {activeSelectedFeedback && <div className="staff-feedback-modal-backdrop" role="presentation" onClick={() => { setSelectedFeedback(null); setNotificationFeedbackTarget(null) }}>
          <section ref={feedbackModalRef} className="staff-feedback-modal" role="dialog" aria-modal="true" aria-labelledby="staff-feedback-modal-title" onClick={event => event.stopPropagation()}>
            <button type="button" className="staff-feedback-modal-close" onClick={() => { setSelectedFeedback(null); setNotificationFeedbackTarget(null) }} aria-label="Close feedback details">×</button>
            <p className="eyebrow">FEEDBACK DETAILS</p><h3 id="staff-feedback-modal-title">{activeSelectedFeedback.product_name || 'Product review'}</h3>
            <div className="staff-feedback-modal-product">{activeSelectedFeedback.product_image_url && <ProductPhoto src={activeSelectedFeedback.product_image_url} alt="" />}<span><strong>{activeSelectedFeedback.product_name || 'Unknown product'}</strong><small>Product #{activeSelectedFeedback.product_id}</small></span></div>
            <div className={`staff-feedback-rating ${Number(activeSelectedFeedback.rating) >= 4 ? 'is-positive' : Number(activeSelectedFeedback.rating) === 3 ? 'is-neutral' : 'is-negative'}`} aria-label={`${Number(activeSelectedFeedback.rating) || 0} out of 5 stars`}>
              <span aria-hidden="true">{'★'.repeat(Math.min(5, Math.max(0, Number(activeSelectedFeedback.rating) || 0)))}{'☆'.repeat(5 - Math.min(5, Math.max(0, Number(activeSelectedFeedback.rating) || 0)))}</span><strong>{Number(activeSelectedFeedback.rating || 0).toFixed(1)}</strong><small>/ 5</small>
            </div>
            <blockquote>{activeSelectedFeedback.review || 'No written comment.'}</blockquote>
            <dl><div><dt>Customer</dt><dd>{activeSelectedFeedback.customer_name || `Customer #${activeSelectedFeedback.customer_id}`}</dd></div><div><dt>Customer ID</dt><dd>#{activeSelectedFeedback.customer_id}</dd></div><div><dt>Order</dt><dd>#{activeSelectedFeedback.order_id}</dd></div><div><dt>Submitted</dt><dd>{activeSelectedFeedback.created_at ? new Date(activeSelectedFeedback.created_at).toLocaleString() : 'Date unavailable'}</dd></div></dl>
            <footer><button type="button" onClick={() => { setSelectedFeedback(null); setNotificationFeedbackTarget(null) }}>Close</button></footer>
        </section>
      </div>}
    </section>
    if (section === 'transactions') return <section className="staff-transactions-page">
      <header className="staff-transactions-heading"><div><p className="eyebrow">RECORDED SALES</p><h2>Transactions</h2><p>Review recorded sales, payment methods, and transaction statuses.</p></div></header>
      {salesError && <p role="alert" className="staff-transactions-error">{salesError}</p>}
      {notificationTransactionTarget && !salesLoading && !notificationSelectedTransaction && !salesError && <p role="alert" className="staff-transactions-error">Transaction #{notificationTransactionTarget} could not be found.</p>}
      <div className="staff-transactions-summary" aria-label="Transaction summary">
        <article><span className="staff-transactions-icon" aria-hidden="true">▤</span><small>Total transactions</small><strong>{sales.length}</strong><span>Recorded sales</span></article>
        <article><span className="staff-transactions-icon is-revenue" aria-hidden="true">₱</span><small>Recorded revenue</small><strong>PHP {transactionRevenue.toFixed(2)}</strong><span>Successful transactions only</span></article>
        <article><span className="staff-transactions-icon is-success" aria-hidden="true">✓</span><small>Successful</small><strong>{successfulTransactions.length}</strong><span>Completed or paid</span></article>
        <article><span className="staff-transactions-icon is-pending" aria-hidden="true">◷</span><small>Pending</small><strong>{pendingTransactions.length}</strong><span>Pending status</span></article>
        <article><span className="staff-transactions-icon is-failed" aria-hidden="true">×</span><small>Failed / cancelled</small><strong>{failedTransactions.length}</strong><span>Failed, cancelled, or rejected</span></article>
      </div>
      <section className="staff-transactions-browser" aria-label="Transaction records">
        <div className="staff-transactions-toolbar">
          <div><h3>All transactions</h3><span>{visibleTransactions.length} of {sales.length} records</span></div>
          <div className="staff-transactions-filters">
            <label className="staff-transaction-search">Search transactions<input type="search" value={transactionSearch} onChange={event => setTransactionSearch(event.target.value)} placeholder="Transaction ID or customer ID" /></label>
            <label>Payment status<select value={transactionStatusFilter} onChange={event => setTransactionStatusFilter(event.target.value)}><option value="all">All statuses</option>{transactionStatuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
            <label>Payment method<select value={transactionMethodFilter} onChange={event => setTransactionMethodFilter(event.target.value)}><option value="all">All methods</option>{transactionMethods.map(method => <option key={method} value={method}>{method}</option>)}</select></label>
            <label>Transaction date<select value={transactionDateFilter} onChange={event => setTransactionDateFilter(event.target.value)}><option value="all">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></label>
            <label>Sort by<select value={transactionSort} onChange={event => setTransactionSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount-high">Amount: high to low</option><option value="amount-low">Amount: low to high</option></select></label>
          </div>
        </div>
        {salesLoading ? <p role="status" className="staff-transactions-empty">Loading transactions…</p> : visibleTransactions.length ? <div className="staff-transactions-table-wrap">
          <table className="staff-transactions-table">
            <thead><tr><th>Transaction</th><th>Customer</th><th>Date</th><th>Payment method</th><th>Amount</th><th>Status</th><th><span className="staff-sr-only">Actions</span></th></tr></thead>
            <tbody>{visibleTransactions.map(sale => {
              const status = normalizeTransactionStatus(sale.status)
              const tone = ['completed', 'complete', 'successful', 'success', 'paid'].includes(status) ? 'is-success' : status.includes('pending') ? 'is-pending' : status.includes('refund') ? 'is-refunded' : ['failed', 'failure', 'cancelled', 'canceled', 'rejected'].includes(status) ? 'is-failed' : ''
              const methodLabel = sale.payment_method === 'cash_on_pickup' ? 'Cash on Pickup' : sale.payment_method || 'Not recorded'
              return <tr key={sale.id}>
                <td><strong className="staff-transaction-id">SALE-{sale.id}</strong></td>
                <td><span className="staff-transaction-customer">{sale.user_id != null ? `Customer #${sale.user_id}` : 'Customer not recorded'}</span></td>
                <td>{sale.created_at ? new Date(sale.created_at).toLocaleString() : 'Date unavailable'}</td>
                <td>{methodLabel}</td>
                <td><strong className="staff-transaction-amount">PHP {Number(sale.total || 0).toFixed(2)}</strong></td>
                <td><span className={`staff-transaction-status ${tone}`}>{sale.status || 'Status unavailable'}</span></td>
                <td><button type="button" className="staff-transaction-view" onClick={() => { setNotificationTransactionTarget(null); setSelectedTransaction(sale) }} aria-label={`View details for transaction ${sale.id}`}>View details</button></td>
              </tr>
            })}</tbody>
          </table>
        </div> : <p className="staff-transactions-empty">{sales.length ? 'No transactions match your search and filters.' : 'No sales transactions have been recorded.'}</p>}
      </section>
      {activeSelectedTransaction && <div className="staff-transaction-modal-backdrop" role="presentation" onClick={() => { setSelectedTransaction(null); setNotificationTransactionTarget(null) }}>
        <section ref={transactionModalRef} className="staff-transaction-modal" role="dialog" aria-modal="true" aria-labelledby="staff-transaction-modal-title" onClick={event => event.stopPropagation()}>
          <button type="button" className="staff-transaction-modal-close" onClick={() => { setSelectedTransaction(null); setNotificationTransactionTarget(null) }} aria-label="Close transaction details">×</button>
          <p className="eyebrow">TRANSACTION DETAILS</p><h3 id="staff-transaction-modal-title">SALE-{activeSelectedTransaction.id}</h3>
          <span className={`staff-transaction-status ${['completed', 'complete', 'successful', 'success', 'paid'].includes(normalizeTransactionStatus(activeSelectedTransaction.status)) ? 'is-success' : normalizeTransactionStatus(activeSelectedTransaction.status).includes('pending') ? 'is-pending' : normalizeTransactionStatus(activeSelectedTransaction.status).includes('refund') ? 'is-refunded' : ['failed', 'failure', 'cancelled', 'canceled', 'rejected'].includes(normalizeTransactionStatus(activeSelectedTransaction.status)) ? 'is-failed' : ''}`}>{activeSelectedTransaction.status || 'Status unavailable'}</span>
          <strong className="staff-transaction-modal-amount">PHP {Number(activeSelectedTransaction.total || 0).toFixed(2)}</strong>
          <dl><div><dt>Transaction ID</dt><dd>SALE-{activeSelectedTransaction.id}</dd></div><div><dt>Customer</dt><dd>{activeSelectedTransaction.user_id != null ? `Customer #${activeSelectedTransaction.user_id}` : 'Not recorded'}</dd></div><div><dt>Transaction date</dt><dd>{activeSelectedTransaction.created_at ? new Date(activeSelectedTransaction.created_at).toLocaleString() : 'Date unavailable'}</dd></div><div><dt>Payment method</dt><dd>{activeSelectedTransaction.payment_method === 'cash_on_pickup' ? 'Cash on Pickup' : activeSelectedTransaction.payment_method || 'Not recorded'}</dd></div><div><dt>Payment status</dt><dd>{activeSelectedTransaction.status || 'Not recorded'}</dd></div><div><dt>Related order</dt><dd>Not provided by transaction records</dd></div><div><dt>Reference number</dt><dd>Not provided by transaction records</dd></div></dl>
          <footer><button type="button" onClick={() => { setSelectedTransaction(null); setNotificationTransactionTarget(null) }}>Close</button></footer>
        </section>
      </div>}
    </section>
    if (section === 'reports') return <section className="staff-reports-page">
      <header className="staff-reports-heading"><div><p className="eyebrow">STAFF WORKSPACE</p><h2>Reports</h2><p>Explore sales and order activity from the records available to your account.</p></div></header>
      <section className="staff-reports-filters" aria-label="Report date filters">
        <label>Report period<select value={reportPeriod} onChange={event => setReportPeriod(event.target.value)}><option value="all">All available records</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom date range</option></select></label>
        {reportPeriod === 'custom' && <>
          <label>Start date<input type="date" value={reportStartDate} onChange={event => setReportStartDate(event.target.value)} /></label>
          <label>End date<input type="date" value={reportEndDate} onChange={event => setReportEndDate(event.target.value)} /></label>
        </>}
        <p>Summary and charts use the loaded sales and order records. Standalone report exports are not available in this staff section.</p>
      </section>
      {salesError && <p className="staff-reports-error" role="alert">Sales data: {salesError}</p>}
      {ordersError && <p className="staff-reports-error" role="alert">Order data: {ordersError}</p>}
      <div className="staff-reports-summary" aria-label="Report summary">
        <article><span className="staff-reports-icon" aria-hidden="true">₱</span><small>Total sales</small><strong>PHP {reportTotalSales.toFixed(2)}</strong><span>{reportSales.length} recorded transactions</span></article>
        <article><span className="staff-reports-icon is-orders" aria-hidden="true">▤</span><small>Total orders</small><strong>{reportOrders.length}</strong><span>Orders in selected period</span></article>
        <article><span className="staff-reports-icon is-transactions" aria-hidden="true">↗</span><small>Transactions</small><strong>{reportSales.length}</strong><span>Recorded sales entries</span></article>
        <article><span className="staff-reports-icon is-completed" aria-hidden="true">✓</span><small>Completed orders</small><strong>{reportCompletedOrders.length}</strong><span>Completed or received</span></article>
        <article><span className="staff-reports-icon is-pending" aria-hidden="true">◷</span><small>Pending orders</small><strong>{reportPendingOrders.length}</strong><span>Awaiting confirmation</span></article>
      </div>
      {salesLoading || ordersLoading ? <p role="status" className="staff-reports-empty">Loading report data…</p> : <div className="staff-reports-charts">
        <section className="staff-report-panel">
          <header><div><p className="eyebrow">SALES OVERVIEW</p><h3>Recorded sales trend</h3></div><span>{reportUsesMonthlyBuckets ? 'Monthly totals' : 'Daily totals'}</span></header>
          {reportTrend.some(bucket => bucket.transactions) ? <div className="staff-report-bars" role="img" aria-label={`${reportUsesMonthlyBuckets ? 'Monthly' : 'Daily'} sales totals based on recorded transactions`}>
            {reportTrend.filter(bucket => bucket.transactions).map(bucket => {
              const label = reportUsesMonthlyBuckets
                ? bucket.date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
                : bucket.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              const width = Math.max(2, (bucket.sales / reportChartMax) * 100)
              return <div className="staff-report-bar-row" key={bucket.key} title={`${label}: PHP ${bucket.sales.toFixed(2)} from ${bucket.transactions} transactions`}><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><strong>PHP {bucket.sales.toFixed(2)}</strong></div>
            })}
          </div> : <p className="staff-reports-empty">No dated sales records are available for this period.</p>}
        </section>
        <section className="staff-report-panel">
          <header><div><p className="eyebrow">ORDER ACTIVITY</p><h3>Orders by status</h3></div><span>{reportOrders.length} total</span></header>
          {reportOrderStatuses.length ? <div className="staff-report-status-chart">{reportOrderStatuses.map(({ status, count }) => <div className="staff-report-status-row" key={status}><div><span>{status}</span><strong>{count}</strong></div><div className="staff-report-status-track"><i style={{ width: `${(count / reportStatusMax) * 100}%` }} /></div></div>)}</div> : <p className="staff-reports-empty">No order records are available for this period.</p>}
        </section>
      </div>}
      <section className="staff-report-table-panel">
        <header><div><p className="eyebrow">PERIOD SUMMARY</p><h3>Sales and order records by date</h3></div><span>{reportTrend.length} periods with activity</span></header>
        {salesLoading || ordersLoading ? <p role="status" className="staff-reports-empty">Loading report data…</p> : reportTrend.length ? <div className="staff-report-table-wrap"><table><thead><tr><th>Period</th><th>Sales total</th><th>Transactions</th><th>Orders</th></tr></thead><tbody>{[...reportTrend].reverse().map(bucket => <tr key={bucket.key}><td>{reportUsesMonthlyBuckets ? bucket.date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : bucket.date.toLocaleDateString()}</td><td><strong>PHP {bucket.sales.toFixed(2)}</strong></td><td>{bucket.transactions}</td><td>{bucket.orders}</td></tr>)}</tbody></table></div> : <p className="staff-reports-empty">No dated sales or orders are available for this period.</p>}
      </section>
    </section>
    if (section === 'notifications') return <NotificationCenter panel onOpenNotification={openStaffNotification} />
    return <StaffAccountPage view={accountView} darkMode={darkMode} onThemeChange={onThemeChange} onProfileUpdated={updatedProfile => { setProfile(current => ({ ...current, ...updatedProfile })); onProfileUpdated?.(updatedProfile) }} />
  }
  return <main className="staff-console"><aside className="staff-sidebar"><div className="sidebar-brand"><span className="logo-mark" aria-hidden="true">SS</span> STAFF</div><p className="staff-role">Staff access</p><nav aria-label="Staff navigation">{sections.map(([key, label]) => <button type="button" className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} key={key} onClick={() => { if (key === 'profile') setAccountView('profile'); navigateTo(key) }}><span aria-hidden="true">{label[0]}</span>{label}</button>)}</nav><div className="staff-account-menu" ref={accountMenuRef}>
    {accountMenuOpen && <div className="staff-account-menu-dropdown" role="menu" aria-label="Staff account menu">
      <button type="button" role="menuitem" onClick={() => { setAccountView('profile'); navigateTo('profile') }}><span aria-hidden="true">♙</span>My Profile</button>
      <button type="button" role="menuitem" onClick={() => { setAccountView('settings'); navigateTo('profile') }}><span aria-hidden="true">⚙</span>Account Settings</button>
      <button type="button" role="menuitem" onClick={() => { setAccountView('activity'); navigateTo('profile') }}><span aria-hidden="true">◷</span>Account Activity</button>
      <button type="button" role="menuitem" className="is-logout" onClick={() => { setAccountMenuOpen(false); onLogout() }}><span aria-hidden="true">↪</span>Logout</button>
    </div>}
    <button type="button" className="staff-account-menu-trigger" aria-haspopup="menu" aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen(open => !open)}>
      <span className="staff-account-menu-avatar">{profile.profile_image_url ? <img src={profile.profile_image_url} alt="" /> : <span aria-hidden="true">{(profile.name || username || 'S').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</span>}</span>
      <span className="staff-account-menu-copy"><strong>{profile.name || username || 'Staff member'}</strong><small>Staff account</small></span><span className="staff-account-menu-chevron" aria-hidden="true">{accountMenuOpen ? '⌄' : '⌃'}</span>
    </button>
  </div></aside><section className="staff-content"><header className="staff-topbar"><div><p className="eyebrow">STAFF WORKSPACE</p><h1>{title}</h1></div><NotificationCenter onOpenNotification={openStaffNotification} /><span className="staff-user">{profile.name || username || profile.email || 'Staff member'}</span></header><div className="staff-body">{section !== 'dashboard' && <RoleBackButton onClick={goBack} />}{section === 'dashboard' && <div className="staff-welcome"><div><p>Today’s focus.</p><h2>Keep the store<br /><em>moving.</em></h2></div><span>OPERATIONS / STAFF</span></div>}{renderContent()}</div></section></main>
}

export default StaffPage
