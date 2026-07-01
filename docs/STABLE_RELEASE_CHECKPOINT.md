# CRM Stable Release Checkpoint

**建立：** Phase RELEASE-CHECKPOINT-1（2026-06-30）  
**更新：** Phase R2-RETENTION-1A（2026-07-01）— R2 backup 90 天 retention runbook 文檔（尚未設定 Cloudflare lifecycle）  
**用途：** 記錄當前穩定版本基線，方便未來回溯、deploy 對照與 rollback 決策。  
**相關：** [SYSTEM_MAP.md](./SYSTEM_MAP.md) · [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) · [BACKUP_RESTORE_RUNBOOK.md](./BACKUP_RESTORE_RUNBOOK.md) · [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md) · [TESTING.md](./TESTING.md)

---

## 1. 最新正式站基線

| 項目 | 值 |
|------|-----|
| main 最新 commit | `652d5fd` — Disable placeholder customer merge approvals |
| 最新 Cloudflare Version ID | `dac716e6-d0f0-4db5-9bef-3731b5d5c7a6` |
| 正式域名 | https://crm.echfronthk.com |
| 狀態 | MERGE-SAFE-1 已部署；未登入 Access 檢查正常；登入後 UI 仍建議人工確認 |

**MERGE-SAFE-1 部署 commit：**

| Commit | 說明 |
|--------|------|
| `652d5fd` | Disable placeholder customer merge approvals |

**AI-2 / AI-2g 部署 commits（已包含於當前 production 基線）：**

| Commit | 說明 |
|--------|------|
| `49dd7c7` | Add AI provider error handling tests |
| `603e9ad` | Stabilize notification query regression test |
| `b55f55a` | Improve AI insight error messages |
| `907dcb6` | Add AI insight refresh cooldown |
| `ea11e7f` | Add AI insight context sanitize helper |
| `5ee06c0` | Sanitize AI insight context before provider prompt |
| `df4f99b` | Document AI insight data usage scope |
| `fa2711b` | Record AI insight security release checkpoint |

**先前基線（已 supersede）：**

| 基線 | Commit | Version ID |
|------|--------|------------|
| AI-RELEASE-CHECKPOINT-1 | `df4f99b` | `6e78330d-61b1-44a9-9b5b-12edaf0429ff` |
| D-4e | `79f2dc5` | `e7dd4abe-147f-4a0c-a0aa-92f67d1041df` |

---

## 2. 最近完成的重要更新

### AI-2 / AI-2g

- AI provider 錯誤處理測試（503 / 429 / timeout / invalid response）
- AI 安全錯誤提示（API 回傳固定文案，不暴露 raw provider error）
- AI refresh **5 分鐘** cooldown（429 + `AI_REFRESH_COOLDOWN`）
- AI provider prompt **不再包含**結構化 `phone` / `wechatId` / `email`
- `notes` / `sourceRemark` / follow-ups **仍保留**
- Help Center 三語已補 AI 資料使用範圍說明（Admin / Staff 分角色 section + FAQ）
- **sourceHash：** 暫未調整（policy version 留待後續）
- **AI-2g deploy：** 主 Worker 已部署（Version `6e78330d-…`）

### MERGE-SAFE-1

- `merge_customers` placeholder 已安全禁用
- 客戶詳情「提交審批」**不再顯示**「合併客戶」申請入口
- 後端 create `merge_customers` approval 被拒絕（`MERGE_CUSTOMERS_DISABLED`）
- 後端 approve 既有 pending merge approval 被拒絕（status 保持 pending；不寫 approved audit / 通知）
- **未實作**真正客戶合併
- **未改** DB schema / migration
- **MERGE-SAFE-1 deploy：** 主 Worker 已部署（Version `dac716e6-…`）

### TAGS-STAGES-CLEANUP-1

- 移除 dead i18n：`placeholders.tagsStagesEmpty`、`placeholders.tagsStagesDescription`、`tagsStagesPage.readOnlyNotice`
- `/admin/tags-stages` 文件描述已同步：Sales Stages 只讀統計 + Customer Tags 管理

### BACKUP-EXPORT-1

- 備份 export 補齊 6 張遺漏表（`customer_assignees`、`customer_tags`、`customer_ai_insights`、`announcements`、`customer_code_counter`、`login_ip_email_restrictions`）
- JSON 結構向後相容（僅 `tables` 內新增 key）；未改 DB schema、`backup_jobs` schema、R2 key 命名
- 主 Worker 與 backup cron 已部署；詳見下方 **Backup export verification**

### 其他已穩定模組（摘要）

