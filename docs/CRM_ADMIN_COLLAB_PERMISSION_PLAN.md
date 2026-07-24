# CRM Admin／員工協作／權限體驗 — 下一階段規劃

**類型：** 只讀審查＋可執行規劃（本文件為唯一產出）
**建立日期：** 2026-07-24
**最後修訂：** 2026-07-24（風險分類、1102 性能邊界、Phase 0）
**Repository 基線（規劃起草時）：** `main` @ `30a4d903c87b9702e39474c6b7e8b405051e8641`
**Production Active Version（記錄用）：** `f9b2bfc6-6611-489b-85dc-8023d65b6e6c`
**觀察期約束：** 見 [WORKER_1102_INCIDENT_2026-07-24.md](./WORKER_1102_INCIDENT_2026-07-24.md) — 本規劃**不得**在觀察期內執行大型 Runtime Deploy、不得改 Root／Middleware／Session／CPU

**審查方法：** 以現有正式程式碼、Schema、單元／DB 測試與 docs 交叉確認。標示「確認事實」與「推論／需人工確認」分開。不含客戶 PII、Secret、真實 IP、Production Cookie。

**相關既有文件：** [SYSTEM_MAP.md](./SYSTEM_MAP.md) · [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) · [PUBLIC_POOL_3B_COMPLETION.md](./PUBLIC_POOL_3B_COMPLETION.md) · [DEVICE_AUTHORIZATION_RELEASE_2026_07_03.md](./DEVICE_AUTHORIZATION_RELEASE_2026_07_03.md) · [WORKER_1102_INCIDENT_2026-07-24.md](./WORKER_1102_INCIDENT_2026-07-24.md)

---

## 1. Executive Summary

現行 CRM 已具備可用的 **二元角色模型（admin／staff）**、客戶 **Owner＋Assignee（primary／collaborator）**、審批轉移、公共池脫敏、設備授權、員工軟刪除自動轉交、Audit／Login Logs、Admin／Staff 儀表板與通知中心。權限的**後端 enforcement** 有明確 helpers 與測試覆蓋；問題主要不在「沒有權限系統」，而在：

1. **Admin 日常工作台資訊分散** — 儀表板有審批／任務／公共池 KPI，但待授權設備、鎖定帳號、回收站、長期未跟進等需另頁查找。
2. **協作責任邊界在產品語意上不夠清楚** — Collaborator 可看完整資料並可寫跟進，但不可編輯客戶主檔；轉移／臨時協作／釋放公共池容易混淆。
3. **離職／停用有自動轉交，但缺少可操作的「交接流程」體驗** — 軟刪除有 preview 與 assignee 同步；停用與日常移交缺少逐步引導。
4. **權限體驗以正確拒絕為主，可理解性與高風險確認／Audit 可讀性仍可加強** — 不宜立刻引入企業級 RBAC。

本輪建議先完成 **Phase 0（只讀確認與文件校準）**，再在 1102 觀察期結束後進入約 **3–4 個 Runtime Phase**：Admin 待辦聚合 → 協作語意與交接 → 權限提示／Audit／設備安全整合。

**重要邊界：** Phase 1（Admin 工作台）**不是**「無性能風險」。Workers Free 單次 HTTP CPU 上限約 **10ms**，且曾出現 `GET /` `exceededCpu`；Dashboard 聚合必須遵守本文 Phase 1 性能護欄，Deploy 前需比較 `/admin` CPU／wall time。

---

## 2. Current System Overview

### 2.1 角色與入口（確認事實）

| 項目 | 現況 | 主要路徑 |
|------|------|----------|
| 角色 | 僅 `admin`／`staff`（無細粒度 RBAC UI） | `drizzle/schema/users`、`src/lib/permissions/auth.ts` |
| Admin Shell | `/admin/*` 由 layout 守護 | `src/app/(dashboard)/admin/layout.tsx` |
| Staff 首頁 | `/staff` KPI（我的客戶／任務／逾期／待審批） | `src/app/(dashboard)/staff/page.tsx`、`staff-dashboard-client.tsx` |
| Middleware | `/admin/*`、`/import/*`、`/export/*` 僅 Admin | Middleware + [SYSTEM_MAP.md](./SYSTEM_MAP.md) |
| Session | 每次驗證 join `users`；`isActive≠1` 失效；Staff 受設備授權約束；Admin 不受設備狀態阻擋 | `src/lib/auth/session.ts` |

### 2.2 客戶歸屬模型（確認事實）

| 概念 | 實作 | 行為摘要 |
|------|------|----------|
| Owner | `customers.ownerId` | Staff 編輯主檔需為 owner（或 admin） |
| Assignee | `customer_assignees.role` = `primary`｜`collaborator` | 列表 scope：owner **或** assignee；`full` 讀取權 |
| Primary | 與 owner 在轉移審批路徑同步 | `src/lib/approvals/service.ts`、`service-transfer-primary.test.ts` |
| Collaborator | 可視為共同跟進者 | **可** `assertCanAddFollowUp`；**不可** `assertCanEditCustomer`（僅 owner／admin） |
| 公共池 | `status = public_pool` | 列表強制排除；Staff 詳情 `masked`；未領取不可 full 詳情 |
| 存取等級 | `full`／`masked`／`archived_basic`／`denied` | `src/lib/permissions/customers.ts`（「Full Access」是存取等級，不是第三種角色） |

