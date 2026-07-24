# CRM Admin／協作／權限 — Phase 0 調查結論（定稿）

**類型：** 只讀調查＋docs 校準定稿
**日期：** 2026-07-24
**最後修訂：** 2026-07-24（Finalize：證據邊界、PRE_LAUNCH／SYSTEM_MAP 漂移、Runbook）
**Repository 基線（調查時）：** `main` @ `386012293a70bf300199b09139947aeb4748f0a4`
**Production Active Version（記錄用）：** `f9b2bfc6-6611-489b-85dc-8023d65b6e6c`
**觀察期：** Worker 1102 — 見 [WORKER_1102_INCIDENT_2026-07-24.md](./WORKER_1102_INCIDENT_2026-07-24.md)
**規劃依據：** [CRM_ADMIN_COLLAB_PERMISSION_PLAN.md](./CRM_ADMIN_COLLAB_PERMISSION_PLAN.md)

**本輪邊界：** Finalize 僅改 docs；不修改 Runtime／API／Schema／Auth／Access；不執行 Production API／D1；不 Deploy。

證據標記：已確認事實｜預期設計｜推論｜資訊缺口｜已確認 Bug｜文件漂移｜正常但體驗不足

---

## 1. Executive Summary

| 調查 | 結論 | 優先級影響 |
|------|------|------------|
| 永久清除 | 刻意保留且目前查詢安全；**非**可見 orphan Bug | 原 **P1-7 → Closed**（待補 DB 整合測試為非阻止缺口） |
| 通知 fan-out | 部分覆蓋；多數協作事件無 fan-out | **P2** 體驗；不擴大通知量除非產品決策 |
| PRE_LAUNCH B1 | 已於本 Finalize 修正為 Owner／Assignee 口徑 | **P2** 已處理（主驗收文件） |
| Access Email | 登入時部分綁定；有受控例外與時間窗 | **P1 Candidate**（加固候選，**非**已確認越權） |

**沒有新 P0。沒有必須插隊的資料一致性 Hotfix。**
下一 Runtime Phase 仍為 **Admin 待處理工作台（Phase 1）**，前提：1102 觀察期結束且無持續 `exceededCpu`。

**建議執行順序：**

1. 完成本 Phase 0 docs 校準（本文件＋PRE_LAUNCH＋SYSTEM_MAP）
2. 等待 1102 觀察期結束
3. 若未再出現 1102 → 開始 Phase 1 設計與查詢 Review
4. Phase 1 第一版只做少量高價值待處理資訊
5. **不同時**進行 Access／Session 加固
6. **不同時**擴大 Notification Fan-out

---

## 2. Scope and Evidence

| 來源 | 用途 |
|------|------|
| `src/lib/recycle-bin/service.ts` → `executePermanentDeleteInBatch` | purge 核心 |
| `drizzle/schema/*`、migrations | FK／CASCADE／SET NULL |
| `src/lib/notifications/*`、`approvals/service.ts` | 通知 |
| `src/lib/permissions/customers.ts`、`customer-list-filters.ts` | 權限 scope |
| `src/lib/auth/access-jwt.ts`、`session.ts`、`middleware.ts` | Access 綁定 |
| `docs/PRE_LAUNCH_PERMISSION_CHECKLIST.md` | 驗收清單（本 Finalize 已改） |
| `docs/SYSTEM_MAP.md` | 系統地圖（本 Finalize 已改 purge 描述） |
| 單元測試（調查輪執行通過） | filters／assignees／access-jwt／notification-href／recycle retention |
| DB 測試 | `purge-relations.test.ts` **本輪未完成執行**（本機綁定掛起） |

---

## 3. Purge Data Consistency

### 3.1 已確認行為

| 項目 | 事實 |
|------|------|
| 入口 | Admin permanent-delete API；recycle cron → `executePermanentDeleteInBatch` |
| 操作 | 回收站內 hard delete；先前需 archive＋`deletedAt` |
| Transaction | `db.batch` 原子 |
| Open Task | 永久清除**前**取消（`cancelled`） |
| Task Row | 可保留；`customer_id` → **NULL**（SET NULL） |
| Notification | **刻意保留**歷史；Related Entity 失效時**不提供可點擊連結** |
| Audit | **刻意保留** `customer.deleted.permanent` |
| Migration／Backfill | **不需要** |

