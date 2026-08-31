import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { addDoc, collection, doc, getDoc, getFirestore, onSnapshot, query, runTransaction, serverTimestamp, setDoc, where } from 'firebase/firestore'

const COMMUNITY_ID = 'at-club'

function readFirebaseEnv(name) {
  return String(import.meta.env[name] || '')
    .trim()
    .replace(/[;,]+$/, '')
    .trim()
}

function isConfiguredOwner(user) {
  const ownerUid = readFirebaseEnv('VITE_FIREBASE_OWNER_UID')
  const ownerEmail = readFirebaseEnv('VITE_FIREBASE_OWNER_EMAIL').toLowerCase()
  return Boolean(
    user && (
      (ownerUid && user.uid === ownerUid)
      || (ownerEmail && user.email?.trim().toLowerCase() === ownerEmail)
    ),
  )
}

const firebaseConfig = {
  apiKey: readFirebaseEnv('VITE_FIREBASE_API_KEY'),
  authDomain: readFirebaseEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: readFirebaseEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: readFirebaseEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readFirebaseEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: readFirebaseEnv('VITE_FIREBASE_APP_ID'),
}

export const isFirebaseConfigured = Object.values(firebaseConfig).every(Boolean)

let auth
let db

if (isFirebaseConfigured) {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = getFirestore(app)
}

export function subscribeToAuth(callback) {
  if (!auth) return () => {}
  return onAuthStateChanged(auth, callback)
}

export async function loginWithFirebase(email, password) {
  if (!auth) throw new Error('firebase-not-configured')
  const credential = await signInWithEmailAndPassword(auth, email, password)
  if (!(await isRegisteredMember(credential.user))) {
    await signOut(auth)
    throw new Error('auth/member-not-registered')
  }
  return credential
}

export async function isRegisteredMember(user) {
  if (!user || !db) return false
  const token = await user.getIdTokenResult(true)
  const claimRole = String(token.claims.role || '').toLowerCase()
  if (
    token.claims.owner === true
    || claimRole === 'owner'
    || isConfiguredOwner(user)
  ) return true

  const [profileSnapshot, userSnapshot, accessSnapshot] = await Promise.all([
    getDoc(doc(db, 'communities', COMMUNITY_ID, 'profiles', user.uid)),
    getDoc(doc(db, 'communities', COMMUNITY_ID, 'users', user.uid)),
    getDoc(doc(db, 'communityAccess', COMMUNITY_ID)),
  ])
  return profileSnapshot.exists()
    || Boolean(userSnapshot.data()?.registeredMember)
    || accessSnapshot.data()?.ownerUid === user.uid
}

export async function repairMemberProfile(user) {
  if (!user || !db) return false
  const profileRef = doc(db, 'communities', COMMUNITY_ID, 'profiles', user.uid)
  const userSnapshot = await getDoc(doc(db, 'communities', COMMUNITY_ID, 'users', user.uid))
  const profileSnapshot = await getDoc(profileRef)
  if (profileSnapshot.exists() || !userSnapshot.exists() || !userSnapshot.data()?.registeredMember) return false

  const registeredMember = userSnapshot.data()?.registeredMember || {}
  const nickname = String(registeredMember.nickname || registeredMember.name || user.displayName || user.email?.split('@')[0] || '新成员')
  await setDoc(profileRef, {
    nickname,
    bio: String(registeredMember.bio || ''),
    initials: nickname.slice(0, 1).toUpperCase(),
    color: String(registeredMember.color || 'green'),
    updatedAt: serverTimestamp(),
  }, { merge: true })
  return true
}

export async function updateFirebaseProfile(user, name) {
  if (!user || !auth) return
  await updateProfile(user, { displayName: name })
}

