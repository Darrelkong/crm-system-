import { allowMockDeepInsightGeneration } from "@/lib/ai/providers/factory";
import {
  callKnowledgeVisionExtractCloudflareAi,
  KNOWLEDGE_VISION_CLOUDFLARE_AI_MODEL,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { mockKnowledgeVisionExtract } from "@/lib/knowledge/vision-extraction-mock";
import type { KnowledgeVisionExtractResult } from "@/lib/knowledge/vision-types";

function visionError(
  code: string,
  message: string,
  status = 400,
): KnowledgeServiceError {
  return new KnowledgeServiceError(code, message, status);
}

function mapVisionFailure(
  category: "timeout" | "unavailable" | "invalid_response" | "rate_limited" | "internal",
): KnowledgeServiceError {
  if (category === "timeout") {
    return visionError(
      KNOWLEDGE_ERROR_CODES.VISION_TIMEOUT,
      "图片内容读取超时",
      503,
    );
  }
  if (category === "unavailable") {
    return visionError(
      KNOWLEDGE_ERROR_CODES.VISION_UNSUPPORTED,
      "图片内容读取服务暂不可用",
      503,
    );
  }
  if (category === "invalid_response") {
    return visionError(
      KNOWLEDGE_ERROR_CODES.VISION_OUTPUT_INVALID,
      "图片内容读取结果无效",
    );
  }
  return visionError(
    KNOWLEDGE_ERROR_CODES.VISION_UNSUPPORTED,
    "图片内容读取失败",
    503,
  );
}

function validateVisionPayload(data: unknown): KnowledgeVisionExtractResult {
  if (!data || typeof data !== "object") {
    throw visionError(
      KNOWLEDGE_ERROR_CODES.VISION_OUTPUT_INVALID,
      "图片内容读取结果无效",
    );
  }
  const record = data as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const quality = record.quality;
  const warnings = Array.isArray(record.warnings) ? record.warnings : null;
  if (
    !text ||
    (quality !== "high" && quality !== "medium" && quality !== "low") ||
    !warnings
  ) {
    throw visionError(
      KNOWLEDGE_ERROR_CODES.VISION_OUTPUT_INVALID,
      "图片内容读取结果无效",
    );
  }
  return {
    text,
    quality,
    warnings: warnings
      .filter(
        (item): item is { code: KnowledgeVisionExtractResult["warnings"][number]["code"]; message: string | null } =>
          !!item &&
          typeof item === "object" &&
          typeof (item as { code?: unknown }).code === "string",
      )
      .map((item) => ({
        code: item.code,
        message:
          item.message === null
            ? null
            : typeof item.message === "string"
              ? item.message
              : null,
      })),
    model: KNOWLEDGE_VISION_CLOUDFLARE_AI_MODEL,
  };
}

export async function extractKnowledgeVisionImage(input: {
  bytes: ArrayBuffer;
  filename: string;
  mimeType: "image/jpeg" | "image/png";
  locale?: string;
  aiService?: CloudflareEnv["AI_SERVICE"];
  useMock?: boolean;
}): Promise<KnowledgeVisionExtractResult> {
  if (input.useMock || allowMockDeepInsightGeneration()) {
    return mockKnowledgeVisionExtract({
      bytes: input.bytes,
      filename: input.filename,
    });
  }

  const imageBase64 = Buffer.from(input.bytes).toString("base64");
  const result = await callKnowledgeVisionExtractCloudflareAi({
    locale: input.locale ?? "zh-Hant",
    mimeType: input.mimeType,
    imageBase64,
    byteSize: input.bytes.byteLength,
    aiService: input.aiService,
  });

  if (!result.ok) {
    throw mapVisionFailure(result.category);
  }

  const validated = validateVisionPayload(result.data);
  return {
    ...validated,
    model: result.model || KNOWLEDGE_VISION_CLOUDFLARE_AI_MODEL,
  };
}
