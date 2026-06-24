# CRM System

内部客户关系管理系统 — Next.js + TypeScript + Tailwind CSS，部署于 Cloudflare Pages / Workers，数据存储于 Cloudflare D1。

## 当前阶段：Phase 15A

上线前安全检查 + Cloudflare 部署准备（**未部署正式域名**）。

| 文档 | 说明 |
|------|------|
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 部署、迁移、生产 seed、Cron、回滚与备份 |
| [docs/PRE_LAUNCH_PERMISSION_CHECKLIST.md](./docs/PRE_LAUNCH_PERMISSION_CHECKLIST.md) | Admin/Staff/公共池/归档权限回归清单 |
| [docs/ENV.md](./docs/ENV.md) | 环境变量说明 |

**生产 seed：** 必须使用 `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`（禁止 `@crm.local`）；本地仍用 `admin@crm.local` / `Admin123!`。

**Turnstile：** 未启用（预留）。**Debug API：** 生产默认关闭。

---

## Phase 14（已完成）

| 功能 | 说明 |
|------|------|
| 客户热度 | `high` / `medium` / `low` / `silent` / `high_churn_risk` |
| 数据完整度 | 0–100 分，见 `/help` → 客户热度与数据完整度 |
| API | `GET /api/customers`、`GET /api/customers/:id` 含 `heatLevel`、`completenessScore` |
| 筛选 | `/customers?heat=high_churn_risk`、`?completenessBelow=60` |
| Dashboard | Admin/Staff KPI：流失高风险数、低完整度数（&lt; 60，不含归档） |

## Phase 14 客户评分测试

```bash
npm run dev
```

### 1. Admin

```bash
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/customers | jq '.items[0] | {heatLevel, completenessScore, heatReason, completenessMissingFields}'

curl -s -b /tmp/crm-admin.txt "http://localhost:3000/api/customers?heat=high_churn_risk" | jq '.total'
curl -s -b /tmp/crm-admin.txt "http://localhost:3000/api/customers?completenessBelow=60" | jq '.total'
```

访问 `/admin` 查看「流失高风险客户」「低完整度客户」KPI。

### 2. Staff

```bash
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/customers/CUSTOMER_ID | jq '.customer | {heatLevel, completenessScore, completenessMissingFields}'
# 自己的客户：可有 completenessMissingFields

curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/customers/POOL_ID | jq '.customer | {heatLevel, completenessScore, completenessMissingFields}'
# 公共池：completenessMissingFields 应为 null

curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" http://localhost:3000/api/customers/STAFF_B_CUSTOMER_ID
# 期望 403
```

### 3. 页面

- `/customers`：热度与完整度列 + 筛选表单
- `/customers/:id`：热度卡片、完整度卡片（full 权限显示缺失项）

---

## Phase 13 客户时间线测试

客户时间线 / 操作历史整合：

| 模块 | 说明 |
|------|------|
| **API** | `GET /api/customers/:id/timeline` |
| **详情页** | 客户详情底部「时间线」区域 |
| **数据源** | audit_logs、field_change_logs、follow_ups、tasks、approvals |
| **脱敏** | Staff 查看 public_pool / archived_basic 时隐藏敏感字段与跟进全文 |

**越权审计**：`permission.denied.customer_timeline_access`（查看时间线被拒时写入）

## Phase 13 客户时间线测试

```bash
npm run dev
```

### 1. 登录

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'
```

### 2. Admin 完整时间线

```bash
# 将 CUSTOMER_ID 换为 Staff A 的客户 ID
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/customers/CUSTOMER_ID/timeline | jq .
```

验证：`items` 按 `occurredAt` 倒序；含字段变更 `old_value`/`new_value`、跟进 `summary`、审批、公共池/自动回收等记录。

### 3. Staff A 自己的客户

```bash
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/customers/OWN_CUSTOMER_ID/timeline | jq .
```

### 4. Staff 越权 / 脱敏

```bash
# Staff B 的客户 → 403
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" \
  http://localhost:3000/api/customers/STAFF_B_CUSTOMER_ID/timeline

# 公共池客户 → 200，敏感字段变更显示「敏感字段已变更」，无 old/new
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/public-pool/customers | jq .
# 取公共池客户 ID 后：
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/customers/POOL_ID/timeline | jq .

