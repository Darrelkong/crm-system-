import { and, eq } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

export async function hasActiveKnowledgeReview(
  articleId: string,
  db: Database,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.knowledgeReviewRequests.id })
    .from(schema.knowledgeReviewRequests)
    .where(
      and(
        eq(schema.knowledgeReviewRequests.articleId, articleId),
        eq(schema.knowledgeReviewRequests.status, "pending"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
