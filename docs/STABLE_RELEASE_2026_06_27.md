# CRM 穩定版本功能清單與部署記錄

**文檔日期：** 2026-06-27  
**狀態：** 當前 production 穩定基線

---

## 1. 版本基本信息

| 項目 | 值 |
|------|-----|
| 文檔日期 | 2026-06-27 |
| 正式網址 | https://crm.echfronthk.com |
| 最新穩定 commit | `5414dd4` |
| 最新 Cloudflare Version ID | `f0ff9427-28a6-448e-a8e9-04f065bd5dfb` |
| 最新 migration | `0022_customer_tags.sql` |
| migration 狀態 | production 已執行成功 |

**上線順序（2026-06-27）：** push → production migration → deploy

---

## 2. 今日主要完成模組

### UI-STABILIZE / NAV-2A

- 分組導航、sidebar / mobile shell 重構
- Dashboard、客戶列表 / 詳情響應式 UI
- 設計 token 與 UI primitives 統一
- 相關 commit：`b1a16b7` — Complete NAV-2A navigation update

### 香港時區顯示

- UI 與 Reports 使用 `Asia/Hong_Kong` 顯示時間
- DB 仍保存 UTC
- 相關 commit：`13f3680` — Fix timezone display for Hong Kong

### 客戶回收站 90 天保留

- 軟刪除客戶進回收站，保留 90 天後可永久刪除
- 相關 commit：`8b5e64e` — Implement safe account lockout and recycle bin；`b4a2c48` — Add recycle bin retention tests

### 已刪除員工紀錄 + 客戶轉移至 Admin

- 員工 soft delete 後客戶 ownership 轉 Admin
- 已刪除員工不可登入
- 相關 commit：`474b744` — Enhance deleted user records

### 密碼錯誤 3 次鎖定 + Admin 解鎖

- 連續密碼錯誤觸發帳戶鎖定
- Admin 可在用戶管理解鎖 Staff
- Admin 不受自動鎖定限制
- 相關 commit：`8b5e64e` — Implement safe account lockout and recycle bin

### ACCOUNT_LOCKED 紅色倒計時 modal

- 鎖定時顯示紅色倒計時 modal，提示剩餘鎖定時間
- 相關 commit：`d7fbc28` — Add login lockout modal

### Timeout 登入重試流程

- Session / Access timeout 後登入重試流程修復
- 相關 commit：`b166686` — Fix timeout login retry flow

### 安全策略頁

- Admin 安全策略設定頁
- 相關 commit：`1958bb0` — Add security policies page

### 幫助中心

- 幫助中心頁面與內容
- 相關 commit：`0ed1ba9` — Enhance help center

### 公告與通知 UX

- 公告已讀狀態（localStorage）
- 通知 UX 改進
- 香港時區顯示
- 相關 commit：`f97da1a` — Improve announcements and notifications UX

### Reports 報告頁

- Admin / Staff 報告視圖
- Admin 全局統計；Staff 僅自身數據
- 相關 commit：`14d2a20` — Enhance reports page

### Follow-ups 跟進紀錄頁

- `/follow-ups` 跟進列表頁（取代 placeholder）
- 相關 commit：`29b43a1` — Add follow-ups list page

### Tags & Stages 標籤與階段頁

- `/admin/tags-stages` 標籤與階段概覽
- 銷售階段只讀展示
- 相關 commit：`da90f15` — Add tags and stages overview

### 客戶標籤 CRUD

- `customer_tags` 配置表
- Admin 可新增 / 修改名稱 / 刪除標籤
- 刪除已使用標籤時客戶 `source` 自動轉為 `other`
- 「其他」為系統標籤，不可刪除
- 相關 commit：`5414dd4` — Add customer tag management

### 銷售階段新增客戶必填

- 新增客戶時銷售階段默認為空，必須手動選擇
- 前端 + 後端雙重驗證
- 編輯客戶保持兼容舊資料回填
- 包含於 commit：`5414dd4`

### 公共池釋放規則：已成交不自動釋放

- 僅 `closed_won` 與 legacy `converted` 排除自動回收
- 其他階段（含 `closed_lost`、`on_hold`、`new_lead` 等）仍按原規則釋放
- 包含於 commit：`5414dd4`

---

## 3. Migration 記錄

### `0022_customer_tags.sql`

| 項目 | 說明 |
|------|------|
| 操作 | 新增 `customer_tags` 表 |
| Seed | 7 個標籤（`xianyu_taobao`、`xiaohongshu`、`douyin`、`referral`、`online_media`、`agent_client`、`other`） |
| 系統標籤 | `other` — `is_system=1`，不可刪除 |
| 客戶欄位 | **未修改** `customers` 表結構 |
| 客戶資料 | **未批量修改** `customers.source` |
| 約束 | `tag_key` UNIQUE；PRIMARY KEY on `id` |
| 危險操作 | 無 DROP / DELETE / TRUNCATE |

### Production 驗證（2026-06-27）

- `customer_tags` 表已存在
- 7 個 seed 標籤已寫入 production D1
- `other` 存在且 `is_system=1`
- `customers.source` 分布未被 migration 批量改動
- 無待套用 migration

### 執行順序

1. `git push origin main`（commit `5414dd4`）
2. `npm run db:migrate:remote`（僅一次）
3. `npm run deploy`

---

## 4. 安全與資料確認

