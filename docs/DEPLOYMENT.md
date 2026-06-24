# 部署与上线指南（Phase 15A）

本文档说明本地开发、Cloudflare 生产部署准备、数据库迁移、生产 Admin 初始化、安全检查与回滚建议。

**重要：本文档仅作准备说明，不代替你对生产环境的最终确认。执行 remote migration、生产 seed、正式域名绑定前，请先完成 [上线前权限测试清单](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) 并备份数据库。**

---

## 1. 本地开发启动

### 前置条件

- Node.js 20+
- npm
- Cloudflare Wrangler CLI（项目 devDependency 已包含）

### 步骤

```bash
npm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，至少设置 SESSION_SECRET

npm run db:migrate:local
npm run db:seed:local          # 创建本地测试账号与示例客户
npm run dev                    # http://localhost:3000
```

### 本地测试账号（仅开发环境）

| 角色 | 邮箱 | 默认密码 |
|------|------|----------|
| Admin | admin@crm.local | Admin123! |
| Staff A | staff-a@crm.local | StaffA123! |
| Staff B | staff-b@crm.local | StaffB123! |

**这些账号不得用于生产。** 生产环境禁止使用 `@crm.local` 邮箱。

### 可选：回收规则本地测试数据

```bash
npm run db:seed:reclamation:local
```

回收测试 seed **仅允许本地**，`db:seed:reclamation:remote` 会在脚本层拒绝执行。

---

## 2. 环境变量

完整说明见 [ENV.md](./ENV.md)。`.dev.vars` 与 `.env*` 均已加入 `.gitignore`，请勿提交密钥。

### 应用 Worker（wrangler.jsonc / Dashboard vars）

| 变量 | 本地 | 生产 | 说明 |
|------|------|------|------|
| `SESSION_SECRET` | 建议填写 | **必填** | 强随机字符串，用于 Session 相关配置 |
| `ENABLE_DEBUG_API` | 未设置即可 | **保持未设置或 false** | 仅当显式设为 `true` 时生产环境才开放 `/api/debug/*` |
| `TURNSTILE_SITE_KEY` | 可选 | 可选 | **当前未启用** Turnstile 登录验证（预留） |
| `TURNSTILE_SECRET_KEY` | 可选 | 可选 | **当前未启用** |

### 部署 / 远程迁移（CLI，通常不入库）

| 变量 | 说明 |
|------|------|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |
| `CLOUDFLARE_DATABASE_ID` | D1 数据库 UUID |
| `CLOUDFLARE_D1_TOKEN` | 可选，Drizzle Kit 远程操作 API Token |

### 生产 Admin Seed（仅执行 `db:seed:remote` 时）

| 变量 | 必填 | 说明 |
|------|------|------|
| `SEED_ADMIN_EMAIL` | 是 | 真实企业邮箱，禁止 `@crm.local` |
| `SEED_ADMIN_PASSWORD` | 是 | 强密码（≥8 位，含大小写字母与数字） |
| `SEED_ADMIN_NAME` | 否 | 显示名称，默认「系统管理员」 |

示例：

```bash
SEED_ADMIN_EMAIL=ops@yourcompany.com \
SEED_ADMIN_PASSWORD='YourStr0ngPass1' \
npm run db:seed:remote
```

---

## 3. Cloudflare 资源配置

### 3.1 主应用 Worker

配置文件：`wrangler.jsonc`

| 项 | 值 |
|----|-----|
| Worker 名称 | `crm-system` |
| 入口 | `.open-next/worker.js`（OpenNext 构建产物） |
| D1 绑定 | `DB` → `crm-db` |
| R2 绑定 | `ATTACHMENTS` → `crm-attachments` |
| 静态资源 | `ASSETS` → `.open-next/assets` |
| 自引用 Service | `WORKER_SELF_REFERENCE` |

