# CRM Backup Restore Runbook

本文件說明 EchFront CRM 在事故或資料異常時，如何安全地評估與執行恢復。**系統目前不提供一鍵 restore API / UI**；所有資料恢復均須在維護窗口內、經測試 D1 驗證後，由授權人員人工執行。

> **重要：** 本文檔不含任何 secret、API key 或帳密。執行命令時請使用本機已配置的 wrangler OAuth，勿將憑證寫入文檔或聊天記錄。

---

## 1. 適用場景

本 runbook 適用於以下情況：

| 場景 | 說明 |
|------|------|
| **誤 deploy 後要回退應用** | 新版本 Worker 行為異常，但 D1 資料尚未損壞 |
| **migration 前後需要資料保護** | schema 變更前後需確認有可還原快照 |
| **D1 資料異常時需要恢復** | 誤刪、錯誤寫入、部分表資料不一致 |
| **R2 JSON backup 作為災難恢復資料源** | 需從定時或手動備份 JSON 還原業務資料 |

**不適用：** 僅需回退程式碼、資料庫未受影響時——請優先使用「應用層回退」，勿動 D1。

---

## 2. 不同層級的回退方式

### A. 應用層回退

用於 **程式邏輯 / Worker 版本** 問題，**不會恢復 DB 資料**。

| 方式 | 步驟概要 |
|------|----------|
| **Cloudflare Worker Version rollback** | Dashboard → Workers → `crm-system`（及相關 cron Worker）→ Deployments → Rollback 至上一穩定 Version ID |
| **Git revert + deploy** | `git revert <commit>` → `git push` → 在乾淨 worktree 執行 `npm run deploy`（及需要的 cron deploy） |

適用：功能 bug、錯誤 deploy、需回到已知穩定 commit，且 **D1 資料無需還原**。

### B. 資料層備份

用於 **D1 資料** 需要還原或比對。

| 來源 | 用途 |
|------|------|
| **migration 前 `wrangler d1 export`** | 完整 SQL 快照；適合整庫還原或 migration 回滾評估 |
| **R2 JSON backup** | 業務表結構化匯出；適合選擇性還原、跨環境 replay |
| **Production D1 restore** | **必須在維護窗口** 執行；禁止在未驗證腳本下直接覆蓋 |

### C. 功能層回退

單一功能 commit 有問題時：

1. `git revert <commit>` 並 push
2. `npm run deploy`（主 Worker `crm-system`）
3. 若變更涉及 cron 邏輯，**分開** deploy：
   - `npm run cron:backup:deploy`（`crm-system-backup-cron`）
   - `npm run cron:recycle:deploy`（`crm-system-recycle-cron`）
   - `npm run cron:deploy`（`crm-system-reclamation-cron`）

主 Worker 與各 cron Worker **獨立部署、獨立回滾**，不可假設 `npm run deploy` 會一併更新 cron。

---

## 3. 現有備份來源

| 來源 | 說明 |
|------|------|
| **Admin 手動備份** | Admin 登入 → `/admin/backups` →「手動執行備份」；寫入 `backup_jobs` 並上傳 R2 |
| **Backup cron** | Worker：`crm-system-backup-cron`；配置：`wrangler.backup-cron.jsonc` |
| **Schedule** | `0 21 * * *` UTC = **香港時間每天 05:00** |
| **R2 路徑** | `backups/crm-backup-{timestamp}.json`（桶：`crm-attachments`，與主應用 `ATTACHMENTS` 綁定相同） |
| **migration 前 SQL export** | `npx wrangler d1 export crm-db --remote --output=backup-$(date +%Y%m%d-%H%M).sql` |

**查看最近備份任務（只讀）：**

- Admin UI：`/admin/backups`（需 Cloudflare Access + Admin 帳號）
- 或查 D1 `backup_jobs` 表的 `status`、`file_name`、`table_count`、`record_count`、`file_size_bytes`、`started_at`、`completed_at`

**BACKUP-EXPORT-1 之後：** 定時備份 `table_count` 應為 **21**（舊版為 15）。詳見第 4 節。

