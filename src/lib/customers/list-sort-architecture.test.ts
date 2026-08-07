import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const PRODUCTION_SORT_FILES = [
  "src/lib/customers/list-sort.ts",
  "src/lib/customers/list-sort-reclaim.ts",
  "src/lib/customers/list-sort-reclaim-primitives.ts",
  "src/lib/customers/queries.ts",
] as const;

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}

function extractImports(source: string): string[] {
  const imports: string[] = [];
  const importPattern =
    /import\s+(?:type\s+)?(?:[\w*{}\s,]+)\s+from\s+["']([^"']+)["']/g;
  for (const match of source.matchAll(importPattern)) {
    imports.push(match[1] ?? "");
  }
  return imports;
}

describe("customer list sort architecture", () => {
  it("keeps production list-sort free of test-helper imports", () => {
    const listSort = readSource("src/lib/customers/list-sort.ts");
    assert.doesNotMatch(listSort, /list-sort-reclaim\.test-helper/);
    assert.doesNotMatch(listSort, /\.test-helper/);
    assert.doesNotMatch(listSort, /\.test["']/);
  });

  it("keeps production modules free of test file imports", () => {
    for (const file of PRODUCTION_SORT_FILES) {
      const source = readSource(file);
      assert.doesNotMatch(source, /\.test-helper/);
      assert.doesNotMatch(source, /\.test["']/);
    }
  });

  it("avoids a direct circular import between list-sort and list-sort-reclaim", () => {
    const listSortImports = extractImports(readSource("src/lib/customers/list-sort.ts"));
    const reclaimImports = extractImports(
      readSource("src/lib/customers/list-sort-reclaim.ts"),
    );

    const listSortImportsReclaim = listSortImports.some(
      (path) =>
        path === "@/lib/customers/list-sort-reclaim" ||
        path.endsWith("/list-sort-reclaim"),
    );
    const reclaimImportsListSort = reclaimImports.some(
      (path) =>
        path === "@/lib/customers/list-sort" ||
        path.endsWith("/list-sort"),
    );

    assert.equal(
      listSortImportsReclaim && reclaimImportsListSort,
      false,
      "list-sort.ts and list-sort-reclaim.ts must not import each other",
    );
  });

  it("routes shared reclaim SQL through list-sort-reclaim-primitives", () => {
    const listSort = readSource("src/lib/customers/list-sort.ts");
    const reclaim = readSource("src/lib/customers/list-sort-reclaim.ts");

    assert.match(listSort, /list-sort-reclaim-primitives/);
    assert.match(reclaim, /list-sort-reclaim-primitives/);
    assert.doesNotMatch(listSort, /list-sort-reclaim["']/);
  });
});
