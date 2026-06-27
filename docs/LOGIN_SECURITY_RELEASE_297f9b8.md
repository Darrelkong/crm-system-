# CRM 登入安全功能 — 正式穩定版本記錄

**文檔日期：** 2026-06-27  
**狀態：** production 已上線，手動抽測通過

---

## 1. 功能名稱

**CRM 登入安全提示與後端 IP 級限制**

---

## 2. 正式版本

| 項目 | 值 |
|------|-----|
| Commit | `297f9b8` — Add login IP email restriction safeguards |
| 正式網址 | https://crm.echfronthk.com/login |
| Cloudflare Version ID | `9a5403ee-d708-442c-91be-e6443a11abb2` |
| 上線順序 | push → remote migration → deploy |

---

## 3. 已完成內容

- **正在登入彈窗** — 點擊登入後立即顯示「正在登入，請等待」，處理期間禁止重複提交
- **無權限 email 提示** — 無效 / 無權限 email 顯示「無法驗證登入權限」正式彈窗（`UNAUTHORIZED_EMAIL`）
- **錯誤 email IP 限制** — 同一 IP 連續 3 次無效 / 無權限 email 觸發限制（第 1、2 次僅提示，第 3 次起限制）
- **限制時間階梯** — 60 / 120 / 300 秒（依 penalty level）
- **後端 D1 持久化** — `login_ip_email_restrictions` 表記錄 IP 限制狀態
- **刷新後倒計時不重置** — 頁面載入時呼叫 `GET /api/auth/login/ip-email-restriction`，倒計時由 `restrictedUntil` 計算
- **登入成功清理** — 正確登入後清除該 IP 的錯誤 email 限制記錄
- **密碼錯誤邏輯保留** — 正確 email + 錯誤密碼仍走原有帳戶鎖定（3 次鎖定），不計入 IP email 限制
- **admin 豁免保留** — Admin 不受自動帳戶鎖定限制
- **Cloudflare Access** — 正常；正式站仍受 Access 保護，登入流程與 Access 窗口驗證不變
- **ACCOUNT_LOCKED 原彈窗** — 未改動，行為與 UI 保持原樣

### 新增 API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/auth/login/ip-email-restriction` | 登入前只讀查詢當前 IP 限制狀態（不需 session） |
| POST | `/api/auth/login` | 擴展 IP 限制檢查與 unauthorized email 處理（原有登入邏輯不變） |

---

## 4. Migration

| 項目 | 值 |
|------|-----|
| 檔案 | `0023_login_ip_email_restrictions.sql` |
| 操作 | `CREATE TABLE login_ip_email_restrictions` + index |
| 狀態 | **production 已正式套用**（2026-06-27） |
| 指令 | `npm run db:migrate:remote` |

**表結構摘要：**

- `ip_address`（PRIMARY KEY）
- `failed_email_attempts`
- `penalty_level`
- `restricted_until`
- `created_at` / `updated_at`

**安全特性：** 僅新增獨立表，無 DROP / DELETE / TRUNCATE，未修改 `users`、`sessions` 或客戶資料表。

---

## 5. 測試結果

| 項目 | 結果 |
|------|------|
| Unit tests | 25/25 通過（ip-email-restriction、login-ip-restriction-client、lockout） |
| `npx tsc --noEmit` | 通過 |
| `npm run build` | 通過 |
| 本地 D1 migration | `0023` 已套用，「網路錯誤」根因（`no such table`）已解決 |
| 正式 remote migration | 成功 |
| 正式 deploy | 成功 |
| 正式網站手動抽測 | **通過**（通過 Cloudflare Access 後） |

### 本地 / 正式抽測確認項

- 正確 email + 正確密碼可登入
- 點擊登入顯示「正在登入，請等待」
- 錯誤 email 第 1、2 次 →「無法驗證登入權限」
- 錯誤 email 第 3 次 → 60 秒 IP 限制（`IP_EMAIL_RESTRICTED`）
- 限制期間不可關閉紅色倒計時彈窗，表單 disabled
- 刷新登入頁後倒計時延續，不重置
- 正確 email + 錯誤密碼 → 原有帳戶鎖定邏輯
- `ACCOUNT_LOCKED` 原彈窗正常
- admin 豁免正常
- 登入成功後可正常進入 CRM

---

## 6. 回退方式

若需回退代碼至本功能上線前：

```bash
git revert 297f9b8
git push
npm run deploy
```

**Migration 回退：** 通常不需要。`login_ip_email_restrictions` 為獨立新表，回退代碼後舊版不會讀寫該表，留空不影響運作。若需完全清理可手動 `DROP TABLE login_ip_email_restrictions`（非必須）。

---

## 7. 注意事項

1. **新增 D1 表可保留** — 回退代碼時不必刪除 `login_ip_email_restrictions`。
2. **若正式登入出現 `no such table: login_ip_email_restrictions`** — 表示 remote migration 未套用或失敗，應先執行 `npm run db:migrate:remote` 確認 `0023` 成功，再 deploy。
3. **不建議直接修改登入安全邏輯** — 除非另開新階段；本版本為正式穩定基線。
4. **Cloudflare Access** — 未認證外部請求無法直接 curl 登入頁或 status endpoint；抽測需通過 Access。
5. **部署順序** — 永遠先 migration、後 deploy，避免正式站出現與本地相同的 D1 表缺失錯誤。

---

## 8. 相關文檔

- [STABLE_RELEASE_2026_06_27.md](./STABLE_RELEASE_2026_06_27.md)
- [DEPLOYMENT.md](./DEPLOYMENT.md)

---

*本文檔僅記錄 `297f9b8` 登入安全功能穩定版本狀態，不包含後續功能變更。*
