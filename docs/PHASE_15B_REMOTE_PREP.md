# Phase 15B：Cloudflare 远程环境准备 + 预览部署准备

**本阶段仅作检查与命令模板整理，不绑定正式域名，不执行 destructive 远程操作。**

所有会影响 Cloudflare 远程环境的命令（创建 D1/R2、remote migration、seed、deploy）均需你**明确确认后**再执行。

---

## 1. 开始前检查结果（2026-06-24）

| 检查项 | 状态 |
|--------|------|
| `git status` 干净 | ✅ `main`，working tree clean |
| 当前分支 `main` | ✅ |
| `npm run build` | ✅ 通过 |
| 本地 dev（`:3000`） | ✅ 有进程监听 |
| Phase 15A.2 commit | ✅ `0a82f73` |
| `docs/DEPLOYMENT.md` | ✅ 存在 |
| `docs/PRE_LAUNCH_PERMISSION_CHECKLIST.md` | ✅ 存在 |
| **Wrangler 已登录** | ❌ **未登录** — 需先 `npx wrangler login` |
| 已进入实际远程部署 | ❌ 否 |

> **阻塞项：** 未登录 Cloudflare 时，无法验证远程 D1/R2 是否存在，也无法执行 remote migration / deploy / seed。

---

## 2. Cloudflare 登录

```bash
npx wrangler whoami          # 检查登录状态
npx wrangler login           # 未登录时执行（浏览器 OAuth）
```

登录成功后再执行本文档中的远程检查命令。

---

## 3. 需要你提供或确认的 Cloudflare 配置清单

### 3.1 仍为占位符 / 示例值（wrangler 文件内）

| 文件 | 字段 | 当前值 | 状态 |
|------|------|--------|------|
| `wrangler.jsonc` | `d1_databases[].database_id` | `00000000-0000-0000-0000-000000000001` | ⚠️ **占位符，上线前必须替换** |
| `wrangler.cron.jsonc` | `d1_databases[].database_id` | 同上 | ⚠️ **占位符，必须与主应用一致** |
| `wrangler.backup-cron.jsonc` | `d1_databases[].database_id` | 同上 | ⚠️ **占位符，必须与主应用一致** |
| `wrangler.jsonc` | `r2_buckets[].bucket_name` | `crm-attachments` | ⚠️ **示例名** — 需在账号中创建或改为你已有桶名 |
| `wrangler.jsonc` | `r2_buckets[].preview_bucket_name` | `crm-attachments-preview` | 预览用，可选 |
| `wrangler.backup-cron.jsonc` | `r2_buckets[].bucket_name` | `crm-attachments` | 须与主应用一致 |

### 3.2 已合理、一般无需改（除非你方有命名规范）

| 文件 | 字段 | 当前值 | 说明 |
|------|------|--------|------|
| `wrangler.jsonc` | `name` | `crm-system` | 主 Worker 名称 |
| `wrangler.cron.jsonc` | `name` | `crm-system-reclamation-cron` | 回收 Cron Worker |
| `wrangler.backup-cron.jsonc` | `name` | `crm-system-backup-cron` | 备份 Cron Worker |
| `wrangler.jsonc` | `services[].service` | `crm-system` | ✅ 与主 Worker `name` 一致 |
| `wrangler.jsonc` | `d1_databases[].database_name` | `crm-db` | D1 逻辑名，与 `wrangler d1` 命令一致 |
| `wrangler.jsonc` | `d1_databases[].binding` | `DB` | 代码使用 `env.DB` |
| `wrangler.jsonc` | `r2_buckets[].binding` | `ATTACHMENTS` | 代码使用 `env.ATTACHMENTS` |

### 3.3 Cron 时区（已确认）

| Worker | Cron (UTC) | UTC+8 |
|--------|------------|-------|
| `crm-system-reclamation-cron` | `0 21 * * *` | 每天 05:00 |
| `crm-system-backup-cron` | `0 21 * * *` | 每天 05:00 |

Cloudflare Cron 表达式使用 **UTC**。`0 21 * * *` = 中国 / 香港 / 台湾早上 **05:00**。

### 3.4 绑定关系

| Worker | D1 `DB` | R2 `ATTACHMENTS` |
|--------|---------|------------------|
| 主应用 `crm-system` | ✅ 配置 | ✅ 配置 |
| `crm-system-reclamation-cron` | ✅ 配置 | — 不需要 |
| `crm-system-backup-cron` | ✅ 配置 | ✅ 需要（备份 JSON 存 R2） |

### 3.5 你需要确认或提供的信息

- [ ] Cloudflare 账号已登录（`wrangler whoami` 成功）
- [ ] **生产 D1 `database_id`**（`wrangler d1 create crm-db` 或现有库 UUID）
- [ ] **R2 桶是否已创建**（`crm-attachments` 或你自定义名称）
- [ ] **Worker 环境变量**（见第 6 节，尤其 `SESSION_SECRET`）
- [ ] **生产 Admin 邮箱与强密码**（仅 seed 时用，不入库）
- [ ] 是否使用 **workers.dev** 预览，暂不绑定自定义域名
- [ ] remote migration 前是否已 **export 备份**（非新库时）

