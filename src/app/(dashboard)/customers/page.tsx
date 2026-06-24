export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/permissions/auth";
import { listCustomersForUser } from "@/lib/customers/queries";
import {
  filterCustomersWithScores,
  getCustomerIdsWithFollowUps,
  getCustomersWithScores,
} from "@/lib/customers/scoring/service";
import { HEAT_LEVELS } from "@/lib/customers/scoring/types";
import { getEffectiveSettings } from "@/lib/settings/effective";
import { getDb } from "@/lib/db";
import { CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import {
  CUSTOMER_TYPE_LABELS,
  SALES_STAGE_LABELS,
} from "@/lib/constants/customer-fields";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";
import {
  CompletenessBadge,
  HeatBadge,
} from "@/components/customers/customer-scores-cards";
import { HEAT_LEVEL_LABELS } from "@/lib/customers/scoring/constants";
import type { HeatLevel } from "@/lib/customers/scoring/types";

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  inactive: "未活跃",
  archived: "已归档",
  public_pool: "公共池",
};

type Props = {
  searchParams: Promise<{
    status?: string;
    heat?: string;
    completenessBelow?: string;
  }>;
};

export default async function CustomersPage({ searchParams }: Props) {
  const user = await requireAuth();
  const params = await searchParams;
  const showArchived = user.role === "admin" && params.status === "archived";

  const db = getDb();
  const customers = await listCustomersForUser(
    user,
    showArchived ? { status: "archived" } : {},
  );
  const followUpSet = await getCustomerIdsWithFollowUps(
    db,
    customers.map((c) => c.id),
  );
  const settings = await getEffectiveSettings(db);

  const scoringFilter: {
    heat?: HeatLevel;
    completenessBelow?: number;
  } = {};
  if (params.heat && (HEAT_LEVELS as readonly string[]).includes(params.heat)) {
    scoringFilter.heat = params.heat as HeatLevel;
  }
  if (params.completenessBelow) {
    const n = Number(params.completenessBelow);
    if (Number.isFinite(n)) scoringFilter.completenessBelow = n;
  }

  const views = filterCustomersWithScores(
    getCustomersWithScores(user, customers, followUpSet, settings),
    scoringFilter,
  );

  const baseQuery = showArchived ? "?status=archived" : "";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {showArchived ? "已归档客户" : "客户列表"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {showArchived
              ? `共 ${views.length} 位已归档客户（仅管理员）`
              : user.role === "admin"
                ? `共 ${views.length} 位客户（不含已归档）`
                : `共 ${views.length} 位客户（含公共池脱敏客户，不含已归档）`}
          </p>
          {user.role === "admin" && (
            <div className="mt-2 flex gap-3 text-sm">
              {showArchived ? (
                <Link href="/customers" className="text-indigo-600 hover:underline">
                  ← 返回活跃客户列表
                </Link>
              ) : (
                <Link
                  href="/customers?status=archived"
                  className="text-indigo-600 hover:underline"
                >
                  查看已归档客户
                </Link>
              )}
            </div>
          )}
        </div>
        {!showArchived && (
          <Link
            href="/customers/new"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            新增客户
          </Link>
        )}
      </div>

      {!showArchived && (
        <form
          method="get"
          className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4"
        >
          <div>
            <label htmlFor="heat" className="block text-xs font-medium text-slate-600">
              客户热度
            </label>
            <select
              id="heat"
              name="heat"
              defaultValue={params.heat ?? ""}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">全部</option>
              {HEAT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {HEAT_LEVEL_LABELS[level as HeatLevel]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="completenessBelow"
              className="block text-xs font-medium text-slate-600"
            >
              完整度低于
            </label>
            <input
              id="completenessBelow"
              name="completenessBelow"
              type="number"
              min={0}
              max={100}
              placeholder="60"
              defaultValue={params.completenessBelow ?? ""}
              className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-900"
          >
            筛选
          </button>
          {(params.heat || params.completenessBelow) && (
            <Link href={`/customers${baseQuery}`} className="text-sm text-slate-500 hover:underline">
              清除筛选
            </Link>
          )}
        </form>
      )}

      {views.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-slate-500">
            {showArchived ? "暂无已归档客户" : "暂无客户数据"}
          </p>
          {!showArchived && (
            <Link
              href="/customers/new"
              className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
            >
              新增第一位客户
            </Link>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">客户名称</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">类型</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">来源</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">销售阶段</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">状态</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">客户热度</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">完整度</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">跟进状态</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">数据</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">创建时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {views.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${c.id}`}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {c.customerName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {CUSTOMER_TYPE_LABELS[c.customerType as CustomerType] ?? c.customerType}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {CUSTOMER_SOURCE_LABELS[c.source as CustomerSourceKey] ?? c.source}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {SALES_STAGE_LABELS[c.salesStage as SalesStage] ?? c.salesStage}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {STATUS_LABELS[c.status] ?? c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <HeatBadge level={c.heatLevel} />
                  </td>
                  <td className="px-4 py-3">
                    <CompletenessBadge score={c.completenessScore} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {c.neverContacted && (
                        <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">
                          未有效跟进
                        </span>
                      )}
                      {c.overdueFollowUp && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                          跟进超期
                        </span>
                      )}
                      {!c.neverContacted && !c.overdueFollowUp && (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.isArchived ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                        已归档
                      </span>
                    ) : c.isMasked ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        已脱敏
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        完整
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {c.createdAt.slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
