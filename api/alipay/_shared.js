import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const COMMUNITY_ID = 'at-club'
export { FieldValue }

let firebaseServices

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`missing-env:${name}`)
  return value
}

export function getFirebaseServices() {
  if (firebaseServices) return firebaseServices
  let serviceAccount
  try {
    const rawServiceAccount = requiredEnv('FIREBASE_SERVICE_ACCOUNT_JSON')
    serviceAccount = JSON.parse(rawServiceAccount)
    if (typeof serviceAccount === 'string') serviceAccount = JSON.parse(serviceAccount)
  } catch (error) {
    if (error.message?.startsWith('missing-env:')) throw error
    throw new Error('invalid-env:FIREBASE_SERVICE_ACCOUNT_JSON')
  }
  if (!serviceAccount || typeof serviceAccount !== 'object'
    || !serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('invalid-env:FIREBASE_SERVICE_ACCOUNT_JSON')
  }
  const projectId = serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID
  const configuredProjectId = String(process.env.FIREBASE_PROJECT_ID || '').trim()
  if (configuredProjectId && projectId && configuredProjectId !== projectId) {
    throw new Error('firebase-admin/project-mismatch')
  }
  let app
  try {
    app = getApps().length
      ? getApps()[0]
      : initializeApp({
        credential: cert(serviceAccount),
        projectId,
      })
  } catch (error) {
    if (error.message === 'firebase-admin/project-mismatch') throw error
    throw new Error('invalid-env:FIREBASE_SERVICE_ACCOUNT_JSON')
  }
  firebaseServices = {
    auth: getAuth(app),
    db: getFirestore(app),
  }
  return firebaseServices
}

export function sendJson(response, status, payload) {
  response.status(status).json(payload)
}

export async function parseJsonBody(request) {
  if (request.body && typeof request.body === 'object') return request.body
  let raw = typeof request.body === 'string' ? request.body : ''
  if (!raw) {
    for await (const chunk of request) raw += chunk
  }
  if (!raw) return {}

  const contentType = request.headers?.['content-type'] || request.headers?.get?.('content-type') || ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw))
  }
  return JSON.parse(raw)
}

function getXPayBaseUrl() {
  return requiredEnv('XPAY_BASE_URL').replace(/\/+$/, '')
}

export async function callXPay(path, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(`${getXPayBaseUrl()}${path}`, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.success !== true) {
      const error = new Error(payload.message || 'xpay-payment-request-failed')
      error.statusCode = 502
      throw error
    }
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

export async function requireUser(request) {
  const authorization = request.headers.authorization || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!token) {
    const error = new Error('alipay-auth-required')
    error.statusCode = 401
    throw error
  }
  const { auth } = getFirebaseServices()
  return auth.verifyIdToken(token)
}

export function toAmount(value) {
  return Number(value || 0).toFixed(2)
}

export function createScheduleItem(event) {
  const [month, day] = String(event.date).split('.').map(Number)
  return {
    id: `event-${event.id}`,
    eventId: event.id,
    date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: String(event.time).split(' ')[0],
    title: event.title,
    type: '社群活动',
    note: `${event.venue} · 已报名`,
    accent: event.accent,
    completed: false,
    linked: true,
  }
}

