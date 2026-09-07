import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET } from "./route";

describe("local large attachment recipient preview", () => {
  it("is disabled in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previousNodeEnv = env.NODE_ENV;
    const previousFlag = env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED;
    env.NODE_ENV = "production";
    env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED = "true";
    try {
      const response = await GET();
      assert.equal(response.status, 404);
    } finally {
      if (previousNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) {
        delete env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED;
      } else {
        env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED = previousFlag;
      }
    }
  });

  it("renders synthetic HTML and warning content only when explicitly enabled", async () => {
    const env = process.env as Record<string, string | undefined>;
    const previousNodeEnv = env.NODE_ENV;
    const previousFlag = env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED;
    env.NODE_ENV = "development";
    env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED = "true";
    try {
      const response = await GET();
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /IMG_5940\.mov/);
      assert.match(html, /not automatically scanned/i);
      assert.match(html, /繼續下載/);
      assert.match(html, /local-preview-token/);
    } finally {
      if (previousNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) {
        delete env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED;
      } else {
        env.MAIL_LARGE_ATTACHMENT_LOCAL_PREVIEW_ENABLED = previousFlag;
      }
    }
  });
});
