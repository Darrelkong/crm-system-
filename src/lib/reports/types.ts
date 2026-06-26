export type CountByLabel = {
  label: string;
  count: number;
};

export type OwnerCount = {
  ownerId: string;
  ownerName: string;
  count: number;
};

export type StaffFollowUpCount = {
  userId: string;
  userName: string;
  count: number;
};

export type RecentFollowUpRow = {
  id: string;
  customerId: string;
  customerName: string;
  userId: string;
  userName: string;
  followUpTime: string;
  channel: string;
  outcome: string;
  summary: string;
  isValidFollowUp: boolean;
};

export type AdminReportsStats = {
  totalCustomers: number;
  newCustomersToday: number;
  newCustomersThisWeek: number;
  newCustomersThisMonth: number;
  followUpsToday: number;
  followUpsThisWeek: number;
  followUpsThisMonth: number;
  pendingApprovals: number;
  customersBySalesStage: CountByLabel[];
  customersByOwner: OwnerCount[];
  recentFollowUps: RecentFollowUpRow[];
};

export type StaffReportsStats = {
  myCustomers: number;
  myNewCustomersToday: number;
  myNewCustomersThisWeek: number;
  myNewCustomersThisMonth: number;
  myFollowUpsToday: number;
  myFollowUpsThisWeek: number;
  myFollowUpsThisMonth: number;
  myCustomersBySalesStage: CountByLabel[];
  recentFollowUps: RecentFollowUpRow[];
};

export type AdminDashboardStats = {
  totalCustomers: number;
  activeCustomers: number;
  publicPoolCustomers: number;
  archivedCustomers: number;
  todayOpenTasks: number;
  overdueTasks: number;
  pendingApprovals: number;
  newCustomersThisMonth: number;
  followUpsThisMonth: number;
  validFollowUpsThisMonth: number;
  closedWonCustomers: number;
  autoReclaimedThisMonth: number;
  highChurnRiskCustomers: number;
  lowCompletenessCustomers: number;
  customersBySource: CountByLabel[];
  customersBySalesStage: CountByLabel[];
  customersByOwner: OwnerCount[];
  followUpsByStaffThisMonth: StaffFollowUpCount[];
};

export type PublicPoolClaimSummary = {
  claimedInLast7Days: number;
  remainingQuota: number;
  quotaLimit: number;
  cooldownHours: number;
  inCooldown: boolean;
  cooldownUntil: string | null;
  canClaimNow: boolean;
  blockedReasonKey: string | null;
  blockedReasonParams?: Record<string, string>;
};

export type StaffDashboardStats = {
  myCustomers: number;
  myTodayTasks: number;
  myOverdueTasks: number;
  myPendingApprovals: number;
  myNewCustomersThisMonth: number;
  myFollowUpsThisMonth: number;
  myValidFollowUpsThisMonth: number;
  myClosedWonCustomers: number;
  myClaimedFromPoolLast7Days: number;
  myNeverContactedCustomers: number;
  myReclaimRiskCustomers: number;
  myHighChurnRiskCustomers: number;
  myLowCompletenessCustomers: number;
  publicPoolClaimStatus: PublicPoolClaimSummary;
};
