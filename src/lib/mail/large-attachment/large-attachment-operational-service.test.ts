import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const root = process.cwd();

test("uncertain-send operations are Admin-only and never expose bearer material", () => {
  const service = read(
    `${root}/src/lib/mail/large-attachment/large-attachment-operational-service.ts`,
  );
  const route = read(
    `${root}/src/app/api/mail/send-operations/[id]/operational/route.ts`,
  );
  const outbox = read(
    `${root}/src/components/mail/prototype/mail-outbox-list.tsx`,
  );

  assert.match(service, /assertMailDeliveryHealth/);
  assert.match(service, /sendDispatchUncertainAcknowledged/);
  assert.match(service, /largeAttachmentCapabilityRevoked/);
  assert.doesNotMatch(service, /\brawToken\b|\btokenHash\b|\bstorageKey\b/);
  assert.match(route, /revoke_large_attachment_capabilities/);
  assert.match(route, /acknowledge/);
  assert.doesNotMatch(route, /retrySendOperation|resend/i);
  assert.match(outbox, /manualConfirmation/);
  assert.match(outbox, /revokeOperationalLargeAttachmentCapabilities/);
  assert.doesNotMatch(outbox, /retrySendOperation|resend/i);
});
