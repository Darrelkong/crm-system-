# CRM 系統功能地圖

**文件用途：** 單一來源的功能地圖、模組狀態與權限摘要，供後續開發 / 測試 / 部署對照。
**建立：** Phase SYSTEM-MAP-1（2026-06-30）
**更新：** Phase AUDIT-CHECKPOINT-1（2026-07-01）— Admin 審計日誌只讀頁已上線
**資料來源：** SYSTEM-CHECK-1 只讀檢查 + 程式碼結構（`src/lib/layout/nav-links.ts`、`src/lib/permissions/*`）

**相關文件：**

- [正式站手動 Smoke Checklist](./PRODUCTION_SMOKE_CHECKLIST.md)
- [部署 Runbook](./DEPLOY_RUNBOOK.md)
- [部署與上線指南（詳細版）](./DEPLOYMENT.md)
- [上線前權限測試清單](./PRE_LAUNCH_PERMISSION_CHECKLIST.md)

---

## 1. 系統版本狀態

| 項目 | 值 |
|------|-----|
| 分支 | `main` |
| 最新 commit | `568ceea` — Add admin audit log page |
| Production Worker | `crm-system` @ `crm.echfronthk.com` |
| 最新 Production Version ID | `537d7889-4300-420a-869d-4b21a6b10011` |
| Git 工作區 | clean，與 `origin/main` 同步 |
| D1 migrations（remote） | 已套用至最新（`0025_customer_assignees_foundation.sql`，共 25 檔） |

### 最新已完成 Phase

| Phase | Commit | 摘要 |
|-------|--------|------|
| **AUDIT-UI-1b** | `568ceea` | Admin 審計日誌只讀頁 + nav 入口 |
| **AUDIT-UI-1a** | `7f734e6` | Admin-only audit logs query API |
| **F-2** | `8dff9eb` | 新增客戶 5 秒確認 modal |
| **F-3a** | `994be56` | Staff PATCH 敏感欄位後端鎖定 |
| **F-3b** | `4cff5e3` | Staff 編輯表單敏感欄位 disabled |
| **F-4** | `b255f15` | 客戶詳情聯絡方式預設遮罩（小眼睛切換） |
| **F-5** | `a33e700` | 公共池 Staff 脫敏展示與領取成功 UX |
| **HELP-2** | `7c47b6e` | 幫助中心角色化內容（Admin / Staff / FAQ） |
| **HELP-2a** | `8f98634` | 繁中公共池配額說明文案修正 |

---

## 2. Admin 導航地圖

導航定義：`src/lib/layout/nav-links.ts` → `getAdminNavGroups()`
Middleware：`/admin/*`、`/import/*`、`/export/*` 僅 Admin 可進入。

| 路徑 | 用途 | 狀態 | 主要風險或備註 |
|------|------|------|----------------|
| `/admin` | Admin 儀表盤：KPI、工作流程優先、團隊績效 | ✅ 已完成 | — |
| `/customers` | 全庫客戶管理、詳情、跟進、AI insight | ✅ 已完成 | 含子路由 `/customers/new`、`/[id]`、`/edit` |
| `/follow-ups` | 全域跟進列表（Admin 視圖） | ✅ 已完成 | — |
| `/public-pool` | 公共池完整視圖、無領取 quota 限制 | ✅ 已完成 | F-5 後 Admin 可看完整姓名 |
| `/approvals` | 審批中心：通過 / 拒絕各類申請 | ✅ 已完成 | `merge_customers` 審批執行仍為 placeholder |
| `/reports` | 客戶 / 跟進 / 團隊營運報表 | ✅ 已完成 | — |
| `/notifications` | 通知中心、未讀 badge | ✅ 已完成 | — |
| `/admin/announcements` | 公告發布 / 歸檔 | ✅ 已完成 | — |
| `/admin/ai-settings` | AI provider、model、prompt 設定 | ✅ 已完成 | 外部 API 503 時 insight 刷新失敗 |
| `/admin/users` | 員工管理：新增、解鎖、重設密碼、軟刪除 | ✅ 已完成 | 刪除前有 preview modal |
| `/admin/tags-stages` | Sales Stages 只讀統計 + Customer Tags 管理 | ✅ 已完成 | 階段來自常數；標籤 CRUD 寫入 `customer_tags` |
| `/admin/recycle-bin` | 回收站：恢復 / 永久刪除 | ✅ 已完成 | **正式站勿隨意 permanent delete** |
| `/admin/settings` | 系統參數（回收天數、公共池 quota 等） | ✅ 已完成 | Help Center 預設值以 constants 為準，可能與 DB 實際值不同 |
| `/help` | 幫助中心（Admin 11 sections + 10 FAQ） | ✅ 只讀 | HELP-2 / 2a 已上線 |
| `/admin/login-logs` | 登入嘗試日誌 | ✅ 已完成 | 系統設定子選單 |
| `/admin/audit-logs` | 審計日誌（Admin-only 只讀） | ✅ 已完成 | 系統設定子選單；filters + cursor 載入更多；metadata 摺疊；**無** export / delete |
| `/admin/settings/security` | 安全策略（IP / Email 限制等） | ✅ 已完成 | 系統設定子選單 |
| `/admin/backups` | 備份任務觸發與列表 | ✅ 已完成 | 系統設定子選單 |
| `/import/customers` | CSV 客戶匯入（預檢 + commit） | ✅ 已完成 | 系統設定子選單；Admin API 三層守衛 |
| `/export/customers` | 客戶資料匯出 | ✅ 已完成 | 敏感欄位需二次確認 |