### 2.3 Admin 功能地圖（確認事實）

| 路徑 | 能力 |
|------|------|
| `/admin` | KPI、工作流程優先、團隊跟進、通知／公告摘要 |
| `/admin/users` | 啟用／停用、解鎖、重設密碼、軟刪除＋preview、刪除歷史欄位 |
| `/admin/devices` | 設備授權管理 |
| `/admin/settings`、`/admin/ai-settings`、`/admin/settings/security` | 系統／AI／安全策略（security 偏說明） |
| `/admin/announcements` | 公告 |
| `/approvals` | 審批中心（Admin 通過／拒絕；Staff 提交／查看自己的） |
| `/admin/recycle-bin`、`/admin/reclamation` | 回收站、回收 dry-run |
| `/admin/audit-logs`、`/admin/login-logs` | 審計／登入日誌 |
| `/admin/backups`、`/admin/tags-stages` | 備份、標籤與階段 |
| `/public-pool` | 公共池（Admin／Staff 共用入口，權限不同） |

**未找到（不得寫成「系統完全沒有」）：** 獨立「權限管理」頁、獨立「客戶交接精靈」、Admin 專用公共池後台（與共用 `/public-pool` 分離的第二套 UI）。

---

## 3. Admin Management Review

### 3.1 Admin 每天最先看到什麼？

進入 `/admin` 後（確認事實）：

1. 最近通知卡、最近公告卡
2. KPI：總客戶／活躍／公共池／歸檔
3. 待審批、今日任務、逾期任務、成交
4. 工作流程優先面板（審批／逾期／今日任務）
5. 本月員工跟進排行、來源／階段分布等

來源：`AdminDashboardView` → `getAdminDashboardStats`（`src/lib/reports/admin-dashboard.ts`）。

### 3.2 能否快速知道關鍵事項？

| 關注點 | 儀表板是否一眼可見 | 現有落點 | 評價 |
|--------|-------------------|----------|------|
| 待審批 | ✅ 有 KPI＋連結 `/approvals` | 儀表板 | 足夠作為入口 |
| 公共池數量 | ✅ 有 KPI＋連結 | `/public-pool` | 有數量，缺「需處理」語意（誰該領／積壓） |
| 逾期／今日任務 | ✅ 全庫任務計數 | 儀表板 | 有；非「長期未跟進客戶」清單 |
| 待授權設備 | ❌ 儀表板未聚合 | `/admin/devices` | **需另頁** |
| 鎖定／異常帳號 | ❌ 儀表板未聚合 | `/admin/users`（鎖狀態欄位） | **需另頁** |
| 回收站待處理 | ❌ | `/admin/recycle-bin` | **需另頁** |
| 安全事件 | 部分（通知／備份失敗類） | 通知、login-logs、audit-logs | **分散** |
| 員工需關注 | 僅跟進排行 | users＋logs | **弱** |

**結論（推論，基於上述結構）：** Admin 能處理審批與任務熱點，但「安全／設備／人員／回收」仍需多頁來回，管理效率受信息架構限制多於缺少後端能力。

### 3.3 員工管理資訊完整度

`listUsersForAdmin`（`src/lib/users-admin/queries.ts`）提供：狀態、鎖定、最後登入、近 7 日登入次數、刪除後轉移摘要等。

刪除 preview（`delete-preview.ts`）另算：名下客戶數、協作者列、open tasks、pending approvals。

**列表常態欄位未見（確認缺口）：** 即時「客戶數／設備數／待處理任務」作為日常欄位（這些較集中在刪除 preview，而非日常監控）。

### 3.4 系統設定

設定分佈於 `/admin/settings`、`ai-settings`、`settings/security`、login／audit logs、backups（nav 子選單）。[SYSTEM_MAP.md](./SYSTEM_MAP.md) 已記錄 Help 預設與 DB 實值可能不一致 — **體驗／文案風險，非本次安全漏洞證據**。

### 3.5 高風險操作

| 操作 | 確認／審批／Audit |
|------|-------------------|
| 員工軟刪除 | Preview modal＋自動轉交＋metadata；歷史保留 | 相對完整 |
| 客戶轉移 | `transfer_customer` 審批 | 有 |
| 調整協作者 | Admin 直接；Owner 走 `update_customer_assignees` 審批 | 有 |
| 回收站永久刪除 | Admin；關聯清理行為**待 Phase 0 只讀確認** | 需謹慎；確認前不改 purge |
| 匯出敏感 | Checklist 要求二次確認 | 需人工 smoke 確認正式站 |
| `merge_customers` | 建立已 disabled；服務層曾有 placeholder 註記 | **未完成能力，非日常路徑** |

### 3.6 Admin 控制權是否過度？

二元 Admin＝幾乎全庫控制，符合現有產品定位。問題較像「入口與提示是否清楚」，而非權限過大需立刻拆 RBAC。**本規劃不建議引入企業級 RBAC。**

---

## 4. Employee Collaboration Review