---

## 4. R2 JSON backup 包含內容

備份格式版本：`1.0`（見 `src/lib/backup/constants.ts`）。JSON 根結構含 `version`、`exportedAt`、`tables` 等；各表資料在 `tables.<table_name>` 下。

### 4.1 已包含的業務表（21 張）

| 表名 | 說明 |
|------|------|
| `users` | 使用者（見下方排除欄位） |
| `customers` | 客戶主檔 |
| `customer_contacts` | 客戶聯絡人 |
| `customer_assignees` | 客戶協作人員 |
| `customer_tags` | 客戶標籤關聯 |
| `customer_ai_insights` | AI 洞察快取 |
| `follow_ups` | 跟進記錄 |
| `tasks` | 任務 |
| `audit_logs` | 稽核日誌 |
| `login_logs` | 登入日誌 |
| `login_ip_email_restrictions` | 登入 IP/Email 限制 |
| `system_settings` | 系統設定 |
| `approvals` | 審批 |
| `notifications` | 通知 |
| `announcements` | 公告 |
| `import_jobs` | 匯入任務 |
| `export_jobs` | 匯出任務 |
| `field_change_logs` | 欄位變更日誌 |
| `reclamation_warning_logs` | 回收警告日誌 |
| `customer_code_counter` | 客戶編號計數器 |
| `backup_jobs` | 備份任務記錄 |

完整清單以 `src/lib/backup/export-data.ts` 與 `BACKUP_TABLE_NAMES` 為準；部署新版本後若表清單有變，請同步更新本節。

### 4.2 刻意排除

| 排除項 | 原因 |
|--------|------|
| **`sessions` 整表** | 含 `token_hash`，不應匯出或還原到備份檔 |
| **`users.password_hash`** | 密碼雜湊永不寫入備份 JSON |
| **`token_hash`（sessions）** | 隨 sessions 表一併排除 |

**恢復後影響：** 還原 JSON **不會** 還原有效登入 session。使用者需重新登入；Admin 可能需重設受影響帳號密碼（若僅還原 users 且未處理密碼策略）。

---

## 5. 恢復前安全檢查

在執行任何 restore 或覆蓋操作前，**必須**完成：

- [ ] **通知團隊暫停使用**，或進入維護模式（停止新增業務操作）
- [ ] **確認目標環境**：要恢復的是 **production D1**（`crm-db`）還是 **測試 D1**——不可搞混
- [ ] **先在測試 D1 驗證** restore / replay 腳本與資料一致性
- [ ] **不要直接覆蓋 production**——未經測試 D1 驗證的流程禁止上線
- [ ] **記錄當前 Worker Version ID**（主 Worker + 相關 cron）
- [ ] **記錄當前 git commit**（`git rev-parse HEAD`）
- [ ] **先做一次最新 D1 export**（即使即將從 R2 還原，也保留「事故當下」快照）：

  ```bash
  npx wrangler d1 export crm-db --remote --output=incident-$(date +%Y%m%d-%H%M).sql
  ```

- [ ] **確認備份來源**：`backup_jobs` 中目標 job 為 `completed`，記下 `file_name` 與時間點
- [ ] **授權**：僅 Admin / 基礎設施負責人執行 restore；保留操作記錄

---

## 6. 建議恢復流程

以下為 **安全流程指引**，**不提供** 可直接覆蓋 production 的一鍵命令。實際 SQL / 腳本須依事故範圍另行撰寫並在測試環境驗證。

### 步驟 1：確認事故範圍

- 是應用 bug、單表資料錯誤、還是全庫問題？
- 事故時間點是否早於最近一次成功備份（`backup_jobs.completed_at` 或 migration 前 export）？

### 步驟 2：先回滾 Worker（若為應用問題）

若僅程式錯誤、資料庫正確：

1. Cloudflare Dashboard 回滾 `crm-system` 至穩定 Version ID，或
2. `git revert` + `npm run deploy`（乾淨 worktree）

必要時同步回滾 `crm-system-backup-cron` 等 cron Worker。

