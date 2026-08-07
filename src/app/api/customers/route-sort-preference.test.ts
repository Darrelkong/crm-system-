import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("customers API sort preference", () => {
  const source = readFileSync("src/app/api/customers/route.ts", "utf8");

  it("persists explicit sort preference from authenticated API requests", () => {
    assert.match(source, /rememberCustomerListSortPreference/);
    assert.match(source, /url\.searchParams\.has\("sort"\)/);
  });
});