# 未登录 → 401
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/customers/CUSTOMER_ID/timeline
```

### 5. 归档客户（Staff 负责人）

对已归档且 `ownerId` 为 Staff A 的客户：`accessLevel` 为 `archived_basic`，时间线为脱敏基础视图。

### 6. 页面

访问 `/customers/:id`，页面底部应显示可滚动时间线列表。

---

## Phase 12 通知 / 公告 / 帮助测试

通知中心 + 公告中心 + 帮助中心基础版：

| 模块 | 说明 |
|------|------|
| **通知中心** | `GET /api/notifications`、标记已读、未读数量、`/notifications` 页面 |
| **公告中心** | Admin 管理公告（`announcements` 表）、用户查看已发布公告 |
| **帮助中心** | `/help` 静态规则说明（权限、公共池、跟进、审批等） |
| **首页** | Admin / Staff 工作台展示最近 5 条通知、最近 3 条公告 |

**审计**：`notification.read` / `notification.read_all` / `announcement.*` / `permission.denied.announcement_manage`

## Phase 12 通知 / 公告 / 帮助测试

```bash
npm run db:migrate:local
npm run dev
```

### 1. 登录

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'
```

### 2. 通知中心

```bash
# 未登录 → 401
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/notifications

# 各自的通知列表
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/notifications | jq .
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/notifications | jq .

# 未读数量
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/notifications/unread-count | jq .

# 标记单条已读（将 :id 换为实际通知 ID）
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/notifications/NOTIFICATION_ID/read

# 全部已读
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/notifications/read-all | jq .
```

Staff 无法查看或标记 Admin 的通知（他人 ID → 403）。页面：`/notifications`；首页「最近通知」模块。

### 3. 公告中心

```bash
# Admin 创建草稿
curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/admin/announcements \
  -H 'Content-Type: application/json' \
  -d '{"title":"系统维护通知","content":"本周六维护。","audience":"all"}'

# 发布（将 :id 换为公告 ID）
curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/admin/announcements/ANN_ID/publish | jq .

# 用户查看已发布
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/announcements | jq .

# audience=admin 时 Staff 列表中不可见；audience=staff 时 Admin 不可见（按规则过滤）

# Staff 管理公告 → 403
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" http://localhost:3000/api/admin/announcements
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" -X POST http://localhost:3000/api/admin/announcements \
  -H 'Content-Type: application/json' -d '{"title":"x","content":"y","audience":"all"}'
```

页面：Admin `/admin/announcements`；用户 `/announcements`；首页「最新公告」。

### 4. 帮助中心

浏览器访问 `/help`（Admin / Staff 均可）。内容涵盖：系统说明、客户权限、公共池、跟进与有效跟进、自动回收、审批、导入导出、备份、联系管理员。

### 5. 审计

修改设置、读通知、公告发布后检查 `audit_logs` 含 `notification.read`、`notification.read_all`、`announcement.created` 等。

---

## Phase 11.1 系统设置接入测试

系统设置已接入核心业务逻辑（Admin 在 `/admin/settings` 修改后立即生效）：

| 配置项 | 接入位置 |
|--------|----------|
| `automatic_reclaim_days` / `reclaim_warning_day_1` / `reclaim_warning_day_2` | 自动回收引擎 `runReclamationCheck` |
| `public_pool_claim_quota_7_days` / `public_pool_claim_cooldown_hours` | 公共池领取校验 + `GET /api/public-pool/claim-status` |
| `first_contact_sla_hours` | 领取公共池客户后 `first_contact` 任务 `due_at` |
| `business_timezone` | Admin / Staff Dashboard 报表日期边界（`Asia/Shanghai` 或 `UTC`） |
| `inactivity_logout_minutes` | **仅保存**，尚未接入 session idle timeout（后续 Phase） |

**业务时区**：`business_timezone` 当前仅支持 `Asia/Shanghai`（UTC+8 日历日）与 `UTC`（UTC 日历日）。Admin 与 Staff Dashboard 共用同一设置。

**无操作登出**：`sessions` 表暂无 `last_activity` 字段，本阶段不改造 session 体系；`inactivity_logout_minutes` 可读写但不会影响登录态。

## Phase 11.1 系统设置接入测试

