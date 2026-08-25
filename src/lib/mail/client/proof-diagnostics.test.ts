import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { canViewProofDiagnostics } from "@/lib/mail/client/proof-diagnostics";

describe("canViewProofDiagnostics", () => {
  it("hides proof diagnostics when capability is false", () => {
    assert.equal(canViewProofDiagnostics({ proofDiagnostics: false }), false);
  });

  it("shows proof diagnostics when capability is true", () => {
    assert.equal(canViewProofDiagnostics({ proofDiagnostics: true }), true);
  });
});

describe("proof diagnostics UI wiring", () => {
  it("renders proof list table and mobile cards", () => {
    const source = readFileSync(
      "src/components/mail/admin/proof-diagnostics.tsx",
      "utf8",
    );
    assert.match(source, /TableShell/);
    assert.match(source, /ProofRunMobileCard/);
    assert.match(source, /sourceEntityId/);
    assert.match(source, /fetchNotificationProofRuns/);
  });

  it("does not render sensitive field labels in proof diagnostics UI", () => {
    const source = readFileSync(
      "src/components/mail/admin/proof-diagnostics.tsx",
      "utf8",
    );
    assert.doesNotMatch(source, /recipientUserId/);
    assert.doesNotMatch(source, /verificationToken/);
    assert.doesNotMatch(source, /errorMessage/);
  });
});
