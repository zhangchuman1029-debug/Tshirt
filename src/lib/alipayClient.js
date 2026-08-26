const apiBaseUrl = import.meta.env.VITE_ALIPAY_API_BASE_URL || '/api/alipay'

export const isAlipayEnabled = import.meta.env.VITE_ALIPAY_ENABLED === 'true'

async function requestAlipay(path, firebaseUser, options = {}) {
  if (!firebaseUser) throw new Error('alipay-auth-required')
  const idToken = await firebaseUser.getIdToken()
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || '支付宝服务暂时不可用。')
    error.code = payload.code || `alipay-http-${response.status}`
    throw error
  }
  return payload
}

export function createAlipayPayment(event, firebaseUser) {
  return requestAlipay('/create', firebaseUser, {
    method: 'POST',
    body: JSON.stringify({ eventId: event.id }),
  })
}

export function getAlipayPaymentStatus(outTradeNo, firebaseUser) {
  return requestAlipay(`/status?out_trade_no=${encodeURIComponent(outTradeNo)}`, firebaseUser)
}
