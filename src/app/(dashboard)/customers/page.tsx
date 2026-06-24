export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/permissions/auth";
import { listCustomersForUser } from "@/lib/customers/queries";
import { formatCustomerForUser } from "@/lib/permissions/customers";
import { CUSTOMER_SOURCE_LABELS } from "@/lib/constants/customer-source-labels";
import {
  CUSTOMER_TYPE_LABELS,
  SALES_STAGE_LABELS,
} from "@/lib/constants/customer-fields";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  inactive: "未活跃",
  archived: "已归档",
  public_pool: "公共池",
};

export default async function CustomersPage() {
  const user = await requireAuth();
  const customers = await listCustomersForUser(user);
  const views = customers.map((c) => formatCustomerForUser(user, c));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">客户列表</h2>
          <p className="mt-1 text-sm text-slate-500">
            {user.role === "admin"
              ? `共 ${views.length} 位客户（管理员可见全部）`
              : `共 ${views.length} 位客户（含公共池脱敏客户）`}
          </p>
        </div>
        <Link
          href="/customers/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          新增客户
        </Link>
      </div>

      {views.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center">
          <p className="text-slate-500">暂无客户数据</p>
          <Link
            href="/customers/new"
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
          >
            新增第一位客户
          </Link>
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
                    {c.isMasked ? (
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
