# CRM 測試指南

**用途：** 統一回歸測試命令，避免 deploy 前漏跑模組測試。  
**建立：** Phase TEST-4（2026-06-30）

---

## 1. 測試前置條件

### 1.1 純單元測試（`test:unit` 及多數 `test:*` 子集）

無需資料庫，可直接執行：

```bash
npm run test:unit
```

### 1.2 本地 D1 整合測試（`test:db`）

DB 測試依賴 **Wrangler local D1** 與 seed 資料。首次或 schema 變更後請先：

```bash
npm run db:migrate:local
npm run db:seed:local
```

說明：

- DB 測試透過 `getPlatformProxy` 連到 **local D1**（`wrangler.jsonc`），不是 production / remote D1。
- 多數整合測試依賴 `SEED_IDS` 中的 users / customers（來自 `npm run db:seed:local`）。
- 部分測試會短暫插入/修改 seed 列，並在 `after` hook 清理；**請勿與手動 DB smoke 或另一個 terminal 的 DB 測試同時跑**。
- 若測試失敗後 local D1 狀態異常，可重新 seed：`npm run db:seed:local`（必要時先 migrate）。

---

## 2. 常用命令

| 命令 | 說明 |
|------|------|
| `npm run test:unit` | 31 個純單元測試（無 D1） |
| `npm run test:db` | 15 個 local D1 整合測試（固定 `CRM_ALLOW_TEST_DB_BIND=1`、`--test-concurrency=1`） |
| `npm run test` | `test:unit` + `test:db`（全部 46 個 `*.test.ts`） |
| `npm run test:help` | Help Center 角色過濾 |
| `npm run test:public-pool` | 公共池 display + claim limits |
| `npm run test:permissions` | 敏感欄位 + assignee 權限（純單元） |
| `npm run test:assignees` | Assignee 相關（含 D1） |
| `npm run test:recycle-bin` | 回收站 retention + D1 整合 |
| `npm run test:users-admin` | 員工管理 stats/metadata + D1 刪除流程 |
| `npm run test:auth` | 登入、lockout、IP 限制等 |
| `npm run test:regression` | `test` + `npx tsc --noEmit` |
| `npm run test:regression:full` | `test:regression` + `npm run build`（deploy 前建議） |

---

## 3. 什麼時候跑哪些測試

| 變更類型 | 建議命令 |
|----------|----------|
| 只改文案 / Help Center | `npm run test:help && npx tsc --noEmit` |
| 改 public pool 展示 / 領取限制 | `npm run test:public-pool && npm run test:regression` |
| 改 assignees / 協作者 / 審批 | `npm run test:assignees` |
| 改 recycle bin / purge | `npm run test:recycle-bin` |
| 改權限 / 敏感欄位 | `npm run test:permissions` |
| 改登入 / lockout / session | `npm run test:auth` |
| 改 users-admin 刪除流程 | `npm run test:users-admin` |
| 改 notifications 連結 / orphan fallback | `npm run test:unit`（含 `notification-href.test.ts`）+ `npm run test:db`（含 `notifications/queries.test.ts`） |
| 改 AI provider / insight 錯誤處理 / refresh cooldown | `npm run test:unit`（含 `error-mapping.test.ts`、`cooldown.test.ts` 等）+ `npm run test:db`（含 `service-cooldown.test.ts`） |
| **Deploy 前（完整）** | `npm run test:regression:full` |

---

## 4. 注意事項

### 4.1 DB 測試並發

所有 `test:db` 及含 D1 的 `test:*` 子命令固定使用 **`--test-concurrency=1`**。  
原因：共用同一 local D1 檢件，並行可能 race（例如多檔測試同時改 `SEED_IDS.staffB` 或共用測試 customer id）。

### 4.2 `CRM_ALLOW_TEST_DB_BIND=1`

使用 `bindTestDatabase()` → `getDb()` 的測試**必須**在 shell 帶此環境變數。  
`test:db` 及相關子 script 已內建；若手動跑單檔 recycle-bin 整合測，也需加上：

```bash
CRM_ALLOW_TEST_DB_BIND=1 node --import tsx --test --test-concurrency=1 src/lib/recycle-bin/archive-customer.test.ts
```

### 4.3 Local D1 污染

- 測試可能短暫修改 seed users/customers；多數檔案會在 `after` 還原。
- 失敗中斷時可能留下測試列 → 重新 `npm run db:seed:local` 通常可恢復。
- **不要在 production / remote D1 跑這些測試**（`db:seed:remote`、remote bind 皆不適用）。

### 4.4 測試 ≠ Deploy

- `npm run test*` **不會** deploy、**不會** 執行 migration、**不會** deploy cron workers。
- 通過 regression 仍須在正式站做人工 smoke（Cloudflare Access 後驗證），見 [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md)。

---

## 5. 測試檔分布（參考）

| 類型 | 數量 | 目錄範例 |
|------|------|----------|
| 純單元 | 31 | `help/`, `permissions/`, `auth/`, `reclamation/`, `ai/`（provider、diagnostics、error-mapping、cooldown、prompt-builder）、`notifications/notification-href` |
| Local D1 | 15 | `public-pool/claim-limits`, `customers/assignees*`, `recycle-bin/*`, `users-admin/delete-*`, `notifications/queries`, `ai/customer-insights/service-cooldown` |

完整清單見 `package.json` 中 `test:unit` / `test:db` script 參數。
