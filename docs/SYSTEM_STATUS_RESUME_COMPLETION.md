# System Status Resume Completion

## 1. Status

- Task：CRM page resume / online status auto-recovery
- Manual Acceptance：Passed（使用者真機驗收）
- Production Release：Deployed（frontend Worker）
- Follow-up docs commit：this file only
- Final conclusion：**此任務已完成，不需要繼續調整**

## 2. Original Problem

CRM 已開啟全局免閒置超時，不再因 30 分鐘無操作強制退出。但在以下情況：

- iPhone Safari 切到後台再開啟
- 手機鎖屏後重開 CRM
- 瀏覽器分頁長時間靜置後返回
- 電腦休眠後恢復
- 網路短暫中斷後恢復

右上角在線狀態常出現：

1. 先顯示「正在檢查」
2. 隨後變紅並卡住
3. 必須手動刷新，或切換到其他 CRM 頁面後，才重新變綠並恢復可操作

實際上 CRM Session 往往仍有效，並非真正退出。

後續真機還發現：

- 從後台恢復後約 1 分鐘才變綠（高度吻合 45 秒背景 health poll）
- 變綠後切換 CRM 路由又進入長時間 checking

## 3. Root Causes

1. **狀態燈與頁面恢復脫節**  
   `SystemStatusBadge` 原先主要以 `/api/health` 輪詢為準，恢復時未穩定執行「Session 確認 + 當前頁面軟刷新」。

2. **Safari 事件不可靠**  
   僅依賴 `visibilitychange`／`pageshow`／`focus`／`online` 時，iPhone Safari 從後台恢復不一定立即觸發完整 resume；常拖到背景 45 秒 poll 才間接觸發。

3. **假綠燈風險**  
   背景 health poll 曾可在 Session／頁面未完整恢復時，把 `offline`／`checking` 直接升成綠色。

4. **跨 segment remount + cache**  
   各 dashboard segment 各自掛載 `DashboardShell`，路由切換會 remount Badge。若 resume 開頭清空 cache、且成功結果未可靠回寫，remount 會以 `checking` 起步並再次完整 resume。

## 4. Fixes Delivered

### 4.1 Full resume path

完整恢復流程：

```text
checking
→ /api/auth/me Session probe（臨時錯誤有限重試）
→ startTransition(router.refresh()) + wait isPending（含 timeout／never_pending fallback）
→ live /api/health
→ 成功才顯示綠色並寫入短 TTL cache
```

- 禁止 `window.location.reload()`
- 復用既有 `interpretAuthMeResponse`；明確 Session 失效仍走既有安全流程
- generation + AbortController 防止舊請求覆蓋新狀態
- resume gate debounce，合併多事件／heartbeat 重複觸發

### 4.2 Prevent false green

- 背景 health poll：**只能降級，不能單獨把 offline／checking 升成 online**
- offline／checking 且 health 恢復時：只 `requestResume()`，必須走完整 resume 才變綠
- 無可靠 cache 時初始狀態為 `checking`，不做樂觀綠

### 4.3 Safari / background resume

- 保留 `visibilitychange`、`pageshow`（含 BFCache）、`focus`、`blur`、`online`
- 新增本地 elapsed heartbeat：
  - 間隔約 **3 秒**（只比對本地時間，不打 API）
  - gap ≥ **10 秒** 且頁面 `visible`、且未在 resume 中 → `requestResume()`
- mount／remount：無新鮮 online／degraded cache 且 visible → 立即完整 resume
- 有新鮮成功 cache 時：顯示 cache，不因普通 remount 長時間 checking

### 4.4 Cache rewrite after successful resume

- 完整 resume 成功後寫回短 TTL module cache（約 50 秒）
- 不再在 resume 開頭清空成功 cache，避免跨路由 remount 假 checking
- checking 不得寫成 online cache

## 5. Files Changed

```text
src/components/layout/system-status-badge.tsx
src/components/layout/system-status-resume.ts
src/components/layout/system-status-resume.test.ts
src/components/layout/system-status-cache.ts
src/components/layout/system-status-cache.test.ts
docs/SYSTEM_STATUS_RESUME_COMPLETION.md
```

## 6. Commits

| Commit | Message |
|--------|---------|
| `f0e350a` | Improve session recovery after page resume |
| `7e42f33` | Prevent health polling from showing false online status |
| `7a6a984` | Detect Safari resume using elapsed heartbeat |
| （本文件） | Document system status resume completion |

## 7. Verification（local）

在合併進本修復線時已執行並通過：

- TypeScript `tsc --noEmit`：通過
- 相關單元測試：通過（最終相關套件 **57/57**，含 resume／cache／heartbeat／假綠燈決策）
- `npm run build`：通過

## 8. Production Deploy

- Production URL：https://crm.echfronthk.com
- Worker：`crm-system`
- **Deployed Version ID**：`f61fe5f7-aad2-4ff5-b685-5734c68eb16c`
- Deploy 範圍：前端 Worker 程式版本（`npm run deploy`／OpenNext Cloudflare）
- **未**執行 D1 操作、migration、schema 變更、Access 設定變更、cron deploy

## 9. Rollback Reference

- 回滾參考（本修復部署前）Version ID：`194f0f4a-7048-46a5-af91-822c6147b001`

## 10. User Acceptance（真機）

使用者確認：

- 長時間靜置或手機瀏覽器從後台恢復後，可自動重新檢查
- 不需手動刷新頁面
- 不需手動切換頁面才能恢復
- 右上角可從 checking 恢復為綠色
- 綠色後當前頁面可正常使用
- 普通 CRM 頁面切換未發現異常
- 真機測試通過

## 11. Out of Scope（未修改）

本次修復未修改：

- login／logout
- CRM Session 核心規則與資料表
- Cloudflare Access
- IdleTimeoutProvider 安全規則
- 全局免閒置超時開關與含義
- Device Authorization
- middleware
- DB／D1／schema／migration
- package.json
- API／客戶權限、公共池、審批流程
- cron 與其他 Cloudflare 部署設定（除上述前端 Worker 版本部署）

## 12. Final Conclusion

**SYSTEM-STATUS-RESUME 任務已完成。**  
程式修復、本地檢查、production 部署與使用者真機驗收均已通過，**不需要繼續調整**。

本文件僅作完成記錄；後續若僅推送 docs，不需為此重新部署 production Worker。