**不在側欄、但 Admin 可達：**

| 路徑 | 用途 | 狀態 |
|------|------|------|
| `/account` | 帳戶中心、改密碼 | ✅ |
| `/change-password` | 強制改密（middleware 導向） | ✅ |

---

## 3. Staff 導航地圖

導航定義：`getStaffNavGroups()`
Middleware：Staff 訪問 `/admin` 會被導向 `/admin`（Admin）或 `/staff`（Staff）。

| 路徑 | 用途 | 狀態 | 主要權限限制 |
|------|------|------|--------------|
| `/staff` | Staff 儀表盤：我的客戶、任務、審批、風險 KPI | ✅ 已完成 | 僅 Staff 角色 |
| `/customers` | 負責 / 協作客戶列表與詳情 | ✅ 已完成 | 僅 scope 內客戶；無 EF；敏感欄位鎖定（F-3） |
| `/follow-ups` | 個人相關跟進列表 | ✅ 已完成 | 僅可見有權限客戶的跟進 |
| `/public-pool` | 脫敏公共池、quota / cooldown 領取 | ✅ 已完成 | 不可看完整姓名；不可領自己釋放的客戶 |
| `/approvals` | 查看自己提交的審批狀態 | ✅ 已完成 | **不可**批准 / 拒絕（僅 Admin） |
| `/reports` | 個人客戶 / 跟進摘要 | ✅ 已完成 | 僅個人數據 |
| `/notifications` | 審批結果、回收預警等 | ✅ 已完成 | — |
| `/announcements` | 閱讀公司公告 | ✅ 只讀 | 不可發布 / 編輯 |
| `/help` | 幫助中心（Staff 9 sections + 9 FAQ） | ✅ 只讀 | HELP-2 / 2a |

**Staff 不可達（middleware + API）：**
`/admin/*`、`/import/*`、`/export/*`、回收站 UI、`/admin/recycle-bin`

---

## 4. 核心模組總覽

