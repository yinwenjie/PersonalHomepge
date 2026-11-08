# Phase 2.4 付费权益（entitlement）设计

状态：设计稿，待确认。本文只定方案，不包含运行时代码、migration、支付账号或部署。收哪些功能的钱、定价和支付服务商需要你决定（第 9 节）。

## 背景

`backlog/AccountHomeSyncBacklog.md` 把“账号绑定的支付客户和权益”列为 Phase 2 的 P0。现在唯一和付费有关的是首页文档里的占位字段 `billing: { plan: "free", stripeCustomerId: null }`（`src/domain/home-document.ts`）。首页文档由浏览器写入、可以导入导出，所以它**不能**作为付费状态的来源。

本文定的是“系统怎么知道一个账号付没付费、能用什么”，不定具体卖什么。

## 结论摘要

| 问题 | 决定 |
|---|---|
| 付费状态存在哪 | 服务端新表 `entitlements`，一个账号一行；没有行就是免费 |
| 谁能写 | 只有支付服务商的 webhook（Edge Function，service role）；前端只能读自己的 |
| 前端怎么读 | RPC `get_my_entitlement()`，返回生效中的套餐和额度 |
| 额度怎么定义 | 套餐 → 额度的对照表放在代码里，前后端各一份，由测试保证一致 |
| 额度在哪里强制 | 需要限制的 RPC 在服务端检查，前端只负责显示和提示 |
| 支付服务商 | 表结构不绑定服务商；默认按 Stripe Checkout + Customer Portal 设计（待确认） |
| 首页文档里的 `billing` | 不再读写，导入时忽略，保留类型只为兼容旧数据 |
| 和账号删除的关系 | 删除前先取消订阅；本地付费记录随账号删除，服务商那边的发票按法律要求保留 |

## 1. 原则

1. 付费状态只来自服务端，浏览器传来的任何套餐信息都不信。
2. 没有付费功能前，所有账号都是免费，行为和现在一样。
3. 降级不删数据：付费到期后超出免费额度的内容只读保留，不自动删除。
4. 不登录的用户永远是免费，不需要也不能付费。

## 2. 数据表（第一个计费 migration）

### `entitlements`

| 列 | 说明 |
|---|---|
| `user_id` | 主键，→ `auth.users`，cascade |
| `plan` | `free` / `pro`（以后可加） |
| `status` | `active` / `trialing` / `past_due` / `canceled` |
| `provider` | `stripe` 等 |
| `provider_customer_id`、`provider_subscription_id` | 服务商的客户和订阅 id，唯一 |
| `current_period_end` | 本期到期时间 |
| `cancel_at_period_end` | 是否到期后取消 |
| `updated_at` | 最近一次 webhook 更新时间 |

RLS：用户只能 `select` 自己的行；没有任何前端写权限。

### `billing_webhook_events`

| 列 | 说明 |
|---|---|
| `provider` + `event_id` | 唯一，用来去重，重复投递直接忽略 |
| `event_type` | 事件类型 |
| `user_id_hash` | 关联账号的 `sha256(user_id)`，不存邮箱 |
| `received_at`、`processed_at`、`error_code` | 处理状态 |

不存事件原文（原文里有邮箱和地址）。只有 service role 能读写。

### 生效套餐的计算

`get_my_entitlement()` 返回 `pro` 的条件：`status` 是 `active` 或 `trialing`，且 `current_period_end` 加 3 天宽限期还没过。`past_due` 在宽限期内仍算付费，给扣款重试留时间。其他情况一律 `free`。

## 3. 额度

套餐到额度的对照表放在 `src/domain/plan-limits.ts`，服务端 SQL 函数 `plan_limit(plan, key)` 返回同样的值，CI 里有测试比对两边。

下面只是**候选**，卖哪几项、免费版给多少由你定：

| key | 现在的值（相当于免费版） | 可能的付费版 |
|---|---|---|
| `cloud_history_limit` | 每个空间 50 份云端历史（013） | 更多 |
| `account_space_limit` | 现在没有限制 | 免费版设上限 |
| `asset_max_bytes` | 单张图片 5 MB（012） | 更大 |
| `share_link_limit` | 现在没有限制 | 免费版设上限 |
| `rss_feed_limit` | 每个组件 5 个源（RSS 设计） | 更多 |

