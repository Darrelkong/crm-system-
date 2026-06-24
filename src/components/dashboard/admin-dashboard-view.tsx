import Link from "next/link";
import { Card } from "@/components/ui/card";
import {
  KpiCard,
  RankingTable,
  SimpleBarRow,
} from "@/components/dashboard/dashboard-widgets";
import { RecentAnnouncementsCard } from "@/components/dashboard/recent-announcements-card";
import { RecentNotificationsCard } from "@/components/dashboard/recent-notifications-card";
import { getAdminDashboardStats } from "@/lib/reports/admin-dashboard";
import { getDb } from "@/lib/db";
import type { User } from "../../../drizzle/schema/users";
import { CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import { SALES_STAGE_LABELS } from "@/lib/constants/customer-fields";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";
import type { SalesStage } from "@/lib/constants/customer-fields";

export async function AdminDashboardView({ user }: { user: User }) {
  const db = getDb();
  const stats = await getAdminDashboardStats(db);

  const maxSource = Math.max(...stats.customersBySource.map((s) => s.count), 1);
  const maxStage = Math.max(
    ...stats.customersBySalesStage.map((s) => s.count),
    1,
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="总客户数" value={stats.totalCustomers} hint="不含已归档" />
        <KpiCard label="活跃客户" value={stats.activeCustomers} />
        <KpiCard
          label="公共池"
          value={stats.publicPoolCustomers}
          hint={
            <Link href="/public-pool" className="text-indigo-600 hover:underline">
              查看公共池
            </Link>
          }
        />
        <KpiCard label="已归档" value={stats.archivedCustomers} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="待审批"
          value={stats.pendingApprovals}
          variant="warning"
          hint={
            <Link href="/approvals" className="text-indigo-600 hover:underline">
              前往审批中心
            </Link>
          }
        />
        <KpiCard label="今日待办任务" value={stats.todayOpenTasks} />
        <KpiCard
          label="超期任务"
          value={stats.overdueTasks}
          variant="danger"
        />
        <KpiCard label="成交客户" value={stats.closedWonCustomers} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="本月新增客户" value={stats.newCustomersThisMonth} />
        <KpiCard label="本月跟进" value={stats.followUpsThisMonth} />
        <KpiCard label="本月有效跟进" value={stats.validFollowUpsThisMonth} />
        <KpiCard
          label="本月自动回收"
          value={stats.autoReclaimedThisMonth}
          hint="按审计日志统计"
        />
        <KpiCard
          label="流失高风险客户"
          value={stats.highChurnRiskCustomers}
          variant="danger"
          hint={
            <Link href="/customers?heat=high_churn_risk" className="text-indigo-600 hover:underline">
              查看列表
            </Link>
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="低完整度客户"
          value={stats.lowCompletenessCustomers}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            客户来源分布
          </h3>
          <div className="space-y-3">
            {stats.customersBySource.map((item) => (
              <SimpleBarRow
                key={item.label}
                label={
                  CUSTOMER_SOURCE_LABELS[item.label as CustomerSourceKey] ??
                  item.label
                }
                count={item.count}
                max={maxSource}
              />
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            销售阶段分布
          </h3>
          <div className="space-y-3">
            {stats.customersBySalesStage.map((item) => (
              <SimpleBarRow
                key={item.label}
                label={
                  SALES_STAGE_LABELS[item.label as SalesStage] ?? item.label
                }
                count={item.count}
                max={maxStage}
              />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <RankingTable
            title="员工客户排行"
            columns={["员工", "客户数"]}
            rows={stats.customersByOwner.map((o) => ({
              name: o.ownerName,
              count: o.count,
            }))}
          />
        </Card>

        <Card>
          <RankingTable
            title="员工本月跟进排行"
            columns={["员工", "跟进次数"]}
            rows={stats.followUpsByStaffThisMonth.map((s) => ({
              name: s.userName,
              count: s.count,
            }))}
          />
        </Card>
      </div>
    </div>
  );
}
