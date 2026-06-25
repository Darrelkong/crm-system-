# Phase 17 Requirements — CRM 系統需求盤點與凍結

**Branch:** `phase-17-crm-requirements-integration`  
**Document status:** Draft v1 — requirements freeze baseline  
**Last updated:** 2026-06-24  

---

## 1. Phase 17 Objective

Phase 17 的目標是 **整合 CRM 系統需求**，在已有生產系統（https://crm.echfronthk.com）的基礎上，有節奏地規劃後續開發，而不是直接大規模改代碼。

本階段（17-1）只做三件事：

1. **需求盤點** — 對照現有系統能力，列出已知缺口與可選擴展方向  
2. **優先級排序** — 以穩定性、所有權、權限安全為 P0，功能增量按風險分層  
3. **風險控制** — 明確「暫不改什麼」與每步驗收標準，避免破壞 Admin / Staff 現有流程  

**不在 Phase 17-1 做：** 業務代碼修改、API 變更、schema / migration、`.env`、`wrangler.jsonc`、deploy。

後續子階段（17-2+）須在本文件更新並經確認後，再按優先級小步實施。

---

## 2. Current System Baseline

以下為 Phase 17 審查報告確認的 **已完成核心能力**（生產可用）。

### 客戶管理

- 列表、新建、詳情、編輯、歸檔邊界  
- 客戶類型：`individual` / `company`（字段級，非獨立公司實體）  
- 銷售階段、來源、負責人、狀態（active / inactive / archived / public_pool）  
- 客戶熱度與數據完整度（計算字段，列表篩選 + 詳情卡片）  
- 客戶時間線（audit_logs、field_change_logs、follow_ups、tasks、approvals）

### 跟進記錄

- 新增跟進、有效跟進判定、更新 `last_valid_follow_up_at`  
- 跟進關聯任務（follow_up 類型自動 upsert）  
- 用於自動回收計時與報表統計  

### 公共池

- 釋放客戶到公共池、公共池列表（Staff 脫敏）  
- 領取規則：7 天配額、冷卻時間、不可領取自己釋放的客戶  
- Admin 領取不受配額/冷卻限制  
- 領取後自動創建「首次聯繫」任務  

### 審批中心

- 五種審批類型：delete_customer、transfer_customer、merge_customers、closed_won、second_conversion  
- Staff 提交、Admin 審批/駁回、通知與審計  
- 已歸檔客戶邊界保護  

### 通知中心

- 列表、未讀數、單條/全部已讀  
- Dashboard 最近通知卡片  
- 新通知支持 i18n key 存儲（`titleKey` / `messageKey`）；歷史通知仍可能為中文原文  

### Admin / Staff 工作台

- 角色分流：`/admin` vs `/staff`  
- KPI 報表 API + Dashboard widgets  
- 業務時區（Asia/Shanghai / UTC）接入報表邊界  

### 導入導出

- **導入（Admin）：** CSV 模板、precheck、commit、`import_jobs`  
- **導出（Admin）：** 字段白名單、敏感字段控制、riskLevel 審計、`export_jobs`  
- Staff 默認不可導出  

### 備份

- 手動 + 定時 JSON 備份（R2 `crm-attachments` / 本地 fallback）  
- `backup_jobs` 記錄、失敗通知 Admin  
- 備份排除 sessions；users 不含 password_hash  
- **無一鍵恢復 UI**  

### 用戶管理

- Admin：創建/停用/啟用、重置密碼、解鎖、登入日誌  
- 鎖定策略、停用/重置後清除 sessions  

### 系統設置

- 8 項 key-value 設置（回收天數、公共池配額、SLA、業務時區等）  
- 7/8 已接入業務邏輯；`inactivity_logout_minutes` 僅保存未生效  

### 權限控制

- 角色：admin / staff  
- 客戶 accessLevel：full / masked / archived_basic / denied  
- Middleware + API 雙層守衛；權限拒絕寫 audit_logs  

### i18n 已完成部分（Phase 16）