### 4.1 Owner vs Assignee 定義是否清楚？

**程式定義清楚；產品語意對員工可能不清楚（推論）。**

| 角色 | 讀取 | 編輯主檔 | 跟進 | 釋放公共池 | 管理協作者 |
|------|------|----------|------|------------|------------|
| Admin | full（全庫） | ✅ | ✅ | ✅ | 直接 |
| Owner (staff) | full | ✅（敏感欄位仍受 F-3 鎖定） | ✅ | ✅ | 申請審批 |
| Collaborator | full | ❌ | ✅ | ❌ | ❌ |
| 公共池未領取 Staff | masked | ❌ | ❌ | — | — |

證據：`customers.ts`（access／edit／follow-up／assignees）、`SYSTEM_MAP.md` 權限矩陣、`customers-assignees` 相關測試。

### 4.2 多人協作時的責任

- **主要跟進責任：** 語意上偏向 **Owner／primary**；Collaborator 可寫跟進，形成「可寫但不能改主檔」的混合責任。
- **誰收到通知：** 依通知類型實作（審批結果、回收、二次轉化等）；**未在本次審查中證明「每次跟進都通知所有協作者」** — 標為需人工確認（見 §16）。
- **誰可轉交：** Owner 走轉移審批；Admin 可介入；Collaborator 不可釋放／轉移（依現有 assert）。

### 4.3 轉移 vs 臨時協作 vs 公共池

三條路徑皆存在且後端分離，但 UI／文案若未並列說明，員工易混淆（P1／P2 體驗問題）：

1. `transfer_customer` — 更換 owner／primary
2. `update_customer_assignees`／Admin 管理協作者 — 臨時或長期共同跟進
3. 釋放／領取公共池 — 放棄私人歸屬進入池

### 4.4 停用／刪除後

| 面向 | 現有行為 |
|------|----------|
| 客戶 | **確認：** 軟刪除時名下客戶轉給執行 Admin；primary assignee 同步；collaborator 列移除（`staff-delete-assignees.ts`） |
| 任務 | **確認：** delete preview 會統計 open tasks；轉交後任務歸屬需以實作與測試回歸為準 |
| 通知／purge 關聯 | **待確認（非已證實 Production Bug）：** 系統文件描述永久清除後 task／notification 可能殘留或指向已刪客戶；須經 Phase 0 只讀確認，不得宣稱 Production 已確定產生 orphan |
| 歷史 | **確認：** 軟刪除保留使用者刪除元數據與轉移計數；Timeline 有 staff deleted transfer 訊息鍵 |

**缺少（建議新增方向）：** 獨立「交接流程」UI（選接收人、逐客戶確認、協作客戶處理選項、任務批次改派）。目前偏「刪除時自動轉交」（**已存在**）。

### 4.5 Staff「下一步做什麼」

Staff `/staff` 已有：我的客戶、今日任務、逾期、我的待審批、高流失風險、低完整度。
**未找到統一收件匣：**「我的協作客戶」「最近被轉交」「即將到期跟進（非任務）」等獨立視圖 — 可能部分可由客戶列表篩選達成，但產品入口不明顯。

### 4.6 通知

有通知中心與 category（customer／approval／system／security）。**未找到明確優先級排序模型**（P2）。風險是「有通知但無優先」或類型過雜，而非完全沒有通知。

---

## 5. Permission Experience Review

### 5.1 前後端一致性（確認方向）

- 頁面按鈕：`canEditCustomer`／`canManageCustomerAssignees` 控制顯示（`customers/[id]/page.tsx`）。
- API：同套 `assert*` helpers。
- 列表：`staffCustomerListPermissionWhere` = owner OR assignee，且排除 `public_pool`／archived。

**文件漂移（確認）：** [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) B1 寫「僅 owner=Staff A」，與 Runtime「owner 或 assignee」不一致 — 測試文案需修正，避免誤判。

### 5.2 Staff 能否靠 API 讀他人客戶？

設計意圖與測試方向為 **403／denied**（checklist B2、assignees／permissions 測試）。
**本次未執行 Production 探測** — 不虛構測試結果。靜態審查未發現「前端隱藏、後端開放」的明顯矛盾；正式站仍建議依 checklist 人工抽測。

### 5.3 公共池脫敏與列表移除

- 列表 invariant：`excludePublicPoolWhere` 註明 public_pool **不得**出現在 `GET /api/customers` 正常列表。
- Staff 存取等級 `masked`；AI insight／跟進列表要求 `full`。

### 5.4 權限不足提示

存在 `PermissionError` 與 i18n key（如 `permission.denied.*`）。體驗上可能仍有「進了頁但空資料／操作後才拒」的個案 — **需依頁面人工確認**，不升級為已證實 P0。

### 5.5 權限變更與 Session

Session 驗證每次讀取當前 `users` 列：`isActive` 立即影響；`role` 來自 DB join（非只靠靜態 cookie 角色快取）。設備撤銷會導致 Staff session 失效。
**推論：** 停用帳號較快生效；若未來做更細權限旗標，仍應避免只改前端。**本次不建議改 Auth／Session 核心。**

### 5.6 Full Access 含義

