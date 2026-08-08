import type { SystemAiTask } from "./types";

export type CrmAiLogEntry = {
  task: SystemAiTask;
  model: string;
  ok: boolean;
  durationMs: number;
  error?: string;
};

/** Metadata-only logging — never prompt, response, or PII. */
export function logCrmAiEvent(entry: CrmAiLogEntry): void {
  console.info("[crm-ai]", {
    task: entry.task,
    model: entry.model,
    ok: entry.ok,
    durationMs: entry.durationMs,
    error: entry.error,
  });
}