export async function registerWithFirebase(email, password, name, inviteCode) {
  if (!auth) throw new Error('firebase-not-configured')
  const credential = await createUserWithEmailAndPassword(auth, email, password)
  try {
    await updateProfile(credential.user, { displayName: name })
    const normalizedCode = inviteCode.trim().toUpperCase()
    const inviteRef = doc(db, 'inviteCodes', normalizedCode)
    const profileRef = doc(db, 'communities', COMMUNITY_ID, 'profiles', credential.user.uid)
    const userRef = doc(db, 'communities', COMMUNITY_ID, 'users', credential.user.uid)
    const newMember = {
      initials: name.slice(0, 1).toUpperCase(),
      name,
      nickname: name,
      bio: '',
      role: 'Member',
      roleKey: 'member',
      color: 'green',
      email,
      uid: credential.user.uid,
    }
    const registeredMember = {
      name,
      nickname: name,
      bio: '',
      email,
      uid: credential.user.uid,
    }
    const invitation = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(inviteRef)
      if (!snapshot.exists() || snapshot.data().status !== 'active') throw new Error('invalid-invite-code')
      const data = snapshot.data()
      transaction.update(inviteRef, {
        status: 'used',
        usedByUid: credential.user.uid,
        usedByName: name,
        usedByEmail: email,
        usedAt: serverTimestamp(),
      })
      transaction.set(profileRef, {
        nickname: newMember.nickname,
        bio: newMember.bio,
        initials: newMember.initials,
        color: newMember.color,
        updatedAt: serverTimestamp(),
      })
      transaction.set(userRef, {
        registeredMember: {
          ...registeredMember,
          invitedByUid: data.createdByUid,
          invitedByName: data.createdByName,
        },
        joinedIds: [],
        paymentStatuses: {},
        scheduleItems: [],
        messageReadState: { community: false, members: {} },
        notifications: [],
      })
      return { invitedByUid: data.createdByUid, invitedByName: data.createdByName }
    })
    return { ...credential, invitation }
  } catch (error) {
    try {
      await deleteUser(credential.user)
    } catch {
      // The original error is more useful to the registration form.
    }
    throw error
  }
}

export async function getFirebaseOwnerStatus(user) {
  if (!user) return false
  const token = await user.getIdTokenResult(true)
  if (token.claims.owner === true || String(token.claims.role || '').toLowerCase() === 'owner') return true
  if (isConfiguredOwner(user)) return true
  if (!db) return false
  const accessSnapshot = await getDoc(doc(db, 'communityAccess', COMMUNITY_ID))
  return accessSnapshot.data()?.ownerUid === user.uid
}

export async function redeemInviteCode(code, user, member) {
  if (!db) return { invitedByUid: 'local-demo', invitedByName: '演示管理员' }
  const inviteRef = doc(db, 'inviteCodes', code.trim().toUpperCase())
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(inviteRef)
    if (!snapshot.exists() || snapshot.data().status !== 'active') throw new Error('invalid-invite-code')
    const data = snapshot.data()
    transaction.update(inviteRef, {
      status: 'used',
      usedByUid: user.uid,
      usedByName: member.name,
      usedByEmail: user.email,
      usedAt: serverTimestamp(),
    })
    return { invitedByUid: data.createdByUid, invitedByName: data.createdByName }
  })
}

export async function logoutFromFirebase() {
  if (auth) await signOut(auth)
}

export function subscribeToCommunity(callback, onError) {
  if (!db) return () => {}
  return onSnapshot(doc(db, 'communities', COMMUNITY_ID), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : null)
  }, onError)
}

export function subscribeToCommunityMeta(callback, onError) {
  if (!db) return () => {}
  return onSnapshot(doc(db, 'communityMeta', COMMUNITY_ID), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : null)
  }, onError)
}

export function subscribeToCommunityAccess(callback, onError) {
  if (!db) return () => {}
  return onSnapshot(doc(db, 'communityAccess', COMMUNITY_ID), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : null)
  }, onError)
}

export function subscribeToInviteCodes(callback, onError) {
  if (!db) return () => {}
  return onSnapshot(collection(db, 'inviteCodes'), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, onError)
}

export function subscribeToUserData(uid, callback, onError) {
  if (!db || !uid) return () => {}
  return onSnapshot(doc(db, 'communities', COMMUNITY_ID, 'users', uid), (snapshot) => {
    callback(snapshot.exists() ? snapshot.data() : null)
  }, onError)
}

