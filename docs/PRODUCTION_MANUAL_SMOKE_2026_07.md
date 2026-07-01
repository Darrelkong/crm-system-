# 正式站人工總驗收清單（2026-07）

**Phase：** PRODUCTION-MANUAL-SMOKE-1  
**網域：** https://crm.echfronthk.com  
**原因：** 正式站受 **Cloudflare Access OTP** 保護，需 Admin / Staff 各一組帳號人工逐項確認。  
**對照基線：** commit `568ceea`（audit UI）· checkpoint `099d386` · Version ID `537d7889-4300-420a-869d-4b21a6b10011`

**圖例：** ⬜ 未測 · ✅ 通過 · ❌ 失敗 · ⚠️ 需備註 · ⏭️ 跳過

**相關：** [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md) · [STABLE_RELEASE_CHECKPOINT.md](./STABLE_RELEASE_CHECKPOINT.md) · [SYSTEM_MAP.md](./SYSTEM_MAP.md)

---

## 測前準備

1. 通過 Cloudflare Access（Email OTP）。
2. 準備 **Admin** 與 **Staff** 各一組正式帳號（勿用 `@crm.local`）。
3. 建議 Chrome / Safari **無痕視窗**分開測 Admin / Staff。
4. 語言切換：側欄用戶選單 → 語言（繁體 / 簡體 / English）。
5. 記錄測試日期、測試人、當前 commit / Version ID。

| 項目 | 值 |
|------|-----|
| 測試日期 | |
| 測試人 | |
| Commit / Version ID | |
| Admin 帳號（遮罩） | |
| Staff 帳號（遮罩） | |

---

## 1. Admin 登入

### 全局與儀表盤

| # | 檢查項 | 預期 | 結果 | 備註 |
|---|--------|------|------|------|
| AD1 | Admin 登入 CRM | 成功進入 `/admin` | ⬜ | |
| AD2 | **System Online** badge | 顯示 **SYSTEM ONLINE**（或 degraded 有說明） | ⬜ | |
| AD3 | **Dashboard** `/admin` | KPI、工作流程面板有數據或合理空狀態 | ⬜ | |

### 客戶管理

| # | 檢查項 | 預期 | 結果 | 備註 |
|---|--------|------|------|------|
| AD4 | **客戶列表** `/customers` | 可載入、可搜尋、分頁正常 | ⬜ | |
| AD5 | **客戶詳情** `/customers/[id]` | 詳情頁載入；EF / customerCode 可見 | ⬜ | |
| AD6 | **編輯客戶** `/customers/[id]/edit` | 可進入編輯；Admin 可改敏感欄位 | ⬜ | |
| AD7 | **AI panel** | 客戶詳情 AI insight 區塊載入；**單次** refresh 可試 | ⬜ | 勿連續 refresh |

### 系統管理（Admin-only）

| # | 檢查項 | 預期 | 結果 | 備註 |
|---|--------|------|------|------|
| AD8 | **審計日誌** `/admin/audit-logs` | 側欄 **系統設定 → 審計日誌** 可進入；列表可載入；metadata 預設摺疊 | ⬜ | AUDIT-UI-1 |
| AD9 | **備份頁** `/admin/backups` | 備份 job 列表可見；**不要**點「立即備份」 | ⬜ | 只讀查看 |
| AD10 | **標籤與階段** `/admin/tags-stages` | Sales Stages 只讀統計 + Customer Tags 管理；**無** coming soon 佔位 | ⬜ | |
| AD11 | **回收站** `/admin/recycle-bin` | 列表載入；restore / permanent delete **只測取消** | ⬜ | |
| AD12 | **員工管理** `/admin/users` | 列表、新增 Staff 入口正常；刪除 preview **只測取消** | ⬜ | |

### Help Center 三語（Admin）

| # | 語言 | 檢查 `/help` 與側欄 | 結果 | 備註 |
|---|------|---------------------|------|------|
| AD13 | 繁體 | sections / FAQ 正常；無裸 i18n key | ⬜ | |
| AD14 | 簡體 | 同上 | ⬜ | |
| AD15 | English | 同上 | ⬜ | |

---

## 2. Staff 登入

### 全局與客戶

| # | 檢查項 | 預期 | 結果 | 備註 |
|---|--------|------|------|------|
| ST1 | Staff 登入 CRM | 成功進入 `/staff` | ⬜ | |
| ST2 | **Staff dashboard** `/staff` | KPI、任務、審批摘要有數據或合理空狀態 | ⬜ | |
| ST3 | **客戶列表** `/customers` | 僅 scope 內客戶；無 EF | ⬜ | |
| ST4 | **客戶詳情** `/customers/[id]` | 有權客戶可開詳情 | ⬜ | |

