import type { Database } from "@/lib/db";
import { allowMockDeepInsightGeneration } from "@/lib/ai/providers/factory";
import { getEffectiveAiSettings } from "@/lib/settings/ai-effective";
import {
  KNOWLEDGE_ARTICLE_CONTENT_LOCALE,
  KNOWLEDGE_ERROR_CODES,
} from "@/lib/knowledge/constants";
import {
  buildKnowledgeOrganizerSystemPrompt,
  buildKnowledgeOrganizerUserPrompt,
} from "@/lib/knowledge/ai-organizer-prompt";
import {
  parseKnowledgeAiOrganizationOutput,
  type KnowledgeAiOrganizationOutput,
} from "@/lib/knowledge/ai-organizer-schema";
import {
  callKnowledgeOrganizationProvider,
  KnowledgeAiProviderOutputError,
} from "@/lib/knowledge/ai-organizer-provider";
import {
  assessOrganizerOutputCompleteness,
  validateOrganizerEvidenceGrounding,
} from "@/lib/knowledge/knowledge-evidence-grounding";
import { validateOrganizerFactFidelity } from "@/lib/knowledge/knowledge-organizer-fact-fidelity";
import {
  applyBusinessIdentityToOrganizerOutput,
  serializeKnowledgePasteBusinessIdentityJson,
} from "@/lib/knowledge/knowledge-paste-business-identity";
import { buildMockKnowledgeOrganizationOutput } from "@/lib/knowledge/knowledge-mock-organizer";
import { finalizeKnowledgeOrganizerArticleOutput } from "@/lib/knowledge/knowledge-organizer-article-quality";
import {
  KNOWLEDGE_CLOUDFLARE_AI_MODEL,
  KNOWLEDGE_CLOUDFLARE_AI_PROVIDER,
} from "@/lib/knowledge/cloudflare-knowledge-ai";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";

function organizerError(code: string, message: string, status = 400) {
  return new KnowledgeServiceError(code, message, status);
}

export type KnowledgeOrganizationExecutionResult = {
  output: KnowledgeAiOrganizationOutput;
  provider: string;
  model: string;
  businessIdentityJson: string;
};

export async function executeKnowledgeOrganizationOnEvidence(
  input: {
    sourceTitle: string | null;
    sourceType: string;
    evidenceText: string;
  },
  db: Database,
): Promise<KnowledgeOrganizationExecutionResult> {
  let provider = "unknown";
  let model = "unknown";
  let output: KnowledgeAiOrganizationOutput;
  if (allowMockDeepInsightGeneration()) {
    provider = "mock";
    model = "mock-knowledge-organizer-v1";
    output = buildMockKnowledgeOrganizationOutput({
      sourceTitle: input.sourceTitle,
      rawText: input.evidenceText,
    });
  } else {
    await getEffectiveAiSettings(db);
    provider = KNOWLEDGE_CLOUDFLARE_AI_PROVIDER;
    model = KNOWLEDGE_CLOUDFLARE_AI_MODEL;
    const rawOutput = await callKnowledgeOrganizationProvider({
      locale: KNOWLEDGE_ARTICLE_CONTENT_LOCALE,
      systemPrompt: buildKnowledgeOrganizerSystemPrompt(
        KNOWLEDGE_ARTICLE_CONTENT_LOCALE,
      ),
      userPrompt: buildKnowledgeOrganizerUserPrompt({
        sourceTitle: input.sourceTitle,
        sourceType: input.sourceType,
        text: input.evidenceText,
      }),
    });
    const parsed = parseKnowledgeAiOrganizationOutput(rawOutput);
    if (!parsed.success) {
      throw organizerError(
        KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID,
        "AI 整理结果格式无效",
      );
    }
    output = parsed.data;
    const grounding = validateOrganizerEvidenceGrounding(
      input.evidenceText,
      output,
    );
    if (!grounding.ok) {
      throw organizerError(
        KNOWLEDGE_ERROR_CODES.ORGANIZATION_UNGROUNDED,
        "AI 整理结果包含来源中不存在的事实，需要人工确认",
      );
    }
    const factFidelity = validateOrganizerFactFidelity(
      input.evidenceText,
      output,
    );
    if (!factFidelity.ok) {
      throw organizerError(
        KNOWLEDGE_ERROR_CODES.ORGANIZATION_UNGROUNDED,
        "AI 整理结果包含来源未支持的具体要求，需要人工确认",
      );
    }
    const completeness = assessOrganizerOutputCompleteness(
      input.evidenceText,
      output,
    );
    if (completeness.requiresHumanReview) {
      const specificWarnings = [
        ...(completeness.humanReviewWarning &&
        !completeness.missingCriticalAnchors.length &&
        !completeness.missingGeneralAnchors.length
          ? [completeness.humanReviewWarning]
          : []),
        ...completeness.missingCriticalAnchors.map(
          (anchor) => `缺少重要事实：${anchor}`,
        ),
        ...completeness.missingGeneralAnchors.map(
          (anchor) => `缺少说明内容：${anchor.slice(0, 80)}`,
        ),
      ];
      output = {
        ...output,
        warnings: [...specificWarnings, ...output.warnings],
      };
    }
  }

  const identityApplied = applyBusinessIdentityToOrganizerOutput(
    input.evidenceText,
    output,
  );
  output = finalizeKnowledgeOrganizerArticleOutput(identityApplied.output, {
    sourceEvidence: input.evidenceText,
  });

  return {
    output,
    provider,
    model,
    businessIdentityJson: serializeKnowledgePasteBusinessIdentityJson(
      identityApplied.identity,
    ),
  };
}

export function organizationFailureCodeFor(error: unknown): string {
  if (error instanceof KnowledgeServiceError) return error.errorCode;
  if (error instanceof KnowledgeAiProviderOutputError) {
    return KNOWLEDGE_ERROR_CODES.AI_OUTPUT_INVALID;
  }
  return KNOWLEDGE_ERROR_CODES.AI_ORGANIZATION_FAILED;
}
