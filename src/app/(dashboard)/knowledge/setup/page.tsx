import { redirect } from "next/navigation";
import { KnowledgeAccessForm } from "@/components/knowledge/knowledge-access-form";
import { PageIntro } from "@/components/ui/page-intro";
import { getKnowledgeSessionStatus } from "@/lib/permissions/knowledge";

export default async function KnowledgeSetupPage() {
  const status = await getKnowledgeSessionStatus();

  if (status.user.role !== "admin") {
    redirect("/knowledge/access");
  }
  if (status.access.initialized) {
    redirect(status.access.unlocked ? "/knowledge" : "/knowledge/access");
  }

  return (
    <div>
      <PageIntro
        title="Knowledge"
        description="业务知识库初始化"
      />
      <div className="surface-card max-w-xl p-6">
        <p className="text-sm crm-text-secondary">
          首次启用业务知识库，请设置 Knowledge 访问密码。
        </p>
        <div className="mt-6">
          <KnowledgeAccessForm setup />
        </div>
      </div>
    </div>
  );
}