### 敏感資料與公共池

| # | 檢查項 | 預期 | 結果 | 備註 |
|---|--------|------|------|------|
| ST5 | **敏感欄位鎖定** | 編輯頁姓名 / 電話 / 來源等 **disabled** 或不可改 | ⬜ | F-3 |
| ST6 | **聯絡方式小眼睛** | 詳情頁電話 / 微信 / 電郵預設遮罩；小眼睛可暫時查看 | ⬜ | F-4 |
| ST7 | **公共池脫敏** `/public-pool` | 列表姓名脫敏（如 `張**`）；quota / cooldown 提示正常 | ⬜ | F-5 |

### Help Center 三語（Staff）

| # | 語言 | 檢查 `/help` 與側欄 | 結果 | 備註 |
|---|------|---------------------|------|------|
| ST8 | 繁體 | Staff sections / FAQ 正常；無 Admin-only section | ⬜ | |
| ST9 | 簡體 | 同上 | ⬜ | |
| ST10 | English | 同上 | ⬜ | |

### 無 Admin-only nav

| # | 檢查項 | 預期 | 結果 | 備註 |
|---|--------|------|------|------|
| ST11 | 側欄無 Admin 入口 | **無** 員工管理、回收站、審計日誌、備份、標籤與階段、AI 設定、公告管理、匯入 / 匯出 | ⬜ | |
| ST12 | 直接訪問 Admin URL | 開 `/admin/audit-logs` 或 `/admin/users` → 被拒絕或導向 | ⬜ | |

---

## 3. 近期重點功能

| # | 功能 | 檢查方式 | 預期 | 結果 | 備註 |
|---|------|----------|------|------|------|
| R1 | **AI 不連續 refresh** | 同一客戶連續點兩次 refresh | 第二次顯示 cooldown 提示，不連續呼叫 provider | ⬜ | AI-2g |
| R2 | **merge_customers 不再出現在提交審批** | 客戶詳情「提交審批」下拉 | **無**「合併客戶」選項 | ⬜ | MERGE-SAFE-1 |
| R3 | **audit logs 頁只讀可查** | `/admin/audit-logs` | 列表、filter、載入更多可用；**無** 編輯 / 刪除 / export 按鈕 | ⬜ | AUDIT-UI-1 |
| R4 | **backup jobs 列表可見** | `/admin/backups` | 顯示歷史 job（status、table_count 等） | ⬜ | BACKUP-EXPORT-1 |
| R5 | **tags-stages 無 coming soon** | `/admin/tags-stages` | 無 dead placeholder / coming soon 文案 | ⬜ | TAGS-STAGES-CLEANUP-1 |
| R6 | **public pool 立即查看** | Staff 公共池列表 | 「立即查看」或等效入口可進詳情（脫敏視圖） | ⬜ | |
| R7 | **customer create 5 秒確認** | Staff 新增客戶 | 提交前出現 **5 秒** 確認 modal | ⬜ | F-2 |

---

## 4. 明確禁止（正式站勿做）

以下操作在正式站 smoke **禁止執行**：

| # | 禁止項 | 原因 |
|---|--------|------|
| ⛔ | **Permanent delete 真實客戶** | 不可恢復 |
| ⛔ | **手動 backup**（點「立即備份」） | 非必要勿觸發 production 備份 |
| ⛔ | **Restore 備份 / D1 restore** | 可能覆寫 production 資料 |
| ⛔ | **Migration**（`db:migrate:remote` 等） | 需 runbook 審批流程 |
| ⛔ | **Approve 真實 merge** | merge 仍為 placeholder |
| ⛔ | **刪除正式標籤** | 影響 production 客戶資料 |
| ⛔ | **大量 refresh AI** | 可能觸發 provider 限流 / 成本 |

---

## 驗收摘要

| 區塊 | 通過 | 失敗 | 跳過 | 備註 |
|------|------|------|------|------|
| 1. Admin 登入 | | | | |
| 2. Staff 登入 | | | | |
| 3. 近期重點功能 | | | | |
| **整體** | ⬜ 可上線 · ⬜ 有阻斷項 · ⬜ 待補測 | | | |

**簽核：**

| 角色 | 姓名 | 日期 | 簽名 / 備註 |
|------|------|------|-------------|
| 測試人 | | | |
| 覆核（可選） | | | |

---

*建立：Phase PRODUCTION-MANUAL-SMOKE-1（2026-07-01）*
