# 环境变量说明

复制 `.dev.vars.example` 为 `.dev.vars`（本地开发）或在 Cloudflare Dashboard 配置生产变量。

| 变量 | 阶段 | 必填 | 说明 |
|------|------|------|------|
| `SKIP_ACCESS_JWT_CHECK` | Phase 17A | 本地 dev 建议 `true` | 设为 `true` 时跳过 Cloudflare Access JWT 5 分钟窗口校验（**生产勿启用**） |
| `TURNSTILE_SITE_KEY` | Phase 2+ | 否 | Cloudflare Turnstile 站点公钥（登录页） |
| `TURNSTILE_SECRET_KEY` | Phase 2+ | 否 | Turnstile 服务端校验密钥 |
| `SESSION_SECRET` | Phase 1 | 生产建议填写 | Session 相关预留配置；生产环境请使用强随机字符串 |
| `ENABLE_DEBUG_API` | Phase 2+ | 否 | 设为 `true` 时在生产环境启用 `/api/debug/*`（默认禁用） |
| `SEED_ADMIN_EMAIL` | 生产 seed | 生产 seed 必填 | 首个 Admin 邮箱；禁止 `@crm.local` |
| `SEED_ADMIN_PASSWORD` | 生产 seed | 生产 seed 必填 | 强密码（≥8 位，含大小写与数字） |
| `SEED_ADMIN_NAME` | 生产 seed | 否 | Admin 显示名称，默认「系统管理员」 |
| `SEED_STAFF_A_PASSWORD` | 本地 seed | 否 | 覆盖本地 Staff A 默认密码 |
| `SEED_STAFF_B_PASSWORD` | 本地 seed | 否 | 覆盖本地 Staff B 默认密码 |
| `CLOUDFLARE_ACCOUNT_ID` | 部署/远程迁移 | 生产必填 | Cloudflare 账号 ID |
| `CLOUDFLARE_DATABASE_ID` | 部署/远程迁移 | 生产必填 | D1 数据库 UUID（`wrangler d1 create` 返回） |
| `CLOUDFLARE_D1_TOKEN` | 远程迁移 | 可选 | Drizzle Kit 远程操作 API Token |

## Cloudflare 绑定（wrangler.jsonc）

| 绑定名 | 类型 | 用途 |
|--------|------|------|
| `DB` | D1 | 主数据库 |
| `ATTACHMENTS` | R2 | 附件存储（预留，Phase 0 未实现上传） |
| `ASSETS` | Assets | OpenNext 静态资源 |

## 本地 vs 生产

- **本地**：`wrangler d1 migrations apply crm-db --local` 使用 `.wrangler/state` 下的模拟 D1
- **生产**：先 `npx wrangler d1 create crm-db` 获取 `database_id`，更新 `wrangler.jsonc`，再 `npm run db:migrate:remote`

`.env` 与 `.dev.vars` 文件已被 `.gitignore` 忽略，请勿提交密钥。

## 生产 Admin Seed

仅在使用 `npm run db:seed:remote` 时需要：

```bash
SEED_ADMIN_EMAIL=ops@yourcompany.com \
SEED_ADMIN_PASSWORD='YourStr0ngPass1' \
npm run db:seed:remote
```

本地 `npm run db:seed:local` 仍使用 `admin@crm.local` 等测试账号，无需设置上述变量。