**目前沒有證據支持 Customer Purge 會造成「可見的 orphan Bug」。** Open 任務列表／KPI 不會因已取消任務污染；通知可顯示但死鏈已 fallback。

### 3.2 關聯矩陣（摘要）

| 資料表 | 刪除／處理 | Cascade | 保留 | 可見性 |
|--------|------------|---------|------|--------|
| `customers` | Hard DELETE | — | 否 | 否 |
| `approvals`／`reclamation_warning_logs` | 顯式 DELETE | 否 | 否 | 否 |
| `tasks` | cancel open＋SET NULL | SET NULL | 列可留 | Open 列表：否 |
| `follow_ups`／assignees／contacts／AI | FK | CASCADE | 否 | 否 |
| `notifications` | 不刪 | N/A | 是 | 列表是；連結否 |
| `audit_logs` | 先寫後刪客戶 | N/A | 是 | Admin audit |
| quick_entry submission rows | purge 未清 | 無 FK | 可能殘留 ID | 非客戶主列表 |

### 3.3 證據邊界（必須保留）

- `purge-relations` DB 整合測試**本輪未完成執行**
- 結論主要由 **Runtime、Schema、Migration 與既有測試程式**交叉支持
- **不得**寫成「所有 Production／DB 行為已完整驗證」
- 後續本地環境正常時補跑 `npm run test:recycle-bin`
- 若補跑失敗，再重新評估風險分類

### 3.4 Purge 結論（定稿）

現有 Runtime、Schema 與測試程式證據支持這是**刻意保留且目前查詢安全**的設計；本輪未完成 `purge-relations` DB 整合測試，因此仍保留一項**非阻止性**的驗證缺口。

| 原規劃項 | 定稿狀態 |
|----------|----------|
| P1-7｜待確認的資料一致性風險 | **Closed**｜現有證據支持刻意保留且 Runtime 安全；待補 DB 整合測試 |

---

## 4. Notification Fan-out

### 4.1 已存在

- Transfer **pending** → 通知 Admin
- Transfer **approval** → 通知相關 Owner（原／目標路徑依實作）
- **Pending secondary conversion** → Owner／active assignees，並去重
- **自動回收** → 可通知原 Owner

證據：`approvals/service.ts`、`pending-second-conversion.ts`、`reclamation/engine.ts`。

### 4.2 未存在或部分存在

- Follow-up **不**向所有協作者 fan-out
- 協作者新增／移除**落地後**缺少明確通知
- 手動公共池釋放／領取不一定產生通知
- Task 到期／逾期**未**形成完整通知機制

**風險：P2｜產品體驗與協作可見性缺口**

**不得**直接建議：每次跟進通知所有協作者、每個動作通知 Admin、未經產品確認就擴大通知量。

### 4.3 產品決策問題（人工確認後再排程）

1. Owner 是否需要收到 Collaborator 新增跟進的通知？
2. Collaborator 是否只在被加入／移除時收到通知？
3. Public Pool 領取後是否只通知原 Owner、操作人或不通知？
4. Task 逾期應通知本人、Owner 還是 Admin？
5. 是否需要 Notification Priority，而不是單純增加數量？

---

## 5. PRE_LAUNCH Permission Drift

**主驗收文件：** [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md)（本 Finalize 已修正 B1／B1b／B2）。

**舊口徑（已移除）：**「Staff 只能看到 owner = Staff A 的客戶／仅 owner=Staff A」。

**Runtime 口徑（已確認事實）：**

