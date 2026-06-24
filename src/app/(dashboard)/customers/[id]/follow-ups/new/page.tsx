export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireAuth } from "@/lib/permissions/auth";
import { getCustomerById } from "@/lib/customers/queries";
import {
  canAddFollowUp,
  assertCanViewCustomerFullDetails,
  PermissionError,
} from "@/lib/permissions/customers";
import { PageHeader } from "@/components/ui/card";
import { NewFollowUpForm } from "./new-follow-up-form";

type Props = { params: Promise<{ id: string }> };

export default async function NewFollowUpPage({ params }: Props) {
  const { id } = await params;
  const user = await requireAuth();
  const customer = await getCustomerById(id);

  if (!customer) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="text-slate-500">客户不存在。</p>
        <Link href="/customers" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  if (!canAddFollowUp(user, customer)) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
        <p className="font-medium text-red-700">无权为该客户添加跟进</p>
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
          <p className="font-medium text-red-700">无权为该客户添加跟进</p>
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
      <PageHeader title="添加跟进" description="记录本次客户跟进情况" />
      <NewFollowUpForm customerId={id} customerName={customer.customerName} />
    </div>
  );
}
