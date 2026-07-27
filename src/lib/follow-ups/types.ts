export type FollowUpListItem = {
  id: string;
  customerId: string;
  customerName: string;
  nameStatus: string;
  userId: string;
  userName: string;
  followUpTime: string;
  channel: string;
  outcome: string;
  summary: string;
  nextFollowUpAt: string | null;
  nextAction: string | null;
  customerSalesStage: string;
  customerStatus: string;
  isValidFollowUp: boolean;
};
