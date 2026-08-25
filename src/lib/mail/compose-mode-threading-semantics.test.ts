import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isForwardComposeMode,
  isRfcReplyComposeMode,
  replyToMessageIdImpliesRfcReplyRelationship,
  shouldEmitRfcReplyHeaders,
  shouldJoinSourceThread,
} from "@/lib/mail/compose-mode-threading-semantics";

describe("compose mode threading semantics", () => {
  it("treats reply modes as RFC reply threading candidates", () => {
    assert.equal(isRfcReplyComposeMode("reply"), true);
    assert.equal(isRfcReplyComposeMode("reply_all"), true);
    assert.equal(isRfcReplyComposeMode("forward"), false);
    assert.equal(isRfcReplyComposeMode("new"), false);
  });

  it("freezes forward as new-thread with no RFC reply headers for 6C", () => {
    assert.equal(isForwardComposeMode("forward"), true);
    assert.equal(shouldJoinSourceThread("forward"), false);
    assert.equal(shouldEmitRfcReplyHeaders("forward"), false);
    assert.equal(replyToMessageIdImpliesRfcReplyRelationship("forward"), false);
  });

  it("does not treat forward source provenance as automatic reply lineage", () => {
    assert.equal(replyToMessageIdImpliesRfcReplyRelationship("reply"), true);
    assert.equal(replyToMessageIdImpliesRfcReplyRelationship("forward"), false);
  });
});
