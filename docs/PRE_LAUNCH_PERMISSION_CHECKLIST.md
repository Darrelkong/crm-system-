# 上线前权限回归测试清单（Phase 15A）

在绑定正式域名或开放生产访问前，请使用 **Admin** 与 **Staff** 两套账号逐项验证。本地可使用 seed 测试账号；生产请使用真实 Admin + 至少两名 Staff 测试账号。

**图例：** ✅ 通过 | ❌ 失败 | ⬜ 未测

---

## 测试账号准备

### 本地

| 角色 | 邮箱 | 密码 |
|------|------|------|
| Admin | admin@crm.local | Admin123! |
| Staff A | staff-a@crm.local | StaffA123! |
| Staff B | staff-b@crm.local | StaffB123! |

```bash
# 登录并保存 cookie（示例）
curl -s -c /tmp/crm-admin.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"Admin123!"}'

curl -s -c /tmp/crm-staff-a.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff-a@crm.local","password":"StaffA123!"}'

curl -s -c /tmp/crm-staff-b.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff-b@crm.local","password":"StaffB123!"}'
```

---

## A. Admin 权限（应全部允许）

| # | 场景 | 操作 | HTTP / 页面预期 | 结果 |
|---|------|------|-----------------|------|
| A1 | 查看全部客户 | `GET /api/customers`（Admin cookie） | 200，含所有员工客户 | ⬜ |
| A2 | 查看 Staff B 的客户详情 | `GET /api/customers/:staffBCustomerId` | 200，完整字段 | ⬜ |
| A3 | 导入 | 访问 `/import/customers` 或 `POST /api/import/customers` | 200 / 页面可访问 | ⬜ |
| A4 | 导出 | 访问 `/export/customers` 或 `POST /api/export/customers` | 200 | ⬜ |
| A5 | 敏感导出确认 | 导出 scope=all 或 includeSensitive=true | 前端需二次确认 | ⬜ |
| A6 | 备份 | 访问 `/admin/backups`，触发备份 | 200，任务成功 | ⬜ |
| A7 | 用户管理 | 访问 `/admin/users` | 200，无 password_hash 字段 | ⬜ |
| A8 | 审批 | `POST /api/approvals/:id/approve` | 200 | ⬜ |
| A9 | 公告管理 | 访问 `/admin/announcements`，创建/编辑 | 200 | ⬜ |
| A10 | 系统设置 | 访问 `/admin/settings`，修改并保存 | 200 | ⬜ |
| A11 | Admin 面板 | 访问 `/admin` | 200 | ⬜ |
| A12 | 导出审计 | 导出后查 audit_logs | 有 export 相关记录 | ⬜ |

---

## B. Staff 权限（应拒绝管理类操作）

| # | 场景 | 操作 | HTTP / 页面预期 | 结果 |
|---|------|------|-----------------|------|
| B1 | 仅看自己客户 | `GET /api/customers`（Staff A） | 200，仅 owner=Staff A | ⬜ |
| B2 | 不能看他人客户 | `GET /api/customers/:staffBCustomerId`（Staff A） | **403** | ⬜ |
| B3 | 公共池脱敏 | `GET /api/customers/:poolCustomerId`（Staff B，非释放人） | 200，敏感字段脱敏 | ⬜ |
| B4 | 不能导入 | 访问 `/import/customers` | **403** 或拒绝页 | ⬜ |
| B5 | 不能导出 | 访问 `/export/customers` 或 `POST /api/export/customers` | **403** | ⬜ |
| B6 | 不能备份 | 访问 `/admin/backups` | 重定向或 **403** | ⬜ |
| B7 | 不能管理用户 | 访问 `/admin/users` | 重定向至 `/staff` 或 **403** | ⬜ |
| B8 | 不能改系统设置 | 访问 `/admin/settings` | 重定向或 **403** | ⬜ |
| B9 | 不能审批 | `POST /api/approvals/:id/approve`（Staff） | **403** | ⬜ |
| B10 | 不能管理公告 | 访问 `/admin/announcements` | 重定向或 **403** | ⬜ |
| B11 | 不能进 Admin 首页 | 访问 `/admin` | 重定向至 `/staff` | ⬜ |
| B12 | 可提交审批 | `POST /api/approvals`（Staff，合法场景） | 200（若业务允许） | ⬜ |

