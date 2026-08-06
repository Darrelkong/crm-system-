export type DashboardReclamationRiskSummary = {
  tomorrowCount: number;
  within7Count: number;
  within14Count: number;
  pendingRiskCount: number;
  /** Admin team summary only; never exposed to staff. */
  memberCount: number | null;
  drilldownHref: string;
};

export type StaffDashboardMetrics = {
  dueTodayFollowUps: number;
  overdueFollowUps: number;
  autoReleaseWithin7Days: number;
  autoReleaseTomorrow: number;
  pendingWorkItems: number;
  validFollowUpsToday: number;
  myCustomerCount: number;
};

export type AdminDashboardMetrics = {
  newCustomersToday: number;
  validFollowUpsToday: number;
  pendingApprovals: number;
  autoReleaseWithin7Days: number;
  autoReleaseTomorrow: number;
  overdueFollowUps: number;
  publicPoolEnteredToday: number;
  totalCustomers: number;
};

export type DashboardGreeting = {
  displayName: string;
  /** Staff: customers due for follow-up today (for welcome line). */
  dueTodayCount: number | null;
};

export type StaffDashboardSummary = {
  role: "staff";
  greeting: DashboardGreeting;
  metrics: StaffDashboardMetrics;
  reclamationRisk: DashboardReclamationRiskSummary;
};

export type AdminDashboardSummary = {
  role: "admin";
  greeting: DashboardGreeting;
  metrics: AdminDashboardMetrics;
  reclamationRisk: DashboardReclamationRiskSummary;
};

export type DashboardSummary = StaffDashboardSummary | AdminDashboardSummary;