| 檢查項 | 狀態 |
|--------|------|
| 未提交 secret / `.env` | ✅ |
| 未批量修改 production customers | ✅ |
| 未改密碼 hash 演算法 / 既有 hash | ✅ |
| 未改 auth/session 核心邏輯（除登入鎖定與 timeout 修復外） | ✅ |
| 未硬刪客戶（回收站外） | ✅ |
| 回收站仍為 soft delete | ✅ |
| DB 時間保存 UTC，UI 顯示香港時間 | ✅ |

---

## 5. 權限邊界

| 功能 | Admin | Staff |
|------|-------|-------|
| Reports 全局視圖 | ✅ 可看全局 | ❌ 僅自身 |
| 客戶標籤管理（CRUD） | ✅ | ❌ 僅讀（`/api/customer-tags`） |
| 回收站 | ✅ | ❌ |
| 解鎖被鎖 Staff | ✅ | ❌ |
| 自動鎖定 | ❌ 不受限制 | ✅ 3 次密碼錯誤觸發 |
| 已刪除員工登入 | N/A | ❌ 不可登入 |
| `/admin/tags-stages` | ✅ | ❌（admin layout） |
| Follow-ups 列表 | ✅ 全局 | ✅ 自身相關 |

---

## 6. 需要人工登入驗證的項目

正式站受 Cloudflare Access 保護，以下項目需 Admin / Staff 帳號手動 smoke test：

### 標籤與客戶

- [ ] `/admin/tags-stages` — 標籤新增
- [ ] `/admin/tags-stages` — 標籤修改名稱
- [ ] `/admin/tags-stages` — 刪除未使用標籤
- [ ] `/admin/tags-stages` — 刪除已使用標籤，客戶 `source` 轉為「其他」
- [ ] `/admin/tags-stages` — 「其他」不可刪除
- [ ] 新增客戶 — 銷售階段默認空、未選不可提交
- [ ] 新增客戶 — 選擇銷售階段後可提交
- [ ] 客戶詳情 / 編輯 — 舊 `source` / `sales_stage` 正常顯示

### Reports / Follow-ups

- [ ] `/reports` — Admin 可看全局統計
- [ ] `/reports` — Staff 僅看自身數據
- [ ] `/follow-ups` — Admin 全局跟進列表
- [ ] `/follow-ups` — Staff 僅自身跟進

### 安全與登入

- [ ] ACCOUNT_LOCKED 紅色倒計時 modal
- [ ] Timeout 第 3 次 Access logout 後重試登入流程

### 回收站

- [ ] 回收站 — 恢復客戶
- [ ] 回收站 — 永久刪除（90 天保留規則內）

### UI / 移動端

- [ ] 手機 More drawer 導航正常
- [ ] Dashboard 公告 / 通知卡片顯示正常

---

## 7. 已知限制 / 後續建議

### 已知限制

1. **公告已讀** — 目前使用 `localStorage`，跨設備 / 跨瀏覽器不同步。
2. **銷售階段管理** — `/admin/tags-stages` 中銷售階段目前仍為只讀展示，未提供 CRUD。
3. **客戶標籤模型** — 目前是 `customer_tags` 配置表 + `customers.source` 單標籤模式，不是 many-to-many 多標籤。
4. **Cloudflare Access** — 自動化 smoke test 無法繞過 Access 登入 barrier。

### 後續建議

1. 完成一輪 **Admin + Staff 人工 smoke test**（見第 6 節 checklist）。
2. 若需 **多標籤**，未來可考慮新增 `customer_tag_assignments` 關聯表，需獨立 migration 與 backfill 方案。
3. 若需 **銷售階段可配置化**，需新增 stages 配置表，與現有 `customers.sales_stage` 常量解耦。
4. 後續大功能建議：**單獨分支 → 單獨 migration → 先 migration 後 deploy**。
5. 公告已讀若需跨設備同步，可改為 server-side read state（需新表或現有 notifications 擴展）。

---

## 8. 最近關鍵 commit 清單

| Commit | 說明 |
|--------|------|
| `5414dd4` | Add customer tag management |
| `da90f15` | Add tags and stages overview |
| `29b43a1` | Add follow-ups list page |
| `14d2a20` | Enhance reports page |
| `f97da1a` | Improve announcements and notifications UX |
| `0ed1ba9` | Enhance help center |
| `b166686` | Fix timeout login retry flow |
| `1958bb0` | Add security policies page |
| `d7fbc28` | Add login lockout modal |
| `474b744` | Enhance deleted user records |
| `b4a2c48` | Add recycle bin retention tests |
| `13f3680` | Fix timezone display for Hong Kong |
| `b1a16b7` | Complete NAV-2A navigation update |
| `8b5e64e` | Implement safe account lockout and recycle bin |
| `c66941b` | Add safe AI diagnostics for provider failures |
| `83363bc` | Add Phase 1B OpenAI-compatible AI settings |
| `31148de` | Add Phase 1A customer AI insight mock framework |
| `a40784b` | Set inactivity logout to 30 minutes |

---

## 9. 相關文檔

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [ENV.md](./ENV.md)
- [PRE_LAUNCH_PERMISSION_CHECKLIST.md](./PRE_LAUNCH_PERMISSION_CHECKLIST.md)
- [PHASE_1B_DEPLOYMENT_STATUS.md](./PHASE_1B_DEPLOYMENT_STATUS.md)

---

*本文檔僅記錄穩定版本狀態，不包含運維操作指令。Production 變更請遵循 push → migration → deploy 順序。*
