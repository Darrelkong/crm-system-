import { requireAdmin } from "@/lib/permissions/auth";
import type { User } from "../../../drizzle/schema/users";

function isDebugApiEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  return process.env.ENABLE_DEBUG_API === "true";
}

export function assertDebugApiEnabled(): void {
  if (!isDebugApiEnabled()) {
    throw new Error("Debug API is disabled in production");
  }
}

export function debugDisabledResponse(): Response {
  return Response.json({ error: "Debug API 在生产环境已禁用" }, { status: 404 });
}

/** Debug routes: enabled check, then admin-only (staff cannot access). */
export async function requireDebugApiAdmin(
  request?: Request,
): Promise<User> {
  assertDebugApiEnabled();
  return requireAdmin(request);
}