`accessLevel: "full"` = 可見敏感欄位與跟進／AI 等完整客戶資料，**不是**「等同 Admin」。文案若翻譯成「完全存取／無限權限」會誤導 — 屬命名／提示問題（P2）。

### 5.7 是否需要新權限模型？

**建議：否（短期）。** 優先改善命名、責任說明、高風險確認、Audit 可讀性與 Admin／Staff 待辦聚合。複雜 RBAC 列為 Explicit Non-goal。

---

## 6. Current Capability Matrix

狀態圖例：已完成｜部分完成｜僅 Backend｜僅 UI｜存在但體驗不足｜未找到｜存在風險｜需要人工確認

| 功能 | 目前狀態 | Admin 行為 | Staff 行為 | 權限位置 | 資料來源 | 測試覆蓋 | 主要問題 |
|------|----------|------------|------------|----------|----------|----------|----------|
| Admin 儀表板 KPI | 已完成 | 看全庫指標 | N/A | `requireAdmin` | `admin-dashboard.ts` | 報表相關／手動 | 缺設備／鎖定／回收聚合；擴充受 CPU 約束 |
| Admin 工作流程優先 | 部分完成 | 審批＋任務 | N/A | 同上 | 同上 | — | 非完整「待辦收件匣」 |
| 員工 CRUD／啟停／鎖 | 已完成 | `/admin/users` | 不可進 | admin users API | `users-admin/*` | delete-preview、stats 等 | 日常缺客戶／設備數 |
| 員工軟刪除轉交 | 已完成 | Preview＋自動轉交 | 被轉出 | users-admin + assignees sync | DB batch | staff-delete／preview 測試 | 非完整交接精靈 |
| 設備授權 | 已完成 | `/admin/devices` | 受設備約束 | devices + session | `authorized_devices` | 裝置／activation 整合測 | 未進 Admin 首頁 |
| 系統／AI 設定 | 已完成 | 可改 | 不可 | admin settings | `system_settings` 等 | 設定相關 | 分散；Help 可能漂移 |
| 安全設定頁 | 存在但體驗不足 | 偏策略說明 | 不可 | security 子頁 | — | — | 與 login／audit 分散 |
| 審批中心 | 已完成 | 批准／拒絕 | 提交／看自己的 | approvals service | `approvals` | validation／transfer／assignees 測 | merge 已 disabled |
| 公告 | 已完成 | CRUD | 閱讀 | admin announcements | DB | — | — |
| 通知／未讀 | 已完成 | 有 | 有 | 使用者範圍 | `notifications` | queries／href 測 | 缺優先級；collaborator fan-out 待確認 |
| 客戶轉移 | 已完成 | 審批執行 | 申請 | `transfer_customer` | approvals | transfer-primary 測 | 與協作語意易混 |
| 協作者管理 | 已完成 | 直接管理 | Owner 申請 | assignees APIs | `customer_assignees` | assignees-* 測 | Collaborator 責任不清 |
| 公共池領取／釋放 | 已完成 | 完整檢視 | 脫敏＋規則領取 | public-pool + permissions | customers status | claim／assignee-sync 等 | Admin 無獨立後台 |
| 快速錄入／隨機領 | 已完成 | 管理向 API 存在 | Staff 使用 | public-pool quick-entry | — | 多份 quick-entry 測 | **本規劃 Non-goal 不改** |
| 回收站 | 已完成 | 恢復／永久刪 | 不可 | recycle-bin | archived | archive／restore／purge 相關測存在 | 永久清除關聯清理**待確認**（P1-7） |
| 自動回收 | 已完成 | dry-run／設定 | 被回收通知 | reclamation | cron+settings | reclamation 測 | 營運觀察項 |
| Audit／Login Logs | 已完成 | 只讀查詢 | 不可 | admin APIs | audit／login | audit-api 測 | 缺 export／retention |
| 備份 | 已完成 | 觸發／列表 | 不可 | backups | backup jobs | — | 無一鍵還原（已知） |
| 欄位級遮蔽／敏感鎖 | 已完成 | 可改敏感 | F-3 鎖定 | permissions customers | — | sensitive-fields 測 | — |
| AI 洞察權限 | 已完成 | full | 需 full | insights gate | — | feedback API 測 | provider 依賴 |
| 權限管理 UI | 未找到 | 無獨立頁 | — | 角色寫死二元 | users.role | — | 不建議立刻建 RBAC |
| 交接流程精靈 | 未找到 | 僅刪除轉交 | — | — | — | — | P1 流程缺口 |
| 我的協作／最近轉交 Inbox | 未找到／部分可替代 | — | 儀表板無專卡 | 列表 scope 含 assignee | — | list-filters 測 | 入口不足 |
| Staff 待審批 | 已完成 | — | KPI＋連結 | approvals | staff-dashboard | pending-count 測 | — |
| Access Email↔CRM Email | 需要人工確認 | Access 在邊緣 | — | Cloudflare Access + CRM login | 部署／ENV 文件 | — | 不在本次改 Access |

---

## 7. Confirmed Problems

### P0（安全／越權／資料丟失／一致性）

本次靜態交叉審查：**未確認新的 P0 越權或已證實的 Production 資料丟失漏洞。**