```bash
npm run dev
```

### 1. 登录

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'
```

### 2. 设置校验（无效值拒绝保存）

```bash
# 回收天数顺序错误：day_2 必须 > day_1，reclaim 必须 > day_2
curl -s -b /tmp/crm-admin.txt -w "\n%{http_code}\n" -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"reclaim_warning_day_1":"7","reclaim_warning_day_2":"6","automatic_reclaim_days":"8"}}'
# 期望 400

# 非法时区
curl -s -b /tmp/crm-admin.txt -w "\n%{http_code}\n" -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"business_timezone":"America/New_York"}}'
# 期望 400
```

### 3. 自动回收阈值

```bash
# 改为 10 天后，8 天未跟进客户不应被回收（需 seed 或手动构造客户后触发回收 cron/API）
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"automatic_reclaim_days":"10","reclaim_warning_day_1":"6","reclaim_warning_day_2":"7"}}'

# 预警改为第 4 / 5 天
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"reclaim_warning_day_1":"4","reclaim_warning_day_2":"5","automatic_reclaim_days":"8"}}'
```

触发回收：部署 `npm run cron:deploy` 或本地调用回收逻辑；验证通知/审计文案使用配置天数。

### 4. 公共池领取

```bash
# 7 天配额改为 2
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"public_pool_claim_quota_7_days":"2"}}'

curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/public-pool/claim-status | jq .
# 应显示 quotaLimit: 2

# 冷却改为 1 小时
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"public_pool_claim_cooldown_hours":"1"}}'
```

Staff 第 3 次领取（配额=2 时）应返回 429；领取 API 与 claim-status 均读取最新配置。

### 5. 首次联系 SLA

```bash
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"first_contact_sla_hours":"12"}}'
# 领取公共池客户后，tasks.due_at ≈ now + 12h
```

### 6. 报表时区

```bash
# UTC+8 业务日（默认）
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/admin/settings | jq .business_timezone

# 切换 UTC
curl -s -b /tmp/crm-admin.txt -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"settings":{"business_timezone":"UTC"}}'
# Admin / Staff Dashboard「今日待办」等 KPI 按 UTC 日历日统计
```

### 7. 权限与审计

```bash
# Staff 不能改设置
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' -d '{"settings":{"automatic_reclaim_days":"9"}}'
# 期望 403

# Admin 修改后 audit_logs 含 system_settings.updated
```

---

## Phase 11 用户管理与系统设置测试

```bash
npm run dev
```

### 1. Admin 用户管理

```bash
# 登录
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

# 用户列表（无 password_hash）
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/admin/users | jq .

# 创建 Staff
curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/admin/users \
  -H 'Content-Type: application/json' \
  -d '{"name":"测试员工","email":"test-staff@crm.local","role":"staff","temporaryPassword":"TestStaff1"}'

# 停用 / 启用 / 重置密码 / 解锁 — 见 /admin/users 页面或对应 API
```

### 2. Staff 拒绝

```bash
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" http://localhost:3000/api/admin/users
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" http://localhost:3000/api/admin/login-logs
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" -X PATCH http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' -d '{"settings":{"automatic_reclaim_days":"9"}}'
# 期望 403
```

### 3. 登录记录与设置

```bash
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/admin/login-logs | jq .
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/admin/settings | jq .
```

停用或重置密码后，该用户 **sessions 表记录被删除**，下次请求需重新登录。

---

## Phase 10C 数据库自动备份

- `POST /api/admin/backups/run` — 手动触发 JSON 备份
- `GET /api/admin/backups` — 最近 50 条 `backup_jobs`（不含 `storage_key`）
- 存储：生产写 R2 `ATTACHMENTS` binding；本地开发失败时回退至 `.local-backups/`
- 定时：`workers/backup-cron.ts`，Cron `0 21 * * *` UTC = **UTC+8 每天 05:00**
- 失败时通知所有 Admin（`backup_failed`）
- 审计：`backup.started` / `backup.completed` / `backup.failed`

**尚未实现**：一键恢复、自动清理旧备份、备份加密（后续 Phase）。

### 敏感字段与排除表

| 范围 | 说明 |
|------|------|
| **users** | 导出除 `password_hash` 外的字段 |
| **sessions** | **整表不备份**（含 `token_hash`） |
| 其他业务表 | 全量备份 |

### 本地与生产差异

| 环境 | 存储 | 说明 |
|------|------|------|
| 生产 | R2 `backups/crm-backup-{UTC+8时间}.json` | `npm run cron:backup:deploy` 部署定时 Worker |
| 本地 dev | 优先 R2 preview bucket；失败则 `.local-backups/` | 模拟失败：`BACKUP_FORCE_FAIL=1` |

### 恢复说明（本阶段不提供一键恢复）

1. **找到最近备份**：Admin 访问 `/admin/backups` 或查 `backup_jobs` 表 / R2 `backups/` 前缀
2. **下载备份文件**：从 Cloudflare R2 控制台或 `wrangler r2 object get crm-attachments/backups/crm-backup-....json --file=backup.json`
3. **测试环境验证**：在测试 D1 环境解析 JSON，核对 `tables` 与 `metadata.recordCount`
4. **恢复生产前**：必须先对当前生产库再做一次手动备份
5. **一键恢复**：后续 Phase 实现；当前仅备份 + 文档，**禁止**在未验证脚本的情况下直接覆盖生产数据

## Phase 10C 备份测试

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

### 1. Admin 手动备份

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/admin/backups/run | jq .
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/admin/backups | jq .
```

