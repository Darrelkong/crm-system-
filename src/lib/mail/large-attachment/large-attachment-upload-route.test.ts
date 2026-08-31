import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthError } from "@/lib/permissions/auth";
import { handlePostLargeAttachmentAuthorize } from "@/app/api/mail/drafts/[id]/large-attachments/authorize/route";
import { handlePostLargeAttachmentFinalize } from "@/app/api/mail/drafts/[id]/large-attachments/[sessionId]/finalize/route";

describe("large attachment route auth wiring", () => {
  it("maps AuthError to auth responses on authorize and finalize routes", async () => {
    const authorizeRes = await handlePostLargeAttachmentAuthorize(
      new Request("http://localhost/api/mail/drafts/d1/large-attachments/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "a.zip",
          sizeBytes: 4096,
          declaredSha256: "c".repeat(64),
          contentMd5: "1B2M2Y8AsgTpgAmY7PhCfg==",
        }),
      }),
      "d1",
      {
        requireMailActor: async () => {
          throw new AuthError(401, "Unauthorized");
        },
      },
    );
    assert.equal(authorizeRes.status, 401);

    const finalizeRes = await handlePostLargeAttachmentFinalize(
      new Request(
        "http://localhost/api/mail/drafts/d1/large-attachments/s1/finalize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedAutosaveVersion: 1 }),
        },
      ),
      "d1",
      "s1",
      {
        requireMailActor: async () => {
          throw new AuthError(401, "Unauthorized");
        },
      },
    );
    assert.equal(finalizeRes.status, 401);
  });
});
