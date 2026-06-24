# CRM System

内部客户关系管理系统 — Next.js + TypeScript + Tailwind CSS，部署于 Cloudflare Pages / Workers，数据存储于 Cloudflare D1。

## 当前阶段：Phase 7.1

在 Phase 7 基础上加固自动回收规则：

- 自动回收：`status=active` 且 `owner_id` 非空，连续 8 天无有效跟进 → 强制回收到公共池
- **排除销售阶段**：`closed_won`、`closed_lost`、`invalid`、`on_hold` 不参与预警与回收
- 提前预警：第 6 天、第 7 天向当前负责人发送通知（同日同客户不重复）
- Admin 手动触发：`POST /api/admin/reclamation/run`
- Cloudflare Cron Worker：`workers/reclamation-cron.ts`

**尚未实现**：审批中心、报表、导入导出、完整多语言、客户热度评分（Phase 8+）。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 App Router、React 19、Tailwind CSS 4 |
| 部署 | `@opennextjs/cloudflare`、Cloudflare Workers |
| 数据库 | Cloudflare D1、Drizzle ORM |
| 认证 | 自研 Session + PBKDF2（Workers 兼容） |
| 预留 | R2 附件、Turnstile 登录验证 |

## 快速开始（本地）

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

### 测试账号（seed）

| 角色 | 邮箱 | 密码 |
|------|------|------|
| Admin | `admin@crm.local` | `Admin123!` |
| Staff A | `staff-a@crm.local` | `StaffA123!` |
| Staff B | `staff-b@crm.local` | `StaffB123!` |

### 测试客户 ID（seed）

| 客户 | ID |
|------|-----|
| Staff A 名下 | `22222222-2222-2222-2222-222222222201` |
| Staff B 名下 | `22222222-2222-2222-2222-222222222202` |
| 公共池 | `22222222-2222-2222-2222-222222222203` |

### 自动回收测试客户（`npm run db:seed:reclamation:local`）

| 客户 | ID | 预期 |
|------|-----|------|
| 6 天未跟进 | `22222222-2222-2222-2222-222222222204` | Day 6 预警 |
| 7 天未跟进 | `22222222-2222-2222-2222-222222222205` | Day 7 预警 |
| 8 天未跟进 | `22222222-2222-2222-2222-222222222206` | 自动回收 |
| 最近已跟进 | `22222222-2222-2222-2222-222222222207` | 无动作 |
| closed_won 10 天 | `22222222-2222-2222-2222-222222222208` | 不预警、不回收 |
| closed_lost 10 天 | `22222222-2222-2222-2222-222222222209` | 不预警、不回收 |

## Phase 7 自动回收测试

```bash
npm run db:migrate:local
npm run db:seed:local
npm run db:seed:reclamation:local
npm run dev
```

### 1. 登录

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"Admin123!"}'
```

### 2. 触发自动回收检查

```bash
curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/admin/reclamation/run
```

预期结果（首次运行）：

| 场景 | 客户 ID | 预期 |
|------|---------|------|
| 6 天未有效跟进 | `...204` | `warningsDay6Count` +1，生成 Day 6 通知与审计 |
| 7 天未有效跟进 | `...205` | `warningsDay7Count` +1，生成 Day 7 通知与审计 |
| 8 天未有效跟进 | `...206` | `reclaimedCount` +1，进入 `public_pool` |
| 最近有效跟进 | `...207` | 无动作 |
| 公共池客户 | `...203` | 不参与（无 owner） |
| closed_won 10 天 | `...208` | 保持原 owner，不预警、不回收 |
| closed_lost 10 天 | `...209` | 保持原 owner，不预警、不回收 |

### 3. 验证 closed_won / closed_lost 未被回收

```bash
npx wrangler d1 execute crm-db --local --command \
  "SELECT id, sales_stage, status, owner_id FROM customers WHERE id IN ('22222222-2222-2222-2222-222222222208','22222222-2222-2222-2222-222222222209');"

npx wrangler d1 execute crm-db --local --command \
  "SELECT action, entity_id FROM audit_logs WHERE entity_id IN ('22222222-2222-2222-2222-222222222208','22222222-2222-2222-2222-222222222209') AND action LIKE 'customer.auto_reclaim%';"
```

应看到两条客户仍为 `active` 且 `owner_id` 不变；审计查询结果为空。

### 4. 权限校验

```bash
# Staff → 403
curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/admin/reclamation/run

