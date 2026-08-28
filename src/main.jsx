import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import QRCode from 'qrcode'
import {
  ArrowUpRight,
  ArrowLeft,
  AtSign,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  Crown,
  Ellipsis,
  Eye,
  EyeOff,
  Heart,
  MailCheck,
  House,
  LockKeyhole,
  LogIn,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Paperclip,
  Pin,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserRound,
  UserPlus,
  UsersRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { sendWelcomeEmail } from './lib/emailService'
import { createAlipayPayment, getAlipayPaymentStatus, isAlipayEnabled } from './lib/alipayClient'
import {
  createInviteCodeRecord,
  getFirebaseAuthErrorMessage,
  getFirebaseOwnerStatus,
  isRegisteredMember,
  isFirebaseConfigured,
  loginWithFirebase,
  logoutFromFirebase,
  registerWithFirebase,
  saveCommunityAccess,
  saveCommunityData,
  saveCommunityProfile,
  saveUserData,
  subscribeToAuth,
  subscribeToCommunityAccess,
  subscribeToCommunity,
  subscribeToCommunityProfiles,
  subscribeToAllUserData,
  subscribeToUserData,
  updateFirebaseProfile,
} from './lib/firebaseClient'
import './styles.css'

const COMMUNITY_NAME = 'A&T club'
const BRAND_SLOGAN = 'ambition&together'
const STORAGE_PREFIX = 'at-club.'
const ROLE_LABELS = { owner: 'Owner', administrator: 'Administrator', member: 'Member' }
const ROLE_FILTERS = [
  { key: 'all', label: '全部成员' },
  { key: 'owner', label: 'Owner' },
  { key: 'administrator', label: 'Administrator' },
  { key: 'member', label: 'Member' },
]
const INVITE_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const EVENT_PUBLISHER_LABELS = { administrator: '管理员发布', member: '成员发布' }

function getRoleKey(member, communityAccess) {
  if (member?.uid && member.uid === communityAccess?.ownerUid) return 'owner'
  if (member?.uid && communityAccess?.adminUids?.includes(member.uid)) return 'administrator'
  if (member?.roleKey && ROLE_LABELS[member.roleKey]) return member.roleKey
  if (member?.role === '所有者' || member?.role?.toLowerCase() === 'owner') return 'owner'
  if (member?.role === '管理员' || member?.role?.toLowerCase() === 'administrator') return 'administrator'
  return 'member'
}

function getMemberName(member) {
  return member?.nickname || member?.name || '未命名成员'
}

function getEventPublisherRole(event) {
  return event?.publisherRole === 'member' ? 'member' : 'administrator'
}

function mergeCommunityProfiles(members, profiles) {
  const profilesByUid = new Map(profiles.map((profile) => [profile.uid, profile]))
  const mergedMembers = members.map((member) => {
    const profile = member.uid ? profilesByUid.get(member.uid) : null
    if (!profile) return member
    const { updatedAt, ...displayProfile } = profile
    return {
      ...member,
      ...displayProfile,
      name: displayProfile.nickname || member.name,
    }
  })
  const memberUids = new Set(mergedMembers.map((member) => member.uid).filter(Boolean))
  const newMembers = profiles
    .filter((profile) => !memberUids.has(profile.uid))
    .map(({ updatedAt, ...profile }) => ({
      ...profile,
      name: profile.nickname || '未命名成员',
      role: ROLE_LABELS.member,
      roleKey: 'member',
      color: profile.color || 'green',
    }))
  return newMembers.length > 0 ? [...newMembers, ...mergedMembers] : mergedMembers
}

function RoleLabel({ roleKey, compact = false }) {
  const safeRoleKey = ROLE_LABELS[roleKey] ? roleKey : 'member'
  return <span className={`role-label ${compact ? 'is-compact' : ''}`}>{ROLE_LABELS[safeRoleKey]}</span>
}

const initialEvents = [
  {
    id: 1,
    date: '08.29',
    day: '周六',
    time: '19:30 — 22:00',
    title: '周六夜场 · 混合组局',
    level: '中级友好',
    venue: '深圳湾体育中心 · 2 号馆',
    address: '南山区滨海大道 3001 号',
    price: 38,
    spots: 4,
    total: 18,
    status: '报名中',
    accent: 'mint',
    publisherRole: 'administrator',
  },
  {
    id: 2,
    date: '08.31',
    day: '周一',
    time: '20:00 — 22:30',
    title: '周一发球局 · 节奏局',
    level: '进阶局',
    venue: '华侨城体育馆 · A 场',
    address: '南山区侨城东路 99 号',
    price: 42,
    spots: 7,
    total: 18,
    status: '报名中',
    accent: 'yellow',
    publisherRole: 'member',
  },
  {
    id: 3,
    date: '09.03',
    day: '周四',
    time: '19:00 — 21:00',
    title: '新手友好 · 第一次上场',
    level: '新手友好',
    venue: '蛇口文体公园 · 室内馆',
    address: '南山区工业三路 18 号',
    price: 30,
    spots: 9,
    total: 16,
    status: '报名中',
    accent: 'coral',
    publisherRole: 'administrator',
  },
]

const initialMembers = [
  { initials: '林', name: '林教练', nickname: '林教练', role: 'Administrator', roleKey: 'administrator', bio: '把每一场球都组织得刚刚好。', color: 'orange' },
  { initials: 'M', name: 'Mina', nickname: 'Mina', role: 'Member', roleKey: 'member', bio: '喜欢快节奏的来回球。', color: 'blue' },
  { initials: '阿', name: '阿哲', nickname: '阿哲', role: 'Member', roleKey: 'member', bio: '周末固定出现在 2 号馆。', color: 'purple' },
  { initials: 'Y', name: 'Yuki', nickname: 'Yuki', role: 'Member', roleKey: 'member', bio: '接发球和装备都很认真。', color: 'pink' },
  { initials: '小', name: '小满', nickname: '小满', role: 'Member', roleKey: 'member', bio: '新手上场，慢慢找到自己的节奏。', color: 'green' },
]

const starterMessages = [
  { id: 1, author: '林教练', initials: '林', color: 'orange', time: '19:06', text: '今晚 2 号馆还是照常开打，第一次来的朋友记得提前十分钟到，我们一起热身。', mine: false },
  { id: 2, author: 'Mina', initials: 'M', color: 'blue', time: '19:12', text: '收到！我会带两个新球，大家不用额外准备。', mine: false },
  { id: 3, author: '你', initials: '我', color: 'green', time: '19:18', text: '我报名周六夜场，场上见。', mine: true },
]

const starterPosts = [
  {
    id: 1,
    author: '林教练',
    initials: '林',
    color: 'orange',
    time: '刚刚',
    label: '社群公告',
    text: '这周六我们还是 2 号馆，提前 10 分钟热身。第一次来的球友可以在群里 @ 我，我会带你熟悉位置和轮转。',
    likes: 24,
    liked: false,
    comments: [
      { id: 101, author: 'Mina', initials: 'M', color: 'blue', time: '19:12', text: '收到，我会带两个新球过去。' },
    ],
  },
  {
    id: 2,
    author: '阿哲',
    initials: '阿',
    color: 'purple',
    time: '18 分钟前',
    label: '装备分享',
    text: '新球到啦，周六会带来试打。偏软一点，接发球手感很稳，想试的可以来找我。',
    likes: 11,
    liked: false,
    comments: [],
  },
]

const initialNotifications = [
  { id: 1, kind: 'event', title: '周六夜场还有 4 个空位', text: '林教练更新了活动名单，报名后记得提前十分钟到场。', time: '刚刚', read: false },
  { id: 2, kind: 'message', title: '消息 · A&T club 全员', text: 'Mina 在群里分享了新的排球。', time: '18 分钟前', read: false },
  { id: 3, kind: 'member', title: '新成员加入社群', text: '小满刚刚完成注册，欢迎她来到球场。', time: '昨天', read: true },
]

const initialScheduleItems = [
  { id: 'schedule-1', date: '2026-08-22', time: '08:30', title: '晨间拉伸', type: '个人安排', note: '给今天留一点不赶时间的热身。', accent: 'mint', completed: false },
  { id: 'schedule-2', date: '2026-08-24', time: '18:30', title: '整理周六夜场装备', type: '准备事项', note: '球鞋、护膝和新球放进包里。', accent: 'yellow', completed: false },
  { id: 'schedule-3', date: '2026-08-27', time: '20:00', title: '和 Mina 约训练', type: '约球', note: '先练接发，再打半小时对抗。', accent: 'coral', completed: false },
]

function readStoredValue(key, fallback) {
  try {
    const value = window.localStorage.getItem(`${STORAGE_PREFIX}${key}`)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function generateInviteCode() {
  const values = new Uint32Array(8)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values)
    return Array.from(values, (value) => INVITE_CODE_ALPHABET[value % INVITE_CODE_ALPHABET.length]).join('')
  }
  return Array.from({ length: 8 }, () => INVITE_CODE_ALPHABET[Math.floor(Math.random() * INVITE_CODE_ALPHABET.length)]).join('')
}

function Avatar({ initials, color = 'orange', size = 'regular' }) {
  return <span className={`avatar avatar-${color} avatar-${size}`}>{initials}</span>
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  )
}

function BrandLockup({ compact = false }) {
  return (
    <div className={compact ? 'brand-lockup compact' : 'brand-lockup'}>
      <BrandMark />
      <div><strong>{COMMUNITY_NAME}</strong><span>{BRAND_SLOGAN}</span></div>
    </div>
  )
}

function SectionLabel({ children, action, onAction, secondaryAction, onSecondaryAction }) {
  return (
    <div className="section-label">
      <h2>{children}</h2>
      {(action || secondaryAction) && <div className="section-actions">
        {secondaryAction && <button className="text-button secondary" onClick={onSecondaryAction}><Plus size={14} /> {secondaryAction}</button>}
        {action && <button className="text-button" onClick={onAction}>{action} <ArrowUpRight size={14} /></button>}
      </div>}
    </div>
  )
}

function EventCard({ event, joined, onJoin, onOpen }) {
  const soldOut = event.spots === 0 && !joined
  const publisherRole = getEventPublisherRole(event)

  return (
    <article className={`event-card accent-${event.accent}`} onClick={() => onOpen(event)} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') onOpen(event) }} role="button" tabIndex="0">
      <div className="event-date">
        <strong>{event.date.split('.')[1]}</strong>
        <span>{event.date.split('.')[0]} 月</span>
        <small>{event.day}</small>
      </div>
        <div className="event-card-main">
        <div className="event-topline">
          <span className="eyebrow">VOLLEY SESSION</span>
          <span className="event-badges"><span className={`event-publisher-badge is-${publisherRole}`}>{EVENT_PUBLISHER_LABELS[publisherRole]}</span><span className="event-status"><span className="status-dot" />{event.status}</span></span>
        </div>
        <h3>{event.title}</h3>
        <div className="event-meta"><Clock3 size={14} /> {event.time}<span className="meta-separator">·</span>{event.level}</div>
        <div className="event-meta"><MapPin size={14} /> {event.venue}</div>
        <div className="event-bottom">
          <div className="attendee-stack">
            {initialMembers.slice(0, 3).map((member) => <Avatar key={member.name} initials={member.initials} color={member.color} size="small" />)}
            <span className="attendee-count">+{event.total - event.spots - 3}</span>
          </div>
          <div className="event-price"><small>场地费</small><strong>¥ {event.price}</strong></div>
          <button className={`join-button ${joined ? 'is-joined' : ''}`} onClick={(clickEvent) => { clickEvent.stopPropagation(); onJoin(event) }} disabled={soldOut}>
            {joined ? <><Check size={16} /> 已报名</> : soldOut ? '已满员' : <>立即报名 <ArrowUpRight size={16} /></>}
          </button>
        </div>
      </div>
    </article>
  )
}

