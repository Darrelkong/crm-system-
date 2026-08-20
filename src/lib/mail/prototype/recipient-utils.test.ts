import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countUniqueRecipients,
  emailExistsInLists,
  findDuplicateField,
  initChipsFromDraft,
  isValidEmail,
  MAX_RECIPIENTS_PER_MESSAGE,
  parseRecipientTokens,
  remainingRecipientCapacity,
  type RecipientChipData,
} from "./recipient-utils";

function chip(email: string): RecipientChipData {
  return { id: email, email };
}

describe("recipient-utils", () => {
  it("validates email addresses", () => {
    assert.equal(isValidEmail("john@gmail.com"), true);
    assert.equal(isValidEmail("bad@"), false);
    assert.equal(isValidEmail("   "), false);
  });

  it("parses multiple pasted addresses", () => {
    const tokens = parseRecipientTokens(
      "a@example.com, b@example.com; c@example.com",
    );
    assert.deepEqual(tokens, [
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("detects duplicates across To/Cc/Bcc", () => {
    const lists = {
      to: [chip("john@gmail.com")],
      cc: [],
      bcc: [],
    };
    assert.equal(findDuplicateField("john@gmail.com", "cc", lists), "to");
  });

  it("enforces 50 recipient limit by unique normalized email", () => {
    const lists = {
      to: Array.from({ length: 49 }, (_, i) =>
        chip(`user${i}@example.com`),
      ),
      cc: [chip("extra@example.com")],
      bcc: [],
    };
    assert.equal(countUniqueRecipients(lists), 50);
    assert.equal(remainingRecipientCapacity(lists), 0);
    assert.equal(emailExistsInLists("extra@example.com", lists), true);
    assert.equal(
      remainingRecipientCapacity({
        to: Array.from({ length: MAX_RECIPIENTS_PER_MESSAGE }, (_, i) =>
          chip(`u${i}@example.com`),
        ),
        cc: [],
        bcc: [],
      }),
      0,
    );
  });

  it("initializes chips from draft strings", () => {
    const chips = initChipsFromDraft("a@example.com, b@example.com", () => null);
    assert.equal(chips.length, 2);
    assert.equal(chips[0]?.email, "a@example.com");
  });
});
