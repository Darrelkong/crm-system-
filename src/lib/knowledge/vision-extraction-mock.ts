import { createHash } from "node:crypto";
import { LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE } from "@/lib/knowledge/knowledge-extraction-usability";
import { resolveMockVisionFixtureBySha256 } from "@/lib/knowledge/vision-extraction-mock-fixtures";
import type { KnowledgeVisionExtractResult } from "@/lib/knowledge/vision-types";

const MOCK_VISION_MODEL = "mock-knowledge-vision-v1";

export function mockKnowledgeVisionExtract(input: {
  bytes: ArrayBuffer;
  filename: string;
}): KnowledgeVisionExtractResult {
  const hash = createHash("sha256").update(Buffer.from(input.bytes)).digest("hex");
  const fixture = resolveMockVisionFixtureBySha256(hash);
  if (fixture) {
    return fixture;
  }

  return {
    text: LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE,
    quality: "low",
    warnings: [
      {
        code: "UNREADABLE_TEXT",
        message: LOCAL_PREVIEW_MOCK_NO_VISION_MESSAGE,
      },
    ],
    model: MOCK_VISION_MODEL,
  };
}

export function isMockKnowledgeVisionModel(model: string | null | undefined): boolean {
  return model === MOCK_VISION_MODEL;
}
