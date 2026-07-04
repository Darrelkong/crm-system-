import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatUserSummaryForViewer } from "./display";

const adminUser = {
  id: "admin-id-1",
  role: "admin" as const,
  displayName: "System Admin",
  email: "admin@crm.local",
};

const staffUser = {
  id: "staff-id-1",
  role: "staff" as const,
  displayName: "Staff A",
  email: "staff-a@crm.local",
};

const staffViewer = { role: "staff" as const };
const adminViewer = { role: "admin" as const };

describe("formatUserSummaryForViewer", () => {
  it("staff viewer looking at admin subject: email is null", () => {
    const result = formatUserSummaryForViewer(staffViewer, adminUser);
    assert.equal(result.email, null);
    assert.equal(result.name, "System Admin");
    assert.equal(result.id, "admin-id-1");
  });

  it("admin viewer looking at admin subject: email is preserved", () => {
    const result = formatUserSummaryForViewer(adminViewer, adminUser);
    assert.equal(result.email, "admin@crm.local");
    assert.equal(result.name, "System Admin");
  });

  it("staff viewer looking at staff subject: email is preserved", () => {
    const result = formatUserSummaryForViewer(staffViewer, staffUser);
    assert.equal(result.email, "staff-a@crm.local");
    assert.equal(result.name, "Staff A");
  });

  it("admin viewer looking at staff subject: email is preserved", () => {
    const result = formatUserSummaryForViewer(adminViewer, staffUser);
    assert.equal(result.email, "staff-a@crm.local");
  });

  it("staff viewer + admin subject with empty displayName falls back to 管理員", () => {
    const blankAdmin = { ...adminUser, displayName: "   " };
    const result = formatUserSummaryForViewer(staffViewer, blankAdmin);
    assert.equal(result.email, null);
    assert.equal(result.name, "管理員");
  });

  it("admin viewer + admin subject with empty displayName falls back to 管理員", () => {
    const blankAdmin = { ...adminUser, displayName: "" };
    const result = formatUserSummaryForViewer(adminViewer, blankAdmin);
    assert.equal(result.email, "admin@crm.local");
    assert.equal(result.name, "管理員");
  });

  it("masking only applies when viewer is staff AND subject is admin", () => {
    const result1 = formatUserSummaryForViewer(adminViewer, adminUser);
    assert.notEqual(result1.email, null);

    const result2 = formatUserSummaryForViewer(staffViewer, staffUser);
    assert.notEqual(result2.email, null);
  });
});
