# PUBLIC-POOL-3B 系列完成記錄

**Phase：** PUBLIC-POOL-3B 系列（manual/claim assignee sync · auto reclaim assignee clear · historical backfill）  
**建立：** 2026-07-10  
**正式網址：** https://crm.echfronthk.com  
**相關：** [DEPLOY_RUNBOOK.md](./DEPLOY_RUNBOOK.md) · [BACKUP_RESTORE_RUNBOOK.md](./BACKUP_RESTORE_RUNBOOK.md) · [STABLE_RELEASE_CHECKPOINT.md](./STABLE_RELEASE_CHECKPOINT.md)

---

## 1. 完成範圍

| 子階段 | 說明 | 狀態 |
|--------|------|------|
| **PUBLIC-POOL-3B** | manual release / claim assignee 同步 | ✅ 已部署 |
| **PUBLIC-POOL-3B-2** | auto reclaim 入池同步清除 `customer_assignees` | ✅ 已部署（主 app + cron） |
| **PUBLIC-POOL-3B-BACKFILL** | production 歷史 assignee 資料修復 | ✅ 已 execute + verify |
| **Production UI smoke** | 人工確認 | ✅ 沒問題 |

---

## 2. Commit / Deploy 記錄

### PUBLIC-POOL-3B — manual release / claim assignee sync

| 項目 | 值 |
|------|-----|
| Commit | `eabec3f` |
| Commit message | Sync assignees on public pool release and claim |
| 主 app Version ID | `16cdda9a-84cc-4a9d-b245-c76abbbba423` |

**行為：**

- manual release 入池：batch 清除該客戶全部 `customer_assignees`
- manual claim 成功：以 claimant 替換為唯一 primary assignee；sync 失敗時 rollback

### PUBLIC-POOL-3B-2 — auto reclaim assignee clear

| 項目 | 值 |
|------|-----|
| Commit | `ddd0847` |
| Commit message | Clear assignees when auto-reclaiming customers |
| 主 app Version ID | `df8090bc-28f4-4d7e-a7fd-d6e86f53b167` |
| Cron worker | `crm-system-reclamation-cron` |
| Cron worker Version ID | `5ff28efe-c90e-4b76-b622-9141d79897f3` |
| Cron schedule | `0 21 * * *`（**未變更**） |

**行為：**

- auto reclaim 入池：atomic `UPDATE customers` + `DELETE customer_assignees`
- audit metadata 含 `clearedAssigneeCount`
- 主 app（Admin 手動 reclamation）與 cron worker **皆需 deploy** 才生效

---

## 3. 最終行為

### 客戶進公共池時

| 路徑 | assignee 處理 |
|------|---------------|
| manual release | 清除全部 `customer_assignees` |
| auto reclaim | 清除全部 `customer_assignees` |

**列表與權限（Phase 1 + 2C，未因 3B 改動）：**

- Staff「我的客戶」列表（`/customers`）**不顯示** `public_pool` 客戶
- Staff **不能**進入 public_pool detail / timeline（403）

### Staff claim 公共池客戶時

| 欄位 / 表 | 結果 |
|-----------|------|
| `customers.status` | `active` |
| `customers.ownerId` | claimant |
| `customer_assignees` | 僅保留 claimant **一筆** `primary` |
| 舊 primary / collaborator | **不保留** |

---

## 4. Backfill 結果

### 流程

1. **DESIGN-ONLY** — 只讀設計，scope 限兩類歷史問題  
2. **DRY-RUN** — production D1 SELECT，0 rows written  
3. **SAFETY-REVIEW** — Go，需人工授權 + D1 export 備份  
4. **EXECUTE** — 僅 DML `customer_assignees`（1 DELETE + 28 INSERT）  
5. **VERIFY** — production D1 SELECT，invariant 全過  

### Execute 前

| 項目 | 值 |
|------|-----|
| production D1 備份 | ✅ 已完成 |
| 備份檔 | `backups/pre-3b-backfill-20260710-0040.sql` |
| 備份大小 | 897 KB |
| dry-run 結果 | public_pool assignee 殘留 **1** 客戶；active missing primary **28**；STOP gate **全 0** |

### Execute 結果

| 項目 | 結果 |
|------|------|
| Step 1 public_pool assignee 殘留 | 1 → **0** |
| Step 2 active missing primary | 28 → **0** |
| `customers` 表 | **未修改** |
| deploy / commit / push（execute 階段） | **無** |
| git status（execute 階段） | clean |

**備註：** wrangler 回報 `rows_written: 141`、`meta.changes: 30`；邏輯 DML 為 delete 1 + insert 28 = 29。`rows_written` 為 D1 儲存層計數（含 index 寫入），以 verify SELECT invariant 為準；`assigned_by IS NULL AND created_at = '2026-07-09 16:43:10'` 的 primary rows = **28**，與預期一致。

### Verify 結果

| 指標 | 結果 |
|------|------|
| public_pool customers with assignees | **0** |
| public_pool assignee rows | **0** |
| active missing primary | **0** |
| primary owner mismatch | **0** |
| active multi primary | **0** |
| ownerId=null with assignee | **0** |
| owner-as-collaborator-only | **0** |
| rollback | **不需要** |
| app deploy | **不需要** |
| cron deploy | **不需要** |
| Production UI smoke | **人工確認沒問題** |

### 原 public_pool 歷史殘留客戶（dry-run 樣本）

| 欄位 | verify 後值 |
|------|-------------|
| customerId | `1bc57f9d-9692-4006-9284-bf996d44003b` |
| status | `public_pool` |
| ownerId | `null` |
| assignee rows | **0** |
| previousOwnerId / releasedBy / poolEnteredAt | 與 execute 前一致，未改動 |

---

## 5. 風險與結論

1. 本次 3B 系列**未新增 migration**。
2. **未修改 DB schema**。
3. Backfill **只修改** `customer_assignees`，**不修改** `customers` 表。
4. Backfill **不接觸** `customerName` / `phone` / `email` / `notes` 等敏感欄位。
5. public_pool 權限防護仍依賴 **Phase 1 + 2C**。
6. **3A** 自釋放 7 天禁領不受影響。
7. **2A** public pool list API 脫敏不受影響。
8. **2B** public pool list UI 不受影響。
9. **2C** Staff public_pool detail / timeline 403 不受影響。
10. **PUBLIC-POOL-3B 系列可以標記完成。**

---

## 6. 完成狀態

**Status:** Completed  
**Completed at:** 2026-07-10 00:49 UTC+8  
**Rollback required:** No  
**Follow-up required:** No, unless future assignee/admin assignment features are added