验证：`backup_jobs.status=completed`，`audit_logs` 含 `backup.started` / `backup.completed`，JSON 中 `users` 无 `password_hash`。

### 2. Staff 拒绝

```bash
curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'

curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" -X POST http://localhost:3000/api/admin/backups/run
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" http://localhost:3000/api/admin/backups
# 期望 403；audit_logs 含 permission.denied.backup_run
```

### 3. 失败通知

```bash
BACKUP_FORCE_FAIL=1 npm run dev
# 再次 POST /api/admin/backups/run → 500，backup_jobs failed，Admin 收到 backup_failed 通知
```

### 4. Cron 定时备份

- 表达式：`0 21 * * *`（UTC）= UTC+8 每日 05:00
- 部署：`npm run cron:backup:deploy`
- 本地测试：`npx wrangler dev -c wrangler.backup-cron.jsonc --test-scheduled`

Cron 备份：`backup_type=scheduled`，`triggered_by=null`。

---

## Phase 10B.1 导出安全加固

- **Staff 默认不能导出**（API / 页面均 403）
- **fields 白名单**：仅允许 18 个明确字段；未知字段 → 400 `invalid_export_field`
- **敏感字段**：phone / wechat_id / email / notes / source_remark
- **includeSensitive=false** 时强制排除敏感列，无法通过 `fields` 参数绕过
- **Admin 高风险导出**（`includeSensitive=true` 或 `scope=all|archived`）需前端二次确认
- 审计 `customers.exported` 记录 **riskLevel**（low / medium / high）

**尚未实现**：备份恢复、Staff 授权导出（Phase 10C+）。

## Phase 10B.1 导出安全测试

```bash
npm run dev
# 需已登录 Admin cookie：/tmp/crm-admin.txt
```

### 1. 字段白名单

```bash
# 未知字段 → 400 invalid_export_field，不导出，写入 customers.export.failed
curl -s -b /tmp/crm-admin.txt -w "\n%{http_code}\n" \
  "http://localhost:3000/api/export/customers?scope=all_active&fields=id,customer_name,secret_field"
```

### 2. 敏感字段无法绕过

```bash
# includeSensitive=false + 手动指定 phone,email → CSV 表头不含 phone/email
curl -s -b /tmp/crm-admin.txt -o /tmp/export-no-bypass.csv \
  "http://localhost:3000/api/export/customers?scope=all_active&includeSensitive=false&fields=id,customer_name,phone,email,wechat_id"
head -1 /tmp/export-no-bypass.csv

# includeSensitive=true → 含敏感字段
curl -s -b /tmp/crm-admin.txt -o /tmp/export-with-sensitive.csv \
  "http://localhost:3000/api/export/customers?scope=all_active&includeSensitive=true"
head -1 /tmp/export-with-sensitive.csv
```

### 3. 权限与前端确认

