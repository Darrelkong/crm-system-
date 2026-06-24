export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import {
  canEditCustomer,
  assertCanViewCustomerFullDetails,
  PermissionError,
} from "@/lib/permissions/customers";
import { PageHeader } from "@/components/ui/card";
import { EditCustomerForm } from "./edit-customer-form";
import type { CustomerSourceKey } from "@/lib/constants/customer-sources";
import type { CustomerType, SalesStage } from "@/lib/constants/customer-fields";

type Props = { params: Promise<{ id: string }> };

export default async function EditCustomerPage({ params }: Props) {
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

  if (!canEditCustomer(user, customer)) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <p className="font-medium text-red-700">无权编辑该客户</p>
        <p className="mt-1 text-sm text-red-600">
          你没有权限编辑此客户的资料。
        </p>
        <Link href={`/customers/${id}`} className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          返回客户详情
        </Link>
      </div>
    );
  }

  try {
    assertCanViewCustomerFullDetails(user, customer);
  } catch (err) {
    if (err instanceof PermissionError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
          <p className="font-medium text-red-700">无权编辑该客户</p>
          <Link href={`/customers/${id}`} className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
            返回客户详情
          </Link>
        </div>
      );
    }
    throw err;
  }

  return (
    <div>
      <PageHeader
        title="编辑客户"
        description={`正在编辑：${customer.customerName}`}
      />
      <EditCustomerForm
        initial={{
          id: customer.id,
          customerName: customer.customerName,
          customerType: customer.customerType as CustomerType,
          phoneCountryCode: customer.phoneCountryCode,
          phone: customer.phone ?? "",
          wechatId: customer.wechatId ?? "",
          email: customer.email ?? "",
          source: customer.source as CustomerSourceKey,
          sourceRemark: customer.sourceRemark ?? "",
          notes: customer.notes ?? "",
          salesStage: customer.salesStage as SalesStage,
          status: customer.status,
        }}
      />
    </div>
  );
}
