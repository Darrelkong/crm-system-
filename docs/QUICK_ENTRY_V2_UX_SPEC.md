# Quick Entry V2 — UX Specification

**Status:** Prototype only（`docs/prototypes/quick-entry-v2.html`）
**Date:** 2026-07-23
**Scope:** Design / interaction / responsive — **no** Runtime API、D1、Migration、Grant、Idempotency changes in this phase.

---

## 1. 現況問題

現有 `StaffQuickEntryPanel` 以 **居中 Modal** 承載：錄入碼驗證 → 多行表單（最多 20 行）→ 結果。

主要 UX 問題：

| 問題 | 影響 |
|------|------|
| 批量時每位客戶全部展開 | 滾動極長，Footer 操作難找，30 秒內完不成「一位客戶」 |
| 結果頁仍顯示完整禁用表單 | 審視成本高；修改需「建立新一批」但視覺上像還能再編再交 |
| 國家區號佔半欄唯讀 Input | 浪費空間；電話不是一體式輸入 |
| 驗證／表單／結果擠在同一 Dialog | 心智負擔高，狀態 Banner 與操作競爭 |
| Mobile 仍是居中 Modal | 不像 Sheet／Drawer，觸控與鍵盤不便 |
| 已知錯誤偶發落入通用文案 | 已部分修復；V2 需把錯誤綁定到欄位 |
| 入口卡片疊在公共池資訊密度之上 | 二次層級，缺少「打開即可錄」的連續感 |

產品目標對照：「**30 秒完成一位客戶，幾乎不需培訓**」— 現況更偏「一次批次管理工具」，不是「連續單筆流水線」。

---

## 2. 設計目標

1. **預設單筆**：打開 Drawer 即可填寫，無多餘「開始」頁。
2. **30 秒路徑**：姓名 → 需求 → 電話或微信 → 首次跟進 → 完成／繼續。
3. **錯誤可修正**：欄位級文案；不把驗證錯誤顯示成系統故障。
4. **批量不犧牲單筆**：批量用折疊卡片，預設只展開一張。
5. **與 CRM 一致**：延續 `--color-crm-*`、圓角、Geist／系統字體、專業內勤密度。
6. **Light／Dark、Desktop／Tablet／Mobile** 皆可用。
7. **後端能力不變**：submissionId／clientRowId／Grant／Partial Success 語意保持；UI 只改變呈現與流程。

---

## 3. 使用者場景

| 角色 | 場景 | 期望 |
|------|------|------|
| Staff | 電話裡邊聽邊錄一位新客戶 | 單筆 Drawer；錄入並繼續；保留需求業務 |
| Staff | 一次帶 5–8 位紙本名單 | 批量折疊；錯誤卡片自動展開 |
| Staff／Admin | 提交後看到重複電話 | 清楚原因；返回修改；**新批次**再交 |
| Staff | 手機在外出時補錄 | Full-screen Sheet；單欄；44px 觸控 |

---

## 4. 單筆錄入流程

```
公共池 → 點「快速錄入」→ Drawer（預設「單筆錄入」）
  → 填寫 → 「完成錄入」→ 成功結果頁
       ↘ 「錄入並繼續」→ Toast／短暫成功 → 清空（可保留需求）→ Focus 姓名
  → Esc／取消 →（有內容則確認）→ 關閉
```

驗證失敗：欄位下方錯誤 + Focus 第一個問題欄位；不關 Drawer。

### 保留需求業務

- 控件：低干擾 Checkbox，放在 Footer 上方或需求業務區下方。
- **預設：開啟**。理由：同一時段員工常連續錄入相同業務線客戶；減少重複搜尋／輸入，符合「30 秒／位」目標。使用者可隨時關閉。
- 「錄入並繼續」時：若勾選則保留需求業務；其餘欄位清空並 Focus 姓名。

---

## 5. 批量錄入流程

```
切換「批量錄入」→ 折疊卡片列表（預設展開 #1）
  → 添加客戶（最多 20）→ 填寫
  → Client 驗證通過 → 「提交 X 位」
  → 獨立批量結果頁（摘要 + 列表）
  → 「建立新一批」→ 新表單（正式實作須新 submissionId）
```

Client 驗證失敗：阻止提交；「有 X 位需要修改」；展開第一張錯誤卡。

---

## 6. 成功流程

- Drawer Body 切換為**結果頁**（不保留完整原表單）。
- 顯示：成功圖示、客戶編號、姓名、需求、公共池狀態、來源。
- 主行動：**繼續錄入下一位**。
- 次行動：查看公共池、關閉。
- 可有輕量 Toast，但結果頁為權威呈現。

---

## 7. 重複／無效／失敗流程

| 結果 | 標題示例 | 操作 |
|------|----------|------|
| Duplicate | 未建立客戶／發現重複 | 返回修改、建立新一批、關閉 |
| Invalid | 資料需要修改 | 返回修改、關閉 |
| Failed／Unknown | 系統暫時無法完成 | 返回修改、稍後重試、關閉 |

**返回修改**：保留內容、Focus 問題欄位；**不得**暗示可對已完成 `submissionId` 直接重試修改後的內容。

正式規則（不變）：

> 已 Completed 的 submission **不可**用同一 submissionId 改 payload 重交；修改後須 **新 batch／新 submissionId／新 clientRowId**。

---

## 8. 欄位與驗證規則（與現有後端對齊）

| 欄位 | 規則 |
|------|------|
| 客戶姓名 | 必填；中文 ≥2 字／英文 ≥4 字母（Server 權威） |
| 需求業務 | 必填；實質內容 ≥4 字 |
| 電話 | 可空；若填須 `^1\d{10}$` |
| 國家區號 | 固定 `+86`，不可改 |
| 微信 | 可空；電話與微信至少一項 |
| 首次跟進 | 選填 |
| 補充備註 | 選填；UI 預設收起 |

