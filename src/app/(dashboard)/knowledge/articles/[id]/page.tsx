export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { getKnowledgeArticle } from "@/lib/knowledge/core-service";
import { requireKnowledgeAccess } from "@/lib/permissions/knowledge";

type PageContext = { params: Promise<{ id: string }> };

export default async function KnowledgeArticlePage(context: PageContext) {
  const { id } = await context.params;
  const actor = await requireKnowledgeAccess();
  const article = await getKnowledgeArticle(actor, id).catch(() => null);
  if (!article) notFound();

  const canEdit =
    article.status === "draft" &&
    (actor.role === "contributor" ||
      actor.role === "reviewer" ||
      actor.role === "knowledge_admin");

  return (
    <div>
      <PageIntro
        title={article.title}
        description={`${article.categoryName} · 更新于 ${new Date(article.updatedAt).toLocaleString()}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/knowledge"
              className="secondary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm"
            >
              返回 Knowledge
            </Link>
            <Link
              href={`/knowledge/articles/${article.id}/history`}
              className="secondary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm"
            >
              版本历史
            </Link>
            {canEdit && (
              <Link
                href={`/knowledge/articles/${article.id}/edit`}
                className="primary-button inline-flex min-h-11 items-center rounded-xl px-4 py-2.5 text-sm text-white"
              >
                编辑文章
              </Link>
            )}
          </div>
        }
      />
      <Card className="max-w-4xl">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={article.status === "draft" ? "warning" : "success"}>
            {article.status === "draft"
              ? "草稿"
              : article.status === "archived"
                ? "已归档"
                : "已发布"}
          </Badge>
          <Badge variant="default">版本 {article.currentVersionNumber}</Badge>
          <Badge variant="accent">
            {article.visibility === "team"
              ? "Team"
              : article.visibility === "owner"
                ? "Owner"
                : "Restricted"}
          </Badge>
        </div>
        {article.summary && (
          <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm leading-6 crm-text-secondary">
            {article.summary}
          </p>
        )}
        <article className="mt-6 whitespace-pre-wrap break-words text-sm leading-8 crm-text">
          {article.body}
        </article>
      </Card>
    </div>
  );
}