- 框架：`src/i18n/`（en、zh-Hant、zh-Hans）  
- 已覆蓋：login、導航 shell、customers 全链路、public-pool、approvals、import、export（部分）、dashboard、notifications（含新通知 key 解析）  
- 默認 locale：en  

### 基礎設施

- Next.js 16 + OpenNext on Cloudflare Workers  
- D1 `crm-db` + Drizzle ORM（15 migrations）  
- 獨立 Cron Worker：自動回收、每日備份  
- 源碼已同步 GitHub private repo（`origin/main`）  

---

## 3. Known Gaps

審查報告確認的 **未完成或不完整** 部分（非臆造業務需求）。

| # | 缺口 | 說明 |
|---|------|------|
| G1 | **i18n Phase 16D 剩餘** | help、announcements、settings、login-logs、部分 admin 頁及 lib 常量仍硬編碼中文 |
| G2 | **任務中心 UI** | 後端有 `tasks` 表、`GET /api/tasks/my`、complete API；無 `/tasks` 頁面 |
| G3 | **customer_contacts 多聯繫人** | schema + 備份導出存在；無 CRUD API 與 UI |
| G4 | **R2 客戶附件** | R2 binding 存在，目前主要用於備份 JSON，非客戶文件上傳 |
| G5 | **備份恢復** | 僅備份 + 文檔說明；無 restore API/UI/腳本 |
| G6 | **Turnstile** | README 標記預留，代碼未接入 |
| G7 | **idle logout** | `inactivity_logout_minutes` 可讀寫；sessions 無 last_activity，未生效 |
| G8 | **Staff 導出授權** | README 明確標記尚未實現 |
| G9 | **middleware → proxy migration** | Next.js 16 build 警告；仍使用 `src/middleware.ts` |
| G10 | **i18n 雙軌 / 孤立文件** | `constants.ts` 中文標籤 vs locale；`src/i18n/messages/zh-CN.ts` 幾乎未引用 |
| G11 | **歷史通知中文混存** | DB 舊通知為中文原文，新通知為 i18n key |
| G12 | **legacy/ 目錄** | D1 遷移前 Prisma/NextAuth/Company 存檔，不參與 build |

---

## 4. Requirement Mapping Table

> **說明：** 以下 Requirement 均來自審查報告中的 **已知缺口或已文檔化後續 Phase**，不包含未確認的業務新需求。業務方新增需求時，應追加行並更新 Priority。

