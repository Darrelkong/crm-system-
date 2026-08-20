import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { forwardSubject, replySubject } from "./subject-utils";

describe("subject-utils", () => {
  it("replySubject avoids duplicate Re prefix", () => {
    assert.equal(replySubject("Bank Documents"), "Re: Bank Documents");
    assert.equal(replySubject("Re: Bank Documents"), "Re: Bank Documents");
    assert.equal(replySubject("re: Bank Documents"), "re: Bank Documents");
  });

  it("forwardSubject avoids duplicate Fwd prefix", () => {
    assert.equal(forwardSubject("Bank Documents"), "Fwd: Bank Documents");
    assert.equal(forwardSubject("Fwd: Bank Documents"), "Fwd: Bank Documents");
  });
});
