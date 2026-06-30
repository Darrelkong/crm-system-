# CRM Stable Release Checkpoint

**建立：** Phase RELEASE-CHECKPOINT-1（2026-06-30）  
**用途：** 記錄當前穩定版本基線，方便未來回溯、deploy 對照與 rollback 決策。  
**相關：** [SYSTEM_MAP.md](./SYSTEM_MAP.md) · [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) · [PRODUCTION_SMOKE_CHECKLIST.md](./PRODUCTION_SMOKE_CHECKLIST.md) · [TESTING.md](./TESTING.md)

---

## 1. 基線版本

| 項目 | 值 |
|------|-----|
| 最新 main commit | `79f2dc5` — Include notification tests in standard regression scripts |
| 最新 Cloudflare Version ID | `e7dd4abe-147f-4a4c-a0aa-92f67d1041df` |
| 正式域名 | https://crm.echfronthk.com |
| 狀態 | 正式站人工確認暫未發現問題 |

**D-4e 部署 commits（含本 checkpoint 前已上線）：**

| Commit | 說明 |
|--------|------|
| `2999495` | Cancel open tasks before purging recycled customers |
| `6d6eee9` | Handle deleted customer notification links |
| `79f2dc5` | Include notification tests in standard regression scripts |

---

## 2. 最近完成的主要模組

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
- **D-4e deploy：** 主 Worker 已部署（Version ID 見上）

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

---

## 5. 下一步候選方向

以下為規劃候選，**本 checkpoint 未實作**：

1. **AI insight 穩定性 / provider fallback** — 降低外部 API 失敗對 UX 的影響
2. **Public pool 更完整 API 測試** — 補 claim API / list API 整合測
3. **Notification fallback 正式站樣本確認** — 待 purge cron 產生 orphan 通知後再人工驗證
4. **UI polish** — 空狀態、loading、錯誤提示一致性
5. **Backup cron / restore flow 檢查** — 備份可還原性與 runbook 對照
6. **`merge_customers` placeholder 檢查** — 確認審批類型是否仍為 placeholder / 未啟用

---

## 回退參考

**Git revert（D-4e 三 commits）：**

```bash
git revert 2999495 6d6eee9 79f2dc5
git push
npm run deploy
```

**Cloudflare Dashboard：** Workers → `crm-system` → 回滾至上一個 production Version。

**本 checkpoint 文件回退：**

```bash
git revert <本文件 commit hash>
git push
```