| Requirement | Existing Support | Gap | Suggested Solution | Risk Level | Priority | Files Likely to Change |
|-------------|------------------|-----|-------------------|------------|----------|------------------------|
| 保持生產 build 穩定 | `npm run build` 通過 | 大改易引入 SSR/TS 錯誤 | 小步 PR、每步 build；Client 只收可序列化 props | **High** if broken | **P0** | —（流程约束） |
| GitHub 源碼備份 | `origin/main` 已配置 | 依賴單機 | 持續 push；feature branch 合併前 review | Low | **P0** | — |
| 權限模型不破壞 | `src/lib/permissions/*` 完整 | 新 API 若未走同一套會越權 | 新功能必須复用 requireAdmin/requireAuth + permissions | **High** | **P0** | `src/lib/permissions/*`（僅在明確需求時） |
| 完成 i18n Phase 16D 剩餘 | 16A–16D-1 已覆蓋主要模組 | help/announcements/settings/login-logs 等仍中文 | 將硬編碼字串迁入 `src/i18n/locales/*`；help content 改 key 结构 | Medium | **P1** | `src/i18n/locales/*`, `src/lib/help/content.ts`, `src/app/(dashboard)/help/**`, `src/app/(dashboard)/announcements/**`, `src/app/(dashboard)/admin/announcements/**`, `src/app/(dashboard)/admin/settings/**`, `src/app/(dashboard)/admin/login-logs/**`, `src/lib/settings/keys.ts` |
| 统一 lib 常量与 i18n | 部分经 `useCustomerLabels()` | timeline/approvals/settings 等 constants 仍中文 | 常量改 locale key 或 resolver；不删现有 key | Medium | **P1** | `src/lib/approvals/constants.ts`, `src/lib/customers/timeline/constants.ts`, `src/lib/constants/customer-fields.ts` |
| 任務中心 UI | API + Dashboard 統計 | 無 `/tasks` 列表頁 | 新增 page + nav link；复用 `GET /api/tasks/my`、complete API | Low–Medium | **P2** | `src/app/(dashboard)/tasks/**`（新建）, `src/lib/layout/nav-links.ts`, `src/middleware.ts` |
| 企業客戶多聯繫人 | `customer_contacts` 表 + 備份 | 無 API/UI | 新增 contacts CRUD API + 詳情 tab；權限沿用 customer access | Medium | **P3** | `src/lib/customers/**`, `src/app/api/customers/[id]/contacts/**`（新建）, `src/app/(dashboard)/customers/[id]/**` |
| R2 客戶附件 | R2 binding `ATTACHMENTS` | 無上傳/下載/列表 | 設計 metadata 表或 path 約定；upload API + 詳情展示 | Medium–High | **P4** | `src/lib/attachments/**`（新建）, `src/app/api/**`, `drizzle/schema/**`（若需 metadata 表则新 migration） |
| 備份恢復 | 備份 JSON + jobs 表 | 無 restore | 先 CLI/腳本 + 測試 D1 驗證；再考慮 Admin 只讀預覽 | **High**（數據） | **P4** | `scripts/restore/**`（新建）, `docs/**`, 可選 `src/app/(dashboard)/admin/backups/**` |
| Turnstile 登入驗證 | 預留于 README/ENV 文檔 | 未接入 | login API + login-form 接入；env 開關 | Medium | **P5** | `src/app/api/auth/login/route.ts`, `src/app/(auth)/login/**`, `docs/ENV.md` |
| Session 空閒登出 | setting 可存 | sessions 無 last_activity | schema migration + middleware/API 刷新；或 document as wont-fix | Medium–High | **P5** | `drizzle/schema/sessions.ts`, `src/lib/auth/session.ts`, `src/middleware.ts` |
| Staff 導出授權 | Admin-only export | Staff 403 | 若業務需要：role flag 或 per-user 權限 + export permission 層 | Medium | **P5**（待業務確認） | `src/lib/permissions/export.ts`, `src/app/api/export/**`, `drizzle/schema/users.ts`（若需字段） |
| middleware → proxy | 現用 middleware 守衛 | Next.js 16 deprecation 警告 | 按 Next 官方指南遷移；保持 matcher 行為等價 | Medium | **P5** | `src/middleware.ts` → proxy 約定文件, `next.config.*` |
| 清理 legacy/ 與孤立 i18n | `legacy/` 存檔 | 維護噪音 | 確認 `backup-before-d1-migration` 分支後再删；非功能需求 | Low | **Deferred** | `legacy/**`, `src/i18n/messages/zh-CN.ts` |
| 歷史通知 i18n 遷移 | 新通知用 i18n key | 舊 DB 中文 | 可選 batch 遷移或 display fallback；非必须 | Low | **Deferred** | `src/i18n/resolve-notification-content.ts`, 可選 migration script |

---

## 5. Recommended Priority

| 優先級 | 內容 | 理由 |
|--------|------|------|
| **P0** | build 穩定、GitHub 備份、權限不破壞 | 生產安全與所有權基線；任何功能不得牺牲 |
| **P1** | 完成 i18n Phase 16D 剩餘 + lib 常量統一 | 低業務風險、已規劃中的 Phase 16 延續；改善多語言一致性 |
| **P2** | 任務中心 UI | 後端已就緒，前端增量小、用戶感知高 |
| **P3** | 企業客戶多聯繫人（customer_contacts） | schema 已有，需 API + UI + 權限對齊 |
| **P4** | R2 附件 + 備份恢復 | 涉及存儲與數據安全，需設計與測試環境驗證 |
| **P5** | Turnstile、idle logout、middleware/proxy、Staff 導出 | 安全/框架升級或待業務確認的需求 |
| **Deferred** | legacy 清理、歷史通知遷移 | 不阻塞功能；需單獨評估 |

