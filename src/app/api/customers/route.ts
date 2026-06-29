export const dynamic = "force-dynamic";

import { getDb, schema } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { validateCustomerInput } from "@/lib/customers/validation";
import { parseCustomerBody } from "@/lib/customers/parse-input";
import { checkCustomerDuplicates } from "@/lib/customers/duplicate-check";
import { buildCustomerUpdatePayload } from "@/lib/customers/field-change-log";
import {
  listCustomersForUser,
  listCustomersForUserPaginated,
  searchCustomersForUser,
  searchCustomersForUserPaginated,
  parseCustomerListFilter,
  parseCustomerListPageParams,
  buildCustomerListPagination,
} from "@/lib/customers/queries";
import {
  filterCustomersWithScores,
  getCustomerIdsWithFollowUps,
  getCustomersWithScores,
  parseScoringListFilter,
} from "@/lib/customers/scoring/service";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { getRequestMeta } from "@/lib/auth/cookies";
import { allocateCustomerCode } from "@/lib/customers/customer-code";
import { getActiveCustomerTagKeys } from "@/lib/customer-tags/queries";
import { buildCustomerListRows } from "@/lib/customers/list-rows";
import { getAssigneeCustomerIdsForUser } from "@/lib/customers/assignees";
import {
  buildOnHoldCreateApprovalPayload,
  isStaffOnHoldCreatePending,
  resolvePersistedSalesStageForCreate,
  validateOnHoldReason,
} from "@/lib/customers/on-hold-create-pending";
import {
  createApprovalRequest,
  approvalErrorResponse,
  ApprovalError,
} from "@/lib/approvals/service";
import { getCustomerById } from "@/lib/customers/queries";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const searchQuery = url.searchParams.get("q")?.trim() ?? "";
    const listFilter = parseCustomerListFilter(user, {
      status: statusParam ?? undefined,
      createdBy: url.searchParams.get("createdBy") ?? undefined,
    });
    const scoringFilter = parseScoringListFilter(url.searchParams);
    const { page } = parseCustomerListPageParams({
      page: url.searchParams.get("page"),
    });
    const hasScoringFilter =
      scoringFilter.heat != null || scoringFilter.completenessBelow != null;

    const db = getDb();
    const settings = await getEffectiveSettings(db);

    if (hasScoringFilter) {
      const customers = searchQuery
        ? await searchCustomersForUser(user, searchQuery, listFilter)
        : await listCustomersForUser(user, listFilter);
      const followUpSet = await getCustomerIdsWithFollowUps(
        db,
        customers.map((c) => c.id),
      );
      const assigneeIds = await getAssigneeCustomerIdsForUser(
        db,
        user.id,
        customers.map((customer) => customer.id),
      );
      const items = filterCustomersWithScores(
        getCustomersWithScores(
          user,
          customers,
          followUpSet,
          settings,
          new Date(),
          assigneeIds,
        ),
        scoringFilter,
      );
      const pagination = buildCustomerListPagination(items.length, page);
      const offset = (pagination.page - 1) * pagination.pageSize;
      const pageItems = items.slice(offset, offset + pagination.pageSize);
      const rows = await buildCustomerListRows(db, pageItems);

      return Response.json({
        items: rows,
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: pagination.total,
        pageCount: pagination.pageCount,
      });
    }

    const result = searchQuery
      ? await searchCustomersForUserPaginated(
          user,
          searchQuery,
          listFilter,
          page,
        )
      : await listCustomersForUserPaginated(user, listFilter, page);
    const followUpSet = await getCustomerIdsWithFollowUps(
      db,
      result.items.map((c) => c.id),
    );
    const assigneeIds = await getAssigneeCustomerIdsForUser(
      db,
      user.id,
      result.items.map((customer) => customer.id),
    );
    const items = getCustomersWithScores(
      user,
      result.items,
      followUpSet,
      settings,
      new Date(),
      assigneeIds,
    );
    const rows = await buildCustomerListRows(db, items);

    return Response.json({
      items: rows,
      page: result.pagination.page,
      pageSize: result.pagination.pageSize,
      total: result.pagination.total,
      pageCount: result.pagination.pageCount,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const { ipAddress, userAgent } = getRequestMeta(request);

    const body = (await request.json()) as Record<string, unknown>;
    const input = parseCustomerBody(body, { forCreate: true });
    // Create defaults status to active; strip status from validation default
    const createInput = { ...input, status: "active" };

    const db = getDb();
    const allowedSourceKeys = await getActiveCustomerTagKeys(db);

    const fieldErrors = validateCustomerInput(createInput, {
      requireSalesStage: true,
      allowedSourceKeys,
      userRole: user.role === "admin" ? "admin" : "staff",
    });
    if (fieldErrors.length > 0) {
      await writeAuditLog({
        userId: user.id,
        action: "customer.create_failed.validation",
        ipAddress,
        userAgent,
        metadata: { fieldErrors },
      });
      return Response.json(
        { error: "输入校验失败", errorCode: "VALIDATION_FAILED", fieldErrors },
        { status: 400 },
      );
    }

    // Staff owner is always forced to current user; admin defaults to self
    const ownerId =
      user.role === "admin"
        ? (typeof body.ownerId === "string" ? body.ownerId : user.id)
        : user.id;

    const duplicates = await checkCustomerDuplicates(
      { phone: createInput.phone, wechatId: createInput.wechatId, email: createInput.email },
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
          errorCode: "DUPLICATE_CUSTOMER",
          code: "duplicate_customer",
          duplicates,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const customerCode = await allocateCustomerCode(db);
    const requestedSalesStage = createInput.salesStage!;
    const pendingOnHoldApproval = isStaffOnHoldCreatePending(
      user.role,
      requestedSalesStage,
    );

    let validatedOnHoldReason: string | undefined;
    if (pendingOnHoldApproval) {
      const reasonValidation = validateOnHoldReason(body.onHoldReason);
      if (!reasonValidation.ok) {
        await writeAuditLog({
          userId: user.id,
          action: "customer.create_failed.validation",
          ipAddress,
          userAgent,
          metadata: {
            errorCode: reasonValidation.errorCode,
            field: "onHoldReason",
          },
        });
        return Response.json(
          {
            error: "输入校验失败",
            errorCode: reasonValidation.errorCode,
            fieldErrors: [
              {
                field: "onHoldReason",
                code: reasonValidation.errorCode,
                message:
                  reasonValidation.errorCode === "ON_HOLD_REASON_REQUIRED"
                    ? "请填写搁置申请理由"
                    : "搁置申请理由至少需要 8 个字",
              },
            ],
          },
          { status: 400 },
        );
      }
      validatedOnHoldReason = reasonValidation.value;
    }

    const persistedSalesStage = resolvePersistedSalesStageForCreate(
      user.role,
      requestedSalesStage,
    );

    const payload = buildCustomerUpdatePayload({
      customerName: createInput.customerName!,
      customerType: createInput.customerType!,
      phoneCountryCode: createInput.phoneCountryCode!,
      phone: createInput.phone ?? null,
      wechatId: createInput.wechatId ?? null,
      email: createInput.email ?? null,
      source: createInput.source!,
      sourceRemark: createInput.sourceRemark ?? null,
      requestedProjectName: createInput.requestedProjectName ?? null,
      notes: createInput.notes ?? null,
      salesStage: persistedSalesStage,
      status: "active",
    });

    await db.insert(schema.customers).values({
      id,
      customerCode,
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
      ownerId,
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    });

    if (pendingOnHoldApproval) {
      const customer = await getCustomerById(id);
      if (!customer) {
        return Response.json(
          { error: "服务器错误", errorCode: "SERVER_ERROR" },
          { status: 500 },
        );
      }

      const { id: approvalId } = await createApprovalRequest(
        customer,
        user,
        {
          requestType: "create_on_hold_customer",
          reason: validatedOnHoldReason!,
          payload: buildOnHoldCreateApprovalPayload({
            requestedSalesStage,
            onHoldReason: validatedOnHoldReason!,
            customerName: createInput.customerName!,
            customerType: createInput.customerType!,
            phoneCountryCode: createInput.phoneCountryCode!,
            phone: createInput.phone,
            wechatId: createInput.wechatId,
            email: createInput.email,
            source: createInput.source!,
            sourceRemark: createInput.sourceRemark,
            requestedProjectName: createInput.requestedProjectName,
            notes: createInput.notes,
          }),
        },
        { ipAddress, userAgent },
      );

      await writeAuditLog({
        userId: user.id,
        action: "customer.create_on_hold.pending",
        entityType: "customer",
        entityId: id,
        ipAddress,
        userAgent,
        metadata: {
          customerName: createInput.customerName,
          customerCode,
          approvalId,
          requestedSalesStage,
        },
      });

      return Response.json(
        {
          ok: true,
          pendingApproval: true,
          approvalId,
          message: "ON_HOLD_APPROVAL_REQUIRED",
        },
        { status: 201 },
      );
    }

    await writeAuditLog({
      userId: user.id,
      action: "customer.created",
      entityType: "customer",
      entityId: id,
      ipAddress,
      userAgent,
      metadata: {
        customerName: createInput.customerName,
        customerCode,
        source: createInput.source,
        ownerId,
      },
    });

    return Response.json({ ok: true, id }, { status: 201 });
  } catch (error) {
    if (error instanceof ApprovalError) {
      return approvalErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
