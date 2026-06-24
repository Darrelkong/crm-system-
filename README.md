# CRM System

内部客户关系管理系统 — Next.js + TypeScript + Tailwind CSS，部署于 Cloudflare Pages / Workers，数据存储于 Cloudflare D1。

## 当前阶段：Phase 0

已完成 Cloudflare + D1 基础设施搭建，包括：

- Wrangler / OpenNext Cloudflare 配置
- D1 数据库绑定与 SQL 迁移（9 张表）
- Drizzle ORM schema 与 `getDb()` 连接封装
- 健康检查 API：`GET /api/health`
- 旧 Prisma 代码归档至 `legacy/` 与 Git 分支 `backup-before-d1-migration`

**尚未实现**：登录、客户管理、权限中间件、审计写入等业务功能（Phase 1–3）。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 App Router、React 19、Tailwind CSS 4 |
| 部署 | `@opennextjs/cloudflare`、Cloudflare Workers |
| 数据库 | Cloudflare D1、Drizzle ORM |
| 预留 | R2 附件、Turnstile 登录验证 |

## 快速开始（本地）

### 1. 安装依赖

```bash
npm install
```

### 2. 应用本地 D1 迁移

```bash
npm run db:migrate:local
```

### 3. 启动开发服务器

```bash
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)

### 4. 验证数据库

```bash
curl http://localhost:3000/api/health
```

期望返回 `status: "ok"` 且包含全部 9 张表名。

### 使用 Wrangler Preview（更接近生产环境）

```bash
npm run preview
```

默认访问 [http://localhost:8787](http://localhost:8787)（以终端输出为准）。

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | Next.js 本地开发（含 D1 模拟绑定） |
| `npm run preview` | OpenNext 构建 + Wrangler 本地预览 |
| `npm run deploy` | 构建并部署到 Cloudflare |
| `npm run db:migrate:local` | 应用迁移到本地 D1 |
| `npm run db:migrate:remote` | 应用迁移到远程 D1 |
| `npm run cf-typegen` | 生成 `cloudflare-env.d.ts` 类型 |

## 部署到 Cloudflare（生产）

### 1. 创建远程 D1 数据库

```bash
npx wrangler d1 create crm-db
```

将返回的 `database_id` 写入 `wrangler.jsonc` 中 `d1_databases[0].database_id`。

### 2. 应用远程迁移

```bash
npm run db:migrate:remote
```

### 3. 配置环境变量

在 Cloudflare Dashboard → Workers → 你的项目 → Settings → Variables 中添加变量（参见 [docs/ENV.md](./docs/ENV.md)）。

### 4. 部署

```bash
npm run deploy
```

### 5. 绑定自定义域名

在 Cloudflare Dashboard → Workers → 你的项目 → Domains & Routes 中添加自定义域名。

## 数据库表（Phase 0 已建表，业务未实现）

| 表名 | 用途 | 业务阶段 |
|------|------|----------|
| `users` | 系统用户 | Phase 1 |
| `sessions` | 登录会话 | Phase 1 |
| `customers` | 客户主表 | Phase 3 |
| `customer_contacts` | 客户联系人 | 后续 |
| `follow_ups` | 跟进记录 | 后续 |
| `tasks` | 任务 | 后续 |
| `audit_logs` | 操作审计 | Phase 1+ |
| `login_logs` | 登录审计 | Phase 1 |
| `system_settings` | 系统配置 | 后续 |

## 项目结构

```
crm-system/
├── drizzle/
│   ├── schema/          # Drizzle 表定义
│   └── migrations/      # D1 SQL 迁移
├── src/
│   ├── app/             # Next.js 路由
│   ├── components/ui/   # 基础 UI 组件
│   ├── i18n/            # 多语言预留（当前仅 zh-CN 文案）
│   └── lib/
│       ├── db/          # D1 连接封装
│       └── constants/   # 业务常量（如客户来源字典 key）
├── legacy/              # 旧 Prisma 代码归档
├── docs/ENV.md          # 环境变量说明
└── wrangler.jsonc       # Cloudflare 配置
```

## 备份与回滚

```bash
# 查看迁移前完整快照
git checkout backup-before-d1-migration

# 返回当前开发分支
git checkout main
```

旧代码说明见 [legacy/README.md](./legacy/README.md)。

## 环境变量

详见 [docs/ENV.md](./docs/ENV.md)。
