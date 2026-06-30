# CRM 部署 Runbook

**用途：** 快速對照「什麼時候 deploy 什麼」、部署前後檢查與回退。  
**建立：** Phase SYSTEM-MAP-1（2026-06-30）  
**詳細說明：** 見 [DEPLOYMENT.md](./DEPLOYMENT.md)

**Production 基線（撰寫時）：**

| 項目 | 值 |
|------|-----|
| Commit | `8f98634` |
| Version ID | `83be19d0-14e5-4bdf-802a-8be4e4ac96ce` |
| 網域 | `crm.echfronthk.com` |

---

## 1. 部署類型總覽

| 類型 | 命令 | Worker | 何時需要 |
|------|------|--------|----------|
| **主應用** | `npm run deploy` | `crm-system` | 幾乎所有 UI / API 變更 |
| **自動回收 Cron** | `npm run cron:deploy` | `crm-system-reclamation-cron` | 回收邏輯變更 |
| **備份 Cron** | `npm run cron:backup:deploy` | `crm-system-backup-cron` | 備份邏輯變更 |
| **回收站 Purge Cron** | `npm run cron:recycle:deploy` | `crm-system-recycle-cron` | 90 天 purge 邏輯變更 |
| **D1 Migration** | `npm run db:migrate:remote` | — | 僅 schema 變更；**需維護窗口** |

> **常見錯誤：** 只跑 `npm run deploy` 以為 Cron 也更新了。Cron 是**獨立 Worker**，需各自 deploy。

---

## 2. 一般主 Worker 部署

### 2.1 適用範圍

- Next.js 頁面、元件、i18n
- API routes（`/api/*`）
- 權限、業務邏輯（無 schema 變更）
- Help Center、公共池展示等

### 2.2 部署前

```bash
git status                    # 確認乾淨、在正確分支
git pull origin main          # 與 remote 同步

npm run test:regression:full  # 建議：全量測試 + tsc + build
```

**測試分級（依變更範圍縮小）：**

| 變更 | 最低建議 |
|------|----------|
| UI / i18n 小改 | `npx tsc --noEmit && npm run build` |
| Help Center | `npm run test:help` + tsc |
| Public pool | `npm run test:public-pool` |
| Assignees | `npm run test:assignees` |
| Recycle bin | `npm run test:recycle-bin` |
| 權限 / 敏感欄位 | `npm run test:permissions` |

詳見 [TESTING.md](./TESTING.md)。

> **注意：** 測試通過不代表 production smoke 已完成。正式站仍須 Admin / Staff 各一輪人工驗證（需通過 Cloudflare Access），見 [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md)。

### 2.3 部署

```bash
git push origin main          # 先 push（團隊協作 / CI 習慣）

npm run deploy
# 等價於：opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

記錄輸出中的 **Version ID**，例如：

```text
Current Version ID: 83be19d0-14e5-4bdf-802a-8be4e4ac96ce
```

### 2.4 部署後

1. 確認 Cloudflare Dashboard → Workers → `crm-system` 版本已更新。
2. 執行 [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md)（至少 Admin + Staff 各一輪關鍵項）。
3. 確認 `GET https://crm.echfronthk.com/api/health` 回 `{ "status": "ok" }`（需通過 Access 後在瀏覽器或 curl with cookie）。

### 2.5 不需要主 Worker deploy 的變更

- 僅 `docs/` 變更
- 僅本地 seed / 測試腳本
- 僅 Cron Worker 程式（見第 3 節）

---

## 3. Cron Workers 部署

Cloudflare Cron 使用 **UTC**。香港時間 UTC+8：

| Worker | 配置檔 | Cron (UTC) | 香港時間 | 功能 |
|--------|--------|------------|----------|------|
| `crm-system-reclamation-cron` | `wrangler.cron.jsonc` | `0 21 * * *` | 每天 **05:00** | 客戶自動回收到公共池 |
| `crm-system-backup-cron` | `wrangler.backup-cron.jsonc` | `0 21 * * *` | 每天 **05:00** | D1 備份至 R2 |
| `crm-system-recycle-cron` | `wrangler.recycle-cron.jsonc` | `30 21 * * *` | 每天 **05:30** | 回收站 90 天到期 purge |

### 3.1 部署命令

```bash
npm run cron:deploy              # 自動回收
npm run cron:backup:deploy       # 備份
npm run cron:recycle:deploy      # 回收站 purge
```

### 3.2 Recycle Cron 部署前必讀

**首次啟用或邏輯變更後：**

1. Admin 登入正式站。
2. 只讀檢查：

   ```http
   GET /api/admin/recycle-bin/purge-preview?limit=50
   ```

3. 確認 `expiredCount` 為 **0**，或已人工審閱每一筆待清理客戶。
4. 再執行 `npm run cron:recycle:deploy`。

### 3.3 Cron 部署後