export function subscribeToAllUserData(callback, onError) {
  if (!db) return () => {}
  return onSnapshot(collection(db, 'communities', COMMUNITY_ID, 'users'), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ uid: item.id, ...item.data() })))
  }, onError)
}

export function subscribeToCommunityProfiles(callback, onError) {
  if (!db) return () => {}
  return onSnapshot(collection(db, 'communities', COMMUNITY_ID, 'profiles'), (snapshot) => {
    callback(snapshot.docs.map((item) => ({ uid: item.id, ...item.data() })))
  }, onError)
}

function subscribeToCollection(path, callback, onError, buildQuery = (ref) => ref) {
  if (!db) return () => {}
  return onSnapshot(buildQuery(collection(db, ...path)), (snapshot) => {
    callback(snapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0)))
  }, onError)
}

export function subscribeToCommunityMessages(callback, onError) {
  return subscribeToCollection(['communities', COMMUNITY_ID, 'messages'], callback, onError, (ref) => ref)
}

export function subscribeToCommunityDirectMessages(uid, callback, onError) {
  return subscribeToCollection(
    ['communities', COMMUNITY_ID, 'directMessages'],
    callback,
    onError,
    (ref) => query(ref, where('participantUids', 'array-contains', uid)),
  )
}

export function subscribeToCommunityPosts(callback, onError) {
  return subscribeToCollection(['communities', COMMUNITY_ID, 'posts'], callback, onError, (ref) => ref)
}

export function subscribeToCommunityCancellationRequests(uid, isAdminUser, callback, onError) {
  return subscribeToCollection(
    ['communities', COMMUNITY_ID, 'cancellationRequests'],
    callback,
    onError,
    (ref) => isAdminUser ? ref : query(ref, where('uid', '==', uid)),
  )
}

export async function createCommunityMessage(message) {
  if (!db) return message
  const { id, ...data } = message
  const result = await addDoc(collection(db, 'communities', COMMUNITY_ID, 'messages'), data)
  return { ...message, id: result.id }
}

export async function createDirectMessage(message) {
  if (!db) return message
  const { id, ...data } = message
  const result = await addDoc(collection(db, 'communities', COMMUNITY_ID, 'directMessages'), data)
  return { ...message, id: result.id }
}

export function updateCommunityPost(postId, data) {
  if (!db || !postId) return Promise.resolve()
  return setDoc(doc(db, 'communities', COMMUNITY_ID, 'posts', postId), data, { merge: true })
}

export async function createCommunityPost(post) {
  if (!db) return post
  const { id, ...data } = post
  const result = await addDoc(collection(db, 'communities', COMMUNITY_ID, 'posts'), data)
  return { ...post, id: result.id }
}

export async function createCancellationRequest(request) {
  if (!db) return request
  const { id, ...data } = request
  const result = await addDoc(collection(db, 'communities', COMMUNITY_ID, 'cancellationRequests'), data)
  return { ...request, id: result.id }
}

export function updateCancellationRequest(requestId, data) {
  if (!db || !requestId) return Promise.resolve()
  return setDoc(doc(db, 'communities', COMMUNITY_ID, 'cancellationRequests', requestId), data, { merge: true })
}

export async function reviewCancellationRequest(requestId, decision, firebaseUser) {
  if (!firebaseUser) throw new Error('auth-required')
  const idToken = await firebaseUser.getIdToken()
  const response = await fetch('/api/community/cancellation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ requestId, decision }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || '取消申请审核失败。')
    error.code = payload.code || `cancellation-http-${response.status}`
    throw error
  }
  return payload
}

export async function joinCommunityEvent(eventId, firebaseUser, paymentStatus = 'paid') {
  if (!firebaseUser) throw new Error('auth-required')
  const idToken = await firebaseUser.getIdToken()
  const response = await fetch('/api/community/join', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ eventId, paymentStatus }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.message || '报名服务暂时不可用。')
    error.code = payload.code || `join-http-${response.status}`
    throw error
  }
  return payload
}

