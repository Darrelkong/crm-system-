export const dynamic = "force-dynamic";

import { getDb } from "@/lib/db";
import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { writeAuditLog } from "@/lib/audit/audit-log";
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
import {
  parseCustomerListSortParam,
} from "@/lib/customers/customer-list-sort";
import { getActiveCustomerTagKeys } from "@/lib/customer-tags/queries";
import { buildCustomerListRows } from "@/lib/customers/list-rows";
import { getAssigneeCustomerIdsForUser } from "@/lib/customers/assignees";
import { approvalErrorResponse } from "@/lib/approvals/service";
import {
  prepareCustomerCreation,
  executePreparedCustomerCreation,
  ApprovalError,
} from "@/lib/customers/create-customer-service";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const searchQuery = url.searchParams.get("q")?.trim() ?? "";
    const listFilter = parseCustomerListFilter(user, {
      status: statusParam ?? undefined,
      createdBy: url.searchParams.get("createdBy") ?? undefined,
      workView: url.searchParams.get("workView") ?? undefined,
      salesStage: url.searchParams.get("salesStage") ?? undefined,
      ownerId: url.searchParams.get("ownerId") ?? undefined,
    });
    const archived = listFilter.status === "archived";
    const sortMode = parseCustomerListSortParam(
      url.searchParams.get("sort"),
      { archived },
    );
    const scoringFilter = parseScoringListFilter(url.searchParams);
    const { page } = parseCustomerListPageParams({
      page: url.searchParams.get("page"),
    });
    const hasScoringFilter =
      scoringFilter.heat != null || scoringFilter.completenessBelow != null;

    const db = getDb();
    const settings = await getEffectiveSettings(db);
    const listQueryOptions = {
      sortMode,
      automaticReclaimDays: settings.automaticReclaimDays,
    };

    if (hasScoringFilter) {
      const customers = searchQuery
        ? await searchCustomersForUser(user, searchQuery, listFilter, 10_000, listQueryOptions)
        : await listCustomersForUser(user, listFilter, 10_000, listQueryOptions);
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
          listQueryOptions,
        )
      : await listCustomersForUserPaginated(
          user,
          listFilter,
          page,
          listQueryOptions,
        );
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
    const db = getDb();
    const allowedSourceKeys = await getActiveCustomerTagKeys(db);

    const prepared = await prepareCustomerCreation({
      actor: user,
      body,
      allowedSourceKeys,
      db,
    });

    if (prepared.kind === "internal_error") {
      return Response.json(
        {
          error: "服务器错误，请稍后重试",
          errorCode: "INTERNAL_ERROR",
        },
        { status: 500 },
      );
    }

    if (prepared.kind === "validation") {
      await writeAuditLog({
        userId: user.id,
        action: "customer.create_failed.validation",
        ipAddress,
        userAgent,
        metadata: prepared.auditMetadata ?? { fieldErrors: prepared.fieldErrors },
      });
      return Response.json(
        { error: "输入校验失败", errorCode: "VALIDATION_FAILED", fieldErrors: prepared.fieldErrors },
        { status: 400 },
      );
    }

    if (prepared.kind === "duplicate") {
      return Response.json(
        {
          error: "存在重复客户",
          errorCode: "DUPLICATE_CUSTOMER",
          code: "duplicate_customer",
          duplicate: true,
          duplicates: prepared.duplicates,
        },
        { status: 409 },
      );
    }

    if (prepared.kind === "name_duplicate") {
      return prepared.response;
    }

    try {
      const result = await executePreparedCustomerCreation({
        db,
        actor: user,
        statements: prepared.statements,
        meta: prepared.meta,
        audit: { ipAddress, userAgent },
      });

      if (result.kind === "pending_approval") {
        return Response.json(
          {
            ok: true,
            pendingApproval: true,
            approvalId: result.approvalId,
            message: "ON_HOLD_APPROVAL_REQUIRED",
          },
          { status: 201 },
        );
      }

      return Response.json({ ok: true, id: result.id }, { status: 201 });
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ApprovalError) {
      return approvalErrorResponse(error);
    }
    return authErrorResponse(error);
  }
}