| 角色 | 列表 | 詳情 | 跟進 | 主檔編輯 |
|------|------|------|------|----------|
| Owner | ✅ | full | ✅ | ✅（敏感欄位另受 F-3） |
| Active Assignee／Collaborator | ✅ | full（無 EF code） | ✅ | ❌（以 `assertCanEditCustomer` 為準） |
| 非關聯 Staff | ❌ | denied／403 | ❌ | ❌ |
| Public Pool（未領取） | 不在私人列表 | masked | ❌ | ❌ |
| 領取後 | 依私人客戶 Owner 規則 | full | ✅ | 依 Owner 規則 |

Staff Dashboard「我的客戶」KPI 目前**僅計 Owner**（與列表含協作不一致）— 驗收時分開記錄；屬指標／文案，非越權。

**其他可能仍含舊表述的歷史文件：** 規劃文件 `CRM_ADMIN_COLLAB_PERMISSION_PLAN.md` 仍記載調查前的 B1 漂移說明（**本輪依範圍不修改該規劃檔**）。不以歷史文件作正式驗收依據。

---

## 6. Access Email vs CRM Email

### 6.1 已確認事實

- Runtime **會驗證** Cloudflare Access JWT（`Cf-Access-Jwt-Assertion`／相關 cookie）
- CRM **登入時**比較 Access Email 與 CRM Login Email（`evaluateAccessLoginEmailBinding`）
- **一般**跨帳號登入會被阻止（`access_email_mismatch`）
- `CF_ACCESS_SUPER_ADMIN_EMAIL` 存在**受控例外**
- CRM Session **不持續保存** Access Email；`validateSession`／middleware **不再**比對 Access Email
- Access Policy 與 CRM Users **沒有**自動同步

**不讀取** `cf-access-authenticated-user-email` header。

### 6.2 風險分類（定稿）

**P1 Candidate｜安全加固候選，非已確認越權**

**不得**寫成：已存在可直接利用的帳號越權；任意 Access 使用者可登入其他 CRM 帳號；Session 已被繞過。

**攻擊前提（若評估風險）：**

1. 必須先通過 Cloudflare Access
2. 必須掌握另一 CRM 帳號的有效登入憑證
3. 一般帳號仍受登入階段 Email Binding 阻止
4. 主要風險來自：Super Admin 例外誤配置、Access／CRM 名單漂移、Session 生命週期未持續綁定

### 6.3 建議後續

1. 先完成營運 Runbook（見 §6.4）
2. 再決定是否進行 Auth／Session 加固
3. 若修改 Runtime → **必須強模型**
4. **不與** Admin 工作台 Phase 混合開發

### 6.4 Access／CRM Email 營運 Runbook

**新員工**

1. 建立 CRM User
2. 確認 CRM Email
3. 加入 Cloudflare Access Policy
4. 確認兩邊 Email **完全一致**
5. 完成首次登入與設備授權

**Email 修改**

1. 先確認新 Email
2. 同步更新 Access Policy
3. 同步更新 CRM 帳號
4. 撤銷舊 Session
5. 撤銷或重新確認設備
6. 執行一次登入驗證

**停用／離職**

1. 停用 CRM User
2. 移除 Access Policy Email
3. 撤銷 CRM Session
4. 撤銷 Authorized Devices
5. 完成 Customer／Task 交接
6. 檢查 Audit／Login Logs

**Super Admin（`CF_ACCESS_SUPER_ADMIN_EMAIL`）**

- 明確記錄使用人（**文件中不寫真實 Email**）
- 不應作為多人共用入口
- Email 變更時同步更新配置
- 定期人工確認沒有誤配置

---

## 7. Production Smoke Plan

本輪**不執行**。角色：Admin A、Staff A、Staff B；假資料；禁止壓力測試、真實 PII、繞過 Access、改 Production D1。

重點場景：列表／詳情 scope（含 Collaborator）、非關聯 403、跟進、主檔編輯拒絕、Public Pool masked、Claim／Release、Transfer／Assignee、Export 403、停用 Session、裝置撤銷、Access≠CRM 登入拒絕。詳見調查輪完整表（可沿用）。

---

## 8. Confirmed Findings