function EventDetailModal({ event, joined, members, onClose, onJoin, onCopyAddress }) {
  if (!event) return null
  const registeredCount = event.total - event.spots
  const soldOut = event.spots === 0 && !joined
  const publisherRole = getEventPublisherRole(event)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal event-detail-modal" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()} aria-label={`${event.title} 活动详情`}>
        <button className="modal-close" aria-label="关闭活动详情" onClick={onClose}><X size={18} /></button>
        <div className={`event-detail-banner accent-${event.accent}`}>
          <div><span className="eyebrow">VOLLEY SESSION</span><strong>{event.date}</strong><span>{event.day}</span></div>
          <CalendarDays size={30} />
        </div>
        <div className="event-detail-kicker"><span className={`event-publisher-badge is-${publisherRole}`}>{EVENT_PUBLISHER_LABELS[publisherRole]}</span><span className="eyebrow">{event.level} · {event.status}</span></div>
        <h2>{event.title}</h2>
        <p>一场节奏舒服、认识新球友也不尴尬的固定球局。报名后可以在消息里和大家提前碰头。</p>
        <div className="event-detail-facts">
          <div><Clock3 size={16} /><span><strong>{event.time}</strong><small>活动时间</small></span></div>
          <div><MapPin size={16} /><span><strong>{event.venue}</strong><small>{event.address}</small></span><button className="icon-button" aria-label="复制场地地址" onClick={() => onCopyAddress(event.address)}><Copy size={15} /></button></div>
        </div>
        <div className="event-capacity"><div><span>报名进度</span><strong>{registeredCount} / {event.total} 人</strong></div><div className="capacity-track"><span style={{ width: `${Math.min(100, (registeredCount / event.total) * 100)}%` }} /></div><small>{event.spots > 0 ? `还剩 ${event.spots} 个位置` : '当前已满员'}</small></div>
        <div className="event-attendees"><div className="detail-heading"><strong>已报名球友</strong><span>{registeredCount} 人</span></div><div className="event-attendee-list">{members.slice(0, Math.min(registeredCount, 5)).map((member) => <div key={member.name}><Avatar initials={member.initials} color={member.color} size="small" /><span>{member.name}</span></div>)}{registeredCount > 5 && <span className="attendee-more">+{registeredCount - 5}</span>}</div></div>
        <button className={`primary-button full-width detail-join-button ${joined ? 'is-joined' : ''}`} onClick={() => onJoin(event)} disabled={soldOut}>{joined ? <><Check size={16} /> 已在报名名单</> : soldOut ? '这场已满员' : <>立即报名 · ¥ {event.price} <ArrowUpRight size={16} /></>}</button>
      </section>
    </div>
  )
}

function JoinConfirmationModal({ event, onClose, onPayNow, onPayLater, onConfirm, isSubmitting, paymentEnabled }) {
  return (
    <div className="modal-backdrop join-confirmation-backdrop" onMouseDown={() => { if (!isSubmitting) onClose() }}>
      <section className="modal join-confirmation-modal" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()} aria-label="确认报名">
        <button className="modal-close" aria-label="关闭确认报名" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><Ticket size={22} /></div>
        <span className="eyebrow">JOIN CONFIRMATION</span>
        <h2>确认报名？</h2>
        <p>{paymentEnabled ? '名额会先为你保留，你可以选择现在支付，也可以先报名，稍后再完成支付。' : '确认后会为你保留一个名额，并同步到个人日程。'}</p>
        <div className="join-confirmation-summary">
          <strong>{event.title}</strong>
          <span><CalendarDays size={14} /> {event.date} · {event.day} · {event.time}</span>
          <span><MapPin size={14} /> {event.venue}</span>
          <b>¥ {event.price}</b>
        </div>
        <div className="join-confirmation-actions">
          <button type="button" className="quiet-button" onClick={onClose} disabled={isSubmitting}>暂不报名</button>
          {paymentEnabled ? <>
            <button type="button" className="quiet-button join-later-button" onClick={onPayLater} disabled={isSubmitting}>稍后支付 <Clock3 size={15} /></button>
            <button type="button" className="primary-button" onClick={onPayNow} disabled={isSubmitting}>{isSubmitting ? '正在生成二维码…' : '现在支付'} <CircleDollarSign size={16} /></button>
          </> : <button type="button" className="primary-button" onClick={onConfirm} disabled={isSubmitting}>确认报名 <Check size={16} /></button>}
        </div>
      </section>
    </div>
  )
}

function AlipayQrModal({ event, qrCode, paymentUrl, outTradeNo, status, onClose, onRefresh, onOpenPayment }) {
  const [qrImage, setQrImage] = useState('')

  useEffect(() => {
    let active = true
    setQrImage('')
    QRCode.toDataURL(qrCode, {
      width: 248,
      margin: 2,
      color: { dark: '#10251d', light: '#ffffff' },
    }).then((image) => {
      if (active) setQrImage(image)
    }).catch(() => {
      if (active) setQrImage('')
    })
    return () => { active = false }
  }, [qrCode])

  const isPaid = status === 'paid'
  const isUnavailable = status === 'paid_but_unavailable'
  const isFailed = status === 'failed'
  return (
    <div className="modal-backdrop alipay-qr-backdrop" onMouseDown={onClose}>
      <section className="modal alipay-qr-modal" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()} aria-label="支付宝转账码支付">
        <button className="modal-close" aria-label="关闭支付二维码" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon alipay-icon"><CircleDollarSign size={22} /></div>
        <span className="eyebrow">ALIPAY TRANSFER CODE</span>
        <h2>{isPaid ? '支付成功' : isUnavailable ? '已收款，名额已满' : isFailed ? '支付未成功' : '支付宝转账码支付'}</h2>
        <p>{isPaid ? '报名已确认，名额和个人日程已经同步。' : isUnavailable ? '这场活动在支付完成前已满员，请联系客服安排退款或改期。' : isFailed ? 'XPay 未确认这笔转账，请检查支付宝金额和备注后重新发起支付。' : '请使用支付宝打开或扫描下方二维码，按页面提示完成转账，支付成功后页面会自动更新。'}</p>
        <div className={`alipay-qr-stage ${isPaid ? 'is-paid' : ''}`}>
          {isPaid ? <Check size={54} /> : isUnavailable || isFailed ? <CircleDollarSign size={48} /> : qrImage ? <img src={qrImage} alt="支付宝支付二维码" /> : <span>正在生成二维码…</span>}
        </div>
        <div className="alipay-qr-order"><span>{event.title}</span><strong>¥ {event.price}</strong><small>订单号 {outTradeNo}</small></div>
        <div className="alipay-qr-status"><span className={`status-dot ${isPaid ? 'is-paid' : ''}`} />{isPaid ? '支付已完成' : isUnavailable ? '订单需要人工处理' : isFailed ? '支付未确认' : status === 'scanning' ? '已打开支付页面，等待转账…' : status === 'pending' ? '等待支付中…' : '正在确认支付状态…'}</div>
        {!isPaid && !isUnavailable && !isFailed && <button type="button" className="primary-button alipay-refresh-button" onClick={onOpenPayment}>打开支付宝支付</button>}
        {!isPaid && !isUnavailable && <button type="button" className="quiet-button alipay-refresh-button" onClick={onRefresh}>{isFailed ? '重新检查支付状态' : '我已完成支付，刷新状态'}</button>}
      </section>
    </div>
  )
}

function NotificationsModal({ notifications, onClose, onSelect, onReadAll }) {
  const iconFor = (kind) => kind === 'event' ? <CalendarDays size={16} /> : kind === 'message' ? <MessageCircle size={16} /> : <UserPlus size={16} />

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal notifications-modal" onMouseDown={(mouseEvent) => mouseEvent.stopPropagation()} aria-label="通知中心">
        <button className="modal-close" aria-label="关闭通知中心" onClick={onClose}><X size={18} /></button>
        <div className="notification-heading"><div><span className="eyebrow">KEEP IN THE LOOP</span><h2>通知中心</h2></div><button className="text-button" onClick={onReadAll}><Check size={14} /> 全部已读</button></div>
        <div className="notification-list">{notifications.map((notification) => <button key={notification.id} className={`notification-item ${notification.read ? 'is-read' : ''}`} onClick={() => onSelect(notification)}><span className={`notification-icon notification-${notification.kind}`}>{iconFor(notification.kind)}</span><span className="notification-copy"><strong>{notification.title}</strong><span>{notification.text}</span><small>{notification.time}</small></span>{!notification.read && <i className="notification-unread" />}</button>)}</div>
      </section>
    </div>
  )
}

function SearchModal({ events, members, communityAccess, onClose, onSelect }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const eventResults = events.filter((event) => `${event.title} ${event.venue} ${event.level}`.toLowerCase().includes(normalizedQuery))
  const memberResults = members.filter((member) => `${getMemberName(member)} ${getRoleKey(member, communityAccess)}`.toLowerCase().includes(normalizedQuery))

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal search-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="搜索">
        <button className="modal-close" aria-label="关闭搜索" onClick={onClose}><X size={18} /></button>
        <span className="eyebrow">FIND YOUR NEXT SESSION</span>
        <h2>搜索社群</h2>
        <div className="search-modal-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="场次、场馆或球友" aria-label="搜索场次、场馆或球友" /></div>
        {!query.trim() && <p className="search-hint">输入场次、场馆或球友名称，快速找到你要的内容。</p>}
        {query.trim() && <div className="search-results">
          {eventResults.map((event) => <button key={event.id} className="search-result" onClick={() => onSelect('首页')}>
            <CalendarDays size={17} /><span><strong>{event.title}</strong><small>{event.time} · {event.venue}</small></span><ArrowUpRight size={15} />
          </button>)}
          {memberResults.map((member) => { const roleKey = getRoleKey(member, communityAccess); return <button key={member.uid || member.name} className="search-result" onClick={() => onSelect('成员')}>
            <Avatar initials={member.initials} color={member.color} size="small" /><span><strong>{getMemberName(member)}</strong><small>{ROLE_LABELS[roleKey]}</small></span><ArrowUpRight size={15} />
          </button> })}
          {eventResults.length + memberResults.length === 0 && <div className="search-empty">没有找到匹配结果。</div>}
        </div>}
      </section>
    </div>
  )
}

function Stat({ value, label, icon }) {
  return (
    <div className="stat-item">
      <div className="stat-icon">{icon}</div>
      <div><strong>{value}</strong><span>{label}</span></div>
    </div>
  )
}

function EmptySessions({ onExplore }) {
  return (
    <section className="empty-state">
      <div className="empty-orbit"><CalendarDays size={27} /></div>
      <span className="eyebrow">YOUR COURT CALENDAR</span>
      <h1>还没有排进日程的球。</h1>
      <p>选一场合适的活动，名单和场地信息会留在这里。</p>
      <button className="primary-button" onClick={onExplore}>去挑一场 <ArrowUpRight size={16} /></button>
    </section>
  )
}

function MySessionsView({ events, joinedIds, paymentStatuses, cancellationRequests, onExplore, onPayNow, onRequestCancel }) {
  const joinedEvents = events.filter((event) => joinedIds.includes(event.id))

  return (
    <section className="workspace-view">
      <div className="view-heading">
        <div><span className="eyebrow">MY PLAYBOOK</span><h1>我的场次</h1><p>已经答应上场的夜晚，都在这里。</p></div>
        <button className="primary-button" onClick={onExplore}><Plus size={16} /> 报名新场次</button>
      </div>
      {joinedEvents.length === 0 ? <EmptySessions onExplore={onExplore} /> : <div className="my-session-list">
        {joinedEvents.map((event) => <article className="my-session" key={event.id}>
          <div className={`session-accent accent-${event.accent}`} />
          <div className="session-date"><strong>{event.date}</strong><span>{event.day}</span></div>
          <div className="session-summary"><span className="eyebrow">BOOKED · {event.level}</span><h2>{event.title}</h2><span><Clock3 size={14} /> {event.time}</span><span><MapPin size={14} /> {event.venue}</span>{(() => {
            const request = cancellationRequests.filter((item) => item.eventId === event.id && item.status !== 'approved').pop()
            return request?.status === 'pending' ? <span className="session-review-status is-pending">取消申请审核中</span> : request?.status === 'rejected' ? <span className="session-review-status is-rejected">管理员驳回了上次申请</span> : null
          })()}</div>
          <div className="session-side"><strong>¥ {event.price}</strong><span>场地费</span>{paymentStatuses?.[event.id] === 'pending' && <span className="session-payment-status">待支付</span>}{paymentStatuses?.[event.id] === 'pending' && <button className="quiet-button pay-now-button" onClick={() => onPayNow(event)}><CircleDollarSign size={14} /> 现在支付</button>}{(() => {
            const request = cancellationRequests.filter((item) => item.eventId === event.id && item.status !== 'approved').pop()
            return <button className={`quiet-button cancel-button ${request?.status === 'pending' ? 'is-pending' : ''}`} onClick={() => onRequestCancel(event)} disabled={request?.status === 'pending'}>{request?.status === 'pending' ? '等待审核' : request?.status === 'rejected' ? '再次申请取消' : '申请取消报名'}</button>
          })()}</div>
        </article>)}
      </div>}
    </section>
  )
}

function toDateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function eventToScheduleItem(event) {
  const [month, day] = event.date.split('.').map(Number)
  return {
    id: `event-${event.id}`,
    eventId: event.id,
    date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    time: event.time.split(' ')[0],
    title: event.title,
    type: '社群活动',
    note: `${event.venue} · 已报名`,
    accent: event.accent,
    completed: false,
    linked: true,
  }
}

