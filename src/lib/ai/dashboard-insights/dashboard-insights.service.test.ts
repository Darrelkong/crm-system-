import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateDashboardAiInsight } from "./service";
import { DashboardAiPermissionError } from "./errors";

const staff = {
  id: "11111111-1111-1111-1111-111111111102",
  role: "staff",
} as const;

const admin = {
  id: "11111111-1111-1111-1111-111111111101",
  role: "admin",
} as const;

describe("generateDashboardAiInsight permissions", () => {
  it("rejects staff admin insight requests before DB access", async () => {
    await assert.rejects(
      () =>
        generateDashboardAiInsight(
          {
            viewer: staff as never,
            insightType: "admin_management_brief",
            locale: "en",
          },
          {} as never,
        ),
      DashboardAiPermissionError,
    );
  });

  it("rejects admin staff insight requests before DB access", async () => {
    await assert.rejects(
      () =>
        generateDashboardAiInsight(
          {
            viewer: admin as never,
            insightType: "staff_today_actions",
            locale: "en",
          },
          {} as never,
        ),
      DashboardAiPermissionError,
    );
  });
});
