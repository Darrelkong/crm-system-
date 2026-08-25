import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { forwardSubject, replySubject } from "@/lib/mail/compose-subject-utils";

describe("compose subject helpers", () => {
  it("adds Re: once", () => {
    assert.equal(replySubject("Hello"), "Re: Hello");
    assert.equal(replySubject("Re: Hello"), "Re: Hello");
    assert.equal(replySubject("re: Hello"), "re: Hello");
  });

  it("adds Fwd: once", () => {
    assert.equal(forwardSubject("Hello"), "Fwd: Hello");
    assert.equal(forwardSubject("Fwd: Hello"), "Fwd: Hello");
    assert.equal(forwardSubject("fwd: Hello"), "fwd: Hello");
  });
});