function PersonalScheduleView({ events, joinedIds, scheduleItems, onAdd, onToggle, onDelete }) {
  const today = new Date(2026, 7, 22)
  const [monthCursor, setMonthCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(toDateKey(today))
  const joinedScheduleItems = events.filter((event) => joinedIds.includes(event.id)).map(eventToScheduleItem)
  const allItems = [...scheduleItems, ...joinedScheduleItems.filter((eventItem) => !scheduleItems.some((item) => item.eventId === eventItem.eventId))]
  const monthLabel = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(monthCursor)
  const firstDay = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1).getDay()
  const daysInMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate()
  const calendarDays = Array.from({ length: Math.ceil((firstDay + daysInMonth) / 7) * 7 }, (_, index) => {
    const dayNumber = index - firstDay + 1
    return dayNumber > 0 && dayNumber <= daysInMonth ? new Date(monthCursor.getFullYear(), monthCursor.getMonth(), dayNumber) : null
  })
  const selectedItems = allItems.filter((item) => item.date === selectedDate).sort((a, b) => a.time.localeCompare(b.time))
  const upcomingItems = allItems.filter((item) => item.date >= toDateKey(today)).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 5)

  function changeMonth(offset) {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  function selectDay(date) {
    if (!date) return
    setSelectedDate(toDateKey(date))
  }

  function formatSelectedDate(dateKey) {
    const date = new Date(`${dateKey}T12:00:00`)
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date)
  }

  return (
    <section className="workspace-view schedule-view">
      <div className="view-heading">
        <div><span className="eyebrow">YOUR DAY, YOUR RHYTHM</span><h1>个人日程</h1><p>把球场之外的安排，也放进同一张时间表。</p></div>
        <button className="primary-button" onClick={onAdd}><Plus size={16} /> 新建日程</button>
      </div>
      <div className="schedule-layout">
        <section className="calendar-panel" aria-label="个人月历">
          <div className="calendar-toolbar">
            <div><span className="eyebrow">MONTH VIEW</span><h2>{monthLabel}</h2></div>
            <div className="calendar-controls">
              <button className="icon-button" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft size={17} /></button>
              <button className="today-button" onClick={() => { setMonthCursor(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(toDateKey(today)) }}>今天</button>
              <button className="icon-button" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight size={17} /></button>
            </div>
          </div>
          <div className="calendar-weekdays">{['日', '一', '二', '三', '四', '五', '六'].map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
          <div className="calendar-grid">
            {calendarDays.map((date, index) => {
              const dateKey = date && toDateKey(date)
              const items = dateKey ? allItems.filter((item) => item.date === dateKey) : []
              const isToday = dateKey === toDateKey(today)
              const isSelected = dateKey === selectedDate
              return <button key={date ? dateKey : `blank-${index}`} className={`calendar-day ${date ? '' : 'is-blank'} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}`} onClick={() => selectDay(date)} disabled={!date}>
                {date && <><strong>{date.getDate()}</strong><span className="calendar-dots">{items.slice(0, 3).map((item) => <i key={item.id} className={`dot-${item.accent}`} />)}</span>{items.length > 3 && <small>+{items.length - 3}</small>}</>}
              </button>
            })}
          </div>
          <div className="calendar-legend"><span><i className="dot-mint" />个人安排</span><span><i className="dot-coral" />约球</span><span><i className="dot-sky" />社群活动</span></div>
        </section>
        <aside className="schedule-side">
          <div className="selected-day-heading"><div><span className="eyebrow">SELECTED DAY</span><h2>{formatSelectedDate(selectedDate)}</h2></div><button className="icon-button" aria-label="为选中日期添加日程" onClick={onAdd}><Plus size={17} /></button></div>
          <div className="day-items">
            {selectedItems.length === 0 && <div className="day-empty"><CalendarDays size={22} /><span>这一天还没有安排。</span><button className="quiet-button" onClick={onAdd}>添加一条日程 <Plus size={14} /></button></div>}
            {selectedItems.map((item) => <article className={`schedule-item accent-${item.accent}`} key={item.id}>
              <div className="schedule-item-time">{item.time}</div>
              <div className="schedule-item-copy"><span className="eyebrow">{item.type}</span><h3>{item.title}</h3><p>{item.note}</p></div>
              <button className={`schedule-check ${item.completed ? 'is-complete' : ''}`} aria-label={item.completed ? '标记为未完成' : '标记为完成'} onClick={() => onToggle(item.id)}><Check size={14} /></button>
              {!item.linked && <button className="schedule-delete" aria-label="删除日程" onClick={() => onDelete(item.id)}><X size={14} /></button>}
            </article>)}
          </div>
          <div className="upcoming-block"><div className="detail-heading"><strong>接下来</strong><span>{upcomingItems.length} 条安排</span></div><div className="upcoming-list">{upcomingItems.map((item) => <button key={item.id} className="upcoming-item" onClick={() => { const date = new Date(`${item.date}T12:00:00`); setMonthCursor(new Date(date.getFullYear(), date.getMonth(), 1)); setSelectedDate(item.date) }}><i className={`dot-${item.accent}`} /><span><strong>{item.title}</strong><small>{item.date.slice(5).replace('-', ' 月 ')} 日 · {item.time}</small></span><ChevronRight size={14} /></button>)}</div></div>
        </aside>
      </div>
    </section>
  )
}

function MessagesView({ messages, directMessages, members, focusMember, messageReadState, onSend, onSelectMember, onBackToCommunity, onMarkRead }) {
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('全部')
  const [showConversations, setShowConversations] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [muted, setMuted] = useState(false)
  const chatMessages = focusMember ? (directMessages[focusMember.name] || []) : messages
  const activeConversationId = focusMember ? `member-${focusMember.name}` : 'community'
  const activeConversationUnread = focusMember
    ? (messageReadState.members?.[focusMember.name] ? 0 : (members.findIndex((member) => member.name === focusMember.name) === 0 ? 1 : 0))
    : (messageReadState.community ? 0 : 3)
  const conversationItems = [
    {
      id: 'community',
      member: null,
      initials: 'A&T',
      color: 'green',
      title: `${COMMUNITY_NAME} · 全员`,
      preview: messages[messages.length - 1]?.text || '开始和社群成员聊天',
      time: messages[messages.length - 1]?.time || '现在',
      unread: messageReadState.community ? 0 : 3,
      online: true,
      pinned: true,
    },
    ...members.slice(0, 5).map((member, index) => {
      const memberMessages = directMessages[member.name] || []
      return {
        id: `member-${member.name}`,
        member,
        initials: member.initials,
        color: member.color,
        title: member.name,
        preview: memberMessages[memberMessages.length - 1]?.text || (index === 0 ? '好的，到时见。' : '还没有开始聊天'),
        time: memberMessages[memberMessages.length - 1]?.time || (index === 0 ? '昨天' : ''),
        unread: messageReadState.members?.[member.name] ? 0 : (index === 0 ? 1 : 0),
        online: index < 3,
        pinned: false,
      }
    }),
  ]
  const filteredConversations = conversationItems.filter((conversation) => {
    const matchesQuery = `${conversation.title} ${conversation.preview}`.toLowerCase().includes(query.trim().toLowerCase())
    const matchesFilter = filter === '全部' || (filter === '未读' && conversation.unread > 0) || (filter === '置顶' && conversation.pinned)
    return matchesQuery && matchesFilter
  })

  function submit(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onSend(text)
    setDraft('')
  }

  function selectConversation(conversation) {
    if (conversation.member) onSelectMember(conversation.member)
    else onBackToCommunity()
    onMarkRead(conversation.id)
    setShowConversations(false)
  }

  useEffect(() => {
    onMarkRead(activeConversationId)
  }, [activeConversationId, onMarkRead])

  return (
    <section className={`messages-view ${showConversations ? 'show-conversations' : ''}`}>
      <aside className="conversation-list">
        <div className="conversation-top"><div><span className="eyebrow">INBOX</span><h1>消息</h1><span className="inbox-summary">{conversationItems.filter((conversation) => conversation.unread > 0).length} 个未读会话</span></div><button className="icon-button" aria-label="新建对话" title="新建对话"><Plus size={18} /></button></div>
        <label className="conversation-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" /></label>
        <div className="conversation-filters" role="tablist" aria-label="消息筛选">{['全部', '未读', '置顶'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)} role="tab" aria-selected={filter === item}>{item}</button>)}</div>
        <div className="conversation-items">
          {filteredConversations.map((conversation) => <button key={conversation.id} className={`conversation ${activeConversationId === conversation.id ? 'active' : ''}`} onClick={() => selectConversation(conversation)}>
            <span className="conversation-avatar-wrap"><Avatar initials={conversation.initials} color={conversation.color} /><i className={conversation.online ? 'online-dot' : 'offline-dot'} /></span>
            <div><strong>{conversation.title}{conversation.pinned && <Pin size={11} />}</strong><span>{conversation.preview}</span></div>
            <span className="conversation-meta">{conversation.time}{conversation.unread > 0 && <em>{conversation.unread}</em>}</span>
          </button>)}
          {filteredConversations.length === 0 && <div className="conversation-empty"><Search size={19} /><span>没有找到匹配会话。</span></div>}
        </div>
      </aside>
      <div className="chat-panel">
        <header className="chat-header">
          <button className="mobile-conversation-toggle" aria-label="切换会话" onClick={() => setShowConversations((current) => !current)}><MessageCircle size={16} /><ChevronDown size={14} /></button>
          {focusMember && <button className="icon-button chat-back-button" aria-label="返回全员消息" title="返回全员消息" onClick={onBackToCommunity}><ArrowLeft size={18} /></button>}
          <Avatar initials={focusMember?.initials || 'A&T'} color={focusMember?.color || 'green'} />
          <div className="chat-identity"><strong>{focusMember ? focusMember.name : `${COMMUNITY_NAME} · 全员`}</strong><span><i className="online-dot" /> {focusMember ? `${focusMember.role} · 可联系` : '63 人在线'}</span></div>
          <div className="chat-tools">
            <button className={`icon-button ${pinned ? 'is-active' : ''}`} aria-label={pinned ? '取消置顶' : '置顶会话'} title={pinned ? '取消置顶' : '置顶会话'} onClick={() => setPinned((current) => !current)}><Pin size={17} /></button>
            <button className={`icon-button ${muted ? 'is-active' : ''}`} aria-label={muted ? '打开通知' : '静音会话'} title={muted ? '打开通知' : '静音会话'} onClick={() => setMuted((current) => !current)}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
            {activeConversationUnread > 0 && <button className="icon-button" aria-label="标记为已读" title="标记为已读" onClick={() => onMarkRead(activeConversationId)}><CheckCheck size={17} /></button>}
            <button className="icon-button" aria-label="对话设置" title="更多操作"><Ellipsis size={19} /></button>
          </div>
        </header>
        <div className="message-stream">
          <div className="chat-date"><span>{focusMember ? `与 ${focusMember.name} 的新对话` : '今天 · 8 月 22 日'}</span><i><CheckCheck size={12} /> 已同步</i></div>
          {focusMember && chatMessages.length === 0 && <div className="direct-empty"><Avatar initials={focusMember.initials} color={focusMember.color} size="large" /><strong>和 {focusMember.name} 打个招呼</strong><span>可以约球、交流装备，或者确认下一场活动。</span></div>}
          {chatMessages.map((message) => <article className={`message-row ${message.mine ? 'mine' : ''}`} key={message.id}>
            {!message.mine && <Avatar initials={message.initials} color={message.color} size="small" />}
            <div className="message-bubble"><div><strong>{message.author}</strong><time>{message.time}</time></div><p>{message.text}</p></div>
          </article>)}
        </div>
        <div className="quick-replies">{['我收到啦', '场上见', '我来带球'].map((reply) => <button key={reply} onClick={() => setDraft(reply)}>{reply}</button>)}</div>
        <form className="message-composer" onSubmit={submit}><button className="composer-tool" type="button" aria-label="添加附件" title="添加附件"><Paperclip size={17} /></button><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="写点什么，和球友打个招呼" aria-label="消息内容" /><button className="composer-tool" type="button" aria-label="添加表情" title="添加表情">☺</button><button className="send-button" type="submit" aria-label="发送消息"><Send size={17} /></button></form>
      </div>
    </section>
  )
}