- **Phase F：** 敏感資料遮罩、Staff 敏感欄位鎖定、公共池脫敏
- **HELP-2 / HELP-2a：** 幫助中心分角色 sections / FAQ
- **D-4e：** 回收站 purge orphan 處理、通知 dead link fallback
- **TEST-1a / TEST-2 / TEST-4 / TEST-4a：** regression scripts 與 notifications 測試

---

## Backup export verification

Phase BACKUP-VERIFY-1 只讀驗證結果（2026-07-01）。

| 項目 | 值 |
|------|-----|
| Backup export 修復 commit | `62a3057` — Include missing CRM tables in backup export |
| Restore runbook docs commit | `470a5fe` — Document backup restore runbook |
| 主 Worker Version ID | `14c98540-9208-477b-bf53-760094d7f9d4` |
| Backup cron Version ID | `0c2a3adc-3aa4-4d3f-b826-a5bf1a4387ee` |
| Cron schedule | `0 21 * * *` UTC = **HKT 05:00** |
| 驗證時間 | **2026-07-01 16:04 HKT** |

### 最新 scheduled backup job（D1 `backup_jobs` metadata）

| 欄位 | 值 |
|------|-----|
| status | `completed` |
| file_name | `crm-backup-2026-07-01-050055.json` |
| table_count | **21** |
| record_count | **692** |
| file_size_bytes | **387,900** |
| started_at | `2026-06-30T21:00:55.735Z`（HKT 05:00:55） |
| completed_at | `2026-06-30T21:00:57.114Z`（HKT 05:00:57） |

### 新舊版對照

| | 舊版 scheduled job（BACKUP-EXPORT-1 前） | 新版 scheduled job（BACKUP-EXPORT-1 後） |
|--|------------------------------------------|------------------------------------------|
| 代表 job | `crm-backup-2026-06-30-050013.json` | `crm-backup-2026-07-01-050055.json` |
| table_count | **15** | **21** |
| record_count | 627 | 692 |
| file_size_bytes | 345,074 | 387,900 |

**結論：** BACKUP-EXPORT-1 已生效；新增 6 張表已納入 backup export。Cloudflare cron invocation 狀態為 `success`（`errors: 0`）。

### 驗證範圍與限制

- 本次只驗證 `backup_jobs` metadata 與 Cloudflare cron invocation 狀態
- **未**讀取 / **未**下載 R2 JSON
- **未**手動執行 backup
- **未** restore
- Admin UI（`/admin/backups`）仍需 **Cloudflare Access OTP** 人工確認列表顯示

恢復流程見 [BACKUP_RESTORE_RUNBOOK.md](./BACKUP_RESTORE_RUNBOOK.md)。

---

## R2 backup retention（檢查與建議）

Phase R2-RETENTION-CHECK-1 只讀檢查（2026-07-01）：

| 項目 | 狀態 |
|------|------|
| R2 retention 檢查 | **已完成**（見檢查報告；無 lifecycle expiration） |
| 推薦策略 | Cloudflare R2 lifecycle：**prefix `backups/`**，**90 天**後自動刪除 |
| 與回收站對齊 | 90 天與客戶回收站 soft-delete 保留期一致 |
| Cloudflare lifecycle 實際設定 | **尚未執行**（文檔見 `BACKUP_RESTORE_RUNBOOK.md` § R2 backup retention policy） |
| 後續候選 | **R2-RETENTION-1B** — 人工於 Dashboard 設定 90 天 lifecycle 並只讀驗證 |

---

## 3. 最新安全邊界

### 一般 CRM

| 邊界 | 說明 |
|------|------|
| Staff 敏感資料 | Staff **不可**修改姓名、聯絡方式、來源等敏感欄位 |
| Staff EF 可見性 | Staff **看不到** EF / customerCode |
| Admin 敏感資料 | Admin **可**修改敏感欄位、管理共同負責 |
| 公共池 Staff 視圖 | 姓名脫敏；quota / cooldown 限制領取 |
| 公共池 Admin 視圖 | 完整姓名與聯絡欄位 |
| 回收站保留 | **90 天** soft delete；期內可 restore |
| Permanent delete | **不可恢復**；會寫入 `customer.deleted.permanent` audit |
| Purge preview | **只讀** API；不觸發刪除 |
| Purge 行為（D-4e） | open tasks → `cancelled`；notifications 保留但 orphan link 已 fallback |
| 正式站存取 | **Cloudflare Access** OTP 保護；未登入 API 回 302 |

### AI insight（AI-2 / AI-2g）