| ID | 問題 | 說明 |
|----|------|------|
| P0-GATE | Production 權限抽測未完成 | Checklist 多項仍為未測；**這是驗收缺口，不是已確認 Bug**。若 smoke 發現 Staff API 可讀非 scope 客戶，應立即升為真正的 P0 並暫停相關 Phase Deploy |

**不得**使用「P0-DOC」等混合分類把未經驗證的文件描述直接標成 P0。

### P1（明顯影響管理、員工流程，或待確認的一致性風險）

| ID | 問題描述 | 使用者場景 | 現有行為 | 理想行為 | 模組 | Migration | 權限 | 測試 | 風險 |
|----|----------|------------|----------|----------|------|-----------|------|------|------|
| P1-1 | Admin 待處理事項分散 | 早會要掃設備／審批／鎖定／池 | 多頁查找 | 工作台聚合「待處理」（受 CPU 護欄約束） | dashboard、devices、users、approvals、recycle | 否（先讀聚合） | 否（只讀） | 儀表板查詢測＋`/admin` 性能比較 | **中等**（查詢數／Free CPU） |
| P1-2 | Collaborator 責任不清 | 兩人跟同一客戶 | 能跟進不能改主檔，UI 未必說明 | 明確標「負責人／協作者」與可做事項 | customer detail、i18n、assignees UI | 否 | 文案／顯示；不改 assert 亦可 | UI／權限說明測 | 低 |
| P1-3 | 轉移／協作／公共池易混 | 員工想「暫時給同事」卻釋放或轉移 | 三路徑分離但引導弱 | 操作前對照說明＋推薦路徑 | approvals、assignees、public-pool UI | 否 | 否 | 文案／流程測 | 低 |
| P1-4 | 缺少交接流程 | 員工離職／長期請假 | 刪除才自動轉交；停用較被動 | 停用／移交精靈：選接收人、預覽影響 | users-admin、customers、tasks | 可能（若要移交狀態表）；首版可無 | 是（誰可指定接收人） | DB 測＋preview | 中；需強模型 |
| P1-5 | Staff 協作入口弱 | 「哪些是我協作的」 | 混在我的客戶 | 篩選／專卡：協作／即將逾期／最近轉交 | staff dashboard、customers list filter | 否或僅查詢 | 否 | list-filters 測 | 低 |
| P1-6 | 員工列表缺營運指標 | Admin 看誰負荷高 | 有登入／鎖；客戶數多在 preview | 列表或詳情顯示客戶／開放任務／設備（須防 N+1） | users-admin | 否 | 否 | stats 查詢測 | 中（N+1／CPU） |
| P1-7 | **待確認的資料一致性風險：永久清除後 task／notification 關聯** | Admin 永久刪除客戶後，任務或通知是否殘留、可否被 Runtime 顯示 | 系統文件／架構描述提及 orphan 可能；**尚未**以 purge handler、Schema FK、ON DELETE、顯式刪除邏輯與測試完整確認 | 確認後：要麼證明為刻意歷史快照且 UI 安全，要麼排修；**確認前不 Migration、不直接改 purge、不標 P0** | recycle-bin／purge service、schema、tests | **確認前：否** | 否（只讀確認） | 見下方「P1-7 只讀確認項」 | 可能升為 P0／P1；目前不得宣稱 Production 已確定 orphan |

#### P1-7 只讀確認項（Phase 0；確認前不改 Runtime）

1. 檢查永久清除客戶的 API／service／repository
2. 檢查 `customers`、`tasks`、`notifications` 相關 foreign key
3. 檢查是否存在 `ON DELETE CASCADE`
4. 檢查 purge 是否顯式刪除關聯資料
5. 檢查 audit／notification 是否故意保留歷史快照
6. 檢查殘留資料是否仍能被 Runtime 查詢或顯示
7. 檢查 DB／unit 測試是否覆蓋永久清除

**證據邊界：** 目前證據主要來自系統文件或既有架構描述，**不是**已完成的 handler／Schema／測試交叉證明，也**不是**「僅文件問題」。確認結果可能維持觀察、降級或升級為 P0／P1 修復項。

### P2（體驗／IA／文案／效率）

| ID | 問題 | 證據／影響 |
|----|------|------------|
| P2-1 | 「Full Access」易被誤解為 Admin | `CustomerAccessLevel` 命名／UI 文案 |
| P2-2 | 通知缺優先級 | category 有、優先排序弱 |
| P2-3 | Audit 缺 export／人類可讀 action | SYSTEM_MAP 候選 |
| P2-4 | 設定與 Help 預設可能不一致 | SYSTEM_MAP |
| P2-5 | Checklist B1 與 Runtime 不一致 | PRE_LAUNCH vs `staffCustomerListPermissionWhere` |
| P2-6 | 安全資訊分散於 devices／login-logs／audit／security 頁 | IA |
| P2-7 | `merge_customers` 殘留語意 | disabled／placeholder 歷史 — 應在 UI／文件標「不可用」避免誤導 |

### P3（可選增強）