---

## 4. 创建资源命令（待你确认后再执行）

```bash
# D1（新库）
npx wrangler d1 create crm-db
# 将返回的 database_id 写入 wrangler.jsonc、wrangler.cron.jsonc、wrangler.backup-cron.jsonc

# R2
npx wrangler r2 bucket create crm-attachments
npx wrangler r2 bucket create crm-attachments-preview   # 可选

# 列出已有资源（登录后）
npx wrangler d1 list
npx wrangler r2 bucket list
```

**本阶段未执行以上任何命令。**

---

## 5. Remote D1 migration 前检查

### 5.1 Migration 文件顺序（0001 → 0015，共 15 个）

| # | 文件 | 说明 |
|---|------|------|
| 0001 | `0001_initial.sql` | 基础表 |
| 0002 | `0002_user_lockout.sql` | 登录锁定 |
| 0003 | `0003_customer_public_pool.sql` | 公共池字段 |
| 0004 | `0004_customer_type_stage.sql` | `customer_type` 等 ALTER |
| 0005 | `0005_field_change_logs.sql` | 字段变更日志 |
| 0006 | `0006_follow_ups_tasks.sql` | 跟进 / 任务 |
| 0007 | `0007_fix_task_status.sql` | 任务状态修正 |
| 0008 | `0008_public_pool.sql` | 公共池完善 |
| 0009 | `0009_notifications.sql` | 通知 |
| 0010 | `0010_approvals.sql` | 审批 |
| 0011 | `0011_notification_approval_types.sql` | 通知类型 |
| 0012 | `0012_import_jobs.sql` | 导入任务 |
| 0013 | `0013_export_jobs.sql` | 导出任务 |
| 0014 | `0014_backup_jobs.sql` | 备份任务 |
| 0015 | `0015_announcements.sql` | 公告 |

顺序完整，无跳号。

### 5.2 重复字段风险

- **0004** 使用 `ALTER TABLE ... ADD COLUMN`（`customer_type`、`phone_country_code`、`sales_stage`）。
- 若 remote 库**已部分迁移**或手工建过列，bulk `migrations apply` 可能报 `duplicate column`（与本地已知问题相同）。
- **新空库**：按顺序 apply 通常无此问题。

### 5.3 本地 `d1_migrations` 与 schema 不一致风险

- 本地若曾单文件执行 SQL 或迁移中断，`d1_migrations` 表可能与实际表结构不同步。
- **remote 新库**不存在此历史问题；**remote 非新库**必须先检查再 apply。

### 5.4 检查命令（登录并替换 `database_id` 后执行，**本阶段未执行**）

**A. 新库 / 首次迁移前**

```bash
# 确认配置指向 remote
npx wrangler d1 execute crm-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# 期望：空库或仅 d1_migrations

# 迁移前备份（推荐即使新库也养成习惯）
npx wrangler d1 export crm-db --remote --output=pre-migrate-$(date +%Y%m%d).sql

# 应用迁移（需确认）
npm run db:migrate:remote
```

**B. 非新库 / 已有数据**

```bash
# 1. 现有表
npx wrangler d1 execute crm-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

# 2. 已应用迁移记录
npx wrangler d1 execute crm-db --remote --command="SELECT * FROM d1_migrations ORDER BY id;"

# 3. 关键列是否存在（示例）
npx wrangler d1 execute crm-db --remote --command="PRAGMA table_info(customers);"

# 4. 备份后再决定是否 apply
npx wrangler d1 export crm-db --remote --output=pre-migrate-$(date +%Y%m%d).sql

# 5. 确认后
npm run db:migrate:remote
```

**迁移失败：** D1 无自动 down migration；从 export 备份恢复，勿在未备份时重试破坏性 SQL。

---

## 6. 生产环境变量清单

配置位置：**Cloudflare Dashboard → Workers → `crm-system` → Settings → Variables**（及 Cron Worker 若需要）。

| 变量 | 必须 / 预留 | 说明 |
|------|-------------|------|
| `SESSION_SECRET` | **生产必须** | 强随机字符串；勿使用 `change-me` |
| `ENABLE_DEBUG_API` | **生产必须关闭** | 不设置或设为 `false`；仅 `true` 时开放 `/api/debug/*` |
| `NODE_ENV` | 通常自动 | OpenNext/Workers 生产为 `production` |
| `SEED_ADMIN_EMAIL` | seed 时 CLI 环境变量 | **不要**写入 Dashboard；仅 `db:seed:remote` 一次性使用 |
| `SEED_ADMIN_PASSWORD` | seed 时 CLI 环境变量 | 同上；强密码策略 |
| `SEED_ADMIN_NAME` | seed 时可选 | 默认「系统管理员」 |
| `TURNSTILE_SITE_KEY` | 预留，**未启用** | 登录页未接入 |
| `TURNSTILE_SECRET_KEY` | 预留，**未启用** | 同上 |
| `CLOUDFLARE_ACCOUNT_ID` | CLI 可选 | 本地 `.dev.vars`，远程操作 |
| `CLOUDFLARE_DATABASE_ID` | CLI 可选 | 文档/脚本参考 |
| `CLOUDFLARE_D1_TOKEN` | CLI 可选 | Drizzle Kit 远程 |
| `BACKUP_FORCE_FAIL` | 仅测试 | `1` 时强制备份失败；**生产勿设** |

