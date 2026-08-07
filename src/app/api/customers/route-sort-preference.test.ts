import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("customers API sort preference", () => {
  const source = readFileSync("src/app/api/customers/route.ts", "utf8");

  it("does not persist sort preference cookies from API list requests", () => {
    assert.doesNotMatch(source, /rememberCustomerListSortPreference/);
  });

  it("always resolves list sort through parseCustomerListSortParam", () => {
    assert.match(source, /parseCustomerListSortParam/);
    assert.match(source, /sortMode,/);
  });
});