- Staff 访问 `GET /api/export/customers` → 403
- Admin 在 `/export/customers` 选择「包含敏感字段」或 scope=`全部`/`归档` 时，点击导出弹出风险确认，勾选后才能下载
- `scope=all_active` 且 `includeSensitive=false` 时无需二次确认

### 4. riskLevel 审计

成功导出后 `audit_logs.metadata` 应含 `riskLevel`：

| 条件 | riskLevel |
|------|-----------|
| includeSensitive=false 且 scope=all_active | low |
| includeSensitive=false 且 scope=all 或 archived | medium |
| includeSensitive=true | high |

`riskLevel` 目前仅记录在 `audit_logs`（`export_jobs` 表无专用列）。

---

## Phase 10B 客户导出测试

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

### 1. 登录

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'
```

### 2. 权限

```bash
# Admin 导出 active → 200
curl -s -b /tmp/crm-admin.txt -o /tmp/export-active.csv \
  "http://localhost:3000/api/export/customers?scope=all_active" && head -1 /tmp/export-active.csv

# Admin 各 scope
curl -s -b /tmp/crm-admin.txt -o /tmp/export-pool.csv \
  "http://localhost:3000/api/export/customers?scope=public_pool"
curl -s -b /tmp/crm-admin.txt -o /tmp/export-archived.csv \
  "http://localhost:3000/api/export/customers?scope=archived"
curl -s -b /tmp/crm-admin.txt -o /tmp/export-all.csv \
  "http://localhost:3000/api/export/customers?scope=all"

# Staff → 403
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" \
  "http://localhost:3000/api/export/customers?scope=all_active"

# 未登录 → 401
curl -s -w "\n%{http_code}\n" \
  "http://localhost:3000/api/export/customers?scope=all_active"
```

浏览器：Admin 访问 `/export/customers` 可导出；Staff 访问返回 403。

### 3. CSV 与敏感字段

```bash
# 含敏感字段（默认）
curl -s -b /tmp/crm-admin.txt -o /tmp/export-sensitive.csv \
  "http://localhost:3000/api/export/customers?scope=all_active&includeSensitive=true"
head -1 /tmp/export-sensitive.csv
# 表头应含 phone,wechat_id,email

# 不含敏感字段
curl -s -b /tmp/crm-admin.txt -o /tmp/export-masked.csv \
  "http://localhost:3000/api/export/customers?scope=all_active&includeSensitive=false"
head -1 /tmp/export-masked.csv
# 表头不应含 phone,wechat_id,email,source_remark
```

验证：UTF-8 BOM、中文正常、文件名 `customers-export-YYYY-MM-DD.csv`（业务时区 UTC+8）。

### 4. 审计与 export_jobs

成功导出后检查：

- `audit_logs` 含 `customers.exported`，metadata 含 scope、includeSensitive、fields、exportedCount、fileName
- `export_jobs` 有 `status=completed` 记录，`exported_count` 与 CSV 数据行数一致

Staff 被拒绝时 `audit_logs` 含 `permission.denied.export_customers`。

---

## Phase 10A.1 导入默认值与 commit 安全测试

### 1. 默认值（warning 不阻止导入）

```bash
cat > /tmp/import-defaults.csv <<'EOF'
customer_name,customer_type,phone_country_code,phone,wechat_id,email,source,source_remark,notes,sales_stage
默认字段客户,,,13900007777,,defaults@test.com,referral,,仅填必填项,
EOF

PRECHECK=$(curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/import/customers/precheck \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-defaults.csv),\"fileName\":\"import-defaults.csv\"}")

echo "$PRECHECK" | jq '{validRows, invalidRows, warnings}'
# 期望：validRows=1，invalidRows=0，warnings 含 default_customer_type / default_phone_country_code / default_sales_stage

JOB_ID=$(echo "$PRECHECK" | jq -r .jobId)
curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/import/customers/commit \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-defaults.csv),\"jobId\":\"$JOB_ID\"}" | jq .
# 期望：importedCount=1；客户 sales_stage=new_lead, customer_type=individual, phone_country_code=+86
```

### 2. error 阻止导入

```bash
cat > /tmp/import-bad.csv <<'EOF'
customer_name,customer_type,phone_country_code,phone,wechat_id,email,source,source_remark,notes,sales_stage
,individual,+86,13900006666,,bad@test.com,referral,,缺名称,new_lead
EOF

