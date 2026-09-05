export const dynamic = "force-dynamic";

import { requireAuth, authErrorResponse } from "@/lib/permissions/auth";
import { getDb } from "@/lib/db";
import {
  verifyCollaboratorEmail,
  type VerifiedCollaborator,
} from "@/lib/customers/collaborator-verification";
import { PermissionError } from "@/lib/permissions/customers";

const NOT_AVAILABLE_RESPONSE = { ok: false as const };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const actor = await requireAuth(request);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(NOT_AVAILABLE_RESPONSE);
    }

    const record = isRecord(body) ? body : {};
    const selectedCollaboratorIds = Array.isArray(
      record.selectedCollaboratorIds,
    )
      ? record.selectedCollaboratorIds.filter(
          (value): value is string => typeof value === "string",
        )
      : undefined;
    const primaryOwnerId =
      actor.role === "admin" && typeof record.primaryOwnerId === "string"
        ? record.primaryOwnerId.trim()
        : actor.id;

    const verified = await verifyCollaboratorEmail(getDb(), {
      actor,
      primaryOwnerId,
      selectedCollaboratorIds,
      email: record.email,
    });

    if (!verified) {
      return Response.json(NOT_AVAILABLE_RESPONSE);
    }

    return Response.json({ ok: true, user: verified satisfies VerifiedCollaborator });
  } catch (error) {
    if (error instanceof PermissionError) {
      return Response.json(
        { error: error.message, errorCode: "CUSTOMER_COLLABORATORS_FORBIDDEN" },
        { status: error.status },
      );
    }
    return authErrorResponse(error);
  }
}
