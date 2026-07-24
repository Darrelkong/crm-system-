# Worker 1102 Incident — 2026-07-24

**類型：** Production 觀察記錄（只讀診斷結果）
**建立：** 2026-07-24
**相關：** [QUICK_ENTRY_V2_COMPLETION.md](./QUICK_ENTRY_V2_COMPLETION.md) · [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md)

本文只記錄已確認事實與當前決策。不含 Cookie、JWT、Session Token、完整 IP、Access Email、客戶 PII 或完整 Request Headers。

---

## 1. Incident Summary

| 項目 | 值 |
|------|-----|
| Date | 2026-07-24 |
| User-visible Error | Error 1102 — Worker exceeded resource limits |
| Ray ID | `a200c8857d34d9fa` |
| Request | `GET /`（`https://crm.echfronthk.com/`） |
| HTTP Status | 503 |
| Outcome | `exceededCpu` |
| CPU Time | 10ms |
| Wall Time | 601ms |
| Worker Version | `f9b2bfc6-6611-489b-85dc-8023d65b6e6c` |
| Colo | LAX |

---

## 2. 已確認事項

- Cloudflare Access 已通過（錯誤發生在 Access 之後的 Worker）
- 錯誤發生在 Worker，不是 Access OTP／登入頁本身
- Outcome 為 **`exceededCpu`**（不是記憶體超限標記）
- 請求路徑為 **`GET /`**，不是 Quick Entry customers API
- 不是 D1 Migration 問題（遠端 migrations list 為 No migrations to apply）
- Quick Entry Phase C **沒有**直接修改 `/`、`middleware`、session 或 API（`edf5148..a8af3aa` 僅 UI／i18n／CSS／form displayName）
- Workers 方案為 **Free**
- Repository **沒有**配置 `limits.cpu_ms`
- Free 方案單次請求 CPU 上限為 **10ms**
- 本次 Request 在 **10ms** 時被終止（與 Ray 記錄一致）
- 同一觀察時間窗出現多筆 `exceededResources` analytics 記錄（不得解讀為使用者連續看到 28 次錯誤頁）
- CRM 後續重新登入正常
- 本次 Live Tail 觀察期間**未再次復現** 1102

---

## 3. 可能相關路徑

已確認根路徑鏈路（程式碼結構）：

```
GET /
→ Cloudflare Access
→ OpenNext Worker
→ middleware
→ session validation
→ redirect
```

Session validation **可能**包含（構成 CPU／等待負載的候選，**非**已證明的唯一根因）：

- token hash
- D1 session／user query
- idle timeout
- device authorization
- global idle／epoch checks
- conditional session touch

只能視為「可能構成 CPU 負載」；不得寫成已鎖定的單一根因。

---

## 4. 排除項目

| 項目 | 狀態 |
|------|------|
| Quick Entry Phase C 作為本次失敗直接路由 | 已排除（失敗為 `GET /`） |
| Backend Diff（Phase C） | 無 |
| API Diff（Phase C） | 無 |
| Migration | 無 |
| D1 Schema Change | 無 |
| 新第三方依賴 | 無 |
| Production Data Write（因本事件） | 無 |

---

## 5. 當前決策

- 暫不升級 Workers Paid
- 暫不 Rollback
- 暫不修改 CPU 設定
- 暫不修改 Root Route／middleware／session
- 保持目前 Production Version：`f9b2bfc6-6611-489b-85dc-8023d65b6e6c`
- Rollback Baseline 保留：`8a0e87b3-3221-4678-b333-8ddcd9f3809c`
- 進入 **48 小時觀察期**

---

## 6. 觀察條件

### 可以繼續觀察

- CRM 可正常登入
- 未再出現 1102
- 員工未持續回報 503
- `exceededCpu` 沒有持續增加

### 需要重新處理

- 再次出現 1102
- 一天內多次 `exceededCpu`
- 多位員工無法登入
- `/`、`/admin`、`/api/auth/me` 出現持續 503
- 系統影響日常工作

---

## 7. 再次發生時的處理順序

1. 保存 Ray ID、時間、path、outcome、CPU、wall（脫敏，不含 Cookie／Token／PII）
2. 查看同時間是否為 burst（analytics／logs）
3. 確認是否仍為 `GET /`
4. 如服務可用，先診斷，不急於改設定
5. 如持續不可用，Rollback 至：`8a0e87b3-3221-4678-b333-8ddcd9f3809c`
6. 評估 Root Route／Session CPU Hotfix
7. 評估 Workers Paid

---

## 8. 隱私注意

本文件與相關診斷輸出不得包含：

- 真實 IP（完整位址）
- Access Email
- Cookie
- JWT／Access Token
- Session Token
- TLS Fingerprint
- 客戶 PII
- 完整 Request Headers
