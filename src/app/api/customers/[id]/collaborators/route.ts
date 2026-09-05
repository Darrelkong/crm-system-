export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import { getDb } from "@/lib/db";
import {
  addCustomerCollaborator,
  listCustomerCollaborators,
  removeCustomerCollaborator,
} from "@/lib/customers/collaborators";
import {
  assertCanManageCustomerCollaborators,
  PermissionError,
} from "@/lib/permissions/customers";
import {
  mapAssigneeMutationErrorToApiCode,
  toAssigneesPermissionError,
} from "@/lib/customers/assignees-api";
import { assertCustomerCollaboratorsMutable } from "@/lib/customers/assignees-mutations";
import { AssigneeMutationError } from "@/lib/customers/assignees-mutations";
import { resolveUserDisplayNames } from "@/lib/customers/user-labels";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: {
  status: number;
  message: string;
  errorCode: string;
}): Response {
  return Response.json(
    { error: error.message, errorCode: error.errorCode },
    { status: error.status },
  );
}

async function getCustomerOrResponse(
  id: string,
): Promise<
  | { customer: NonNullable<Awaited<ReturnType<typeof getCustomerById>>> }
  | Response
> {
  const customer = await getCustomerById(id);
  if (!customer) {
    return Response.json(
      { error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" },
      { status: 404 },
    );
  }
  return { customer };
}

function mapMutationError(error: AssigneeMutationError): Response {
  return errorResponse({
    status: error.code === "CUSTOMER_NOT_FOUND" ? 404 : 400,
    message: error.message,
    errorCode: mapAssigneeMutationErrorToApiCode(error.code),
  });
}

async function handlePermissionError(error: unknown): Promise<Response | null> {
  if (!(error instanceof PermissionError)) {
    return null;
  }
  return errorResponse(
    toAssigneesPermissionError(error) ?? {
      status: error.status,
      message: error.message,
      errorCode: "INSUFFICIENT_PERMISSIONS",
    },
  );
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const result = await getCustomerOrResponse(id);
    if (result instanceof Response) {
      return result;
    }

    try {
      assertCanManageCustomerCollaborators(user, result.customer);
      const db = getDb();
      await assertCustomerCollaboratorsMutable(db, id);
      const collaborators = await listCustomerCollaborators(db, id);
      const names = await resolveUserDisplayNames(
        db,
        collaborators.map((row) => row.userId),
      );
      return Response.json({
        ok: true,
        collaborators: collaborators.map((row) => ({
          id: row.userId,
          displayName: names.get(row.userId) ?? row.userId,
        })),
      });
    } catch (error) {
      return (await handlePermissionError(error)) ?? authErrorResponse(error);
    }
  } catch (error) {
    return authErrorResponse(error);
  }
}

async function mutate(
  request: Request,
  context: RouteContext,
  action: "add" | "remove",
): Promise<Response> {
  try {
    const user = await requireAuth(request);
    const { id } = await context.params;
    const result = await getCustomerOrResponse(id);
    if (result instanceof Response) {
      return result;
    }

    const body = (await request.json()) as Record<string, unknown>;
    const collaboratorUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    if (!collaboratorUserId) {
      return errorResponse({
        status: 400,
        message: "缺少协作成员用户 ID",
        errorCode: "ASSIGNEE_INVALID_PAYLOAD",
      });
    }

    const db = getDb();
    const mutationInput = {
      actor: user,
      customer: result.customer,
      collaboratorUserId,
    };
    const updated =
      action === "add"
        ? await addCustomerCollaborator(db, mutationInput)
        : await removeCustomerCollaborator(db, mutationInput);

    return Response.json({
      ok: true,
      collaborators: updated.collaborators.map((row) => ({
        id: row.userId,
      })),
    });
  } catch (error) {
    if (error instanceof AssigneeMutationError) {
      return mapMutationError(error);
    }
    return (await handlePermissionError(error)) ?? authErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  return mutate(request, context, "add");
}

export async function DELETE(request: Request, context: RouteContext) {
  return mutate(request, context, "remove");
}
