# 环境变量说明

复制 `.dev.vars.example` 为 `.dev.vars`（本地开发）或在 Cloudflare Dashboard 配置生产变量。

| 变量 | 阶段 | 必填 | 说明 |
|------|------|------|------|
| `TURNSTILE_SITE_KEY` | Phase 2+ | 否 | Cloudflare Turnstile 站点公钥（登录页） |
| `TURNSTILE_SECRET_KEY` | Phase 2+ | 否 | Turnstile 服务端校验密钥 |
| `SESSION_SECRET` | Phase 1 | 生产建议填写 | Session 相关预留配置；生产环境请使用强随机字符串 |
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

`.env` 文件已被 `.gitignore` 忽略，请勿提交密钥。