**上线前必须将下列占位符替换为生产真实值**（见 [3.6 部署配置占位符清单](#36-部署配置占位符清单上线前必须替换)）。

### 3.2 D1 数据库

```bash
npx wrangler d1 create crm-db
# 将返回的 database_id 写入 wrangler.jsonc 及两个 cron 配置
```

迁移目录：`drizzle/migrations`（已在 wrangler.jsonc 的 `migrations_dir` 声明）。

### 3.3 R2 存储桶

```bash
npx wrangler r2 bucket create crm-attachments
npx wrangler r2 bucket create crm-attachments-preview   # 预览环境可选
```

用途：附件存储、自动备份 JSON 文件。备份 cron Worker 需要 R2 绑定。

### 3.4 OpenNext 构建与部署

```bash
npm run build                    # Next.js 生产构建校验
npm run preview                  # 本地 OpenNext + Wrangler 预览
npm run deploy                   # 部署主应用 Worker（确认后再执行）
```

### 3.5 Cron Workers

Cloudflare Cron 表达式使用 **UTC** 时间。

| 配置 | Worker 名称 | Cron (UTC) | 本地时间 (UTC+8) | 功能 |
|------|-------------|------------|------------------|------|
| `wrangler.cron.jsonc` | `crm-system-reclamation-cron` | `0 21 * * *` | 每天 **05:00** | 客户自动回收 |
| `wrangler.backup-cron.jsonc` | `crm-system-backup-cron` | `0 21 * * *` | 每天 **05:00** | 自动数据库备份 |

**时区说明：**

- `0 21 * * *` UTC = 中国 / 香港 / 台湾（UTC+8）每天早上 **05:00**。
- 回收任务与备份任务均按 UTC+8 早上 5 点执行（UTC 21:00）。

部署命令（确认 D1/R2 配置后）：

```bash
npm run cron:deploy
npm run cron:backup:deploy
```

两个 Cron Worker 需与主应用使用**同一** `database_id` 和 R2 bucket。

### 3.6 部署配置占位符清单（上线前必须替换）

仓库内 wrangler 配置仍含开发/示例值，**部署前必须逐项确认并替换**：

| 文件 | 字段 | 当前值（占位/示例） | 说明 |
|------|------|---------------------|------|
| `wrangler.jsonc` | `d1_databases[].database_id` | `00000000-0000-0000-0000-000000000001` | **上线前必须替换**为 `wrangler d1 create` 返回的 UUID |
| `wrangler.cron.jsonc` | `d1_databases[].database_id` | 同上 | 与主应用使用同一生产 D1 |
| `wrangler.backup-cron.jsonc` | `d1_databases[].database_id` | 同上 | 与主应用使用同一生产 D1 |
| `wrangler.jsonc` | `d1_databases[].database_name` | `crm-db` | 逻辑名称；创建 D1 时需一致或同步修改 |
| `wrangler.jsonc` | `r2_buckets[].bucket_name` | `crm-attachments` | **上线前必须**在 Cloudflare 创建对应 R2 桶（或改为你的桶名并同步配置） |
| `wrangler.jsonc` | `r2_buckets[].preview_bucket_name` | `crm-attachments-preview` | 预览环境桶名；生产可选 |
| `wrangler.backup-cron.jsonc` | `r2_buckets[].bucket_name` | `crm-attachments` | 须与主应用 R2 绑定一致 |
| `wrangler.jsonc` | `name` | `crm-system` | Worker 名称；可按团队规范修改 |
| `wrangler.cron.jsonc` | `name` | `crm-system-reclamation-cron` | 回收 Cron Worker 名称 |
| `wrangler.backup-cron.jsonc` | `name` | `crm-system-backup-cron` | 备份 Cron Worker 名称 |
| `wrangler.jsonc` | `services[].service` | `crm-system` | 自引用服务名，须与主 Worker `name` 一致 |

**不在 wrangler 文件内、但生产必填：**

| 位置 | 变量 / 项 | 说明 |
|------|-----------|------|
| Cloudflare Dashboard → Worker 变量 | `SESSION_SECRET` | **上线前必须**设为强随机值 |
| Cloudflare Dashboard | 自定义域名 / Route | 绑定正式域名前在 Dashboard 配置（本仓库无 route 占位文件） |
| 本地 `.dev.vars` / CI | `CLOUDFLARE_ACCOUNT_ID` | 远程 CLI 操作时需要 |

当前仓库**未**包含 `account_id` 字段（Wrangler 从登录账号推断）；`database_id` 三处均为明显占位 UUID，**上线前必须替换**。

### 3.7 Turnstile

**状态：未启用。** 环境变量已预留，登录页尚未接入 Turnstile 校验。上线不依赖 Turnstile，但建议在后续阶段接入。

---

## 4. 数据库迁移

### 4.1 迁移文件清单（0001 → 0015）

| # | 文件 | 主要内容 |
|---|------|----------|
| 0001 | `0001_initial.sql` | users、sessions、customers、audit_logs 等基础表 |
| 0002 | `0002_user_lockout.sql` | 登录锁定字段 |
| 0003 | `0003_customer_public_pool.sql` | 公共池相关字段 |
| 0004 | `0004_customer_type_stage.sql` | customer_type、stage |
| 0005 | `0005_field_change_logs.sql` | 字段变更日志 |
| 0006 | `0006_follow_ups_tasks.sql` | 跟进与任务 |
| 0007 | `0007_fix_task_status.sql` | 任务状态修正 |
| 0008 | `0008_public_pool.sql` | 公共池完善 |
| 0009 | `0009_notifications.sql` | 通知 |
| 0010 | `0010_approvals.sql` | 审批 |
| 0011 | `0011_notification_approval_types.sql` | 通知类型扩展 |
| 0012 | `0012_import_jobs.sql` | 导入任务 |
| 0013 | `0013_export_jobs.sql` | 导出任务 |
| 0014 | `0014_backup_jobs.sql` | 备份任务 |
| 0015 | `0015_announcements.sql` | 公告 |

顺序完整，共 15 个文件。

### 4.2 本地迁移

```bash
npm run db:migrate:local
```

若 bulk migrate 因历史本地库状态报错（如 duplicate column），可对照 `d1_migrations` 表与表结构，对缺失的单文件执行：

```bash
npx wrangler d1 execute crm-db --local --file=drizzle/migrations/00XX_name.sql
```

### 4.3 生产 / Remote 迁移（确认后再执行）

**迁移前必须先备份**（见第 8 节）。

```bash
# 1. 确认 wrangler.jsonc 中 database_id 为生产库
# 2. 可选：导出当前 remote 快照
npx wrangler d1 export crm-db --remote --output=pre-migrate-backup.sql

# 3. 应用迁移
npm run db:migrate:remote
# 等价于：wrangler d1 migrations apply crm-db --remote

# 4. 验证
npx wrangler d1 execute crm-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

**本阶段不自动执行 remote migration。** 等你确认后再操作。

### 4.4 迁移失败处理

D1/SQLite 迁移**不支持自动 down migration**。建议：

1. 停止继续部署新版本 Worker。
2. 从迁移前 `wrangler d1 export` 快照或 Admin 备份 JSON 评估恢复方案。
3. 若迁移仅部分成功，检查 `d1_migrations` 表与错误 SQL，在维护窗口内手动修复或联系 DBA。
4. 严重情况下使用 Cloudflare 支持或从 R2 备份恢复业务数据（需自定义导入流程，系统未提供一键恢复）。

---

## 5. 生产 Admin 初始化

### 策略

1. **禁止**在生产使用 `admin@crm.local` / `staff-a@crm.local` / `staff-b@crm.local`。
2. 生产首个 Admin 通过 `db:seed:remote` 创建，且必须传入 `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD`。
3. 密码不符合策略时脚本拒绝执行。
4. 生产 seed **不会**创建 staff-a/b 测试账号或示例客户。
5. 上线后**立即**登录修改密码；若曾误用弱密码 seed，立即轮换。

### 命令

```bash
SEED_ADMIN_EMAIL=ops@yourcompany.com \
SEED_ADMIN_PASSWORD='YourStr0ngPass1' \
SEED_ADMIN_NAME='运维管理员' \
npm run db:seed:remote
```

若生产库已有用户，请使用 Admin 用户管理界面创建账号，而非重复 seed。

---

## 6. Debug API

| 环境 | 默认行为 |
|------|----------|
| 开发 (`NODE_ENV !== production`) | `/api/debug/*` 可用 |
| 生产 | **默认禁用**（返回 404） |
| 生产 + `ENABLE_DEBUG_API=true` | 仅排障时临时开启，**上线后应保持关闭** |

相关路由：

- `GET /api/debug/auth-check`
- `GET /api/debug/customer-access/:id`

实现：`src/lib/debug/guard.ts`。

---

## 7. 上线前安全检查清单

| 检查项 | 状态 / 说明 |
|--------|-------------|
| 测试账号不会出现在生产 | ✅ `db:seed:remote` 需显式邮箱+强密码，禁止 @crm.local，不创建 staff 测试号 |
| seed 误触生产 | ✅ 生产 seed 有环境变量与密码策略门禁；回收测试 seed 禁止 remote |
| `ENABLE_DEBUG_API` 默认关闭 | ✅ 生产未设置即为关闭 |
| debug API 生产不可访问 | ✅ 默认 404 |
| `.dev.vars` 不提交 | ✅ 已加入 `.gitignore` |
| 环境变量文档 | ✅ [ENV.md](./ENV.md) + 本文档 |
| `password_hash` 不出现在 API | ✅ 用户 API 仅返回安全字段；备份排除 password_hash |
| `sessions.token_hash` 不备份 | ✅ sessions 表整表排除备份 |
| 导入/导出/备份/用户/设置 Admin only | ✅ 各 API 有 `require*Admin` 守卫 |
| Staff 无法访问 `/admin/*` | ✅ `src/proxy.ts` 重定向 Staff |
| Staff 无法访问 `/import/*`、`/export/*` | ✅ Phase 15A.1：`proxy.ts` 路由层 Admin-only |
| Staff 无法导入导出备份等 | ✅ API + 页面 + 路由三层权限 |
| Turnstile | ⚠️ **未启用**（已标注） |
| 客户导出 fields 白名单 | ✅ `ALLOWED_EXPORT_FIELDS` |
| `includeSensitive=false` 不可绕过 | ✅ `applySensitiveFieldPolicy` 过滤敏感列 |
| 敏感导出有确认 | ✅ `requiresExportRiskConfirmation` |
| 导出写 audit_logs | ✅ 导出流程记录审计 |
| 备份排除 password_hash、sessions | ✅ `BACKUP_EXCLUDED_FIELDS` + 表排除 |
| 备份失败通知 Admin | ✅ backup engine 失败时通知 |
| 自动回收排除 closed_won/lost/archived | ✅ Phase 11.1 已接入 system_settings |
| system_settings 接入回收/公共池/SLA/时区 | ✅ Phase 11.1 已完成 |

### 已知限制（记录，未在本阶段修复）

| 项 | 说明 |
|----|------|
| Staff 可访问 `/approvals` | 设计如此：Staff **提交**审批；**批准/拒绝**仅 Admin |
| `inactivity_logout_minutes` | 已写入 system_settings，前端自动登出尚未完全接入 |
| 一键数据库恢复 | 未实现；恢复需手动流程 |
| 本地 bulk migrate 可能与历史库不同步 | 使用单文件 SQL 或重建本地 D1 |

---

## 8. 备份与恢复

### 自动备份

- Cron：`crm-system-backup-cron`，`0 21 * * *` UTC = UTC+8 每天 05:00
- 产物存储于 R2 `ATTACHMENTS` 绑定桶
- 备份 JSON **不含** `users.password_hash` 与整个 `sessions` 表
- 失败时向 Admin 发送通知

### 手动备份

Admin 登录 → `/admin/backups` → 触发备份。

### 迁移前备份（推荐）

```bash
npx wrangler d1 export crm-db --remote --output=backup-$(date +%Y%m%d).sql
```

### 恢复

系统**不提供**一键恢复。可选方案：

1. 从 R2 备份 JSON 选择性导入（需自定义脚本或手工 SQL）
2. 从 `wrangler d1 export` SQL 在维护窗口导入（高风险，需测试）

---

## 9. 回滚建议

1. **应用回滚**：在 Cloudflare Dashboard 将 Worker 回滚到上一稳定版本；Cron Worker 同步回滚。
2. **数据库**：无自动 down migration；优先使用迁移前 export / R2 备份。
3. **配置回滚**：恢复 `wrangler.jsonc` 中的 `database_id`、环境变量、Cron 绑定。
4. **验证**：回滚后执行 [权限测试清单](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) 抽样项。

---

## 10. 正式域名绑定前检查

- [ ] `database_id` 已替换为生产 D1 UUID（主应用 + 两个 Cron）
- [ ] R2 bucket 已创建且绑定正确
- [ ] `SESSION_SECRET` 已设为强随机值（生产 Dashboard）
- [ ] `ENABLE_DEBUG_API` 未设置或为 `false`
- [ ] Remote migration 已在备份后执行并验证表结构
- [ ] 生产 Admin 已用真实邮箱创建，测试账号不存在
- [ ] Admin 已修改初始密码
- [ ] Cron Workers 已部署且调度正确
- [ ] Turnstile：**未启用**（知悉即可，或计划后续接入）
- [ ] 完成 [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md)
- [ ] `npm run build` 通过
- [ ] 在 staging / 预览域名验证登录、客户列表、导出、备份（不含正式域名，除非你明确确认）

---

## 11. 本地 vs 生产差异摘要

| 维度 | 本地 | 生产 |
|------|------|------|
| D1 | `.wrangler/state` 模拟库 | Cloudflare 远程 D1 |
| 密钥 | `.dev.vars` | Worker 环境变量 / Secrets |
| Seed | 测试账号 + 示例客户 | 仅 Admin，需 SEED_* 环境变量 |
| Debug API | 默认开启 | 默认关闭 |
| Turnstile | 未启用 | 未启用 |
| Cron | 需手动触发或部署 Cron Worker | 按 UTC 调度自动执行 |
| 域名 | localhost:3000 | 待绑定自定义域名 |

---

## Phase 15A.1 路由与 Cron 测试

```bash
npm run dev
```

### 1. 未登录 → 跳转登录

```bash
curl -s -I http://localhost:3000/import/customers | grep -i location
# 期望：/login?redirect=%2Fimport%2Fcustomers

curl -s -I http://localhost:3000/export/customers | grep -i location
# 期望：/login?redirect=%2Fexport%2Fcustomers
```

### 2. Staff → 跳转 /staff

```bash
curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'

curl -s -I -b /tmp/crm-staff-a.txt http://localhost:3000/import/customers | grep -i location
# 期望：/staff

curl -s -I -b /tmp/crm-staff-a.txt http://localhost:3000/export/customers | grep -i location
# 期望：/staff
```

### 3. Admin → 正常访问

```bash
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/crm-admin.txt http://localhost:3000/import/customers
# 期望：200

curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/crm-admin.txt http://localhost:3000/export/customers
# 期望：200
```

---

## 相关文档

- [ENV.md](./ENV.md) — 环境变量明细
- [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) — 上线前权限回归测试
