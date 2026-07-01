import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAuditActorLabel,
  formatAuditMetadataForDisplay,
  buildAuditLogQueryParams,
  normalizeAuditDateParam,
  displayAuditField,
} from "@/lib/audit/ui-helpers";

describe("audit log UI helpers", () => {
  it("formatAuditActorLabel prefers name and email", () => {
    assert.equal(
      formatAuditActorLabel(
        { userName: "Admin", userEmail: "admin@crm.local" },
        "System",
      ),
      "Admin (admin@crm.local)",
    );
    assert.equal(
      formatAuditActorLabel({ userName: "Admin", userEmail: null }, "System"),
      "Admin",
    );
    assert.equal(
      formatAuditActorLabel({ userName: null, userEmail: "admin@crm.local" }, "System"),
      "admin@crm.local",
    );
  });

  it("formatAuditActorLabel falls back to system actor label", () => {
    assert.equal(
      formatAuditActorLabel({ userName: null, userEmail: null }, "System / Unknown"),
      "System / Unknown",
    );
    assert.equal(
      formatAuditActorLabel({ userName: "  ", userEmail: "" }, "System / Unknown"),
      "System / Unknown",
    );
  });

  it("formatAuditMetadataForDisplay pretty prints objects safely", () => {
    const formatted = formatAuditMetadataForDisplay({
      scope: "all_active",
      includeSensitive: false,
    });
    assert.equal(
      formatted,
      JSON.stringify({ scope: "all_active", includeSensitive: false }, null, 2),
    );
  });

  it("formatAuditMetadataForDisplay returns null for empty or missing metadata", () => {
    assert.equal(formatAuditMetadataForDisplay(null), null);
    assert.equal(formatAuditMetadataForDisplay({}), null);
  });

  it("displayAuditField renders em dash for empty values", () => {
    assert.equal(displayAuditField(null), "—");
    assert.equal(displayAuditField(""), "—");
    assert.equal(displayAuditField("customer.updated"), "customer.updated");
  });

  it("normalizeAuditDateParam converts datetime-local values to ISO", () => {
    assert.equal(
      normalizeAuditDateParam("2026-06-30T10:00"),
      "2026-06-30T10:00:00.000Z",
    );
    assert.equal(
      normalizeAuditDateParam("2026-06-30T10:00:00.000Z"),
      "2026-06-30T10:00:00.000Z",
    );
    assert.equal(normalizeAuditDateParam(""), "");
  });

  it("buildAuditLogQueryParams omits empty filters and includes cursor", () => {
    const params = buildAuditLogQueryParams(
      {
        action: "backup.completed",
        entityType: "",
        entityId: "",
        userId: "",
        dateFrom: "2026-06-30T10:00",
        dateTo: "",
        limit: "50",
      },
      "cursor-token",
    );
    assert.equal(params.get("action"), "backup.completed");
    assert.equal(params.get("dateFrom"), "2026-06-30T10:00:00.000Z");
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("entityType"), null);
    assert.equal(params.get("cursor"), "cursor-token");
  });
});