**切勿**将真实密钥、`SEED_*` 密码写入仓库、`.dev.vars` commit 或本文档。

---

## 7. 生产 Admin seed 策略（已确认）

| 规则 | 状态 |
|------|------|
| 禁止 `admin@crm.local` | ✅ `scripts/seed.ts` 远程模式拒绝 |
| 禁止 `staff-a@crm.local` / `staff-b@crm.local` | ✅ 远程不创建 staff |
| 仅创建 1 个 Admin | ✅ |
| 必须 `SEED_ADMIN_EMAIL` + `SEED_ADMIN_PASSWORD` | ✅ |
| 强密码（≥8 位，大小写+数字） | ✅ `validatePasswordPolicy` |

**命令模板（迁移完成且你确认后执行，本阶段未执行）：**

```bash
SEED_ADMIN_EMAIL="your-admin@example.com" \
SEED_ADMIN_PASSWORD="YourStr0ngPass1" \
SEED_ADMIN_NAME="系统管理员" \
npm run db:seed:remote
```

上线后立即登录修改密码。若库中已有用户，用 Admin 界面创建账号，勿重复 seed。

---

## 8. 预览部署准备

不绑定正式域名；使用 **workers.dev** 或 Wrangler preview URL。

### 8.1 构建

```bash
npm run build
```

### 8.2 本地 OpenNext + Wrangler 预览（推荐先测）

```bash
npm run preview
# 等价：opennextjs-cloudflare build && opennextjs-cloudflare preview
```

### 8.3 部署到 Cloudflare（workers.dev，非自定义域名）

```bash
# 前置：wrangler login、database_id 已替换、Dashboard 已设 SESSION_SECRET
npm run deploy
# 等价：opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

### 8.4 风险说明

| 风险 | 说明 |
|------|------|
| 占位 `database_id` | deploy 会连错库或失败 — **必须先替换** |
| 未 migration | 应用启动后 API 查表失败 — **先 migrate 或确认库结构** |
| 未设 `SESSION_SECRET` | Session 安全性不足 |
| `ENABLE_DEBUG_API=true` | 生产暴露 debug 端点 |
| workers.dev URL | 公开可发现 — 仅预览，勿放真实客户数据直至验收完成 |
| 未配置自定义 route | ✅ 本阶段目标；不在 wrangler 中加 production route |

**本阶段未执行 `npm run preview` 或 `npm run deploy`。**

---

## 9. Cron 部署准备

| 项 | reclamation | backup |
|----|-------------|--------|
| 配置 | `wrangler.cron.jsonc` | `wrangler.backup-cron.jsonc` |
| Cron | `0 21 * * *` UTC | `0 21 * * *` UTC |
| D1 binding `DB` | ✅ | ✅ |
| R2 binding `ATTACHMENTS` | — | ✅ |
| 部署命令 | `npm run cron:deploy` | `npm run cron:backup:deploy` |

**命令模板（主应用与 D1/R2 就绪且你确认后）：**

```bash
npm run cron:deploy
npm run cron:backup:deploy
```

**注意：** 两个 Cron 与主应用须使用**同一** `database_id` 与 R2 桶。备份 Cron 依赖 R2；未创建桶则备份失败。

**本阶段未执行 Cron deploy。**

---

## 10. Phase 15B 远程部署前检查清单

| # | 检查项 | Phase 15B 状态 |
|---|--------|----------------|
| 1 | Cloudflare 已登录（`wrangler whoami`） | ❌ 待你 `wrangler login` |
| 2 | D1 `database_id` 已替换为真实 UUID | ❌ 仍为占位符 |
| 3 | R2 bucket 已在账号中创建 / 名称一致 | ⚠️ 待登录后 `r2 bucket list` 确认 |
| 4 | `SESSION_SECRET` 已在 Dashboard 设置 | ⚠️ 待你配置 |
| 5 | `ENABLE_DEBUG_API` 未设或 `false` | ⚠️ 部署时确认 |
| 6 | remote migration 前已 `d1 export` 备份 | ⬜ 未执行 |
| 7 | production Admin seed 命令与邮箱已准备 | ⬜ 模板已就绪 |
| 8 | debug API 关闭 | ✅ 代码默认关闭 |
| 9 | Cron `0 21 * * *` 且 binding 配置正确 | ✅ wrangler 文件已对齐 |
| 10 | 未绑定正式自定义域名 | ✅ 本阶段未绑定 |
| 11 | 未执行 destructive 操作 | ✅ 未清空 / 未 remote migrate / 未 seed / 未 deploy |

---

## 相关文档

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md)
- [ENV.md](./ENV.md)