**需求業務 UI**：可搜尋建議＋「其他」自定義。原型不改資料結構；正式是否配置字典 **待後續確認**（本階段不新增 Backend）。

---

## 9. 鍵盤操作

| 快捷鍵 | 行為 |
|--------|------|
| Tab／Shift+Tab | 焦點移動 |
| Ctrl／⌘ + Enter | 提交（單筆完成／批量提交）；**Textarea 內不誤交**（需修飾鍵） |
| Enter in Textarea | 換行 |
| Esc | 關閉；有未保存內容先確認 |

需 Visible Focus Ring；錯誤與欄位 `aria-describedby` 關聯。

---

## 10. Desktop／Tablet／Mobile

| | Desktop | Tablet | Mobile |
|--|---------|--------|--------|
| 容器 | 右 Drawer ~560px | ~75vw | 100% Full Sheet |
| 表單 | 姓名｜需求；電話｜微信 | 混合 | 單欄 |
| 最近錄入 | 單筆表單下方可折疊 | 同左 | 優先放結果頁 |
| 觸控 | — | — | ≥44px |

---

## 11. Light／Dark

沿用 CRM Token：

- Light：`#F5F7FA` 底、`#FFFFFF` 卡、`#172033` 字、`#2F6FB3` 主色、`#E3E8F0` 邊。
- Dark：`#080B12`／`#121826`、文字 `#F4F7FB`、主色可偏紫 `#6D60C8`（與現有 dark token 一致）。
- 狀態不僅靠顏色：Badge 文案 + icon。

---

## 12. 狀態機（單筆簡化）

```
closed → open(single|batch)
open → validating → submitting
submitting → success | duplicate | invalid | unknown_error
success → open(single, cleared) | closed
duplicate|invalid → editing (same draft) → submitting (正式：新 submissionId)
```

批量另有：`batch_editing` → `batch_submitting` → `batch_results` → `new_batch`。

---

## 13. 現有後端能力保持不變

| 能力 | V2 UI 如何對應 |
|------|----------------|
| Grant／Verify | Drawer 內可先 Verify；本原型以模擬「已授權」為主路徑 |
| `POST .../customers` | 單筆 = `rows: [1]`；批量 = 多行 |
| Partial Success | 批量結果頁映射 created／duplicate／invalid／failed |
| Idempotency | 重試同 submission；修改資料 → 新 batch |
| Atomic Customer+Audit+Row | 不改 |
| +86／電話 Regex | UI 一體式前綴 + Client 預檢；Server 權威 |

---

## 14. submissionId／clientRowId（正式開發）

- 打開新表單／新一批：新 `submissionId`。
- 每行穩定 `clientRowId`（非 array index）。
- Timeout／409 Processing／網路錯誤：保留同一 `submissionId`。
- Completed 後改欄位：必須新 batch。
- 不寫 localStorage／URL。

---

## 15. 可重用現有元件

| 元件 | 路徑 |
|------|------|
| Button | `@/components/ui/button` |
| Input／Label／Textarea | `@/components/ui/form` |
| Badge | `@/components/ui/card` |
| Modal（過渡期） | `@/components/ui/modal` |
| Drawer | **需新增**（可參考 `MobileNavDrawer` 模式） |
| Tabs | 可用 `.tab-pill` CSS 或新增輕量 Segmented |

Theme：`globals.css` 的 `--color-crm-*`、`--radius-crm*`。

---

## 16. 建議正式開發 Phase（約 3 個）

### Phase A — Drawer 架構 + 單筆錄入

**改：** 公共池入口改開右側 Drawer；單筆表單（一體式 +86 電話、需求建議、補充備註折疊）；欄位級錯誤；固定 Footer（取消／錄入並繼續／完成錄入）。
**不改：** API、Grant、Batch Domain、Schema、批量 UI。
**測試：** Drawer 開關、單筆 Client 驗證、Request Body 仍僅 `submissionId+rows`、無 storage。
**風險：** 低–中（純 UI 殼）。

### Phase B — 結果頁 + 連續錄入 + 鍵盤

**改：** 成功／重複／無效獨立結果頁；錄入並繼續清空策略；保留需求業務選項；⌘／Ctrl+Enter；Esc 確認；今日計數展示（可本地或輕量 API 後續）。
**不改：** Idempotency 語意（明確新 batch）；Random Claim。
**測試：** 結果映射文案、新 batch ID、鍵盤不誤觸 Textarea。
**風險：** 中（狀態機與 replay 文案）。

### Phase C — 批量折疊 + 響應式完善

**改：** Accordion 批量、批量結果頁、Tablet／Mobile Sheet、Dark 走查、a11y。
**不改：** 20 行上限、Server validation、CSV／Excel。
**測試：** 多行 Partial、錯誤卡展開、Mobile Sheet。
**風險：** 中（複雜度在 UI 狀態）。

各 Phase 內含單元／UI 測試與獨立 Commit；Deploy 另開任務。

---

## 17. 本原型明確不包含

- Excel／CSV／剪貼板表格／OCR／AI
- 自動清理電話
- 新增 Backend 項目字典
- 修改 4 字業務規則或 Schema
- 真實 API／登入／客戶資料
- Production 操作

---

## 18. 原型預覽

- 檔案：`docs/prototypes/quick-entry-v2.html`
- 本地：`python3 -m http.server 4173 --directory docs/prototypes`
- 開啟：`http://localhost:4173/quick-entry-v2.html`
- 或直接雙擊 HTML（無外部依賴）

左下角「原型控制」可切換視窗尺寸、主題與狀態。
