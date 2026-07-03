# CRM 設備授權功能 — 正式上線記錄

**文檔日期：** 2026-07-03  
**狀態：** production 已上線（功能已部署；feature flag 預設關閉，需 Admin 手動啟用）

---

## 1. 功能概述

**設備授權（Device Authorization）** 已正式部署至 production。啟用後，Staff 僅能在 Admin 已批准的設備上登入 CRM；新設備需經 Admin 審核。Admin 帳戶不受此限制。

本功能不修改 Cloudflare Access、WARP、固定 IP 或 mTLS 等外部存取控制，僅在 CRM 登入與 Session 層面增加設備綁定與審批流程。

---

## 2. 正式版本

| 項目 | 值 |
|------|-----|
| 最新 commit | `dcd2b07` — Allow revoked devices to request reapproval |
| 功能初版 commit | `412c743` — Add device authorization controls |
| Settings UI commit | `14923bb` — Make device authorization setting a switch |
| 正式網址 | https://crm.echfronthk.com |
| Cloudflare Version ID | `dd2e3ef5-2d0e-4226-be0e-3ba014d74c03` |
| 上線順序（初版） | remote D1 migration `0026` → deploy → push |
| 上線順序（後續 bugfix） | commit → push → deploy（無 migration） |

---

## 3. D1 Migration 0026

| 項目 | 值 |
|------|-----|
| 檔案 | `drizzle/migrations/0026_authorized_devices.sql` |
| 狀態 | **production 已正式套用** |
| 指令 | `npm run db:migrate:remote` |

**主要變更：**

- 新增 `authorized_devices` 表（設備記錄：`pending` / `approved` / `rejected` / `revoked`）
- `sessions` 表新增 `device_id_hash` 欄位
- `system_settings` 插入預設值：
  - `device_authorization_enabled` = `false`
  - `device_authorization_limit_per_user` = `2`

**安全特性：** 僅新增表與欄位，無 DROP / DELETE / TRUNCATE，未修改客戶、審批、報告等業務表。

---

## 4. `device_authorization_enabled` 使用方式

### 預設狀態

- DB 預設值為 **`false`**（關閉）
- 關閉時：Staff 登入不受設備限制，行為與上線前相同
- 開啟時：Staff 新設備需 Admin 批准；已批准設備方可登入

### 如何啟用 / 關閉

1. 以 Admin 登入 CRM
2. 前往 **系統設定**（`/admin/settings`）
3. 找到 **「设备授权（启用后限制员工登录设备）」** Switch
4. 開啟 = 儲存 `"true"`；關閉 = 儲存 `"false"`

> **建議：** 首次啟用前先於 `/admin/devices` 確認現有 Staff 設備記錄；若 Staff 已在多台設備登入，可先批准常用設備，再開啟功能，避免大量員工同時被擋在登入頁外。

### 相關設定

| Key | 預設值 | 說明 |
|-----|--------|------|
| `device_authorization_enabled` | `false` | 總開關（Switch UI） |
| `device_authorization_limit_per_user` | `2` | 每位 Staff 最多 **approved** 設備數 |

---

## 5. 員工設備授權流程

```
Staff 登入（已啟用 device_authorization_enabled）
        │
        ▼
  讀取 / 生成 crm_device cookie → 計算 deviceIdHash
        │
        ▼
  查詢 authorized_devices（userId + deviceIdHash）
        │
   ┌────┴────────────────────────────────────────────┐
   │ 無記錄                                          │
   │   → 建立 pending 記錄                           │
   │   → 若已有 2 台 approved：回傳「設備上限」      │
   │   → 否則回傳「尚未授權，請聯繫管理員」          │
   │   → 不建立 session                              │
   ├─────────────────────────────────────────────────┤
   │ status = approved                               │
   │   → 更新 lastSeen，允許登入，建立 session       │
   ├─────────────────────────────────────────────────┤
   │ status = pending                                │
   │   → 回傳「正在等待管理員審核」                  │
   │   → 不建立 session                              │
   ├─────────────────────────────────────────────────┤
   │ status = revoked / rejected                     │
   │   → 更新記錄為 pending（重新申請，見第 6 節）   │
   │   → 回傳「已重新提交授權申請，請等待審核」      │
   │   → 不建立 session                              │
   └─────────────────────────────────────────────────┘
```

### Admin 審批入口

- 路徑：**設備授權**（`/admin/devices`）
- 操作：**批准** / **拒絕** / **撤銷**
- 批准時後端再次檢查 Staff 是否已達 2 台 approved 上限；若已滿，需先撤銷其他 approved 設備

### Session 與設備綁定

- 新登入 Session 綁定 `device_id_hash`
- 已存在且 `device_id_hash` 為 null 的舊 Session：允許延續至自然過期（遷移相容）
- 設備被撤銷後，該設備上的 Staff Session 會立即失效
- 維持「同一帳戶同一時間僅一個有效 Session」策略

---

## 6. 撤銷設備後重新申請流程