# 未登录 → 401
curl -s -X POST http://localhost:3000/api/admin/reclamation/run
```

### 5. 验证通知与审计

```bash
npx wrangler d1 execute crm-db --local --command \
  "SELECT type, title, user_id FROM notifications ORDER BY created_at DESC LIMIT 10"

npx wrangler d1 execute crm-db --local --command \
  "SELECT action, entity_id, metadata FROM audit_logs WHERE action LIKE 'customer.auto_reclaim%' ORDER BY created_at DESC LIMIT 10"
```

### Cloudflare Cron（生产）

主应用 Worker（OpenNext）不直接挂载 `scheduled` 处理器。已提供独立 Cron Worker：

| 文件 | 说明 |
|------|------|
| `workers/reclamation-cron.ts` | 每日执行 `runReclamationCheck` |
| `wrangler.cron.jsonc` | Cron 表达式 `0 5 * * *` |

**时区说明（上线前请确认）：**

- Cloudflare Cron 使用 **UTC** 时间。
- 当前配置 `0 5 * * *` = **每天 UTC 05:00**（北京时间 / 香港时间 / 台湾时间 = **13:00**）。
- 若目标为 **中国 / 香港 / 台湾早上 05:00**，应改为 `0 21 * * *`（UTC 21:00 = 次日本地 05:00）。
- 部署前请与业务方确认执行时区，再调整 `wrangler.cron.jsonc` 中的 cron 表达式。

```bash
npm run cron:deploy
```

也可使用外部 Cron 定时调用 `POST /api/admin/reclamation/run`（需 Admin 会话或后续改为 Service Token）。

### 1. 登录并保存 Cookie

```bash
# Admin
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"Admin123!"}'

# Staff A
curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'

# Staff B
curl -s -c /tmp/crm-staff-b.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff-b@crm.local","password":"StaffB123!"}'
```

### 2. Admin 权限（应全部 full / isMasked=false）

```bash
CUST_A=22222222-2222-2222-2222-222222222201
CUST_B=22222222-2222-2222-2222-222222222202
CUST_POOL=22222222-2222-2222-2222-222222222203

curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/debug/customer-access/$CUST_A
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/debug/customer-access/$CUST_B
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/debug/customer-access/$CUST_POOL
```

### 3. Staff A 权限

```bash
# 自己的客户 → full
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/debug/customer-access/$CUST_A

# Staff B 客户 → 403 permission denied
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/debug/customer-access/$CUST_B

# 公共池 → masked（无 phone/wechat/email/notes）
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/debug/customer-access/$CUST_POOL
```

### 4. Staff B 权限

```bash
curl -s -b /tmp/crm-staff-b.txt http://localhost:3000/api/debug/customer-access/$CUST_B   # full
curl -s -b /tmp/crm-staff-b.txt http://localhost:3000/api/debug/customer-access/$CUST_A   # 403
```

### 5. 未登录

```bash
curl -s http://localhost:3000/api/debug/auth-check          # 401
curl -s http://localhost:3000/api/debug/customer-access/$CUST_A  # 401
```

### 6. 验证 audit_logs

```bash
npx wrangler d1 execute crm-db --local --command \
  "SELECT action, entity_type, entity_id, user_id FROM audit_logs WHERE action LIKE 'permission.%' ORDER BY created_at DESC LIMIT 10"
```

期望看到：`permission.denied.customer_access`、`permission.denied.unauthenticated`。

## 客户访问规则摘要

| 场景 | Admin | Staff（负责人） | Staff（非负责人） |
|------|-------|----------------|------------------|
| 自己名下客户 | 完整 | 完整 | 拒绝 |
| 他人名下客户 | 完整 | 拒绝 | 拒绝 |
| 公共池客户 | 完整 | 脱敏 | 脱敏 |
| 公共池原释放人 | 完整 | 脱敏（不得看完整） | 脱敏 |

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 本地开发 |
| `npm run build` | 生产构建 |
| `npm run db:migrate:local` | 本地迁移 |
| `npm run db:seed:local` | 初始化测试账号与客户 |
| `npm run db:seed:reclamation:local` | 注入自动回收测试客户 |
| `npm run cron:deploy` | 部署自动回收 Cron Worker |
| `npm run deploy` | 部署到 Cloudflare |

## 环境变量

详见 [docs/ENV.md](./docs/ENV.md)。

## 备份与回滚

```bash
git checkout backup-before-d1-migration
git checkout main
```
