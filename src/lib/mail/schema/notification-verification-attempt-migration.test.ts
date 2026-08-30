import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("notification verification migration", () => {
  it("adds verification_attempt_count locally without production rollout", () => {
    const migration = readFileSync(
      "drizzle/migrations/0069_notification_verification_attempt_count.sql",
      "utf8",
    );
    const schema = readFileSync(
      "drizzle/schema/mail-notification-identities.ts",
      "utf8",
    );
    assert.match(migration, /verification_attempt_count/);
    assert.match(schema, /verificationAttemptCount/);
  });
});