- Cloudflare Dashboard → 對應 Worker → Logs / Observability
- 次日 05:00–05:30（HKT）後檢查是否有錯誤
- 備份：Admin → `/admin/backups` 確認新任務

---

## 4. D1 Migration（謹慎）

**本 runbook 不自動執行 migration。** 僅在明確 schema 變更且已備份時，由負責人手動執行。

### 4.1 部署前備份（必做）

```bash
npx wrangler d1 export crm-db --remote --output=backup-$(date +%Y%m%d-%H%M).sql
```

### 4.2 檢查待套用 migration

```bash
npx wrangler d1 migrations list crm-db --remote
```

若顯示 `No migrations to apply!` 則無需操作。

### 4.3 套用（維護窗口）

```bash
npm run db:migrate:remote
# 等價於：wrangler d1 migrations apply crm-db --remote
```

### 4.4 Migration 後

1. 驗證表結構。
2. **仍需** `npm run deploy`（若應用程式碼依賴新 schema）。
3. 完整 smoke checklist。

> D1 **不支援**自動 down migration。失敗時見 [DEPLOYMENT.md §4.4](./DEPLOYMENT.md)。

---

## 5. 僅文檔 / i18n 變更

| 變更類型 | deploy? | migration? |
|----------|---------|------------|
| 僅 `docs/` | ❌ | ❌ |
| 僅 i18n（`src/i18n/`） | ✅ 主 Worker | ❌ |
| Help Center 文案 | ✅ 主 Worker | ❌ |

---

## 6. Secrets 與環境變數

不在 git 中；透過 Cloudflare 設定：

```bash
wrangler secret put SESSION_SECRET
wrangler secret put AI_API_KEY    # 若使用真實 AI provider
```

| 變數 | 生產 | 說明 |
|------|------|------|
| `SESSION_SECRET` | **必填** | Session 簽名 |
| `AI_API_KEY` | 選填 | 真實 AI 時必填 |
| `ENABLE_DEBUG_API` | **保持未設或 false** | 生產預設關閉 debug API |

完整列表：[ENV.md](./ENV.md)

---

## 7. 回退（Rollback）

### 7.1 主 Worker 程式回退

**方式 A — Git revert（推薦）：**

```bash
git revert <bad-commit-hash>
git push origin main
npm run deploy
```

**方式 B — Cloudflare Dashboard：**

Workers → `crm-system` → Deployments → 選擇上一個 Version ID → Rollback

記錄 rollback 前後 Version ID。

### 7.2 Cron 回退

對應 Worker（`crm-system-reclamation-cron` 等）在 Dashboard 回滾至上一版本，或 checkout 舊 commit 後重新 `npm run cron:*:deploy`。

### 7.3 Migration 回退

**無自動 down。** 需從部署前 `wrangler d1 export` 快照或 R2 備份評估恢復。停止 deploy 新版本直至資料一致。

---

## 8. 部署檢查清單（Quick）

### 每次主 Worker deploy

- [ ] `git status` clean
- [ ] `npm run build` 通過
- [ ] `git push` 完成
- [ ] `npm run deploy` 成功
- [ ] 記錄 Version ID
- [ ] Production smoke（關鍵路徑）
- [ ] **未**誤跑 `db:migrate:remote`（除非計劃內）

### 含 schema 變更的 release

- [ ] D1 export 備份
- [ ] `db:migrate:remote` 在維護窗口
- [ ] 主 Worker deploy
- [ ] 若 Cron 邏輯有變：對應 `cron:*:deploy`
- [ ] 完整 smoke + 權限回歸（[PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md)）

### 禁止在一般 deploy 順帶執行

```bash
# 除非明確計劃且已備份
npm run db:migrate:remote
npm run cron:recycle:deploy   # 未審閱 purge-preview 前
npm run db:seed:remote        # 生產 seed 需環境變數門禁
```

---

## 9. 常用命令速查

```bash
# 本地開發
npm run dev
npm run db:migrate:local
npm run db:seed:local

# 驗證
npx tsc --noEmit
npm run build

# 生產
npm run deploy
npm run cron:deploy
npm run cron:backup:deploy
npm run cron:recycle:deploy

# 只讀
npx wrangler d1 migrations list crm-db --remote
npx wrangler d1 export crm-db --remote --output=backup.sql
curl -s https://crm.echfronthk.com/api/health
```

---

## 10. 相關文件

| 文件 | 內容 |
|------|------|
| [SYSTEM_MAP.md](./SYSTEM_MAP.md) | 功能地圖、模組狀態、權限矩陣 |
| [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md) | 正式站人工 smoke |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 完整部署、seed、安全清單 |
| [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) | API 權限回歸 |
| [ENV.md](./ENV.md) | 環境變數 |

---

*Runbook 隨 Phase 更新；deploy 後請將 Version ID 填入 SYSTEM_MAP 或 release note。*
