import {
  callXPay,
  finalizePaidOrder,
  getFirebaseServices,
  handleApiError,
  requireUser,
  sendJson,
} from './_shared.js'

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    return sendJson(response, 405, { code: 'method-not-allowed', message: '请求方式不支持。' })
  }

  try {
    const user = await requireUser(request)
    const outTradeNo = String(request.query?.out_trade_no || '').trim()
    if (!outTradeNo) return sendJson(response, 400, { code: 'order-required', message: '缺少支付订单号。' })

    const { db } = getFirebaseServices()
    const orderSnapshot = await db.doc(`communities/at-club/paymentOrders/${outTradeNo}`).get()
    if (!orderSnapshot.exists || orderSnapshot.data().uid !== user.uid) {
      return sendJson(response, 404, { code: 'payment-order-not-found', message: '支付订单不存在。' })
    }
    const order = orderSnapshot.data()
    if (order.status === 'paid') {
      const communitySnapshot = await db.doc('communities/at-club').get()
      const currentEvent = (communitySnapshot.data()?.events || [])
        .find((item) => String(item.id) === String(order.eventId))
      return sendJson(response, 200, {
        status: 'paid',
        event: currentEvent || order.paidEventSnapshot || order.eventSnapshot,
      })
    }

    if (!order.providerTradeNo) {
      return sendJson(response, 200, { status: 'pending' })
    }

    const providerResponse = await callXPay(`/pay/state/${encodeURIComponent(order.providerTradeNo)}`)
    const providerState = Number(providerResponse.result)
    if (providerState === 2) return sendJson(response, 200, { status: 'failed' })
    if (providerState !== 1 && providerState !== 3) {
      return sendJson(response, 200, { status: providerState === 4 ? 'scanning' : 'pending' })
    }

    const completed = await finalizePaidOrder(outTradeNo, {
      provider_trade_no: order.providerTradeNo,
      total_amount: order.totalAmount,
    })
    return sendJson(response, 200, completed)
  } catch (error) {
    return handleApiError(response, error)
  }
}
