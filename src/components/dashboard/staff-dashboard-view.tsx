import Link from "next/link";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/dashboard-widgets";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { getStaffDashboardStats } from "@/lib/reports/staff-dashboard";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";

export async function StaffDashboardView({ user }: { user: User }) {
  const db = getDb();
  const stats = await getStaffDashboardStats(db, user);
  const claim = stats.publicPoolClaimStatus;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="我的客户"
          value={stats.myCustomers}
          hint="active 且负责人为我，不含公共池/归档"
        />
        <KpiCard label="今日待办" value={stats.myTodayTasks} />
        <KpiCard
          label="超期任务"
          value={stats.myOverdueTasks}
          variant="danger"
        />
        <KpiCard
          label="待审批"
          value={stats.myPendingApprovals}
          variant="warning"
          hint={
            <Link href="/approvals" className="text-indigo-600 hover:underline">
              查看我的申请
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="本月新增客户" value={stats.myNewCustomersThisMonth} />
        <KpiCard label="本月跟进" value={stats.myFollowUpsThisMonth} />
        <KpiCard label="本月有效跟进" value={stats.myValidFollowUpsThisMonth} />
        <KpiCard label="成交客户" value={stats.myClosedWonCustomers} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="从未有效跟进"
          value={stats.myNeverContactedCustomers}
          variant="warning"
        />
        <KpiCard
          label="自动回收风险"
          value={stats.myReclaimRiskCustomers}
          variant="danger"
          hint="处于回收预警天数内"
        />
        <KpiCard
          label="7 天领取数"
          value={stats.myClaimedFromPoolLast7Days}
          hint={`剩余名额 ${claim.remainingQuota} / ${claim.quotaLimit}`}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="我的流失高风险"
          value={stats.myHighChurnRiskCustomers}
          variant="danger"
          hint={
            <Link href="/customers?heat=high_churn_risk" className="text-indigo-600 hover:underline">
              查看客户
            </Link>
          }
        />
        <KpiCard
          label="我的低完整度客户"
          value={stats.myLowCompletenessCustomers}
          variant="warning"
          hint={
            <Link href="/customers?completenessBelow=60" className="text-indigo-600 hover:underline">
              完整度 &lt; 60
            </Link>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentNotificationsCard user={user} />
        <RecentAnnouncementsCard user={user} />
      </div>

      <Card>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">
          公共池领取状态
        </h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">7 天已领取</dt>
            <dd className="font-medium text-slate-900">
              {claim.claimedInLast7Days} / {claim.quotaLimit}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">剩余名额</dt>
            <dd className="font-medium text-slate-900">{claim.remainingQuota}</dd>
          </div>
          <div>
            <dt className="text-slate-500">冷却时间（小时）</dt>
            <dd className="font-medium text-slate-900">{claim.cooldownHours}</dd>
          </div>
          <div>
            <dt className="text-slate-500">当前可领取</dt>
            <dd className="font-medium text-slate-900">
              {claim.canClaimNow ? "是" : "否"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">状态说明</dt>
            <dd className="text-slate-800">
              {claim.blockedReason ?? "可正常领取"}
            </dd>
          </div>
        </dl>
        <Link
          href="/public-pool"
          className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
        >
          前往公共池 →
        </Link>
      </Card>
    </div>
  );
}
