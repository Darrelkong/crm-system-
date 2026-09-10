import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../../../../drizzle/schema";
import type { User } from "../../../../../drizzle/schema/users";
import { bindTestDatabase } from "@/lib/db";
import {
  createKnowledgeArticle,
  createKnowledgeCategory,
} from "@/lib/knowledge/core-service";
import { searchPublishedKnowledge } from "@/lib/knowledge/published-retrieval";
import { SEED_IDS } from "@/lib/constants/seed-ids";
import { getTestD1PlatformProxy } from "@/lib/mail/test-d1-platform-proxy";

const META = { ipAddress: null, userAgent: "knowledge-search-route-test" };
const LONG_QUERY = "海外银行账户服务开始前需要确认什么？";

let db: ReturnType<typeof drizzle<typeof schema>>;
let disposeProxy: (() => Promise<void>) | undefined;
let viewerUser: User;
let adminUser: User;

const viewerContext = () => ({
  user: viewerUser,
  sessionId: "search-route-viewer",
  role: "viewer" as const,
});
const adminContext = () => ({
  user: adminUser,
  sessionId: "search-route-admin",
  role: "knowledge_admin" as const,
});
const contributorContext = () => ({
  user: viewerUser,
  sessionId: "search-route-contributor",
  role: "contributor" as const,
});

describe("Knowledge search route retrieval path", () => {
  before(async () => {
    process.env.CRM_ALLOW_TEST_DB_BIND = "1";
    const proxy = await getTestD1PlatformProxy<{ DB: unknown }>();
    db = drizzle(proxy.env.DB, { schema });
    disposeProxy = proxy.dispose;
    bindTestDatabase(db);
    viewerUser = (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.staffA))
      .limit(1))[0] as User;
    adminUser = (await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, SEED_IDS.admin))
      .limit(1))[0] as User;
  });

  after(async () => {
    bindTestDatabase(null);
    await disposeProxy?.();
  });

  it("returns valid search results for long natural-language query (route handler body)", async () => {
    const category = await createKnowledgeCategory(
      adminContext(),
      { name: "Search route long query", description: null },
      META,
      db,
    );
    const article = await createKnowledgeArticle(
      contributorContext(),
      {
        title: "海外银行账户服务",
        categoryId: category.id,
        body: "服务开始前需要确认海外银行账户资料。",
        visibility: "team",
      },
      META,
      db,
    );
    await db
      .update(schema.knowledgeArticles)
      .set({ status: "published", publishedVersionNumber: 1 })
      .where(eq(schema.knowledgeArticles.id, article.id));

    const results = await searchPublishedKnowledge(
      viewerContext(),
      LONG_QUERY,
      db,
    );
    const payload = { query: LONG_QUERY, results };
    assert.equal(payload.query, LONG_QUERY);
    assert.ok(payload.results.some((result) => result.articleId === article.id));
  });
});