BAD=$(curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/import/customers/precheck \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-bad.csv)}")
BAD_JOB=$(echo "$BAD" | jq -r .jobId)

curl -s -b /tmp/crm-admin.txt -w "\n%{http_code}\n" -X POST http://localhost:3000/api/import/customers/commit \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-bad.csv),\"jobId\":\"$BAD_JOB\"}"
# 期望：400，code=job_has_errors 或 precheck_has_errors
```

### 3. commit 安全

```bash
# 重复 commit 已完成 job → 409 job_already_completed
curl -s -b /tmp/crm-admin.txt -w "\n%{http_code}\n" -X POST http://localhost:3000/api/import/customers/commit \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-defaults.csv),\"jobId\":\"$JOB_ID\"}"

# Staff commit Admin job → 403
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" -X POST http://localhost:3000/api/import/customers/commit \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-defaults.csv),\"jobId\":\"$JOB_ID\"}"

# 不存在 job → 404
curl -s -b /tmp/crm-admin.txt -w "\n%{http_code}\n" -X POST http://localhost:3000/api/import/customers/commit \
  -H 'Content-Type: application/json' \
  -d '{"csvText":"customer_name,source\nX,referral","jobId":"00000000-0000-0000-0000-000000000000"}'
```

---

## Phase 10A 客户导入测试

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

### 1. 登录

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'
```

### 2. 权限

```bash
# Admin 下载模板 → 200
curl -s -b /tmp/crm-admin.txt -o /tmp/template.csv \
  http://localhost:3000/api/import/customers/template && head -2 /tmp/template.csv

# Staff 下载模板 → 403
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" \
  http://localhost:3000/api/import/customers/template

# 未登录 → 401
curl -s -w "\n%{http_code}\n" http://localhost:3000/api/import/customers/template
```

浏览器：Admin 访问 `/import/customers` 正常；Staff 访问返回 403。

### 3. 预检（字段与重复）

```bash
# 合法行 + 多种错误（名称空、双联系方式空、手机号、email、source、重复等）
cat > /tmp/import-test.csv <<'EOF'
customer_name,customer_type,phone_country_code,phone,wechat_id,email,source,source_remark,notes,sales_stage
导入测试客户A,individual,+86,13900001001,import_a,import-a@test.com,referral,,备注A,new_lead
,individual,+86,13900001002,,import-b@test.com,referral,,缺名称,new_lead
缺联系方式,individual,+86,,,no-contact@test.com,referral,,,new_lead
坏手机号,individual,+86,12345,,bad-phone@test.com,referral,,,new_lead
坏邮箱,individual,+86,13900001005,,not-an-email,referral,,,new_lead
坏来源,individual,+86,13900001006,,bad-source@test.com,invalid_source,,,new_lead
其他无备注,individual,+86,13900001007,,other@test.com,other,,,new_lead
重复手机,individual,+86,13800000001,,dup-phone@test.com,referral,,与库内重复,new_lead
重复微信,individual,+86,13900001009,staff_a_wechat,,referral,,与库内重复,new_lead
CSV内重复手机,individual,+86,13900009999,,csv-dup@test.com,referral,,,new_lead
CSV内重复手机2,individual,+86,13900009999,,csv-dup2@test.com,referral,,,new_lead
EOF

curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/import/customers/precheck \
  -H 'Content-Type: application/json' \
  --data-binary @- <<EOF
{"csvText":"$(cat /tmp/import-test.csv | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | tr -d '\n')","fileName":"import-test.csv"}
EOF
```

预检应返回：`validRows` 为 1（仅「导入测试客户A」），`invalidRows` > 0，errors 含 `missing_customer_name`、`missing_contact`、`invalid_phone`、`invalid_email`、`invalid_source`、`missing_source_remark`、`duplicate_phone_db`、`duplicate_wechat_id_db`、`duplicate_phone_csv` 等。

Staff 预检 → 403：

```bash
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" \
  -X POST http://localhost:3000/api/import/customers/precheck \
  -H 'Content-Type: application/json' -d '{"csvText":"customer_name,source\nX,referral"}'
```

### 4. 正式导入

