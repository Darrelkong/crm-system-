import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { getMobileBottomNav } from "@/lib/layout/nav-links";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("Knowledge Package 2 security and UI boundaries", () => {
  it("requires Package 1 Knowledge guards on every Package 2 API route", () => {
    const routes = [
      "src/app/api/knowledge/catalog/route.ts",
      "src/app/api/knowledge/categories/route.ts",
      "src/app/api/knowledge/categories/[id]/route.ts",
      "src/app/api/knowledge/articles/route.ts",
      "src/app/api/knowledge/articles/[id]/route.ts",
      "src/app/api/knowledge/articles/[id]/versions/route.ts",
    ];
    for (const route of routes) {
      const source = read(route);
      assert.match(source, /requireKnowledge(?:Access|Admin)/);
      assert.doesNotMatch(
        source,
        /\b(customer_id|contact_id|lead_id|mail_message_id|approval_id|follow_up_id)\b/,
      );
    }
  });

  it("keeps article content plain text and the UI free of Package 3/4 actions", () => {
    const source = [
      read("src/components/knowledge/knowledge-home-client.tsx"),
      read("src/components/knowledge/knowledge-article-editor.tsx"),
      read("src/app/(dashboard)/knowledge/articles/[id]/page.tsx"),
      read("src/app/(dashboard)/knowledge/articles/[id]/history/page.tsx"),
    ].join("\n");
    assert.match(source, /Quick|快速查看/);
    assert.match(source, /history|版本历史/);
    assert.match(source, /whitespace-pre-wrap/);
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|<iframe/);
    assert.doesNotMatch(source, /AI|语义搜索|发布文章|Publish/);
  });

  it("keeps five primary mobile navigation slots and Knowledge secondary", () => {
    const source = read("src/lib/layout/nav-links.ts");
    assert.equal(getMobileBottomNav("admin").length, 5);
    assert.equal(getMobileBottomNav("staff").length, 5);
    assert.ok(
      getMobileBottomNav("admin").every((item) => item.href !== "/knowledge"),
    );
    assert.match(source, /href: "\/knowledge", labelKey: "nav\.knowledge"/);
    assert.doesNotMatch(
      source.match(/href: "\/knowledge"[^\\n]*/)?.[0] ?? "",
      /mobilePrimary: true/,
    );
  });
});
