import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FollowUpOrganizeValidationError,
  organizeFollowUpForUser,
} from "@/lib/ai/follow-up-organize/service";
import type { User } from "../../../../drizzle/schema/users";
import type { Database } from "@/lib/db";

const staff = {
  id: "staff-1",
  role: "staff",
  email: "staff@example.com",
  displayName: "Staff",
} as User;

describe("organizeFollowUpForUser basic path", () => {
  it("runs basic mode without touching DB/provider", async () => {
    const result = await organizeFollowUpForUser(
      {} as Database,
      staff,
      {
        mode: "basic",
        text: "  客戶說有興趣\n\n\n下一步發送資料  ",
      },
    );
    assert.equal(result.source, "basic_rules");
    assert.ok(result.organizedText.includes("客戶說有興趣"));
    assert.equal(result.organizedText.includes("\n\n\n"), false);
  });

  it("rejects empty / short / invalid mode", async () => {
    await assert.rejects(
      () =>
        organizeFollowUpForUser({} as Database, staff, {
          mode: "basic",
          text: "  ",
        }),
      (err: unknown) =>
        err instanceof FollowUpOrganizeValidationError &&
        err.code === "INPUT_EMPTY",
    );
    await assert.rejects(
      () =>
        organizeFollowUpForUser({} as Database, staff, {
          mode: "basic",
          text: "短",
        }),
      (err: unknown) =>
        err instanceof FollowUpOrganizeValidationError &&
        err.code === "INPUT_TOO_SHORT",
    );
    await assert.rejects(
      () =>
        organizeFollowUpForUser({} as Database, staff, {
          mode: "magic",
          text: "足夠長度的跟進備註文字",
        }),
      (err: unknown) =>
        err instanceof FollowUpOrganizeValidationError &&
        err.code === "INVALID_MODE",
    );
  });
});