```bash
cat > /tmp/import-ok.csv <<'EOF'
customer_name,customer_type,phone_country_code,phone,wechat_id,email,source,source_remark,notes,sales_stage
Phase10A导入客户,individual,+86,13900008888,phase10a_wx,phase10a@test.com,referral,,Phase10A测试,new_lead
EOF

PRECHECK=$(curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/import/customers/precheck \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-ok.csv),\"fileName\":\"import-ok.csv\"}")

JOB_ID=$(echo "$PRECHECK" | jq -r .jobId)

curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/import/customers/commit \
  -H 'Content-Type: application/json' \
  -d "{\"csvText\":$(jq -Rs . < /tmp/import-ok.csv),\"fileName\":\"import-ok.csv\",\"jobId\":\"$JOB_ID\"}"
```

验证：

- 响应 `importedCount: 1`，含 `createdCustomerIds`
- `/customers` 列表可见新客户，`owner_id` 为 Admin
- `audit_logs` 含 `customers.import.completed`、`customer.imported`
- `import_jobs` 有 `status=completed` 记录

含错误行时 commit → 400，并写入 `customers.import.failed`。

---

## Phase 9.1（报表时区）

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

## Phase 8 审批中心测试

```bash
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

### 1. 登录

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'

curl -s -c /tmp/crm-staff-b.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-b@crm.local","password":"StaffB123!"}'
```

### 2. Staff 提交申请

```bash
CUST_A=22222222-2222-2222-2222-222222222201
CUST_B=22222222-2222-2222-2222-222222222202
CUST_POOL=22222222-2222-2222-2222-222222222203
STAFF_B_ID=11111111-1111-1111-1111-111111111103

# Staff A 删除申请 → 200
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_A/approval-requests \
  -H 'Content-Type: application/json' -d '{"requestType":"delete_customer","reason":"测试删除"}'

# Staff A 转移申请 → 200
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_A/approval-requests \
  -H 'Content-Type: application/json' \
  -d "{\"requestType\":\"transfer_customer\",\"reason\":\"测试转移\",\"targetUserId\":\"$STAFF_B_ID\"}"

# Staff A 为 Staff B 客户提交 → 403
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_B/approval-requests \
  -H 'Content-Type: application/json' -d '{"requestType":"delete_customer","reason":"越权"}'

# Staff A 为公共池客户提交 → 403
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_POOL/approval-requests \
  -H 'Content-Type: application/json' -d '{"requestType":"delete_customer","reason":"公共池"}'

# Staff B 成交申请
curl -s -b /tmp/crm-staff-b.txt -X POST http://localhost:3000/api/customers/$CUST_B/approval-requests \
  -H 'Content-Type: application/json' \
  -d '{"requestType":"closed_won","reason":"成交","payload":{"dealAmount":"100000","signingDate":"2026-06-01"}}'

# 重复 pending 同类型 → 409
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_A/approval-requests \
  -H 'Content-Type: application/json' -d '{"requestType":"delete_customer","reason":"重复"}'
```

### 3. Admin 审批

```bash
# 查看全部 pending
curl -s -b /tmp/crm-admin.txt "http://localhost:3000/api/approvals?status=pending"

# Staff 调用 approve → 403
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/approvals/<id>/approve \
  -H 'Content-Type: application/json' -d '{"adminComment":"test"}'

# Admin 驳回转移 / 批准删除 / 批准成交
curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/approvals/<transfer-id>/reject \
  -H 'Content-Type: application/json' -d '{"adminComment":"暂不转移"}'

curl -s -b /tmp/crm-admin.txt -X POST http://localhost:3000/api/approvals/<delete-id>/approve \
  -H 'Content-Type: application/json' -d '{"adminComment":"同意归档"}'
```

### 4. 验证

```bash
npx wrangler d1 execute crm-db --local --command \
  "SELECT type, title FROM notifications WHERE type LIKE 'approval.%' ORDER BY created_at DESC LIMIT 10"

npx wrangler d1 execute crm-db --local --command \
  "SELECT action, entity_id FROM audit_logs WHERE action LIKE 'approval.%' ORDER BY created_at DESC LIMIT 10"
```

UI：访问 `/approvals`；在客户详情页点击「提交审批申请」。

## Phase 8.1 已归档客户边界测试

前置：通过 Phase 8 删除审批将 Staff A 客户（`...201`）归档，或手动将客户 `status` 设为 `archived`。

