# Legacy Code Archive

此目录保存 **Cloudflare D1 迁移之前** 的 Prisma + NextAuth 原型代码，仅供参考与回滚，不再参与构建。

## 备份分支

完整快照已保存在 Git 分支：

```bash
git checkout backup-before-d1-migration
```

该分支包含迁移前的全部文件状态（含 `prisma/`、NextAuth 登录、Company/Contact 模型等）。

## 目录说明

| 路径 | 说明 |
|------|------|
| `prisma/` | 旧 Prisma schema、迁移与 seed |
| `prisma.config.ts` | Prisma 7 配置文件 |
| `dev.db` | 旧本地 SQLite 数据库文件 |
| `src/lib/auth.ts` | NextAuth 配置 |
| `src/lib/auth.config.ts` | NextAuth 路由守卫 |
| `src/lib/db.ts` | Prisma 客户端 |
| `src/middleware.ts` | NextAuth 中间件 |
| `src/app/login/` | 旧登录页 |
| `src/app/register/` | 旧注册页 |
| `src/app/dashboard/` | 旧仪表盘与公司/联系人/任务/备注页面 |
| `src/app/api/` | NextAuth 与注册 API |
| `src/components/` | SessionProvider、侧边栏等旧 UI |

## 清理时机

待 D1 架构在 Phase 3 稳定运行后，可评估是否删除本目录。删除前请确认 `backup-before-d1-migration` 分支已推送到远程仓库。
