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
import { collection, doc, getDoc, getFirestore, onSnapshot, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'

const COMMUNITY_ID = 'at-club'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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
  const configuredOwnerUid = (import.meta.env.VITE_FIREBASE_OWNER_UID || '').trim()
  const configuredOwnerEmail = (import.meta.env.VITE_FIREBASE_OWNER_EMAIL || '').trim().toLowerCase()
  const token = await user.getIdTokenResult(true)
  const claimRole = String(token.claims.role || '').toLowerCase()
  if (
    token.claims.owner === true
    || claimRole === 'owner'
    || user.uid === configuredOwnerUid
    || user.email?.trim().toLowerCase() === configuredOwnerEmail
  ) return true

  const [profileSnapshot, accessSnapshot] = await Promise.all([
    getDoc(doc(db, 'communities', COMMUNITY_ID, 'profiles', user.uid)),
    getDoc(doc(db, 'communityAccess', COMMUNITY_ID)),
  ])
  return profileSnapshot.exists() || accessSnapshot.data()?.ownerUid === user.uid
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
    const invitation = await redeemInviteCode(inviteCode, credential.user, { name })
    return { ...credential, invitation }
  } catch (error) {
    await deleteUser(credential.user)
    throw error
  }
}

export async function getFirebaseOwnerStatus(user) {
  if (!user) return false
  const token = await user.getIdTokenResult(true)
  if (token.claims.owner === true || String(token.claims.role || '').toLowerCase() === 'owner') return true
  if (user.uid === (import.meta.env.VITE_FIREBASE_OWNER_UID || '').trim()) return true
  if (user.email?.trim().toLowerCase() === (import.meta.env.VITE_FIREBASE_OWNER_EMAIL || '').trim().toLowerCase()) return true
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
    'auth/invalid-email': '请输入有效的邮箱地址。',
    'auth/email-already-in-use': '这个邮箱已经注册过了，请直接登录。',
    'auth/weak-password': '密码至少需要 6 位。',
    'auth/user-not-found': '没有找到这个邮箱对应的账号。',
    'auth/too-many-requests': '尝试次数过多，请稍后再试。',
    'auth/network-request-failed': '网络连接失败，请检查网络后再试。',
    'auth/member-not-registered': '该账号尚未通过社群邀请码注册，请先注册后再登录。',
    'permission-denied': 'Firebase 权限不足，请发布最新 firestore.rules。',
    'firebase-not-configured': 'Firebase 尚未配置，请先填写 .env.local。',
    'invalid-invite-code': '邀请码不正确，请向管理员确认后再试。',
    'invite-code-exists': '这个邀请码已经存在，请换一个新的。',
  }
  return messages[code] || '登录服务暂时不可用，请稍后再试。'
}
