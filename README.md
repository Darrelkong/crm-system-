# CRM System

内部客户关系管理系统 — Next.js + TypeScript + Tailwind CSS，部署于 Cloudflare Pages / Workers，数据存储于 Cloudflare D1。

## 当前阶段：Phase 1

已完成认证与会话系统，包括：

- Email 登录 / 退出（Web Crypto PBKDF2 密码哈希）
- Admin / Staff 角色与独立工作台占位页
- Session 管理（Cookie 存 token，数据库存 SHA-256 hash）
- 连续 5 次登录失败锁定 30 分钟
- `login_logs` / `audit_logs` 写入
- `requireAuth` / `requireAdmin` 基础权限保护
- 路由中间件：未登录访问 dashboard 重定向到登录页

**尚未实现**：客户管理、公共池、审批、报表、Turnstile、完整多语言（Phase 2+）。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 16 App Router、React 19、Tailwind CSS 4 |
| 部署 | `@opennextjs/cloudflare`、Cloudflare Workers |
| 数据库 | Cloudflare D1、Drizzle ORM |
| 认证 | 自研 Session + PBKDF2（Workers 兼容） |
| 预留 | R2 附件、Turnstile 登录验证 |

## 快速开始（本地）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .dev.vars.example .dev.vars
```

### 3. 应用本地 D1 迁移

```bash
npm run db:migrate:local
```

### 4. 初始化测试账号

```bash
npm run db:seed:local
```

默认账号：

| 角色 | 邮箱 | 默认密码 |
|------|------|----------|
| Admin | `admin@crm.local` | `Admin123!` |
| Staff | `staff@crm.local` | `Staff123!` |

可通过环境变量覆盖：

```bash
SEED_ADMIN_PASSWORD='YourSecurePass' npm run db:seed:local
```

### 5. 启动开发服务器

```bash
npm run dev
```

浏览器访问 [http://localhost:3000](http://localhost:3000)（未登录会跳转到 `/login`）。

## Phase 1 测试指南

### Admin 登录

```bash
curl -i -c /tmp/crm-cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"Admin123!"}'
```

期望：`200`，`redirect: "/admin"`，响应头 `Set-Cookie` 含 `crm_session` 且带 `HttpOnly`。

浏览器：登录后进入 `/admin` 管理员工作台。

### Staff 登录

```bash
curl -i -c /tmp/crm-staff.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff@crm.local","password":"Staff123!"}'
```

期望：`200`，`redirect: "/staff"`。Staff 访问 `/admin` 会被重定向到 `/staff`。

### 5 次失败锁定

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"staff@crm.local","password":"wrong-password"}' | python3 -m json.tool
done
```

第 5 次期望返回 `423`，提示账号锁定 30 分钟。之后即使正确密码也无法登录，直到锁定过期。

验证锁定记录：

```bash
npx wrangler d1 execute crm-db --local --command \
  "SELECT email_attempted, success, failure_reason FROM login_logs ORDER BY created_at DESC LIMIT 6"
```

### 退出登录

```bash
curl -i -b /tmp/crm-cookies.txt -X POST http://localhost:3000/api/auth/logout
```

期望：`200`，Cookie 被清除，写入 `audit_logs`（`auth.logout`）。

### 当前用户

```bash
curl -s -b /tmp/crm-cookies.txt http://localhost:3000/api/auth/me | python3 -m json.tool
```

### 健康检查

```bash
curl http://localhost:3000/api/health
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | Next.js 本地开发（含 D1 模拟绑定） |
| `npm run preview` | OpenNext 构建 + Wrangler 本地预览 |
| `npm run deploy` | 构建并部署到 Cloudflare |
| `npm run db:migrate:local` | 应用迁移到本地 D1 |
| `npm run db:migrate:remote` | 应用迁移到远程 D1 |
| `npm run db:seed:local` | 初始化 Admin/Staff 测试账号 |
| `npm run cf-typegen` | 生成 `cloudflare-env.d.ts` 类型 |

## 部署到 Cloudflare（生产）

### 1. 创建远程 D1 数据库

```bash
npx wrangler d1 create crm-db
```

将返回的 `database_id` 写入 `wrangler.jsonc`。

### 2. 应用远程迁移并 seed

```bash
npm run db:migrate:remote
npm run db:seed:remote
```

### 3. 配置环境变量

参见 [docs/ENV.md](./docs/ENV.md)。生产环境务必设置强随机 `SESSION_SECRET`。

### 4. 部署

```bash
npm run deploy
```

## 数据库表

| 表名 | Phase 1 状态 |
|------|----------------|
| `users` | ✅ 登录、锁定字段 |
| `sessions` | ✅ 创建/销毁 |
| `login_logs` | ✅ 登录成功/失败 |
| `audit_logs` | ✅ 登录成功、退出、锁定 |
| `customers` 等 | 仅建表，业务未实现 |

## 项目结构

```
src/
├── app/
│   ├── (auth)/login/       # 登录页
│   ├── (dashboard)/
│   │   ├── admin/          # 管理员工作台
│   │   └── staff/          # 员工工作台
│   └── api/auth/           # login / logout / me
├── lib/
│   ├── auth/               # 密码、Session、锁定
│   ├── audit/              # 审计日志写入
│   └── permissions/        # requireAuth / requireAdmin
└── middleware.ts           # 路由守卫
```

## 备份与回滚

```bash
git checkout backup-before-d1-migration   # 迁移前 Prisma 快照
git checkout main                       # 当前 D1 版本
```

## 环境变量

详见 [docs/ENV.md](./docs/ENV.md)。
