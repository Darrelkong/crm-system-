import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { shouldPollAdminDirectSend } from "@/lib/mail/client/compose-submission";
import type { SendOperationApiItem } from "@/lib/mail/client/approved-outbound-queue";

function send(
  status: SendOperationApiItem["status"],
): Pick<SendOperationApiItem, "authorizationMode" | "status"> {
  return { authorizationMode: "admin_direct", status };
}

describe("Admin Direct send polling policy", () => {
  it("polls only pending and processing Admin Direct operations", () => {
    assert.equal(shouldPollAdminDirectSend(send("pending")), true);
    assert.equal(shouldPollAdminDirectSend(send("processing")), true);
    assert.equal(shouldPollAdminDirectSend(send("accepted")), false);
    assert.equal(shouldPollAdminDirectSend(send("failed")), false);
    assert.equal(shouldPollAdminDirectSend(send("dispatch_uncertain")), false);
    assert.equal(
      shouldPollAdminDirectSend({
        authorizationMode: "staff_approved",
        status: "processing",
      }),
      false,
    );
  });

  it("keeps the Admin Direct polling lifecycle bounded and non-sending", () => {
    const source = readFileSync(
      "src/components/mail/compose/use-mail-compose-draft.tsx",
      "utf8",
    );
    assert.match(source, /fetchSendOperation\(operation\.id\)/);
    assert.match(source, /setInterval\(refreshSendOperation, 5_000\)/);
    assert.match(source, /document\.visibilityState !== "visible"/);
    assert.match(source, /addEventListener\("focus"/);
    assert.match(source, /clearInterval\(interval\)/);
    assert.doesNotMatch(source, /initiateAdminDirectSend\([\s\S]*refreshSendOperation/);
  });

  it("preserves the business sender allowlist and notification binding", () => {
    const config = readFileSync("wrangler.mail-jobs-cron.jsonc", "utf8");
    assert.match(config, /daniel\.hayes@echfronthk\.com/);
    assert.match(config, /rowan\.lei@echfronthk\.com/);
    assert.match(config, /darrellkoo@echfronthk\.com/);
    assert.match(config, /notifications@send\.echfronthk\.com/);
    assert.match(config, /MAIL_NOTIFICATION_TRANSPORT_ENABLED": "true"/);
  });
});
