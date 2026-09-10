import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { knowledgeDisplayInitials } from "@/lib/knowledge/display-initials";

describe("knowledgeDisplayInitials", () => {
  it("derives initials from dotted and spaced names", () => {
    assert.equal(knowledgeDisplayInitials("Daniel.Hayes"), "DH");
    assert.equal(knowledgeDisplayInitials("DarrellKoo"), "DK");
    assert.equal(knowledgeDisplayInitials("Jerry Jiao"), "JJ");
  });
});
