export type SystemAiTask =
  | "health_probe"
  | "structured_probe"
  | "admin_management_brief"
  | "staff_today_actions"
  | "knowledge_organize"
  | "knowledge_qa"
  | "knowledge_compare";

export type AiServiceError =
  | "timeout"
  | "invalid_output"
  | "model_unavailable"
  | "rate_limited"
  | "internal_error";

export type AiServiceResult<T> =
  | { ok: true; data: T; model: string }
  | { ok: false; error: AiServiceError };

export type HealthProbeOutput = {
  status: "ok";
  summary: string;
};

export type AdminBriefOutput = {
  headline: string;
  summary: string;
  priorities: Array<{
    category: string;
    title: string;
    reason: string;
    urgency: string;
  }>;
  cautions: string[];
};

export type StaffTodayActionsOutput = {
  headline: string;
  actions: Array<{
    customerRef?: string;
    category: string;
    title: string;
    reason: string;
    urgency: string;
  }>;
};

export type CrmAiProbeRequest = {
  task: "health_probe" | "structured_probe";
  model?: string;
};

export type CrmAiAdminBriefRequest = {
  task: "admin_management_brief";
  schemaVersion: string;
  locale: string;
  context: Record<string, unknown>;
};

export type CrmAiStaffActionsRequest = {
  task: "staff_today_actions";
  schemaVersion: string;
  locale: string;
  context: Record<string, unknown>;
};

export type CrmAiKnowledgeOrganizeRequest = {
  task: "knowledge_organize";
  schemaVersion: string;
  locale: string;
  systemPrompt: string;
  userPrompt: string;
};

export type CrmAiKnowledgeQaRequest = {
  task: "knowledge_qa";
  schemaVersion: string;
  locale: string;
  systemPrompt: string;
  userPrompt: string;
};

export type CrmAiKnowledgeCompareRequest = {
  task: "knowledge_compare";
  schemaVersion: string;
  locale: string;
  systemPrompt: string;
  userPrompt: string;
};

export type KnowledgeOrganizeOutput = {
  title: string;
  summary: string | null;
  body: string;
  suggestedCategory: string | null;
  warnings: string[];
};

export type KnowledgeQaOutput = {
  answer: string;
  citationIds: string[];
  insufficientInformation: boolean;
};

export type KnowledgeComparisonDiffItem = {
  id: string;
  topic: string;
  existingValue: string | null;
  incomingValue: string | null;
  explanation: string;
  confidence: number;
  sourceExcerpt: string | null;
  existingExcerpt: string | null;
};

export type KnowledgeComparisonSuggestedUpdate = {
  topic: string;
  suggestion: string;
  rationale: string;
  confidence: number;
};

export type KnowledgeCompareOutput = {
  relationship: "update_existing" | "new_article" | "ambiguous";
  matchedCandidateKey: "C1" | "C2" | "C3" | null;
  matchConfidence: number;
  newFacts: KnowledgeComparisonDiffItem[];
  changedFacts: KnowledgeComparisonDiffItem[];
  conflicts: KnowledgeComparisonDiffItem[];
  uncertainties: KnowledgeComparisonDiffItem[];
  suggestedUpdates: KnowledgeComparisonSuggestedUpdate[];
};

export type CrmAiRequest =
  | CrmAiProbeRequest
  | CrmAiAdminBriefRequest
  | CrmAiStaffActionsRequest
  | CrmAiKnowledgeOrganizeRequest
  | CrmAiKnowledgeQaRequest
  | CrmAiKnowledgeCompareRequest;

export type CrmAiEnv = {
  AI: Ai;
  CRM_AI_TIMEOUT_MS?: string;
};

export type CrmAiHandleResult =
  | AiServiceResult<HealthProbeOutput>
  | AiServiceResult<AdminBriefOutput>
  | AiServiceResult<StaffTodayActionsOutput>
  | AiServiceResult<KnowledgeOrganizeOutput>
  | AiServiceResult<KnowledgeQaOutput>
  | AiServiceResult<KnowledgeCompareOutput>;