| ID | 說明 |
|----|------|
| P3-1 | Audit retention policy |
| P3-2 | Admin 專用公共池營運視圖（積壓、來源、二次轉化） |
| P3-3 | 通知偏好設定（種類開關） |
| P3-4 | 更細的欄位級政策（仍非完整 RBAC） |

---

## 8. Risk Assessment

| 風險 | 等級 | 說明 |
|------|------|------|
| 1102／Free Worker CPU | **高（時程與 Phase 1）** | Free 方案單次約 **10ms** CPU；曾 `GET /` `exceededCpu`；觀察期禁止大型 Runtime／Root／Middleware／Session 變更與性能壓測 |
| Admin 儀表板加聚合查詢 | **中等** | 主要風險來自查詢數量與 Workers Free CPU；必須遵守 Phase 1 護欄；CPU 明顯上升則停止 Deploy |
| 交接／轉交改寫 owner＋assignee | 高 | 與轉移審批、primary 同步不變量耦合 — 需強模型＋DB 測 |
| 誤改權限 assert | 高 | 任何「讓 collaborator 可編輯」屬產品決策，需明確測試 |
| 文件與 Runtime 漂移 | 中 | 導致錯誤驗收（如 checklist B1） |
| Purge／永久刪除關聯清理 | **待確認 → 可能升級** | 確認前不 Migration、不改 purge；不標 P0；不排除未來升為 P0／P1 |

---

## 9. Recommended Target Experience

### Admin

- 開啟 `/admin` 即見 **精簡待處理收件匣**（第一版只展示最重要的少量項目）：待審批、待授權設備、鎖定帳號、公共池積壓摘要、逾期任務等。
- 員工頁能快速判斷負荷與風險（客戶數、開放任務、設備、最後活躍）— 查詢須聚合、有上限、防 N+1。
- 高風險操作維持 preview／確認，Audit 可追溯且可讀。

### Staff

- 清楚知道：**我負責（Owner）** vs **我協作（Collaborator）**。
- 儀表板能回答：今天做什麼、什麼逾期、我的待審批、最近交到我手上的客戶。
- 想找人幫忙時，系統引導「加協作者」而非誤釋放／誤轉移。

### Customer Collaboration

- 客戶詳情永久可見責任徽章與能力說明。
- 轉移＝換負責人；協作＝加人幫忙；公共池＝放棄歸屬。三條路徑文案對照。

### Permission Feedback

- 按鈕不可見或 disabled＋原因；API 錯誤訊息與 UI 一致。
- 「完整資料存取」等中性用語取代易誤解的「完全權限」。

### Audit／Security

- Admin 從工作台能點進設備與登入異常。
- 不改 Access／Auth 核心；強化可觀測性與確認，而非新角色系統。

---

## 10. Implementation Priorities

1. **Phase 0：只讀確認與文件校準**（觀察期可執行；不改 Runtime、不 Deploy）
2. **觀察期結束後：資訊聚合與語意澄清**（少碰權限核心；嚴格 CPU 護欄）
3. **再做交接／責任流程**（碰 owner／assignee 時用強模型）
4. **再做高風險確認／Audit／員工－設備整合**
5. **明確不做：** 企業 RBAC、重寫登入、Quick Entry V2、觀察期大 Deploy、即時聊天、無必要 AI

---

## 11. Suggested Phases

整體維持約 **3–5 個可執行階段**：Phase 0（只讀）＋約 **4 個 Runtime Phase**（可依審閱合併 Phase 3／4）。**不要**拆成大量細碎 Phase。

### Phase 0 — 只讀確認與文件校準

| 項 | 內容 |
|----|------|
| 目標 | 關閉或澄清資訊缺口，避免錯誤優先級進入 Runtime |
| 內容 | ① P1-7 purge 關聯只讀確認（§7 七項）② Collaborator 通知 fan-out 確認 ③ 修正 PRE_LAUNCH B1（owner **或** assignee）④ Access Email 與 CRM Email 營運流程確認（只讀／文件） |
| 修改模組 | **僅 docs**（如 PRE_LAUNCH）；purge／通知確認為讀碼＋測試盤點，**不改 src** |
| Migration | **否** |
| Auth／Permission | **否** |
| Cursor 模型 | **Auto**（文件）；purge／schema 交叉確認建議 **強模型** 輔助只讀審查 |
| 測試 | 不新增 Production 操作；可跑既有本地／單元測試做證據，不虛構結果 |
| Deploy | **否** |
| 前置條件 | 無（可於 1102 觀察期內執行） |

### Phase 1 — Admin 待處理工作台與營運可見性

| 項 | 內容 |
|----|------|
| 解決問題 | P1-1、P1-6（部分）、P2-6（入口） |
| 修改模組 | `src/lib/reports/admin-dashboard.ts`、`admin-dashboard-client.tsx`、users 列表統計查詢、i18n；**可選**輕量 API（僅 `/admin` 範圍） |
| Migration | **否** |
| Auth／Permission | **否**（Admin-only 既有守衛） |
| Cursor 模型 | UI／文案：**Auto**；Dashboard 查詢、聚合、索引與性能：**強模型** |
| 測試 | 儀表板 stats 單元／DB 測；Admin 頁 smoke；Deploy 前比較 `/admin` CPU／wall time |
| Deploy 風險 | **中等** — 主要風險來自查詢數量與 Workers Free CPU 限制（約 10ms） |
| Rollback | UI／查詢可獨立回滾 |

