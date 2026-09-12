import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  buildKnowledgeSourcesListUrl,
  createKnowledgeIngestLifecycleRequestGuard,
  filterSourcesForLifecycle,
} from "@/lib/knowledge/knowledge-ingest-lifecycle";
import type { KnowledgeSourceListItem } from "@/lib/knowledge/source-service";

function source(
  id: string,
  archivedAt: string | null,
): KnowledgeSourceListItem {
  return {
    id,
    sourceType: "paste",
    sourceTitle: id,
    originalFilename: null,
    mimeType: "text/plain",
    sizeBytes: 1,
    status: "ready",
    failureCode: null,
    linkedArticleId: null,
    archivedAt,
    archivedByUserId: archivedAt ? "user" : null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    processedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("Knowledge ingest lifecycle list helpers", () => {
  it("builds lifecycle-specific API URLs", () => {
    assert.equal(
      buildKnowledgeSourcesListUrl("active"),
      "/api/knowledge/sources?lifecycle=active",
    );
    assert.equal(
      buildKnowledgeSourcesListUrl("archived"),
      "/api/knowledge/sources?lifecycle=archived",
    );
  });

  it("filters active and archived sources independently", () => {
    const rows = [
      source("active-1", null),
      source("archived-1", "2026-01-02T00:00:00.000Z"),
    ];
    assert.deepEqual(
      filterSourcesForLifecycle(rows, "active").map((row) => row.id),
      ["active-1"],
    );
    assert.deepEqual(
      filterSourcesForLifecycle(rows, "archived").map((row) => row.id),
      ["archived-1"],
    );
  });

  it("ignores stale lifecycle responses when a newer request begins", () => {
    const guard = createKnowledgeIngestLifecycleRequestGuard();
    const activeRequest = guard.begin();
    const archivedRequest = guard.begin();
    assert.equal(guard.isCurrent(activeRequest), false);
    assert.equal(guard.isCurrent(archivedRequest), true);

    const activeAgainRequest = guard.begin();
    assert.equal(guard.isCurrent(archivedRequest), false);
    assert.equal(guard.isCurrent(activeAgainRequest), true);
  });

  it("simulates late archived response losing to active tab", () => {
    const guard = createKnowledgeIngestLifecycleRequestGuard();
    const archivedRequest = guard.begin();
    const activeRequest = guard.begin();

    const archivedPayload = [source("archived-1", "2026-01-02T00:00:00.000Z")];
    const activePayload = [source("active-1", null)];

    let visible = [] as KnowledgeSourceListItem[];
    if (guard.isCurrent(archivedRequest)) {
      visible = archivedPayload;
    }
    if (guard.isCurrent(activeRequest)) {
      visible = activePayload;
    }

    assert.deepEqual(visible.map((row) => row.id), ["active-1"]);
  });

  it("keeps active and archived empty states independent", () => {
    const activeOnly = [source("active-1", null)];
    const archivedOnly = [source("archived-1", "2026-01-02T00:00:00.000Z")];
    assert.equal(filterSourcesForLifecycle(activeOnly, "archived").length, 0);
    assert.equal(filterSourcesForLifecycle(archivedOnly, "active").length, 0);
  });

  it("clears visible list while a newer lifecycle request is pending", () => {
    let visible: KnowledgeSourceListItem[] | "pending" = [source("stale", null)];
    const guard = createKnowledgeIngestLifecycleRequestGuard();
    guard.begin();
    visible = "pending";
    assert.equal(visible, "pending");
  });

  it("wires ingest client to guarded lifecycle loading", () => {
    const ingest = readFileSync(
      join(process.cwd(), "src/components/knowledge/knowledge-ingest-client.tsx"),
      "utf8",
    );
    assert.match(ingest, /fetchKnowledgeSourcesForLifecycle/);
    assert.match(ingest, /createKnowledgeIngestLifecycleRequestGuard/);
    assert.match(ingest, /sourcesLoading/);
    assert.match(ingest, /setSources\(\[\]\)/);
    assert.match(ingest, /lifecycleRequestGuardRef/);
    assert.match(ingest, /data-lifecycle-list/);
  });
});
