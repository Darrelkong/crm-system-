import { redirect } from "next/navigation";
import { KnowledgeAccessForm } from "@/components/knowledge/knowledge-access-form";
import { PageIntro } from "@/components/ui/page-intro";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";

export default async function KnowledgeAccessPage() {
  const status = await getKnowledgeSessionStatus();
  if (status.access.unlocked) {
    redirect("/knowledge");
  }

  return (
    <div>
      <PageIntro
        title="Knowledge Access"
        description="业务知识库安全验证"
      />
      <div className="surface-card max-w-xl p-6">
        {!status.access.initialized ? (
          <p className="text-sm crm-text-secondary">
            当前 Knowledge 尚未初始化，请联系 CRM 管理员完成首次设置。
          </p>
        ) : (
          <>
            <p className="text-sm crm-text-secondary">
              此区域包含内部业务资料。请完成二次访问验证后继续。
            </p>
            <div className="mt-6">
              <KnowledgeAccessForm />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
