import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import {
  PermissionError,
  type CustomerAccessLevel,
} from "@/lib/permissions/customers";

export type ContactAvailability = {
  hasPhone: boolean;
  hasEmail: boolean;
  hasWeChat: boolean;
  hasAnyContactMethod: boolean;
  contactMethodCount: number;
  contactCompletenessLabel: "none" | "partial" | "complete";
};

function hasContactText(value: string | null): boolean {
  return !!value && value.trim().length > 0;
}

export function computeContactAvailability(
  phone: string | null,
  email: string | null,
  wechatId: string | null,
): ContactAvailability {
  const hasPhone = hasContactText(phone);
  const hasEmail = hasContactText(email);
  const hasWeChat = hasContactText(wechatId);
  const contactMethodCount = [hasPhone, hasEmail, hasWeChat].filter(Boolean).length;
  const hasAnyContactMethod = contactMethodCount > 0;
  const contactCompletenessLabel: ContactAvailability["contactCompletenessLabel"] =
    contactMethodCount === 0 ? "none" : contactMethodCount === 1 ? "partial" : "complete";
  return {
    hasPhone,
    hasEmail,
    hasWeChat,
    hasAnyContactMethod,
    contactMethodCount,
    contactCompletenessLabel,
  };
}

const RECENT_FOLLOW_UP_LIMIT = 10;

export type CustomerInsightFollowUpContext = {
  id: string;
  followUpTime: string;
  channel: string;
  outcome: string;
  summary: string;
  customerIntent: string | null;
  isValidFollowUp: number;
  nextFollowUpAt: string | null;
};

export type CustomerInsightContext = {
  customerId: string;
  customerName: string;
  customerType: string;
  salesStage: string;
  source: string;
  status: string;
  requestedProjectName: string | null;
  sourceRemark: string | null;
  notes: string | null;
  lastFollowUpAt: string | null;
  lastValidFollowUpAt: string | null;
  nextFollowUpAt: string | null;
  updatedAt: string;
  includeSensitiveFields: boolean;
  phone: string | null;
  wechatId: string | null;
  email: string | null;
  recentFollowUps: CustomerInsightFollowUpContext[];
};

export async function buildCustomerInsightContext(
  db: Database,
  customerId: string,
  options: { accessLevel: CustomerAccessLevel },
): Promise<CustomerInsightContext | null> {
  if (options.accessLevel !== "full") {
    throw new PermissionError(
      403,
      "无权查看该客户 AI 洞察",
      "permission.denied.customer_ai_insight",
    );
  }

  const [customer] = await db
    .select()
    .from(schema.customers)
    .where(eq(schema.customers.id, customerId))
    .limit(1);

  if (!customer) {
    return null;
  }

  if (customer.id !== customerId) {
    throw new PermissionError(
      403,
      "无权查看该客户 AI 洞察",
      "permission.denied.customer_ai_insight",
    );
  }

  const followUpRows = await db
    .select({
      id: schema.followUps.id,
      followUpTime: schema.followUps.followUpTime,
      channel: schema.followUps.channel,
      outcome: schema.followUps.outcome,
      summary: schema.followUps.summary,
      customerIntent: schema.followUps.customerIntent,
      isValidFollowUp: schema.followUps.isValidFollowUp,
      nextFollowUpAt: schema.followUps.nextFollowUpAt,
    })
    .from(schema.followUps)
    .where(eq(schema.followUps.customerId, customerId))
    .orderBy(desc(schema.followUps.followUpTime))
    .limit(RECENT_FOLLOW_UP_LIMIT);

  return {
    customerId: customer.id,
    customerName: customer.customerName,
    customerType: customer.customerType,
    salesStage: customer.salesStage,
    source: customer.source,
    status: customer.status,
    requestedProjectName: customer.requestedProjectName,
    sourceRemark: customer.sourceRemark,
    notes: customer.notes,
    lastFollowUpAt: customer.lastFollowUpAt,
    lastValidFollowUpAt: customer.lastValidFollowUpAt,
    nextFollowUpAt: customer.nextFollowUpAt,
    updatedAt: customer.updatedAt,
    includeSensitiveFields: true,
    phone: customer.phone,
    wechatId: customer.wechatId,
    email: customer.email,
    recentFollowUps: followUpRows,
  };
}
