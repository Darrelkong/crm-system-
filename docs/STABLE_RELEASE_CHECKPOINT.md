# CRM Stable Release Checkpoint

**建立：** Phase RELEASE-CHECKPOINT-1（2026-06-30）  
**更新：** Phase AI-RELEASE-CHECKPOINT-1（2026-06-30）— AI-2 / AI-2g 穩定基線  
**用途：** 記錄當前穩定版本基線，方便未來回溯、deploy 對照與 rollback 決策。  
**相關：** [SYSTEM_MAP.md](./SYSTEM_MAP.md) · [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) · [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md) · [TESTING.md](./TESTING.md)

---

## 1. 基線版本

| 項目 | 值 |
|------|-----|
| 最新 main commit | `df4f99b` — Document AI insight data usage scope |
| 最新 Cloudflare Version ID | `6e78330d-61b1-44a9-9b5b-12edaf0429ff` |
| 正式域名 | https://crm.echfronthk.com |
| 狀態 | AI-2g post-deploy smoke 未發現問題；登入後 UI 仍建議人工確認 |

**AI-2 / AI-2g 部署 commits（當前 production 基線）：**

| Commit | 說明 |
|--------|------|
| `49dd7c7` | Add AI provider error handling tests |
| `603e9ad` | Stabilize notification query regression test |
| `b55f55a` | Improve AI insight error messages |
| `907dcb6` | Add AI insight refresh cooldown |
| `ea11e7f` | Add AI insight context sanitize helper |
| `5ee06c0` | Sanitize AI insight context before provider prompt |
| `df4f99b` | Document AI insight data usage scope |

**先前 D-4e 基線（已 supersede）：** commit `79f2dc5` · Version `e7dd4abe-147f-4a0c-a0aa-92f67d1041df`

| Commit | 說明 |
|--------|------|
| `2999495` | Cancel open tasks before purging recycled customers |
| `6d6eee9` | Handle deleted customer notification links |
| `79f2dc5` | Include notification tests in standard regression scripts |

---

## 2. 最近完成的主要模組

### Phase AI-2 / AI-2g — AI insight 安全與資料最小化

- **AI-2a：** AI provider 503 / 429 / timeout / invalid response 單元測試
- **AI-2b：** AI 錯誤提示安全分類（API 回傳固定文案，不暴露 raw provider error）
- **AI-2d：** AI refresh **5 分鐘** cooldown（429 + `AI_REFRESH_COOLDOWN`）
- **AI-2g-1 / 2g-2：** Provider prompt **不再包含**結構化 `phone` / `wechatId` / `email`；`notes` / `sourceRemark` / follow-ups **仍保留**
- **AI-2g-3：** Help Center 三語說明 AI 資料使用範圍（Admin / Staff 分角色 section + FAQ）
- **sourceHash：** 暫未調整（本來不含結構化聯絡欄位；policy version 留待後續）
- **AI-2g deploy：** 主 Worker 已部署（Version ID 見 §1）

### Phase F — 敏感資料與公共池隱私

- F-2：新增客戶 5 秒確認 modal
- F-3：Staff 不可修改敏感欄位（PATCH + 表單雙層）
- F-4：客戶詳情聯絡方式遮罩（小眼睛暫時查看）
- F-5：公共池 Staff 姓名脫敏、Admin 完整顯示

### HELP-2 / HELP-2a — 幫助中心

- Admin / Staff 分角色 sections 與 FAQ
- 公共池 quota 說明文案修正（7 天內最多 N 次）

### SYSTEM-MAP-1 — 文件與 runbook

- [SYSTEM_MAP.md](./SYSTEM_MAP.md)
- [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md)
- [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md)

### TEST-1a / TEST-2 / TEST-4 / TEST-4a — 測試基礎建設

- Public pool display / claim-limits 測試
- Help Center 角色過濾測試
- 標準 `npm run test:*` / `test:regression:full` scripts
- Notifications href / queries 測試納入 regression

### D-4e — 回收站 purge orphan 處理

- **D-4e-2a：** purge / permanent delete 前取消該客戶的 open tasks；audit metadata 補 `customerCode` / `customerType` / `deletedReason`
- **D-4e-2b：** 已刪客戶的通知保留歷史，但不再產生 `/customers/{id}` 死連結；UI 顯示「相關客戶已永久刪除」
- **D-4e deploy：** 主 Worker 已部署（Version ID 見 §1 先前基線）

---

## 3. 已知安全邊界

