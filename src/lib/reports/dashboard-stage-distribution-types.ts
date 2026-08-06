import type { StageCountRow } from "./dashboard-stage-catalog";

export type DashboardStageDistributionPayload = {
  role: "admin" | "staff";
  titleKey: string;
  totalCustomers: number;
  stages: StageCountRow[];
};
