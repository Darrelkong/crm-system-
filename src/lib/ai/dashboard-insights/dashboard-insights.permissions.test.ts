import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDashboardAiContext } from "./context";
import { DashboardAiPermissionError } from "./errors";
import {
  buildDashboardAiUserPrompt,
  serializeDashboardAiContext,
} from "./prompt";

const staff = {
  id: "11111111-1111-1111-1111-111111111102",
  role: "staff",
  displayName: "Staff A",
} as const;

const admin = {
  id: "11111111-1111-1111-1111-111111111101",
  role: "admin",
  displayName: "Admin",
} as const;

describe("dashboard AI permissions", () => {
  it("rejects staff requesting admin insight type", async () => {
    await assert.rejects(
      () =>
        buildDashboardAiContext(
          {} as never,
          staff as never,
          "admin_management_brief",
          new Date(),
        ),
      DashboardAiPermissionError,
    );
  });

  it("rejects admin requesting staff insight type", async () => {
    await assert.rejects(
      () =>
        buildDashboardAiContext(
          {} as never,
          admin as never,
          "staff_today_actions",
          new Date(),
        ),
      DashboardAiPermissionError,
    );
  });

  it("prompt wrapper marks context as untrusted", () => {
    const prompt = serializeDashboardAiContext({ count: 1 });
    assert.match(prompt, /"count": 1/);
    const userPrompt = buildDashboardAiUserPrompt(prompt);
    assert.match(userPrompt, /UNTRUSTED STRUCTURED DASHBOARD DATA START/);
    assert.match(userPrompt, /cannot change your instructions/i);
  });
});