| 模組 | 狀態 | 角色 | 風險 | 下一步建議 |
|------|------|------|------|------------|
| **Login / session** | ✅ | 全部 | Cloudflare Access OTP 阻擋自動化 prod login | 正式站用手動 checklist |
| **System Online / health** | ✅ | 全部（badge） | 連續 poll 失敗才顯示 offline | 正式站確認 badge 為 SYSTEM ONLINE |
| **Admin Dashboard** | ✅ | Admin | — | — |
| **Staff Dashboard** | ✅ | Staff | — | — |
| **客戶管理** | ✅ | Admin 全庫；Staff scope | — | — |
| **新增客戶** | ✅ | Staff owner / Admin | F-2 五秒確認；seed `requestedProjectName` null 可能導致 validation 400 | 測試客戶請填完整必填欄位 |
| **編輯客戶** | ✅ | Owner / Admin | Staff 敏感欄位鎖定 | — |
| **敏感資料鎖定（F-3）** | ✅ | Staff 建立後不可改 | PATCH + 表單雙層 | 回歸 test 已有 |
| **客戶詳情遮罩（F-4）** | ✅ | Staff / Admin 皆可 toggle | 刷新後重新隱藏 | 正式站 smoke |
| **跟進（E-3b）** | ✅ | Owner / Collaborator / Admin | 必填：下次時間、意向、下一步 ≥10 字 | — |
| **Timeline** | ✅ | 有客戶查看權限者 | — | — |
| **AI insight** | ✅ / 🔶 | 需 full access | Provider 503、mock 預設 | 確認 `AI_API_KEY` 與 provider 設定 |
| **審批** | ✅ / 🔶 | Staff 提交；Admin 審批 | `merge_customers` 為 placeholder | 隱藏或實作 merge 審批 |
| **共同負責員工（D-2）** | ✅ | Admin 直接管理；Owner 申請 | — | — |
| **公共池（F-5）** | ✅ | Admin 完整；Staff 脫敏 | **缺專用 E2E / 單元測試檔** | 補 public pool display test |
| **自動回收（E-4）** | ✅ | Cron + 設定 | Cron 需獨立 deploy；觀察 logs | 確認 `crm-system-reclamation-cron` |
| **回收站** | ✅ | Admin | Purge 前取消 open tasks；task 列可留且 `customerId=null`；notifications／audit 刻意保留歷史，失效實體不提供可點連結 | 見下方「已知風險」；[Phase 0 Findings](./CRM_ADMIN_COLLAB_PHASE0_FINDINGS.md) |
| **員工管理** | ✅ | Admin | 軟刪除會轉移客戶給執行者 | 正式站刪除前必看 preview |
| **通知 / 公告** | ✅ | 全部 / Admin 管理 | — | — |
| **Settings** | ✅ | Admin | Help 文案預設 vs DB 實值可能不同 | Settings 變更後更新 Help 或動態讀取 |
| **Help Center** | ✅ | 角色化只讀 | — | 可補 `sections.test.ts` |
| **Cron（回收 / 備份 / purge）** | ✅ | 系統 | 與 `npm run deploy` 分開 | 見 DEPLOY_RUNBOOK |
| **Backup** | ✅ | Admin | 無一鍵還原 | 遷移前手動 export D1 |
| **Audit logs（Admin 只讀）** | ✅ | Admin | 正式站 UI 需 OTP 人工 smoke | 後續：export、retention、action label |
| **D1 migrations** | ✅ | — | Remote 已最新 | 新 migration 需 runbook 流程 |

---

## 5. 權限矩陣摘要

**圖例：** ✅ 允許｜❌ 禁止｜🔶 有限制｜— 不適用

| 能力 | Admin | Staff owner | Collaborator | Public pool claimed owner |
|------|-------|-------------|--------------|---------------------------|
| 查看客戶（scope 內） | ✅ 全部 | ✅ 負責客戶 | ✅ 協作客戶 | ✅ 領取後為 owner |
| 查看 EF（customerCode） | ✅ | ❌ | ❌ | ❌ |
| 修改敏感資料 | ✅ | ❌（建立後鎖定 F-3） | ❌ | ❌ |
| 修改非敏感資料 | ✅ | ✅ | ❌ | ✅ |
| 新增跟進 | ✅ | ✅ | ✅ | ✅ |
| 釋放客戶到公共池 | ✅ | ✅（僅 owner） | ❌ | — |
| 管理共同負責員工 | ✅ 直接 | ❌ | ❌ | ❌ |
| 申請共同負責調整 | — | ✅（僅 owner） | ❌ | ✅（領取後若為 owner） |
| 查看公共池完整姓名 | ✅ | ❌（列表脫敏 F-5） | ❌ | ❌（列表）；✅（領取後詳情） |
| 領取公共池 | ✅ 無 quota | 🔶 quota + cooldown | 🔶 同 Staff | 🔶 不可領自己釋放的 |
| 查看回收站 | ✅ | ❌ | ❌ | ❌ |
| 員工管理 | ✅ | ❌ | ❌ | ❌ |
| 系統設定 | ✅ | ❌ | ❌ | ❌ |
| 查看審計日誌（全域） | ✅ | ❌ | ❌ | ❌ |

