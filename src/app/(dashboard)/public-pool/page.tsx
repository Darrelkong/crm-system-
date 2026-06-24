export const dynamic = "force-dynamic";

import { requireAuth } from "@/lib/permissions/auth";
import { formatPublicPoolListForUser } from "@/lib/public-pool/queries";
import { getStaffClaimStatus } from "@/lib/public-pool/claim-limits";
import { PublicPoolClient } from "./public-pool-client";

export default async function PublicPoolPage() {
  const user = await requireAuth();
  const items = await formatPublicPoolListForUser(user);

  const claimStatus =
    user.role === "staff"
      ? await getStaffClaimStatus(user.id)
      : { unlimited: true as const, canClaimNow: true };

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-900">公共池客户</h2>
        <p className="mt-1 text-sm text-slate-500">
          {user.role === "admin"
            ? "管理员可查看完整资料并领取客户（无领取限制）"
            : "员工仅可查看脱敏资料；按入池时间从早到晚排序"}
        </p>
      </div>

      {user.role === "staff" && "claimedInLast7Days" in claimStatus && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">7 天内已领取</p>
            <p className="mt-1 text-xl font-semibold">
              {claimStatus.claimedInLast7Days} / 5
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">剩余名额</p>
            <p className="mt-1 text-xl font-semibold">{claimStatus.remainingQuota}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">领取状态</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {claimStatus.canClaimNow
                ? "可以领取"
                : claimStatus.blockedReason}
            </p>
            {claimStatus.cooldownUntil && (
              <p className="mt-1 text-xs text-slate-500">
                冷却至：{claimStatus.cooldownUntil.slice(0, 16).replace("T", " ")}
              </p>
            )}
          </div>
        </div>
      )}

      <PublicPoolClient initialItems={items} isAdmin={user.role === "admin"} />
    </div>
  );
}