#### Phase 1 前置條件

- 1102 觀察期結束
- CRM 未再出現持續 `exceededCpu`
- Phase 0 沒有發現更高優先級的資料一致性或越權問題（例如 P1-7 升為必須先修的 P0）

#### Phase 1 性能與範圍護欄（必須遵守）

已知背景：Workers **Free**；單次 HTTP CPU 上限約 **10ms**；曾發生 `GET /`、`outcome = exceededCpu`、`cpuTime = 10ms`；目前／曾處於 48 小時觀察期。

1. **不修改**根路徑 `/`
2. **不修改** Middleware
3. **不修改** Session Validation
4. **不修改** Root Layout 的資料查詢
5. **不將** Admin 統計加入全域 Layout
6. 統計**只允許**在 `/admin` 相關頁面按需載入
7. **不允許**查詢全部客戶後在 JavaScript 聚合
8. **優先**使用 D1 `COUNT`／`GROUP BY`／`EXISTS` 等聚合
9. 所有列表與待辦必須有**明確上限**
10. 檢查查詢**索引**與 query plan
11. **避免 N+1** Query
12. **不因**一張 Dashboard 同步發送大量重複請求
13. 部署前**比較** `/admin` 的 CPU／wall time
14. 如 CPU **明顯上升**，**停止 Deploy**
15. **第一版**只展示最重要的少量待處理項目

### Phase 2 — 協作語意、列表篩選與責任邊界體驗

| 項 | 內容 |
|----|------|
| 解決問題 | P1-2、P1-3、P1-5、P2-1；可含 PRE_LAUNCH 修正若 Phase 0 未完成 |
| 修改模組 | 客戶詳情責任 UI、assignees 文案、Staff dashboard 卡片、customers list filter（owned／collaborator）、操作引導（轉移 vs 協作 vs 公共池） |
| Migration | **否**（篩選用既有表） |
| Auth／Permission | **原則不改 assert**；若產品要求改 collaborator 編輯權 → **強模型＋明確決策**（預設不做） |
| Cursor 模型 | 文案／UI：**Auto**；任何 permissions 變更：**強模型** |
| 測試 | list-filters、customers-assignees、UI 權限按鈕可見性 |
| Deploy 風險 | 低（若只做顯示／篩選） |
| Rollback | 容易 |
| 前置條件 | 建議觀察期結束後；可與 Phase 1 部分重疊（純文案／篩選、低查詢成本） |

### Phase 3 — 員工交接／停用移交流程

| 項 | 內容 |
|----|------|
| 解決問題 | P1-4；強化刪除以外的移交 |
| 修改模組 | `users-admin`（disable／handover preview）、customers owner 批次、`staff-delete-assignees` 模式復用、tasks 改派、timeline／audit 事件、通知 |
| Migration | **首版可否**（複用轉交邏輯）；若需「交接單」狀態機則 **是** |
| Auth／Permission | **是**（誰可指定接收人、是否需審批） |
| Cursor 模型 | **強模型** |
| 測試 | DB 整合測（owner／primary／collaborator／tasks／notifications）；刪除路徑回歸 |
| Deploy 風險 | **高** |
| Rollback | 需資料層謹慎；建議 feature flag 或僅 Admin 工具路徑 |

### Phase 4 — 高風險確認、Audit 可讀性、設備／安全整合

| 項 | 內容 |
|----|------|
| 解決問題 | P2-2、P2-3、P2-7；P1-7 確認後的可觀測性或修復（若仍需）；設備進工作台深化 |
| 修改模組 | audit label／（可選）export、purge 確認文案或修復（**僅在 Phase 0 結論允許後**）、通知排序、devices 摘要、merge 不可用標示、安全入口整理 |
| Migration | export／retention／purge 修復才可能需要；純確認文案則否 |
| Auth／Permission | 多為 Admin 體驗；export 需既有 Admin 權限 |
| Cursor 模型 | 文案／UI：**Auto**；Audit API／export／purge：**強模型** |
| 測試 | audit-api、purge-preview、通知排序 |
| Deploy 風險 | 中（export／purge 誤導或資料風險） |
| Rollback | 視是否含 API；純 UI 易回滾 |

---

## 12. Testing Strategy

| 層級 | 建議 |
|------|------|
| 單元 | access level、list filters、dashboard aggregations、handover preview 計算 |
| DB／整合 | transfer primary sync、assignee sync、staff delete、public pool list exclude、masked fields；**Phase 0 盤點 purge 覆蓋** |
| API | Staff 讀他人客戶 403；公共池敏感欄位；Admin-only 路由 |
| 性能 | Phase 1 Deploy 前比較 `/admin` CPU／wall；禁止在觀察期對 `/` 做實驗 Deploy／壓測 |
| 人工 | 依更新後的 PRE_LAUNCH checklist；Admin 早會路徑；Staff 協作路徑 |

不虛構通過結果；正式站結論以人工勾選為準。

---

## 13. Migration／Production Risk