| 邊界 | 說明 |
|------|------|
| Staff 敏感資料 | Staff **不可**修改姓名、聯絡方式、來源等敏感欄位（建立後鎖定） |
| Staff EF 可見性 | Staff **看不到** EF / customerCode |
| Admin 敏感資料 | Admin **可**修改敏感欄位、管理共同負責 |
| 公共池 Staff 視圖 | 姓名脫敏（首字 + `**`）；quota / cooldown 限制領取 |
| 公共池 Admin 視圖 | 完整姓名與聯絡欄位 |
| 回收站保留 | **90 天** soft delete；期內可 restore |
| Permanent delete | **不可恢復**；會寫入 `customer.deleted.permanent` audit |
| Purge preview | **只讀** API；不觸發刪除 |
| Purge 行為（D-4e） | open tasks → `cancelled`；notifications 保留但 orphan link 已 fallback |
| 正式站存取 | **Cloudflare Access** OTP 保護；未登入 API 回 302 |

### AI insight 安全邊界（AI-2 / AI-2g）

| 邊界 | 說明 |
|------|------|
| API key | **不讀取 / 不輸出** `AI_API_KEY`；僅 Worker Secret + Admin 顯示 `apiKeyConfigured` |
| Provider 錯誤 | API **不**向前端暴露 provider raw error / HTTP body |
| Diagnostics / audit | refresh 失敗 audit **不含** prompt、raw body、secret |
| 結構化聯絡資料 | **預設不送** AI provider：`phone` / `wechatId` / `email` |
| 文字型 PII | `notes` / follow-up `summary` **仍可能**含手動輸入的聯絡方式；員工應避免在備註重複填寫不必要聯絡資料 |
| Refresh 節流 | 同一客戶 **5 分鐘** cooldown；命中不呼叫 provider |
| 預設 provider | 正式站預設 **mock**；啟用 `openai_compatible` 需 Admin 設定 + Secret |
| Help 透明度 | Help Center 已說明 AI 資料範圍（三語） |

---

## 4. 禁止事項

- **不要**在正式站對真實客戶測試 permanent delete
- **不要**隨意手動或 cron 執行 purge（需先 `purge-preview` 審閱）
- **不要**直接改 remote D1（schema / seed / 手動 SQL）
- **不要**未確認 migration 內容就執行 `npm run db:migrate:remote`
- **不要**以為 `npm run deploy` 會更新 Cron Workers — cron 需各自 deploy：
  - `npm run cron:deploy`（自動回收）
  - `npm run cron:recycle:deploy`（回收站 purge）
  - `npm run cron:backup:deploy`（備份）
- **不要**在 production 跑 local D1 測試（`CRM_ALLOW_TEST_DB_BIND=1`）
- **不要**在 production smoke 中大量點 AI refresh 或連續呼叫真實 AI provider

---

## 5. 下一步候選方向

以下為規劃候選，**本 checkpoint 未實作**：

1. **AI-2g-4：** 可選 Admin setting 控制 AI 是否可使用敏感聯絡資料
2. **AI-2g-5：** `notes` / follow-up summary 內嵌電話、email、微信文字遮罩
3. **AI-2e：** fallback provider 設計
4. **AI-2f：** AI 使用成本 / token 估算與日限額
5. **AI production smoke：** 通過 Cloudflare Access 後，使用測試客戶**單次** refresh 驗證（mock 或已配置 provider）
6. **Public pool 更完整 API 測試** — 補 claim API / list API 整合測
7. **Notification fallback 正式站樣本確認** — 待 purge cron 產生 orphan 通知後再人工驗證
8. **UI polish** — 空狀態、loading、錯誤提示一致性
9. **Backup cron / restore flow 檢查** — 備份可還原性與 runbook 對照
10. **`merge_customers` placeholder 檢查** — 確認審批類型是否仍為 placeholder / 未啟用

---

## 回退參考

**Git revert（AI-2g runtime + docs，保留 helper）：**

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

**Git revert（AI-2 全線：error UX + cooldown + AI-2g）：**

```bash
git revert b55f55a 907dcb6 ea11e7f 5ee06c0 df4f99b
git push
npm run deploy
```

**Git revert（D-4e 三 commits）：**

```bash
git revert 2999495 6d6eee9 79f2dc5
git push
npm run deploy
```

**Cloudflare Dashboard：** Workers → `crm-system` → 回滾至上一個 production Version（例如 AI-2 deploy 前 `7c240043-52cb-4ad3-bfdc-bf7b3fc777b9`，或 D-4e `e7dd4abe-147f-4a0c-a0aa-92f67d1041df`）。

**本 checkpoint 文件回退：**

```bash
git revert <本文件 commit hash>
git push
```
