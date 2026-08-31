import {
  FieldValue,
  getFirebaseServices,
  handleApiError,
  parseJsonBody,
  requireUser,
  sendJson,
} from '../alipay/_shared.js'

const COMMUNITY_ID = 'at-club'

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return sendJson(response, 405, { code: 'method-not-allowed', message: '请求方式不支持。' })
  }

  try {
    const user = await requireUser(request)
    const { requestId, decision } = await parseJsonBody(request)
    if (!requestId || !['approve', 'reject'].includes(decision)) {
      return sendJson(response, 400, { code: 'invalid-cancellation-review', message: '取消申请审核参数无效。' })
    }

    const { db } = getFirebaseServices()
    const accessSnapshot = await db.doc(`communityAccess/${COMMUNITY_ID}`).get()
    const access = accessSnapshot.data() || {}
    const isAdmin = user.owner === true
      || String(user.role || '').toLowerCase() === 'owner'
      || access.ownerUid === user.uid
      || (access.adminUids || []).includes(user.uid)
    if (!isAdmin) return sendJson(response, 403, { code: 'admin-required', message: '只有管理员可以审核取消报名申请。' })

    const requestRef = db.doc(`communities/${COMMUNITY_ID}/cancellationRequests/${requestId}`)
    const communityRef = db.doc(`communities/${COMMUNITY_ID}`)
    const result = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef)
      if (!requestSnapshot.exists) throw new Error('cancellation-not-found')
      const cancellation = requestSnapshot.data()
      if (cancellation.status !== 'pending') throw new Error('cancellation-already-reviewed')
      if (decision === 'reject') {
        transaction.update(requestRef, { status: 'rejected', reviewedAt: FieldValue.serverTimestamp() })
        return { status: 'rejected' }
      }

      const userRef = db.doc(`communities/${COMMUNITY_ID}/users/${cancellation.uid}`)
      const [communitySnapshot, userSnapshot] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(userRef),
      ])
      if (!communitySnapshot.exists) throw new Error('community-not-found')
      const community = communitySnapshot.data()
      const userData = userSnapshot.exists ? userSnapshot.data() : {}
      const events = Array.isArray(community.events) ? community.events : []
      const event = events.find((item) => String(item.id) === String(cancellation.eventId))
      if (!event) throw new Error('event-not-found')
      const joinedIds = Array.isArray(userData.joinedIds) ? userData.joinedIds : []
      const scheduleItems = Array.isArray(userData.scheduleItems) ? userData.scheduleItems : []
      const nextEvents = events.map((item) => String(item.id) === String(event.id)
        ? { ...item, spots: Math.min(Number(item.total), Number(item.spots) + 1) }
        : item)

      transaction.update(communityRef, { events: nextEvents })
      transaction.set(userRef, {
        joinedIds: joinedIds.filter((id) => String(id) !== String(event.id)),
        scheduleItems: scheduleItems.filter((item) => String(item.eventId) !== String(event.id)),
        paymentStatuses: {
          ...(userData.paymentStatuses || {}),
          [event.id]: 'cancelled',
        },
      }, { merge: true })
      transaction.update(requestRef, { status: 'approved', reviewedAt: FieldValue.serverTimestamp() })
      return { status: 'approved', event }
    })
    return sendJson(response, 200, result)
  } catch (error) {
    return handleApiError(response, error)
  }
}