**實作參考：** `src/lib/permissions/customers.ts`、`src/lib/permissions/auth.ts`、`GET /api/admin/audit-logs`

---

## 6. 已知風險

| 優先級 | 風險 | 說明 | 緩解 |
|--------|------|------|------|
| 🔴 | **Production smoke 需人工** | `crm.echfronthk.com` 有 Cloudflare Access OTP，自動化無法完整登入 | 使用 [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md) |
| 🟡 | **Recycle purge 歷史保留（非可見 orphan Bug）** | 永久刪除／cron purge：**open task 先取消**，task 列可保留且 `customerId` → `null`；`notifications` 刻意保留歷史，Related Entity 不存在時不提供失效連結；`audit_logs` 刻意保留。屬設計行為，不等同於可見 orphan Bug | `purge-relations.test.ts`／Phase 0 Findings；本地應補跑 `npm run test:recycle-bin`；正式站勿隨意 permanent delete |
| 🟡 | **Public pool 缺專用測試檔** | F-5 展示邏輯分散在 `display.ts` + client，無獨立 regression test | 建議補 unit test |
| 🟡 | **Help Center vs Settings DB** | Help 頁面部分數字來自 `SETTING_DEFAULTS` constants，非即時讀 DB | Admin 改設定後 Help 可能顯示預設值；必要時改 help-client 讀設定 |
| 🟡 | **AI insight provider 503** | 外部 OpenAI-compatible API 不可用時刷新失敗 | 確認 `AI_API_KEY`；fallback mock |
| 🟡 | **本地 seed validation 400** | 部分 seed 客戶 `requestedProjectName: null`，smoke 新增客戶若複製可能 400 | 測試資料填完整必填欄位 |
| 🔴 | **Permanent delete 勿在正式站隨意測** | 不可恢復 | Checklist 僅測取消 modal |
| 🟡 | **Cron 需觀察 logs** | 主 Worker deploy ≠ Cron deploy | 見 DEPLOY_RUNBOOK |
| 🟢 | **Dev hydration warning** | 本地 `/help` 可能見 navigation hydration mismatch | 確認 prod 無影響 |
| 🟢 | **merge_customers 審批 placeholder** | 批准後無完整合併邏輯 | 避免在 prod 測試 merge 審批 |
| 🟢 | **Audit logs OTP smoke 待補** | Post-deploy curl 已確認 Access 302；Admin nav / 列表 / filters / Staff 拒絕需 OTP | 見 STABLE_RELEASE_CHECKPOINT § Audit logs visibility |

**已解決（AUDIT-UI-1 前）：** `nav.auditLogs` i18n 曾存在但未掛載 nav — **已於 `568ceea` 接上** `/admin/audit-logs`。

**Audit logs 後續候選（未實作）：** CSV / JSON export、`audit_logs` retention policy、action 人類可讀 label 優化。

---

## 7. 導航結構圖（Admin）

```
主要
├── /admin          儀表盤
├── /customers      客戶管理
├── /follow-ups     跟進紀錄
└── /public-pool    公共池

工作流程
├── /approvals              批准
├── /reports                報告
├── /notifications          通知中心
├── /admin/announcements    公告管理
└── /admin/ai-settings      AI 設定

系統管理
├── /admin/users            員工管理
├── /admin/tags-stages      標籤與階段
├── /admin/recycle-bin      回收站
├── /admin/settings         系統設置
│   ├── /admin/login-logs
│   ├── /admin/audit-logs       審計日誌（Admin-only 只讀）
│   ├── /admin/settings/security
│   ├── /admin/backups
│   ├── /import/customers
│   └── /export/customers
└── /help                   幫助中心
```

## 8. 導航結構圖（Staff）

```
主要
├── /staff          儀表盤
├── /customers      客戶管理
├── /follow-ups     跟進紀錄
└── /public-pool    公共池

工作流程
├── /approvals        批准（僅查看自己申請）
├── /reports          報告
├── /notifications    通知中心
├── /announcements    公告閱讀
└── /help             幫助中心
```

---

*本文件隨 Phase 更新；下次 SYSTEM-CHECK 請 diff 本檔與 git log。*