强制方式：

- 云端历史：快照清理函数按套餐保留份数。
- 空间数、分享数：新增空间、发布分享的 RPC 先查额度，超出返回 `plan_limit_reached`。
- 图片大小：Storage bucket 上限按付费版设，免费版的检查放在上传前的签名或 RPC 里。
- 前端遇到 `plan_limit_reached` 显示升级提示，不显示原始错误。

## 4. 购买和管理订阅

三个新 Edge Function：

| 函数 | 调用方 | 作用 |
|---|---|---|
| `billing-checkout` | 已登录用户（JWT） | 创建 Checkout 会话，`client_reference_id` 放 user id，返回跳转地址 |
| `billing-portal` | 已登录用户（JWT） | 创建 Customer Portal 会话，用户在服务商页面改卡、取消、看发票 |
| `billing-webhook` | 支付服务商 | 关闭 JWT 校验，改为校验服务商签名；去重后更新 `entitlements` |

用户付款后，前端回到设置页，轮询 `get_my_entitlement()` 直到套餐变化（最多 30 秒），之后正常显示。真正生效以 webhook 为准，不以跳转回来为准。

密钥（服务商 API key、webhook 签名密钥）只放在 Supabase secrets，按现有方式由你本人设置，不进仓库、不进聊天。

## 5. 设置页

- “账号”区块下新增“套餐”：显示当前套餐、到期时间、是否会自动续费。
- 免费用户显示“升级”，付费用户显示“管理订阅”（跳到 Customer Portal）。
- 未登录时不显示。

## 6. 首页文档里的 `billing` 字段

- 不再读取，也不再写入新值；`normalize` 时统一归一为免费占位。
- 导入的文档里带有任何 `billing` 值都忽略。
- 公开分享和导出本来就不需要它，确认投影里不包含。
- 下一次首页文档版本升级时再删除这个字段。

## 7. 和账号删除的关系

`Phase2_3_AccountDeletionDesign.md` 第 4 节第 3 步在删除前调用这里的逻辑：

1. 有生效中的订阅时，先在服务商那边立即取消；取消失败就停止删除并返回 `billing_cancel_failed`，不能出现“账号没了但还在扣钱”。
2. `entitlements` 行随 Auth 用户 cascade 删除。
3. `billing_webhook_events` 只有 user id 哈希，保留，用于对账。
4. 服务商那边的客户和发票按税务和会计要求保留，由服务商负责；删除说明里写明这一点。
5. 是否按剩余天数退款，见第 9 节。

## 8. 后台

只读后台的目标用户视图增加套餐、状态和到期时间（新的 `admin-read` 字段，沿用现有审计）。后台不能改套餐，退款和补偿都在服务商后台操作。

## 9. 待确认

1. **支付服务商**：默认按 Stripe 设计。如果你没有 Stripe 支持地区的公司或个人主体，或不想自己处理各国销售税，可以改用 Paddle、Lemon Squeezy 这类代收代缴（merchant of record）服务商；表结构不用改，只换三个函数的实现。
2. **卖什么**：第 3 节哪几项做成付费，免费版各给多少。
3. **价格和周期**：月付、年付或两者都有；是否有试用期。
4. **退款**：删除账号或主动取消时，是否按剩余天数退款。默认不退款、到期前照常可用。
5. **降级规则**：默认超出的内容只读保留。备选是给一段宽限期后按最旧的先清理。

## 10. 上线顺序

1. 账号删除先上线（Phase 2.3），因为收费后必须能删账号。
2. 本设计的表和 `get_my_entitlement()` 上线，所有人都是免费，前端显示“免费版”。
3. 选定服务商并在测试模式下接通 checkout、portal 和 webhook，用测试卡走完购买、续费失败、取消、删除账号四条路径。
4. 再上线额度检查和升级入口。每一步的 migration、函数部署和前端上线都要你确认。
