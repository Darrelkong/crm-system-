import { requireAuth } from "@/lib/permissions/auth";
import { Card, PageHeader } from "@/components/ui/card";
import { NewCustomerForm } from "./new-customer-form";

export default async function NewCustomerPage() {
  await requireAuth();
  return (
    <div>
      <PageHeader
        title="新增客户"
        description="填写客户基本信息，带 * 号为必填项。"
      />
      <NewCustomerForm />
    </div>
  );
}
