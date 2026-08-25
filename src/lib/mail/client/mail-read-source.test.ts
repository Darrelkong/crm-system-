import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveMailReadSourceFromEnv,
  usesProductionMailReadSource,
} from "@/lib/mail/client/mail-read-source";

describe("mail read source resolver", () => {
  it("returns prototype for explicit prototype", () => {
    assert.equal(resolveMailReadSourceFromEnv("prototype"), "prototype");
    assert.equal(resolveMailReadSourceFromEnv("PROTOTYPE"), "prototype");
  });

  it("returns production for explicit production", () => {
    assert.equal(resolveMailReadSourceFromEnv("production"), "production");
    assert.equal(resolveMailReadSourceFromEnv(" production "), "production");
  });

  it("defaults missing value to prototype", () => {
    assert.equal(resolveMailReadSourceFromEnv(undefined), "prototype");
    assert.equal(resolveMailReadSourceFromEnv(""), "prototype");
    assert.equal(resolveMailReadSourceFromEnv("   "), "prototype");
  });

  it("defaults invalid value to prototype", () => {
    assert.equal(resolveMailReadSourceFromEnv("live"), "prototype");
    assert.equal(resolveMailReadSourceFromEnv("prod"), "prototype");
  });

  it("detects production source activation", () => {
    assert.equal(usesProductionMailReadSource("prototype"), false);
    assert.equal(usesProductionMailReadSource("production"), true);
  });
});