export function saveCommunityData(data) {
  if (!db) return Promise.resolve()
  return setDoc(doc(db, 'communities', COMMUNITY_ID), data, { merge: true })
}

export function saveCommunityMeta(data) {
  if (!db) return Promise.resolve()
  return setDoc(doc(db, 'communityMeta', COMMUNITY_ID), data, { merge: true })
}

export function saveCommunityAccess(data) {
  if (!db) return Promise.resolve()
  return setDoc(doc(db, 'communityAccess', COMMUNITY_ID), data, { merge: true })
}

export function createInviteCodeRecord(code, inviter) {
  if (!db) return Promise.resolve()
  const inviteRef = doc(db, 'inviteCodes', code.trim().toUpperCase())
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(inviteRef)
    if (snapshot.exists()) throw new Error('invite-code-exists')
    transaction.set(inviteRef, {
      status: 'active',
      createdByUid: inviter.uid,
      createdByName: inviter.name,
      createdAt: serverTimestamp(),
    })
  })
}

export function saveUserData(uid, data) {
  if (!db || !uid) return Promise.resolve()
  return setDoc(doc(db, 'communities', COMMUNITY_ID, 'users', uid), data, { merge: true })
}

export function saveCommunityProfile(uid, profile) {
  if (!db || !uid) return Promise.resolve()
  return setDoc(doc(db, 'communities', COMMUNITY_ID, 'profiles', uid), {
    nickname: profile.nickname,
    bio: profile.bio,
    initials: profile.initials,
    color: profile.color,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export function getFirebaseAuthErrorMessage(error) {
  const code = error?.code || error?.message
  const messages = {
    'auth/invalid-credential': '邮箱或密码不正确。',
    'auth/wrong-password': '邮箱或密码不正确。',
    'auth/invalid-email': '请输入有效的邮箱地址。',
    'auth/email-already-in-use': '这个邮箱已经注册过了，请直接登录。',
    'auth/weak-password': '密码至少需要 6 位。',
    'auth/user-not-found': '没有找到这个邮箱对应的账号。',
    'auth/user-disabled': '这个账号已被 Firebase 禁用，请检查 Authentication 用户列表。',
    'auth/too-many-requests': '尝试次数过多，请稍后再试。',
    'auth/network-request-failed': '网络连接失败，请检查网络后再试。',
    'auth/operation-not-allowed': 'Firebase 尚未开启 Email/Password 登录，请到 Authentication → Sign-in method 开启。',
    'auth/invalid-api-key': 'Firebase API Key 无效，请检查 Vercel 中的 VITE_FIREBASE_API_KEY。',
    'auth/invalid-app-id': 'Firebase App ID 无效，请检查 Vercel 中的 VITE_FIREBASE_APP_ID。',
    'auth/app-not-authorized': '当前网站未被 Firebase 授权，请检查 Firebase Web App 配置。',
    'auth/unauthorized-domain': '当前网站域名未加入 Firebase Authorized domains。',
    'auth/internal-error': 'Firebase 服务内部错误，请检查线上环境变量后重新部署。',
    'auth/member-not-registered': '该账号尚未通过社群邀请码注册，请先注册后再登录。',
    'auth-required': '请先登录后再报名。',
    'admin-required': '只有管理员可以执行此操作。',
    'event-required': '请选择要报名的场次。',
    'event-sold-out': '这场已经满员。',
    'cancellation-not-found': '取消报名申请不存在。',
    'cancellation-already-reviewed': '这条取消报名申请已经处理过了。',
    'invalid-cancellation-review': '取消申请审核参数无效。',
    'permission-denied': 'Firebase 权限不足，请发布最新 firestore.rules。',
    'firebase-not-configured': 'Firebase 尚未配置，请先填写 .env.local。',
    'invalid-invite-code': '邀请码不正确，请向管理员确认后再试。',
    'invite-code-exists': '这个邀请码已经存在，请换一个新的。',
  }
  return messages[code] || `登录失败（${code || '未知错误'}），请检查 Firebase 配置。`
}
