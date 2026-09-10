import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canArchiveKnowledgeArticle,
  canAuthorKnowledgeArticle,
  canEditKnowledgeArticle,
  canReviewInCenter,
  canShowKnowledgeArticleEditCta,
  canSubmitKnowledgeReview,
} from "@/lib/knowledge/article-permissions";
import type { KnowledgeSessionContext } from "@/lib/permissions/knowledge";
import type { User } from "../../../drizzle/schema/users";

function context(
  role: KnowledgeSessionContext["role"],
  userId = "user-1",
): KnowledgeSessionContext {
  return {
    user: {
      id: userId,
      email: `${role ?? "viewer"}@example.com`,
      displayName: role ?? "viewer",
      role: "staff",
    } as User,
    sessionId: "session-1",
    role,
  };
}

const article = {
  status: "draft" as const,
  visibility: "team" as const,
  ownerUserId: null,
  isPublishedSnapshot: false,
};

describe("Knowledge article permissions", () => {
  it("allows only contributor and knowledge_admin to author articles", () => {
    assert.equal(canAuthorKnowledgeArticle("contributor"), true);
    assert.equal(canAuthorKnowledgeArticle("knowledge_admin"), true);
    assert.equal(canAuthorKnowledgeArticle("reviewer"), false);
    assert.equal(canAuthorKnowledgeArticle("viewer"), false);
  });

  it("blocks reviewers from editing articles", () => {
    assert.equal(canEditKnowledgeArticle(context("reviewer"), article), false);
    assert.equal(canEditKnowledgeArticle(context("contributor"), article), true);
    assert.equal(
      canEditKnowledgeArticle(context("knowledge_admin"), article),
      true,
    );
  });

  it("limits archive to knowledge_admin", () => {
    assert.equal(canArchiveKnowledgeArticle(context("knowledge_admin"), article), true);
    assert.equal(canArchiveKnowledgeArticle(context("contributor"), article), false);
    assert.equal(canArchiveKnowledgeArticle(context("reviewer"), article), false);
  });

  it("keeps review submission on contributors and admins only", () => {
    assert.equal(canSubmitKnowledgeReview(context("contributor"), article), true);
    assert.equal(canSubmitKnowledgeReview(context("knowledge_admin"), article), true);
    assert.equal(canSubmitKnowledgeReview(context("reviewer"), article), false);
    assert.equal(canSubmitKnowledgeReview(context("viewer"), article), false);
  });

  it("keeps review center access for reviewer and admin", () => {
    assert.equal(canReviewInCenter("reviewer"), true);
    assert.equal(canReviewInCenter("knowledge_admin"), true);
    assert.equal(canReviewInCenter("contributor"), false);
    assert.equal(canReviewInCenter("viewer"), false);
  });

  it("hides edit CTA during pending review but keeps it for changes_requested", () => {
    assert.equal(canShowKnowledgeArticleEditCta(true, null), true);
    assert.equal(
      canShowKnowledgeArticleEditCta(true, { status: "pending" }),
      false,
    );
    assert.equal(
      canShowKnowledgeArticleEditCta(true, { status: "changes_requested" }),
      true,
    );
    assert.equal(canShowKnowledgeArticleEditCta(false, null), false);
    assert.equal(
      canShowKnowledgeArticleEditCta(false, { status: "pending" }),
      false,
    );
  });
});