**問題（已修復，`dcd2b07`）：** 早期版本 Staff 設備被撤銷後，記錄停留在 `revoked`，Admin 無法重新批准，員工永久無法登入。

**現行行為：**

1. Admin 在 `/admin/devices` 撤銷 Staff 已批准設備 → status 變 `revoked`，該設備 Session 立即失效
2. Staff 使用**同一台設備**（相同 `crm_device` cookie）再次嘗試登入
3. 系統**不建立 session**，但將同一條 `authorized_devices` 記錄更新為：
   - `status = pending`
   - `approvedBy` / `approvedAt` / `revokedAt` 清空
   - 更新 `userAgent`、`ipAddress`、`lastSeen*`、`updatedAt`
4. 寫入 audit log：`device.reapproval.requested`（metadata 含 `previousStatus`）
5. 登入頁提示：**「此設備已重新提交授權申請，請等待管理員審核。」**
6. Admin 在 `/admin/devices` 看到 **pending** 狀態，可點擊**批准**
7. 批准後 Staff 同一設備再次登入 → 成功

**rejected 設備** 再次登入時，流程與 revoked 相同（重置為 pending）。

**pending 設備** 再次登入時，維持 pending，不重複插入記錄。

---

## 7. Admin 不受設備授權限制

以下規則對 **Admin 帳戶** 始終成立：

| 場景 | 行為 |
|------|------|
| Admin 登入 | 不因 device status 被拒絕；`recordAdminDeviceOnLogin` 僅作 audit 記錄 |
| 設備記錄不存在 / pending / revoked / rejected | Admin 仍可登入 |
| `validateSessionToken` | `user.role === admin` 時跳過設備授權檢查 |
| Admin 設備被「撤銷」 | 僅更新 audit 狀態，**不撤銷 Admin Session** |
| 設備上限 | Admin 不受 2 台限制 |

Admin 設備記錄可在 `/admin/devices` 查看，但狀態不影響 Admin 登入能力。

---

## 8. 緊急回滾方式

### 方式一：關閉 feature flag（推薦，無需 deploy）

1. Admin 登入 → **系統設定** → 關閉「设备授权」Switch
2. 或直接在 D1 `system_settings` 將 `device_authorization_enabled` 設為 `false`

**效果：** 立即恢復 Staff 登入不受設備限制；已存在的 `authorized_devices` 記錄保留但不生效。

### 方式二：代碼回退（需 deploy）

若需回退至功能上線前代碼：

```bash
git revert dcd2b07   # 若只需回退 reapproval bugfix
# 或
git revert 412c743..HEAD   # 回退整個設備授權功能（需評估依賴）

git push origin main
npm run deploy
```

**Migration 回退：** 通常**不需要**。`authorized_devices` 表與 `sessions.device_id_hash` 留空不影響關閉 feature flag 後的運作。不建議在 production 執行 DROP。

---

## 9. 後續管理注意事項

1. **啟用前溝通** — 開啟 `device_authorization_enabled` 前，通知 Staff 新設備需 Admin 批准；避免上班高峰期突然啟用造成大量登入失敗。

2. **設備上限管理** — Staff 預設最多 2 台 approved 設備。若需更換設備，Admin 應先撤銷舊設備再批准新設備；或讓 Staff 用被撤銷設備重新登入觸發 pending 再批准。

3. **撤銷 vs 拒絕** — 兩者對 Staff 登入效果相同（需重新申請）；撤銷針對已批准設備，拒絕針對 pending 申請。

4. **Audit 日誌** — 設備相關操作（建立 pending、批准、拒絕、撤銷、重新申請、登入被擋）均有 audit 記錄，可在 `/admin/audit-logs` 查閱。audit 不包含原始 `deviceId`，僅存 hash。

5. **不要修改 Cloudflare Access** — 本功能與 Access 獨立；Access 仍為第一道防線，設備授權為 CRM 內部第二層。

6. **舊 Session 相容** — 功能上線前已存在的 Session（`device_id_hash` 為 null）可繼續使用至過期；新登入必須綁定設備。

7. **部署順序** — 若未來有設備授權相關 schema 變更，仍應 **先 remote migration、後 deploy**；純邏輯 bugfix（如 `dcd2b07`）無需 migration。

8. **正式站抽測建議** — 啟用 feature flag 後，建議抽測：
   - Staff 新設備 → pending → Admin 批准 → 登入成功
   - Staff 設備撤銷 → 重新登入 → pending → Admin 再批准 → 登入成功
   - Admin 任意設備狀態均可登入
   - 關閉 Switch 後 Staff 立即不受限制

---

## 10. 相關文檔

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [BACKUP_RESTORE_RUNBOOK.md](./BACKUP_RESTORE_RUNBOOK.md)
- [LOGIN_SECURITY_RELEASE_297f9b8.md](./LOGIN_SECURITY_RELEASE_297f9b8.md)

---

*本文檔記錄截至 `dcd2b07`（Version `dd2e3ef5-2d0e-4226-be0e-3ba014d74c03`）的設備授權功能 production 狀態。*
