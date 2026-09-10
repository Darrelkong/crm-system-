export type SystemAiTask =
  | "health_probe"
  | "structured_probe"
  | "admin_management_brief"
  | "staff_today_actions"
  | "knowledge_organize"
  | "knowledge_qa";

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

export type CrmAiRequest =
  | CrmAiProbeRequest
  | CrmAiAdminBriefRequest
  | CrmAiStaffActionsRequest
  | CrmAiKnowledgeOrganizeRequest
  | CrmAiKnowledgeQaRequest;

export type CrmAiEnv = {
  AI: Ai;
  CRM_AI_TIMEOUT_MS?: string;
};

export type CrmAiHandleResult =
  | AiServiceResult<HealthProbeOutput>
  | AiServiceResult<AdminBriefOutput>
  | AiServiceResult<StaffTodayActionsOutput>
  | AiServiceResult<KnowledgeOrganizeOutput>
  | AiServiceResult<KnowledgeQaOutput>;