**建議實施節奏：**

```
17-1  本文檔凍結 baseline          ← 當前
17-2  P1 i18n 收尾（小步，每步 build）
17-3  P2 任務中心 UI（若無更高業務需求插入）
17-4+ 按業務方確認的需求調整 P3–P5 順序
```

---

## 6. Do Not Change Yet

在 Phase 17 需求未明確、或對應子階段未開工前，**暫不修改**：

| 類別 | 路徑 / 範圍 | 原因 |
|------|-------------|------|
| 環境密鑰 | `.env`, `.dev.vars` | 敏感；不在需求階段觸碰 |
| Cloudflare 部署 | `wrangler.jsonc`, `wrangler.cron.jsonc`, `wrangler.backup-cron.jsonc` | 生產路由/D1/R2 綁定穩定 |
| Git 遠端 | `git remote` | 所有權已建立，勿改 origin |
| 生產數據 | production D1 手動 SQL | 數據不可逆 |
| 權限核心規則 | `src/lib/permissions/customers.ts` 等核心 deny/mask 邏輯 | 除非需求明確變更 |
| 認證/session | `src/lib/auth/*`, session 表結構 | idle logout 未立項前不改 |
| 歷史存檔 | `legacy/` 目錄 | 不參與 build；刪除需另立項 |
| 已有 migrations | `drizzle/migrations/*` | 只追加新 migration，不改歷史文件 |
| 生產 Access | Cloudflare Access 策略 | 安全邊界 |
| Deploy | `npm run deploy` 及 cron deploy | 除非明確發布子 phase |

**新增需求例外流程：** 必須更新本文件 Mapping Table → 標 Priority → 再開發。

---

## 7. Acceptance Criteria

Phase 17 每個子階段（17-2、17-3…）完成時，均需满足：

### 構建與代碼質量

- [ ] `npm run build` 成功（零錯誤）
- [ ] TypeScript 檢查通過（build 內含）
- [ ] `npm run lint` 無新增 error（若該步觸及 lint 範圍）

### Git 與變更紀律

- [ ] `git status` clean（或僅含本步 intentional 變更）
- [ ] **小步 commit**：一個子功能一 commit，message 說明 phase 與目的
- [ ] 不提交 `.env`、secrets、本地 backup 文件

### 功能回歸（不破壞現有流程）

- [ ] Admin 可登入 → `/admin` → 客戶/導入/導出/備份/用戶/設置/公告
- [ ] Staff 可登入 → `/staff` → 自己的客戶/公共池/審批/通知
- [ ] Staff 仍 **不能** 訪問 Admin-only 路由（import/export/admin/*）
- [ ] 客戶權限：Staff 不能查看他人 active 客戶完整資料
- [ ] 公共池 Staff 視圖仍脫敏

### 部署（僅在明確發布步）

- [ ] deploy 前記錄當前 production version ID 以便 rollback
- [ ] deploy 後驗證 `/api/health` 與 `/login`

### 文檔

- [ ] 若行為或 API 有變，更新 README 或本文件對應行
- [ ] 新 env 變量僅寫入 `docs/ENV.md`，不写入聊天或 commit 密鑰值

---

## Appendix: Related Documents

| 文檔 | 用途 |
|------|------|
| [README.md](../README.md) | Phase 8–16 功能說明與測試命令 |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 部署與 rollback |
| [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md) | 權限回歸清單 |
| [ENV.md](./ENV.md) | 環境變量 |
| [PHASE_15B_REMOTE_PREP.md](./PHASE_15B_REMOTE_PREP.md) | 遠程環境準備記錄 |

---

## Change Log

| Date | Version | Change |
|------|---------|--------|
| 2026-06-24 | v1 | Phase 17-1 初版：基於 Phase 17 審查報告凍結 baseline |
