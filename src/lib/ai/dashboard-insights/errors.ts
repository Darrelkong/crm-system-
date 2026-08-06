import type { DashboardAiResultStatus } from "./types";

export class DashboardAiInsightError extends Error {
  readonly status: DashboardAiResultStatus;

  constructor(status: DashboardAiResultStatus, message?: string) {
    super(message ?? status);
    this.name = "DashboardAiInsightError";
    this.status = status;
  }
}

export class DashboardAiPermissionError extends Error {
  constructor(message = "Dashboard AI access denied") {
    super(message);
    this.name = "DashboardAiPermissionError";
  }
}
