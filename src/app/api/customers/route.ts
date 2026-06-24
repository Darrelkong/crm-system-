export const dynamic = "force-dynamic";

import { getDb, schema } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  formatCustomerForUser,
  getCustomerListScope,
} from "@/lib/permissions/customers";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { validateCreateCustomer } from "@/lib/customers/validation";
import { checkCustomerDuplicates } from "@/lib/customers/duplicate-check";
import { listCustomersForUser } from "@/lib/customers/queries";
import { getRequestMeta } from "@/lib/auth/cookies";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const customers = await listCustomersForUser(user);
    const items = customers.map((c) => formatCustomerForUser(user, c));
    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const { ipAddress, userAgent } = getRequestMeta(request);

    const body = (await request.json()) as Record<string, unknown>;

    const input = {
      customerName: typeof body.customerName === "string" ? body.customerName : "",
      customerType: typeof body.customerType === "string" ? body.customerType : "individual",
      phoneCountryCode: typeof body.phoneCountryCode === "string" ? body.phoneCountryCode : "+86",
      phone: typeof body.phone === "string" ? body.phone : null,
      wechatId: typeof body.wechatId === "string" ? body.wechatId : null,
      email: typeof body.email === "string" ? body.email : null,
      source: typeof body.source === "string" ? body.source : "",
      sourceRemark: typeof body.sourceRemark === "string" ? body.sourceRemark : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      salesStage: typeof body.salesStage === "string" ? body.salesStage : "new_lead",
    };

    const fieldErrors = validateCreateCustomer(input);
    if (fieldErrors.length > 0) {
      await writeAuditLog({
        userId: user.id,
        action: "customer.create_failed.validation",
        ipAddress,
        userAgent,
        metadata: { fieldErrors },
      });
      return Response.json(
        { error: "输入校验失败", fieldErrors },
        { status: 400 },
      );
    }

    // Staff owner is always forced to current user; admin defaults to self
    const ownerId =
      user.role === "admin"
        ? (typeof body.ownerId === "string" ? body.ownerId : user.id)
        : user.id;

    const duplicates = await checkCustomerDuplicates(
      { phone: input.phone, wechatId: input.wechatId, email: input.email },
      user,
    );

    if (duplicates.length > 0) {
      await writeAuditLog({
        userId: user.id,
        action: "customer.create_failed.duplicate",
        ipAddress,
        userAgent,
        metadata: { fields: duplicates.map((d) => d.field) },
      });
      return Response.json(
        {
          error: "存在重复客户",
          code: "duplicate_customer",
          duplicates,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const db = getDb();

    await db.insert(schema.customers).values({
      id,
      customerName: input.customerName.trim(),
      customerType: input.customerType,
      phoneCountryCode: input.phoneCountryCode,
      phone: input.phone?.trim() || null,
      wechatId: input.wechatId?.trim() || null,
      email: input.email?.trim().toLowerCase() || null,
      source: input.source,
      sourceRemark: input.sourceRemark?.trim() || null,
      notes: input.notes?.trim() || null,
      salesStage: input.salesStage,
      status: "active",
      ownerId,
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog({
      userId: user.id,
      action: "customer.created",
      entityType: "customer",
      entityId: id,
      ipAddress,
      userAgent,
      metadata: {
        customerName: input.customerName,
        source: input.source,
        ownerId,
      },
    });

    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