### 步驟 3：若是資料問題——export 當前 D1

```bash
npx wrangler d1 export crm-db --remote --output=pre-restore-$(date +%Y%m%d-%H%M).sql
```

保留此檔案供事後比對與法務／稽核。

### 步驟 4：選擇 backup source

| 需求 | 建議來源 |
|------|----------|
| migration 失敗、需整庫還原 | 最近一次 **migration 前** `d1 export` SQL |
| 業務資料選擇性還原 | R2 `backups/crm-backup-*.json`（依 `backup_jobs.file_name` 定位） |
| 僅驗證備份可讀性 | 測試 D1 + restore dry-run（見第 8 節待補） |

### 步驟 5：在測試 D1 restore / replay

1. 使用 **非 production** D1 database（或本機 `wrangler d1` 測試庫）
2. 從選定備份還原或 replay 資料
3. 驗證列數、關鍵業戶、審批狀態、登入限制等

**勿在此步驟連線 production D1。**

### 步驟 6：對比資料

- 比對測試還原結果與步驟 3 的 `pre-restore` export（或與已知正確快照）
- 確認排除項（sessions、password_hash）的預期副作用已告知團隊

### 步驟 7：安排維護窗口

- 公告停機或唯讀時段
- 確認 rollback / restore 負責人與回退方案（若 restore 失敗，仍保有步驟 3 export）

### 步驟 8：Production restore

在維護窗口內，由授權人員執行 **已驗證** 的 restore 步驟（SQL import 或自訂 replay 腳本）。  
具體命令依事故腳本而定——**本文檔 intentionally 不列出 `d1 execute` 覆蓋全庫的一鍵指令**。

### 步驟 9：Smoke test

參考 [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md) 與 [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) 抽樣驗證：

- Admin / Staff 登入
- 客戶列表與詳情
- `/api/health`（經 Access）
- 備份頁 `/admin/backups` 可載入

### 步驟 10：記錄 incident

- 事故時間線、根因、使用的備份檔、`backup_jobs.id`
- Worker / git 版本
- 恢復耗時與待改進項（見第 8 節）

---

## 7. 明確禁止事項

| 禁止 | 說明 |
|------|------|
| **直接在 production 執行未驗證 SQL** | 所有 DDL/DML 批量腳本須先在測試 D1 跑過 |
| **直接覆蓋 production D1** | 未經維護窗口與雙人確認禁止 |
| **刪除 R2 backup** | 備份為最後防線；清理須有 retention 政策與審批（待補） |
| **將 backup JSON 傳給非授權人** | 含客戶與營運資料，依資料保護規範處理 |
| **未通知團隊即 restore** | 可能造成登入失效、資料覆蓋與業務中斷 |
| **在文檔或 ticket 寫入 API key / secret** | 使用 wrangler OAuth 或 Secrets Store，勿明文保存 |

---

## 8. 後續待補

以下能力尚未實作，事故時 **不可假設** 已存在：

| 項目 | 說明 |
|------|------|
| **Restore dry-run script** | 對測試 D1 解析 R2 JSON 並報告將寫入的列數，不實際寫入 |
| **Restore to test D1 script** | 一鍵將指定 `backup_jobs.file_name` replay 到測試庫 |
| **Admin download backup 權限設計** | 是否允許 Admin 從 UI 下載 JSON；審計與 Access 策略 |
| **R2 retention policy** | 自動清理舊備份的規則與例外 |
| **Backup integrity test** | 定期驗證 JSON 結構與表覆蓋（可整合 CI） |
| **Backup restore drill** | 季度演練：測試 D1 還原 + smoke，更新本 runbook |

---

## 相關文檔

- [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) — 部署與 cron 流程
- [DEPLOYMENT.md](./DEPLOYMENT.md) §8 — 備份與恢復概要
- [STABLE_RELEASE_CHECKPOINT.md](./STABLE_RELEASE_CHECKPOINT.md) — 穩定版本與備份檢查點

---

*最後更新：BACKUP-RESTORE-DOC-1（備份 export 已含 21 表；restore 仍為人工流程）*
