# Phase 1B：OpenAI-compatible AI 設定 — 部署後狀態

**記錄日期：** 2026-06-26  
**狀態：** 已部署至正式環境；**暫不啟用真實 OpenAI-compatible provider**  
**待完成：** 人工 UI 驗收（見第 4 節）

---

## 1. 部署摘要

| 項目 | 值 |
|------|-----|
| Commit | `83363bc` — Add Phase 1B OpenAI-compatible AI settings |
| 正式網址 | https://crm.echfronthk.com |
| Worker Version ID | `adc2ef09-fe9b-43aa-bc56-cbb750225fee` |
| 部署時間 (UTC) | 2026-06-26T00:09:31Z |
| Migration | **無**（復用既有 `system_settings` 表） |
| 新增依賴 | **無** |

---

## 2. 正式環境安全狀態（已確認）

| 檢查項 | 狀態 |
|--------|------|
| `AI_API_KEY` Worker Secret | ❌ 未配置（`wrangler secret list` 僅 `SESSION_SECRET`） |
| `system_settings` 含 `AI_API_KEY` | ❌ 無 |
| `system_settings` 含 `ai_*` row | ❌ 無 → 走 **code defaults** |
| `ai_enabled` | `false`（default） |
| `ai_provider` | `mock`（default） |
| 部署後新增 `customer.ai_insight.refreshed` audit | ❌ 無（自 deploy 起 0 筆） |
| AI cron / batch / 自動 refresh | ❌ 無 |
| 外部 AI API 調用 | ❌ 無 |
| `customer_ai_insights` 表 | ✅ 正常（3 筆，均為 `mock-customer-insight-v1`，Phase 1A 手動產生） |

---

## 3. 已部署功能範圍

- Admin AI 設定頁：`/admin/ai-settings`
- Admin AI 設定 API：`GET/PATCH /api/admin/ai-settings`
- OpenAI-compatible provider（程式已就緒，**正式環境未啟用**）
- HTTPS-only Base URL validation + fail-closed effective settings（Phase 1B-1a / 1B-1b）
- 客戶詳情 AI 面板：手動 refresh only，預設 mock

**未修改：** auth / session / idle timeout / Cloudflare Access / login / logout

---

## 4. 待完成：人工 UI 驗收

在以下驗收完成前，**禁止**啟用真實 provider：

- [ ] **不要** 執行 `wrangler secret put AI_API_KEY`
- [ ] **不要** 啟用 `ai_enabled`
- [ ] **不要** 切換 `openai_compatible`
- [ ] **不要** 做自動 refresh / cron

### 驗收步驟

1. Admin 登入 → `/admin/ai-settings`
2. 確認 API Key 狀態顯示「未配置」
3. 確認 AI 功能關閉、Provider = Mock
4. Admin 進入 active 客戶詳情頁，確認 AI 面板正常載入
5. 點「重新分析」，確認仍走 mock（`model` 應為 `mock-customer-insight-v1`）
6. Staff 帳號測試：無法進入 `/admin/ai-settings`
7. masked / archived_basic 用戶：仍無法查看 AI 洞察（403 / 權限不足提示）

### 驗收記錄（完成後填寫）

| 步驟 | 結果 | 驗收人 | 日期 |
|------|------|--------|------|
| 1–3 Admin AI 設定頁 | | | |
| 4–5 客戶詳情 mock refresh | | | |
| 6 Staff 無法進 Admin AI 設定 | | | |
| 7 masked / archived_basic 權限 | | | |

---

## 5. 下一步（UI 驗收通過後，另行決定）

僅在明確授權後執行：

1. `wrangler secret put AI_API_KEY`
2. Admin → AI 設定：暫時 `ai_enabled=true` + `openai_compatible` + 合法 HTTPS Base URL
3. **單一** full access 客戶手動「重新分析」做真 API 煙霧測試
4. 確認 audit：`providerKind=openai_compatible`，無 prompt/context/raw response 洩露
5. 測試完畢後關閉 `ai_enabled` 或改回 `mock`

---

## 6. 相關文檔

- [ENV.md](./ENV.md) — `AI_API_KEY` 環境變數說明
- [DEPLOYMENT.md](./DEPLOYMENT.md) — 部署與 Secret 配置步驟
