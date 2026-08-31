const fs = require('node:fs')
const { cert, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
    return JSON.parse(fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_FILE, 'utf8'))
  }

  throw new Error(
    '请设置 FIREBASE_SERVICE_ACCOUNT_JSON 或 FIREBASE_SERVICE_ACCOUNT_FILE。',
  )
}

async function main() {
  const identifier = process.argv[2] || process.env.OWNER_UID || process.env.OWNER_EMAIL
  if (!identifier) {
    throw new Error('请传入 Firebase 用户 UID 或邮箱，例如：node scripts/set-owner-claim.cjs 用户UID')
  }

  const serviceAccount = loadServiceAccount()
  initializeApp({
    credential: cert(serviceAccount),
  })

  const user = identifier.includes('@')
    ? await getAuth().getUserByEmail(identifier)
    : await getAuth().getUser(identifier)

  await getAuth().setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    owner: true,
    admin: true,
    role: 'owner',
  })

  console.log(`Owner Claim 设置成功：${user.email || user.uid}`)
  console.log('请退出 Firebase 账号并重新登录，使新的 ID Token 生效。')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
