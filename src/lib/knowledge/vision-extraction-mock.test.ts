import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE } from "@/lib/knowledge/knowledge-extraction-usability";
import { CHASE_PRIVATE_CLIENT_FIXTURE_TEXT } from "@/lib/knowledge/knowledge-evidence-grounding";
import {
  buildTestPngBytes,
  loadKnowledgeTestFixtureBytes,
} from "@/lib/knowledge/test-fixtures/source-images";
import { mockKnowledgeVisionExtract } from "@/lib/knowledge/vision-extraction-mock";

describe("mock knowledge vision fixtures", () => {
  it("does not match fixtures by filename alone", () => {
    const result = mockKnowledgeVisionExtract({
      bytes: buildTestPngBytes(),
      filename: "IMG_6838.png",
    });
    assert.equal(result.text, LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE);
    assert.doesNotMatch(result.text, /Chase Private Client/);
  });

  it("matches chase fixture bytes regardless of filename", () => {
    const bytes = loadKnowledgeTestFixtureBytes("chase-private-client-screenshot.png");
    const result = mockKnowledgeVisionExtract({
      bytes,
      filename: "random-upload.png",
    });
    assert.equal(result.text, CHASE_PRIVATE_CLIENT_FIXTURE_TEXT);
  });
});
