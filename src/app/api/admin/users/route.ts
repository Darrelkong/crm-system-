export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { listUsersForAdmin } from "@/lib/users-admin/queries";
import {
  UserAdminError,
  createUserAccount,
} from "@/lib/users-admin/service";
import { requireUserManagementAdmin } from "@/lib/permissions/user-management";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireUserManagementAdmin(request);
    const items = await listUsersForAdmin();
    return Response.json({ items, total: items.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUserManagementAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      role?: string;
      temporaryPassword?: string;
      confirmAdminRole?: boolean;
    };

    if (!body.temporaryPassword) {
      return Response.json({ error: "temporaryPassword 必填" }, { status: 400 });
    }

    const role = body.role === "admin" ? "admin" : "staff";

    const result = await createUserAccount(actor, {
      name: body.name ?? "",
      email: body.email ?? "",
      role,
      temporaryPassword: body.temporaryPassword,
      confirmAdminRole: body.confirmAdminRole === true,
      ipAddress,
      userAgent,
    });

    return Response.json({ ok: true, id: result.id }, { status: 201 });
  } catch (error) {
    if (error instanceof UserAdminError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
