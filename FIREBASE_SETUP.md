# Firebase 配置

## 1. 创建 Firebase 项目

在 Firebase 控制台创建项目，并添加一个 Web App。复制 Web App 的配置值到项目根目录的 `.env.local`：

```env
VITE_FIREBASE_API_KEY=你的 apiKey
VITE_FIREBASE_AUTH_DOMAIN=你的 authDomain
VITE_FIREBASE_PROJECT_ID=你的 projectId
VITE_FIREBASE_STORAGE_BUCKET=你的 storageBucket
VITE_FIREBASE_MESSAGING_SENDER_ID=你的 messagingSenderId
VITE_FIREBASE_APP_ID=你的 appId
VITE_FIREBASE_OWNER_UID=你的 Firebase 用户 UID
VITE_FIREBASE_OWNER_EMAIL=你的 Owner 登录邮箱
```

`.env.local` 不要提交到 GitHub。仓库里的 `.env.example` 只是一份字段模板。

## 2. 打开登录方式

Firebase Console → Authentication → Sign-in method → 启用 `Email/Password`。

朋友打开网站后，从登录页使用邮箱、密码和社群邀请码注册；注册成功后，账号会由 Firebase Authentication 管理。

## 3. 创建 Firestore

Firebase Console → Firestore Database → Create database。创建完成后，将仓库里的 `firestore.rules` 发布到 Firestore Rules。

当前版本同步：

- 社群公共数据：活动、成员、全员消息、私聊、动态、取消报名审核
- 当前用户数据：已报名场次、个人日程、消息已读状态、通知
- 公共个人名片：昵称、个人简介和头像展示信息；成员只能修改自己的名片

## 4. 设置所有者与管理员

管理员不是由前端成员资料里的“管理员”文字决定，而是由 `communityAccess/at-club` 和 Firebase Custom Claim 共同保护。

第一次部署时，只给你的 Firebase 用户设置 `owner: true`：

```js
await getAuth().setCustomUserClaims('你的 Firebase 用户 UID', {
  owner: true,
  admin: true,
})
```

设置后，让你的账号退出并重新登录一次。首次进入后，应用会初始化社群所有者记录。之后打开：

`社群设置 → 设置管理员`

只有所有者能设置或取消管理员；管理员不能修改管理员名单。管理员可以发放一次性邀请码、查看成员数据和审核取消报名，但不能查看密码。Firestore 规则会阻止普通用户读取其他人的个人文档。

成员页面上的 `owner`、`administrator` 和 `member` 标识由 `communityAccess/at-club` 的所有者和管理员名单计算，不能通过修改个人名片伪造。请同时发布最新的 `firestore.rules`，否则云端名片保存不会生效。

不要在浏览器端使用 Firebase Admin SDK，也不要把 Service Account 私钥放进 Vite 环境变量。

## 5. 本地运行

```bash
npm install
npm run dev
```

没有 `.env.local` 时，应用会继续使用现有的本地演示模式；配置完成后，登录页会自动切换到 Firebase。

## 6. 部署到 Vercel

导入 GitHub 仓库 `zhangchuman1029-debug/Tshirt`，构建配置使用：

- Build Command: `npm run build`
- Output Directory: `dist`

在 Vercel Project Settings → Environment Variables 中加入上面的 6 个 `VITE_FIREBASE_*` 变量，然后重新部署。