| 邊界 | 說明 |
|------|------|
| API key | **不讀取 / 不輸出** `AI_API_KEY`；僅 Worker Secret + Admin 顯示 `apiKeyConfigured` |
| Provider 錯誤 | API **不**向前端暴露 provider raw error / HTTP body |
| Diagnostics / audit | refresh 失敗 audit **不含** prompt、raw body、secret |
| 結構化聯絡資料 | **預設不送** AI provider：`phone` / `wechatId` / `email` |
| 文字型 PII | `notes` / follow-up `summary` **仍可能**含手動輸入的聯絡方式 |
| Refresh 節流 | 同一客戶 **5 分鐘** cooldown；命中不呼叫 provider |
| 預設 provider | 正式站預設 **mock**；啟用 `openai_compatible` 需 Admin 設定 + Secret |
| Help 透明度 | Help Center 已說明 AI 資料範圍（三語） |

### Merge approvals（MERGE-SAFE-1）

| 邊界 | 說明 |
|------|------|
| 客戶詳情 UI | **不可**從 UI 提交 merge approval |
| Create API | 手動 POST `merge_customers` → `403` / `MERGE_CUSTOMERS_DISABLED` |
| Approve API | 既有 pending merge **不可**被 approve；不誤標 approved、不寫 placeholder audit |
| 歷史資料 | Approvals 列表仍可顯示歷史 merge 記錄 |
| 真正合併 | **未實作**；customers schema 無 `mergedInto` / canonical ID |

### 操作禁忌（摘要）

- **不要**在正式站對真實客戶測試 permanent delete
- **不要**隨意手動或 cron 執行 purge（需先 `purge-preview` 審閱）
- **不要**直接改 remote D1 或執行未審閱的 `npm run db:migrate:remote`
- **不要**在 production smoke 中大量點 AI refresh 或連續呼叫真實 AI provider

---

## 4. 仍需人工確認

正式站受 Cloudflare Access OTP 保護，以下項目需通過 OTP 登入後人工確認（參考 [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md)）：

| # | 檢查項 | 預期 |
|---|--------|------|
| M1 | Admin 客戶詳情「提交審批」下拉 | **無**「合併客戶」；delete / transfer / closed_won / second_conversion 仍在 |
| M2 | Staff 客戶詳情「提交審批」下拉 | **無**「合併客戶」；其他允許申請不受影響 |
| M3 | Approvals 頁 `/approvals` | 頁面正常；歷史 merge 記錄不報錯；**勿 approve** 真實申請 |
| A1 | Help Center AI 資料範圍 | 三語（繁 / 簡 / EN）顯示正常，無裸 i18n key |
| A2 | AI panel（測試客戶） | **單次** refresh 正常；cooldown 命中時顯示安全提示 |
| A3 | System Online / customers / public pool / notifications | 基本載入與導航正常 |

---

## 5. 下一步候選方向

以下為規劃候選，**本 checkpoint 未實作**：

1. **Production smoke checklist 人工補勾** — 完成 §4 各項並記錄於 checklist
2. **Backup cron / restore flow 檢查** — 備份可還原性與 runbook 對照
3. **Audit logs 是否需要入口檢查** — Admin 是否需 audit 查詢 UI
4. **真正 `merge_customers` 完整產品設計** — schema、canonical ID、衝突解決、migration
5. **AI notes / follow-ups 內嵌聯絡方式遮罩設計** — AI-2g-5 候選
6. **AI-2g-4：** 可選 Admin setting 控制 AI 是否可使用敏感聯絡資料
7. **AI-2e / AI-2f：** fallback provider、成本 / token 估算與日限額
8. **Public pool 更完整 API 測試** — claim / list 整合測
9. **UI polish** — 空狀態、loading、錯誤提示一致性
10. **Sales stages Admin CRUD** — 若需可配置階段，需 schema + migration 設計

---

## 回退參考

**Git revert（MERGE-SAFE-1 only）：**

```bash
git revert 652d5fd
git push
npm run deploy
```

**Git revert（AI-2g runtime + docs，保留 sanitize helper）：**

```bash
git revert 5ee06c0 df4f99b
git push
npm run deploy
```

**Git revert（完整 AI-2g，含 sanitize helper）：**

```bash
git revert ea11e7f 5ee06c0 df4f99b
git push
npm run deploy
```

**Cloudflare Dashboard：** Workers → `crm-system` → 回滾至上一個 production Version（MERGE-SAFE-1 前：`6e78330d-61b1-44a9-9b5b-12edaf0429ff`；AI-2 deploy 前：`7c240043-52cb-4ad3-bfdc-bf7b3fc777b9`）。

**本 checkpoint 文件回退：**

```bash
git revert <本文件 commit hash>
git push
```
