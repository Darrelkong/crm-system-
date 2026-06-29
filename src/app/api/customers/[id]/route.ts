export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import {
  assertCustomerNotPendingOnHoldCreate,
  PENDING_ON_HOLD_CREATE_AUDIT_ACTION,
} from "@/lib/customers/pending-on-hold-access";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import {
  assertCanEditCustomer,
  assertStaffCannotChangeCustomerStatus,
  assertPublicPoolRequiresReleaseFlow,
  PermissionError,
} from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { enrichCustomerResponse } from "@/lib/customers/scoring/service";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { validateCustomerInput } from "@/lib/customers/validation";
import { parseCustomerBody } from "@/lib/customers/parse-input";
import { checkCustomerDuplicates } from "@/lib/customers/duplicate-check";
import {
  buildCustomerUpdatePayload,
  writeFieldChangeLogs,
} from "@/lib/customers/field-change-log";
import { archiveCustomerToRecycleBin } from "@/lib/recycle-bin/archive-customer";
import { getRequestMeta } from "@/lib/auth/cookies";
import { getActiveCustomerTagKeys } from "@/lib/customer-tags/queries";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;

    const customer = await getCustomerById(id);
    if (!customer) {
      return Response.json({ error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const db = getDb();
    try {
      await assertCustomerNotPendingOnHoldCreate(db, id);
    } catch (err) {
      if (err instanceof PermissionError) {
        return Response.json(
          {
            error: err.message,
            errorCode: "PENDING_ON_HOLD_CREATE",
          },
          { status: 403 },
        );
      }
      throw err;
    }

    try {
      const customerView = await enrichCustomerResponse(db, user, customer);
      return Response.json({ customer: customerView });
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: "permission.denied.customer_access",
          userId: user.id,
          entityType: "customer",
          entityId: id,
          metadata: { ownerId: customer.ownerId, status: customer.status },
        });
      }
      throw err;
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const { ipAddress, userAgent } = getRequestMeta(request);

    const existing = await getCustomerById(id);
    if (!existing) {
      return Response.json({ error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }

    const db = getDb();
    try {
      await assertCustomerNotPendingOnHoldCreate(db, id);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? PENDING_ON_HOLD_CREATE_AUDIT_ACTION,
          userId: user.id,
          entityType: "customer",
          entityId: id,
        });
        return Response.json(
          {
            error: err.message,
            errorCode: "PENDING_ON_HOLD_CREATE",
          },
          { status: 403 },
        );
      }
      throw err;
    }

    try {
      assertCanEditCustomer(user, existing);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? "permission.denied.customer_edit",
          userId: user.id,
          entityType: "customer",
          entityId: id,
          metadata: { ownerId: existing.ownerId, status: existing.status },
        });
      }
      throw err;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const input = parseCustomerBody(body);

    try {
      assertStaffCannotChangeCustomerStatus(user, existing, body);
      assertPublicPoolRequiresReleaseFlow(existing, body);
    } catch (err) {
      if (err instanceof PermissionError) {
        await logPermissionDenied(request, {
          action: err.auditAction ?? "permission.denied.customer_status_change",
          userId: user.id,
          entityType: "customer",
          entityId: id,
          metadata: {
            ownerId: existing.ownerId,
            currentStatus: existing.status,
            requestedStatus:
              typeof body.status === "string" ? body.status : undefined,
          },
        });
      }
      throw err;
    }

    const updateStatus =
      user.role === "admin" ? input.status! : existing.status;

    const allowedSourceKeys = await getActiveCustomerTagKeys(db);

    const fieldErrors = validateCustomerInput(
      { ...input, status: updateStatus },
      {
        isUpdate: true,
        existingNotes: existing.notes,
        existingSalesStage: existing.salesStage,
        allowedSourceKeys,
        userRole: user.role === "admin" ? "admin" : "staff",
      },
    );
    if (fieldErrors.length > 0) {
      await writeAuditLog({
        userId: user.id,
        action: "customer.update_failed.validation",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: { fieldErrors },
      });
      return Response.json(
        { error: "输入校验失败", errorCode: "VALIDATION_FAILED", fieldErrors },
        { status: 400 },
      );
    }

    const payload = buildCustomerUpdatePayload({
      customerName: input.customerName!,
      customerType: input.customerType!,
      phoneCountryCode: input.phoneCountryCode!,
      phone: input.phone ?? null,
      wechatId: input.wechatId ?? null,
      email: input.email ?? null,
      source: input.source!,
      sourceRemark: input.sourceRemark ?? null,
      requestedProjectName: input.requestedProjectName ?? null,
      notes: input.notes ?? null,
      salesStage: input.salesStage!,
      status: updateStatus,
    });

    const duplicates = await checkCustomerDuplicates(
      { phone: payload.phone, wechatId: payload.wechatId, email: payload.email },
      user,
      id,
    );

    if (duplicates.length > 0) {
      await writeAuditLog({
        userId: user.id,
        action: "customer.update_failed.duplicate",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: { fields: duplicates.map((d) => d.field) },
      });
      return Response.json(
        {
          error: "存在重复客户",
          errorCode: "DUPLICATE_CUSTOMER",
          code: "duplicate_customer",
          duplicates,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const isArchiving =
      updateStatus === "archived" && existing.status !== "archived";

    if (isArchiving) {
      await archiveCustomerToRecycleBin(db, {
        customer: existing,
        actor: user,
        source: "admin_patch",
        ipAddress,
        userAgent,
        now,
      });

      const archivedCustomer = await getCustomerById(id);
      if (!archivedCustomer) {
        return Response.json(
          { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
          { status: 404 },
        );
      }

      const otherChangedFields = await writeFieldChangeLogs(
        id,
        archivedCustomer,
        payload,
        user.id,
      );

      await db
        .update(schema.customers)
        .set({
          customerName: payload.customerName,
          customerType: payload.customerType,
          phoneCountryCode: payload.phoneCountryCode,
          phone: payload.phone,
          wechatId: payload.wechatId,
          email: payload.email,
          source: payload.source,
          sourceRemark: payload.sourceRemark,
          requestedProjectName: payload.requestedProjectName,
          notes: payload.notes,
          salesStage: payload.salesStage,
          status: payload.status,
          updatedBy: user.id,
          updatedAt: now,
        })
        .where(eq(schema.customers.id, id));

      const changedFields = [
        "status",
        ...otherChangedFields.filter((field) => field !== "status"),
      ];

      await writeAuditLog({
        userId: user.id,
        action: "customer.updated",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: {
          changedFields,
          customerName: payload.customerName,
          archivedToRecycleBin: true,
        },
      });

      const updated = await getCustomerById(id);
      const view = updated
        ? await enrichCustomerResponse(db, user, updated)
        : null;

      return Response.json({ ok: true, id, customer: view });
    }

    const changedFields = await writeFieldChangeLogs(
      id,
      existing,
      payload,
      user.id,
    );

    await db
      .update(schema.customers)
      .set({
        customerName: payload.customerName,
        customerType: payload.customerType,
        phoneCountryCode: payload.phoneCountryCode,
        phone: payload.phone,
        wechatId: payload.wechatId,
        email: payload.email,
        source: payload.source,
        sourceRemark: payload.sourceRemark,
        requestedProjectName: payload.requestedProjectName,
        notes: payload.notes,
        salesStage: payload.salesStage,
        status: payload.status,
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(schema.customers.id, id));

    await writeAuditLog({
      userId: user.id,
      action: "customer.updated",
      entityType: "customer",
      entityId: id,
      ipAddress,
      userAgent,
      metadata: {
        changedFields,
        customerName: payload.customerName,
      },
    });

    const updated = await getCustomerById(id);
    const view = updated
      ? await enrichCustomerResponse(db, user, updated)
      : null;

    return Response.json({ ok: true, id, customer: view });
  } catch (error) {
    return authErrorResponse(error);
  }
}