function FeedPost({ post, commentsOpen, onToggleLike, onToggleComments, onAddComment, onShare }) {
  const [draft, setDraft] = useState('')

  function submit(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    onAddComment(post.id, text)
    setDraft('')
  }

  return (
    <article className="feed-post">
      <div className="feed-heading">
        <Avatar initials={post.initials} color={post.color} />
        <div><strong>{post.author}</strong><span>{post.time} · {post.label}</span></div>
        <button className="mini-more" aria-label={`${post.author} 的动态更多操作`}><Ellipsis size={17} /></button>
      </div>
      <p>{post.text}</p>
      <div className="feed-actions">
        <button className={post.liked ? 'is-liked' : ''} onClick={() => onToggleLike(post.id)} aria-pressed={post.liked}><Heart size={14} fill={post.liked ? 'currentColor' : 'none'} /> {post.likes}</button>
        <button onClick={() => onToggleComments(post.id)} aria-expanded={commentsOpen}><MessageCircle size={14} /> {post.comments.length ? `${post.comments.length} 条回应` : '回应'}</button>
        <button onClick={() => onShare(post)}><Copy size={14} /> 分享</button>
      </div>
      {commentsOpen && <div className="feed-comments">
        {post.comments.length > 0 && <div className="comment-list">{post.comments.map((comment) => <article className="comment" key={comment.id}>
          <Avatar initials={comment.initials} color={comment.color} size="small" />
          <div><div><strong>{comment.author}</strong><time>{comment.time}</time></div><p>{comment.text}</p></div>
        </article>)}</div>}
        <form className="comment-composer" onSubmit={submit}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="写下你的回应" aria-label="评论内容" /><button className="send-button" type="submit" aria-label="发送评论"><Send size={15} /></button></form>
      </div>}
    </article>
  )
}

function MembersView({ members, currentUser, communityAccess, onInvite, onContact }) {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('all')
  const directoryMembers = members.some((member) => member.email && currentUser.email ? member.email === currentUser.email : member.name === currentUser.name)
    ? members
    : [currentUser, ...members]
  const filteredMembers = directoryMembers.filter((member) => {
    const roleKey = getRoleKey(member, communityAccess)
    return (role === 'all' || roleKey === role) && getMemberName(member).toLowerCase().includes(query.toLowerCase())
  })

  return (
    <section className="workspace-view members-view">
      <div className="view-heading">
        <div><span className="eyebrow">THE LINEUP</span><h1>成员</h1><p>{directoryMembers.length + 123} 位热爱排球的人，在深圳一起上场。</p></div>
        <button className="primary-button" onClick={onInvite}><UserPlus size={16} /> 邀请球友</button>
      </div>
      <div className="member-toolbar"><div className="member-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索成员" /></div><div className="role-filters">{ROLE_FILTERS.map((item) => <button className={role === item.key ? 'active' : ''} onClick={() => setRole(item.key)} key={item.key}>{item.label}</button>)}</div></div>
      <div className="member-directory">
        {filteredMembers.map((member, index) => {
          const isSelf = member.uid && currentUser.uid ? member.uid === currentUser.uid : getMemberName(member) === getMemberName(currentUser)
          const roleKey = getRoleKey(member, communityAccess)
          return <article className={`directory-member ${isSelf ? 'is-self' : ''}`} key={`${getMemberName(member)}-${index}`}><Avatar initials={member.initials} color={member.color} size="large" /><div><h2>{getMemberName(member)}{isSelf && <small className="self-badge">你</small>}</h2><div className="member-role-line"><RoleLabel roleKey={roleKey} /></div>{member.bio && <p className="member-bio">{member.bio}</p>}</div>{!isSelf && <button className="icon-button" aria-label={`联系 ${getMemberName(member)}`} onClick={() => onContact(member)}><MessageCircle size={17} /></button>}</article>
        })}
      </div>
      {filteredMembers.length === 0 && <div className="directory-empty">没有找到符合条件的球友。</div>}
    </section>
  )
}

function AdminUserDataModal({ users, events, communityAccess, loading, onClose }) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const filteredUsers = users.filter((user) => {
    const member = user.registeredMember || {}
    return `${member.name || ''} ${member.email || ''}`.toLowerCase().includes(normalizedQuery)
  })

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal admin-data-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="成员数据">
        <button className="modal-close" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon"><UsersRound size={22} /></div>
        <span className="eyebrow">ADMIN ONLY · MEMBER DATA</span>
        <h2>成员数据</h2>
        <p>仅展示社群运营需要的信息，不包含用户密码。</p>
        <label className="admin-data-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或邮箱" /></label>
        {loading ? <div className="review-empty"><Clock3 size={16} /> 正在读取成员数据…</div> : filteredUsers.length === 0 ? <div className="review-empty"><UsersRound size={16} /> 暂无可查看的成员数据</div> : <div className="admin-data-list">
          {filteredUsers.map((user) => {
            const member = user.registeredMember || {}
            const joinedEvents = (user.joinedIds || []).map((id) => events.find((event) => event.id === id)?.title || `场次 ${id}`)
            const scheduleItems = user.scheduleItems || []
            return <article className="admin-data-item" key={user.uid}>
              <div className="admin-data-heading"><Avatar initials={member.name?.slice(0, 1) || '?'} color={member.color || 'green'} /><div><strong>{getMemberName(member)}</strong><span>{member.email || '未填写邮箱'}</span><RoleLabel roleKey={getRoleKey(member, communityAccess)} compact /></div></div>
              <div className="admin-data-stats"><div><small>已报名</small><strong>{joinedEvents.length} 场</strong></div><div><small>个人日程</small><strong>{scheduleItems.length} 条</strong></div><div><small>消息状态</small><strong>{user.messageReadState?.community ? '已读' : '有未读'}</strong></div></div>
              {member.invitedByName && <p><b>邀请管理员：</b>{member.invitedByName}</p>}
              {joinedEvents.length > 0 && <p><b>报名场次：</b>{joinedEvents.join('、')}</p>}
              {scheduleItems.length > 0 && <p><b>最近日程：</b>{scheduleItems.slice(0, 3).map((item) => `${item.date} ${item.title}`).join('；')}</p>}
            </article>
          })}
        </div>}
      </section>
    </div>
  )
}

function AdminManagementModal({ members, communityAccess, onToggleAdmin, onClose }) {
  const adminUids = communityAccess?.adminUids || []
  const ownerUid = communityAccess?.ownerUid

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal admin-management-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="管理员设置">
        <button className="modal-close" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        <div className="modal-icon yellow-icon"><ShieldCheck size={22} /></div>
        <span className="eyebrow">OWNER ONLY · ACCESS CONTROL</span>
        <h2>管理员设置</h2>
        <p>只有社群所有者可以调整管理员。管理员可以发放邀请码和审核报名取消申请。</p>
        <div className="admin-owner-note"><Crown size={15} /><span>所有者：{communityAccess?.ownerName || '当前所有者'}</span></div>
        <div className="admin-management-list">
          {members.filter((member) => member.uid).map((member) => {
            const enabled = adminUids.includes(member.uid)
            const isOwnerMember = member.uid === ownerUid
            return <article className="admin-management-item" key={member.uid}>
              <Avatar initials={member.initials} color={member.color} />
              <div><strong>{getMemberName(member)}</strong><span>{member.email || '未填写邮箱'}</span></div>
              {isOwnerMember ? <RoleLabel roleKey="owner" /> : <button className={`admin-toggle ${enabled ? 'is-enabled' : ''}`} onClick={() => onToggleAdmin(member, !enabled)}>{enabled ? '取消 administrator' : '设为 administrator'}</button>}
            </article>
          })}
        </div>
        {members.every((member) => !member.uid) && <div className="review-empty"><UsersRound size={16} /> 成员注册后才可以设置为管理员。</div>}
      </section>
    </div>
  )
}

function ProfileModal({ profileMember, currentUser, onClose, onSave, onStartMessage, onLogout }) {
  const isSelf = profileMember.uid && currentUser.uid
    ? profileMember.uid === currentUser.uid
    : getMemberName(profileMember) === getMemberName(currentUser)
  const [nickname, setNickname] = useState(getMemberName(profileMember))
  const [bio, setBio] = useState(profileMember.bio || '')
  const roleKey = profileMember.roleKey || (isSelf ? currentUser.roleKey : 'member')

  function submit(event) {
    event.preventDefault()
    onSave({ nickname: nickname.trim(), bio: bio.trim() })
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal profile-modal" onMouseDown={(event) => event.stopPropagation()} aria-label="个人名片">
        <button className="modal-close" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        <Avatar initials={(nickname || profileMember.initials || '?').slice(0, 1)} color={profileMember.color} size="large" />
        <span className="eyebrow"><RoleLabel roleKey={roleKey} /> · COMMUNITY PROFILE</span>
        {isSelf ? <form className="profile-edit-form" onSubmit={submit}>
          <label>昵称<input value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={30} autoFocus /></label>
          <label>个人简介<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={160} rows="3" placeholder="介绍一下你自己，方便球友认识你。" /></label>
          <button className="primary-button full-width" type="submit" disabled={!nickname.trim()}>保存名片 <Check size={16} /></button>
          <button className="quiet-button full-width logout-button" type="button" onClick={onLogout}><LogOut size={16} /> 退出登录</button>
        </form> : <>
          <h2>{getMemberName(profileMember)}</h2>
          <p>{profileMember.bio || '还没有填写个人简介。'}</p>
          <div className="profile-details"><div><UsersRound size={16} /> <RoleLabel roleKey={roleKey} /></div><div><CalendarDays size={16} /> 最近活跃 · 今天</div></div>
          <button className="primary-button full-width profile-message-button" onClick={onStartMessage}><MessageCircle size={16} /> 发起私聊</button>
        </>}
      </section>
    </div>
  )
}

