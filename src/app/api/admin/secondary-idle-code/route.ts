export const dynamic = "force-dynamic";

import { getRequestMeta } from "@/lib/auth/cookies";
import { requireAdmin, authErrorResponse } from "@/lib/permissions/auth";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { getDb } from "@/lib/db";
import {
  disableSecondaryIdleCode,
  generateAndStoreCode,
  getSecondaryIdleCodeState,
} from "@/lib/auth/secondary-idle-code";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const db = getDb();
    const state = await getSecondaryIdleCodeState(db);
    return Response.json({
      enabled: state.enabled,
      generatedAt: state.generatedAt,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAdmin(request);
    const { ipAddress, userAgent } = getRequestMeta(request);
    const body = (await request.json()) as { action?: string };
    const action = body.action;

    if (action === "generate") {
      const db = getDb();
      const plaintext = await generateAndStoreCode(db);

      await writeAuditLog({
        userId: actor.id,
        action: "secondary_idle_code.generated",
        entityType: "system_settings",
        ipAddress,
        userAgent,
        // Explicitly no metadata — plaintext and hash must never be logged
      });

      return Response.json({
        ok: true,
        plaintext,
        message: "二級密碼已生成。請妥善記錄，此密碼不再顯示。",
      });
    }

    if (action === "disable") {
      const db = getDb();
      await disableSecondaryIdleCode(db);

      await writeAuditLog({
        userId: actor.id,
        action: "secondary_idle_code.disabled",
        entityType: "system_settings",
        ipAddress,
        userAgent,
      });

      return Response.json({
        ok: true,
        message: "二級密碼功能已停用，所有豁免已立即清除。",
      });
    }

    return Response.json(
      { error: "不支援的操作，action 必須為 generate 或 disable" },
      { status: 400 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
