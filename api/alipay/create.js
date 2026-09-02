import {
  callXPay,
  getFirebaseServices,
  handleApiError,
  parseJsonBody,
  requireUser,
  sendJson,
  toAmount,
} from './_shared.js'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendJson(response, 405, { code: 'method-not-allowed', message: '请求方式不支持。' })
  }

  try {
    const user = await requireUser(request)
    const { eventId } = await parseJsonBody(request)
    if (eventId === undefined || eventId === null) {
      return sendJson(response, 400, { code: 'event-required', message: '请选择要报名的场次。' })
    }

    const { db } = getFirebaseServices()
    const communitySnapshot = await db.doc('communities/at-club').get()
    if (!communitySnapshot.exists) {
      return sendJson(response, 404, { code: 'community-not-found', message: '社群数据暂时不可用。' })
    }
    const community = communitySnapshot.data()
    const event = (community.events || []).find((item) => String(item.id) === String(eventId))
    if (!event) return sendJson(response, 404, { code: 'event-not-found', message: '场次不存在或已下架。' })
    if (event.status === '已取消' || event.cancelledAt) {
      return sendJson(response, 409, { code: 'event-cancelled', message: '这场活动已取消发布。' })
    }

    const userSnapshot = await db.doc(`communities/at-club/users/${user.uid}`).get()
    const userData = userSnapshot.exists ? userSnapshot.data() : {}
    const alreadyJoined = (userData.joinedIds || []).some((id) => String(id) === String(event.id))
    const paymentStatus = userData.paymentStatuses?.[event.id]
    if (alreadyJoined && paymentStatus !== 'pending') {
      return sendJson(response, 409, { code: 'already-joined', message: '你已经报名这场活动了。' })
    }
    if (!alreadyJoined && Number(event.spots) <= 0) {
      return sendJson(response, 409, { code: 'event-sold-out', message: '这场已经满员。' })
    }

    const outTradeNo = `ATC${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const totalAmount = toAmount(event.price)
    if (Number(totalAmount) <= 0) {
      return sendJson(response, 400, { code: 'invalid-event-price', message: '当前场次价格配置无效。' })
    }
    const email = user.email || ''
    if (!email) {
      return sendJson(response, 400, { code: 'payment-email-required', message: '当前账号没有邮箱，无法创建支付订单。' })
    }
    const order = {
      uid: user.uid,
      eventId: event.id,
      eventSnapshot: event,
      totalAmount,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    await db.doc(`communities/at-club/paymentOrders/${outTradeNo}`).set(order)

    const xpayPayload = new URLSearchParams({
      nickName: user.name || email.split('@')[0] || '社群成员',
      money: totalAmount,
      email,
      payType: 'Alipay',
      info: `${event.title} · ${event.date} ${event.time}`,
      custom: 'true',
      mobile: 'false',
      device: request.headers['user-agent'] || '',
    })
    const xpayResponse = await callXPay('/pay/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: xpayPayload,
    })
    const providerOrder = xpayResponse.result || {}
    if (!providerOrder.id || !providerOrder.payNum) {
      const error = new Error('xpay-payment-response-invalid')
      error.statusCode = 502
      throw error
    }
    const xpayOpenUrl = `${process.env.XPAY_BASE_URL.replace(/\/+$/, '')}/openAlipay?money=${encodeURIComponent(totalAmount)}&num=${encodeURIComponent(providerOrder.payNum)}&id=${encodeURIComponent(providerOrder.id)}`
    const paymentUrl = `alipays://platformapi/startapp?appId=20000067&url=${encodeURIComponent(xpayOpenUrl)}`
    await db.doc(`communities/at-club/paymentOrders/${outTradeNo}`).update({
      provider: 'xpay-v1.7',
      providerTradeNo: providerOrder.id,
      providerPayNum: providerOrder.payNum,
      providerOpenUrl: xpayOpenUrl,
      providerPaymentUrl: paymentUrl,
    })
    return sendJson(response, 200, { outTradeNo, qrCode: paymentUrl, paymentUrl })
  } catch (error) {
    return handleApiError(response, error)
  }
}