export async function finalizePaidOrder(outTradeNo, payment = {}) {
  const { db } = getFirebaseServices()
  const orderRef = db.doc(`communities/${COMMUNITY_ID}/paymentOrders/${outTradeNo}`)
  return db.runTransaction(async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef)
    if (!orderSnapshot.exists) throw new Error('payment-order-not-found')
    const order = orderSnapshot.data()
    const totalAmount = payment.total_amount === undefined
      ? toAmount(order.totalAmount)
      : toAmount(payment.total_amount)
    if (toAmount(order.totalAmount) !== totalAmount) throw new Error('payment-amount-mismatch')
    if (order.status === 'paid') return { status: 'paid', event: order.eventSnapshot }

    const communityRef = db.doc(`communities/${COMMUNITY_ID}`)
    const userRef = db.doc(`communities/${COMMUNITY_ID}/users/${order.uid}`)
    const [communitySnapshot, userSnapshot] = await Promise.all([
      transaction.get(communityRef),
      transaction.get(userRef),
    ])
    if (!communitySnapshot.exists) throw new Error('community-not-found')

    const community = communitySnapshot.data()
    const userData = userSnapshot.exists ? userSnapshot.data() : {}
    const events = Array.isArray(community.events) ? community.events : []
    const event = events.find((item) => String(item.id) === String(order.eventId))
    const joinedIds = Array.isArray(userData.joinedIds) ? userData.joinedIds : []
    const scheduleItems = Array.isArray(userData.scheduleItems) ? userData.scheduleItems : []

    if (!event) throw new Error('event-not-found')
    if (joinedIds.some((id) => String(id) === String(event.id))) {
      transaction.set(userRef, {
        paymentStatuses: {
          ...(userData.paymentStatuses || {}),
          [event.id]: 'paid',
        },
      }, { merge: true })
      transaction.update(orderRef, {
        status: 'paid',
        tradeNo: payment.provider_trade_no || order.providerTradeNo || '',
        paidEventSnapshot: event,
        paidAt: FieldValue.serverTimestamp(),
      })
      return { status: 'paid', event }
    }
    if (Number(event.spots) <= 0) {
      transaction.update(orderRef, {
        status: 'paid_but_unavailable',
        tradeNo: payment.provider_trade_no || order.providerTradeNo || '',
        paidAt: FieldValue.serverTimestamp(),
      })
      return { status: 'paid_but_unavailable', event: order.eventSnapshot || event }
    }

    const nextEvent = { ...event, spots: Math.max(0, Number(event.spots) - 1) }
    const nextEvents = events.map((item) => String(item.id) === String(event.id) ? nextEvent : item)
    const nextScheduleItems = scheduleItems.some((item) => String(item.eventId) === String(event.id))
      ? scheduleItems
      : [...scheduleItems, createScheduleItem(event)]

    transaction.update(communityRef, { events: nextEvents })
    transaction.set(userRef, {
      joinedIds: [...joinedIds, event.id],
      scheduleItems: nextScheduleItems,
      paymentStatuses: {
        ...(userData.paymentStatuses || {}),
        [event.id]: 'paid',
      },
    }, { merge: true })
    transaction.update(orderRef, {
      status: 'paid',
      tradeNo: payment.provider_trade_no || order.providerTradeNo || '',
      paidEventSnapshot: nextEvent,
      paidAt: FieldValue.serverTimestamp(),
    })
    return { status: 'paid', event: nextEvent }
  })
}

export function handleApiError(response, error) {
  const statusCode = error.statusCode
    || (/^(missing-env|invalid-env):/.test(error.message || '') ? 503 : 500)
  const errorCode = error.message || error.code || 'alipay-server-error'
  console.error('[api-error]', {
    code: errorCode,
    statusCode,
    message: errorCode === 'alipay-server-error' ? error.message : undefined,
  })
  const messages = {
    'alipay-auth-required': '请先登录后再支付。',
    'payment-order-not-found': '支付订单不存在。',
    'event-required': '请选择要报名的场次。',
    'event-sold-out': '这场已经满员。',
    'invalid-payment-status': '报名状态无效。',
    'auth-required': '请先登录后再报名。',
    'admin-required': '只有管理员可以执行此操作。',
    'cancellation-not-found': '取消报名申请不存在。',
    'cancellation-already-reviewed': '这条取消报名申请已经处理过了。',
    'invalid-cancellation-review': '取消申请审核参数无效。',
    'payment-amount-mismatch': '支付金额校验失败。',
    'payment-email-required': '当前账号没有邮箱，无法创建支付订单。',
    'xpay-payment-request-failed': 'XPay 支付服务暂时不可用。',
    'xpay-payment-response-invalid': 'XPay 返回的支付数据无效。',
    'payment-failed': '支付未成功，请检查金额和备注后重试。',
    'invalid-notification': '支付宝通知参数不完整。',
    'invalid-event-price': '当前场次价格配置无效。',
    'event-not-found': '场次不存在或已下架。',
    'event-sold-out-after-payment': '这场刚刚满员，请联系客服处理退款。',
    'community-not-found': '社群数据暂时不可用。',
    'missing-env:XPAY_BASE_URL': 'XPay 支付服务尚未配置。',
    'missing-env:FIREBASE_SERVICE_ACCOUNT_JSON': '支付服务端尚未连接 Firebase。',
    'invalid-env:FIREBASE_SERVICE_ACCOUNT_JSON': '报名服务端 Firebase 凭据格式错误，请重新粘贴完整的 Service Account JSON。',
    'firebase-admin/project-mismatch': '报名服务端 Firebase 项目不一致，请确认 Service Account 属于 tshirt-c0235。',
  }
  const code = errorCode
  sendJson(response, statusCode, { code, message: messages[code] || '支付服务暂时不可用，请稍后再试。' })
}
