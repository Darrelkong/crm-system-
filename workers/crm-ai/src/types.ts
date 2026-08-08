export type SystemAiTask =
  | "health_probe"
  | "structured_probe"
  | "admin_management_brief"
  | "staff_today_actions";

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

export type CrmAiRequest =
  | CrmAiProbeRequest
  | CrmAiAdminBriefRequest
  | CrmAiStaffActionsRequest;

export type CrmAiEnv = {
  AI: Ai;
  CRM_AI_TIMEOUT_MS?: string;
};

export type CrmAiHandleResult =
  | AiServiceResult<HealthProbeOutput>
  | AiServiceResult<AdminBriefOutput>
  | AiServiceResult<StaffTodayActionsOutput>;