| Phase | Migration | Production 注意 |
|-------|-----------|-----------------|
| 0 | 無 | 只讀；可改 docs；不 Deploy |
| 1 | 無 | 查詢成本／Free CPU；Deploy 前性能 Review；護欄未滿足則停止 |
| 2 | 無 | 低 |
| 3 | 可能 | 客戶歸屬變更；需備份意識與回滾方案 |
| 4 | 可選 | export 含敏感資料 — 二次確認＋Audit；purge 僅在確認後 |

**本規劃文件階段不執行 Migration、不操作 Production D1、不 Deploy。**

---

## 14. Explicit Non-goals

本輪規劃與後續首批實作**不得**建議立即：

- 重做整個 CRM
- 引入複雜企業級 RBAC
- 更換資料庫或 Cloudflare
- 重寫登入／修改 Cloudflare Access／Session 核心（觀察期尤其禁止）
- 引入大型第三方工作流或即時聊天
- 堆疊無必要 AI
- 修改 Quick Entry V2（已收尾，除非真實缺陷）
- 在 1102 觀察期部署大型 Runtime
- 把 Phase 1 當成「無性能風險」的純 UI 工作

---

## 15. Recommended Next Action

### 1102 觀察期內

- **不**開發或 Deploy 大型 Runtime 功能
- **可以**完成文件、只讀審查和測試規劃
- **可以**確認 purge 資料一致性風險（P1-7 七項）
- **可以**確認通知 fan-out
- **可以**修正 PRE_LAUNCH 文件漂移（B1）
- **執行 Phase 0**（只讀＋文件）

### 觀察期結束後

**若未再次出現 1102：**

- 再進入第一個 Runtime Phase（**Phase 1**）
- 部署仍需性能 Review，並遵守 Phase 1 十五條護欄
- 如 `/admin` CPU 明顯上升 → **停止 Deploy**

**若再次出現 1102：**

- **暫停** Admin Dashboard 開發
- **優先**處理 Worker CPU／Root Route 問題

### 建議順序（摘要）

1. 提交並審閱本規劃（本輪 docs Commit）
2. 執行 **Phase 0**
3. 觀察期結束且前置條件滿足後，啟動 **Phase 1**
4. Phase 2 可部分重疊（純文案／篩選）
5. Phase 3 單獨排程＋強模型＋完整 DB 測

**首個 Runtime Phase 仍為 Phase 1（Admin 待處理工作台）** — 方向不變，但必須在觀察期結束、Phase 0 通過、且性能護欄可執行後才開發／Deploy。

---

## 16. Information Gaps（人工確認；非已確認 Bug）

以下**不是**已確認 Bug，**不阻止**本規劃文件提交，但**可能改變**後續 Phase 優先級：

| # | 缺口 | 狀態 | 建議處理 |
|---|------|------|----------|
| 1 | Production API 權限 Smoke 尚未全面完成 | 驗收缺口 | 依 PRE_LAUNCH 人工抽測；發現越權 → 升 P0 |
| 2 | Collaborator 通知 fan-out 尚未完整確認 | 行為未完全追完 | Phase 0 只讀追碼／測試 |
| 3 | Access Email 與 CRM Email 營運對應尚待確認 | 營運流程 | Phase 0 文件／流程確認；不改 Access |
| 4 | purge 關聯資料清理尚待 Runtime／Schema／測試確認 | P1-7 | Phase 0 七項只讀確認 |

---

## Appendix A — 審查時主要 Runtime 引用

- `src/lib/permissions/customers.ts`、`auth.ts`、`tasks.ts`
- `src/lib/customers/customer-list-filters.ts`、`queries.ts`
- `src/lib/approvals/service.ts`、`constants.ts`
- `src/lib/users-admin/*`（queries、delete-preview、staff-delete-assignees）
- `src/lib/reports/admin-dashboard.ts`、`staff-dashboard.ts`
- `src/lib/auth/session.ts`
- `src/lib/devices/service.ts`
- `src/lib/notifications/*`
- `src/app/(dashboard)/admin/**`、`staff/**`、`approvals/**`、`public-pool/**`
- `src/lib/layout/nav-links.ts`
- 測試：`customers-assignees*.test.ts`、`service-transfer-primary.test.ts`、`customer-list-filters.test.ts`、`staff-delete`／`delete-preview`、public-pool 相關、`audit-api.test.ts`；purge 相關測試於 Phase 0 盤點

## Appendix B — 事實／推論邊界

| 類型 | 例子 |
|------|------|
| 確認事實 | Collaborator 可跟進不可編輯；列表含 assignee；session join users；儀表板欄位集合；Free Worker CPU 約 10ms 與 1102 事件記錄 |
| 推論 | Admin「需要多頁查找」導致效率痛點；員工易混淆三路徑 |
| 需人工確認 | 正式站 API 抽測；collaborator 通知 fan-out；Access Email 對應；purge 關聯是否 orphan／是否刻意保留 |
| 未找到 | 交接精靈、權限管理頁、Staff「最近轉交」專卡 — **不表示業務上永遠不需要** |
| 不得宣稱 | Production 已確定 purge orphan；Phase 1 無性能風險；Production 權限已全部通過 |

---

*End of planning document.*