```bash
CUST_ARCHIVED=22222222-2222-2222-2222-222222222201

# Staff 列表不含 archived
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/customers | \
  python3 -c "import sys,json;ids=[i['id'] for i in json.load(sys.stdin)['items']];print('archived in list', '$CUST_ARCHIVED' in ids)"

# Admin 默认列表不含 archived；?status=archived 可查看
curl -s -b /tmp/crm-admin.txt "http://localhost:3000/api/customers?status=archived"

# Staff 不能编辑 archived → 400
curl -s -b /tmp/crm-staff-a.txt -X PATCH http://localhost:3000/api/customers/$CUST_ARCHIVED \
  -H 'Content-Type: application/json' -d '{"customerName":"test"}'

# Staff 不能添加跟进 → 400
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_ARCHIVED/follow-ups \
  -H 'Content-Type: application/json' \
  -d '{"followUpTime":"2026-06-24T10:00:00.000Z","channel":"phone","outcome":"connected","summary":"test"}'

# Staff 不能释放公共池 → 400
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_ARCHIVED/release-to-pool \
  -H 'Content-Type: application/json' -d '{"reason":"test"}'

# Staff 不能再次提交审批 → 400
curl -s -b /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/customers/$CUST_ARCHIVED/approval-requests \
  -H 'Content-Type: application/json' -d '{"requestType":"delete_customer","reason":"重复"}'

# Admin 可查看 archived 详情 → 200
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/customers/$CUST_ARCHIVED

# 审计日志
npx wrangler d1 execute crm-db --local --command \
  "SELECT action FROM audit_logs WHERE action LIKE '%_failed.archived' ORDER BY created_at DESC LIMIT 10"
```

**自动回收**：引擎查询条件为 `status = active`，`archived` / `inactive` / `public_pool` 均不参与（见 `src/lib/reclamation/engine.ts`）。

## Phase 9 数据看板测试

```bash
npm run dev

# 登录
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"Admin123!"}'
curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'

# Admin 报表 → 200
curl -s -b /tmp/crm-admin.txt http://localhost:3000/api/reports/admin-dashboard | head -c 500

# Staff 访问 Admin 报表 → 403
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/reports/admin-dashboard

# Staff 报表 → 200
curl -s -b /tmp/crm-staff-a.txt http://localhost:3000/api/reports/staff-dashboard | head -c 500

# 未登录 → 401
curl -s http://localhost:3000/api/reports/admin-dashboard
```

UI：访问 `/admin` 查看全局 KPI；访问 `/staff` 查看个人数据。

### 统计口径摘要

**时区**：所有 today / thisMonth 指标按业务时区 `Asia/Shanghai`（UTC+8）计算；配置见 `src/lib/reports/dates.ts` 中的 `BUSINESS_TIMEZONE`。数据库存储 UTC，查询前将 UTC+8 日期边界转换为 UTC ISO 字符串。

| 指标 | 口径 |
|------|------|
| 总客户数 | `status != archived` |
| 我的客户（Staff） | `owner_id = 我` 且 `status = active` |
| 成交客户 | `sales_stage = closed_won` |
| 有效跟进 | `is_valid_follow_up = 1` |
| 今日任务 | `status=open` 且 `due_at` 在 UTC+8 当天 00:00–23:59:59.999 |
| 超期任务 | `status=open` 且 `due_at < now`（即时比较，非日界） |
| 本月指标 | `>= UTC+8 当月1日 00:00` 且 `< UTC+8 下月1日 00:00` |
| 7 天领取数 | 滚动 7×24 小时（与公共池配额一致，非自然周） |
| 自动回收（本月） | `audit_logs.action = customer.auto_reclaimed_to_pool` |
| 回收风险（Staff） | 我的 active 客户，6≤无有效跟进天数<8 |

### 时区边界测试

```bash
npx tsx scripts/test-report-timezone.ts
```

手动验证示例（UTC 2026-06-24 18:00 = UTC+8 次日 02:00，业务日为 6 月 25 日）：

* `due_at = 2026-06-24T20:00:00.000Z`（UTC+8 6/25 04:00）→ 计入今日任务
* `created_at = 2026-05-31T20:00:00.000Z`（UTC+8 6/1 04:00）→ 计入本月新增

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