function LoginGate({ onLogin, onRegister, onDemoLogin, firebaseEnabled }) {
  const [mode, setMode] = useState('login')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') || '').trim().toLowerCase()
    const password = String(form.get('password') || '')
    const name = String(form.get('name') || '').trim()
    const inviteCode = String(form.get('inviteCode') || '').trim()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址。')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位。')
      return
    }
    if (mode === 'register' && !name) {
      setError('请先填写你的称呼。')
      return
    }
    if (mode === 'register' && !/^[A-Z]{8}$/.test(inviteCode.toUpperCase())) {
      setError('请输入 8 位字母邀请码。')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'login') await onLogin({ email, password })
      else await onRegister({ email, password, name, inviteCode })
    } catch (submitError) {
      setError(getFirebaseAuthErrorMessage(submitError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-art" aria-label="A&T club 视觉">
        <BrandLockup />
        <div className="login-art-copy"><span className="eyebrow">PRIVATE VOLLEY COMMUNITY</span><h1>固定的人，<br /><span>热爱的球。</span></h1><p>加入 A&T club，把下一场上场时间留给真正期待的人。</p></div>
        <div className="login-art-mark"><BrandMark /><span>ambition<br />&amp;together</span></div>
      </section>
      <section className="login-panel">
        <div className="login-panel-inner">
          <div className="login-mobile-brand"><BrandLockup compact /></div>
          <div className="login-heading"><div className="login-icon"><LockKeyhole size={19} /></div><span className="eyebrow">{mode === 'login' ? 'WELCOME BACK' : 'INVITE ONLY · JOIN THE CLUB'}</span><h2>{mode === 'login' ? '登录社群' : '注册成为球友'}</h2><p>{mode === 'login' ? '登录后继续查看活动、消息和你的个人日程。' : '使用社群邀请码加入 A&T club。'}</p></div>
          <form className="login-form" onSubmit={submit}>
            {mode === 'register' && <label>你的称呼<input name="name" autoComplete="name" placeholder="例如：小满" /></label>}
            <label>邮箱地址<input name="email" type="email" autoComplete="email" placeholder="you@example.com" /></label>
            <label>密码<div className="password-input-wrap"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少 6 位" /><button type="button" className="password-toggle" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? '隐藏密码' : '显示密码'} title={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            {mode === 'register' && <label>邀请码<input name="inviteCode" placeholder="例如 VOLLEYAB" /></label>}
            {error && <p className="login-error">{error}</p>}
            <button className="primary-button full-width" type="submit" disabled={submitting}>{submitting ? '正在连接…' : mode === 'login' ? '登录社群' : '验证并加入'} <LogIn size={16} /></button>
          </form>
          <div className="login-demo-entry"><span>只想先看看？</span><button onClick={onDemoLogin}><Sparkles size={14} /> 免登录体验</button></div>
          <div className="login-switch">{mode === 'login' ? <><span>还没有社群账号？</span><button onClick={() => { setMode('register'); setError('') }}>使用邀请码注册</button></> : <><span>已经有账号？</span><button onClick={() => { setMode('login'); setError('') }}>返回登录</button></>}</div>
          <div className="login-note"><ShieldCheck size={14} /><span>{firebaseEnabled ? '使用 Firebase 安全登录，社群内容会在成员之间同步。' : '这是当前浏览器中的演示登录，数据只保存在本地。'}</span></div>
        </div>
      </section>
    </main>
  )
}

function App() {
  const [activeNav, setActiveNav] = useState('首页')
  const [isAuthenticated, setIsAuthenticated] = useState(() => isFirebaseConfigured ? false : readStoredValue('isAuthenticated', false))
  const [authResolved, setAuthResolved] = useState(() => !isFirebaseConfigured)
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [communityAccess, setCommunityAccess] = useState(() => readStoredValue('communityAccess', {
    ownerUid: import.meta.env.VITE_FIREBASE_OWNER_UID || 'local-demo',
    adminUids: ['local-demo'],
    admins: [{ uid: 'local-demo', name: '演示管理员' }],
  }))
  const [isOwnerClaim, setIsOwnerClaim] = useState(() => !isFirebaseConfigured)
  const [showAdminData, setShowAdminData] = useState(false)
  const [showAdminManagement, setShowAdminManagement] = useState(false)
  const [adminUsers, setAdminUsers] = useState([])
  const [adminUsersLoading, setAdminUsersLoading] = useState(false)
  const [communityLoaded, setCommunityLoaded] = useState(() => !isFirebaseConfigured)
  const [userDataLoaded, setUserDataLoaded] = useState(() => !isFirebaseConfigured)
  const [cloudError, setCloudError] = useState('')
  const [events, setEvents] = useState(() => readStoredValue('events', initialEvents))
  const [joinedIds, setJoinedIds] = useState(() => readStoredValue('joinedIds', []))
  const [paymentStatuses, setPaymentStatuses] = useState(() => readStoredValue('paymentStatuses', {}))
  const [cancellationRequests, setCancellationRequests] = useState(() => readStoredValue('cancellationRequests', []))
  const [scheduleItems, setScheduleItems] = useState(() => readStoredValue('scheduleItems', initialScheduleItems))
  const [showInvite, setShowInvite] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showWelcomeMail, setShowWelcomeMail] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [notifications, setNotifications] = useState(() => readStoredValue('notifications', initialNotifications))
  const [showSettings, setShowSettings] = useState(false)
  const [showPostComposer, setShowPostComposer] = useState(false)
  const [showScheduleComposer, setShowScheduleComposer] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [pendingJoinEvent, setPendingJoinEvent] = useState(null)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentOrder, setPaymentOrder] = useState(null)
  const [paymentStatus, setPaymentStatus] = useState('pending')
  const [profileMember, setProfileMember] = useState(initialMembers[0])
  const [focusMember, setFocusMember] = useState(null)
  const [notice, setNotice] = useState('')
  const [inviteCode, setInviteCode] = useState(() => readStoredValue('inviteCode', generateInviteCode()))
  const [members, setMembers] = useState(() => readStoredValue('members', initialMembers))
  const [registeredMember, setRegisteredMember] = useState(() => readStoredValue('registeredMember', null))
  const [messages, setMessages] = useState(() => readStoredValue('messages', starterMessages))
  const [directMessages, setDirectMessages] = useState(() => readStoredValue('directMessages', {}))
  const [messageReadState, setMessageReadState] = useState(() => readStoredValue('messageReadState', { community: false, members: {} }))
  const [posts, setPosts] = useState(() => readStoredValue('posts', starterPosts))
  const [openComments, setOpenComments] = useState(null)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const communityProfilesRef = useRef([])
  const registrationInProgressRef = useRef(false)

  const joinedCount = joinedIds.length
  const spotsLeft = useMemo(() => events.reduce((sum, event) => sum + event.spots, 0), [events])
  const communityMemberCount = members.length + 123
  const unreadMessageCount = (messageReadState.community ? 0 : 1) + (members[0] && !messageReadState.members?.[members[0].name] ? 1 : 0)
  const isOwner = !isFirebaseConfigured || isOwnerClaim
  const currentUser = useMemo(() => {
    if (registeredMember) {
      const member = members.find((item) => item.uid && registeredMember.uid ? item.uid === registeredMember.uid : item.email === registeredMember.email || item.name === registeredMember.name)
      const merged = member || {
        initials: (registeredMember.nickname || registeredMember.name || '我').slice(0, 1),
        name: registeredMember.nickname || registeredMember.name || '你的名片',
        nickname: registeredMember.nickname || registeredMember.name || '你的名片',
        bio: registeredMember.bio || '',
        color: 'green',
        email: registeredMember.email,
        uid: registeredMember.uid,
      }
      const roleKey = isOwner ? 'owner' : getRoleKey(merged, communityAccess)
      return { ...merged, name: getMemberName(merged), nickname: getMemberName(merged), roleKey, role: ROLE_LABELS[roleKey] }
    }
    const roleKey = isOwner ? 'owner' : 'member'
    return { initials: '我', name: '你的名片', nickname: '你的名片', bio: '', roleKey, role: ROLE_LABELS[roleKey], color: 'green' }
  }, [members, registeredMember, communityAccess, isOwner])
  const isAdmin = !isFirebaseConfigured || isOwner || Boolean(firebaseUser?.uid && communityAccess?.adminUids?.includes(firebaseUser.uid))
  const cloudReady = Boolean(firebaseUser && communityLoaded && userDataLoaded)

  useEffect(() => {
    if (!isFirebaseConfigured) return undefined
    return subscribeToAuth(async (user) => {
      setAuthResolved(true)
      if (!user) {
        setFirebaseUser(null)
        setIsOwnerClaim(false)
        setRegisteredMember(null)
        setIsAuthenticated(false)
        setCommunityLoaded(true)
        setUserDataLoaded(true)
        return
      }
      if (registrationInProgressRef.current) return
      try {
        if (!(await isRegisteredMember(user))) {
          await logoutFromFirebase()
          return
        }
        setFirebaseUser(user)
        setIsAuthenticated(true)
        setCommunityLoaded(false)
        setUserDataLoaded(false)
        setIsOwnerClaim(await getFirebaseOwnerStatus(user))
        setRegisteredMember({
          name: user.displayName || user.email?.split('@')[0] || '新成员',
          nickname: user.displayName || user.email?.split('@')[0] || '新成员',
          bio: '',
          email: user.email || '',
          uid: user.uid,
        })
      } catch {
        setCloudError('登录状态验证失败，请检查 Owner UID、Firebase Claim 和 Firestore 规则。')
        await logoutFromFirebase()
      }
    })
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured || !firebaseUser) return undefined
    return subscribeToCommunityAccess((data) => {
      if (data) setCommunityAccess(data)
    }, () => setCloudError('管理员权限数据暂时无法同步。'))
  }, [firebaseUser])

  useEffect(() => {
    if (!firebaseUser) return undefined
    setCloudError('')
    const unsubscribeCommunity = subscribeToCommunity((data) => {
      if (data) {
        if (Array.isArray(data.events)) setEvents(data.events)
        if (Array.isArray(data.members)) setMembers(mergeCommunityProfiles(data.members, communityProfilesRef.current))
        if (Array.isArray(data.messages)) setMessages(data.messages)
        if (data.directMessages && typeof data.directMessages === 'object') setDirectMessages(data.directMessages)
        if (Array.isArray(data.posts)) setPosts(data.posts)
        if (Array.isArray(data.cancellationRequests)) setCancellationRequests(data.cancellationRequests)
        if (typeof data.inviteCode === 'string') setInviteCode(data.inviteCode)
      }
      setCommunityLoaded(true)
    }, () => {
      setCloudError('云端社群数据暂时无法同步，当前页面仍可继续使用。')
      setCommunityLoaded(true)
    })
    const unsubscribeUser = subscribeToUserData(firebaseUser.uid, (data) => {
      if (data) {
        if (Array.isArray(data.joinedIds)) setJoinedIds(data.joinedIds)
        if (data.paymentStatuses && typeof data.paymentStatuses === 'object') setPaymentStatuses(data.paymentStatuses)
        if (Array.isArray(data.scheduleItems)) setScheduleItems(data.scheduleItems)
        if (data.messageReadState && typeof data.messageReadState === 'object') setMessageReadState(data.messageReadState)
        if (Array.isArray(data.notifications)) setNotifications(data.notifications)
        if (data.registeredMember) setRegisteredMember(data.registeredMember)
      }
      setUserDataLoaded(true)
    }, () => {
      setCloudError('个人数据暂时无法同步，当前页面仍可继续使用。')
      setUserDataLoaded(true)
    })
    return () => {
      unsubscribeCommunity()
      unsubscribeUser()
    }
  }, [firebaseUser])

  useEffect(() => {
    if (!isAlipayEnabled || !firebaseUser) return undefined
    const outTradeNo = new URLSearchParams(window.location.search).get('out_trade_no')
    if (!outTradeNo) return undefined

    let active = true
    setPaymentSubmitting(true)
    getAlipayPaymentStatus(outTradeNo, firebaseUser)
      .then((result) => {
        if (!active) return
        if (result.status === 'paid' && result.event) {
          const event = events.find((item) => String(item.id) === String(result.event.id))
          const paidEvent = event || result.event
          applyLocalJoin(paidEvent, { decrementSpots: false, syncSpots: result.event.spots, paymentStatus: 'paid' })
          flash(`支付成功，已报名「${paidEvent.title}」。`)
          return
        }
        flash('暂时还没有收到支付成功通知，请稍后在“我的场次”查看。')
      })
      .catch((error) => {
        if (active) flash(error.message || '支付状态查询失败，请稍后重试。')
      })
      .finally(() => {
        if (active) setPaymentSubmitting(false)
      })
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash)
    return () => { active = false }
  }, [firebaseUser])

  useEffect(() => {
    if (!isAlipayEnabled || !firebaseUser || !paymentOrder?.outTradeNo) return undefined
    let active = true
    let completed = false
    const checkStatus = async () => {
      try {
        const result = await getAlipayPaymentStatus(paymentOrder.outTradeNo, firebaseUser)
        if (!active) return
        if (result.status === 'paid' && result.event) {
          completed = true
          setPaymentStatus('paid')
          applyLocalJoin(result.event, { decrementSpots: false, syncSpots: result.event.spots, paymentStatus: 'paid' })
          flash(`支付成功，已报名「${result.event.title}」。`)
          return
        }
        setPaymentStatus(result.status || 'pending')
      } catch (error) {
        if (active) setPaymentStatus('error')
      }
    }
    checkStatus()
    const timer = window.setInterval(() => {
      if (!completed) checkStatus()
    }, 2500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [firebaseUser, paymentOrder?.outTradeNo])

  useEffect(() => {
    if (!firebaseUser) return undefined
    return subscribeToCommunityProfiles((profiles) => {
      communityProfilesRef.current = profiles
      setMembers((current) => mergeCommunityProfiles(current, profiles))
    }, () => setCloudError('成员名片暂时无法同步，当前页面仍可继续使用。'))
  }, [firebaseUser])

  useEffect(() => {
    if (!showAdminData) return undefined
    if (!isFirebaseConfigured) {
      setAdminUsers([{ uid: 'local-demo', registeredMember: currentUser, joinedIds, scheduleItems, messageReadState }])
      setAdminUsersLoading(false)
      return undefined
    }
    if (!firebaseUser || !isAdmin) return undefined
    setAdminUsersLoading(true)
    return subscribeToAllUserData((users) => {
      setAdminUsers(users)
      setAdminUsersLoading(false)
    }, () => {
      setAdminUsersLoading(false)
      setCloudError('成员数据读取失败，请检查管理员权限和 Firestore 规则。')
    })
  }, [showAdminData, firebaseUser, isAdmin, currentUser, joinedIds, scheduleItems, messageReadState])

  useEffect(() => {
    if (!firebaseUser || !communityLoaded) return
    const email = firebaseUser.email || ''
    const name = firebaseUser.displayName || email.split('@')[0] || '新成员'
    if (!email || members.some((member) => member.email === email)) return
    setMembers((current) => [{
      initials: name.slice(0, 1).toUpperCase(),
      name,
      nickname: name,
      bio: '',
      role: ROLE_LABELS.member,
      roleKey: 'member',
      color: 'green',
      email,
      uid: firebaseUser.uid,
    }, ...current])
  }, [firebaseUser, communityLoaded, members])

  const communityCloudData = useMemo(() => ({
    events,
    ...(isAdmin ? { members } : {}),
    messages,
    directMessages,
    posts,
    cancellationRequests,
  }), [events, isAdmin, members, messages, directMessages, posts, cancellationRequests])

  const userCloudData = useMemo(() => ({
    joinedIds,
    paymentStatuses,
    scheduleItems,
    messageReadState,
    notifications,
    registeredMember,
  }), [joinedIds, paymentStatuses, scheduleItems, messageReadState, notifications, registeredMember])

  useEffect(() => {
    if (!cloudReady) return
    saveCommunityData(communityCloudData).catch(() => setCloudError('云端社群数据保存失败，稍后会自动重试。'))
  }, [cloudReady, communityCloudData])

  useEffect(() => {
    if (!cloudReady || !firebaseUser) return
    saveUserData(firebaseUser.uid, userCloudData).catch(() => setCloudError('个人数据保存失败，稍后会自动重试。'))
  }, [cloudReady, firebaseUser, userCloudData])

  useEffect(() => {
    if (!cloudReady || !firebaseUser || !isOwner) return
    const ownerAccess = communityAccess.ownerUid === 'local-demo'
      ? { ...communityAccess, ownerUid: firebaseUser.uid, ownerName: currentUser.name }
      : communityAccess
    if (ownerAccess !== communityAccess) setCommunityAccess(ownerAccess)
    saveCommunityAccess(ownerAccess).catch(() => setCloudError('管理员权限保存失败，请检查所有者权限。'))
  }, [cloudReady, firebaseUser, isOwner, communityAccess, currentUser.name])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}events`, JSON.stringify(events))
  }, [events])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}isAuthenticated`, JSON.stringify(isAuthenticated))
  }, [isAuthenticated])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}joinedIds`, JSON.stringify(joinedIds))
  }, [joinedIds])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}paymentStatuses`, JSON.stringify(paymentStatuses))
  }, [paymentStatuses])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}cancellationRequests`, JSON.stringify(cancellationRequests))
  }, [cancellationRequests])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}scheduleItems`, JSON.stringify(scheduleItems))
  }, [scheduleItems])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}members`, JSON.stringify(members))
  }, [members])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}messages`, JSON.stringify(messages))
  }, [messages])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}directMessages`, JSON.stringify(directMessages))
  }, [directMessages])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}messageReadState`, JSON.stringify(messageReadState))
  }, [messageReadState])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}posts`, JSON.stringify(posts))
  }, [posts])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}inviteCode`, JSON.stringify(inviteCode))
  }, [inviteCode])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}registeredMember`, JSON.stringify(registeredMember))
  }, [registeredMember])

  useEffect(() => {
    window.localStorage.setItem(`${STORAGE_PREFIX}notifications`, JSON.stringify(notifications))
  }, [notifications])

  function flash(message) {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function handleLogin({ email, password }) {
    if (isFirebaseConfigured) {
      await loginWithFirebase(email, password)
      return
    }
    const existingMember = members.find((member) => member.email === email)
    if (!existingMember) throw new Error('auth/member-not-registered')
    setRegisteredMember(existingMember ? { ...existingMember, email } : { name: email.split('@')[0], nickname: email.split('@')[0], bio: '', email })
    setIsAuthenticated(true)
  }

  async function handleGateRegister({ email, password, name, inviteCode: submittedInviteCode }) {
    if (!isFirebaseConfigured && submittedInviteCode.toUpperCase() !== inviteCode.trim().toUpperCase()) {
      throw new Error('invalid-invite-code')
    }
    if (isFirebaseConfigured) {
      registrationInProgressRef.current = true
      try {
        const credential = await registerWithFirebase(email, password, name, submittedInviteCode)
        const newMember = { initials: name.slice(0, 1).toUpperCase(), name, nickname: name, bio: '', role: ROLE_LABELS.member, roleKey: 'member', color: 'green', email, uid: credential.user.uid, invitedByUid: credential.invitation.invitedByUid, invitedByName: credential.invitation.invitedByName }
        const newRegisteredMember = {
          name,
          nickname: name,
          bio: '',
          email,
          uid: credential.user.uid,
          invitedByUid: credential.invitation.invitedByUid,
          invitedByName: credential.invitation.invitedByName,
        }
        await Promise.all([
          saveCommunityProfile(credential.user.uid, newMember),
          saveUserData(credential.user.uid, {
            registeredMember: newRegisteredMember,
            joinedIds: [],
            paymentStatuses: {},
            scheduleItems: [],
            messageReadState: { community: false, members: {} },
            notifications: [],
          }),
        ])
        setFirebaseUser(credential.user)
        setIsAuthenticated(true)
        setCommunityLoaded(false)
        setUserDataLoaded(false)
        setIsOwnerClaim(await getFirebaseOwnerStatus(credential.user))
        setMembers((current) => current.some((member) => member.email === email) ? current : [newMember, ...current])
        setRegisteredMember(newRegisteredMember)
      } finally {
        registrationInProgressRef.current = false
      }
      return
    }
    const existingMember = members.find((member) => member.email === email)
    if (existingMember) {
      setRegisteredMember({ name: existingMember.name, email })
      setIsAuthenticated(true)
      return
    }
    const newMember = { initials: name.slice(0, 1).toUpperCase(), name, nickname: name, bio: '', role: ROLE_LABELS.member, roleKey: 'member', color: 'green', email, invitedByUid: 'local-demo', invitedByName: '演示管理员' }
    setMembers((current) => [newMember, ...current])
    setRegisteredMember({ name, nickname: name, bio: '', email, invitedByUid: 'local-demo', invitedByName: '演示管理员' })
    setIsAuthenticated(true)
  }

  function handleDemoLogin() {
    const demoMember = { initials: '测', name: '测试用户', nickname: '测试用户', bio: '来认识一些一起上场的球友。', role: ROLE_LABELS.owner, roleKey: 'owner', color: 'green', email: 'demo@at-club.local' }
    if (!members.some((member) => member.email === demoMember.email)) {
      setMembers((current) => [demoMember, ...current])
    }
    setRegisteredMember({ name: demoMember.name, nickname: demoMember.name, bio: demoMember.bio, email: demoMember.email })
    setIsAuthenticated(true)
  }

  async function handleLogout() {
    try {
      if (isFirebaseConfigured) await logoutFromFirebase()
      setIsAuthenticated(false)
      setFirebaseUser(null)
      setRegisteredMember(null)
      setJoinedIds([])
      setPaymentStatuses({})
      setScheduleItems([])
      setPaymentOrder(null)
      setPendingJoinEvent(null)
      setSelectedEvent(null)
      setShowProfile(false)
      setShowMobileNav(false)
      setActiveNav('首页')
    } catch (error) {
      flash(error.message || '退出登录失败，请稍后重试。')
    }
  }

  function requestJoin(event) {
    if (joinedIds.includes(event.id)) {
      flash('你已经在名单里啦，期待球场见。')
      return
    }
    if (event.spots === 0) {
      flash('这场已经满员，可以看看其他场次。')
      return
    }
    setPendingJoinEvent(event)
  }

  function applyLocalJoin(event, { decrementSpots = true, syncSpots, paymentStatus } = {}) {
    if (!event) return
    setJoinedIds((current) => current.includes(event.id) ? current : [...current, event.id])
    setPaymentStatuses((current) => ({
      ...current,
      [event.id]: paymentStatus || current[event.id] || (isAlipayEnabled ? 'pending' : 'paid'),
    }))
    setScheduleItems((current) => current.some((item) => item.eventId === event.id) ? current : [...current, eventToScheduleItem(event)])
    if (decrementSpots || syncSpots !== undefined) {
      setEvents((current) => current.map((item) => {
        if (item.id !== event.id) return item
        return { ...item, spots: syncSpots === undefined ? Math.max(0, item.spots - 1) : syncSpots }
      }))
    }
    setPendingJoinEvent(null)
    setSelectedEvent(null)
  }

  function handleJoin(event) {
    applyLocalJoin(event)
    flash(isAlipayEnabled ? `已报名「${event.title}」，费用 ¥${event.price}，请稍后完成支付。` : `已报名「${event.title}」，费用 ¥${event.price}。`)
  }

  async function handleStartPayment(event) {
    if (!isAlipayEnabled) {
      handleJoin(event)
      return
    }
    if (!firebaseUser) {
      flash('请先登录后再支付。')
      return
    }
    setPaymentSubmitting(true)
    try {
      const payment = await createAlipayPayment(event, firebaseUser)
      setPaymentOrder({ ...payment, event })
      setPaymentStatus('pending')
      setPendingJoinEvent(null)
      setSelectedEvent(null)
    } catch (error) {
      flash(error.message || '支付订单创建失败，请稍后再试。')
    } finally {
      setPaymentSubmitting(false)
    }
  }

  function handlePayLater(event) {
    applyLocalJoin(event, { paymentStatus: 'pending' })
    flash(`已报名「${event.title}」，之后可在“我的场次”完成支付。`)
  }

  function handleConfirmJoin(event) {
    if (!isAlipayEnabled) {
      handleJoin(event)
      return
    }
    handleStartPayment(event)
  }

  async function refreshPaymentStatus() {
    if (!paymentOrder?.outTradeNo || !firebaseUser) return
    try {
      const result = await getAlipayPaymentStatus(paymentOrder.outTradeNo, firebaseUser)
      if (result.status === 'paid' && result.event) {
        setPaymentStatus('paid')
        applyLocalJoin(result.event, { decrementSpots: false, syncSpots: result.event.spots, paymentStatus: 'paid' })
        flash(`支付成功，已报名「${result.event.title}」。`)
        return
      }
      setPaymentStatus(result.status || 'pending')
    } catch (error) {
      flash(error.message || '支付状态查询失败，请稍后重试。')
    }
  }

  function openAlipayPayment() {
    if (paymentOrder?.paymentUrl) window.location.href = paymentOrder.paymentUrl
  }

  function handleRequestCancellation(event) {
    if (cancellationRequests.some((request) => request.eventId === event.id && request.status === 'pending')) {
      flash('这场的取消申请正在等待管理员审核。')
      return
    }
    setCancellationRequests((current) => [...current, {
      id: `cancel-${Date.now()}`,
      eventId: event.id,
      eventTitle: event.title,
      date: event.date,
      day: event.day,
      time: event.time,
      venue: event.venue,
      requestedAt: '刚刚',
      status: 'pending',
    }])
    flash('取消报名申请已提交，等待管理员审核。')
  }

  function handleCancellationReview(request, decision) {
    if (decision === 'approve') {
      setCancellationRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: 'approved', reviewedAt: '刚刚' } : item))
      setJoinedIds((current) => current.filter((id) => id !== request.eventId))
      setScheduleItems((current) => current.filter((item) => item.eventId !== request.eventId))
      setEvents((current) => current.map((item) => item.id === request.eventId ? { ...item, spots: Math.min(item.total, item.spots + 1) } : item))
      flash(`已批准「${request.eventTitle}」的取消报名申请。`)
      return
    }
    setCancellationRequests((current) => current.map((item) => item.id === request.id ? { ...item, status: 'rejected', reviewedAt: '刚刚' } : item))
    flash(`已驳回「${request.eventTitle}」的取消报名申请。`)
  }

  function pendingCancellationRequests() {
    return cancellationRequests.filter((request) => request.status === 'pending')
  }

  function handleSendMessage(text) {
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
    const message = { id: Date.now(), author: '你', initials: '我', color: 'green', time, text, mine: true }
    if (focusMember) {
      setDirectMessages((current) => ({ ...current, [focusMember.name]: [...(current[focusMember.name] || []), message] }))
      flash(`消息已发给 ${focusMember.name}。`)
      return
    }
    setMessages((current) => [...current, message])
  }

  const handleMarkMessageRead = useCallback((conversationId) => {
    if (conversationId === 'community') {
      setMessageReadState((current) => current.community ? current : { ...current, community: true })
      return
    }
    const memberName = conversationId.replace('member-', '')
    setMessageReadState((current) => current.members?.[memberName] ? current : {
      ...current,
      members: { ...current.members, [memberName]: true },
    })
  }, [])

  function handleOpenNotifications() {
    setShowNotifications(true)
    setNotifications((current) => current.map((notification) => ({ ...notification, read: true })))
  }

  function handleNotificationSelect(notification) {
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read: true } : item))
    setShowNotifications(false)
    if (notification.kind === 'event') {
      setSelectedEvent(events[0])
      return
    }
    if (notification.kind === 'message') {
      setFocusMember(null)
      switchNav('消息')
      return
    }
    switchNav('成员')
  }

  function handleContactMember(member) {
    setProfileMember({ ...member, roleKey: getRoleKey(member, communityAccess) })
    setShowProfile(true)
  }

  function startDirectMessage() {
    setShowProfile(false)
    setFocusMember(profileMember)
    switchNav('消息')
  }

  async function handleSaveProfile({ nickname, bio }) {
    const previousName = currentUser.name
    const nextMember = {
      ...currentUser,
      initials: nickname.slice(0, 1).toUpperCase(),
      name: nickname,
      nickname,
      bio,
      role: ROLE_LABELS[currentUser.roleKey],
      roleKey: currentUser.roleKey,
    }
    try {
      if (firebaseUser) await updateFirebaseProfile(firebaseUser, nickname)
      await saveCommunityProfile(currentUser.uid || firebaseUser?.uid, nextMember)
      setMembers((current) => current.map((member) => {
        const sameUser = member.uid && currentUser.uid ? member.uid === currentUser.uid : member.email && currentUser.email ? member.email === currentUser.email : member.name === currentUser.name
        return sameUser ? { ...member, ...nextMember } : member
      }))
      if (previousName !== nickname) {
        setDirectMessages((current) => {
          if (!current[previousName]) return current
          const { [previousName]: previousMessages, ...remainingMessages } = current
          return { ...remainingMessages, [nickname]: [...(remainingMessages[nickname] || []), ...previousMessages] }
        })
        setMessageReadState((current) => {
          if (!current.members?.[previousName]) return current
          const { [previousName]: wasRead, ...remainingMembers } = current.members
          return { ...current, members: { ...remainingMembers, [nickname]: wasRead } }
        })
      }
      setRegisteredMember((current) => ({ ...(current || {}), ...nextMember, email: current?.email || currentUser.email }))
      setProfileMember(nextMember)
      setShowProfile(false)
      flash('个人名片已更新。')
    } catch (error) {
      flash(getFirebaseAuthErrorMessage(error))
    }
  }

  function handleCreatePost(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = String(form.get('text') || '').trim()
    const label = String(form.get('label') || '场边闲聊')
    if (!text) {
      flash('写点内容再发布吧。')
      return
    }
    setPosts((current) => [{
      id: Date.now(),
      author: '你',
      initials: '我',
      color: 'green',
      time: '刚刚',
      label,
      text,
      likes: 0,
      liked: false,
      comments: [],
    }, ...current])
    setShowPostComposer(false)
    flash('动态已发布，球友们现在都能看到。')
  }

  function handleToggleLike(postId) {
    setPosts((current) => current.map((post) => post.id === postId ? {
      ...post,
      liked: !post.liked,
      likes: post.likes + (post.liked ? -1 : 1),
    } : post))
  }

  function handleAddComment(postId, text) {
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date())
    setPosts((current) => current.map((post) => post.id === postId ? {
      ...post,
      comments: [...post.comments, { id: Date.now(), author: '你', initials: '我', color: 'green', time, text }],
    } : post))
  }

  function switchNav(label) {
    setActiveNav(label)
    setShowMobileNav(false)
  }

  async function handleInviteSubmit(event) {
    event.preventDefault()
    const code = inviteCode.trim().toUpperCase()
    if (!isAdmin) {
      flash('只有管理员可以发放邀请码。')
      return
    }
    if (!/^[A-Z]{8}$/.test(code)) {
      flash('邀请码必须是 8 位字母。')
      return
    }
    let nextCode = code
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await createInviteCodeRecord(nextCode, { uid: firebaseUser?.uid || 'local-demo', name: currentUser.name })
        setInviteCode(nextCode)
        setShowInvite(false)
        flash(`邀请码 ${nextCode} 已生成，可以发给朋友。`)
        return
      } catch (error) {
        if (isFirebaseConfigured && error?.message === 'invite-code-exists') {
          nextCode = generateInviteCode()
          setInviteCode(nextCode)
          continue
        }
        flash(isFirebaseConfigured ? getFirebaseAuthErrorMessage(error) : '邀请码生成失败，请稍后重试。')
        return
      }
    }
    flash('邀请码生成失败，请重试。')
  }

  function handleOpenInvite() {
    if (!isAdmin) {
      flash('只有管理员可以发放邀请码。')
      return
    }
    setInviteCode(generateInviteCode())
    setShowInvite(true)
  }

  async function handleToggleAdmin(member, enabled) {
    if (!isOwner || !member.uid || member.uid === communityAccess.ownerUid) {
      flash('只有社群所有者可以调整管理员。')
      return
    }
    const adminUids = enabled
      ? [...new Set([...(communityAccess.adminUids || []), member.uid])]
      : (communityAccess.adminUids || []).filter((uid) => uid !== member.uid)
    const admins = enabled
      ? [...(communityAccess.admins || []).filter((admin) => admin.uid !== member.uid), { uid: member.uid, name: member.name }]
      : (communityAccess.admins || []).filter((admin) => admin.uid !== member.uid)
    try {
      if (isFirebaseConfigured) {
        await saveCommunityAccess({ ...communityAccess, adminUids, admins })
      }
      setCommunityAccess((current) => ({ ...current, adminUids, admins }))
      setMembers((current) => current.map((item) => item.uid === member.uid ? {
        ...item,
        role: enabled ? ROLE_LABELS.administrator : ROLE_LABELS.member,
        roleKey: enabled ? 'administrator' : 'member',
      } : item))
      flash(enabled ? `${member.name} 已设为管理员。` : `${member.name} 已取消管理员权限。`)
    } catch (error) {
      flash(getFirebaseAuthErrorMessage(error))
    }
  }

  function handlePublishSubmit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const newEvent = {
      id: Date.now(),
      date: form.get('date') || '09.07',
      day: '周日',
      time: form.get('time') || '19:30 — 22:00',
      title: form.get('title') || '周末夜场 · 新局开打',
      level: form.get('level') || '中级友好',
      venue: form.get('venue') || '深圳湾体育中心 · 2 号馆',
      address: '场地信息待补充',
      price: Number(form.get('price')) || 38,
      spots: Number(form.get('total')) || 12,
      total: Number(form.get('total')) || 12,
      status: '报名中',
      accent: 'blue',
      publisherRole: isAdmin ? 'administrator' : 'member',
    }
    setEvents((current) => [newEvent, ...current])
    setShowPublish(false)
    flash('场次已发布，成员现在可以报名了。')
  }

  function handleCreateScheduleItem(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const title = String(form.get('title') || '').trim()
    if (!title) {
      flash('给这条日程写个名称吧。')
      return
    }
    setScheduleItems((current) => [...current, {
      id: `schedule-${Date.now()}`,
      date: String(form.get('date') || '2026-08-22'),
      time: String(form.get('time') || '19:00'),
      title,
      type: String(form.get('type') || '个人安排'),
      note: String(form.get('note') || '留给自己的安排。').trim(),
      accent: String(form.get('accent') || 'mint'),
      completed: false,
    }])
    setShowScheduleComposer(false)
    flash('日程已加入你的时间表。')
  }

  function toggleScheduleItem(itemId) {
    setScheduleItems((current) => current.map((item) => item.id === itemId ? { ...item, completed: !item.completed } : item))
  }

  function deleteScheduleItem(itemId) {
    setScheduleItems((current) => current.filter((item) => item.id !== itemId))
    flash('日程已删除。')
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(inviteCode) } catch { /* clipboard may be unavailable in preview */ }
    flash('邀请码已复制。')
  }

  function resetCommunityData() {
    setEvents(initialEvents)
    setJoinedIds([])
    setCancellationRequests([])
    setScheduleItems(initialScheduleItems)
    setMembers(initialMembers)
    setMessages(starterMessages)
    setDirectMessages({})
    setMessageReadState({ community: false, members: {} })
    setPosts(starterPosts)
    setNotifications(initialNotifications)
    setRegisteredMember(null)
    setInviteCode(generateInviteCode())
    setShowSettings(false)
    flash('已恢复初始演示数据。')
  }

  function handleOpenAdminData() {
    if (!isAdmin) {
      flash('只有管理员可以查看成员数据。')
      return
    }
    setShowAdminData(true)
  }

  if (isFirebaseConfigured && !authResolved) {
    return <main className="auth-loading">正在连接登录服务…</main>
  }

  if (!isAuthenticated) {
    return <LoginGate onLogin={handleLogin} onRegister={handleGateRegister} onDemoLogin={handleDemoLogin} firebaseEnabled={isFirebaseConfigured} />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandLockup />
        <div className="sidebar-community">
          <div className="community-avatar">A&T</div>
          <div><strong>{COMMUNITY_NAME}</strong><span>私密社群 · {communityMemberCount} 人</span></div>
          <ChevronDown size={16} />
        </div>
        <nav className="main-nav" aria-label="主导航">
          {[
            ['首页', <House size={18} />],
            ['我的场次', <CalendarDays size={18} />],
            ['个人日程', <CalendarDays size={18} />],
            ['消息', <MessageCircle size={18} />, unreadMessageCount || null],
            ['成员', <UsersRound size={18} />],
          ].map(([label, icon, count]) => (
            <button key={label} className={activeNav === label ? 'active' : ''} onClick={() => switchNav(label)}>
              {icon}<span>{label}</span>{count && <em>{count}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button onClick={() => setShowPublish(true)} className="admin-action"><Plus size={17} /><span>发布新场次</span></button>
          <button className="sidebar-link" onClick={() => setShowSettings(true)}><Settings2 size={17} /><span>社群设置</span></button>
          <button type="button" className="admin-profile profile-trigger" onClick={() => { setProfileMember(currentUser); setShowProfile(true) }} aria-label="编辑我的名片">
            <Avatar initials={currentUser.initials} color={currentUser.color} />
            <div><strong>{currentUser.name}</strong><span><RoleLabel roleKey={currentUser.roleKey} compact /></span></div>
            <Ellipsis size={18} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        {cloudError && <div className="cloud-warning" role="status">{cloudError}</div>}
        <header className="topbar">
          <div className="mobile-brand"><BrandLockup compact /></div>
          <div className="breadcrumb"><span>{COMMUNITY_NAME}</span><span>/</span><strong>{activeNav}</strong></div>
          <div className="topbar-actions">
            <button className="icon-button" aria-label="搜索" onClick={() => setShowSearch(true)}><Search size={19} /></button>
            <button className="icon-button notification-button" aria-label="通知" onClick={handleOpenNotifications}><Bell size={19} />{notifications.some((notification) => !notification.read) && <span />}</button>
            <button className="mobile-menu icon-button" aria-label="打开菜单" onClick={() => setShowMobileNav(true)}><Menu size={20} /></button>
          </div>
        </header>

        <div className="content-wrap">
          {activeNav === '首页' && <>
          <section className="hero-panel">
            <div className="hero-copy">
              <div className="hero-kicker"><span className="live-pip" /> CLUB UPDATE · 08.22</div>
              <h1>今晚，<br /><span>上场见。</span></h1>
              <p>固定的人，热爱的球。<br />下一场排球局已经准备好了。</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={() => document.getElementById('sessions').scrollIntoView({ behavior: 'smooth' })}>查看近期场次 <ArrowUpRight size={17} /></button>
                <button className="quiet-button" onClick={handleOpenInvite}>邀请新球友 <Plus size={16} /></button>
              </div>
            </div>
            <div className="hero-art" aria-label="排球场地视觉">
              <div className="court-lines"><i /><i /><i /><i /></div>
              <div className="volley-ball"><span /><span /><span /></div>
              <div className="hero-stamp"><Sparkles size={14} /><span>ambition<br />&amp;together</span></div>
              <div className="hero-note">NEXT UP<br /><strong>19:30</strong></div>
            </div>
          </section>

          <section className="stats-strip">
            <Stat value={communityMemberCount} label="位社群成员" icon={<UsersRound size={17} />} />
            <Stat value="24" label="本月已开场" icon={<Ticket size={17} />} />
            <Stat value={joinedCount || '—'} label="我的待参加" icon={<CalendarDays size={17} />} />
            <div className="strip-note"><span className="spark-dot" /> 本周还有 <strong>{spotsLeft}</strong> 个空位</div>
          </section>

          <section className="sessions-section" id="sessions">
            <SectionLabel action="查看全部" onAction={() => flash('目前已经是全部公开场次。')}>近期场次</SectionLabel>
            <div className="section-intro"><p>挑一场合适的，来和熟悉的球友打个照面。</p><span>按时间排序 · 深圳</span></div>
            <div className="events-list">
              {events.map((event) => <EventCard key={event.id} event={event} joined={joinedIds.includes(event.id)} onJoin={requestJoin} onOpen={setSelectedEvent} />)}
            </div>
          </section>

          <section className="lower-grid">
            <div className="community-feed">
              <SectionLabel secondaryAction="发布动态" onSecondaryAction={() => setShowPostComposer(true)} action="进入讨论" onAction={() => switchNav('消息')}>社群动态</SectionLabel>
              <div className="feed-list">{posts.map((post) => <FeedPost key={post.id} post={post} commentsOpen={openComments === post.id} onToggleLike={handleToggleLike} onToggleComments={(postId) => setOpenComments((current) => current === postId ? null : postId)} onAddComment={handleAddComment} onShare={() => flash('动态链接已复制。')} />)}</div>
            </div>
            <div className="members-panel">
              <SectionLabel action="管理成员" onAction={() => switchNav('成员')}>活跃球友</SectionLabel>
              <div className="member-list">{members.map((member) => { const roleKey = getRoleKey(member, communityAccess); return <button className="member-row member-row-button" key={member.uid || member.name} onClick={() => handleContactMember(member)}><Avatar initials={member.initials} color={member.color} /><div className="member-row-copy"><strong>{getMemberName(member)}</strong><span><RoleLabel roleKey={roleKey} compact /></span></div><span className="online-dot" /></button> })}</div>
            </div>
          </section>
          </>}
          {activeNav === '我的场次' && <MySessionsView events={events} joinedIds={joinedIds} paymentStatuses={paymentStatuses} cancellationRequests={cancellationRequests} onExplore={() => switchNav('首页')} onPayNow={handleStartPayment} onRequestCancel={handleRequestCancellation} />}
          {activeNav === '个人日程' && <PersonalScheduleView events={events} joinedIds={joinedIds} scheduleItems={scheduleItems} onAdd={() => setShowScheduleComposer(true)} onToggle={toggleScheduleItem} onDelete={deleteScheduleItem} />}
          {activeNav === '消息' && <MessagesView messages={messages} directMessages={directMessages} members={members} focusMember={focusMember} messageReadState={messageReadState} onSend={handleSendMessage} onSelectMember={(member) => setFocusMember(member)} onBackToCommunity={() => setFocusMember(null)} onMarkRead={handleMarkMessageRead} />}
          {activeNav === '成员' && <MembersView members={members} currentUser={currentUser} communityAccess={communityAccess} onInvite={handleOpenInvite} onContact={handleContactMember} />}
        </div>
      </main>

      {showMobileNav && <div className="mobile-nav-backdrop" onMouseDown={() => setShowMobileNav(false)}><aside className="mobile-nav-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mobile-nav-head"><BrandLockup /><button className="icon-button" aria-label="关闭菜单" onClick={() => setShowMobileNav(false)}><X size={20} /></button></div>
        <div className="mobile-nav-community"><div className="community-avatar">A&T</div><div><strong>{COMMUNITY_NAME}</strong><span>私密社群 · {communityMemberCount} 人</span></div></div>
        <nav className="main-nav" aria-label="移动导航">{[
          ['首页', <House size={18} />],
          ['我的场次', <CalendarDays size={18} />],
          ['个人日程', <CalendarDays size={18} />],
          ['消息', <MessageCircle size={18} />, unreadMessageCount || null],
          ['成员', <UsersRound size={18} />],
        ].map(([label, icon, count]) => <button key={label} className={activeNav === label ? 'active' : ''} onClick={() => switchNav(label)}>{icon}<span>{label}</span>{count && <em>{count}</em>}</button>)}</nav>
        <button type="button" className="sidebar-link mobile-profile-link" onClick={() => { setProfileMember(currentUser); setShowProfile(true); setShowMobileNav(false) }}><UserRound size={18} /><span>编辑我的名片</span></button>
        <button onClick={() => { setShowPublish(true); setShowMobileNav(false) }} className="admin-action"><Plus size={17} /><span>发布新场次</span></button>
      </aside></div>}

      {showInvite && <div className="modal-backdrop" onMouseDown={() => setShowInvite(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭" onClick={() => setShowInvite(false)}><X size={18} /></button>
        <div className="modal-icon"><ShieldCheck size={22} /></div><span className="eyebrow">ADMIN ONLY · INVITE CODE</span><h2>发放邀请码</h2><p>每个邀请码只能使用一次。生成后发给朋友，朋友在登录页使用它注册。</p>
        <form onSubmit={handleInviteSubmit}>
          <label>本次邀请码<input name="inviteCode" value={inviteCode} readOnly /></label>
          <button className="primary-button full-width" type="submit">生成邀请码 <ArrowUpRight size={16} /></button>
        </form>
        <div className="invite-share"><span>你的邀请码</span><strong>{inviteCode}</strong><button onClick={copyCode} aria-label="复制邀请码"><Copy size={16} /></button></div>
      </div></div>}

      {showWelcomeMail && registeredMember && <div className="modal-backdrop" onMouseDown={() => setShowWelcomeMail(false)}><div className="modal welcome-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭" onClick={() => setShowWelcomeMail(false)}><X size={18} /></button>
        <div className="modal-icon mail-icon"><MailCheck size={22} /></div><span className="eyebrow">WELCOME MAIL</span><h2>欢迎加入，{registeredMember.name}</h2><p>邮件已发送到 <strong className="mail-address">{registeredMember.email}</strong>。打开邮件即可查看社群规则和下一场活动。</p>
        <div className="email-preview"><div className="email-preview-top"><AtSign size={15} /><span>{COMMUNITY_NAME} · 欢迎邮件</span><span className="email-sent"><Check size={13} /> 已发送</span></div><div className="email-preview-body"><strong>嗨，{registeredMember.name}！</strong><p>欢迎来到 {COMMUNITY_NAME}。带上你的球鞋，我们在场上见。</p><span>下一场：周六夜场 · 混合组局<br />时间：08 月 29 日 · 19:30</span></div></div>
        <button className="primary-button full-width" onClick={() => setShowWelcomeMail(false)}>进入社群 <ArrowUpRight size={16} /></button>
      </div></div>}

      {showPublish && <div className="modal-backdrop" onMouseDown={() => setShowPublish(false)}><div className="modal publish-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭" onClick={() => setShowPublish(false)}><X size={18} /></button><div className="modal-icon yellow-icon"><Plus size={22} /></div><span className="eyebrow">NEW VOLLEY SESSION</span><h2>发布新场次</h2><p>把下一场球的细节告诉社群成员。</p>
        <form onSubmit={handlePublishSubmit} className="publish-form"><label>场次名称<input name="title" defaultValue="周末夜场 · 新局开打" /></label><div className="form-row"><label>日期<input name="date" defaultValue="09.07" /></label><label>时间<input name="time" defaultValue="19:30 — 22:00" /></label></div><div className="form-row"><label>人均费用<input name="price" type="number" defaultValue="38" /></label><label>人数上限<input name="total" type="number" defaultValue="12" /></label></div><label>场馆<input name="venue" defaultValue="深圳湾体育中心 · 2 号馆" /></label><label>水平<select name="level" defaultValue="中级友好"><option>新手友好</option><option>中级友好</option><option>进阶局</option></select></label><button className="primary-button full-width" type="submit">发布场次 <ArrowUpRight size={16} /></button></form>
      </div></div>}

      {showPostComposer && <div className="modal-backdrop" onMouseDown={() => setShowPostComposer(false)}><div className="modal post-composer-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭" onClick={() => setShowPostComposer(false)}><X size={18} /></button><div className="modal-icon"><MessageCircle size={22} /></div><span className="eyebrow">COMMUNITY UPDATE</span><h2>发布一条动态</h2><p>分享约球、装备、复盘，或者给熟悉的球友留个消息。</p>
        <form onSubmit={handleCreatePost}><label>动态类型<select name="label" defaultValue="场边闲聊"><option>场边闲聊</option><option>约球</option><option>装备分享</option><option>赛后复盘</option></select></label><label>想说的话<textarea name="text" rows="5" autoFocus placeholder="例如：周日想加练一小时，有人一起吗？" /></label><button className="primary-button full-width" type="submit">发布动态 <ArrowUpRight size={16} /></button></form>
      </div></div>}

      {showScheduleComposer && <div className="modal-backdrop" onMouseDown={() => setShowScheduleComposer(false)}><div className="modal schedule-composer-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭" onClick={() => setShowScheduleComposer(false)}><X size={18} /></button><div className="modal-icon"><CalendarDays size={22} /></div><span className="eyebrow">PERSONAL PLANS</span><h2>新建个人日程</h2><p>记录训练、约球和那些让这周更顺手的小事。</p>
        <form onSubmit={handleCreateScheduleItem} className="schedule-form"><label>事项名称<input name="title" autoFocus placeholder="例如：下班后去拉伸" /></label><div className="form-row"><label>日期<input name="date" type="date" defaultValue="2026-08-22" /></label><label>时间<input name="time" type="time" defaultValue="19:00" /></label></div><div className="form-row"><label>类型<select name="type" defaultValue="个人安排"><option>个人安排</option><option>训练计划</option><option>约球</option><option>准备事项</option></select></label><label>标记<select name="accent" defaultValue="mint"><option value="mint">薄荷绿</option><option value="yellow">暖黄</option><option value="coral">珊瑚红</option><option value="sky">天蓝</option></select></label></div><label>备注<textarea name="note" rows="3" placeholder="可以补充地点、提醒或同行的人。" /></label><button className="primary-button full-width" type="submit">加入日程 <ArrowUpRight size={16} /></button></form>
      </div></div>}

      {showSearch && <SearchModal events={events} members={members} communityAccess={communityAccess} onClose={() => setShowSearch(false)} onSelect={(label) => { switchNav(label); setShowSearch(false) }} />}

      {selectedEvent && <EventDetailModal event={selectedEvent} joined={joinedIds.includes(selectedEvent.id)} members={members} onClose={() => setSelectedEvent(null)} onJoin={requestJoin} onCopyAddress={async (address) => { try { await navigator.clipboard.writeText(address) } catch { /* clipboard may be unavailable in preview */ } flash('场地地址已复制。') }} />}
      {pendingJoinEvent && <JoinConfirmationModal event={pendingJoinEvent} onClose={() => setPendingJoinEvent(null)} onPayNow={() => handleStartPayment(events.find((event) => event.id === pendingJoinEvent.id) || pendingJoinEvent)} onPayLater={() => handlePayLater(events.find((event) => event.id === pendingJoinEvent.id) || pendingJoinEvent)} onConfirm={() => handleConfirmJoin(events.find((event) => event.id === pendingJoinEvent.id) || pendingJoinEvent)} isSubmitting={paymentSubmitting} paymentEnabled={isAlipayEnabled} />}
      {paymentOrder && <AlipayQrModal event={paymentOrder.event} qrCode={paymentOrder.qrCode} paymentUrl={paymentOrder.paymentUrl} outTradeNo={paymentOrder.outTradeNo} status={paymentStatus} onClose={() => setPaymentOrder(null)} onRefresh={refreshPaymentStatus} onOpenPayment={openAlipayPayment} />}

      {showNotifications && <NotificationsModal notifications={notifications} onClose={() => setShowNotifications(false)} onSelect={handleNotificationSelect} onReadAll={() => { setNotifications((current) => current.map((notification) => ({ ...notification, read: true }))); flash('通知已全部标记为已读。') }} />}

      {showSettings && <div className="modal-backdrop" onMouseDown={() => setShowSettings(false)}><div className="modal settings-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" aria-label="关闭" onClick={() => setShowSettings(false)}><X size={18} /></button><div className="modal-icon yellow-icon"><Settings2 size={22} /></div><span className="eyebrow">COMMUNITY SETTINGS</span><h2>社群设置</h2><p>管理新成员加入时使用的邀请码，以及取消报名审核。</p>
        <div className="invite-admin-summary"><span>当前邀请码</span><strong>{inviteCode}</strong><button className="quiet-button" onClick={handleOpenInvite}><Plus size={15} /> 发放新邀请码</button></div>
        <div className="cancellation-review"><div className="review-heading"><div><span className="eyebrow">CANCELLATION REVIEW</span><h3>取消报名审核</h3></div><span className="review-count">{pendingCancellationRequests().length} 待处理</span></div>
          {pendingCancellationRequests().length === 0 ? <div className="review-empty"><Check size={16} /> 暂无待处理的取消报名申请</div> : <div className="review-list">{pendingCancellationRequests().map((request) => <article className="review-item" key={request.id}><div className="review-item-copy"><strong>{request.eventTitle}</strong><span>{request.date} · {request.time}</span><small>{request.venue} · {request.requestedAt}提交</small></div><div className="review-item-actions"><button className="review-reject" onClick={() => handleCancellationReview(request, 'reject')}>驳回</button><button className="review-approve" onClick={() => handleCancellationReview(request, 'approve')}><Check size={13} /> 批准</button></div></article>)}</div>}
        </div>
        <div className="settings-actions"><button className="quiet-button" onClick={copyCode}><Copy size={15} /> 复制邀请码</button>{isAdmin && <button className="quiet-button" onClick={handleOpenAdminData}><UsersRound size={15} /> 查看成员数据</button>}{isOwner && <button className="quiet-button" onClick={() => setShowAdminManagement(true)}><ShieldCheck size={15} /> 设置管理员</button>}<button className="danger-button" onClick={resetCommunityData}>恢复演示数据</button></div>
      </div></div>}

      {showAdminData && <AdminUserDataModal users={adminUsers} events={events} communityAccess={communityAccess} loading={adminUsersLoading} onClose={() => setShowAdminData(false)} />}
      {showAdminManagement && <AdminManagementModal members={members} communityAccess={communityAccess} onToggleAdmin={handleToggleAdmin} onClose={() => setShowAdminManagement(false)} />}

      {showProfile && <ProfileModal profileMember={profileMember} currentUser={currentUser} onClose={() => setShowProfile(false)} onSave={handleSaveProfile} onStartMessage={startDirectMessage} onLogout={handleLogout} />}
      {notice && <div className="toast"><Check size={16} /> {notice}</div>}
    </div>
  )
}

export default App

createRoot(document.getElementById('root')).render(<App />)
