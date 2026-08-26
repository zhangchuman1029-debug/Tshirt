# XPay v1.7 支付宝转账码接入

本项目接入的是 XPay v1.7 的支付宝个人转账码流程，不是支付宝官方当面付，也不调用 `alipay-sdk`。用户通过支付宝向 XPay 配置的收款账号转账，XPay 管理员根据转账记录审核订单；审核通过后，本项目才完成 Firebase 报名。

## 1. 支付流程

1. 用户确认报名，本项目服务端验证 Firebase 登录、活动和金额。
2. 本项目调用 XPay `POST /pay/add`，提交 `nickName`、`money`、`email`、`payType=Alipay`、`info`、`custom=true`、`mobile` 和 `device`。
3. XPay 返回 `result.id`（XPay 订单号）和 `result.payNum`（四位支付标识）。
4. 本项目生成支付宝启动链接：`alipays://platformapi/startapp?appId=20000067&url=.../openAlipay`。
5. `openAlipay` 页面使用 v1.7 的支付宝转账码 scheme，用户按活动金额完成转账，并把 `payNum` 作为备注。
6. 前端轮询本项目 `GET /api/alipay/status`，本项目再调用 XPay `GET /pay/state/{xpayOrderId}`。
7. XPay 返回状态 `1` 或 `3` 后，本项目使用 Firestore 事务更新活动名额、用户报名、付款状态和个人日程。

## 2. 环境变量

前端：

```env
VITE_ALIPAY_ENABLED=true
VITE_ALIPAY_API_BASE_URL=/api/alipay
```

本项目服务端：

```env
XPAY_BASE_URL=https://你的XPay域名
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","...":"..."}
FIREBASE_PROJECT_ID=你的Firebase项目ID
```

`XPAY_BASE_URL` 不要带末尾 `/`。本地开发可以使用 `http://localhost:8888`；生产环境必须使用本项目服务端可以访问、且手机支付宝可以打开的公网 HTTPS 地址。本项目的 `/api/alipay/*` 需要部署到支持 Node.js Serverless Functions 的平台，Vite 静态服务器不会执行这些服务端接口。

## 3. XPay v1.7 的 userId 和收款账号

在 XPay 项目中配置支付宝 `userId`：

```text
/Users/pumpkin-tree/Downloads/xpay-3.1/xpay-code/src/main/resources/templates/openAlipay.html
```

修改文件中的：

```javascript
var userId = "你的支付宝userId";
```

这个 `userId` 对应转账码收款账号，也就是实际收款的支付宝账号。收款账号不是在本项目的 `pom.xml`、`.env` 或 Firebase 中确定的，而是在 XPay 的 `openAlipay.html` 中决定。转账备注使用 XPay 返回的 `payNum`，不要自行填写本项目订单号。

XPay 服务必须能从公网访问 `/openAlipay`，并且本项目服务端必须能访问 XPay。XPay 仍依赖它自己的数据库、缓存、邮件配置和 Spring Boot 运行环境。

## 4. XPay 状态与本项目接口

- `POST /api/alipay/create`：创建本地待支付订单，并代理 XPay `POST /pay/add`。
- `GET /api/alipay/status`：代理 XPay `GET /pay/state/{id}`，状态成功后完成本项目报名。
- `0`：等待中。
- `1`：支付成功。
- `2`：支付失败。
- `3`：审核通过但不显示。
- `4`：已扫码或已打开支付页面。
- `pending`：本项目仍在等待 XPay 确认。
- `scanning`：用户已打开或扫码，尚未确认转账。
- `paid`：XPay 已确认，且本项目已完成报名。
- `paid_but_unavailable`：已付款但活动名额已被占用，需要人工退款或改期。

## 5. 上线检查

1. 部署 XPay，并确认 `/pay/add`、`/pay/state/{id}` 和 `/openAlipay` 可访问。
2. 在 XPay 的 `openAlipay.html` 配置真实支付宝 `userId`。
3. 配置本项目的 `XPAY_BASE_URL`、Firebase Admin 服务账号和 `VITE_ALIPAY_ENABLED=true`。
4. 用测试账号创建订单，确认金额正确、转账备注为 XPay 返回的 `payNum`。
5. 在 XPay 管理后台审核转账，确认本项目状态变为 `paid`，并检查 Firebase 报名、名额和个人日程。

真实支付宝转账和 XPay 审核需要部署好的 XPay、Firebase 和支付宝环境；本地只能完成构建、接口格式和页面流程验证。
