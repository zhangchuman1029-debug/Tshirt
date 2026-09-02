import {
  createEventAttendee,
  createScheduleItem,
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
    const { eventId, paymentStatus = 'paid' } = await parseJsonBody(request)
    if (eventId === undefined || eventId === null) {
      return sendJson(response, 400, { code: 'event-required', message: '请选择要报名的场次。' })
    }
    if (!['paid', 'pending'].includes(paymentStatus)) {
      return sendJson(response, 400, { code: 'invalid-payment-status', message: '报名状态无效。' })
    }

    const { db } = getFirebaseServices()
    const communityRef = db.doc(`communities/${COMMUNITY_ID}`)
    const userRef = db.doc(`communities/${COMMUNITY_ID}/users/${user.uid}`)
    const profileRef = db.doc(`communities/${COMMUNITY_ID}/profiles/${user.uid}`)
    const result = await db.runTransaction(async (transaction) => {
      const [communitySnapshot, userSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(communityRef),
        transaction.get(userRef),
        transaction.get(profileRef),
      ])
      if (!communitySnapshot.exists) throw new Error('community-not-found')

      const community = communitySnapshot.data()
      const userData = userSnapshot.exists ? userSnapshot.data() : {}
      const profileData = profileSnapshot.exists ? profileSnapshot.data() : {}
      const events = Array.isArray(community.events) ? community.events : []
      const event = events.find((item) => String(item.id) === String(eventId))
      if (!event) throw new Error('event-not-found')
      if (event.status === '已取消' || event.cancelledAt) {
        const error = new Error('event-cancelled')
        error.statusCode = 409
        throw error
      }

      const joinedIds = Array.isArray(userData.joinedIds) ? userData.joinedIds : []
      const paymentStatuses = userData.paymentStatuses || {}
      const scheduleItems = Array.isArray(userData.scheduleItems) ? userData.scheduleItems : []
      if (joinedIds.some((id) => String(id) === String(event.id))) {
        return { event, alreadyJoined: true }
      }
      if (Number(event.spots) <= 0) throw new Error('event-sold-out')

      const attendee = { ...createEventAttendee(user, userData, profileData), joinedAt: new Date().toISOString() }
      const attendees = Array.isArray(event.attendees) ? event.attendees : []
      const nextAttendees = attendees.some((item) => item?.uid === attendee.uid) ? attendees : [...attendees, attendee]
      const nextEvent = { ...event, spots: Math.max(0, Number(event.spots) - 1), attendees: nextAttendees }
      transaction.update(communityRef, {
        events: events.map((item) => String(item.id) === String(event.id) ? nextEvent : item),
      })
      transaction.set(userRef, {
        joinedIds: [...joinedIds, event.id],
        paymentStatuses: { ...paymentStatuses, [event.id]: paymentStatus },
        scheduleItems: scheduleItems.some((item) => String(item.eventId) === String(event.id))
          ? scheduleItems
          : [...scheduleItems, createScheduleItem(event)],
      }, { merge: true })
      return { event: nextEvent, alreadyJoined: false }
    })

    return sendJson(response, 200, { ...result, status: 'joined' })
  } catch (error) {
    return handleApiError(response, error)
  }
}