| 等級 | 領域 | 問題／結論 | 建議 |
|------|------|------------|------|
| Closed | Purge | 刻意保留；查詢安全；非可見 orphan Bug | 補跑 DB 測；已更新 SYSTEM_MAP |
| P2 | 通知 | 協作可見性缺口 | 產品決策後再排；不擴大預設量 |
| P2 | 文件 | PRE_LAUNCH B1 曾漂移 | **本 Finalize 已修** |
| P1 Candidate | Access | 登入綁定＋例外＋無持續 Session 綁定 | Runbook 優先；加固另開強模型專項 |
| 資訊缺口 | 測試 | purge-relations 未跑通 | `npm run test:recycle-bin` |

**無新確認 P0。**

---

## 9. Information Gaps

| 資訊 | 影響 | 取得方式 |
|------|------|----------|
| purge-relations 執行綠燈 | 非阻止；失敗則重評 | 本地 D1 補跑 |
| Production 權限 Smoke | 驗收 | 人工 checklist |
| 通知產品決策（§4.3） | Phase 優先級 | 產品確認 |
| Access↔CRM 正式站差集 | 營運 | 人工比對（不寫入真實 Email） |

---

## 10. Risk Reclassification

| 原項 | 定稿 |
|------|------|
| P1-7 purge | **Closed**｜刻意保留且 Runtime 安全；待補 DB 整合測試 |
| 通知 fan-out | **P2** |
| PRE_LAUNCH B1 | **P2 已修正**（主文件） |
| Access | **P1 Candidate**（非已確認越權） |

---

## 11. Recommended Priority

1. Phase 0 docs 校準（本 Finalize）
2. 等待 1102 觀察期結束
3. 無持續 exceededCpu → Phase 1 設計與查詢 Review
4. Phase 1 第一版：少量高價值待處理
5. 不同時 Access Session 加固
6. 不同時擴大 Notification Fan-out

---

## 12. Recommended Next Runtime Phase

**Phase 1 — Admin 待處理工作台與營運可見性**

| 項 | 內容 |
|----|------|
| Migration | 否 |
| Auth／Permission | 否 |
| Cursor | UI／文案 Auto；查詢／聚合／索引 **強模型** |
| Deploy 風險 | 中等（Workers Free CPU）；比較 `/admin`；上升則停 Deploy |
| 前置 | 觀察期結束；無持續 1102；無新 P0 |

若再出現 1102 → 暫停 Dashboard，優先 Root／CPU。

---

## 13. Required Cursor Model

| 工作 | 模型 |
|------|------|
| Docs／文案 | Auto |
| Admin Dashboard 查詢／性能 | 強模型 |
| Access／Session 加固 | 強模型（另開專項） |

---

## 14. Testing Requirements

- 已通過（調查輪）：`tsc --noEmit`；相關單元測
- 待補：`npm run test:recycle-bin`（含 `purge-relations`）
- Phase 1 前：`/admin` CPU／wall 比較；不壓測 `/`
- Production Smoke：人工；本輪不執行

---

## 15. Non-goals

- 改 purge／通知／權限 Runtime
- 企業 RBAC、重寫登入
- Quick Entry 變更
- 觀察期大型 Deploy
- 未經產品確認擴大通知
- 把 Access 部分綁定誇大成已確認越權

---

## 16. Appendix：Runtime／Schema／Test References

- Purge：`src/lib/recycle-bin/service.ts` → `executePermanentDeleteInBatch`
- Tasks schema：`onDelete: "set null"`；batch 內 cancel open
- Notifications：`attachRelatedEntityMissingFlags`、`getNotificationHref`
- Scope：`staffCustomerListPermissionWhere`、`assertCanEditCustomer`、`assertCanAddFollowUp`
- Access：`evaluateAccessLoginEmailBinding`、`verifyCloudflareAccessJwt`
- Tests：`purge-relations.test.ts`（存在；本輪未跑通）、`customers-assignees.test.ts`、`access-jwt.test.ts`、`notification-href.test.ts`
- Docs 本 Finalize：`PRE_LAUNCH_PERMISSION_CHECKLIST.md`、`SYSTEM_MAP.md`

---

*End of Phase 0 findings (finalized).*
