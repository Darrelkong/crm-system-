import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  filterApprovalHistoryRows,
  type ApprovalWorkflowRow,
} from "@/lib/mail/client/approval-workflow-management";

function row(
  id: string,
  status: ApprovalWorkflowRow["status"],
): ApprovalWorkflowRow {
  return {
    id,
    status,
    priority: "normal",
    workflowVersion: 1,
    senderLabel: "Sender",
    recipientsLabel: "recipient@example.com",
    subject: id,
    submittedAt: "2026-09-03T10:00:00.000Z",
    reviewedAt: status === "pending" ? null : "2026-09-03T10:01:00.000Z",
    submitterLabel: "Applicant",
    approverLabel: status === "pending" ? "—" : "Reviewer",
    returnReason: status === "returned" ? "Incomplete" : null,
    events: [],
  };
}

describe("Approval Center navigation performance wiring", () => {
  it("keeps pending and history datasets independent", () => {
    const source = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );
    assert.match(source, /pendingRows/);
    assert.match(source, /historyRows/);
    assert.match(source, /pendingLoading/);
    assert.match(source, /historyLoading/);
    assert.match(source, /pendingRequestRef/);
    assert.match(source, /historyRequestRef/);
  });

  it("uses one reviewed-list query and no list-level revision HTTP fanout", () => {
    const context = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );
    const loadBlock = context.match(
      /const loadApprovals = useCallback\([\s\S]*?\n  \);\n\n  useEffect/,
    )?.[0];
    assert.ok(loadBlock, "expected approval dataset loader");
    assert.match(loadBlock!, /status: dataset === "history" \? "all-reviewed" : "pending"/);
    assert.doesNotMatch(loadBlock!, /fetchOutboundRevision/);
    assert.match(
      readFileSync("src/app/api/mail/approvals/route.ts", "utf8"),
      /all-reviewed/,
    );
    assert.match(
      readFileSync("src/lib/mail/outbound-approval-service.ts", "utf8"),
      /loadApprovalRevisionSummaries/,
    );
  });

  it("caches users and deduplicates each dataset in flight", () => {
    const context = readFileSync(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
      "utf8",
    );
    assert.match(context, /usersLoadedRef/);
    assert.match(context, /usersRequestRef/);
    assert.match(context, /requestRef\.current\.inFlight/);
    assert.match(context, /force\?: boolean/);
  });

  it("switches datasets without clearing the other dataset or pending count", () => {
    const center = readFileSync(
      "src/components/mail/approval/mail-approval-center-workspace.tsx",
      "utf8",
    );
    const list = readFileSync(
      "src/components/mail/approval/mail-approval-list.tsx",
      "utf8",
    );
    assert.match(center, /pendingLoaded/);
    assert.match(center, /historyLoaded/);
    assert.match(center, /force: false/);
    assert.match(list, /mode === "history" \? historyRows : pendingRows/);
    assert.match(list, /force: true/);
    assert.match(
      readFileSync(
        "src/lib/mail/client/mail-approval-workspace-context.tsx",
        "utf8",
      ),
      /setPendingCount\(approvalsResult\.items\.length\)/,
    );
  });

  it("filters history locally without including pending rows", () => {
    const rows = [row("pending", "pending"), row("approved", "approved"), row("rejected", "returned")];
    assert.deepEqual(
      filterApprovalHistoryRows(rows, "all").map((item) => item.id),
      ["approved", "rejected"],
    );
    assert.deepEqual(
      filterApprovalHistoryRows(rows, "approved").map((item) => item.id),
      ["approved"],
    );
    assert.deepEqual(
      filterApprovalHistoryRows(rows, "rejected").map((item) => item.id),
      ["rejected"],
    );
  });
});

describe("Approval navigation cleanup wiring", () => {
  it("removes the legacy pending approval folder entry", () => {
    const adapters = readFileSync(
      "src/lib/mail/client/mail-workspace-ui-adapters.ts",
      "utf8",
    );
    const folderNav = readFileSync(
      "src/components/mail/prototype/mail-folder-nav.tsx",
      "utf8",
    );
    const popover = readFileSync(
      "src/components/mail/prototype/mail-folder-popover.tsx",
      "utf8",
    );
    assert.match(adapters, /PRODUCTION_WORKFLOW_FOLDERS: readonly/);
    assert.doesNotMatch(
      adapters.match(
        /PRODUCTION_WORKFLOW_FOLDERS[\s\S]*?export function filterVisibleWorkflowFolders/,
      )?.[0] ?? "",
      /pending_approval/,
    );
    assert.doesNotMatch(folderNav, /selectFolder\("pending_approval"\)/);
    assert.doesNotMatch(popover, /selectFolder\("pending_approval"\)/);
  });

  it("normalizes legacy approval-folder state to Inbox", () => {
    const adapters = readFileSync(
      "src/lib/mail/client/mail-workspace-ui-adapters.ts",
      "utf8",
    );
    const context = readFileSync(
      "src/lib/mail/client/mail-workspace-context.tsx",
      "utf8",
    );
    assert.match(adapters, /normalizeMailWorkspaceFolder/);
    assert.match(context, /const nextFolder = normalizeMailWorkspaceFolder\(folder\)/);
  });
});
