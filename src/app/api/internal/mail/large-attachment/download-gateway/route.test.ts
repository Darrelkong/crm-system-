import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleLargeAttachmentGatewayRpc } from "./route";
import type { LargeAttachmentGatewayAuthorizationRepository } from "@/lib/mail/large-attachment/large-attachment-download-authorization-service";

function repository(
  options?: { recorded?: boolean },
): LargeAttachmentGatewayAuthorizationRepository {
  return {
    async findByTokenHash() {
      return null;
    },
    async recordDownload() {
      return options?.recorded ?? true;
    },
  };
}

describe("large attachment internal gateway RPC", () => {
  it("is unavailable without the service-binding secret", async () => {
    const response = await handleLargeAttachmentGatewayRpc(
      new Request("https://crm-system-local/internal", {
        method: "POST",
        body: JSON.stringify({
          action: "authorize",
          tokenHash: "a".repeat(64),
          trustNowIso: "2026-09-06T08:00:00.000Z",
        }),
      }),
      {
        gatewaySecret: "local-secret",
        repository: repository(),
      },
    );

    assert.equal(response.status, 404);
  });

  it("keeps denied authorization generic and records only validated accounting", async () => {
    const authorized = await handleLargeAttachmentGatewayRpc(
      new Request("https://crm-system-local/internal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Crm-Large-Attachment-Gateway-Secret": "local-secret",
        },
        body: JSON.stringify({
          action: "authorize",
          tokenHash: "a".repeat(64),
          trustNowIso: "2026-09-06T08:00:00.000Z",
        }),
      }),
      {
        gatewaySecret: "local-secret",
        repository: repository(),
      },
    );
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { authorized: false });

    const recorded = await handleLargeAttachmentGatewayRpc(
      new Request("https://crm-system-local/internal", {
        method: "POST",
        headers: {
          "X-Crm-Large-Attachment-Gateway-Secret": "local-secret",
        },
        body: JSON.stringify({
          action: "record",
          lifecycleId: "lifecycle-1",
          tokenHash: "a".repeat(64),
          downloadedAt: "2026-09-06T08:00:00.000Z",
        }),
      }),
      {
        gatewaySecret: "local-secret",
        repository: repository({ recorded: true }),
      },
    );
    assert.equal(recorded.status, 200);
    assert.deepEqual(await recorded.json(), { recorded: true });
  });
});
