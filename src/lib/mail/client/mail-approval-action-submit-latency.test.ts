import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Approval detail latency wiring", () => {
  it("reuses cached Approval items and keeps revision/send requests parallel", () => {
    const source = read(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
    );
    assert.match(source, /pendingApprovalsRef\.current\.get/);
    assert.match(source, /historyApprovalsRef\.current\.get/);
    assert.match(
      source,
      /const \[revisionResult, sendResult\] = await Promise\.all/,
    );
  });

  it("renders detail before background delivery resolution", () => {
    const source = read(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
    );
    const detailBlock = source.match(
      /const detailView = buildDetailView[\s\S]*?if \(sendOperation\?\.status === "accepted"\)/,
    )?.[0];
    assert.ok(detailBlock, "expected detail construction block");
    assert.match(detailBlock!, /setDetail\(/);
    assert.doesNotMatch(detailBlock!, /await fetchSendOperationDelivery/);
    assert.match(source, /void fetchSendOperationDelivery\(sendOperation\.id\)/);
  });

  it("cannot let a stale delivery response replace a newer selected detail", () => {
    const source = read(
      "src/lib/mail/client/mail-approval-workspace-context.tsx",
    );
    assert.match(source, /requestId !== detailRequestRef\.current/);
    assert.match(source, /previous\.approval\.id === approvalId/);
  });
});

describe("Approval action latency wiring", () => {
  it("patches confirmed approve/reject results without blocking refetches", () => {
    const detail = read(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
    );
    assert.match(detail, /applyApprovalResolution\(result\.item\)/);
    assert.doesNotMatch(detail, /await loadApprovals\(\);\s*await refreshDetail\(\)/);
    assert.match(detail, /loadApprovals\(\{ dataset: "pending", force: true \}\)/);
    assert.match(detail, /actionPendingRef\.current/);
    assert.match(detail, /approval\.workflowVersion/);
  });

  it("keeps confirmed actions server-authoritative", () => {
    const detail = read(
      "src/components/mail/approval/mail-approval-detail-pane.tsx",
    );
    const approveBlock = detail.match(
      /async function handleApprove\(\)[\s\S]*?async function handleReject/,
    )?.[0];
    assert.ok(approveBlock, "expected approve handler");
    assert.match(approveBlock!, /if \(!result\.ok\)/);
    assert.match(approveBlock!, /applyApprovalResolution\(result\.item\)/);
    assert.doesNotMatch(approveBlock!, /setApproval|status:\s*"approved"/);
  });
});

describe("Staff submission latency wiring", () => {
  it("skips a redundant save only for a clean persisted draft", () => {
    const source = read("src/components/mail/compose/use-mail-compose-draft.tsx");
    const flushBlock = source.match(
      /const flushSave = useCallback\([\s\S]*?\n  \}, \[persistDraft, syncBodyFromEditor\]\);/,
    )?.[0];
    assert.ok(flushBlock, "expected flushSave block");
    assert.match(flushBlock!, /snapshot\.draftId/);
    assert.match(flushBlock!, /snapshot\.saveStatus === "saved"/);
    assert.match(flushBlock!, /persistedBodyEditGenerationRef/);
    assert.match(flushBlock!, /return persistDraft\(snapshot\)/);
  });

  it("uses list revision summaries to avoid compose approval lookup fanout", () => {
    const source = read("src/components/mail/compose/use-mail-compose-draft.tsx");
    const approvalLookup = source.match(
      /async function loadDraftApproval\([\s\S]*?const detail = await fetchApproval/,
    )?.[0];
    assert.ok(approvalLookup, "expected draft approval lookup");
    assert.match(approvalLookup!, /currentRevisionSummary/);
    assert.doesNotMatch(approvalLookup!, /fetchOutboundRevision/);
  });

  it("preserves the existing frozen revision and approval command order", () => {
    const source = read("src/components/mail/compose/use-mail-compose-draft.tsx");
    const submitBlock = source.match(
      /const handleSubmitForApproval = useCallback\([\s\S]*?\n  \}, \[approval, composeOptions/,
    )?.[0];
    assert.ok(submitBlock, "expected submit handler");
    const revisionIndex = submitBlock!.indexOf("createDraftRevision(");
    const approvalIndex = submitBlock!.indexOf("submitRevisionForApproval(");
    assert.ok(revisionIndex >= 0);
    assert.ok(approvalIndex > revisionIndex);
    assert.match(submitBlock!, /expectedAutosaveVersion/);
  });
});