### Staff API 快速探测（期望 403）

```bash
curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" -X POST http://localhost:3000/api/export/customers \
  -H 'Content-Type: application/json' -d '{"scope":"mine","format":"csv"}'

curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" http://localhost:3000/api/admin/backups

curl -s -b /tmp/crm-staff-a.txt -w "\n%{http_code}\n" http://localhost:3000/api/admin/users
```

---

## C. 公共池（Public Pool）

| # | 场景 | 操作 | 预期 | 结果 |
|---|------|------|------|------|
| C1 | 原释放人不能看完整详情 | Staff A 释放的客户，Staff A 查看公共池该客户 | 脱敏视图，非 full | ⬜ |
| C2 | 不能领取自己释放的 | Staff A `POST` 领取自己释放的客户 | **400/403** | ⬜ |
| C3 | 7 天领取限制 | 新 Staff 注册后 7 天内尝试领取 | **403**（若设置启用） | ⬜ |
| C4 | 冷却期 | 领取后冷却期内再次领取 | **403**（若设置启用） | ⬜ |
| C5 | 其他 Staff 可领取 | Staff B 领取 Staff A 释放的客户 | 200（满足规则时） | ⬜ |

---

## D. 归档（Archived）

| # | 场景 | 操作 | 预期 | 结果 |
|---|------|------|------|------|
| D1 | Staff 普通列表不显示 archived | `GET /api/customers`（Staff，无 archived 筛选） | 不含 archived 客户 | ⬜ |
| D2 | 不能编辑 archived | `PATCH /api/customers/:archivedId`（Staff） | **403/400** | ⬜ |
| D3 | 不能跟进 archived | `POST /api/customers/:id/follow-ups` | **403/400** | ⬜ |
| D4 | 不能释放 archived | `POST /api/customers/:id/release` | **403/400** | ⬜ |
| D5 | 不能对 archived 提交审批 | `POST /api/approvals`（archived 相关） | **403/400** | ⬜ |
| D6 | Admin 可查 archived | `GET /api/customers?status=archived`（Admin） | 200 | ⬜ |

---

## E. 高风险功能专项检查

| # | 检查项 | 验证方法 | 预期 | 结果 |
|---|--------|----------|------|------|
| E1 | 导出 fields 白名单 | 请求含非法 field 名 | 非法字段被忽略或 400 | ⬜ |
| E2 | includeSensitive=false | 导出响应 CSV/JSON | 无 phone/wechat/notes 等敏感列 | ⬜ |
| E3 | 敏感导出确认 | UI 勾选敏感或全库导出 | 弹出确认文案 | ⬜ |
| E4 | 导出审计 | 完成导出后查 audit | 有记录 | ⬜ |
| E5 | 备份无 password_hash | 下载备份 JSON，检查 users 行 | 无 password_hash 键 | ⬜ |
| E6 | 备份无 sessions | 备份 JSON tables | 无 sessions 表数据 | ⬜ |
| E7 | 备份失败通知 | 模拟失败（如 R2 不可用） | Admin 收到通知 | ⬜ |
| E8 | 回收排除终态 | 对 closed_won/lost/archived 跑回收 | 不被回收 | ⬜ |
| E9 | system_settings 生效 | 修改回收天数/公共池规则后验证 | 行为随设置变化 | ⬜ |

---

## F. 生产环境专属（上线前）

| # | 检查项 | 预期 | 结果 |
|---|--------|------|------|
| F1 | 无 @crm.local 用户 | 查 users 表 | 0 条 | ⬜ |
| F2 | Debug API | `GET /api/debug/auth-check` | **404** | ⬜ |
| F3 | ENABLE_DEBUG_API 未开启 | Dashboard 变量检查 | 未设置或 false | ⬜ |
| F4 | SESSION_SECRET 非默认值 | 生产变量检查 | 已更换 | ⬜ |
| F5 | 初始 Admin 密码已轮换 | 人工确认 | 已修改 | ⬜ |

---

## 签署

| 角色 | 姓名 | 日期 | 备注 |
|------|------|------|------|
| 测试人 | | | |
| 审核人 | | | |

失败项请记录 issue 编号与复现步骤，修复后重新跑相关章节。
