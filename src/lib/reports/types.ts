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
  blockedReason: string | null;
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
  publicPoolClaimStatus: PublicPoolClaimSummary;
};
