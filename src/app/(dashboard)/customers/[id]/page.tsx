export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import {
  formatCustomerForUser,
  PermissionError,
} from "@/lib/permissions/customers";
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

type Props = { params: Promise<{ id: string }> };

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex py-2 text-sm">
      <dt className="w-32 shrink-0 text-slate-500">{label}</dt>
      <dd className="text-slate-900">{value}</dd>
    </div>
  );
}

export default async function CustomerDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuth();
  const customer = await getCustomerById(id);

  if (!customer) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="text-slate-500">客户不存在或已被删除。</p>
        <Link href="/customers" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          返回客户列表
        </Link>
      </div>
    );
  }

  let view;
  try {
    view = formatCustomerForUser(user, customer);
  } catch (err) {
    if (err instanceof PermissionError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="font-medium text-red-700">无权访问该客户</p>
          <p className="mt-1 text-sm text-red-600">
            你没有权限查看此客户的资料。
          </p>
          <Link href="/customers" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
            返回客户列表
          </Link>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">{view.customerName}</h2>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {STATUS_LABELS[view.status] ?? view.status}
            </span>
            {view.isMasked && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                公共池 · 已脱敏
              </span>
            )}
          </div>
        </div>
        <Link
          href="/customers"
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          ← 返回列表
        </Link>
      </div>

      {view.isMasked && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          该客户处于公共池，仅显示基本信息，手机号、微信、Email 等敏感信息已隐藏。
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white px-6">
        <div className="py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">基本信息</h3>
          <dl className="mt-2">
            <DetailRow label="客户名称" value={view.customerName} />
            <DetailRow
              label="客户类型"
              value={CUSTOMER_TYPE_LABELS[view.customerType as CustomerType] ?? view.customerType}
            />
            <DetailRow
              label="销售阶段"
              value={SALES_STAGE_LABELS[view.salesStage as SalesStage] ?? view.salesStage}
            />
            <DetailRow
              label="客户来源"
              value={CUSTOMER_SOURCE_LABELS[view.source as CustomerSourceKey] ?? view.source}
            />
          </dl>
        </div>

        {!view.isMasked && (
          <div className="py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">联系方式</h3>
            <dl className="mt-2">
              <DetailRow
                label="手机号"
                value={
                  view.phone
                    ? `${view.phoneCountryCode ?? ""} ${view.phone}`.trim()
                    : undefined
                }
              />
              <DetailRow label="微信号" value={view.wechatId} />
              <DetailRow label="Email" value={view.email} />
            </dl>
          </div>
        )}

        {!view.isMasked && (view.sourceRemark || view.notes) && (
          <div className="py-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">备注</h3>
            <dl className="mt-2">
              <DetailRow label="来源备注" value={view.sourceRemark} />
              <DetailRow label="其他备注" value={view.notes} />
            </dl>
          </div>
        )}

        <div className="py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">系统信息</h3>
          <dl className="mt-2">
            <DetailRow label="负责人" value={view.ownerId ?? "（公共池）"} />
            <DetailRow label="创建时间" value={view.createdAt.slice(0, 16).replace("T", " ")} />
            <DetailRow label="更新时间" value={view.updatedAt.slice(0, 16).replace("T", " ")} />
          </dl>
        </div>
      </div>
    </div>
  );
}
